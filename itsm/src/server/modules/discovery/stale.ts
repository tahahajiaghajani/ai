// The contact ladder (design A §10): gone → stale → missing → retired, judged on the tools' own last contact with the
// machine, never on listing (a stolen laptop that AD and the antivirus console still list is flagged all the same).
//
//   · Contact per target — a CI, or an asset without one (an ATM): the latest `last_contact_at`, plus its kind's lag (AD's
//     lastLogonTimestamp is up to 14 days late), over every item of every connector that reports the target, from kinds
//     that report contact; never later than now. A record without a contact contributes none (the runner turns
//     `options.listing_is_contact` into one). discovery_state keeps it with its item and the latest listing.
//   · stale (no contact for stale_days, 14): `stale_since`, and the CI's `is_stale` (the CMDB queue «دادهٔ کهنه») unless
//     the data source's delete_policy is `none`; contact again clears both.
//   · missing (no contact for missing_days, 45): `missing_since`; when the asset is in use, `task` (the default) — one
//     `todo` per silence for the asset's managed_by / managed_by_group_id (the connector's owner when it has neither),
//     deduped through `missing_todo_id`, listing each source's last contact — or `auto`: the asset → «مفقود» with a
//     journal line naming the sources. Assets without a CI (ATMs) included. Contact again ends the silence.
//   · retired (delete_policy `retire`): the CI, after retire_days without contact from any source, when no asset in use
//     stands behind it. Assets are never retired or disposed by a connector (disposal has its own approval).
//   The thresholds of a target are the smallest among the active connectors that report it — every connector's ladder
//   then decides the same for it; the policy, retirement and missing action are the judging connector's.
// Job `discovery.stale` (dedupe discovery.stale:<connector>): after a complete pass the mass-drop guard let through,
// after «پذیرش اندازهٔ تازه», and daily from the sweep — never while the connector's last complete pass is held by the
// guard. It also looks again at the connector's open mismatches (mismatch.ts). Bookkeeping is set-based SQL in
// `internal` transactions; each transition is a short engine write together with its target's row, within the slice.
import { dateISOIn, formatJalali } from "@shared/jalali";
import { ladder, type DeletePolicy } from "@shared/discovery/stale";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import { isTransientDbError, type Queryable } from "../../db";
import { addJournalIn, createIn, transitionIn, updateIn } from "../../engine";
import type { Job, JobContext, JobResult } from "../../jobs";
import { assertWritable } from "../platform/org-admin";
import { liveRow } from "../cmdb/common";
import { sliceEnd } from "./budget";
import { refreshMismatches } from "./mismatch";
import { serverKinds } from "./registry";
import { loadConnector } from "./runner";

type Row = Record<string, any>;

const faNum = (n: number) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

/** The contact lag (days) of every kind that reports contact (kinds without contact are left out). */
export function contactLags(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of serverKinds()) if (k.contact) out[k.kind] = Math.max(0, Math.trunc(k.contact.lag_days));
  return out;
}

/** Is the connector's latest complete inventory pass held by the mass-drop guard (§10.4)? Then the ladder waits. */
export async function heldByGuard(q: Queryable, orgId: string, connectorId: string): Promise<boolean> {
  const r = await q.one<{ held: boolean }>(
    `select exists (select 1 from jsonb_array_elements(coalesce(r.warnings, '[]'::jsonb)) w where w->>'code' = 'mass_drop' and coalesce((w->>'accepted')::boolean, false) = false) as held
     from sm_discovery_runs r where r.org_id = $1 and r.connector_id = $2 and r.lane = 'inventory' and r.state = 'completed' and r.complete and r.deleted_at is null
     order by r.started_at desc limit 1`,
    [orgId, connectorId],
  );
  return !!r?.held;
}

/**
 * The connector's targets with their contact over every source, the thresholds in force, the CI and the asset as they
 * stand, and the ladder's row.
 */
