// Behaviour of the security module's tables on every write path (API, imports, flows, jobs; a Windows app's push gets
// the derived values through `derivePush`), inside the write's transaction:
//
//   secure tables    (SIR, response tasks, observables, evidence, regulatory clocks) always in the secure workspace
//                    «امنیت», incidents and evidence always confidential; only members of the workspace create them
//   sec_incident     default group (SOC), risk score and priority from the calculator, NIST phase stamps, MTTD / MTTC /
//                    MTTR durations, the category's playbook (its tasks after the write), a note on personal-data
//                    breaches; guards: review needs the response tasks done, closing needs every mandatory task, the
//                    regulatory clocks settled and, for important true positives, the lessons learnt
//   sec_task         containment actions always need human approval; done only once approved; executed stamps and an
//                    immutable note on the incident
//   sec_observable   refanged value, detected type, normalised key, sightings
//   sec_evidence     chain-of-custody log (collection, transfers, states, holds); no release or destruction under hold
//   sec_reg_clock    calendar-time deadlines from awareness, the next stage, overdue; the incident's flags follow
//   sec_vulnerability CVE key, CVSS severity; scores of its items follow by job
//   sec_vuln_item    de-duplication key, risk score and rating, SSVC, the remediation target from first detection, the
//                    support group and service of the CI, reopen counting; exception states only with an approved one
//   sec_vuln_exception validity (VEX justification for «not affected», expiry); approval applies it to its items and
//                    expiry or revocation reopens them
//   GRC              requirement status from mapped controls (SoA back to draft when applicability changes), control
//                    test results → effectiveness and issues, evidence hashes, policy publication and versions, campaign
//                    start, audit independence, CSF gaps, DSR deadlines, risk scores from the matrix, residual and
//                    appetite, acceptance by the risk owner, KRI status, overdue flags
//
// Reactions that must happen once (notifications, promotions, scans, sweeps) are event subscribers and jobs (jobs.ts).
import { stateCategory } from "@shared/model/task";
import type { StateModel } from "@shared/model/types";
import { tableDef } from "@shared/tables";
import { CONTAINMENT_ACTIONS, PHASES, SECURE_TABLES } from "@shared/tables/security";
import {
  aboveAppetite, annualLoss, csfGap, kriStatus, nextDeadline, nextTestDue, normalizeObservable, phaseStamps, refang, regDeadlines, riskRating, riskScore,
  secondsBetween, sirPriority, sirRiskScore, suggestedResidual, testEffectiveness, detectObservableType, cvssSeverity, type Deadline,
} from "@shared/security/logic";
import { addJournalIn, createIn, onBeforeCommit, registerHooks, transitionIn, updateIn, validationError, type PushArgs, type WriteArgs } from "../../engine";
import { enqueue } from "../../jobs";
import { forbidden } from "../../http/errors";
import { grantIn } from "@shared/access/model";
import { subjectOf } from "../../access";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { addDays, addMonths, eqAll, ids, inWorkspace, isUuid, liveRow, liveRows, managesArea, openStates, secureWorkspace, securityConfig, sysOf, todayOf, type Row } from "./common";
import { applyPlaybookIn } from "./ops";
import { recomputeRequirements, recomputeFramework } from "./grc";
import { scoreItem, recountRemediation, recountVulnerability, applyException, releaseException } from "./vuln";

const iso = () => new Date().toISOString();
const entering = (w: WriteArgs, state: string) => w.next.state === state && (w.op === "create" || w.prev?.state !== state);
const changed = (w: WriteArgs, f: string) => (w.op === "create" ? w.next[f] !== null && w.next[f] !== undefined && w.next[f] !== "" : w.changed.has(f));
const actorOf = (ctx: Ctx) => (ctx.actor === "system" ? null : ctx.user.id);
const isOpen = (model: StateModel | undefined, state: unknown) => {
  const c = stateCategory(model, state);
  return c === "new" || c === "active" || c === "waiting";
};

// ---------------------------------------------------------------------------------------------------------------
// The secure workspace

async function secureBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const ws = await secureWorkspace(w.tx, w.ctx);
  if (w.op === "create" && !inWorkspace(w.ctx, ws)) throw forbidden("این رکورد را فقط اعضای فضای کاری امن «امنیت» ثبت می‌کنند");
  if (w.next.workspace_id !== ws) w.next.workspace_id = ws;
  if (w.def.features?.confidential && w.next.confidential !== true) w.next.confidential = true;
}

async function secureDerived(p: PushArgs): Promise<Row> {
  const ws = await secureWorkspace(p.tx, p.ctx);
  return { workspace_id: ws, ...(p.def.features?.confidential ? { confidential: true } : {}) };
}

// ---------------------------------------------------------------------------------------------------------------
// Security incidents

async function sirBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  const now = iso();
  const cfg = await securityConfig(w.tx, w.ctx);
  if (!n.assignment_group_id && cfg.soc_group_id) n.assignment_group_id = cfg.soc_group_id;
  if (w.op === "create" && !n.detected_at) n.detected_at = n.opened_at ?? now;
  const score = sirRiskScore(n, cfg.sir_weights ?? undefined);
  n.risk_score = score;
  n.priority = sirPriority(score);
  if (w.op === "create" || w.changed.has("state")) Object.assign(n, phaseStamps(w.op === "create" ? null : (w.prev?.state ?? null), String(n.state), n, now));
  n.time_to_detect = secondsBetween(n.first_malicious_at, n.detected_at);
  n.time_to_contain = secondsBetween(n.detected_at, n.contained_at);
  n.time_to_recover = secondsBetween(n.detected_at, n.recovered_at);
  if (String(n.lessons ?? "").trim() && !n.pir_done_at) n.pir_done_at = now;
  if (cfg.auto_playbook && !n.playbook_id && n.category && (w.op === "create" || w.changed.has("category"))) {
    const [pb] = await liveRows(w.tx, sysOf(w.ctx), "sec_playbook", { and: [{ f: "category", op: "eq", v: n.category }, { f: "active", op: "eq", v: true }, { f: "auto_apply", op: "eq", v: true }] }, { order: "t.created_at", limit: 1 });
    if (pb) n.playbook_id = pb.id;
  }
}

