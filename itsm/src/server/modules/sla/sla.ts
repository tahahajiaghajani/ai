// The SLA engine (docs/spec/services/sla.md §3). For every write of a record whose table has SLA definitions, the
// engine reconciles the record's task SLAs with the definitions — inside the write's transaction, on every write path
// (API, imports, flows, jobs; a Windows app's own writes on the Windows app, never again when the cloud applies the
// push):
//
//   no timer of a definition yet  + start condition (and its scope)        → attach (retroactive start from a field)
//   live timer + cancel condition                                          → canceled
//   live timer + reset condition                                           → canceled, and a new one attached
//   live timer + stop condition                                            → achieved, or breached when overdue
//   live timer + pause condition on / off                                  → paused / resumed (pauses do not count)
//   live timer + its target changed (priority)                             → repaired: duration and deadline recomputed
//
// The record's `sla_due` follows the earliest deadline of its running timers. Timers are computed lazily on read
// (`meta.sla` on the record page, the timeline endpoint) and by the job `sla.timer` (one per timer, deduplicated),
// which records the highest warning threshold reached and the breach exactly once — by updating the timer row under
// a lock in the same transaction that emits `record.sla_warning` / `record.sla_breach` and runs the breach actions.
// A Windows app linked to the cloud leaves warnings and breaches to the cloud (its timers travel there).
import type { CondEnv } from "@shared/model/conditions";
import type { TableDef } from "@shared/model/types";
import { addBusiness, businessBetween, type BusinessCalendar } from "@shared/sla/calendar";
import { dueEvents, evaluateTimer, isLive, targetSeconds, warnLevels, type TimerRow, type TimerState } from "@shared/sla/timer";
import { isTimeZone } from "@shared/constants";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import type { JobConfig } from "../../jobs";
import { enqueue, registerJobHandler } from "../../jobs";
import {
  addJournalIn, createIn, emitEvent, listHistory, loadReadable, onRecordEvent, orgSchema, orgTz, registerHooks, registerRecordMeta, requireReadable, systemCtx,
  updateIn, condEnv, defFor, type WriteArgs,
} from "../../engine";
import { calendarFor } from "./calendars";
import { config, eqAll, holds, liveRows, ownTable, systemFrom, withWalks, type Row, type ServiceConfig } from "./common";

const SEC = 1000;
const iso = (ms: number | null | undefined) => (ms === null || ms === undefined || !Number.isFinite(ms) ? null : new Date(ms).toISOString());
const msOf = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? null : t;
};

/** Definitions (live rows, active or not) of a table. */
const definitionsOf = (cfg: ServiceConfig, table: string): Row[] => cfg.rows.sla_definition.filter((d) => d.table_key === table);

// ---------------------------------------------------------------------------------------------------------------
// Planning (beforeWrite) and applying (afterWrite)

interface PlanItem {
  /** an existing timer to update, or a new one to create */
  id?: string;
  values: Row;
  /** a stop found the timer overdue though no job had recorded the breach yet: announce it */
  lateBreach?: boolean;
  /** when the timer's job should look next (null: it waits for a write) */
  next: number | null;
}

const plans = new WeakMap<Tx, Map<string, PlanItem[]>>();
const planKey = (table: string, id: string) => `${table}:${id}`;

/** Scope of a definition: workspace, service, customer (the record's unit within the customer's unit tree). */
async function inScope(q: Queryable, d: Row, row: Row): Promise<boolean> {
  if (d.active === false) return false;
  if (d.workspace_id && d.workspace_id !== row.workspace_id) return false;
  if (d.service_id && d.service_id !== row.service_id) return false;
  if (d.customer_unit_id) {
    if (!row.unit_id) return false;
    if (row.unit_id === d.customer_unit_id) return true;
    const u = await q.one<{ path: string | null }>(`select path from sm_org_units where id = $1 and org_id = $2`, [row.unit_id, row.org_id]);
    return !!u?.path && u.path.includes(`/${d.customer_unit_id}/`);
  }
  return true;
}

