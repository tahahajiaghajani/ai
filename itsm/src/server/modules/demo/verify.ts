// The proof of a purge (docs/DEMO_FA.md «حذف کامل», release 1.1.5): after it, no live row of the organisation names a
// removed row anywhere in its columns (`to_jsonb(row)`), outside the trail it keeps by design — history, journal, audit,
// sign-ins, the authorship stamps of real rows — and the snapshots it never rewrites (published workflow and flow
// versions, decision snapshots: `refs.ts` "keep"). The tests run it with the ids the purge removed; it reads every
// table of the organisation, so it is not part of the purge itself on large organisations.
import type { Queryable } from "../../db";
import { physicalTables } from "@shared/tables";
import { archivable, archiveTableOf } from "../../engine/ddl";
import { keptColumns, PLATFORM_KEPT, TRAIL_TABLE_NAMES } from "./refs";

export interface Dangling {
  table: string;
  rows: number;
  /** the columns (json paths, arrays as []) that name a removed row */
  paths: string[];
  /** a few of the rows (their ids) */
  sample: string[];
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Where `id` occurs inside `v` (json paths, list positions as []). */
function pathsOf(v: unknown, id: string, at: string, out: Set<string>): void {
  if (out.size > 8) return;
  if (typeof v === "string") {
    if (v.toLowerCase().includes(id)) out.add(at);
  } else if (Array.isArray(v)) v.forEach((e) => pathsOf(e, id, `${at}[]`, out));
  else if (v && typeof v === "object")
    for (const [k, e] of Object.entries(v)) {
      if (k.toLowerCase() === id) out.add(`${at}.{key}`);
      pathsOf(e, id, `${at}.${k}`, out);
    }
}

/** Tables of the purge's own bookkeeping and the platform's (never the organisation's content). */
const SKIP = new Set(["sm_demo_rows", "sm_demo_packs", "sm_demo_saved", "sm_demo_touched", "sm_migrations", "sm_meta", "sm_kv", "sm_org_sync", "sm_access_state", "sm_numbers"]);

/**
 * Every live row of the organisation `orgId` (outside the trail and the kept snapshots) that names one of `removed`,
 * per table, with the columns that do. Empty: the purge left nothing dangling.
 */
export async function danglingRefs(q: Queryable, orgId: string, removed: Iterable<string>): Promise<Dangling[]> {
  const gone = new Set([...removed].map((x) => x.toLowerCase()));
  if (!gone.size) return [];
  const defs = physicalTables();
  const kept = keptColumns(defs);
  for (const d of defs) if (archivable(d) && kept.has(d.table)) kept.set(archiveTableOf(d), kept.get(d.table)!);
  for (const [t, cols] of Object.entries(PLATFORM_KEPT)) kept.set(t, new Set(["created_by", "updated_by", ...cols]));
  const tables = await q.query<{ t: string; has_id: boolean; has_deleted: boolean }>(
    `select c.table_name as t,
            bool_or(c.column_name = 'id') as has_id,
            bool_or(c.column_name = 'deleted_at') as has_deleted
       from information_schema.columns c
       join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
      where c.table_schema = current_schema() and c.table_name like 'sm\\_%'
      group by c.table_name
     having bool_or(c.column_name = 'org_id')
      order by 1`,
  );
  const out: Dangling[] = [];
  const scan = (table: string, rows: { k: string; j: Record<string, unknown> }[]) => {
    let d: Dangling | null = null;
    const paths = new Set<string>();
    for (const r of rows) {
      const text = JSON.stringify(r.j);
      const hits = [...new Set((text.match(UUID) ?? []).map((s) => s.toLowerCase()))].filter((id) => gone.has(id) && id !== r.k.toLowerCase());
      if (!hits.length) continue;
      d ??= { table, rows: 0, paths: [], sample: [] };
      d.rows++;
      for (const id of hits) pathsOf(r.j, id, "$", paths);
      if (d.sample.length < 3) d.sample.push(r.k);
    }
    if (d) {
      d.paths = [...paths];
      out.push(d);
    }
  };
  for (const { t, has_id, has_deleted } of tables) {
    if (SKIP.has(t) || TRAIL_TABLE_NAMES.has(t)) continue;
    const drop = [...(kept.get(t) ?? new Set(["created_by", "updated_by"]))].map((c) => ` - '${c.replace(/'/g, "''")}'`).join("");
    const rows = await q.query<{ k: string; j: Record<string, unknown> }>(
      `select ${has_id ? "x.id::text" : "md5(to_jsonb(x)::text)"} as k, (to_jsonb(x)${drop}) as j from ${t} x where x.org_id = $1${has_deleted ? " and x.deleted_at is null" : ""}`,
      [orgId],
    );
    scan(t, rows);
  }
  // the organisation's people's own settings (their accounts are not the organisation's rows)
  scan(
    "sm_users",
    await q.query<{ k: string; j: Record<string, unknown> }>(
      `select u.id::text as k, jsonb_build_object('prefs', u.prefs) as j from sm_users u join sm_org_members m on m.user_id = u.id and m.org_id = $1 and m.deleted_at is null`,
      [orgId],
    ),
  );
  return out;
}