async function sirAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.op === "delete") return;
  const sys = sysOf(w.ctx);
  if (w.row.playbook_id && (w.op === "create" || w.changed.has("playbook_id"))) await applyPlaybookIn(w.tx, w.ctx, w.row, w.row.playbook_id);
  if (w.row.personal_data_breach === true && changed(w, "personal_data_breach")) {
    const regimes = await liveRows(w.tx, sys, "sec_reg_regime", { and: [{ f: "active", op: "eq", v: true }] }, { order: "t.name", limit: 20 });
    const lines = regimes.map((r) => `- ${r.name}: ${(Array.isArray(r.stages) ? r.stages : []).map((s: Row) => `${s.label} ظرف ${s.hours} ساعت`).join("، ")}`);
    await addJournalIn(w.tx, sys, w.def, w.row, { kind: "work_note", body: `نقض دادهٔ شخصی ثبت شد. لزوم اطلاع‌رسانی به نهادها و افراد متأثر را بررسی کنید و ساعت‌های الزامی را از «ساعت‌های الزامی» شروع کنید:\n${lines.join("\n")}` }, { trusted: true });
  }
}

/** Open mandatory response tasks of an incident (optionally of some phases). */
export async function openTasks(q: Queryable, ctx: Ctx, sirId: string, phases?: string[]): Promise<Row[]> {
  const cond = { and: [{ f: "sec_incident_id", op: "eq" as const, v: sirId }, { f: "mandatory", op: "eq" as const, v: true }, { f: "state", op: "in" as const, v: ["new", "in_progress", "pending"] }, ...(phases ? [{ f: "phase", op: "in" as const, v: phases }] : [])] };
  return liveRows(q, sysOf(ctx), "sec_task", cond, { order: "t.no", limit: 50 });
}

const numbers = (rows: Row[]) => rows.slice(0, 5).map((r) => r.number).filter(Boolean).join("، ");

async function canReview(w: WriteArgs): Promise<string | null> {
  const open = await openTasks(w.tx, w.ctx, String(w.next.id), ["analysis", "contain", "eradicate", "recover"]);
  return open.length ? `کارهای لازمِ پاسخ هنوز باز است: ${numbers(open)}` : null;
}

async function canClose(w: WriteArgs): Promise<string | null> {
  const n = w.next;
  const open = await openTasks(w.tx, w.ctx, String(n.id));
  if (open.length) return `کارهای لازم هنوز باز است: ${numbers(open)}`;
  const clocks = await liveRows(w.tx, sysOf(w.ctx), "sec_reg_clock", { and: [{ f: "sec_incident_id", op: "eq", v: n.id }, { f: "state", op: "eq", v: "running" }] }, { limit: 5 });
  if (clocks.length) return `اطلاع‌رسانی الزامی هنوز در جریان است: ${numbers(clocks)}`;
  const important = n.major === true || n.severity === "1" || n.severity === "2";
  if (n.close_code === "true_positive" && important && !String(n.lessons ?? "").trim()) return "برای رخداد امنیتی مهم، پیش از بستن درس‌آموخته‌ها را در «بازبینی پس از رخداد» بنویسید";
  return null;
}

async function sirDerived(p: PushArgs): Promise<Row> {
  const cfg = await securityConfig(p.tx, p.ctx);
  const score = sirRiskScore(p.next, cfg.sir_weights ?? undefined);
  return { ...(await secureDerived(p)), risk_score: score, priority: sirPriority(score) };
}

// ---------------------------------------------------------------------------------------------------------------
// Response tasks

async function taskBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  const sys = sysOf(w.ctx);
  if (w.op === "create" || w.changed.has("sec_incident_id")) {
    const sir = await liveRow(w.tx, sys, "sec_incident", n.sec_incident_id);
    if (!sir) throw validationError({ sec_incident_id: "رخداد امنیتی پیدا نشد" });
    if (!isOpen(tableDef("sec_incident")?.states, sir.state)) throw validationError({ sec_incident_id: "به رخداد امنیتی بسته کار تازه افزوده نمی‌شود" });
    if (!n.assignment_group_id && sir.assignment_group_id) n.assignment_group_id = sir.assignment_group_id;
  }
  if (n.action && n.action !== "none") n.requires_approval = true;
  if (!PHASES.some((p) => p.value === n.phase)) n.phase = "analysis";
  if (entering(w, "closed_complete") && n.action && n.action !== "none" && !n.executed_at) {
    n.executed_at = iso();
    n.executed_by = actorOf(w.ctx);
  }
}

async function taskAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.op === "delete" || !entering(w, "closed_complete") || !w.row.action || w.row.action === "none") return;
  const sys = sysOf(w.ctx);
  const sir = await liveRow(w.tx, sys, "sec_incident", w.row.sec_incident_id);
  if (!sir) return;
  const label = CONTAINMENT_ACTIONS.find((o) => o.value === w.row.action)?.label ?? String(w.row.action);
  await addJournalIn(w.tx, sys, tableDef("sec_incident")!, sir, {
    kind: "work_note",
    body: `اقدام مهار «${label}»${w.row.action_target ? ` روی «${w.row.action_target}»` : ""} با کار ${w.row.number ?? ""} انجام شد (تأیید: ${w.row.approval === "approved" ? "دارد" : "ندارد"}).${w.row.action_result ? `\nنتیجه: ${w.row.action_result}` : ""}`,
    data: { task: w.row.id, action: w.row.action, target: w.row.action_target ?? null },
  }, { trusted: true, author: actorOf(w.ctx) });
}

