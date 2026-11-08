// Background work of change enablement:
//   · change.conflicts   conflicts of one change again (the changes a write met, before or after it)
//   · change.recheck     conflicts of every change still to come (a window or a lockdown changed)
//   · change.sweep       every 15 minutes while the organisation has changes in flight:
//       – «شروع پنجره» reminders before a scheduled change starts and overrun alerts of implementations past their end
//       – review auto-close and stale-draft cancellation (when the settings ask for them)
//       – lockdowns whose end passed are released
//       – the next meeting of every CAB with a weekly schedule, and its agenda
//       – change-caused incidents (links «ناشی از» from incidents) counted on the changes (CHG-054)
//       – once a day: the teams' change success scores (CHG-022)
// Alerts are events (`record.change.window_starting`, `record.change.overrun`) the seeded notification rules name;
// the sweep runs on the runtime that acts for the organisation (`actsHere`: the cloud when a Windows app is linked).
import { successScore } from "@shared/change/logic";
import { IMPLEMENTED_CODES } from "@shared/tables/change";
import type { Ctx } from "../../context";
import { createIn, emitEvent, onRecordEvent, savepoint, systemCtx, transitionIn, updateIn } from "../../engine";
import { pgArray } from "../../db";
import { enqueue, registerJobHandler, type JobContext } from "../../jobs";
import { actsHere } from "../notify";
import { ensureNextMeeting, refreshAgenda } from "./cab";
import { changeConfig, countRows, hasTable, iso, liveRows, msOf, type Row } from "./common";
import { CONFLICT_TRACKED, recomputeConflicts } from "./schedule";

export const SWEEP_EVERY = 15 * 60_000;
const DAY = 86_400_000;
const lastSweep = new Map<string, number>();

/** Queue the organisation's sweep (at most once per ten minutes per process; one queued job per organisation). */
export async function ensureSweep(q: JobContext["db"], orgId: string): Promise<void> {
  if (Date.now() - (lastSweep.get(orgId) ?? 0) < 10 * 60_000) return;
  lastSweep.set(orgId, Date.now());
  await enqueue(q, { kind: "change.sweep", orgId, delayMs: 60_000, dedupeKey: "change.sweep", maxAttempts: 5 });
}

/** Forget the throttle (tests). */
export const resetSweepThrottle = () => lastSweep.clear();

const people = (...xs: unknown[]): string[] => [...new Set(xs.filter((x): x is string => typeof x === "string" && !!x))];

export interface SweepResult {
  reminded: number;
  overruns: number;
  closed: number;
  canceled: number;
  released: number;
  meetings: number;
  incidents: number;
  scores: number;
  pending: boolean;
}

