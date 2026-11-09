// Reactions and background work of the security module. Subscribers run once on the runtime that acts for the
// organisation (`actsHere`: the web version, or a Windows app not linked to one):
//
//   subscriber «security.promote»       an IT incident flagged «رخداد امنیتی» → its security incident (settings)
//   subscriber «security.change_review» a change touching secrets, identity, personal data or exposure → a security
//                                        review linked to it (SEC-065) and a note on the change
//   subscriber «security.evidence_hash» the first file attached to evidence sets its SHA-256 and the custody log
//   subscriber «security.major»         a security incident declared major → the custom event the notification
//                                        rule «رخداد امنیتی عمده» listens to
//   approvals settled                   vulnerability exceptions, policies, waivers and risk acceptances follow
//                                        their approval round (approved → applied / published / active; rejected)
//   job «security.rescore»              a vulnerability's CVSS, EPSS or KEV changed → its items are rescored
//   job «security.sweep»                hourly per organisation: regulatory clocks (overdue, due soon), overdue
//                                        flags, expiring and expired exceptions, waivers and acceptances (reminders,
//                                        expiry), control monitoring and KRIs, planned control tests, campaign
//                                        reminders, policies due for review
import { stateCategory } from "@shared/model/task";
import { tableDef } from "@shared/tables";
import { nextDeadline, securityFlags, type Deadline } from "@shared/security/logic";
import type { Ctx } from "../../context";
import type { RecordEvent } from "../../engine";
import { addJournalIn, addLinkIn, createIn, emitEvent, onRecordEvent, systemCtx, transitionIn, updateIn } from "../../engine";
import { enqueue, registerJobHandler, type JobContext } from "../../jobs";
import { actsHere, notifyPeople } from "../notify";
import { onApprovalSettled } from "../sla";
import { addDays, eqAll, isUuid, liveRow, liveRows, securityConfig, sysOf, todayOf, type Row } from "./common";
import { autoPromote } from "./ops";
import { rescoreVulnerability } from "./vuln";
import { measureIndicators, planControlTests, remindCampaigns } from "./grc";
import { firstAttachmentHash, syncIncidentFlags } from "./hooks";

export const SWEEP_EVERY = 60 * 60_000;
const lastSweep = new Map<string, number>();

/** Make sure the organisation's sweep is queued (throttled per process). */
export async function ensureSecuritySweep(q: JobContext["db"], orgId: string, delayMs = 60_000): Promise<void> {
  if (Date.now() - (lastSweep.get(orgId) ?? 0) < 10 * 60_000) return;
  lastSweep.set(orgId, Date.now());
  await enqueue(q, { kind: "security.sweep", orgId, delayMs, dedupeKey: "security.sweep", maxAttempts: 5 });
}

export const resetSecuritySweepThrottle = () => lastSweep.clear();

// ---------------------------------------------------------------------------------------------------------------
// Subscribers

async function onIncident(e: RecordEvent, jctx: JobContext): Promise<void> {
  if (!actsHere(jctx.cfg) || !isUuid(e.org_id) || !isUuid(e.id)) return;
  if (e.kind === "record.updated" && !(e.changed ?? []).includes("security_incident")) return;
  const sys = await systemCtx(jctx.cfg, e.org_id);
  await autoPromote(sys, e.id);
}