/** The calendar and time zone a new timer of `d` uses for `row`. */
async function timerZone(q: Queryable, ctx: Ctx, d: Row, def: TableDef, row: Row): Promise<{ calendarId: string | null; tz: string | null }> {
  const cfg = await config(q, ctx);
  const cal = d.calendar_id ? cfg.rows.calendar.find((c) => c.id === d.calendar_id && c.active !== false) : null;
  const calendarId = cal ? String(cal.id) : null;
  let tz: string | null = cal?.timezone ?? orgTz(ctx);
  const source = String(d.timezone_source ?? "calendar");
  if (source === "org") tz = orgTz(ctx);
  else if (source === "caller") {
    const who = (def.scope.requester ?? []).map((f) => row[f]).find((v) => typeof v === "string" && v);
    if (who) {
      const p = await q.one<{ timezone: string | null }>(`select timezone from sm_member_profiles where org_id = $1 and user_id = $2 and deleted_at is null`, [ctx.org.id, who]).catch(() => null);
      if (p?.timezone && isTimeZone(p.timezone)) tz = p.timezone;
    }
  } else if (source === "location" && row.location_id) {
    const l = await q.one<{ timezone: string | null }>(`select timezone from sm_locations where id = $1 and org_id = $2 and deleted_at is null`, [row.location_id, ctx.org.id]).catch(() => null);
    if (l?.timezone && isTimeZone(l.timezone)) tz = l.timezone;
  }
  return { calendarId, tz };
}

/** Working seconds of a span (rounded). */
const secs = (ms: number) => Math.round(ms / SEC);

/** The snapshot columns of a timer state. */
function snapshot(t: TimerState, now: number): Row {
  return { business_elapsed: secs(t.elapsedMs), percent: t.percent.toFixed(2), computed_at: iso(now) };
}

/** Next instant a job should look at a timer (null when paused or done). */
function nextLook(row: TimerRow & { warned?: number | null }, cal: BusinessCalendar | null, levels: number[], now: number): number | null {
  const due = dueEvents(row, cal, levels, now);
  if (due.state.done || due.state.paused) return null;
  if (due.warn !== null || due.breach) return now;
  return due.next;
}

