// Reading and writing whole aggregates — shared by the server (applying a desktop's push) and
// the desktop (applying a pull from the cloud). Rows are moved as JSON and written with
// jsonb_populate_record, so every column travels without per-table code.
import type { Queryable } from "../db";
import { ident, nextCode, nextNo } from "../db/sql";
import type { AggregateDef, WireAggregate } from "./registry";

const columnsCache = new Map<string, string[]>();

export async function tableColumns(q: Queryable, table: string): Promise<string[]> {
  const hit = columnsCache.get(table);
  if (hit) return hit;
  const rows = await q.query<{ column_name: string }>(
    `select column_name from information_schema.columns
     where table_schema = current_schema() and table_name = $1 and is_generated = 'NEVER'
     order by ordinal_position`,
    [table],
  );
  const cols = rows.map((r) => r.column_name);
  if (cols.length) columnsCache.set(table, cols);
  return cols;
}

/** Load full aggregates (root + children) by id. */
export async function readAggregates(q: Queryable, def: AggregateDef, ids: string[]): Promise<WireAggregate[]> {
  if (!ids.length) return [];
  const arr = `{${ids.join(",")}}`;
  const roots = await q.query<Record<string, unknown>>(`select * from ${ident(def.table)} where id = any($1::uuid[])`, [arr]);
  const kids: Record<string, Map<string, Record<string, unknown>[]>> = {};
  for (const ch of def.children ?? []) {
    const rows = await q.query<Record<string, unknown>>(`select * from ${ident(ch.table)} where ${ident(ch.fk)} = any($1::uuid[])`, [arr]);
    const m = new Map<string, Record<string, unknown>[]>();
    for (const r of rows) {
      const k = String(r[ch.fk]);
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    kids[ch.table] = m;
  }
  return roots.map((row) => {
    const children: Record<string, Record<string, unknown>[]> = {};
    for (const ch of def.children ?? []) children[ch.table] = kids[ch.table]?.get(String(row.id)) ?? [];
    delete row.org_id_generated;
    return { entity: def.entity, id: String(row.id), base_rev: Number(row.rev ?? 0), row, children };
  });
}

async function upsertRoot(q: Queryable, table: string, row: Record<string, unknown>) {
  const cols = await tableColumns(q, table);
  const set = cols.filter((c) => c !== "id").map((c) => `${ident(c)} = excluded.${ident(c)}`).join(", ");
  const list = cols.map(ident).join(", ");
  await q.query(
    `insert into ${ident(table)} (${list}) select ${list} from jsonb_populate_record(null::${ident(table)}, $1::jsonb)
     on conflict (id) do update set ${set}`,
    [JSON.stringify(row)],
  );
}

async function replaceChildren(q: Queryable, table: string, fk: string, parentId: string, rows: Record<string, unknown>[], orgId: string) {
  await q.query(`delete from ${ident(table)} where ${ident(fk)} = $1`, [parentId]);
  if (!rows.length) return;
  const cols = await tableColumns(q, table);
  const list = cols.map(ident).join(", ");
  const fixed = rows.map((r) => ({ ...r, ...(cols.includes("org_id") ? { org_id: orgId } : {}), [fk]: parentId }));
  // chunks keep single statements small
  for (let i = 0; i < fixed.length; i += 500) {
    await q.query(
      `insert into ${ident(table)} (${list}) select ${list} from jsonb_populate_recordset(null::${ident(table)}, $1::jsonb)`,
      [JSON.stringify(fixed.slice(i, i + 500))],
    );
  }
}

function isUnique(e: unknown): e is { code: string; constraint?: string } {
  return !!e && typeof e === "object" && (e as { code?: string }).code === "23505";
}

let sp = 0;
async function savepoint<T>(q: Queryable, fn: () => Promise<T>): Promise<T> {
  const name = `tz_sp_${++sp}`;
  await q.query(`savepoint ${name}`);
  try {
    const r = await fn();
    await q.query(`release savepoint ${name}`);
    return r;
  } catch (e) {
    await q.query(`rollback to savepoint ${name}`);
    throw e;
  }
}

export interface WriteResult {
  renumbered?: { column: string; from: unknown; to: unknown };
}

/**
 * Write one aggregate. On a unique clash (document number or code):
 * - side "incoming-yields" (server applying a push): the incoming row takes the next free value
 * - side "local-yields" (desktop applying a pull): the local clashing row moves to the next free
 *   value and is queued for push, the cloud row keeps its value
 */
export async function writeAggregate(
  q: Queryable,
  def: AggregateDef,
  agg: WireAggregate,
  orgId: string,
  side: "incoming-yields" | "local-yields",
): Promise<WriteResult> {
  const row: Record<string, unknown> = { ...agg.row, id: agg.id };
  if (def.table === "tz_orgs") {
    row.id = orgId;
  } else row.org_id = orgId;
  const result: WriteResult = {};
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await savepoint(q, async () => {
        await upsertRoot(q, def.table, row);
        for (const ch of def.children ?? []) await replaceChildren(q, ch.table, ch.fk, agg.id, agg.children?.[ch.table] ?? [], orgId);
      });
      return result;
    } catch (e) {
      if (!isUnique(e) || attempt === 3) throw e;
      const constraint = String(e.constraint ?? "");
      if (def.numbered && constraint.includes("_no_")) {
        if (side === "incoming-yields") {
          const to = await nextNo(q, def.table, orgId, String(row.fiscal_year_id), def.numbered.byKind ? String(row.kind) : undefined);
          result.renumbered = { column: "no", from: row.no, to };
          row.no = to;
        } else {
          await moveLocalAside(q, def, orgId, row, "no");
        }
        continue;
      }
      if (def.code && (constraint.includes("code") || constraint.includes("tag"))) {
        const column = def.code.column;
        if (side === "incoming-yields") {
          const to = await nextCode(q, def.table, orgId, def.code.start || 1, column);
          result.renumbered = { column, from: row[column], to };
          row[column] = to;
        } else {
          await moveLocalAside(q, def, orgId, row, column);
        }
        continue;
      }
      throw e;
    }
  }
  return result;
}

async function moveLocalAside(q: Queryable, def: AggregateDef, orgId: string, incoming: Record<string, unknown>, column: string) {
  const params: unknown[] = [orgId, incoming.id, incoming[column]];
  let cond = `org_id = $1 and id <> $2 and ${ident(column)} = $3 and deleted_at is null`;
  if (column === "no") {
    params.push(incoming.fiscal_year_id);
    cond += ` and fiscal_year_id = $${params.length}`;
    if (def.numbered?.byKind) {
      params.push(incoming.kind);
      cond += ` and kind = $${params.length}`;
    }
  }
  const clash = await q.one<{ id: string; fiscal_year_id?: string; kind?: string }>(`select id, ${column === "no" ? "fiscal_year_id, kind" : "null as x"} from ${ident(def.table)} where ${cond}`, params);
  if (!clash) return;
  let to: unknown;
  if (column === "no") to = await nextNo(q, def.table, orgId, String(incoming.fiscal_year_id), def.numbered?.byKind ? String(incoming.kind) : undefined);
  else to = await nextCode(q, def.table, orgId, def.code?.start || 1, column);
  await q.query(`update ${ident(def.table)} set ${ident(column)} = $2 where id = $1`, [clash.id, to]);
  await q.query(
    `insert into tz_outbox (entity, id, changed_at) values ($1, $2, now()) on conflict (entity, id) do update set changed_at = now()`,
    [def.entity, clash.id],
  );
}
