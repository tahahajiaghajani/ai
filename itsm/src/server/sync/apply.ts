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

/**
 * Only the columns the payload carries are written: a row from a runtime on an older schema
 * (without a column added since) takes the column's default on insert and keeps the stored
 * value on update, instead of NULL (which a NOT NULL column refuses).
 */
async function upsertRoot(q: Queryable, table: string, row: Record<string, unknown>) {
  const cols = (await tableColumns(q, table)).filter((c) => c === "id" || Object.prototype.hasOwnProperty.call(row, c));
  const set = cols.filter((c) => c !== "id").map((c) => `${ident(c)} = excluded.${ident(c)}`).join(", ");
  const list = cols.map(ident).join(", ");
  await q.query(
    `insert into ${ident(table)} (${list}) select ${list} from jsonb_populate_record(null::${ident(table)}, $1::jsonb)
     on conflict (id) do ${set ? `update set ${set}` : "nothing"}`,
    [JSON.stringify(row)],
  );
}

async function replaceChildren(q: Queryable, table: string, fk: string, parentId: string, rows: Record<string, unknown>[], orgId: string) {
  await q.query(`delete from ${ident(table)} where ${ident(fk)} = $1`, [parentId]);
  if (!rows.length) return;
  const all = await tableColumns(q, table);
  const fixed = rows.map((r) => ({ ...r, ...(all.includes("org_id") ? { org_id: orgId } : {}), [fk]: parentId }));
  // chunks keep single statements small
  for (let i = 0; i < fixed.length; i += 500) {
    const chunk = fixed.slice(i, i + 500);
    // columns missing from every row of the payload (older schema) take their defaults
    const cols = all.filter((c) => chunk.some((r) => Object.prototype.hasOwnProperty.call(r, c)));
    const list = cols.map(ident).join(", ");
    await q.query(
      `insert into ${ident(table)} (${list}) select ${list} from jsonb_populate_recordset(null::${ident(table)}, $1::jsonb)`,
      [JSON.stringify(chunk)],
    );
  }
}

function isUnique(e: unknown): e is { code: string; constraint?: string; constraint_name?: string } {
  return !!e && typeof e === "object" && (e as { code?: string }).code === "23505";
}

let sp = 0;
async function savepoint<T>(q: Queryable, fn: () => Promise<T>): Promise<T> {
  const name = `sm_sp_${++sp}`;
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
 * Write one aggregate. On a unique clash (record number or code):
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
  if (def.table === "sm_orgs") {
    row.id = orgId;
  } else row.org_id = orgId;
  const result: WriteResult = {};
  for (let attempt = 0; attempt < 4; attempt++) {
    // set once the aggregate itself is written: a failure after that (a module's follow-up in `afterWrite`)
    // is no clash of this row and is not retried; the savepoint rolls the whole aggregate back
    let written = false;
    try {
      await savepoint(q, async () => {
        await upsertRoot(q, def.table, row);
        for (const ch of def.children ?? []) await replaceChildren(q, ch.table, ch.fk, agg.id, agg.children?.[ch.table] ?? [], orgId);
        written = true;
        await afterWrite.get(def.entity)?.(q, orgId, agg.id);
      });
      return result;
    } catch (e) {
      if (!isUnique(e) || written || attempt === 3) throw e;
      // PGlite (pg-protocol) names it `constraint`, postgres.js `constraint_name`
      const constraint = String(e.constraint ?? e.constraint_name ?? "");
      if (def.numbered && constraint.includes("_no_")) {
        if (side === "incoming-yields") {
          const to = def.nextNumber ? await def.nextNumber(q, orgId, row) : await nextNo(q, def.table, orgId, def.numbered.byKind ? String(row.kind) : undefined);
          result.renumbered = { column: "no", from: row.no, to };
          row.no = to;
        } else {
          await savepoint(q, () => moveLocalAside(q, def, orgId, row, "no"));
        }
        continue;
      }
      if (def.table === "sm_org_members" && constraint === "sm_org_members_uk" && side === "local-yields") {
        // the same person already has a local membership under another id (a local account that
        // the cloud account replaced): the cloud's membership is the one that counts
        await q.query(`delete from sm_org_members where org_id = $1 and user_id = $2 and id <> $3`, [orgId, row.user_id, agg.id]);
        await q.query(`delete from sm_outbox where entity = 'member' and id not in (select id from sm_org_members)`);
        continue;
      }
      if (def.code && constraint.includes(def.code.column)) {
        const column = def.code.column;
        if (side === "incoming-yields") {
          const to = await nextFreeCode(q, def, orgId);
          result.renumbered = { column, from: row[column], to };
          row[column] = to;
        } else {
          await savepoint(q, () => moveLocalAside(q, def, orgId, row, column));
        }
        continue;
      }
      throw e;
    }
  }
  return result;
}

/** Next free code of an aggregate with a code column. */
async function nextFreeCode(q: Queryable, def: AggregateDef, orgId: string): Promise<string> {
  return nextCode(q, def.table, orgId, def.code!.start || 1, def.code!.column);
}

/**
 * Follow-ups a module needs after one of its aggregates was written by synchronisation (e.g. keeping a
 * denormalised copy in step), run inside the aggregate's savepoint. Keyed by entity.
 */
export const afterWrite = new Map<string, (q: Queryable, orgId: string, id: string) => Promise<void>>();

async function moveLocalAside(q: Queryable, def: AggregateDef, orgId: string, incoming: Record<string, unknown>, column: string, queue = true) {
  const params: unknown[] = [orgId, incoming.id, incoming[column]];
  let cond = `org_id = $1 and id <> $2 and ${ident(column)} = $3 and deleted_at is null`;
  if (column === "no" && def.numbered?.byKind) {
    params.push(incoming.kind);
    cond += ` and kind = $${params.length}`;
  }
  const clash = await q.one<{ id: string }>(`select id from ${ident(def.table)} where ${cond}`, params);
  if (!clash) return;
  const to = column === "no"
    ? def.nextNumber
      ? await def.nextNumber(q, orgId, incoming)
      : await nextNo(q, def.table, orgId, def.numbered?.byKind ? String(incoming.kind) : undefined)
    : await nextFreeCode(q, def, orgId);
  await q.query(`update ${ident(def.table)} set ${ident(column)} = $2 where id = $1`, [clash.id, to]);
  if (queue) {
    await q.query(
      `insert into sm_outbox (entity, id, changed_at) values ($1, $2, now()) on conflict (entity, id) do update set changed_at = now()`,
      [def.entity, clash.id],
    );
  }
}