function canComplete(w: WriteArgs): string | null {
  if (w.next.requires_approval === true && w.next.approval !== "approved" && w.ctx.actor !== "system") return "اقدام مهار پیش از انجام، تأیید انسانی می‌خواهد (کار را «شروع» کنید تا تأیید درخواست شود)";
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Observables

async function observableBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  if (typeof n.value === "string") n.value = refang(n.value).trim();
  if (!n.type && n.value) n.type = detectObservableType(String(n.value));
  if (w.op === "create" || w.changed.has("value") || w.changed.has("type")) n.normalized = normalizeObservable(String(n.type ?? "other"), String(n.value ?? ""));
  const now = iso();
  if (!n.first_seen) n.first_seen = now;
  if (!n.last_seen) n.last_seen = now;
  n.sightings = ids(n.incidents).length;
  if (!n.assignment_group_id) {
    const cfg = await securityConfig(w.tx, w.ctx);
    if (cfg.soc_group_id) n.assignment_group_id = cfg.soc_group_id;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Evidence and chain of custody

async function evidenceBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") {
    if (w.prev?.legal_hold) throw forbidden("شاهدِ زیر توقیف قانونی حذف نمی‌شود");
    return;
  }
  const n = w.next;
  if (n.sha256) {
    const h = String(n.sha256).trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(h)) throw validationError({ sha256: "هش SHA-256 باید ۶۴ نویسهٔ شانزده‌شانزدهی باشد" });
    n.sha256 = h;
  }
  if (w.op === "create" || w.changed.has("sec_incident_id")) {
    const sir = await liveRow(w.tx, sysOf(w.ctx), "sec_incident", n.sec_incident_id);
    if (!sir) throw validationError({ sec_incident_id: "رخداد امنیتی پیدا نشد" });
    if (!n.assignment_group_id && sir.assignment_group_id) n.assignment_group_id = sir.assignment_group_id;
  }
  const at = iso();
  const by = actorOf(w.ctx);
  const log: Row[] = Array.isArray(w.prev?.custody_log) ? [...(w.prev!.custody_log as Row[])] : [];
  if (w.op === "create") log.push({ at, action: "collected", to: n.custodian_id ?? n.collected_by ?? by, by, location: n.location ?? null });
  else {
    if (w.changed.has("custodian_id")) log.push({ at, action: "transfer", from: w.prev?.custodian_id ?? null, to: n.custodian_id ?? null, by, location: n.location ?? null });
    if (w.changed.has("state")) log.push({ at, action: n.state, by });
    if (w.changed.has("legal_hold")) log.push({ at, action: n.legal_hold ? "hold" : "hold_lifted", by });
    if (w.changed.has("location") && !w.changed.has("custodian_id")) log.push({ at, action: "moved", by, location: n.location ?? null });
    if (w.changed.has("sha256") && w.prev?.sha256) log.push({ at, action: "hash_changed", by, from: w.prev.sha256, to: n.sha256 });
  }
  n.custody_log = log.slice(-500);
}

function evidenceRelease(w: WriteArgs): string | null {
  return w.next.legal_hold ? "این شاهد زیر توقیف قانونی است؛ پیش از آزادسازی یا امحا، توقیف را بردارید" : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Regulatory clocks

async function clockBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  const sys = sysOf(w.ctx);
  if (w.op === "create" || w.changed.has("regime_id") || w.changed.has("aware_at")) {
    const regime = await liveRow(w.tx, sys, "sec_reg_regime", n.regime_id);
    if (!regime) throw validationError({ regime_id: "مقررات پیدا نشد" });
    n.deadlines = regDeadlines(String(n.aware_at ?? iso()), Array.isArray(regime.stages) ? regime.stages : [], (w.prev?.deadlines as Deadline[]) ?? []);
    if (!n.authority) n.authority = regime.authority ?? null;
  }
  if (w.op === "create") {
    const sir = await liveRow(w.tx, sys, "sec_incident", n.sec_incident_id);
    if (!sir) throw validationError({ sec_incident_id: "رخداد امنیتی پیدا نشد" });
    if (!n.assignment_group_id && sir.assignment_group_id) n.assignment_group_id = sir.assignment_group_id;
  }
  const nd = nextDeadline((n.deadlines as Deadline[]) ?? [], Date.now());
  n.next_due_at = nd.next?.due_at ?? null;
  n.next_stage = nd.next?.label ?? null;
  n.overdue = n.state === "running" && nd.overdue;
}

async function clockAfter(w: WriteArgs & { row: Row }): Promise<void> {
  const sirId = String((w.op === "delete" ? w.prev?.sec_incident_id : w.row.sec_incident_id) ?? "");
  if (!isUuid(sirId)) return;
  const ctx = w.ctx;
  onBeforeCommit(w.tx, `sec.sir.reg:${sirId}`, async () => syncIncidentFlags(w.tx, ctx, sirId));
}

/** The incident's «اطلاع‌رسانی الزامی» flags from its clocks. */
export async function syncIncidentFlags(tx: Tx, ctx: Ctx, sirId: string): Promise<void> {
  const sys = sysOf(ctx);
  const sir = await liveRow(tx, sys, "sec_incident", sirId);
  if (!sir) return;
  const clocks = await liveRows(tx, sys, "sec_reg_clock", { and: [{ f: "sec_incident_id", op: "eq", v: sirId }, { f: "state", op: "ne", v: "not_required" }] }, { limit: 50 });
  const regulatory = clocks.length > 0;
  const overdue = clocks.some((c) => c.state === "running" && c.overdue === true);
  if (!!sir.regulatory !== regulatory || !!sir.regulatory_overdue !== overdue) await updateIn(tx, sys, "sec_incident", sirId, { regulatory, regulatory_overdue: overdue }, { trusted: true, keepVersion: true, allowLocked: true });
}

function allSubmitted(w: WriteArgs): string | null {
  const d = (w.next.deadlines as Deadline[]) ?? [];
  const open = d.filter((x) => !x.submitted_at);
  return open.length ? `این مرحله‌ها هنوز فرستاده نشده‌اند: ${open.map((x) => x.label).join("، ")}` : null;
}

