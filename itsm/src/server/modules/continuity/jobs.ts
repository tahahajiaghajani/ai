// Background work and reactions of the continuity module:
//   · a declared major incident proposes an outage of its service («پیشنهادی», linked to the incident, begin = when
//     it was detected or opened) — when the settings say so; resolving it proposes the end (the outage's `end_at`,
//     with a note: a person confirms with «پایان قطعی»)
//   · measured values of monitoring events update the capacity records that follow them (`event_match` «میزبان/سنجه»)
//   · the sweep (daily while plans or analyses exist): plans and BIAs whose review is due tell their owners once a day
import { todayISO } from "@shared/jalali";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { addJournalIn, createIn, defFor, onRecordEvent, systemCtx, updateIn, type RecordEvent } from "../../engine";
import { enqueue, registerJobHandler, type JobContext } from "../../jobs";
import { actsHere, notifyPeople } from "../notify";
import { registerEventSink } from "../event/pipeline";
import { continuityConfig, isUuid, liveRow, liveRows, orgTz, sysOf, type Row } from "./common";
import { lockedRow } from "../incident/common";

export const SWEEP_JOB = "continuity.sweep";
const lastSweep = new Map<string, number>();

export async function ensureContinuitySweep(q: JobContext["db"], orgId: string): Promise<void> {
  if (Date.now() - (lastSweep.get(orgId) ?? 0) < 6 * 3600_000) return;
  lastSweep.set(orgId, Date.now());
  await enqueue(q, { kind: SWEEP_JOB, orgId, delayMs: 5 * 60_000, dedupeKey: SWEEP_JOB, maxAttempts: 5 });
}

/** Propose the outage of a major incident (once per incident). */
export async function proposeFromIncident(tx: Tx, sys: Ctx, incident: Row, by: string | null = null): Promise<Row | null> {
  // the incident locked before its outage is looked for: the subscriber and a manager's «ثبت قطعی» at the same moment
  // make one outage (the second finds the first)
  await lockedRow(tx, sys, "incident", incident.id);
  const [existing] = await liveRows(tx, sys, "outage", { f: "incident_id", op: "eq", v: incident.id }, { limit: 1 });
  if (existing) return existing;
  const begin = incident.detected_at ?? incident.opened_at ?? incident.created_at ?? new Date().toISOString();
  const row = await createIn(tx, sys, "outage", {
    title: String(incident.short_description ?? "قطعی").slice(0, 200),
    outage_type: "outage",
    state: "proposed",
    service_id: isUuid(incident.service_id) ? incident.service_id : null,
    ci_id: isUuid(incident.ci_id) ? incident.ci_id : null,
    begin_at: begin,
    incident_id: incident.id,
    affected_users: Number(incident.affected_users ?? 0) || 0,
    owner_id: incident.mi_manager_id ?? incident.assigned_to ?? by ?? null,
    assignment_group_id: incident.assignment_group_id ?? null,
    proposed_by: "رخداد عمده",
    description: `پیشنهادشده از رخداد عمدهٔ ${incident.number ?? ""}؛ شروع، پایان و اثر را بررسی و تأیید کنید.`,
  }, { trusted: true });
  return row;
}

/** An incident was resolved: propose the end of its open outage. */
export async function proposeEnd(tx: Tx, sys: Ctx, incident: Row): Promise<boolean> {
  const [o] = await liveRows(tx, sys, "outage", { and: [{ f: "incident_id", op: "eq", v: incident.id }, { f: "state", op: "in", v: ["proposed", "ongoing"] }, { f: "end_at", op: "empty" }] }, { limit: 1 });
  if (!o) return false;
  const end = incident.resolved_at ?? new Date().toISOString();
  await updateIn(tx, sys, "outage", String(o.id), { end_at: end }, { trusted: true });
  const { def } = await defFor(sys, "outage", tx);
  await addJournalIn(tx, sys, def, o, { kind: "system", visibility: "internal", body: `رخداد ${incident.number ?? ""} حل شد؛ پایان پیشنهادی قطعی ثبت شد. با «پایان قطعی» آن را تأیید کنید.` }, { trusted: true, author: null });
  return true;
}

