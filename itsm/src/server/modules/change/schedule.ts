// The risk of a change and its place in the schedule: the risk engine's inputs (applicable questions, the team's
// success score), windows and their occurrences, what blocks scheduling (blackouts, freezes, lockdowns), conflict
// detection with statuses kept by key, and the scheduling assistant's free slots. Pure parts live in
// @shared/change/logic; this file reads the organisation's rows (through the access rule) and writes conflict rows.
import {
  applicableQuestions, businessDaysBetween, computeRisk, conflictState, detectConflicts, findSlots, leadDaysFor, localParts, lockdownApplies, occurrences, scopeOf, scopedWindow,
  windowApplies, CONFLICTING_STATES, type ConflictFound, type LockdownLike, type Occurrence, type RiskQuestion, type RiskResult, type WindowLike,
} from "@shared/change/logic";
import { evaluate, type Cond } from "@shared/model/conditions";
import { addDays } from "@shared/jalali";
import { midnightOf, shiftsOf } from "@shared/sla/calendar";
import type { ChangeConfig } from "@shared/tables/change";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { condEnv, createIn, emitEvent, get, orgSchema, orgTz, updateIn } from "../../engine";
import { slaConfig } from "../sla";
import { calendarsOf } from "../sla/calendars";
import type { BusinessCalendar } from "@shared/sla/calendar";
import { changeConfig, eqAll, iso, liveRow, liveRows, modelLike, modelOf, msOf, riskQuestions, sysOf, type Row } from "./common";
import { relatedCisOf } from "./impact";

// ---------------------------------------------------------------------------------------------------------------
// Conditions on a change