/** One pass of the sweep as the system of an organisation (`now` for tests). */
export async function sweep(sys: Ctx, deadline = Number.POSITIVE_INFINITY, now = Date.now()): Promise<SweepResult> {
  const out: SweepResult = { reminded: 0, overruns: 0, closed: 0, canceled: 0, released: 0, meetings: 0, incidents: 0, scores: 0, pending: false };
  const db = sys.db;
  const cfg = await changeConfig(db, sys);
  const late = () => Date.now() > deadline;

  // reminders before a scheduled change starts
  const alertMs = Math.max(0, Number(cfg.window_alert_minutes) || 0) * 60_000;
  if (alertMs) {
    for (const c of await liveRows(db, sys, "change_request", { and: [{ f: "state", op: "eq", v: "scheduled" }, { f: "window_alerted_at", op: "empty" }, { f: "planned_start", op: "lte", v: iso(now + alertMs) }, { f: "planned_start", op: "gt", v: iso(now - 3_600_000) }] }, { limit: 200 })) {
      if (late()) return { ...out, pending: true };
      await sys.write(async (tx) => {
        await updateIn(tx, sys, "change_request", String(c.id), { window_alerted_at: iso(now) }, { trusted: true, keepVersion: true });
        await emitEvent(tx, sys, { kind: "record.change.window_starting", table: "change_request", id: String(c.id), number: c.number ?? null, data: { users: people(c.assigned_to, c.change_owner_id, c.change_manager_id), planned_start: c.planned_start } });
      });
      out.reminded++;
    }
  }

  // implementations past their planned end
  for (const c of await liveRows(db, sys, "change_request", { and: [{ f: "state", op: "eq", v: "implement" }, { f: "overrun_alerted_at", op: "empty" }, { f: "planned_end", op: "lt", v: iso(now) }] }, { limit: 200 })) {
    if (late()) return { ...out, pending: true };
    await sys.write(async (tx) => {
      await updateIn(tx, sys, "change_request", String(c.id), { overrun_alerted_at: iso(now) }, { trusted: true, keepVersion: true });
      await emitEvent(tx, sys, { kind: "record.change.overrun", table: "change_request", id: String(c.id), number: c.number ?? null, data: { users: people(c.assigned_to, c.change_owner_id, c.change_manager_id), planned_end: c.planned_end } });
    });
    out.overruns++;
  }

  // reviews closed after N days (when nothing holds them: the guard refuses an open PIR)
  const closeDays = Number(cfg.review_auto_close_days) || 0;
  if (closeDays > 0) {
    for (const c of await liveRows(db, sys, "change_request", { and: [{ f: "state", op: "eq", v: "review" }, { f: "close_code", op: "nempty" }, { f: "updated_at", op: "lt", v: iso(now - closeDays * DAY) }] }, { limit: 200 })) {
      if (late()) return { ...out, pending: true };
      const ok = await sys.write((tx) => savepoint(tx, () => transitionIn(tx, sys, "change_request", String(c.id), "closed", { close_notes: c.close_notes || `پس از ${closeDays} روز در بازبینی، خودکار بسته شد.` }, { trusted: true })).then(() => true, () => false));
      if (ok) out.closed++;
    }
  }

  // drafts nobody touched for N days
  const staleDays = Number(cfg.stale_draft_days) || 0;
  if (staleDays > 0) {
    for (const c of await liveRows(db, sys, "change_request", { and: [{ f: "state", op: "eq", v: "new" }, { f: "on_hold", op: "eq", v: false }, { f: "updated_at", op: "lt", v: iso(now - staleDays * DAY) }] }, { limit: 200 })) {
      if (late()) return { ...out, pending: true };
      const ok = await sys.write((tx) => savepoint(tx, () => transitionIn(tx, sys, "change_request", String(c.id), "canceled", { close_code: "auto_canceled", close_notes: `پیش‌نویس ${staleDays} روز بی‌تغییر ماند و خودکار لغو شد.` }, { trusted: true })).then(() => true, () => false));
      if (ok) out.canceled++;
    }
  }

  // lockdowns whose end passed
  for (const l of await liveRows(db, sys, "change_lockdown", { and: [{ f: "state", op: "eq", v: "active" }, { f: "ends_at", op: "lt", v: iso(now) }] }, { limit: 50 })) {
    if (late()) return { ...out, pending: true };
    // the lockdown's hook resumes the changes it held
    await sys.write((tx) => transitionIn(tx, sys, "change_lockdown", String(l.id), "released", {}, { trusted: true }));
    out.released++;
  }

  // the next meeting of each CAB with a weekly schedule, and its agenda
  for (const cab of await liveRows(db, sys, "cab", { and: [{ f: "active", op: "eq", v: true }, { f: "meeting_time", op: "nempty" }] }, { limit: 50 })) {
    if (late()) return { ...out, pending: true };
    await sys.write(async (tx) => {
      const m = await ensureNextMeeting(tx, sys, cab);
      if (m) await refreshAgenda(tx, sys, String(m.id));
    });
    out.meetings++;
  }

  // incidents linked as caused by a change (CHG-054)
  out.incidents = await countCausedIncidents(sys);

  // the teams' success scores, once a day
  const [latest] = await liveRows(db, sys, "change_success_score", null, { order: "t.computed_at desc nulls last", limit: 1 });
  if (!latest || (msOf(latest.computed_at) ?? 0) < now - 20 * 3_600_000) out.scores = await computeSuccessScores(sys, now);

  out.pending =
    (await countRows(db, sys, "change_request", { f: "state", op: "nin", v: ["closed", "canceled"] })) > 0 ||
    (await countRows(db, sys, "change_lockdown", { f: "state", op: "eq", v: "active" })) > 0 ||
    (await countRows(db, sys, "cab", { and: [{ f: "active", op: "eq", v: true }, { f: "meeting_time", op: "nempty" }] })) > 0;
  return out;
}

/**
 * Count the incidents linked to each change as «ناشی از» it and keep `incidents_caused` in step (which links count:
 * `countsAsIncident`). Returns updates.
 */
export async function countCausedIncidents(sys: Ctx): Promise<number> {
  const from = hasTable("incident") ? `l.from_table = 'incident'` : `l.from_table <> 'change_request'`;
  const counts = await sys.db.query<{ id: string; n: string | number }>(
    `select l.to_id as id, count(*) as n from sm_links l
      where l.org_id = $1 and l.deleted_at is null and l.kind = 'caused_by' and l.to_table = 'change_request' and ${from}
      group by l.to_id`,
    [sys.org.id],
  );
  const want = new Map(counts.map((r) => [String(r.id), Number(r.n)]));
  const stale = await liveRows(sys.db, sys, "change_request", { f: "incidents_caused", op: "gt", v: 0 }, { limit: 5000 });
  const ids = new Set([...want.keys(), ...stale.map((r) => String(r.id))]);
  let n = 0;
  if (!ids.size) return 0;
  const rows = await liveRows(sys.db, sys, "change_request", null, { extra: { sql: `t.id = any($1§::uuid[])`, params: [pgArray([...ids])] }, limit: 5000 });
  for (const r of rows) {
    const v = want.get(String(r.id)) ?? 0;
    if (Number(r.incidents_caused ?? 0) === v) continue;
    await sys.write((tx) => updateIn(tx, sys, "change_request", String(r.id), { incidents_caused: v }, { trusted: true, keepVersion: true }));
    n++;
  }
  return n;
}

