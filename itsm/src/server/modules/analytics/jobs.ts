// Background work of analytics, per organisation (on the runtime that acts for it: a Windows app linked to the web
// version leaves it to the web version):
//   · `analytics.tick` every five minutes: queues the deliveries of schedules that are due, and the daily snapshot of
//     the indicators once the configured hour has passed (once a day). It reschedules itself; it is queued by the
//     seed, by every write to a schedule or indicator and by the module's meta route, so organisations created before
//     the module still get it.
//   · `analytics.snapshot`: collects every active indicator with daily snapshots (incrementally: the current and the
//     previous period, a backfill the first time a formula version is collected, breakdowns), within the worker's
//     budget — what is left continues in the next run of the job — then prunes scores past the retention.
//   · `analytics.deliver`: one schedule, every recipient with their own access, continuing where the deadline stopped it.
import { todayISO } from "@shared/jalali";
import type { Queryable } from "../../db";
import type { ServerConfig } from "../../context";
import { orgTz, systemCtx, updateIn } from "../../engine";
import { enqueue, registerJobHandler } from "../../jobs";
import { actsHere } from "../notify/common";
import { analyticsConfig, liveRow, liveRows } from "./common";
import { collectIndicator, pruneScores } from "./indicators";
import { deliverTo, dueSchedules, finishRun, recipientsOf, type DeliveryOutcome } from "./delivery";

export const TICK_EVERY = 5 * 60_000;

/** Make sure the organisation's analytics tick is queued (inside the caller's transaction when there is one). */
export async function ensureTick(q: Queryable, orgId: string): Promise<void> {
  await enqueue(q, { kind: "analytics.tick", orgId, dedupeKey: "analytics.tick", maxAttempts: 100 });
}

/** The hour of the day (0–23) in a time zone. */
export function hourIn(tz: string, now = Date.now()): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(new Date(now));
  return Number(h) % 24;
}

/** Is the daily snapshot due (not taken today, and the configured hour has passed)? */
export function snapshotDue(cfg: { last_snapshot_on: string | null; snapshot_hour: number }, tz: string, now = Date.now()): boolean {
  return String(cfg.last_snapshot_on ?? "").slice(0, 10) !== todayISO(tz) && hourIn(tz, now) >= cfg.snapshot_hour;
}

/**
 * When a run of a long job stops: halfway through the budget it has left (at least a second later). The tick's budget
 * is small on a Windows app (8 s) and after a web write (4 s): a fixed margin would leave no time at all. Every run
 * still does at least one unit of work before it looks (an indicator, a recipient), so a job always progresses.
 */
export const stopAt = (deadline: number, now = Date.now()): number => now + Math.max(1_000, (deadline - now) / 2);

/**
 * Collect what is left of today's snapshot (indicators not collected since `since`); true when everything is done. At
 * least one indicator is collected before the deadline is looked at.
 */
export async function snapshotStep(cfg: ServerConfig, orgId: string, opts: { since: string; deadline: number; now?: number }): Promise<{ done: boolean; scores: number; alerts: number; skipped: string[] }> {
  const sys = await systemCtx(cfg, orgId);
  const conf = await analyticsConfig(cfg.db, sys);
  const rows = await liveRows(
    cfg.db,
    sys,
    "analytics_indicator",
    { and: [{ f: "active", op: "eq", v: true }, { f: "collect", op: "eq", v: true }, { or: [{ f: "collected_at", op: "empty" }, { f: "collected_at", op: "lt", v: opts.since }] }] },
    { order: "t.collected_at nulls first, t.id", limit: 200 },
  );
  const out = { done: true, scores: 0, alerts: 0, skipped: [] as string[] };
  let collected = 0;
  for (const r of rows) {
    if (collected > 0 && Date.now() > opts.deadline) {
      out.done = false;
      break;
    }
    collected++;
    try {
      const x = await collectIndicator(sys, r, { now: opts.now, backfill: conf.backfill_periods });
      out.scores += x.scores;
      out.alerts += x.alerts;
    } catch (e) {
      // a broken definition (a table removed, a field renamed) must not stop the others; mark it collected
      out.skipped.push(`${r.key}: ${e instanceof Error ? e.message : String(e)}`);
      await sys.write((tx) => updateIn(tx, sys, "analytics_indicator", r.id, { collected_at: new Date().toISOString() }, { trusted: true, keepVersion: true }));
    }
  }
  if (out.done) {
    await pruneScores(sys, conf.keep_days, opts.now);
    if (conf.id) await sys.write((tx) => updateIn(tx, sys, "analytics_config", conf.id!, { last_snapshot_on: todayISO(orgTz(sys)) }, { trusted: true, keepVersion: true }));
  }
  return out;
}