/** An evaluator of conditions on a change row (as the system; walks into other records are not followed). */
export async function holdsOn(q: Queryable, ctx: Ctx, row: Row): Promise<(c: Cond) => boolean> {
  const sys = sysOf(ctx);
  const schema = await orgSchema(sys, q);
  const def = schema.def("change_request")!;
  const env = await condEnv(sys);
  return (c: Cond) => {
    try {
      return evaluate(c, row, env, def, schema.lookup);
    } catch {
      return false;
    }
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Risk

/** The team's current change success score (null when it has none yet). */
export async function teamScoreOf(q: Queryable, ctx: Ctx, groupId: unknown): Promise<number | null> {
  if (typeof groupId !== "string" || !groupId) return null;
  const [r] = await liveRows(q, sysOf(ctx), "change_success_score", eqAll({ group_id: groupId }), { limit: 1 });
  return r && r.score !== null && r.score !== undefined ? Number(r.score) : null;
}

/** The risk of a change row under the organisation's questionnaire and bands. */
export async function riskFor(q: Queryable, ctx: Ctx, row: Row, cfg: ChangeConfig): Promise<{ result: RiskResult; questions: RiskQuestion[] }> {
  const holds = await holdsOn(q, ctx, row);
  const questions = applicableQuestions(await riskQuestions(q, ctx), row, holds);
  const result = computeRisk({ change: row, questions, answers: row.risk_answers, teamScore: await teamScoreOf(q, ctx, row.assignment_group_id), bands: cfg });
  return { result, questions };
}

// ---------------------------------------------------------------------------------------------------------------
// Windows

export const windowLike = (r: Row): WindowLike => ({
  id: String(r.id),
  name: String(r.name ?? ""),
  kind: String(r.kind ?? "maintenance"),
  active: r.active !== false,
  start_at: r.start_at,
  end_at: r.end_at,
  recurrence: r.recurrence ?? "none",
  weekdays: Array.isArray(r.weekdays) ? r.weekdays : [],
  until: r.until ?? null,
  enforcement: r.enforcement ?? "block",
  exempt_emergency: r.exempt_emergency !== false,
  change_types: Array.isArray(r.change_types) ? r.change_types : [],
  services: Array.isArray(r.services) ? r.services : [],
  cis: Array.isArray(r.cis) ? r.cis : [],
  scope_condition: r.scope_condition ?? null,
});

export const lockdownLike = (r: Row): LockdownLike => ({
  id: String(r.id), title: String(r.title ?? ""), number: r.number ?? null, starts_at: r.starts_at, ends_at: r.ends_at ?? null,
  services: Array.isArray(r.services) ? r.services : [], cis: Array.isArray(r.cis) ? r.cis : [], scope_condition: r.scope_condition ?? null,
});

/** Active windows of the organisation (as the system). */
export const activeWindows = (q: Queryable, ctx: Ctx): Promise<Row[]> => liveRows(q, sysOf(ctx), "change_window", { f: "active", op: "eq", v: true }, { order: "t.kind, t.start_at" });

/** Every occurrence of the active windows in [from, to). */
export async function occurrencesBetween(q: Queryable, ctx: Ctx, from: number, to: number): Promise<(Occurrence & { window: Row })[]> {
  const tz = orgTz(ctx);
  const out: (Occurrence & { window: Row })[] = [];
  for (const w of await activeWindows(q, ctx)) for (const o of occurrences(windowLike(w), from, to, tz)) out.push({ ...o, window: w });
  return out.sort((a, b) => a.start - b.start);
}

/** Active lockdowns (started, not ended). */
export async function activeLockdowns(q: Queryable, ctx: Ctx, at = Date.now()): Promise<Row[]> {
  const rows = await liveRows(q, sysOf(ctx), "change_lockdown", { f: "state", op: "eq", v: "active" }, { order: "t.starts_at" });
  return rows.filter((l) => (msOf(l.starts_at) ?? 0) <= at && (msOf(l.ends_at) === null || msOf(l.ends_at)! > at));
}

/** What forbids scheduling or implementing a change now: blocking blackout/freeze occurrences in its window, lockdowns. */
export async function scheduleBlocks(q: Queryable, ctx: Ctx, row: Row): Promise<{ windows: Occurrence[]; warnings: Occurrence[]; lockdowns: Row[] }> {
  const holds = await holdsOn(q, ctx, row);
  const lockdowns = (await activeLockdowns(q, ctx)).filter((l) => lockdownApplies(lockdownLike(l), row, holds));
  const s = msOf(row.planned_start);
  const e = msOf(row.planned_end);
  if (s === null || e === null || e <= s) return { windows: [], warnings: [], lockdowns };
  const tz = orgTz(ctx);
  const windows: Occurrence[] = [];
  const warnings: Occurrence[] = [];
  for (const w of await activeWindows(q, ctx)) {
    if (w.kind !== "blackout" && w.kind !== "freeze") continue;
    const wl = windowLike(w);
    if (!windowApplies(wl, row, holds)) continue;
    for (const o of occurrences(wl, s, e, tz)) (o.enforcement === "warn" ? warnings : windows).push(o);
  }
  return { windows, warnings, lockdowns };
}

// ---------------------------------------------------------------------------------------------------------------
// Conflicts

/** The conflicts of a change in its planned window (nothing without a window). */
export async function detectFor(q: Queryable, ctx: Ctx, row: Row, cfg: ChangeConfig): Promise<ConflictFound[]> {
  const s = msOf(row.planned_start);
  const e = msOf(row.planned_end);
  if (s === null || e === null || e <= s) return [];
  const sys = sysOf(ctx);
  const tz = orgTz(ctx);
  const others = await liveRows(
    q, sys, "change_request",
    { and: [{ f: "state", op: "in", v: CONFLICTING_STATES }, { f: "planned_start", op: "lt", v: iso(e) }, { f: "planned_end", op: "gt", v: iso(s) }] },
    { order: "t.planned_start", limit: 500 },
  );
  const holds = await holdsOn(q, ctx, row);
  const occs: (Occurrence & { scoped: boolean; applies: boolean })[] = [];
  const maintenanceWindows: { id: string; name: string; scoped: boolean; applies: boolean }[] = [];
  for (const w of await activeWindows(q, ctx)) {
    const wl = windowLike(w);
    const applies = windowApplies(wl, row, holds);
    if (wl.kind === "maintenance") maintenanceWindows.push({ id: String(wl.id), name: String(wl.name ?? ""), scoped: scopedWindow(wl), applies });
    // a maintenance occurrence must contain the whole window: look a day around it (the windows themselves say
    // whether the change is bound to one at all)
    for (const o of occurrences(wl, s - 86_400_000, e + 86_400_000, tz)) occs.push({ ...o, scoped: scopedWindow(wl), applies });
  }
  const lockdowns = (await activeLockdowns(q, ctx)).map((l) => ({ ...lockdownLike(l), applies: lockdownApplies(lockdownLike(l), row, holds) }));
  const related = cfg.related_ci_conflicts ? await relatedCisOf(q, sys, scopeOf(row).cis) : undefined;
  return detectConflicts({ change: row, others, occurrences: occs, maintenanceWindows, lockdowns, related, tzDate: (ms) => localParts(ms, tz).date });
}

/** States in which a change's conflicts are kept up to date. */
export const CONFLICT_TRACKED = ["new", "assess", "authorize", "scheduled", "implement"];

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null) || (msOf(a) !== null && msOf(a) === msOf(b));

/** What a change's conflict detection decided: the conflicts found, the stored rows, and the change's flags. */
export interface ConflictPlan {
  found: ConflictFound[];
  existing: Row[];
  /** other changes to check again: tracked changes sharing the window and scope, and those whose conflicts name this one */
  neighbours: string[];
  flags: { conflict_status: string; conflict_count: number; conflict_checked_at: string; in_blackout: boolean; outside_window: boolean };
}

/**
 * Plan a change's conflicts (reads only, so a hook may call it before the row is stored): what is found now, the rows
 * stored before (their reviews survive by key), and the flags the change gets — status, open count, blackout and
 * window flags. A change no longer tracked (implemented, closed) keeps its status and finds nothing.
 */
export async function planConflicts(q: Queryable, ctx: Ctx, row: Row): Promise<ConflictPlan> {
  const sys = sysOf(ctx);
  const tracked = CONFLICT_TRACKED.includes(String(row.state));
  const found = tracked ? await detectFor(q, sys, row, await changeConfig(q, sys)) : [];
  const existing = row.id ? await liveRows(q, sys, "change_conflict", eqAll({ change_id: String(row.id) })) : [];
  const byKey = new Map(existing.map((r) => [String(r.key), r]));
  const rows = found.map((f) => ({ active: true, status: byKey.get(f.key)?.status ?? "detected" }));
  const st = conflictState(rows);
  return {
    found,
    existing,
    neighbours: row.id ? await neighboursOf(q, sys, row) : [],
    flags: {
      conflict_status: tracked ? st.status : (row.conflict_status ?? "not_checked"),
      conflict_count: st.open,
      conflict_checked_at: iso(Date.now()),
      in_blackout: found.some((f) => f.kind === "blackout" || f.kind === "freeze"),
      outside_window: found.some((f) => f.kind === "outside_window"),
    },
  };
}

/**
 * Changes another write of `row` may affect: tracked changes (drafts too — they see the changes they collide with)
 * overlapping its planned window on a shared CI, service or implementer, and the changes whose conflicts name it.
 */
async function neighboursOf(q: Queryable, sys: Ctx, row: Row): Promise<string[]> {
  const out = new Set<string>();
  for (const r of await liveRows(q, sys, "change_conflict", { and: [{ f: "other_change_id", op: "eq", v: String(row.id) }, { f: "active", op: "eq", v: true }] }, { limit: 500 })) out.add(String(r.change_id));
  const s = msOf(row.planned_start);
  const e = msOf(row.planned_end);
  if (s !== null && e !== null && e > s) {
    const mine = scopeOf(row);
    const near = await liveRows(q, sys, "change_request", { and: [{ f: "state", op: "in", v: CONFLICT_TRACKED }, { f: "planned_start", op: "lt", v: iso(e) }, { f: "planned_end", op: "gt", v: iso(s) }] }, { limit: 500 });
    for (const o of near) {
      if (o.id === row.id) continue;
      const theirs = scopeOf(o);
      if (mine.cis.some((x) => theirs.cis.includes(x)) || mine.services.some((x) => theirs.services.includes(x)) || (!!row.assigned_to && o.assigned_to === row.assigned_to)) out.add(String(o.id));
    }
  }
  out.delete(String(row.id));
  return [...out];
}

/**
 * Store a plan's conflict rows: a conflict found before keeps its review (status, justification) by its key; one no
 * longer found stays with `active: false` (its review survives when it comes back). Returns the other changes
 * involved before or now, and how many conflicts are new (announced with `record.change.conflict_detected`).
 */
export async function storeConflicts(tx: Tx, ctx: Ctx, row: Row, plan: ConflictPlan): Promise<{ others: string[]; added: number; open: number }> {
  const sys = sysOf(ctx);
  const id = String(row.id);
  const byKey = new Map(plan.existing.map((r) => [String(r.key), r]));
  const now = iso(Date.now());
  const people = { assignment_group_id: row.assignment_group_id ?? null, assigned_to: row.assigned_to ?? null, change_owner_id: row.change_owner_id ?? null };
  let added = 0;
  for (const f of plan.found) {
    const values: Row = {
      summary: f.summary.slice(0, 300), kind: f.kind, other_change_id: f.other_change_id ?? null, window_id: f.window_id ?? null, lockdown_id: f.lockdown_id ?? null,
      ci_id: f.ci_id ?? null, service_id: f.service_id ?? null, overlap_start: iso(f.overlap_start), overlap_end: iso(f.overlap_end), active: true, ...people,
    };
    const prev = byKey.get(f.key);
    if (prev) {
      byKey.delete(f.key);
      if (Object.entries(values).some(([k, v]) => !same(prev[k], v))) await updateIn(tx, sys, "change_conflict", prev.id, values, { trusted: true, keepVersion: true });
    } else {
      await createIn(tx, sys, "change_conflict", { change_id: id, key: f.key, status: "detected", detected_at: now, ...values }, { trusted: true });
      added++;
    }
  }
  for (const stale of byKey.values()) if (stale.active !== false) await updateIn(tx, sys, "change_conflict", stale.id, { active: false }, { trusted: true, keepVersion: true });
  if (added) {
    const users = [row.change_owner_id, row.assigned_to, row.change_manager_id].filter((x): x is string => typeof x === "string" && !!x);
    await emitEvent(tx, sys, { kind: "record.change.conflict_detected", table: "change_request", id, number: row.number ?? null, actor: null, data: { users: [...new Set(users)], count: added } });
  }
  const others = new Set<string>();
  for (const f of plan.found) if (f.other_change_id) others.add(f.other_change_id);
  for (const r of plan.existing) if (r.other_change_id) others.add(String(r.other_change_id));
  for (const n of plan.neighbours) others.add(n);
  others.delete(id);
  return { others: [...others], added, open: plan.flags.conflict_count };
}

/** Detect a stored change's conflicts again, store them and bring its flags in step (jobs, «بررسی دوباره»). */
export async function recomputeConflicts(tx: Tx, ctx: Ctx, id: string): Promise<{ others: string[]; added: number; open: number }> {
  const sys = sysOf(ctx);
  const row = await liveRow(tx, sys, "change_request", id);
  if (!row) return { others: [], added: 0, open: 0 };
  const plan = await planConflicts(tx, sys, row);
  const r = await storeConflicts(tx, sys, row, plan);
  const patch: Row = plan.flags;
  if (Object.entries(patch).some(([k, v]) => k !== "conflict_checked_at" && !same(row[k], v)) || !row.conflict_checked_at) {
    await updateIn(tx, sys, "change_request", id, patch, { trusted: true, keepVersion: true });
  }
  return r;
}

/** Bring a change's conflict status and open count in step with its conflict rows (after a person's review). */
export async function syncConflictState(tx: Tx, ctx: Ctx, changeId: string): Promise<void> {
  const sys = sysOf(ctx);
  const row = await liveRow(tx, sys, "change_request", changeId);
  if (!row) return;
  const st = conflictState(await liveRows(tx, sys, "change_conflict", eqAll({ change_id: changeId })));
  const status = CONFLICT_TRACKED.includes(String(row.state)) ? st.status : (row.conflict_status ?? "not_checked");
  if (status !== row.conflict_status || st.open !== Number(row.conflict_count ?? 0)) {
    await updateIn(tx, sys, "change_request", changeId, { conflict_status: status, conflict_count: st.open }, { trusted: true, keepVersion: true });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Lead time and free slots

/** The organisation's default working calendar (null: none, 24 × 7). */
export async function defaultCalendar(q: Queryable, ctx: Ctx): Promise<BusinessCalendar | null> {
  const cfg = await slaConfig(q, sysOf(ctx));
  const cals = calendarsOf(cfg, orgTz(ctx));
  return cals.defaultId ? (cals.byId.get(cals.defaultId) ?? null) : null;
}

/** Working days from `from` to the change's planned start on the default calendar (null without a start). */
export async function leadDays(q: Queryable, ctx: Ctx, plannedStart: unknown, from = Date.now()): Promise<number | null> {
  const s = msOf(plannedStart);
  if (s === null) return null;
  const cal = await defaultCalendar(q, ctx);
  if (!cal) return Math.max(0, Math.floor((s - from) / 86_400_000));
  return businessDaysBetween(cal, from, s);
}

/** The start of the `days`-th working day after `from`'s day on the default calendar (`from` itself for 0 days). */
export async function earliestStart(q: Queryable, ctx: Ctx, days: number, from: number): Promise<number> {
  if (days <= 0) return from;
  const tz = orgTz(ctx);
  const cal = await defaultCalendar(q, ctx);
  let d = localParts(from, tz).date;
  let n = 0;
  for (let guard = 0; guard < 400 && n < days; guard++) {
    d = addDays(d, 1);
    if (!cal || shiftsOf(cal, d).length) n++;
  }
  return Math.max(from, midnightOf(d, tz));
}

/**
 * The scheduling assistant (catalogue CHG-049, deterministic part): slots of the change's planned duration inside the
 * maintenance windows of its CIs and services (any time when it has none), after the notice its risk needs, outside
 * blackouts, freezes and the windows of other changes on the same CIs, services or implementer.
 */
export async function slotsFor(ctx: Ctx, id: string, opts: { days?: number; limit?: number } = {}): Promise<{ duration: number; earliest: string; slots: { start: string; end: string }[] }> {
  const { row } = await get(ctx, "change_request", id);
  const q = ctx.db;
  const sys = sysOf(ctx);
  const cfg = await changeConfig(q, sys);
  const s = msOf(row.planned_start);
  const e = msOf(row.planned_end);
  const duration = s !== null && e !== null && e > s ? e - s : 2 * 3_600_000;
  const model = modelLike(await modelOf(q, sys, row));
  const exempt = !!model?.lead_time_exempt || ["emergency", "standard", "latent"].includes(String(row.type));
  const earliest = await earliestStart(q, ctx, exempt ? 0 : leadDaysFor(row.risk, cfg), Date.now());
  const until = earliest + Math.max(1, Math.min(90, opts.days ?? 21)) * 86_400_000;
  const tz = orgTz(ctx);
  const holds = await holdsOn(q, ctx, row);
  const allowed: [number, number][] = [];
  let scoped = false;
  const blocked: [number, number][] = [];
  for (const w of await activeWindows(q, ctx)) {
    const wl = windowLike(w);
    const applies = windowApplies(wl, row, holds);
    if (w.kind === "maintenance") {
      if (w.id === row.maintenance_window_id || (scopedWindow(wl) && applies)) {
        scoped = true;
        for (const o of occurrences(wl, earliest, until, tz)) allowed.push([o.start, o.end]);
      }
    } else if ((w.kind === "blackout" || w.kind === "freeze") && applies) {
      for (const o of occurrences(wl, earliest, until, tz)) blocked.push([o.start, o.end]);
    }
  }
  const mine = scopeOf(row);
  const others = await liveRows(q, sys, "change_request", { and: [{ f: "state", op: "in", v: CONFLICTING_STATES }, { f: "planned_end", op: "gt", v: iso(earliest) }, { f: "planned_start", op: "lt", v: iso(until) }] }, { limit: 1000 });
  for (const o of others) {
    if (o.id === row.id) continue;
    const theirs = scopeOf(o);
    const shared = mine.cis.some((x) => theirs.cis.includes(x)) || mine.services.some((x) => theirs.services.includes(x)) || (!!row.assigned_to && o.assigned_to === row.assigned_to);
    const os = msOf(o.planned_start);
    const oe = msOf(o.planned_end);
    if (shared && os !== null && oe !== null) blocked.push([os, oe]);
  }
  const slots = findSlots({ duration, earliest, until, allowed: scoped ? allowed : null, blocked, limit: opts.limit ?? 5 });
  return { duration, earliest: iso(earliest), slots: slots.map(([a, b]) => ({ start: iso(a), end: iso(b) })) };
}
