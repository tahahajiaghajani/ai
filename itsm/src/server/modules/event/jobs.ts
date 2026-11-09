// Background work of the event module:
//   event.process         the pipeline over pending events (one queued job per organisation)
//   event.escalate        one escalation round of an alert (its level timer; reschedules itself)
//   event.incident_rule   the delayed check of an alert → incident rule
//   event.sns_confirm     the confirmation of a CloudWatch/SNS subscription
//   event.sweep           every few minutes while anything waits: snoozes ending, maintenance ending, cleared alerts
//                         closing, expired page links, heartbeats of sources, correlated groups closing, retention
// Subscribers (on the runtime that acts — `actsHere` — and for alerts a Windows app pushed, on the web version):
//   · an alert that opens (created open, or back to open) starts its escalation; leaving «باز» stops it (hook)
//   · an alert that clears may resolve its incident; an incident that is resolved acknowledges its alerts
import { SEVERITY_ORDER } from "@shared/tables/event";
import { formatJalaliDateTime } from "@shared/jalali";
import type { Ctx } from "../../context";
import { onRecordEvent, orgTz, removeIn, systemCtx, transitionIn, updateIn, createIn, type RecordEvent } from "../../engine";
import { enqueue, registerJobHandler, PermanentJobError, type JobContext } from "../../jobs";
import { actsHere } from "../notify";
import { eventConfig, isUuid, liveRow, liveRows, msOf, sysOf, type Row } from "./common";
import { ESCALATE_JOB, escalateStep, expirePages, startEscalation, alertNote } from "./escalation";
import { INCIDENT_RULE_JOB, delayedIncident, incidentDone, maybeResolveIncident } from "./incidents";
import { PROCESS_JOB, SNS_JOB, confirmSns } from "./ingest";
import { processPending } from "./pipeline";
import { maintenanceFor } from "./pipeline";

export const SWEEP_JOB = "event.sweep";
export const SWEEP_EVERY = 5 * 60_000;
const lastSweep = new Map<string, number>();

/** Queue the organisation's sweep (at most once per few minutes per process; one queued per organisation). */
export async function ensureSweep(q: JobContext["db"], orgId: string): Promise<void> {
  if (Date.now() - (lastSweep.get(orgId) ?? 0) < 4 * 60_000) return;
  lastSweep.set(orgId, Date.now());
  await enqueue(q, { kind: SWEEP_JOB, orgId, delayMs: 60_000, dedupeKey: SWEEP_JOB, maxAttempts: 5 });
}

export const resetSweepThrottle = () => lastSweep.clear();

export interface SweepResult {
  unsnoozed: number;
  maintenance_ended: number;
  closed: number;
  pages_expired: number;
  heartbeats: number;
  groups_closed: number;
  pruned: number;
  pending: boolean;
}