async function planFor(w: WriteArgs): Promise<void> {
  if (w.op === "delete" || ownTable(w.def.key) || w.def.virtual) return;
  const cfg = await config(w.tx, w.ctx);
  const defs = definitionsOf(cfg, w.def.key);
  if (!defs.length) return;
  const now = Date.now();
  const sys = systemFrom(w.ctx);
  const schema = await orgSchema(sys, w.tx);
  const id = String(w.next.id);
  const timers = w.prev ? await liveRows(w.tx, sys, "task_sla", eqAll({ table_key: w.def.key, record_id: id }), "t.start_at, t.created_at, t.id") : [];
  const env: CondEnv = { ...w.env, prev: w.prev, now };
  const conds = defs.flatMap((d) => [d.start_condition, d.pause_condition, d.stop_condition, d.reset_condition, d.cancel_condition]);
  const row = await withWalks(w.tx, w.def, w.ctx.org.id, { ...w.next, org_id: w.ctx.org.id }, conds, env, schema.lookup);
  const on = (c: unknown, empty: boolean) => holds(c, row, env, w.def, schema.lookup, empty);
  const items: PlanItem[] = [];
  /** the state each timer will have after this write (for sla_due) */
  const after = new Map<string, Row>(timers.map((t) => [t.id, t]));

  for (const d of defs) {
    const levels = warnLevels(d.warn_percents);
    const mine = timers.filter((t) => t.definition_id === d.id && t.stage !== "canceled");
    const current = mine[mine.length - 1] ?? null;
    const live = !!current && isLive(current as TimerRow);
    const attach = async () => {
      if (!(await inScope(w.tx, d, row)) || !on(d.start_condition, true)) return;
      const target = targetSeconds(d, row);
      if (!target) return;
      const zone = await timerZone(w.tx, w.ctx, d, w.def, row);
      const cal = await calendarFor(w.tx, w.ctx, zone.calendarId, zone.tz);
      const retro = d.retroactive && d.retroactive_field ? msOf(row[d.retroactive_field]) : null;
      const start = retro !== null && retro <= now ? retro : now;
      const values: Row = {
        name: d.name, definition_id: d.id, table_key: w.def.key, record_id: id, type: d.type ?? "sla", target: d.target ?? "resolution",
        stage: "in_progress", active: true, breached: false, start_at: iso(start), duration: target, paused_total: 0, warned: 0,
        calendar_id: zone.calendarId, timezone: zone.tz,
      };
      if (on(d.pause_condition, false)) Object.assign(values, { stage: "paused", pause_started_at: iso(now) });
      let t = evaluateTimer(values as TimerRow, cal, now);
      values.planned_end_at = iso(values.pause_started_at ? addBusiness(cal, start, target * SEC) : t.plannedEnd);
      if (on(d.stop_condition, false)) {
        const stopped = stopValues(values, cal, now);
        Object.assign(values, stopped.values);
        items.push({ values, next: null, lateBreach: stopped.breached });
        return;
      }
      t = evaluateTimer(values as TimerRow, cal, now);
      Object.assign(values, snapshot(t, now));
      items.push({ values, next: nextLook(values as TimerRow, cal, levels, now) });
    };

    if (live) {
      const cal = await calendarFor(w.tx, w.ctx, current.calendar_id, current.timezone);
      if (on(d.cancel_condition, false)) {
        const values = { ...cancelValues(current, cal, now) };
        items.push({ id: current.id, values, next: null });
        after.set(current.id, { ...current, ...values });
        continue;
      }
      if (on(d.reset_condition, false)) {
        const values = cancelValues(current, cal, now);
        items.push({ id: current.id, values, next: null });
        after.set(current.id, { ...current, ...values });
        await attach();
        continue;
      }
      if (on(d.stop_condition, false)) {
        const stopped = stopValues(current, cal, now);
        items.push({ id: current.id, values: stopped.values, next: null, lateBreach: stopped.breached && !current.breached });
        after.set(current.id, { ...current, ...stopped.values });
        continue;
      }
      const values: Row = {};
      let state: Row = { ...current };
      const pause = on(d.pause_condition, false);
      if (pause && !current.pause_started_at) {
        const t = evaluateTimer(state as TimerRow, cal, now);
        Object.assign(values, { pause_started_at: iso(now), stage: "paused", ...snapshot(t, now) });
      } else if (!pause && current.pause_started_at) {
        const pausedMs = businessBetween(cal, msOf(current.pause_started_at)!, now);
        const total = Number(current.paused_total ?? 0) + secs(pausedMs);
        Object.assign(values, { pause_started_at: null, paused_total: total, stage: current.breached ? "breached" : "in_progress" });
      }
      state = { ...state, ...values };
      // the target follows the record (a priority change): the timer is repaired as if it had always had it
      const target = targetSeconds(d, row);
      if (target && target !== Number(current.duration)) {
        values.duration = target;
        state.duration = target;
        const t = evaluateTimer({ ...state, breached: false, stage: state.pause_started_at ? "paused" : "in_progress" } as TimerRow, cal, now);
        if (current.breached && t.elapsedMs < target * SEC) Object.assign(values, { breached: false, breached_at: null, stage: state.pause_started_at ? "paused" : "in_progress" });
        values.warned = Math.max(0, ...levels.filter((p) => p <= t.percent));
        state = { ...state, ...values };
      }
      if (Object.keys(values).length) {
        if (!state.pause_started_at) values.planned_end_at = iso(addBusiness(cal, msOf(state.start_at)!, (Number(state.duration) + Number(state.paused_total ?? 0)) * SEC));
        Object.assign(values, snapshot(evaluateTimer({ ...state, ...values } as TimerRow, cal, now), now));
        items.push({ id: current.id, values, next: nextLook({ ...state, ...values } as TimerRow, cal, levels, now) });
        after.set(current.id, { ...state, ...values });
      }
      continue;
    }
    // no live timer: attach the first one, or a new one when the reset condition holds after one ended
    if (!current || on(d.reset_condition, false)) await attach();
  }

  // the record's deadline: the earliest of its running timers
  if (w.def.fields.some((f) => f.name === "sla_due")) {
    const ends = [...after.values(), ...items.filter((x) => !x.id).map((x) => x.values)]
      .filter((t) => isLive(t as TimerRow) && !t.pause_started_at && t.planned_end_at)
      .map((t) => msOf(t.planned_end_at)!)
      .filter((x) => x !== null);
    const due = ends.length ? iso(Math.min(...ends)) : null;
    if ((msOf(w.next.sla_due) ?? null) !== (msOf(due) ?? null)) w.next.sla_due = due;
  }
  if (!items.length) return;
  let m = plans.get(w.tx);
  if (!m) plans.set(w.tx, (m = new Map()));
  m.set(planKey(w.def.key, id), items);
}

