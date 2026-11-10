// Scheduled flows and recurring records (docs/spec/services/flows.md §9). One `flows.scheduler` job per
// organisation runs every minute while something is scheduled: it plans the next occurrence of every active
// scheduled flow (its published trigger) and every active `schedule` record in sm_flow_timers, and fires what is due —
// once: the timer is claimed in the same transaction that starts the run or creates the record, so two workers
// never fire one occurrence twice. Missed occurrences (the server was down) are not replayed: the next one is
// planned from now. A Windows app linked to the web version leaves its synchronised organisation's schedules to the
// web version (otherwise both would fire them).
import type { ServerConfig } from "../../context";
import type { Queryable } from "../../db";
import { enqueue, registerJobHandler } from "../../jobs";
import { createIn } from "../../engine";
import { memberCtx } from "../../access";
import { DEFAULT_TIMEZONE } from "@shared/constants";
import { nextOccurrence, renderTemplate, scheduleKey, scheduleProblem, type ScheduleSpec } from "@shared/flows";
import { startRun } from "./executor";
import { activeFlows, resolveRunAs, type PublishedFlow } from "./triggers";

const MINUTE = 60_000;

/** Make sure the organisation's scheduler job is queued (inside the caller's transaction when there is one). */
export async function ensureScheduler(q: Queryable, orgId: string): Promise<void> {
  await enqueue(q, { kind: "flows.scheduler", orgId, dedupeKey: "flows.scheduler", maxAttempts: 100 });
}

let linkCache: { at: number; orgId: string | null } | null = null;

/** Does this runtime fire the organisation's schedules? (A linked Windows app leaves them to the web version.) */
export async function schedulesRunHere(cfg: ServerConfig, orgId: string): Promise<boolean> {
  if (cfg.mode !== "desktop") return true;
  if (!linkCache || Date.now() - linkCache.at > MINUTE) {
    const info = (await cfg.desktop?.info().catch(() => null)) as { cloud?: { linked?: boolean; org_id?: string | null } } | null;
    linkCache = { at: Date.now(), orgId: info?.cloud?.linked ? info.cloud.org_id ?? null : null };
  }
  return linkCache.orgId !== orgId;
}

interface ScheduleRow {
  id: string;
  name: string;
  table_key: string;
  spec: ScheduleSpec;
  template: Record<string, unknown>;
  run_as: string | null;
}

interface TimerRow {
  kind: "flow" | "schedule";
  ref_id: string;
  spec_key: string;
  next_at: string | null;
  last_at: string | null;
}

type Item = { kind: "flow"; id: string; spec: ScheduleSpec; flow: PublishedFlow } | { kind: "schedule"; id: string; spec: ScheduleSpec; schedule: ScheduleRow };

async function orgZone(q: Queryable, orgId: string): Promise<string> {
  const org = await q.one<{ settings: Record<string, unknown> | null }>(`select settings from sm_orgs where id = $1`, [orgId]);
  const tz = org?.settings?.timezone;
  return typeof tz === "string" && tz ? tz : DEFAULT_TIMEZONE;
}

/** Claim a due timer (its occurrence) inside `q`: true when this caller fires it. */
async function claim(q: Queryable, orgId: string, t: TimerRow, next: number | null): Promise<boolean> {
  const r = await q.one(
    `update sm_flow_timers set next_at = $5::timestamptz, last_at = now(), last_error = null, updated_at = now()
     where org_id = $1 and kind = $2 and ref_id = $3 and next_at = $4::timestamptz returning ref_id`,
    [orgId, t.kind, t.ref_id, new Date(String(t.next_at)).toISOString(), next === null ? null : new Date(next).toISOString()],
  );
  return !!r;
}

/** Create a schedule's record from its template, as its «ساخته به نام» member. */
async function fireSchedule(cfg: ServerConfig, orgId: string, s: ScheduleRow, t: TimerRow, at: number, next: number | null, tz: string): Promise<boolean> {
  if (!s.run_as) throw new Error("«ساخته به نام» مشخص نیست");
  const ctx = await memberCtx(cfg, orgId, s.run_as).catch(() => {
    throw new Error("عضوی که رکوردها به نام او ساخته می‌شود دیگر عضو فعال سازمان نیست");
  });
  const data = { schedule: { id: s.id, name: s.name }, trigger: { kind: "schedule", scheduled_at: new Date(at).toISOString() } };
  const values = renderTemplate(s.template ?? {}, data, { now: at, tz }) as Record<string, unknown>;
  for (const k of Object.keys(values)) if (values[k] === undefined) values[k] = null;
  return ctx.write(async (tx) => {
    if (!(await claim(tx, orgId, t, next))) return false;
    await createIn(tx, ctx, s.table_key, values);
    return true;
  });
}