/** The teams' change success scores over the settings' window (one row per implementing group). Returns rows written. */
export async function computeSuccessScores(sys: Ctx, now = Date.now()): Promise<number> {
  const cfg = await changeConfig(sys.db, sys);
  const since = now - Math.max(7, Number(cfg.success_window_days) || 90) * DAY;
  const done = await liveRows(sys.db, sys, "change_request", { and: [{ f: "close_code", op: "in", v: IMPLEMENTED_CODES }, { f: "actual_end", op: "gte", v: iso(since) }, { f: "assignment_group_id", op: "nempty" }] }, { limit: 20_000 });
  const byGroup = new Map<string, Row[]>();
  for (const c of done) byGroup.set(String(c.assignment_group_id), [...(byGroup.get(String(c.assignment_group_id)) ?? []), c]);
  const existing = await liveRows(sys.db, sys, "change_success_score", null, { limit: 5000 });
  const groups = byGroup.size ? await liveRows(sys.db, sys, "group", null, { extra: { sql: `t.id = any($1§::uuid[])`, params: [pgArray([...byGroup.keys()])] } }) : [];
  const names = new Map(groups.map((g) => [String(g.id), String(g.name ?? "")]));
  let n = 0;
  await sys.write(async (tx) => {
    for (const [gid, xs] of byGroup) {
      const counts = {
        implemented: xs.length,
        successful: xs.filter((c) => c.close_code === "successful").length,
        with_issues: xs.filter((c) => c.close_code === "successful_issues").length,
        failed: xs.filter((c) => c.close_code === "unsuccessful" || c.close_code === "backed_out").length,
        caused_incidents: xs.filter((c) => Number(c.incidents_caused ?? 0) > 0).length,
        emergency: xs.filter((c) => c.type === "emergency").length,
      };
      const s = successScore(counts);
      const values = { title: names.get(gid) || "گروه", group_id: gid, score: s.score, band: s.band, ...counts, computed_at: iso(now) };
      const row = existing.find((e) => e.group_id === gid);
      if (row) await updateIn(tx, sys, "change_success_score", String(row.id), values, { trusted: true });
      else await createIn(tx, sys, "change_success_score", values, { trusted: true });
      n++;
    }
    // groups without implemented changes in the window keep no stale score
    for (const e of existing) if (!byGroup.has(String(e.group_id)) && e.implemented) {
      await updateIn(tx, sys, "change_success_score", String(e.id), { score: null, band: null, implemented: 0, successful: 0, with_issues: 0, failed: 0, caused_incidents: 0, emergency: 0, computed_at: iso(now) }, { trusted: true });
      n++;
    }
  });
  return n;
}

/** Recheck the conflicts of the changes still to come (from `skip` on; stops at the deadline). */
async function recheck(sys: Ctx, jctx: JobContext, skip: number): Promise<{ again: number } | undefined> {
  const rows = await liveRows(sys.db, sys, "change_request", { and: [{ f: "state", op: "in", v: CONFLICT_TRACKED }, { f: "planned_end", op: "gt", v: iso(Date.now()) }] }, { order: "t.planned_start, t.id", limit: 2000 });
  for (let i = skip; i < rows.length; i++) {
    if (Date.now() > jctx.deadline - 200) {
      await jctx.save({ skip: i });
      return { again: 0 };
    }
    await sys.write((tx) => recomputeConflicts(tx, sys, String(rows[i].id)));
  }
  return undefined;
}

/** Register the jobs and the subscriber that keeps the sweep alive. */
export function installChangeJobs(): (() => void)[] {
  return [
    onRecordEvent("change", async (e, jctx) => {
      if (actsHere(jctx.cfg)) await ensureSweep(jctx.db, e.org_id);
    }, { tables: ["change_request", "cab", "change_lockdown"], kinds: ["record.created", "record.state_changed"] }),
    registerJobHandler("change.conflicts", async (job, jctx) => {
      if (!job.org_id || typeof job.payload?.id !== "string") return;
      const sys = await systemCtx(jctx.cfg, job.org_id);
      await sys.write((tx) => recomputeConflicts(tx, sys, String(job.payload.id)));
    }),
    registerJobHandler("change.recheck", async (job, jctx) => {
      if (!job.org_id) return;
      const sys = await systemCtx(jctx.cfg, job.org_id);
      return recheck(sys, jctx, Number(job.payload?.skip ?? 0) || 0);
    }),
    registerJobHandler("change.sweep", async (job, jctx) => {
      if (!job.org_id || !actsHere(jctx.cfg)) return;
      const sys = await systemCtx(jctx.cfg, job.org_id);
      const r = await sweep(sys, jctx.deadline);
      return r.pending ? { again: SWEEP_EVERY } : undefined;
    }),
  ];
}