const TARGETS_SQL = `
with t as (
  select distinct i.ci_id, null::uuid as asset_id from sm_discovery_items i
   where i.org_id = $1 and i.connector_id = $2 and i.deleted_at is null and i.ci_id is not null
  union
  select distinct null::uuid, i.asset_id from sm_discovery_items i
   where i.org_id = $1 and i.connector_id = $2 and i.deleted_at is null and i.ci_id is null and i.asset_id is not null
)
select t.ci_id, a.id as asset_id, x.contact_item_id, x.contact as last_contact_at, x.listed as last_listed_at, x.stale_days, x.missing_days,
       ci.is_stale as ci_stale, ci.state as ci_state, a.state as asset_state, a.number as asset_number,
       s.stale_since, s.missing_since, s.missing_todo_id
from t
left join sm_cis ci on ci.org_id = $1 and ci.id = t.ci_id and ci.deleted_at is null
left join lateral (
  select a.id, a.state, a.number from sm_assets a
  where a.org_id = $1 and a.deleted_at is null and ((t.ci_id is not null and a.ci_id = t.ci_id) or (t.ci_id is null and a.id = t.asset_id))
  order by a.created_at limit 1
) a on true
left join lateral (
  select (array_agg(i.id order by least(i.last_contact_at + make_interval(days => coalesce(($3::jsonb ->> k.kind)::int, 0)), now()) desc)
            filter (where i.last_contact_at is not null and jsonb_exists($3::jsonb, k.kind)))[1] as contact_item_id,
         max(least(i.last_contact_at + make_interval(days => coalesce(($3::jsonb ->> k.kind)::int, 0)), now()))
            filter (where i.last_contact_at is not null and jsonb_exists($3::jsonb, k.kind)) as contact,
         max(i.listed_at) as listed,
         min(k.stale_days) filter (where k.deleted_at is null and k.active) as stale_days,
         min(k.missing_days) filter (where k.deleted_at is null and k.active) as missing_days
  from sm_discovery_items i join sm_discovery_connectors k on k.org_id = i.org_id and k.id = i.connector_id
  where i.org_id = $1 and i.deleted_at is null
    and ((t.ci_id is not null and i.ci_id = t.ci_id) or (t.ci_id is null and i.ci_id is null and i.asset_id = t.asset_id))
) x on true
left join sm_discovery_states s on s.org_id = $1 and s.deleted_at is null
  and s.target_table = case when t.ci_id is not null then 'ci' else 'asset' end and s.target_id = coalesce(t.ci_id, t.asset_id)::text
where t.ci_id is null or ci.id is not null`;

/** Contact, its item and the latest listing of each target, upserted set-based (lock-free bookkeeping). */
async function storeContact(q: Queryable, orgId: string, rows: Row[], origin: string): Promise<void> {
  const data = rows.map((r) => ({
    target_table: r.ci_id ? "ci" : "asset", target_id: String(r.ci_id ?? r.asset_id), ci_id: r.ci_id ?? null, asset_id: r.asset_id ?? null,
    last_contact_at: r.last_contact_at ?? null, contact_item_id: r.contact_item_id ?? null, last_listed_at: r.last_listed_at ?? null,
  }));
  for (let i = 0; i < data.length; i += 2000) {
    await q.query(
      `insert into sm_discovery_states as s (id, org_id, target_table, target_id, ci_id, asset_id, last_contact_at, contact_item_id, last_listed_at, origin)
       select gen_random_uuid(), $1, x.target_table, x.target_id, x.ci_id, x.asset_id, x.last_contact_at, x.contact_item_id, x.last_listed_at, $3
       from jsonb_to_recordset($2::jsonb) as x(target_table text, target_id text, ci_id uuid, asset_id uuid, last_contact_at timestamptz, contact_item_id uuid, last_listed_at timestamptz)
       on conflict (org_id, target_table, target_id) where deleted_at is null do update set
         ci_id = excluded.ci_id, asset_id = coalesce(excluded.asset_id, s.asset_id), last_contact_at = excluded.last_contact_at,
         contact_item_id = excluded.contact_item_id, last_listed_at = excluded.last_listed_at, updated_at = now()
       where s.last_contact_at is distinct from excluded.last_contact_at or s.contact_item_id is distinct from excluded.contact_item_id
          or s.last_listed_at is distinct from excluded.last_listed_at or s.ci_id is distinct from excluded.ci_id
          or s.asset_id is distinct from coalesce(excluded.asset_id, s.asset_id)`,
      [orgId, JSON.stringify(data.slice(i, i + 2000)), origin],
    );
  }
}

interface LadderColumns {
  stale_since: string | null;
  missing_since: string | null;
  missing_todo_id: string | null;
}

/** The ladder's own columns of one target (inside the caller's transaction). */
async function storeLadder(q: Queryable, orgId: string, r: Row, v: LadderColumns): Promise<void> {
  await q.query(
    `update sm_discovery_states set stale_since = $4, missing_since = $5, missing_todo_id = $6, updated_at = now()
     where org_id = $1 and target_table = $2 and target_id = $3 and deleted_at is null`,
    [orgId, r.ci_id ? "ci" : "asset", String(r.ci_id ?? r.asset_id), v.stale_since, v.missing_since, v.missing_todo_id],
  );
}