/** Start a scheduled flow's run (its published version). */
async function fireFlow(cfg: ServerConfig, orgId: string, f: PublishedFlow, t: TimerRow, at: number, next: number | null): Promise<boolean> {
  return cfg.db.tx(async (tx) => {
    if (!(await claim(tx, orgId, t, next))) return false;
    await startRun(tx, {
      orgId,
      flow: { id: f.id, name: f.name },
      version: { id: f.version_id, no: f.version_no },
      trigger: { kind: "schedule", scheduled_at: new Date(at).toISOString() },
      actorId: null,
      runAs: resolveRunAs(f.trigger, null, f.publisher),
      depth: 0,
      table: f.trigger.table ?? null,
    });
    return true;
  });
}

/** Plan and fire the organisation's schedules once (`now` for tests). Returns how many are active and fired. */
export async function runScheduler(cfg: ServerConfig, orgId: string, now = Date.now()): Promise<{ active: number; fired: number; errors: number }> {
  const db = cfg.db;
  const tz = await orgZone(db, orgId);
  const flows = (await activeFlows(db, orgId, "schedule")).filter((f) => f.trigger.schedule && !scheduleProblem(f.trigger.schedule));
  const schedules = (
    await db.query<ScheduleRow>(`select id, name, table_key, spec, template, run_as from sm_schedules where org_id = $1 and active and deleted_at is null order by id`, [orgId])
  ).filter((s) => !scheduleProblem(s.spec));
  const items: Item[] = [
    ...flows.map((f) => ({ kind: "flow" as const, id: f.id, spec: f.trigger.schedule!, flow: f })),
    ...schedules.map((s) => ({ kind: "schedule" as const, id: s.id, spec: s.spec, schedule: s })),
  ];
  const timers = await db.query<TimerRow>(`select kind, ref_id, spec_key, next_at, last_at from sm_flow_timers where org_id = $1`, [orgId]);
  const live = new Set(items.map((i) => `${i.kind}:${i.id}`));
  for (const t of timers) if (!live.has(`${t.kind}:${t.ref_id}`)) await db.query(`delete from sm_flow_timers where org_id = $1 and kind = $2 and ref_id = $3`, [orgId, t.kind, t.ref_id]);
  let fired = 0;
  let errors = 0;
  for (const it of items) {
    const key = scheduleKey(it.spec);
    const t = timers.find((x) => x.kind === it.kind && x.ref_id === it.id);
    if (!t || t.spec_key !== key) {
      // a new or changed schedule is planned from now on
      const next = nextOccurrence(it.spec, now, tz);
      await db.query(
        `insert into sm_flow_timers (org_id, kind, ref_id, spec_key, next_at) values ($1, $2, $3, $4, $5::timestamptz)
         on conflict (org_id, kind, ref_id) do update set spec_key = excluded.spec_key, next_at = excluded.next_at, last_error = null, updated_at = now()`,
        [orgId, it.kind, it.id, key, next === null ? null : new Date(next).toISOString()],
      );
      continue;
    }
    if (!t.next_at || Date.parse(String(t.next_at)) > now) continue;
    const at = Date.parse(String(t.next_at));
    // missed occurrences are not replayed: the next one comes after now
    const next = nextOccurrence(it.spec, Math.max(now, at), tz);
    try {
      const ok = it.kind === "flow" ? await fireFlow(cfg, orgId, it.flow, t, at, next) : await fireSchedule(cfg, orgId, it.schedule, t, at, next, tz);
      if (ok) fired++;
    } catch (e) {
      errors++;
      const message = String((e as Error)?.message ?? e).slice(0, 1000);
      // the occurrence is spent: plan the next one and keep the error for the schedule's page
      await db.query(
        `update sm_flow_timers set next_at = $4::timestamptz, last_at = now(), last_error = $5, updated_at = now() where org_id = $1 and kind = $2 and ref_id = $3`,
        [orgId, it.kind, it.id, next === null ? null : new Date(next).toISOString(), message],
      );
      cfg.log.warn("flows: scheduled occurrence failed", { org: orgId, kind: it.kind, id: it.id, error: message });
    }
  }
  return { active: items.length, fired, errors };
}

/** Delete finished runs: completed and canceled after 30 days, failed after 90 (at most hourly per process). */
let lastCleanup = 0;
export async function cleanupRuns(q: Queryable, force = false): Promise<void> {
  if (!force && Date.now() - lastCleanup < 60 * MINUTE) return;
  lastCleanup = Date.now();
  await q.query(
    `delete from sm_flow_runs where ended_at is not null and (
       (state in ('completed', 'canceled') and ended_at < now() - interval '30 days') or (state = 'failed' and ended_at < now() - interval '90 days'))`,
  );
}

registerJobHandler("flows.scheduler", async (job, jctx) => {
  const cfg = jctx.cfg as ServerConfig;
  const orgId = job.org_id;
  if (!orgId) return;
  await cleanupRuns(cfg.db).catch((e) => cfg.log.warn("flows: cleanup failed", String((e as Error)?.message ?? e)));
  if (!(await schedulesRunHere(cfg, orgId))) return;
  const org = await cfg.db.one(`select 1 from sm_orgs where id = $1 and deleted_at is null`, [orgId]);
  if (!org) return;
  const r = await runScheduler(cfg, orgId);
  if (r.active) return { again: MINUTE };
});