function regimeBefore(w: WriteArgs): void {
  if (w.op === "delete") return;
  const stages = w.next.stages;
  if (!Array.isArray(stages) || !stages.length || stages.length > 10) throw validationError({ stages: "یک تا ده مرحله با کلید، عنوان و ساعت لازم است" });
  for (const s of stages as Row[]) {
    if (!s || typeof s.key !== "string" || !/^[a-z][a-z0-9_]{0,40}$/.test(s.key) || typeof s.label !== "string" || !(Number(s.hours) > 0) || Number(s.hours) > 24 * 365) {
      throw validationError({ stages: "هر مرحله کلید لاتین، عنوان و ساعت مثبت (تا یک سال) می‌خواهد" });
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Playbooks and settings

function playbookBefore(w: WriteArgs): void {
  if (w.op === "delete") return;
  const steps = w.next.steps;
  if (!Array.isArray(steps) || steps.length > 50) throw validationError({ steps: "گام‌ها فهرستی تا ۵۰ گام است" });
  for (const s of steps as Row[]) {
    if (!s || typeof s.title !== "string" || !s.title.trim() || s.title.length > 200) throw validationError({ steps: "هر گام عنوانی تا ۲۰۰ نویسه می‌خواهد" });
    if (s.phase && !PHASES.some((p) => p.value === s.phase)) throw validationError({ steps: `مرحلهٔ «${s.phase}» شناخته نیست` });
  }
  if (w.op !== "create" && w.changed.has("steps")) w.next.revision = Number(w.prev?.revision ?? 1) + 1;
}

function configBefore(w: WriteArgs): void {
  if (w.op === "delete") return;
  const wts = w.next.sir_weights;
  if (wts !== null && wts !== undefined) {
    const ok = typeof wts === "object" && !Array.isArray(wts) && ["severity", "impact", "data", "personal"].every((k) => Number.isFinite(Number((wts as Row)[k])) && Number((wts as Row)[k]) >= 0);
    if (!ok) throw validationError({ sir_weights: "وزن‌های شدت، اثر، داده و دادهٔ شخصی عدد نامنفی‌اند" });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Vulnerabilities

async function vulnBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  if (typeof n.cve_id === "string") n.cve_id = n.cve_id.trim().toUpperCase();
  n.severity = cvssSeverity(n.cvss_score);
  if (!n.title) n.title = n.cve_id;
}

async function vulnAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.op === "create" || w.op === "delete") return;
  if (!["cvss_score", "epss", "kev", "kev_due", "exploit_maturity"].some((f) => w.changed.has(f))) return;
  await enqueue(w.tx, { kind: "security.rescore", orgId: w.ctx.org.id, payload: { vulnerability_id: w.row.id }, dedupeKey: `security.rescore:${w.row.id}`, maxAttempts: 5 });
}

async function itemBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  const now = iso();
  if (w.op === "create") {
    if (!n.first_detected_at) n.first_detected_at = now;
    if (!n.last_seen_at) n.last_seen_at = n.first_detected_at;
    if (!n.times_seen) n.times_seen = 1;
    if (typeof n.host === "string") n.host = n.host.trim().toLowerCase();
  }
  if (!n.dedupe_key || w.changed.has("ci_id") || w.changed.has("vulnerability_id")) {
    const asset = n.ci_id ? `ci:${n.ci_id}` : n.host ? `host:${String(n.host).toLowerCase()}` : null;
    if (!asset) throw validationError({ ci_id: "پیکربندی یا میزبان را مشخص کنید" });
    n.dedupe_key = `${asset}|${n.vulnerability_id}`;
  }
  if (w.op !== "create" && w.changed.has("state")) {
    const from = String(w.prev?.state ?? "");
    if (n.state === "fixed") n.fixed_at = now;
    if (n.state === "closed" && !n.verified_at) n.verified_at = now;
    if (n.state === "open" && ["fixed", "closed", "false_positive"].includes(from)) {
      n.reopen_count = Number(w.prev?.reopen_count ?? 0) + 1;
      n.fixed_at = null;
      n.verified_at = null;
    }
    if (n.state === "open" && ["deferred", "exception"].includes(from)) n.exception_id = null;
  }
  const scoring = w.op === "create" || ["vulnerability_id", "ci_id", "exposure", "compensating", "first_detected_at", "state"].some((f) => w.changed.has(f));
  if (scoring) await scoreItem(w.tx, w.ctx, n, { assign: w.op === "create" || w.changed.has("ci_id") });
}

async function itemAfter(w: WriteArgs & { row: Row }): Promise<void> {
  const row = w.op === "delete" ? w.prev : w.row;
  if (!row) return;
  const ctx = w.ctx;
  const tx = w.tx;
  const watch = ["state", "remediation_id", "due_at", "vulnerability_id"];
  if (w.op !== "create" && w.op !== "delete" && !watch.some((f) => w.changed.has(f))) return;
  for (const rid of new Set([row.remediation_id, w.prev?.remediation_id].filter(isUuid))) onBeforeCommit(tx, `sec.rem:${rid}`, () => recountRemediation(tx, ctx, rid));
  for (const vid of new Set([row.vulnerability_id, w.prev?.vulnerability_id].filter(isUuid))) onBeforeCommit(tx, `sec.vul:${vid}`, () => recountVulnerability(tx, ctx, vid));
}

async function exceptionApproved(w: WriteArgs): Promise<string | null> {
  const excId = w.next.exception_id;
  if (!isUuid(excId)) return "تعویق یا استثنا فقط با یک استثنای تأییدشده ممکن است (از «استثناهای آسیب‌پذیری» درخواست کنید)";
  const exc = await liveRow(w.tx, sysOf(w.ctx), "sec_vuln_exception", excId);
  if (!exc || exc.state !== "approved") return "استثنای این مورد تأیید نشده است";
  return null;
}

async function itemDerived(p: PushArgs): Promise<Row> {
  const n = { ...p.next };
  await scoreItem(p.tx, p.ctx, n, { assign: false });
  return { risk_score: n.risk_score, risk_rating: n.risk_rating, ssvc: n.ssvc, due_at: n.due_at, overdue: n.overdue, dedupe_key: p.prev?.dedupe_key ?? n.dedupe_key };
}

async function exceptionBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  if (!n.assignment_group_id) {
    const cfg = await securityConfig(w.tx, w.ctx);
    if (cfg.vuln_group_id) n.assignment_group_id = cfg.vuln_group_id;
  }
  if (entering(w, "approved")) {
    n.approved_at = iso();
    n.approved_by = actorOf(w.ctx);
  }
}

async function exceptionValid(w: WriteArgs): Promise<string | null> {
  const n = w.next;
  if (!ids(n.items).length && !isUuid(n.vulnerability_id)) return "موردهای آسیب‌پذیر یا آسیب‌پذیری را مشخص کنید";
  if (n.kind === "not_affected" && !n.vex_justification) return "برای «متأثر نیست» توجیه VEX لازم است";
  const today = todayOf(w.ctx);
  const exp = String(n.expires_at ?? "");
  if (!exp || exp <= today) return "تاریخ انقضا باید در آینده باشد";
  if (exp > addDays(today, 366)) return "استثنا بیش از یک سال اعتبار نمی‌گیرد؛ پس از آن دوباره بررسی کنید";
  return null;
}

async function exceptionAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.op === "delete") return;
  if (entering(w, "approved")) await applyException(w.tx, w.ctx, w.row);
  if (w.op !== "create" && w.changed.has("state") && (w.row.state === "expired" || w.row.state === "revoked")) await releaseException(w.tx, w.ctx, w.row);
}

// ---------------------------------------------------------------------------------------------------------------
// GRC: requirements, controls, tests, evidence

function requirementBefore(w: WriteArgs): void {
  if (w.op === "delete") return;
  const n = w.next;
  if (typeof n.code === "string") n.code = n.code.trim();
  if (!w.trusted && w.op !== "create" && (w.changed.has("applicable") || w.changed.has("justification"))) {
    n.soa_state = "draft";
    n.soa_approved_by = null;
    n.soa_approved_at = null;
  }
  if (n.applicable === false && (w.op === "create" || w.changed.has("applicable"))) {
    n.implementation = "not_applicable";
    n.compliance = "not_applicable";
  }
}