function cancelValues(current: Row, cal: BusinessCalendar | null, now: number): Row {
  const closed = closePause(current, cal, now);
  const t = evaluateTimer({ ...current, ...closed, stop_at: iso(now), active: false, stage: "canceled" } as TimerRow, cal, now);
  return { ...closed, stage: "canceled", active: false, stop_at: iso(now), ...snapshot(t, now) };
}

function closePause(current: Row, cal: BusinessCalendar | null, now: number): Row {
  if (!current.pause_started_at) return {};
  const pausedMs = businessBetween(cal, msOf(current.pause_started_at)!, now);
  return { pause_started_at: null, paused_total: Number(current.paused_total ?? 0) + secs(pausedMs) };
}

/** A timer stopped at `now`: achieved, or breached when its target was used up. */
function stopValues(current: Row, cal: BusinessCalendar | null, now: number): { values: Row; breached: boolean } {
  const closed = closePause(current, cal, now);
  const state = { ...current, ...closed };
  const running = evaluateTimer({ ...state, stage: "in_progress", breached: false } as TimerRow, cal, now);
  const breached = !!current.breached || (running.durationMs > 0 && running.elapsedMs >= running.durationMs);
  const planned = msOf(current.planned_end_at) ?? addBusiness(cal, msOf(state.start_at)!, (Number(state.duration) + Number(state.paused_total ?? 0)) * SEC);
  const values: Row = {
    ...closed,
    stage: breached ? "breached" : "achieved",
    active: false,
    breached,
    stop_at: iso(now),
    planned_end_at: iso(planned),
    ...snapshot(running, now),
  };
  if (breached && !current.breached_at) values.breached_at = iso(planned ?? now);
  return { values, breached };
}

/** Write the planned timer changes of a record (afterWrite, same transaction) and schedule their jobs. */
async function applyPlan(w: WriteArgs & { row: Row }): Promise<void> {
  const m = plans.get(w.tx);
  const key = planKey(w.def.key, String(w.row.id));
  const items = m?.get(key);
  if (!items) return;
  m!.delete(key);
  const sys = systemFrom(w.ctx);
  const number = w.def.numbered ? (w.row.number ?? null) : null;
  for (const it of items) {
    const values = { ...it.values, ...(it.id ? {} : { record_number: number }) };
    const stored = it.id ? await updateIn(w.tx, sys, "task_sla", it.id, values, { trusted: true }) : await createIn(w.tx, sys, "task_sla", values, { trusted: true });
    if (it.next !== null) await schedule(w.tx, w.ctx.org.id, stored.id, it.next);
    if (it.lateBreach) await announceBreach(w.tx, sys, w.def, w.row, stored, { atStop: true });
  }
}

