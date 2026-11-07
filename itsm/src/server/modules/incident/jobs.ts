// Reactions and background work of incident management. Everything here acts once — on the web version, or on a
// Windows app that is not linked to one (`actsHere`): a linked Windows app pushes its writes and the web version reacts
// when it applies them.
//
//   subscriber «incident»       state → resolved: queue the cascade to child incidents
//                               major_state changed: the custom events the seeded notification rules listen to
//                               (record.incident.major_proposed / _declared / _resolved / _downgraded) and, when a
//                               major incident is resolved, the review draft (settings: mi_auto_review)
//                               reassignment_count over the threshold: a note and the group manager told
//                               a reply of the requester to an incident awaiting them: back to work
//                               a public reply on a parent: copied to its open children (settings: propagate_comments)
//   job incident.cascade        resolves the open children of a resolved parent, 50 at a time
//   job incident.sweep          every 15 minutes per organisation while there is something to watch: auto-close of
//                               resolved incidents after N working days, reminders to requesters who are awaited and
//                               then resolution «بی‌پاسخ», warnings when a major incident's stakeholder update is late
import { addWorkingDays } from "@shared/incident/logic";
import { addJournalIn, defFor, emitEvent, listJournal, onRecordEvent, systemCtx, transitionIn, updateIn, type RecordEvent } from "../../engine";
import { enqueue, registerJobHandler, type JobContext } from "../../jobs";
import type { Ctx } from "../../context";
import { actsHere, notifyPeople } from "../notify";
import { countRows, eqAll, incidentConfig, isUuid, liveRow, liveRows, sysOf, type Row } from "./common";
import { draftReview, officeCalendar } from "./major";

export const SWEEP_EVERY = 15 * 60_000;
const lastSweep = new Map<string, number>();

/** Queue the organisation's sweep (at most once per ten minutes per process; one queued job per organisation). */
export async function ensureSweep(q: JobContext["db"], orgId: string): Promise<void> {
  if (Date.now() - (lastSweep.get(orgId) ?? 0) < 10 * 60_000) return;
  lastSweep.set(orgId, Date.now());
  await enqueue(q, { kind: "incident.sweep", orgId, delayMs: 60_000, dedupeKey: "incident.sweep", maxAttempts: 5 });
}

/** Forget the throttle (tests). */
export const resetSweepThrottle = () => lastSweep.clear();

const MAJOR_EVENTS: Record<string, string> = {
  proposed: "incident.major_proposed",
  accepted: "incident.major_declared",
  resolved: "incident.major_resolved",
  downgraded: "incident.major_downgraded",
};

async function onMajor(sys: Ctx, e: RecordEvent, jctx: JobContext, to: string): Promise<void> {
  const kind = MAJOR_EVENTS[to];
  if (!kind) return;
  const row = await liveRow(jctx.db, sys, "incident", e.id);
  if (!row) return;
  const users = [...new Set([...(row.stakeholders ?? []), row.mi_manager_id, row.mi_comms_id].filter(isUuid))];
  await emitEvent(jctx.db, sys, { kind: `record.${kind}`, table: "incident", id: e.id, number: e.number ?? row.number ?? null, actor: e.actor, data: { users } });
  if (to === "resolved") {
    const cfg = await incidentConfig(jctx.db, sys);
    if (cfg.mi_auto_review) {
      const author = row.mi_manager_id ?? row.assigned_to ?? e.actor ?? null;
      await draftReview(author ? await systemCtx(jctx.cfg, e.org_id, { onBehalfOf: author }) : sys, e.id);
    }
  }
}

