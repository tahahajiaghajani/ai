// The SLA service's part in flows (docs/spec/services/flows.md §8, docs/spec/SERVICES.md), installed with the service
// (`installSlaService()` → `installSlaFlowSteps()`):
//
// - «درخواست تأیید» (`approval`) asks through the approvals service: an ad-hoc round of the record the step is about
//   (`requestApprovalIn`, inside the step's transaction) with the people, user fields and groups of «تأییدکنندگان»
//   and the rule any / all / count. The step waits with key "approval:<id>" — <id> is the round's first approval row
//   (the smallest id) — and the decision wakes it: `record.approval_decided` (and, for decisions applied from the
//   other runtime, withdrawals and expiries, the approval rows' own `record.updated`) → `resumeFlowWait`; an hourly
//   timer re-reads the round in case a decision arrived without its event (rows pulled from the cloud by the Windows
//   app). A round withdrawn before its rule was met (the record was closed, someone withdrew the request) fails the
//   step; a run canceled while it waits withdraws its round. Runs without a record keep the built-in approval.
// - «انتظار زمانی» «به وقت کاری» counts working time with `addBusiness` on the organisation's default calendar (or
//   the one named): its hours and the holidays of its sets (the Iranian official ones by default); no calendar: 24 × 7.
import { addBusiness } from "@shared/sla/calendar";
import { roundOutcome, type ApprovalRule } from "@shared/sla/approvals";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { onRecordEvent, orgTz, systemCtx, type RecordEvent } from "../../engine";
import type { JobContext } from "../../jobs";
import {
  aboutRecord, builtinStepHandler, recipients, registerFlowStepHandler, resumeFlowWait, setFlowBusinessClock,
  type BusinessClock, type FlowStepHandler, type StepContext, type WaitInfo,
} from "../flows";
import { cancelApprovals, requestApprovalIn } from "./approvals";
import { calendarsOf } from "./calendars";
import { config, eqAll, liveRow, liveRows, systemFrom, type Row } from "./common";