/** The periodic work of an organisation (as the system). */
export async function sweep(sys: Ctx, deadline = Number.POSITIVE_INFINITY, now = Date.now()): Promise<SweepResult> {
  const out: SweepResult = { unsnoozed: 0, maintenance_ended: 0, closed: 0, pages_expired: 0, heartbeats: 0, groups_closed: 0, pruned: 0, pending: false };
  const cfg = await eventConfig(sys.db, sys);
  const iso = new Date(now).toISOString();
  const late = () => Date.now() > deadline;
  // snoozes that ended: back to open (the subscriber restarts the escalation)
  const snoozed = await liveRows(sys.db, sys, "alert", { and: [{ f: "state", op: "eq", v: "snoozed" }, { f: "snoozed_until", op: "lte", v: iso }] }, { limit: 100 });
  for (const a of snoozed) {
    if (late()) break;
    await sys.write(async (tx) => {
      await transitionIn(tx, sys, "alert", String(a.id), "open", {}, { trusted: true });
      await alertNote(tx, sys, a, "مهلت تعویق تمام شد؛ هشدار دوباره باز است.");
    });
    out.unsnoozed++;
  }
  // maintenance that ended for alerts still firing
  const inMaint = await liveRows(sys.db, sys, "alert", { f: "state", op: "eq", v: "maintenance" }, { limit: 200 });
  for (const a of inMaint) {
    if (late()) break;
    const m = await maintenanceFor(sys.db, sys, a, now);
    if (m) continue;
    await sys.write(async (tx) => {
      await transitionIn(tx, sys, "alert", String(a.id), "open", { maintenance_window_id: null }, { trusted: true });
      await alertNote(tx, sys, a, "نگهداری پایان یافت و هشدار هنوز رفع نشده است؛ هشدار باز شد.");
    });
    out.maintenance_ended++;
  }
  // cleared alerts close after a while
  if (cfg.auto_close_minutes > 0) {
    const before = new Date(now - cfg.auto_close_minutes * 60_000).toISOString();
    const cleared = await liveRows(sys.db, sys, "alert", { and: [{ f: "state", op: "eq", v: "cleared" }, { f: "resolved_at", op: "lte", v: before }] }, { limit: 200 });
    for (const a of cleared) {
      if (late()) break;
      await sys.write((tx) => transitionIn(tx, sys, "alert", String(a.id), "closed", { close_code: a.incident_id ? "incident" : "auto" }, { trusted: true }));
      out.closed++;
    }
  }
  // page links that expired
  out.pages_expired = await sys.write((tx) => expirePages(tx, sys, now));
  // heartbeats: a source silent for longer than its heartbeat opens an alert; its next event clears it
  const sources = await liveRows(sys.db, sys, "event_source", { and: [{ f: "active", op: "eq", v: true }, { f: "heartbeat_minutes", op: "gt", v: 0 }] }, { limit: 200 });
  for (const s of sources) {
    if (late()) break;
    const last = msOf(s.last_event_at) ?? msOf(s.created_at) ?? now;
    const silent = now - last > Number(s.heartbeat_minutes) * 60_000;
    const open = isUuid(s.heartbeat_alert_id) ? await liveRow(sys.db, sys, "alert", s.heartbeat_alert_id) : null;
    const isOpen = open && !["cleared", "closed", "suppressed"].includes(String(open.state));
    if (silent && !isOpen) {
      await sys.write(async (tx) => {
        const alert = await createIn(tx, sys, "alert", {
          short_description: `ضربان منبع «${s.name}» نرسید`,
          description: `از ${formatJalaliDateTime(new Date(last).toISOString(), orgTz(sys))} رویدادی از این منبع نرسیده است (ضربان هر ${Number(s.heartbeat_minutes).toLocaleString("fa-IR")} دقیقه).`,
          severity: "major",
          source_id: s.id,
          metric: "heartbeat",
          assignment_group_id: s.assignment_group_id ?? null,
          service_id: s.service_id ?? null,
          fingerprint: `heartbeat:${s.id}`,
        }, { trusted: true });
        await updateIn(tx, sys, "event_source", String(s.id), { heartbeat_alert_id: alert.id }, { trusted: true, keepVersion: true });
      });
      out.heartbeats++;
    } else if (!silent && isOpen) {
      await sys.write((tx) => transitionIn(tx, sys, "alert", String(open!.id), "cleared", {}, { trusted: true }));
      out.heartbeats++;
    }
  }
  // correlated groups resolved for a while close (their alerts closed)
  const groups = await liveRows(sys.db, sys, "alert_group", { and: [{ f: "state", op: "eq", v: "resolved" }, { f: "open_count", op: "eq", v: 0 }, { f: "updated_at", op: "lte", v: new Date(now - Math.max(60, cfg.auto_close_minutes) * 60_000).toISOString() }] }, { limit: 100 });
  for (const g of groups) {
    if (late()) break;
    const live = await liveRows(sys.db, sys, "alert", { and: [{ f: "group_id", op: "eq", v: g.id }, { f: "state", op: "nin", v: ["closed", "suppressed"] }] }, { limit: 1 });
    if (live.length) continue;
    await sys.write((tx) => transitionIn(tx, sys, "alert_group", String(g.id), "closed", {}, { trusted: true }));
    out.groups_closed++;
  }
  // retention of raw events (batched; the rest next time)
  const cutoff = new Date(now - cfg.retention_days * 86_400_000).toISOString();
  const old = await liveRows(sys.db, sys, "event", { and: [{ f: "received_at", op: "lt", v: cutoff }, { f: "outcome", op: "ne", v: "pending" }] }, { order: "t.received_at", limit: 300 });
  if (old.length && !late()) {
    await sys.write(async (tx) => {
      for (const e of old) await removeIn(tx, sys, "event", String(e.id), { trusted: true });
    });
    out.pruned = old.length;
  }
  // anything still waiting keeps the sweep alive
  const waiting = await liveRows(sys.db, sys, "alert", { f: "state", op: "in", v: ["snoozed", "maintenance", "cleared", "open", "acknowledged", "flapping"] }, { limit: 1 });
  out.pending = waiting.length > 0 || sources.length > 0 || old.length >= 300;
  return out;
}