/** Queue (or bring forward) the job that looks at timer `id` at `at`. */
export async function schedule(q: Queryable, orgId: string, id: string, at: number): Promise<void> {
  const runAt = new Date(Math.max(at, Date.now())).toISOString();
  const jobId = await enqueue(q, { kind: "sla.timer", orgId, payload: { id }, runAt, dedupeKey: `sla.timer:${id}`, maxAttempts: 10 });
  await q.query(`update sm_jobs set run_at = least(run_at, $2::timestamptz), updated_at = now() where id = $1 and status = 'queued'`, [jobId, runAt]);
}

// ---------------------------------------------------------------------------------------------------------------
// Warnings and breaches (job)

function eventData(t: Row, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    task_sla_id: t.id, definition_id: t.definition_id, name: t.name, type: t.type, target: t.target, stage: t.stage,
    start_at: t.start_at, planned_end_at: t.planned_end_at, percent: Number(t.percent ?? 0), ...extra,
  };
}

/** Emit `record.sla_breach` for timer `t` of `record` (and run the definition's breach actions unless it stopped). */
async function announceBreach(tx: Tx, sys: Ctx, def: TableDef, record: Row, t: Row, opts: { atStop?: boolean } = {}): Promise<void> {
  const cfg = await config(tx, sys);
  const d = cfg.rows.sla_definition.find((x) => x.id === t.definition_id);
  const actions: Row[] = Array.isArray(d?.breach_actions) ? d!.breach_actions : [];
  const notify = actions.filter((a) => a?.type === "notify").map((a) => ({ users: a.users ?? [], groups: a.groups ?? [], fields: a.fields ?? [], roles: a.roles ?? [], message: a.message ?? null }));
  await emitEvent(tx, sys, {
    kind: "record.sla_breach", table: def.key, id: String(record.id), number: def.numbered ? (record.number ?? null) : null, actor: null,
    data: eventData(t, { breached_at: t.breached_at, at_stop: !!opts.atStop, notify }),
  });
  if (opts.atStop) return;
  // breach actions: escalate, set fields, reassign (one write of the record); notify travels with the event
  const values: Row = {};
  for (const a of actions) {
    if (!a || typeof a !== "object") continue;
    if (a.type === "escalate" && def.fields.some((f) => f.name === "escalation")) {
      values.escalation = Number.isFinite(Number(a.level)) && a.level !== null && a.level !== undefined && a.level !== "" ? Number(a.level) : Math.min(10, Number(values.escalation ?? record.escalation ?? 0) + 1);
    } else if (a.type === "set" && typeof a.field === "string" && def.fields.some((f) => f.name === a.field && !f.system && !f.base)) {
      values[a.field] = a.value ?? null;
    } else if (a.type === "reassign") {
      const group = def.scope.group;
      if (group && a.group_id) values[group] = a.group_id;
      if (def.fields.some((f) => f.name === "assigned_to") && (a.user_id || a.group_id)) values.assigned_to = a.user_id ?? null;
    }
  }
  if (def.features?.journal) {
    await addJournalIn(tx, sys, def, record, { kind: "system", visibility: "internal", body: `توافق «${t.name}» نقض شد.`, data: { sla: t.id, event: "breach" } }, { trusted: true });
  }
  if (Object.keys(values).length) await updateIn(tx, sys, def.key, String(record.id), values, { trusted: true });
}

/** Is this a Windows app linked to the cloud (which then fires warnings and breaches)? */
async function linkedDesktop(cfg: JobConfig): Promise<boolean> {
  if (cfg.mode !== "desktop" || !cfg.desktop?.syncStatus) return false;
  const s = await cfg.desktop.syncStatus().catch(() => null);
  return !!s && (s as { linked?: unknown }).linked === true;
}