export function installAnalyticsJobs(): void {
  registerJobHandler("analytics.tick", async (job, jctx) => {
    const orgId = job.org_id;
    if (!orgId || !actsHere(jctx.cfg)) return;
    const org = await jctx.db.one(`select 1 from sm_orgs where id = $1 and deleted_at is null`, [orgId]);
    if (!org) return;
    const cfg = jctx.cfg as ServerConfig;
    const sys = await systemCtx(cfg, orgId);
    for (const s of await dueSchedules(sys)) {
      await enqueue(jctx.db, { kind: "analytics.deliver", orgId, payload: { id: s.id, at: s.next_run_at }, dedupeKey: `analytics.deliver:${s.id}`, maxAttempts: 3 });
    }
    const conf = await analyticsConfig(jctx.db, sys);
    if (snapshotDue(conf, orgTz(sys))) {
      await enqueue(jctx.db, { kind: "analytics.snapshot", orgId, payload: { since: new Date().toISOString() }, dedupeKey: "analytics.snapshot", maxAttempts: 3 });
      // once a day, the role holders of shared definitions are recomputed as a fallback (membership roles changed
      // outside the engine's tables, members deactivated)
      await enqueue(jctx.db, { kind: "analytics.shares", orgId, dedupeKey: "analytics.shares", maxAttempts: 5 });
    }
    return { again: TICK_EVERY };
  });

  registerJobHandler("analytics.snapshot", async (job, jctx) => {
    const orgId = job.org_id;
    if (!orgId || !actsHere(jctx.cfg)) return;
    const payload = (job.payload ?? {}) as { since?: string };
    const since = payload.since ?? new Date().toISOString();
    const r = await snapshotStep(jctx.cfg as ServerConfig, orgId, { since, deadline: stopAt(jctx.deadline) });
    if (!r.done) {
      await jctx.save({ since });
      return { again: 0 };
    }
    if (r.skipped.length) jctx.log.warn("analytics: indicators skipped", r.skipped.slice(0, 5).join(" | "));
  });

  // one occurrence of a schedule (`at`: when it was due, or when «ارسال اکنون» asked — `manual`), every recipient with
  // their own access. Progress is saved after each recipient (a retried job never sends to them again), and one
  // recipient's failure is that recipient's outcome: the run always finishes and moves the schedule on, so the tick
  // never queues the same occurrence afresh.
  registerJobHandler("analytics.deliver", async (job, jctx) => {
    const orgId = job.org_id;
    if (!orgId || !actsHere(jctx.cfg)) return;
    const cfg = jctx.cfg as ServerConfig;
    const payload = (job.payload ?? {}) as { id?: string; at?: string; manual?: boolean; done?: string[]; outcomes?: DeliveryOutcome[] };
    const sys = await systemCtx(cfg, orgId);
    const s = await liveRow(jctx.db, sys, "analytics_schedule", payload.id);
    if (!s || (!s.active && !payload.manual)) return;
    // a second job queued while the first was still sending finds the occurrence already delivered
    if (!payload.manual && !payload.done?.length && payload.at && s.next_run_at && Date.parse(String(s.next_run_at)) > Date.parse(payload.at)) return;
    const done = new Set(payload.done ?? []);
    const outcomes = [...(payload.outcomes ?? [])];
    const stop = stopAt(jctx.deadline);
    let sent = 0;
    for (const u of await recipientsOf(sys, s)) {
      if (done.has(u)) continue;
      if (sent > 0 && Date.now() > stop) return { again: 0 };
      let outcome: DeliveryOutcome;
      try {
        outcome = await deliverTo(cfg, sys, s, u);
      } catch (e) {
        // one recipient's failure never stops (or repeats) the others
        jctx.log.warn("analytics: delivery failed", e instanceof Error ? e.message : String(e));
        outcome = { user: u, status: "failed", delivery_id: null };
      }
      outcomes.push(outcome);
      done.add(u);
      sent++;
      await jctx.save({ ...payload, done: [...done], outcomes });
    }
    await finishRun(sys, s, outcomes, { manual: !!payload.manual });
  });
}