async function requirementAfter(w: WriteArgs & { row: Row }): Promise<void> {
  const row = w.op === "delete" ? w.prev : w.row;
  if (!row) return;
  const ctx = w.ctx;
  const tx = w.tx;
  if (w.op === "create" || w.op === "delete" || w.changed.has("applicable")) {
    if (w.op !== "create" && w.op !== "delete") onBeforeCommit(tx, `grc.req:${row.id}`, () => recomputeRequirements(tx, ctx, [row.id]));
    if (isUuid(row.framework_id)) onBeforeCommit(tx, `grc.fw:${row.framework_id}`, () => recomputeFramework(tx, ctx, row.framework_id));
  }
}

function controlBefore(w: WriteArgs): void {
  if (w.op === "delete") return;
  const n = w.next;
  if (typeof n.code === "string") n.code = n.code.trim().toUpperCase() || null;
  if (!n.next_test_due || w.changed.has("frequency")) n.next_test_due = nextTestDue(n.last_tested_at ?? null, n.frequency, Date.now());
}

async function controlAfter(w: WriteArgs & { row: Row }): Promise<void> {
  const row = w.op === "delete" ? w.prev : w.row;
  if (!row) return;
  const watch = ["requirements", "implementation_status", "effectiveness", "indicator_status", "active"];
  if (w.op !== "create" && w.op !== "delete" && !watch.some((f) => w.changed.has(f))) return;
  const reqs = new Set([...ids(row.requirements), ...ids(w.prev?.requirements)]);
  const ctx = w.ctx;
  const tx = w.tx;
  for (const r of reqs) onBeforeCommit(tx, `grc.req:${r}`, () => recomputeRequirements(tx, ctx, [r]));
}

async function testBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  if (w.op === "create") {
    const ctl = await liveRow(w.tx, sysOf(w.ctx), "grc_control", n.control_id);
    if (!ctl) throw validationError({ control_id: "کنترل پیدا نشد" });
    if (!n.procedure && ctl.test_procedure) n.procedure = ctl.test_procedure;
    if (!n.assignment_group_id && ctl.assignment_group_id) n.assignment_group_id = ctl.assignment_group_id;
    if (!n.planned_for) n.planned_for = todayOf(w.ctx);
  }
  if (Number(n.sample_size ?? 0) > Number(n.population ?? Infinity)) throw validationError({ sample_size: "نمونه از جامعه بزرگ‌تر است" });
  if (Number(n.exceptions ?? 0) > Number(n.sample_size ?? Infinity)) throw validationError({ exceptions: "استثناها از نمونه بیشترند" });
  if (n.evidence_hash) {
    const h = String(n.evidence_hash).trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(h)) throw validationError({ evidence_hash: "هش SHA-256 باید ۶۴ نویسهٔ شانزده‌شانزدهی باشد" });
    n.evidence_hash = h;
  }
  if (entering(w, "completed")) n.completed_at = iso();
}

async function testAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.op === "delete" || !entering(w, "completed")) return;
  const sys = sysOf(w.ctx);
  const ctl = await liveRow(w.tx, sys, "grc_control", w.row.control_id);
  if (!ctl) return;
  const now = iso();
  await updateIn(w.tx, sys, "grc_control", ctl.id, { effectiveness: testEffectiveness(w.row.conclusion), last_tested_at: now, next_test_due: nextTestDue(now, ctl.frequency, Date.now()) }, { trusted: true, keepVersion: true });
  if (w.row.conclusion === "ineffective" || w.row.conclusion === "partially_effective") {
    const issue = await createIn(w.tx, sys, "grc_issue", {
      title: `کنترل «${String(ctl.name).slice(0, 150)}» در آزمون ${w.row.number ?? ""} ${w.row.conclusion === "ineffective" ? "ناکارآمد" : "تا حدی اثربخش"} بود`,
      source: "control_test", severity: w.row.conclusion === "ineffective" ? "high" : "medium", control_id: ctl.id, test_id: w.row.id,
      owner_id: ctl.owner_id ?? null, assignment_group_id: ctl.assignment_group_id ?? null, due_at: addDays(todayOf(w.ctx), 30),
      description: String(w.row.result_notes ?? "").slice(0, 20_000) || null,
    }, { trusted: true });
    await updateIn(w.tx, sys, "grc_control_test", w.row.id, { issue_id: issue.id }, { trusted: true, keepVersion: true, allowLocked: true });
  }
}

/** The first attachment's hash of a record (evidence packs prove what was submitted). */
export async function firstAttachmentHash(q: Queryable, orgId: string, table: string, id: string): Promise<string | null> {
  const r = await q.one<{ sha256: string }>(`select sha256 from sm_attachments where org_id = $1 and table_key = $2 and record_id = $3 and deleted_at is null order by created_at, id limit 1`, [orgId, table, id]);
  return r?.sha256 ?? null;
}

async function grcEvidenceBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  if (entering(w, "submitted")) {
    w.next.submitted_at = iso();
    w.next.sha256 = await firstAttachmentHash(w.tx, w.ctx.org.id, "grc_evidence", String(w.next.id));
  }
}

async function evidenceHasFiles(w: WriteArgs): Promise<string | null> {
  const r = await w.tx.one<{ n: string }>(`select count(*) as n from sm_attachments where org_id = $1 and table_key = 'grc_evidence' and record_id = $2 and deleted_at is null`, [w.ctx.org.id, w.next.id]);
  return Number(r?.n ?? 0) > 0 ? null : "پیش از ارسال، پروندهٔ شاهد را پیوست کنید";
}

// ---------------------------------------------------------------------------------------------------------------
// Policies, campaigns, waivers, audits, profiles, privacy

/** What people read and accept: a published policy changes them only through «ویرایش تازه» and a new approval. */
const POLICY_CONTENT = ["title", "kind", "version_label", "classification", "summary", "body", "requirements", "effective_at"];
const PUBLISHED_REFUSAL = "متن خط‌مشی منتشرشده فقط با «ویرایش تازه» و تأیید دوباره تغییر می‌کند";

/** The content fields an edit of a policy that stays published would change (null when there are none). */
function publishedContentEdit(prev: Row | null | undefined, next: Row, changedFields: Set<string>): string[] | null {
  if (prev?.state !== "published" || next.state !== "published") return null;
  const touched = POLICY_CONTENT.filter((f) => changedFields.has(f));
  return touched.length ? touched : null;
}