async function onChange(e: RecordEvent, jctx: JobContext): Promise<void> {
  if (!actsHere(jctx.cfg) || !isUuid(e.org_id) || !isUuid(e.id)) return;
  const watch = ["short_description", "description", "justification", "implementation_plan", "backout_plan"];
  if (e.kind === "record.updated" && !(e.changed ?? []).some((f) => watch.includes(f))) return;
  const sys = await systemCtx(jctx.cfg, e.org_id);
  const cfg = await securityConfig(jctx.db, sys);
  if (!cfg.review_changes || !tableDef("sec_review")) return;
  const chg = await liveRow(jctx.db, sys, "change_request", e.id);
  if (!chg || ["closed", "canceled"].includes(String(chg.state))) return;
  const flags = securityFlags([chg.short_description, chg.description, chg.justification, chg.implementation_plan, chg.backout_plan].filter(Boolean).join("\n"));
  if (!flags.length) return;
  const [have] = await liveRows(jctx.db, sys, "sec_review", eqAll({ change_id: e.id }), { limit: 1 });
  if (have) return;
  await sys.write(async (tx) => {
    const rv = await createIn(tx, sys, "sec_review", {
      title: `بازبینی امنیتی ${chg.number ?? ""}: ${String(chg.short_description ?? "").slice(0, 150)}`, kind: "change", change_id: e.id, flags: flags.map((f) => f.label),
      assignment_group_id: cfg.soc_group_id ?? cfg.vuln_group_id ?? null, due_at: chg.planned_start ?? new Date(Date.now() + 3 * 86_400_000).toISOString(),
    }, { trusted: true });
    await addLinkIn(tx, sys, "sec_review", rv.id, { kind: "related", table: "change_request", id: e.id });
    const def = tableDef("change_request");
    if (def?.features?.journal) await addJournalIn(tx, sys, def, chg, { kind: "work_note", body: `این تغییر به ${flags.map((f) => f.label).join("، ")} دست می‌زند؛ بازبینی امنیتی ${rv.number ?? ""} درخواست شد.` }, { trusted: true });
  });
}

async function onEvidenceFile(e: RecordEvent, jctx: JobContext): Promise<void> {
  if (!actsHere(jctx.cfg) || !isUuid(e.org_id) || !isUuid(e.id)) return;
  const sys = await systemCtx(jctx.cfg, e.org_id);
  const row = await liveRow(jctx.db, sys, "sec_evidence", e.id);
  if (!row) return;
  const hash = await firstAttachmentHash(jctx.db, e.org_id, "sec_evidence", e.id);
  const log = Array.isArray(row.custody_log) ? [...row.custody_log] : [];
  log.push({ at: new Date().toISOString(), action: "file_attached", by: e.actor ?? null, name: (e.data?.name as string) ?? null });
  await sys.write((tx) => updateIn(tx, sys, "sec_evidence", e.id, { ...(row.sha256 ? {} : { sha256: hash }), custody_log: log.slice(-500) }, { trusted: true, keepVersion: true, allowLocked: true }));
}

async function onSecurityIncident(e: RecordEvent, jctx: JobContext): Promise<void> {
  if (!actsHere(jctx.cfg) || !isUuid(e.org_id) || !isUuid(e.id)) return;
  await ensureSecuritySweep(jctx.db, e.org_id);
  const declared = (e.kind === "record.created" || (e.changed ?? []).includes("major")) && e.changes?.major?.to !== false;
  if (!declared) return;
  const sys = await systemCtx(jctx.cfg, e.org_id);
  const row = await liveRow(jctx.db, sys, "sec_incident", e.id);
  if (!row?.major) return;
  await sys.write((tx) => emitEvent(tx, sys, { kind: "record.security.major_declared", table: "sec_incident", id: e.id, number: row.number ?? null, data: { users: [row.lead_id, row.assigned_to].filter(isUuid) } }));
}

// ---------------------------------------------------------------------------------------------------------------
// Approvals

function installApprovalReactions(): void {
  const follow = (table: string, onApproved: string, onRejected: string) =>
    onApprovalSettled(table, async (s) => {
      const state = String(s.record.state ?? "");
      if (s.outcome === "approved" || (s.outcome === "replanned" && s.aggregate === "approved")) {
        if (state !== onApproved && hasTransition(table, state, onApproved)) await transitionIn(s.tx, s.ctx, table, String(s.record.id), onApproved);
      } else if (s.outcome === "rejected") {
        if (state !== onRejected && hasTransition(table, state, onRejected)) await transitionIn(s.tx, s.ctx, table, String(s.record.id), onRejected);
      }
    });
  follow("sec_vuln_exception", "approved", "rejected");
  follow("grc_policy_exception", "approved", "rejected");
  follow("grc_risk_acceptance", "active", "rejected");
  follow("grc_policy", "published", "draft");
}

function hasTransition(table: string, from: string, to: string): boolean {
  const def = tableDef(table);
  return !!def?.states?.transitions.some((t) => t.to === to && (t.from === "*" || t.from.includes(from)));
}

// ---------------------------------------------------------------------------------------------------------------
// The sweep