const OPEN = new Set(["requested", "waiting"]);
const WITHDRAWN = new Set(["canceled", "no_longer_required"]);
const RULES: readonly ApprovalRule[] = ["any", "all", "count"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** waits of the flow engine's built-in approval (`approval:flow:<run>:<step>`) */
const STAND_IN = "approval:flow:";
/** how often a waiting step re-reads its round (the safety net for decisions whose event did not come here) */
const POLL_MS = 3_600_000;

/** The key a flow waits on for an ad-hoc round of approvals: "approval:" + its first row (the smallest id). */
export const roundKey = (rows: readonly Record<string, unknown>[]): string => `approval:${rows.map((r) => String(r.id)).sort()[0]}`;

const isStandIn = (w: Pick<WaitInfo, "key">) => String(w.key ?? "").startsWith(STAND_IN);
const msOf = (v: unknown) => (v ? Date.parse(String(v)) || 0 : 0);

/**
 * What the rows of an ad-hoc round add up to for the flow waiting on it: the decision (port `approved` / `rejected`)
 * with who decided last and every decision, a withdrawal (port `error`), or null while it is still open.
 */
export function roundResult(rows: readonly Row[]): Record<string, unknown> | null {
  // withdrawn rows count as still asked: a round that closed before its rule was met was withdrawn, not decided
  const outcome = roundOutcome(rows.map((r) => (WITHDRAWN.has(r.state) ? { ...r, state: "requested" } : r)) as never[]);
  const decided = rows.filter((r) => r.state === "approved" || r.state === "rejected").sort((a, b) => msOf(a.decided_at) - msOf(b.decided_at));
  const decisions = decided.map((r) => ({ by: r.decided_by ?? null, on_behalf_of: r.delegated_from ?? null, decision: r.state, comment: r.comments ?? "", at: r.decided_at ?? null }));
  if (outcome === "approved" || outcome === "rejected") {
    const last = decided.filter((r) => r.state === outcome).pop();
    return { port: outcome, decision: outcome, by: last?.decided_by ?? null, comment: last?.comments ?? "", decisions };
  }
  if (rows.some((r) => OPEN.has(r.state))) return null;
  return { port: "error", decision: "withdrawn", error: "درخواست تأیید پیش از تصمیم پس گرفته شد (رکورد بسته شد یا درخواست لغو شد)", decisions };
}

/** The live rows of an ad-hoc round of a record. */
async function adhocRound(q: Queryable, sys: Ctx, table: string, recordId: string, round: number): Promise<Row[]> {
  const rows = await liveRows(q, sys, "approval", eqAll({ table_key: table, record_id: recordId }), "t.level, t.id");
  return rows.filter((r) => !r.rule_id && (Number(r.round) || 1) === round);
}

/** The round of a waiting step as it stands now (its timer woke it without a result). */
async function recheck(s: StepContext, w: WaitInfo): Promise<Record<string, unknown> | null> {
  const { table, record, round } = w.data as { table?: unknown; record?: unknown; round?: unknown };
  if (typeof table !== "string" || typeof record !== "string") return null;
  const rows = await adhocRound(s.tx!, systemFrom(s.ctx), table, record, Number(round) || 1);
  return rows.length ? roundResult(rows) : { port: "error", decision: "withdrawn", error: "درخواست تأیید دیگر وجود ندارد", decisions: [] };
}

/** «درخواست تأیید» through the approvals service. */
export const approvalStep: FlowStepHandler = {
  transactional: true,
  async run(s) {
    const about = aboutRecord(s);
    if (!about) {
      // approvals belong to records: a run without one keeps the built-in approval (decided on the run's page)
      const standIn = builtinStepHandler("approval");
      return standIn ? standIn.run(s) : { error: "درخواست تأیید به رکوردی نیاز دارد" };
    }
    const c = s.node.config;
    const to = await recipients(s, c.approvers);
    if (!to.users.length && !to.groups.length) return { error: "تأییدکننده‌ای پیدا نشد" };
    const rule = RULES.includes(c.rule as ApprovalRule) ? (c.rule as ApprovalRule) : "any";
    const title = s.text(c.title).trim().slice(0, 120) || "درخواست تأیید";
    const message = s.text(c.message).trim().slice(0, 4000);
    const r = await requestApprovalIn(s.tx!, s.ctx, about.table, about.id, {
      users: to.users,
      groups: to.groups,
      rule,
      threshold: rule === "count" ? Math.max(1, Math.trunc(Number(c.threshold ?? 2)) || 1) : null,
      name: title,
      comment: message || null,
    });
    const approvers = [...new Set(r.approvals.filter((a) => OPEN.has(a.state) && a.approver_id).map((a) => String(a.approver_id)))];
    return {
      wait: { kind: "approval", key: roundKey(r.approvals), dueAt: Date.now() + POLL_MS, data: { table: about.table, record: about.id, round: r.round, rule, title, message } },
      output: { approvers, approval_ids: r.approvals.map((a) => a.id), round: r.round, record: about },
    };
  },
  async resume(s, w) {
    if (isStandIn(w)) return builtinStepHandler("approval")!.resume!(s, w);
    const r = w.result ?? (await recheck(s, w));
    if (!r) return { wait: { kind: w.kind, key: w.key, dueAt: Date.now() + POLL_MS, data: w.data } };
    // a decision without a comment keeps the request's message on its row: that is not the approver's comment
    const message = String(w.data.message ?? "");
    const comment = (v: unknown) => (typeof v === "string" && v !== message ? v : "");
    const decisions = (Array.isArray(r.decisions) ? (r.decisions as Record<string, unknown>[]) : []).map((d) => ({ ...d, comment: comment(d.comment) }));
    if (r.port === "error") return { error: String(r.error ?? "درخواست تأیید پس گرفته شد"), output: { decision: "withdrawn", decisions } };
    const decision = r.decision === "approved" ? "approved" : "rejected";
    return { port: decision, output: { decision, by: r.by ?? null, comment: comment(r.comment), decisions } };
  },
  async cancel(a) {
    if (isStandIn(a.wait)) return;
    const { table, record, round } = a.wait.data as { table?: unknown; record?: unknown; round?: unknown };
    if (typeof table !== "string" || typeof record !== "string" || !(Number(round) > 0)) return;
    await cancelApprovals(await systemCtx(a.cfg, a.orgId), table, record, { adhocRound: Number(round) });
  },
};

/** Wake the flow waiting on an ad-hoc round once the round is decided or withdrawn (a person's own round: no-op). */
async function settleRound(jctx: JobContext, orgId: string, table: string, recordId: string, round: number): Promise<void> {
  const rows = await adhocRound(jctx.db, await systemCtx(jctx.cfg, orgId), table, recordId, round);
  if (!rows.length) return;
  const result = roundResult(rows);
  if (result) await jctx.db.tx((tx) => resumeFlowWait(tx, orgId, roundKey(rows), result));
}

async function onDecided(e: RecordEvent, jctx: JobContext): Promise<void> {
  const d = e.data ?? {};
  // a rule's round: no flow asked for it
  if (d.rule_id || !UUID.test(e.org_id) || !UUID.test(e.id)) return;
  await settleRound(jctx, e.org_id, e.table, e.id, Number(d.round) || 1);
}

async function onApprovalRow(e: RecordEvent, jctx: JobContext): Promise<void> {
  if (!e.changed?.includes("state") || !UUID.test(e.org_id)) return;
  const row = await liveRow(jctx.db, await systemCtx(jctx.cfg, e.org_id), "approval", e.id);
  if (!row || row.rule_id) return;
  await settleRound(jctx, e.org_id, String(row.table_key), String(row.record_id), Number(row.round) || 1);
}

/** Working time on the organisation's calendars. */
export const slaBusinessClock: BusinessClock = {
  async add({ cfg, orgId, from, ms, calendarId }) {
    const sys = await systemCtx(cfg, orgId);
    const { byId, defaultId } = calendarsOf(await config(cfg.db, sys), orgTz(sys));
    const id = calendarId && byId.has(calendarId) ? calendarId : defaultId;
    const due = addBusiness(id ? byId.get(id)! : null, from, ms);
    if (due === null) throw new Error("تقویم کاری سازمان ساعت کاری ندارد؛ مدت «به وقت کاری» شمرده نمی‌شود");
    return due;
  },
};

/** Plug approvals and working time into flows (once per process, from `installSlaService`). */
export function installSlaFlowSteps(): void {
  registerFlowStepHandler("approval", approvalStep);
  setFlowBusinessClock(slaBusinessClock);
  onRecordEvent("sla.flow_approvals", onDecided, { kinds: ["record.approval_decided"] });
  onRecordEvent("sla.flow_approval_rows", onApprovalRow, { tables: ["approval"], kinds: ["record.updated"] });
}