/**
 * Timer `id` and its record, both locked for the transaction — the record first, then the timer: the order every write
 * of the record takes (its write locks it, then plans and writes its timers). A change of the record in flight (a new
 * priority and target, a resolution) finishes first and this reads the timer as that write left it; two timers of one
 * record breaching at once take turns on the record, so the second one's actions see the first one's (escalation + 1
 * twice, never the same level written twice).
 */
async function lockTimer(tx: Tx, sys: Ctx, tdef: TableDef, id: string, env: CondEnv): Promise<{ def: TableDef | null; record: Row | null; t: Row | null }> {
  const peek = await loadReadable(tx, sys, tdef, id, env);
  if (!peek) return { def: null, record: null, t: null };
  const schema = await orgSchema(sys, tx);
  const found = schema.def(String(peek.table_key));
  const def = found && !found.virtual ? found : null;
  const record = def ? await loadReadable(tx, sys, def, String(peek.record_id), env, { lock: true }) : null;
  const t = await loadReadable(tx, sys, tdef, id, env, { lock: true });
  return { def, record, t };
}

/** Look at timer `id` now: record the highest warning reached and the breach (once), return when to look again. */
export async function fireTimer(sys: Ctx, id: string): Promise<number | null> {
  return sys.write(async (tx) => {
    const { def: tdef } = await defFor(sys, "task_sla", tx);
    const env = await condEnv(sys);
    const { def, record, t } = await lockTimer(tx, sys, tdef, id, env);
    if (!t || !isLive(t as TimerRow)) return null;
    const cfg = await config(tx, sys);
    const d = cfg.rows.sla_definition.find((x) => x.id === t.definition_id);
    const levels = warnLevels(d?.warn_percents);
    const cal = await calendarFor(tx, sys, t.calendar_id, t.timezone);
    const now = Date.now();
    const due = dueEvents(t as TimerRow, cal, levels, now);
    const values: Row = { ...snapshot(due.state, now) };
    if (due.state.running && due.state.plannedEnd !== null) values.planned_end_at = iso(due.state.plannedEnd);
    if (due.warn !== null) values.warned = due.warn;
    if (due.breach) {
      values.breached = true;
      values.breached_at = iso(due.state.plannedEnd !== null && due.state.plannedEnd <= now ? due.state.plannedEnd : now);
      if (!due.state.paused) values.stage = "breached";
    }
    const stored = await updateIn(tx, sys, "task_sla", id, values, { trusted: true, keepVersion: true });
    if (def && record) {
      if (due.warn !== null) {
        await emitEvent(tx, sys, { kind: "record.sla_warning", table: def.key, id: String(record.id), number: def.numbered ? (record.number ?? null) : null, actor: null, data: eventData(stored, { threshold: due.warn }) });
      }
      if (due.breach) await announceBreach(tx, sys, def, record, stored);
    }
    return due.next;
  });
}