/** Each source's last contact with a target, as people read it («Zabbix مرکز داده»: ۱۴۰۵/۰۲/۱۲). */
async function sourcesOf(q: Queryable, sys: Ctx, r: Row): Promise<{ lines: string[]; names: string[] }> {
  const rows = await q.query<{ name: string; last_contact_at: string | null }>(
    `select k.name, max(i.last_contact_at) as last_contact_at from sm_discovery_items i join sm_discovery_connectors k on k.org_id = i.org_id and k.id = i.connector_id
     where i.org_id = $1 and i.deleted_at is null
       and (($2::uuid is not null and i.ci_id = $2::uuid) or ($2::uuid is null and i.ci_id is null and i.asset_id = $3::uuid))
     group by k.name order by 2 desc nulls last, 1`,
    [sys.org.id, r.ci_id ?? null, r.asset_id ?? null],
  );
  const tz = String(sys.org.settings?.timezone ?? "Asia/Tehran");
  return {
    lines: rows.map((x) => `«${x.name}»: ${x.last_contact_at ? formatJalali(dateISOIn(x.last_contact_at, tz)) : "تماسی گزارش نکرده است"}`),
    names: rows.map((x) => x.name),
  };
}

export interface LadderResult {
  targets: number;
  /** CIs flagged stale, and flagged no more */
  stale: number;
  fresh: number;
  /** tasks made, assets marked «مفقود», CIs retired */
  tasks: number;
  missing: number;
  retired: number;
  /** targets whose transition failed (logged; tried again at the next run) */
  failed: number;
  /** the connector's last complete pass is held by the mass-drop guard: nothing was judged */
  held?: boolean;
  /** the slice ended with transitions left (the job comes back) */
  more?: boolean;
}

/**
 * One slice of a connector's ladder. Idempotent: every decision is taken again from what is stored, so a slice that
 * ends early, or a worker that dies, loses nothing and repeats nothing.
 */