async function policyBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  if (w.op === "update" && w.ctx.actor !== "system") {
    const refusal = publishedContentEdit(w.prev, n, w.changed);
    if (refusal) throw validationError(Object.fromEntries(refusal.map((f) => [f, PUBLISHED_REFUSAL])));
  }
  if (entering(w, "published")) {
    const today = todayOf(w.ctx);
    const cfg = await securityConfig(w.tx, w.ctx);
    n.published_at = iso();
    n.published_by = actorOf(w.ctx);
    n.revision = Number(w.prev?.revision ?? 0) + 1;
    if (!n.effective_at) n.effective_at = today;
    n.next_review_at = addMonths(today, Number(cfg.policy_review_months) || 12);
  }
  if (w.op !== "create" && w.prev?.state === "published" && n.state === "draft") {
    const m = /^(\d+)\.(\d+)$/.exec(String(n.version_label ?? ""));
    if (m && n.version_label === w.prev?.version_label) n.version_label = `${m[1]}.${Number(m[2]) + 1}`;
  }
}

/** A policy leaving publication («ویرایش تازه» or retirement) ends its running campaigns: they were for that version. */
async function policyAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.op === "create" || w.op === "delete" || w.prev?.state !== "published" || w.row.state === "published") return;
  const sys = sysOf(w.ctx);
  const def = tableDef("grc_policy_campaign");
  const why = w.row.state === "retired" ? "خط‌مشی بازنشسته شد" : `خط‌مشی برای ویرایش تازه (نسخهٔ ${w.row.version_label ?? ""}) به پیش‌نویس برگشت`;
  for (const c of await liveRows(w.tx, sys, "grc_policy_campaign", { and: [{ f: "policy_id", op: "eq", v: w.row.id }, { f: "state", op: "eq", v: "active" }] }, { limit: 200 })) {
    const closed = await transitionIn(w.tx, sys, "grc_policy_campaign", c.id, "closed");
    if (def?.features?.journal) await addJournalIn(w.tx, sys, def, closed, { kind: "work_note", body: `${why}؛ این کارزار برای نسخهٔ ${c.version_label ?? ""} پایان یافت. پس از انتشار نسخهٔ تازه، کارزار تازه‌ای شروع کنید.` }, { trusted: true });
  }
}

function policyPublish(w: WriteArgs): string | null {
  if (w.next.approval === "rejected") return "تأییدکننده این نسخه را رد کرده است؛ آن را به پیش‌نویس برگردانید و اصلاح کنید";
  if (w.ctx.actor !== "system" && w.next.approval === "requested") return "تأیید این خط‌مشی هنوز در انتظار تأییدکننده است";
  return null;
}

async function campaignBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  if (entering(w, "active")) {
    const pol = await liveRow(w.tx, sysOf(w.ctx), "grc_policy", w.next.policy_id);
    w.next.version_label = pol?.version_label ?? null;
  }
}

async function campaignStart(w: WriteArgs): Promise<string | null> {
  const n = w.next;
  const pol = await liveRow(w.tx, sysOf(w.ctx), "grc_policy", n.policy_id);
  if (!pol || pol.state !== "published") return "کارزار فقط برای خط‌مشی منتشرشده شروع می‌شود";
  // a campaign is for one version: what people accepted stays tied to the text they read
  if (w.prev?.version_label && pol.version_label !== w.prev.version_label) return `این کارزار برای نسخهٔ ${w.prev.version_label} بود؛ برای نسخهٔ ${pol.version_label ?? ""} کارزار تازه‌ای شروع کنید`;
  if (!n.target_all && !ids(n.target_users).length && !ids(n.target_groups).length && !ids(n.target_units).length) return "مخاطبان کارزار را مشخص کنید (همه، افراد، گروه‌ها یا واحدها)";
  return null;
}

function waiverBefore(w: WriteArgs): void {
  if (w.op === "delete") return;
  if (entering(w, "approved")) w.next.approved_at = iso();
}

function waiverValid(w: WriteArgs): string | null {
  const today = todayOf(w.ctx);
  const exp = String(w.next.expires_at ?? "");
  if (!exp || exp <= today) return "تاریخ انقضا باید در آینده باشد";
  if (exp > addDays(today, 366)) return "استثنای خط‌مشی بیش از یک سال اعتبار نمی‌گیرد";
  return null;
}

async function auditBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  if (!(w.op === "create" || ["lead_auditor_id", "auditors", "auditee_owner_id", "framework_id"].some((f) => w.changed.has(f)))) return;
  const team = [...new Set([n.lead_auditor_id, ...ids(n.auditors)].filter(isUuid))];
  const conflicts = new Map<string, string>();
  if (isUuid(n.auditee_owner_id) && team.includes(n.auditee_owner_id)) conflicts.set(n.auditee_owner_id, "نمایندهٔ ممیزی‌شونده است");
  if (isUuid(n.framework_id) && team.length) {
    const sys = sysOf(w.ctx);
    const reqs = await liveRows(w.tx, sys, "grc_requirement", eqAll({ framework_id: n.framework_id }), { limit: 2000 });
    const reqIds = reqs.map((r) => r.id);
    for (const r of reqs) if (isUuid(r.owner_id) && team.includes(r.owner_id)) conflicts.set(r.owner_id, "مالک الزام‌های همین چارچوب است");
    if (reqIds.length) {
      const ctls = await liveRows(w.tx, sys, "grc_control", { and: [{ f: "requirements", op: "in", v: reqIds.slice(0, 500) }, { f: "owner_id", op: "in", v: team }] }, { limit: 50 });
      for (const c of ctls) conflicts.set(c.owner_id, `مالک کنترل «${c.name}» است`);
    }
  }
  n.independence_ok = team.length > 0 && conflicts.size === 0;
  n.independence_note = !team.length ? "تیم ممیزی هنوز مشخص نیست" : conflicts.size ? `${conflicts.size} نفر از تیم ممیزی مستقل نیستند: ${[...conflicts.values()].join("؛ ")}` : "هیچ‌یک از اعضای تیم مالک موضوع ممیزی نیست";
}

async function auditCanClose(w: WriteArgs): Promise<string | null> {
  const open = await liveRows(w.tx, sysOf(w.ctx), "grc_finding", { and: [{ f: "audit_id", op: "eq", v: w.next.id }, { f: "state", op: "in", v: ["open", "action_planned", "in_progress"] }] }, { limit: 5 });
  return open.length ? `یافته‌های باز این ممیزی هنوز اقدام نشده‌اند: ${numbers(open)}` : null;
}