async function onReassigned(sys: Ctx, e: RecordEvent, jctx: JobContext): Promise<void> {
  const c = e.changes?.reassignment_count;
  if (!c) return;
  const cfg = await incidentConfig(jctx.db, sys);
  const to = Number(c.to ?? 0);
  if (!cfg.reassignment_alert || to < cfg.reassignment_alert || Number(c.from ?? 0) >= cfg.reassignment_alert) return;
  await sys.write(async (tx) => {
    const row = await liveRow(tx, sys, "incident", e.id);
    if (!row) return;
    const { def } = await defFor(sys, "incident", tx);
    await addJournalIn(tx, sys, def, row, { kind: "system", visibility: "internal", body: `این رخداد ${to} بار میان گروه‌ها یا کارشناسان جابه‌جا شده است؛ برای جلوگیری از پاس‌کاری، مالک آن را مشخص کنید یا کمک بخواهید.` }, { trusted: true, author: null });
    const g = row.assignment_group_id ? await liveRow(tx, sys, "group", row.assignment_group_id) : null;
    if (isUuid(g?.manager_id)) {
      await notifyPeople(tx, e.org_id, { table: "incident", id: e.id, users: [g!.manager_id], event: "custom", label: "ارجاع‌های پیاپی", subject: "ارجاع‌های پیاپی رخداد {{record.number}}", body: `این رخداد ${to} بار ارجاع شده است.`, channels: ["in_app"], source: "رخدادها" });
    }
  });
}

async function onCommented(sys: Ctx, e: RecordEvent, jctx: JobContext): Promise<void> {
  if (!e.entry || (e.entry.kind !== "comment" && e.entry.kind !== "email_in")) return;
  const entry = (await listJournal(sys, "incident", e.id, { limit: 30 })).entries.find((x) => x.id === e.entry!.id);
  if (!entry) return;
  const row = await liveRow(jctx.db, sys, "incident", e.id);
  if (!row) return;
  // the requester answered while the incident waited for them: back to work
  if (entry.author && (entry.author === row.caller_id || entry.author === row.requested_for) && row.state === "on_hold" && row.hold_reason === "awaiting_caller") {
    await sys.write(async (tx) => {
      const { def } = await defFor(sys, "incident", tx);
      const next = await transitionIn(tx, sys, "incident", e.id, "in_progress");
      await addJournalIn(tx, sys, def, next, { kind: "system", visibility: "internal", body: "درخواست‌دهنده پاسخ داد؛ رسیدگی ادامه یافت." }, { trusted: true, author: null });
    });
  }
  // a public reply on a parent reaches the requesters of its open children
  const fromParent = !!(entry.data && typeof entry.data === "object" && (entry.data as Row).from_parent);
  if (entry.kind !== "comment" || entry.visibility !== "public" || fromParent || !entry.author) return;
  const cfg = await incidentConfig(jctx.db, sys);
  if (!cfg.propagate_comments) return;
  const kids = await liveRows(jctx.db, sys, "incident", { and: [{ f: "parent_id", op: "eq", v: e.id }, { f: "active", op: "eq", v: true }] }, { limit: 500 });
  if (!kids.length) return;
  await sys.write(async (tx) => {
    const { def } = await defFor(sys, "incident", tx);
    for (const k of kids) {
      await addJournalIn(tx, sys, def, k, { kind: "comment", body: `${entry.body}\n\n— به‌روزرسانی رخداد اصلی ${row.number}`, data: { from_parent: e.id } }, { trusted: true, author: entry.author });
    }
  });
}

async function react(e: RecordEvent, jctx: JobContext): Promise<void> {
  if (!actsHere(jctx.cfg) || !isUuid(e.org_id) || !isUuid(e.id)) return;
  await ensureSweep(jctx.db, e.org_id);
  const sys = await systemCtx(jctx.cfg, e.org_id);
  if (e.kind === "record.state_changed" && e.to === "resolved") {
    const cfg = await incidentConfig(jctx.db, sys);
    const kids = cfg.cascade_children ? await countRows(jctx.db, sys, "incident", { and: [{ f: "parent_id", op: "eq", v: e.id }, { f: "active", op: "eq", v: true }] }) : 0;
    if (kids) await enqueue(jctx.db, { kind: "incident.cascade", orgId: e.org_id, payload: { id: e.id, actor: e.actor }, dedupeKey: `incident.cascade:${e.id}` });
  }
  if (e.kind === "record.updated" && e.changes?.major_state) await onMajor(sys, e, jctx, String(e.changes.major_state.to ?? ""));
  if (e.kind === "record.updated") await onReassigned(sys, e, jctx);
  if (e.kind === "record.commented") await onCommented(sys, e, jctx);
}