/** Recompute the deadlines of the organisation's live timers (a calendar or its holidays changed). */
async function recalc(sys: Ctx, deadline: number, after: string | null): Promise<string | null> {
  const rows = await liveRows(sys.db, sys, "task_sla", { f: "active", op: "eq", v: true }, "t.id");
  const todo = rows.filter((r) => !after || r.id > after);
  for (const r of todo) {
    if (Date.now() > deadline) return r.id;
    await sys.write(async (tx) => {
      // the record, then the timer, locked and read again (the list above is only the candidates)
      const { def: tdef } = await defFor(sys, "task_sla", tx);
      const { t: cur } = await lockTimer(tx, sys, tdef, String(r.id), await condEnv(sys));
      if (!cur || cur.active !== true) return;
      const cal = await calendarFor(tx, sys, cur.calendar_id, cur.timezone);
      const now = Date.now();
      const t = evaluateTimer(cur as TimerRow, cal, now);
      if (!t.running || t.plannedEnd === null) return;
      if (msOf(cur.planned_end_at) !== t.plannedEnd) await updateIn(tx, sys, "task_sla", cur.id, { planned_end_at: iso(t.plannedEnd), ...snapshot(t, now) }, { trusted: true, keepVersion: true });
      await schedule(tx, sys.org.id, cur.id, now);
    });
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Reading: meta.sla and the timeline

export interface TimerView {
  id: string;
  label: string;
  definition_id: string;
  type: string;
  target: string;
  stage: string;
  state: "in_progress" | "paused" | "achieved" | "breached" | "canceled";
  start_at: string | null;
  due_at: string | null;
  stop_at: string | null;
  paused: boolean;
  breached: boolean;
  met: boolean;
  percent: number;
  remaining_ms: number | null;
  elapsed_ms: number;
  duration_ms: number;
}

function view(t: Row, s: TimerState): TimerView {
  const stage = String(t.stage);
  const state = stage === "canceled" ? "canceled" : s.done ? (s.breached ? "breached" : "achieved") : s.paused ? "paused" : s.breached ? "breached" : "in_progress";
  return {
    id: t.id, label: t.name, definition_id: t.definition_id, type: t.type, target: t.target, stage, state,
    start_at: t.start_at, due_at: iso(s.plannedEnd), stop_at: t.stop_at ?? null, paused: s.paused, breached: s.breached, met: state === "achieved",
    percent: Math.round(s.percent * 10) / 10, remaining_ms: s.remainingWallMs, elapsed_ms: s.elapsedMs, duration_ms: s.durationMs,
  };
}

/** The timers of a record as the record page shows them (`meta.sla`; canceled ones left out). */
export async function recordTimers(q: Queryable, ctx: Ctx, table: string, id: string, opts: { canceled?: boolean } = {}): Promise<{ row: Row; view: TimerView }[]> {
  const sys = systemFrom(ctx);
  const rows = await liveRows(q, sys, "task_sla", eqAll({ table_key: table, record_id: id }), "t.start_at, t.created_at, t.id");
  const now = Date.now();
  const out: { row: Row; view: TimerView }[] = [];
  for (const r of rows) {
    if (r.stage === "canceled" && !opts.canceled) continue;
    const cal = await calendarFor(q, ctx, r.calendar_id, r.timezone);
    out.push({ row: r, view: view(r, evaluateTimer(r as TimerRow, cal, now)) });
  }
  return out;
}

export interface TimelineEvent {
  at: string;
  kind: "start" | "pause" | "resume" | "warning" | "breach" | "stop" | "cancel" | "repair";
  label: string;
  detail?: string;
  by?: string | null;
}

/** GET /sla/records/:table/:id — every timer of a readable record with its events (pauses, warnings, breach, stop). */
export async function slaTimeline(ctx: Ctx, table: string, id: string): Promise<{ timers: (TimerView & { events: TimelineEvent[] })[] }> {
  const { def } = await defFor(ctx, table);
  await requireReadable(ctx, def, id, await condEnv(ctx));
  const sys = systemFrom(ctx);
  const timers = await recordTimers(ctx.db, ctx, table, id, { canceled: true });
  const out: (TimerView & { events: TimelineEvent[] })[] = [];
  for (const { row, view: v } of timers) {
    const events: TimelineEvent[] = [{ at: String(row.start_at), kind: "start", label: "شروع" }];
    const hist = await listHistory(sys, "task_sla", row.id, { limit: 500 }).catch(() => ({ entries: [] as { field: string; old: unknown; new: unknown; at: string; actor: string | null }[] }));
    for (const h of hist.entries) {
      if (h.field === "stage") {
        if (h.new === "paused") events.push({ at: h.at, kind: "pause", label: "توقف موقت" });
        else if (h.old === "paused" && (h.new === "in_progress" || h.new === "breached")) events.push({ at: h.at, kind: "resume", label: "ادامه" });
        else if (h.new === "achieved") events.push({ at: String(row.stop_at ?? h.at), kind: "stop", label: "در موعد انجام شد" });
        else if (h.new === "canceled") events.push({ at: String(row.stop_at ?? h.at), kind: "cancel", label: "لغو" });
      } else if (h.field === "warned" && Number(h.new) > Number(h.old ?? 0)) {
        events.push({ at: h.at, kind: "warning", label: `هشدار ${Number(h.new)}٪`, detail: String(h.new) });
      } else if (h.field === "breached" && h.new === true) {
        events.push({ at: String(row.breached_at ?? h.at), kind: "breach", label: "نقض" });
      } else if (h.field === "duration" && h.old !== null && h.old !== undefined) {
        events.push({ at: h.at, kind: "repair", label: "بازمحاسبهٔ هدف", detail: `${h.old} → ${h.new}` });
      }
    }
    if (row.stop_at && row.stage === "breached" && !events.some((e) => e.kind === "stop")) events.push({ at: String(row.stop_at), kind: "stop", label: "پایان پس از موعد" });
    events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    out.push({ ...v, events });
  }
  return { timers: out };
}

// ---------------------------------------------------------------------------------------------------------------
// Installation

/** Hooks, meta, jobs and subscribers of the SLA engine; `plan` must run after the other rules (installed last). */
export function installSlaEngine(): { apply: () => void; plan: () => void; rest: () => void } {
  return {
    // afterWrite first: the timers are written before rules that write the record again
    apply: () => void registerHooks("*", { afterWrite: (w) => applyPlan(w) }),
    // beforeWrite last: the plan sees the values every other rule set
    plan: () => void registerHooks("*", { beforeWrite: (w) => planFor(w) }),
    rest: () => {
      registerRecordMeta("*", async ({ q, ctx, def, row }) => {
        if (ownTable(def.key) || def.virtual) return null;
        const cfg = await config(q, ctx);
        if (!definitionsOf(cfg, def.key).length) return null;
        const timers = await recordTimers(q, ctx, def.key, String(row.id));
        return timers.length ? { sla: timers.map((t) => t.view) } : null;
      });
      // calendars and holidays move deadlines: recompute the live timers' deadlines
      for (const table of ["calendar", "holiday"]) {
        registerHooks(table, {
          async afterWrite(w) {
            await enqueue(w.tx, { kind: "sla.recalc", orgId: w.ctx.org.id, dedupeKey: "sla.recalc", delayMs: 5_000 });
          },
        });
      }
      registerJobHandler("sla.timer", async (job, jctx) => {
        if (!job.org_id || !job.payload?.id) return;
        if (await linkedDesktop(jctx.cfg)) return;
        const sys = await systemCtx(jctx.cfg, job.org_id);
        const next = await fireTimer(sys, String(job.payload.id));
        if (next !== null) return { again: Math.max(1000, next - Date.now()) };
      });
      registerJobHandler("sla.recalc", async (job, jctx) => {
        if (!job.org_id) return;
        const sys = await systemCtx(jctx.cfg, job.org_id);
        const left = await recalc(sys, jctx.deadline - 500, (job.payload?.after as string) ?? null);
        if (left) {
          await jctx.save({ ...job.payload, after: left });
          return { again: 0 };
        }
      });
      // the cloud applying a Windows app's timers: it fires their warnings and breaches from now on
      onRecordEvent("sla.synced-timers", async (e, jctx) => {
        if (e.via !== "sync" || jctx.cfg.mode !== "cloud") return;
        await enqueue(jctx.db, { kind: "sla.timer", orgId: e.org_id, payload: { id: e.id }, dedupeKey: `sla.timer:${e.id}`, maxAttempts: 10 });
      }, { tables: ["task_sla"], kinds: ["record.created", "record.updated"] });
    },
  };
}