function profileBefore(w: WriteArgs): void {
  if (w.op === "delete") return;
  const items = w.next.items;
  if (items !== null && items !== undefined && (typeof items !== "object" || Array.isArray(items))) throw validationError({ items: "امتیاز دسته‌ها باید یک شیء باشد" });
  for (const [code, v] of Object.entries((items ?? {}) as Record<string, Row>)) {
    for (const k of ["current", "target"]) {
      const x = v?.[k];
      if (x !== undefined && x !== null && x !== "" && !(Number.isInteger(Number(x)) && Number(x) >= 0 && Number(x) <= 4)) throw validationError({ items: `امتیاز «${code}» باید عددی از ۰ تا ۴ باشد` });
    }
  }
  const g = csfGap(items as never);
  w.next.gap_total = g.total;
  w.next.scored = g.scored;
}

function overdueOf(due: unknown, open: boolean, today: string): boolean {
  if (!open || !due) return false;
  return String(due).slice(0, 10) < today;
}

function overdueBefore(w: WriteArgs): void {
  if (w.op === "delete") return;
  w.next.overdue = overdueOf(w.next.due_at, isOpen(w.def.states, w.next.state), todayOf(w.ctx));
}

function dsrBefore(w: WriteArgs): void {
  if (w.op === "delete") return;
  const n = w.next;
  if (!n.received_at) n.received_at = iso();
  if (!n.due_at || w.changed.has("received_at")) n.due_at = new Date(Date.parse(String(n.received_at)) + 30 * 86_400_000).toISOString();
  n.overdue = isOpen(w.def.states, n.state) && Date.parse(String(n.due_at)) < Date.now();
}

// ---------------------------------------------------------------------------------------------------------------
// Risks

const ASSESSMENT = ["inherent_likelihood", "inherent_impact", "residual_likelihood", "residual_impact", "target_likelihood", "target_impact", "control_effectiveness", "controls", "treatment", "treatment_plan"];

async function riskBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  const sys = sysOf(w.ctx);
  let matrix: Row | null = isUuid(n.matrix_id) ? await liveRow(w.tx, sys, "grc_risk_matrix", n.matrix_id) : null;
  if (!matrix) {
    [matrix] = await liveRows(w.tx, sys, "grc_risk_matrix", { f: "is_default", op: "eq", v: true }, { order: "t.created_at", limit: 1 });
    if (matrix && !n.matrix_id) n.matrix_id = matrix.id;
  }
  const cells = matrix?.cells ?? null;
  const L = Number(n.inherent_likelihood);
  const I = Number(n.inherent_impact);
  n.inherent_score = riskScore(n.inherent_likelihood, n.inherent_impact);
  n.inherent_rating = riskRating(cells, n.inherent_likelihood, n.inherent_impact);
  if (n.inherent_score !== null && (!n.residual_likelihood || !n.residual_impact)) {
    const s = suggestedResidual(L, I, n.control_effectiveness ?? null);
    if (!n.residual_likelihood) n.residual_likelihood = String(s.likelihood);
    if (!n.residual_impact) n.residual_impact = String(s.impact);
  }
  n.residual_score = riskScore(n.residual_likelihood, n.residual_impact);
  n.residual_rating = riskRating(cells, n.residual_likelihood, n.residual_impact);
  n.target_score = riskScore(n.target_likelihood, n.target_impact);
  if (w.op === "create" || w.changed.has("category") || n.appetite_score === null || n.appetite_score === undefined) {
    const [ap] = await liveRows(w.tx, sys, "grc_risk_appetite", eqAll({ category: n.category }), { limit: 1 });
    n.appetite_score = ap ? Number(ap.appetite_score) : null;
  }
  n.above_appetite = isOpen(w.def.states, n.state) && aboveAppetite(n.residual_score, n.appetite_score, n.residual_rating);
  n.ale = annualLoss(n.sle, n.aro);
  if (w.op === "create") {
    if (!n.review_due) n.review_due = addMonths(todayOf(w.ctx), 6);
    if (w.ctx.actor !== "system") {
      const g = grantIn(subjectOf(w.ctx).eff, "risk");
      n.reporter_role = g.write === "all" || g.approve ? "کارکنان ریسک و انطباق" : "سایر کارکنان";
    }
  }
  if (w.ctx.actor !== "system" && (w.op === "create" || w.changed.has("state") || ASSESSMENT.some((f) => w.changed.has(f)))) {
    n.last_reviewed_at = iso();
    if (w.op !== "create" && !w.changed.has("review_due")) n.review_due = addMonths(todayOf(w.ctx), 6);
  }
}

async function acceptanceActive(w: WriteArgs): Promise<string | null> {
  const [a] = await liveRows(w.tx, sysOf(w.ctx), "grc_risk_acceptance", { and: [{ f: "risk_id", op: "eq", v: w.next.id }, { f: "state", op: "eq", v: "active" }, { f: "expires_at", op: "gte", v: todayOf(w.ctx) }] }, { limit: 1 });
  return a ? null : "پذیرش ریسک به یک «پذیرش ریسک» برقرار و تأییدشدهٔ مالک ریسک نیاز دارد";
}

async function acceptanceBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  if (w.op === "create" || w.changed.has("risk_id")) {
    const risk = await liveRow(w.tx, sysOf(w.ctx), "grc_risk", n.risk_id);
    if (!risk) throw validationError({ risk_id: "ریسک پیدا نشد" });
    if (!n.accepted_by) n.accepted_by = risk.owner_id ?? null;
    if (!n.accepted_by) throw validationError({ accepted_by: "ریسک مالک ندارد؛ نخست مالک ریسک را تعیین کنید" });
    n.residual_score = risk.residual_score ?? null;
    if (!n.assignment_group_id && risk.assignment_group_id) n.assignment_group_id = risk.assignment_group_id;
  }
  if ((w.op === "create" || w.changed.has("expires_at")) && String(n.expires_at ?? "") <= todayOf(w.ctx)) throw validationError({ expires_at: "تاریخ انقضا باید در آینده باشد" });
  if (entering(w, "active")) n.accepted_at = iso();
}

async function acceptanceByOwner(w: WriteArgs): Promise<string | null> {
  if (w.ctx.actor === "system" || w.ctx.user.id === w.next.accepted_by || (await managesArea(w.ctx, "risk"))) return null;
  return "پذیرش یا رد ریسک با مالک آن است";
}