// ---------------------------------------------------------------------------------------------------------------
// The cascade to child incidents

const BATCH = 50;

async function cascade(orgId: string, payload: Row, jctx: JobContext): Promise<{ again: number } | void> {
  const sys = await systemCtx(jctx.cfg, orgId, { onBehalfOf: isUuid(payload.actor) ? payload.actor : null });
  const parent = await liveRow(jctx.db, sys, "incident", payload.id);
  if (!parent || (parent.state !== "resolved" && parent.state !== "closed")) return;
  const tried = new Set<string>(Array.isArray(payload.tried) ? payload.tried : []);
  const kids = (await liveRows(jctx.db, sys, "incident", { and: [{ f: "parent_id", op: "eq", v: parent.id }, { f: "active", op: "eq", v: true }] }, { order: "t.no", limit: BATCH + tried.size }))
    .filter((k) => !tried.has(k.id))
    .slice(0, BATCH);
  for (const k of kids) {
    tried.add(k.id);
    try {
      await sys.write((tx) =>
        transitionIn(tx, sys, "incident", k.id, "resolved", {
          close_code: parent.close_code ?? "solved",
          close_notes: `همراه با رخداد اصلی ${parent.number} حل شد.${parent.close_notes ? `\n\n${parent.close_notes}` : ""}`,
          ...(parent.cause_code && !k.cause_code ? { cause_code: parent.cause_code } : {}),
        }),
      );
    } catch (err) {
      await sys.write(async (tx) => {
        const { def } = await defFor(sys, "incident", tx);
        await addJournalIn(tx, sys, def, k, { kind: "system", visibility: "internal", body: `حل همراه با رخداد اصلی ${parent.number} انجام نشد: ${(err as Error).message}` }, { trusted: true, author: null });
      }).catch(() => undefined);
    }
  }
  if (kids.length === BATCH) {
    await jctx.save({ ...payload, tried: [...tried] });
    return { again: 0 };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The sweep

export interface SweepResult {
  closed: number;
  reminded: number;
  resolved: number;
  warned: number;
  /** something is still to watch (the sweep runs again) */
  pending: boolean;
}

/** One pass over an organisation's incidents (runs as the system; also called by tests). */
export async function sweep(sys: Ctx, deadline = Number.POSITIVE_INFINITY, now = Date.now()): Promise<SweepResult> {
  const out: SweepResult = { closed: 0, reminded: 0, resolved: 0, warned: 0, pending: false };
  const cfg = await incidentConfig(sys.db, sys);
  const cal = await officeCalendar(sys.db, sys);
  const late = () => Date.now() > deadline;

  // resolved without an answer: closed after N working days
  const resolved = await liveRows(sys.db, sys, "incident", { f: "state", op: "eq", v: "resolved" }, { order: "t.resolved_at", limit: 200 });
  if (resolved.length) out.pending = true;
  if (cfg.auto_close_days > 0) {
    for (const r of resolved) {
      if (late()) break;
      if (!r.resolved_at || now < addWorkingDays(cal, Date.parse(r.resolved_at), cfg.auto_close_days)) continue;
      await sys.write(async (tx) => {
        const { def } = await defFor(sys, "incident", tx);
        const done = await transitionIn(tx, sys, "incident", r.id, "closed");
        await addJournalIn(tx, sys, def, done, { kind: "system", visibility: "public", body: `این رخداد ${cfg.auto_close_days} روز کاری پس از حل، بی‌پاسخ ماند و بسته شد.` }, { trusted: true, author: null });
      }).then(() => out.closed++, (e) => sys.cfg.log?.warn?.("incident auto-close", { id: r.id, error: (e as Error).message }));
    }
  }

  // awaiting the requester: reminders, then «بی‌پاسخ»
  const waiting = await liveRows(sys.db, sys, "incident", eqAll({ state: "on_hold", hold_reason: "awaiting_caller" }), { order: "t.hold_since", limit: 200 });
  if (waiting.length) out.pending = true;
  if (cfg.follow_up_days > 0) {
    for (const r of waiting) {
      if (late()) break;
      const since = Date.parse(r.last_follow_up_at ?? r.hold_since ?? r.updated_at);
      if (Number.isNaN(since) || now < addWorkingDays(cal, since, cfg.follow_up_days)) continue;
      const count = Number(r.follow_ups ?? 0);
      await sys.write(async (tx) => {
        const { def } = await defFor(sys, "incident", tx);
        if (cfg.follow_up_max > 0 && count >= cfg.follow_up_max) {
          await transitionIn(tx, sys, "incident", r.id, "resolved", { close_code: "no_response", close_notes: `درخواست‌دهنده پس از ${count} یادآوری پاسخی نداد.` });
          out.resolved++;
          return;
        }
        await addJournalIn(tx, sys, def, r, { kind: "comment", body: `یادآوری: برای ادامهٔ رسیدگی به «${r.short_description}» به پاسخ شما نیاز داریم؛ لطفاً در همین رخداد پاسخ دهید.` }, { trusted: true, author: null });
        await updateIn(tx, sys, "incident", r.id, { follow_ups: count + 1, last_follow_up_at: new Date(now).toISOString() }, { trusted: true, keepVersion: true });
        out.reminded++;
      }).catch((e) => sys.cfg.log?.warn?.("incident follow-up", { id: r.id, error: (e as Error).message }));
    }
  }

  // major incidents whose stakeholder update is late
  const majors = await liveRows(sys.db, sys, "incident", { f: "major_state", op: "eq", v: "accepted" }, { limit: 200 });
  if (majors.length) out.pending = true;
  for (const r of majors) {
    if (late()) break;
    const due = Date.parse(r.next_update_at ?? "");
    if (Number.isNaN(due) || now < due) continue;
    if (r.update_warned_at && Date.parse(r.update_warned_at) >= due) continue;
    const users = [...new Set([r.mi_comms_id, r.mi_manager_id].filter(isUuid))];
    await sys.write(async (tx) => {
      if (users.length) {
        await notifyPeople(tx, sys.org.id, {
          table: "incident", id: r.id, users, event: "custom", label: "دیرکرد اطلاع‌رسانی", mandatory: true,
          subject: "موعد اطلاع‌رسانی رخداد عمده {{record.number}} گذشته است", body: "به‌روزرسانی ذی‌نفعان این رخداد عمده عقب افتاده است؛ از اتاق عملیات اطلاع‌رسانی کنید.", channels: ["in_app", "email"], source: "رخداد عمده",
        });
      }
      await updateIn(tx, sys, "incident", r.id, { update_warned_at: new Date(now).toISOString() }, { trusted: true, keepVersion: true });
    }).then(() => out.warned++, (e) => sys.cfg.log?.warn?.("incident update warning", { id: r.id, error: (e as Error).message }));
  }
  return out;
}

/** The subscriber and job handlers (installed once by `installIncidentModule`). */
export function installIncidentJobs(): (() => void)[] {
  return [
    onRecordEvent("incident", react, { tables: ["incident"], kinds: ["record.updated", "record.state_changed", "record.commented", "record.created"] }),
    registerJobHandler("incident.cascade", async (job, jctx) => {
      if (!job.org_id || !actsHere(jctx.cfg)) return;
      return cascade(job.org_id, job.payload, jctx);
    }),
    registerJobHandler("incident.sweep", async (job, jctx) => {
      if (!job.org_id || !actsHere(jctx.cfg)) return;
      const sys = await systemCtx(jctx.cfg, job.org_id);
      const r = await sweep(sys, jctx.deadline);
      return r.pending ? { again: SWEEP_EVERY } : undefined;
    }),
  ];
}

export { sysOf };
