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

/** Collect what is left of today's snapshot (indicators not collected since `since`); true when everything is done. */
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
  for (const r of rows) {
    if (Date.now() > opts.deadline) {
      out.done = false;
      break;
    }
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
    const r = await snapshotStep(jctx.cfg as ServerConfig, orgId, { since, deadline: jctx.deadline - 15_000 });
    if (!r.done) {
      await jctx.save({ since });
      return { again: 0 };
    }
    if (r.skipped.length) jctx.log.warn("analytics: indicators skipped", r.skipped.slice(0, 5).join(" | "));
  });

  registerJobHandler("analytics.deliver", async (job, jctx) => {
    const orgId = job.org_id;
    if (!orgId || !actsHere(jctx.cfg)) return;
    const cfg = jctx.cfg as ServerConfig;
    const payload = (job.payload ?? {}) as { id?: string; done?: string[]; outcomes?: DeliveryOutcome[] };
    const sys = await systemCtx(cfg, orgId);
    const s = await liveRow(jctx.db, sys, "analytics_schedule", payload.id);
    if (!s || !s.active) return;
    const done = new Set(payload.done ?? []);
    const outcomes = [...(payload.outcomes ?? [])];
    for (const u of await recipientsOf(sys, s)) {
      if (done.has(u)) continue;
      if (Date.now() > jctx.deadline - 10_000) {
        await jctx.save({ ...payload, done: [...done], outcomes });
        return { again: 0 };
      }
      outcomes.push(await deliverTo(cfg, sys, s, u));
      done.add(u);
    }
    await finishRun(sys, s, outcomes);
  });
}