export interface SweepResult {
  clocks: number;
  overdue: number;
  expired: number;
  warned: number;
  tests: number;
  indicators: number;
  reminders: number;
}

const WARNED = "warned_at";

export async function securitySweep(sys: Ctx): Promise<SweepResult> {
  const out: SweepResult = { clocks: 0, overdue: 0, expired: 0, warned: 0, tests: 0, indicators: 0, reminders: 0 };
  const q = sys.db;
  const cfg = await securityConfig(q, sys);
  const today = todayOf(sys);
  const now = Date.now();

  // regulatory clocks: overdue flags and a warning six hours before a deadline (once per stage)
  for (const c of await liveRows(q, sys, "sec_reg_clock", { f: "state", op: "eq", v: "running" }, { limit: 1000 })) {
    const deadlines = ((c.deadlines as Deadline[]) ?? []).map((d) => ({ ...d })) as (Deadline & { warned?: string | null })[];
    const nd = nextDeadline(deadlines, now);
    let changed = false;
    for (const d of deadlines) {
      if (d.submitted_at || d.warned) continue;
      if (Date.parse(d.due_at) - now <= 6 * 3_600_000) {
        d.warned = new Date().toISOString();
        changed = true;
        out.warned++;
      }
    }
    if (changed || !!c.overdue !== nd.overdue) {
      await sys.write(async (tx) => {
        const row = await updateIn(tx, sys, "sec_reg_clock", c.id, { deadlines, overdue: nd.overdue }, { trusted: true, keepVersion: true });
        if (changed) {
          const users = [c.owner_id].filter(isUuid);
          if (users.length) await notifyPeople(tx, sys.org.id, { table: "sec_reg_clock", id: c.id, users, event: "custom", label: "موعد اطلاع‌رسانی الزامی", subject: `موعد «${nd.next?.label ?? ""}» ${c.number ?? ""} نزدیک است`, body: `موعد: ${nd.next?.due_at ?? ""}. گزارش را به ${row.authority ?? "نهاد ناظر"} بفرستید و ارسال را ثبت کنید.`, channels: ["in_app", "email"], mandatory: true, source: "امنیت" });
        }
        await syncIncidentFlags(tx, sys, String(c.sec_incident_id));
      });
      out.clocks++;
    }
  }

  // overdue flags of open items (in batches; their writes keep the version)
  const flag = async (table: string, open: string[], dueField = "due_at", dateOnly = false) => {
    const nowIso = new Date().toISOString();
    const cmp = dateOnly ? today : nowIso;
    const late = await liveRows(q, sys, table, { and: [{ f: "state", op: "in", v: open }, { f: dueField, op: "lt", v: cmp }, { f: "overdue", op: "eq", v: false }] }, { limit: 500 });
    const back = await liveRows(q, sys, table, { and: [{ f: "overdue", op: "eq", v: true }, { or: [{ f: "state", op: "nin", v: open }, { f: dueField, op: "gte", v: cmp }] }] }, { limit: 500 });
    if (!late.length && !back.length) return;
    await sys.write(async (tx) => {
      for (const r of late) await updateIn(tx, sys, table, r.id, { overdue: true }, { trusted: true, keepVersion: true, allowLocked: true });
      for (const r of back) await updateIn(tx, sys, table, r.id, { overdue: false }, { trusted: true, keepVersion: true, allowLocked: true });
    });
    out.overdue += late.length;
  };
  await flag("sec_vuln_item", ["open", "in_remediation"]);
  await flag("grc_issue", ["open", "in_progress"], "due_at", true);
  await flag("grc_finding", ["open", "action_planned", "in_progress"], "due_at", true);
  await flag("grc_risk_action", ["open", "in_progress"], "due_at", true);
  await flag("grc_dsr", ["received", "verifying", "in_progress"]);

  // exceptions, waivers and acceptances: a reminder before they expire, expiry after
  const warnBy = addDays(today, Number(cfg.exception_warn_days) || 14);
  const expiring: [string, string, string, string[]][] = [
    ["sec_vuln_exception", "approved", "expired", ["requested_by", "approver_id"]],
    ["grc_policy_exception", "approved", "expired", ["requested_by", "approver_id"]],
    ["grc_risk_acceptance", "active", "expired", ["accepted_by", "requested_by"]],
  ];
  for (const [table, live, to, people] of expiring) {
    const def = tableDef(table);
    if (!def) continue;
    for (const r of await liveRows(q, sys, table, { and: [{ f: "state", op: "eq", v: live }, { f: "expires_at", op: "lt", v: today }] }, { limit: 200 })) {
      await sys.write(async (tx) => {
        await transitionIn(tx, sys, table, r.id, to);
        const users = people.map((p) => r[p]).filter(isUuid);
        if (users.length) await notifyPeople(tx, sys.org.id, { table, id: r.id, users, event: "custom", label: "انقضا", subject: `${def.label} ${r.number ?? ""} منقضی شد`, body: "پس از انقضا، موارد آن دوباره در صف رفع یا ارزیابی قرار می‌گیرند. در صورت نیاز درخواست تازه ثبت کنید.", channels: ["in_app", "email"], source: "امنیت و انطباق" });
      });
      out.expired++;
    }
    if (!def.fields.some((f) => f.name === WARNED)) continue;
    for (const r of await liveRows(q, sys, table, { and: [{ f: "state", op: "eq", v: live }, { f: "expires_at", op: "lte", v: warnBy }, { f: WARNED, op: "empty" }] }, { limit: 200 })) {
      await sys.write(async (tx) => {
        await updateIn(tx, sys, table, r.id, { [WARNED]: new Date().toISOString() }, { trusted: true, keepVersion: true });
        const users = people.map((p) => r[p]).filter(isUuid);
        if (users.length) await notifyPeople(tx, sys.org.id, { table, id: r.id, users, event: "custom", label: "نزدیک شدن انقضا", subject: `${def.label} ${r.number ?? ""} تا ${r.expires_at} اعتبار دارد`, body: "برای تمدید، پیش از انقضا درخواست تازه با بررسی دوبارهٔ ریسک ثبت کنید.", channels: ["in_app", "email"], source: "امنیت و انطباق" });
      });
      out.warned++;
    }
  }

  // policies due for review: a note to the owner once (on the day the review falls due)
  for (const p of await liveRows(q, sys, "grc_policy", { and: [{ f: "state", op: "eq", v: "published" }, { f: "next_review_at", op: "eq", v: today }] }, { limit: 100 })) {
    if (!isUuid(p.owner_id)) continue;
    await sys.write((tx) => notifyPeople(tx, sys.org.id, { table: "grc_policy", id: p.id, users: [p.owner_id], event: "custom", label: "بازنگری خط‌مشی", subject: `موعد بازنگری «${String(p.title).slice(0, 120)}» رسیده است`, body: "متن را بازنگری و نسخهٔ تازه را برای تأیید بفرستید، یا بدون تغییر دوباره منتشر کنید.", channels: ["in_app", "email"], source: "امنیت و انطباق" }));
  }

  out.tests = await planControlTests(sys);
  out.indicators = (await measureIndicators(sys)).measured;
  out.reminders = await remindCampaigns(sys);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------

let installed = false;

export function installSecurityJobs(): void {
  if (installed) return;
  installed = true;
  onRecordEvent("security.promote", onIncident, { tables: ["incident"], kinds: ["record.created", "record.updated"] });
  onRecordEvent("security.change_review", onChange, { tables: ["change_request"], kinds: ["record.created", "record.updated"] });
  onRecordEvent("security.evidence_hash", onEvidenceFile, { tables: ["sec_evidence"], kinds: ["record.attachment_added"] });
  onRecordEvent("security.major", onSecurityIncident, { tables: ["sec_incident"], kinds: ["record.created", "record.updated"] });
  installApprovalReactions();
  registerJobHandler("security.rescore", async (job, jctx) => {
    if (!job.org_id || !actsHere(jctx.cfg) || !isUuid(job.payload?.vulnerability_id)) return;
    const sys = await systemCtx(jctx.cfg, job.org_id);
    await rescoreVulnerability(sys, String(job.payload.vulnerability_id));
  });
  registerJobHandler("security.sweep", async (job, jctx) => {
    if (!job.org_id || !actsHere(jctx.cfg)) return;
    const sys = await systemCtx(jctx.cfg, job.org_id);
    await securitySweep(sys);
    return { again: SWEEP_EVERY };
  });
}

export { stateCategory, sysOf };