export async function runLadder(sys: Ctx, connectorId: string, opts: { deadline?: number; runId?: string | null } = {}): Promise<LadderResult> {
  const db = sys.db;
  const org = sys.org.id;
  const out: LadderResult = { targets: 0, stale: 0, fresh: 0, tasks: 0, missing: 0, retired: 0, failed: 0 };
  const end = sliceEnd(Date.now(), opts.deadline ?? Date.now() + 20_000);
  const conn = await loadConnector(db, org, connectorId);
  if (!conn) return out;
  if (await heldByGuard(db, org, connectorId)) return { ...out, held: true };
  // mismatches settled elsewhere close (§8.3)
  await sys.write((tx) => refreshMismatches(tx, org, connectorId), { internal: true });
  const rows = await db.query<Row>(TARGETS_SQL, [org, connectorId, JSON.stringify(contactLags())]);
  out.targets = rows.length;
  if (rows.length) await sys.write((tx) => storeContact(tx, org, rows, sys.cfg.origin ?? "cloud"), { internal: true });
  const src = conn.source_id ? await db.one<{ delete_policy: string | null }>(`select delete_policy from sm_cmdb_sources where org_id = $1 and id = $2`, [org, conn.source_id]) : null;
  const deletePolicy = (["flag", "retire", "none"].includes(String(src?.delete_policy)) ? src!.delete_policy : "flag") as DeletePolicy;
  const now = Date.now();
  const at = new Date(now).toISOString();
  const bookkeeping: { r: Row; v: LadderColumns }[] = [];
  let worked = false;
  for (const r of rows) {
    const d = ladder({
      contactAt: r.last_contact_at ? Date.parse(r.last_contact_at) : null, now,
      staleDays: Number(r.stale_days ?? conn.stale_days ?? 14), missingDays: Number(r.missing_days ?? conn.missing_days ?? 45),
      retireDays: Number(conn.retire_days ?? 0), deletePolicy, hasCi: !!r.ci_id, assetInUse: r.asset_state === "in_use",
    });
    // an unknown contact decides nothing
    if (d.days === null) continue;
    const v: LadderColumns = { stale_since: r.stale_since ?? null, missing_since: r.missing_since ?? null, missing_todo_id: r.missing_todo_id ?? null };
    if (d.stale && !v.stale_since) v.stale_since = at;
    if (!d.stale) v.stale_since = null;
    if (d.overdue && !v.missing_since) v.missing_since = at;
    if (!d.overdue) {
      // the silence ended: the next one is a new one, with its own task
      v.missing_since = null;
      v.missing_todo_id = null;
    }
    const liveCi = !!r.ci_id && !["retired", "disposed", "canceled"].includes(String(r.ci_state));
    const retire = d.retire && liveCi;
    const flag = !retire && d.stale && d.flagCi && liveCi && !r.ci_stale;
    const unflag = !d.stale && !!r.stale_since && d.flagCi && liveCi && !!r.ci_stale;
    const task = d.missing && conn.missing_action !== "auto" && !v.missing_todo_id && !!r.asset_id;
    const markMissing = d.missing && conn.missing_action === "auto" && !!r.asset_id;
    if (!flag && !unflag && !task && !markMissing && !retire) {
      if (v.stale_since !== (r.stale_since ?? null) || v.missing_since !== (r.missing_since ?? null) || v.missing_todo_id !== (r.missing_todo_id ?? null)) bookkeeping.push({ r, v });
      continue;
    }
    if (worked && Date.now() >= end) {
      out.more = true;
      break;
    }
    worked = true;
    // one target's failure (a transition its record refuses) never stops the others: it is logged and tried again at
    // the next run
    // what this target's transaction did, counted once it commits
    const did = { retired: 0, stale: 0, fresh: 0, tasks: 0, missing: 0 };
    try {
      await sys.write(async (tx) => {
        if (retire) {
          await transitionIn(tx, sys, "ci", r.ci_id, "retired", {}, { trusted: true });
          did.retired = 1;
        } else if (flag || unflag) {
          await updateIn(tx, sys, "ci", r.ci_id, { is_stale: flag }, { trusted: true, keepVersion: true, allowLocked: true });
          if (flag) did.stale = 1;
          else did.fresh = 1;
        }
        if (task || markMissing) {
          const asset = await liveRow(tx, sys, "asset", r.asset_id);
          const { lines, names } = await sourcesOf(tx, sys, r);
          const title = `دارایی ${asset?.number ?? r.asset_number ?? ""} از ${faNum(d.days!)} روز پیش با هیچ ابزاری تماس نداشته است`;
          if (task && asset) {
            const todo = await createIn(tx, sys, "todo", {
              short_description: title.slice(0, 200),
              description: ["آخرین تماس هر منبع با این دستگاه:", ...lines.map((l) => `- ${l}`), "", "اگر دستگاه گم، جابه‌جا یا از کار افتاده است، وضعیت دارایی را به‌روز کنید؛ اگر روشن و در استفاده است، عامل ابزارها را روی آن بررسی کنید."].join("\n"),
              category: "followup", priority: "3",
              assigned_to: asset.managed_by ?? (asset.managed_by_group_id ? null : conn.owner_id ?? null), assignment_group_id: asset.managed_by_group_id ?? null,
              ci_id: r.ci_id ?? null, location_id: asset.location_id ?? null,
            }, { trusted: true });
            v.missing_todo_id = todo.id;
            did.tasks = 1;
          } else if (markMissing && asset?.state === "in_use") {
            const reason = `${title} (منبع‌ها: ${names.map((n) => `«${n}»`).join("، ") || "—"})`;
            await transitionIn(tx, sys, "asset", asset.id, "missing", { retire_reason: reason.slice(0, 2000) }, { trusted: true });
            await addJournalIn(tx, sys, tableDef("asset")!, asset, { kind: "system", body: `منبع دادهٔ «${conn.name}» دارایی را «مفقود» کرد: ${title}.\n${lines.join("\n")}` }, { trusted: true });
            did.missing = 1;
          }
        }
        await storeLadder(tx, org, r, v);
      });
      for (const k of Object.keys(did) as (keyof typeof did)[]) out[k] += did[k];
    } catch (e) {
      if (isTransientDbError(e)) throw e;
      out.failed++;
      sys.cfg.log?.warn?.("discovery ladder: a target was left as it was", { connector: connectorId, ci: r.ci_id ?? null, asset: r.asset_id ?? null, error: String((e as Error)?.message ?? e).slice(0, 300) });
    }
  }
  if (bookkeeping.length) {
    await sys.write(async (tx) => {
      for (const b of bookkeeping) await storeLadder(tx, org, b.r, b.v);
    }, { internal: true });
  }
  if (opts.runId && out.stale) {
    await db.query(`update sm_discovery_runs set stale_marked = stale_marked + $3, updated_at = now() where org_id = $1 and id = $2`, [org, opts.runId, out.stale]);
  }
  return out;
}

/** The ladder of one connector's targets (job `discovery.stale`, run inside the connector's demo or real scope). */
export async function staleJob(sys: Ctx, connectorId: string, job: Job, jctx: JobContext): Promise<JobResult> {
  try {
    await assertWritable(sys.db, sys.org.id);
  } catch {
    return { again: 15 * 60_000 };
  }
  const r = await runLadder(sys, connectorId, { deadline: jctx.deadline, runId: typeof job.payload?.run === "string" ? job.payload.run : null });
  return r.more ? { again: 0 } : undefined;
}