async function onAlert(e: RecordEvent, jctx: JobContext): Promise<void> {
  if (!actsHere(jctx.cfg) || !isUuid(e.org_id) || !isUuid(e.id)) return;
  await ensureSweep(jctx.db, e.org_id);
  const opened = (e.kind === "record.created" || (e.kind === "record.state_changed" && e.to === "open")) && e.via !== "import";
  const cleared = e.kind === "record.state_changed" && (e.to === "cleared" || e.to === "closed");
  if (!opened && !cleared) return;
  const sys = await systemCtx(jctx.cfg as never, e.org_id);
  await sys.write(async (tx) => {
    const alert = await liveRow(tx, sys, "alert", e.id);
    if (!alert) return;
    if (opened && alert.state === "open" && alert.escalation_state !== "running") await startEscalation(tx, sys, e.id);
    if (cleared) await maybeResolveIncident(tx, sys, alert);
  });
}

async function onIncident(e: RecordEvent, jctx: JobContext): Promise<void> {
  if (!actsHere(jctx.cfg) || !isUuid(e.org_id) || !isUuid(e.id)) return;
  if (!(e.kind === "record.state_changed" && (e.to === "resolved" || e.to === "closed"))) return;
  const sys = await systemCtx(jctx.cfg as never, e.org_id);
  const alerts = await liveRows(jctx.db, sys, "alert", { and: [{ f: "incident_id", op: "eq", v: e.id }, { f: "state", op: "in", v: ["open", "flapping"] }] }, { limit: 1 });
  if (!alerts.length) return;
  await sys.write(async (tx) => {
    const incident = await liveRow(tx, sys, "incident", e.id);
    if (incident) await incidentDone(tx, sys, incident);
  });
}

export function installEventJobs(): (() => void)[] {
  return [
    onRecordEvent("event.alerts", onAlert, { tables: ["alert"], kinds: ["record.created", "record.state_changed"] }),
    onRecordEvent("event.incidents", onIncident, { tables: ["incident"], kinds: ["record.state_changed"] }),
    registerJobHandler(PROCESS_JOB, async (job, jctx) => {
      if (!job.org_id) return;
      const r = await processPending(jctx.cfg, job.org_id, jctx.deadline);
      await ensureSweep(jctx.db, job.org_id);
      return r.more ? { again: 0 } : undefined;
    }),
    registerJobHandler(ESCALATE_JOB, async (job, jctx) => {
      if (!job.org_id || !actsHere(jctx.cfg)) return;
      const p = job.payload as { alert: string; round: number; rep?: number; index?: number };
      if (!isUuid(p.alert)) throw new PermanentJobError("هشدار نامعتبر");
      const sys = await systemCtx(jctx.cfg as never, job.org_id);
      const r = await escalateStep(sys, p.alert, Number(p.round), Number(p.rep ?? 0), Number(p.index ?? 0));
      if (r.again !== undefined) {
        await jctx.save({ ...p, rep: r.rep ?? p.rep ?? 0, index: r.index ?? p.index ?? 0 });
        return { again: Math.max(1000, r.again) };
      }
    }),
    registerJobHandler(INCIDENT_RULE_JOB, async (job, jctx) => {
      if (!job.org_id || !actsHere(jctx.cfg)) return;
      const sys = await systemCtx(jctx.cfg as never, job.org_id);
      await delayedIncident(sys, String(job.payload.alert), String(job.payload.rule));
    }),
    registerJobHandler(SNS_JOB, async (job, jctx) => {
      if (!job.org_id) return;
      await confirmSns(jctx.cfg as never, String(job.payload.url ?? ""));
    }),
    registerJobHandler(SWEEP_JOB, async (job, jctx) => {
      if (!job.org_id || !actsHere(jctx.cfg)) return;
      const sys = await systemCtx(jctx.cfg as never, job.org_id);
      const r = await sweep(sys, jctx.deadline);
      return r.pending ? { again: SWEEP_EVERY } : undefined;
    }),
  ];
}

export { SEVERITY_ORDER, sysOf };
export type { Row };