async function onIncident(e: RecordEvent, jctx: JobContext): Promise<void> {
  if (!actsHere(jctx.cfg) || !isUuid(e.org_id) || !isUuid(e.id)) return;
  await ensureContinuitySweep(jctx.db, e.org_id);
  const sys = await systemCtx(jctx.cfg as never, e.org_id);
  if (e.kind === "record.incident.major_declared") {
    const cfg = await continuityConfig(jctx.db, sys);
    if (!cfg.propose_on_major) return;
    await sys.write(async (tx) => {
      const incident = await liveRow(tx, sys, "incident", e.id);
      if (incident) await proposeFromIncident(tx, sys, incident, e.actor ?? null);
    });
    return;
  }
  if (e.kind === "record.state_changed" && e.to === "resolved") {
    const has = await liveRows(jctx.db, sys, "outage", { and: [{ f: "incident_id", op: "eq", v: e.id }, { f: "state", op: "in", v: ["proposed", "ongoing"] }] }, { limit: 1 });
    if (!has.length) return;
    await sys.write(async (tx) => {
      const incident = await liveRow(tx, sys, "incident", e.id);
      if (incident) await proposeEnd(tx, sys, incident);
    });
  }
}

/** Measured values of processed events → the capacity records that follow «میزبان/سنجه». */
async function capacitySink(tx: Tx, sys: Ctx, ev: Row): Promise<void> {
  if (ev.value === null || ev.value === undefined || ev.value === "" || !ev.metric) return;
  const keys = [`${String(ev.node ?? "").toLowerCase()}/${String(ev.metric).toLowerCase()}`, String(ev.metric).toLowerCase()];
  const rows = await liveRows(tx, sys, "capacity_record", { f: "event_match", op: "in", v: keys }, { limit: 10 });
  for (const r of rows) await updateIn(tx, sys, "capacity_record", String(r.id), { utilisation: String(ev.value) }, { trusted: true, keepVersion: true });
}

export interface ContinuitySweep {
  plans_due: number;
  bias_due: number;
}

/** Reviews due: plans and analyses whose review date has come tell their owners. */
export async function continuitySweep(sys: Ctx): Promise<ContinuitySweep> {
  const today = todayISO(orgTz(sys));
  const plans = await liveRows(sys.db, sys, "continuity_plan", { and: [{ f: "state", op: "in", v: ["approved", "draft", "in_review"] }, { f: "next_review_at", op: "lte", v: today }] }, { limit: 200 });
  const bias = await liveRows(sys.db, sys, "bia", { and: [{ f: "state", op: "eq", v: "approved" }, { f: "review_due", op: "lte", v: today }, { f: "is_template", op: "eq", v: false }] }, { limit: 200 });
  await sys.write(async (tx) => {
    for (const p of plans) if (isUuid(p.owner_id)) await notifyPeople(tx, sys.org.id, { table: "continuity_plan", id: String(p.id), users: [p.owner_id], event: "custom", label: "بازبینی طرح تداوم", subject: "موعد بازبینی طرح {{record.display}}", body: "موعد بازبینی دوره‌ای این طرح رسیده است.\n\n[باز کردن طرح]({{link}})", channels: ["in_app", "email"], source: "تداوم کسب‌وکار" });
    for (const b of bias) if (isUuid(b.owner_id)) await notifyPeople(tx, sys.org.id, { table: "bia", id: String(b.id), users: [b.owner_id], event: "custom", label: "بازبینی تحلیل اثر", subject: "موعد بازبینی تحلیل اثر {{record.display}}", body: "موعد بازبینی دوره‌ای این تحلیل اثر کسب‌وکار رسیده است.\n\n[باز کردن]({{link}})", channels: ["in_app"], source: "تداوم کسب‌وکار" });
  });
  return { plans_due: plans.length, bias_due: bias.length };
}

export function installContinuityJobs(): (() => void)[] {
  return [
    onRecordEvent("continuity.incidents", onIncident, { tables: ["incident"], kinds: ["record.incident.major_declared", "record.state_changed"] }),
    registerEventSink(capacitySink),
    registerJobHandler(SWEEP_JOB, async (job, jctx) => {
      if (!job.org_id || !actsHere(jctx.cfg)) return;
      const sys = await systemCtx(jctx.cfg as never, job.org_id);
      await continuitySweep(sys);
      return { again: 24 * 3600_000 };
    }),
  ];
}

export { sysOf };