async function acceptanceAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.op === "delete" || !(w.op === "create" ? false : w.changed.has("state"))) return;
  const sys = sysOf(w.ctx);
  const risk = await liveRow(w.tx, sys, "grc_risk", w.row.risk_id);
  if (!risk) return;
  if (w.row.state === "active" && ["assessed", "monitoring", "treatment_planned"].includes(risk.state)) await transitionIn(w.tx, sys, "grc_risk", risk.id, "accepted");
  if ((w.row.state === "expired" || w.row.state === "revoked") && risk.state === "accepted") {
    await transitionIn(w.tx, sys, "grc_risk", risk.id, "assessed");
    await addJournalIn(w.tx, sys, tableDef("grc_risk")!, risk, { kind: "work_note", body: `پذیرش ${w.row.number ?? ""} ${w.row.state === "expired" ? "منقضی" : "ابطال"} شد؛ ریسک دوباره باید ارزیابی و درمان یا پذیرفته شود.` }, { trusted: true });
  }
}

function matrixBefore(w: WriteArgs): void {
  if (w.op === "delete") return;
  const n = w.next;
  const okLabels = (v: unknown) => Array.isArray(v) && v.length >= 3 && v.length <= 7 && v.every((x) => typeof x === "string" && x.trim());
  if (!okLabels(n.likelihood_labels) || !okLabels(n.impact_labels)) throw validationError({ likelihood_labels: "برچسب‌های احتمال و اثر هر کدام ۳ تا ۷ عنوان است" });
  const L = (n.likelihood_labels as string[]).length;
  const I = (n.impact_labels as string[]).length;
  const cells = n.cells;
  const ok = Array.isArray(cells) && cells.length === L && cells.every((row) => Array.isArray(row) && row.length === I && row.every((c) => ["low", "medium", "high", "critical"].includes(String(c))));
  if (!ok) throw validationError({ cells: `رده‌ها جدولی ${L} × ${I} از low، medium، high و critical است` });
}

async function matrixAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.op === "delete" || w.row.is_default !== true || !(w.op === "create" || w.changed.has("is_default"))) return;
  const sys = sysOf(w.ctx);
  const others = await liveRows(w.tx, sys, "grc_risk_matrix", { and: [{ f: "is_default", op: "eq", v: true }, { f: "id", op: "ne", v: w.row.id }] }, { limit: 20 });
  for (const m of others) await updateIn(w.tx, sys, "grc_risk_matrix", m.id, { is_default: false }, { trusted: true });
}

function kriBefore(w: WriteArgs): void {
  if (w.op === "delete") return;
  const v = w.next.last_value;
  w.next.status = kriStatus(v === null || v === undefined || v === "" ? null : Number(v), w.next.warn_at, w.next.breach_at, w.next.direction === "lower_worse" ? "lower_worse" : "higher_worse");
}

// ---------------------------------------------------------------------------------------------------------------

let installed = false;

export function installSecurityHooks(): void {
  if (installed) return;
  installed = true;
  for (const t of SECURE_TABLES) registerHooks(t, { beforeWrite: secureBefore, derivePush: t === "sec_incident" ? sirDerived : secureDerived });
  registerHooks("sec_incident", { beforeWrite: sirBefore, afterWrite: sirAfter, guards: { sec_can_review: canReview, sec_can_close: canClose } });
  registerHooks("sec_task", { beforeWrite: taskBefore, afterWrite: taskAfter, guards: { sec_task_can_complete: canComplete } });
  registerHooks("sec_observable", { beforeWrite: observableBefore });
  registerHooks("sec_evidence", { beforeWrite: evidenceBefore, guards: { sec_evidence_release: evidenceRelease } });
  registerHooks("sec_reg_clock", { beforeWrite: clockBefore, afterWrite: clockAfter, guards: { sec_reg_all_submitted: allSubmitted } });
  registerHooks("sec_reg_regime", { beforeWrite: regimeBefore });
  registerHooks("sec_playbook", { beforeWrite: playbookBefore });
  registerHooks("sec_config", { beforeWrite: configBefore });
  registerHooks("sec_vulnerability", { beforeWrite: vulnBefore, afterWrite: vulnAfter });
  registerHooks("sec_vuln_item", { beforeWrite: itemBefore, afterWrite: itemAfter, guards: { sec_vuln_exception_approved: exceptionApproved }, derivePush: itemDerived });
  registerHooks("sec_vuln_exception", { beforeWrite: exceptionBefore, afterWrite: exceptionAfter, guards: { sec_exception_valid: exceptionValid } });

  registerHooks("grc_requirement", { beforeWrite: requirementBefore, afterWrite: requirementAfter });
  registerHooks("grc_control", { beforeWrite: controlBefore, afterWrite: controlAfter });
  registerHooks("grc_control_test", { beforeWrite: testBefore, afterWrite: testAfter });
  registerHooks("grc_evidence", { beforeWrite: grcEvidenceBefore, guards: { grc_evidence_has_files: evidenceHasFiles } });
  for (const t of ["grc_issue", "grc_finding", "grc_risk_action"]) registerHooks(t, { beforeWrite: overdueBefore });
  registerHooks("grc_policy", {
    beforeWrite: policyBefore,
    afterWrite: policyAfter,
    guards: { grc_policy_publish: policyPublish },
    // a Windows app's push is held to the same rule (hooks do not run again for it)
    validatePush: (p) => (publishedContentEdit(p.prev, p.next, p.changed) ? PUBLISHED_REFUSAL : null),
  });
  registerHooks("grc_policy_campaign", { beforeWrite: campaignBefore, guards: { grc_campaign_start: campaignStart } });
  registerHooks("grc_policy_exception", { beforeWrite: waiverBefore, guards: { sec_exception_valid: waiverValid } });
  registerHooks("grc_audit", { beforeWrite: auditBefore, guards: { grc_audit_can_close: auditCanClose } });
  registerHooks("grc_csf_profile", { beforeWrite: profileBefore });
  registerHooks("grc_dsr", { beforeWrite: dsrBefore });
  registerHooks("grc_risk", { beforeWrite: riskBefore, guards: { grc_risk_acceptance_active: acceptanceActive } });
  registerHooks("grc_risk_acceptance", { beforeWrite: acceptanceBefore, afterWrite: acceptanceAfter, guards: { grc_acceptance_by_owner: acceptanceByOwner } });
  registerHooks("grc_risk_matrix", { beforeWrite: matrixBefore, afterWrite: matrixAfter });
  registerHooks("grc_kri", { beforeWrite: kriBefore });
}

export { openStates };
