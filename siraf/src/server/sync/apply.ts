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
    // set once the aggregate itself is written: a failure after that (the bar lines below) is no
    // clash of this row and is not retried; the savepoint rolls the whole aggregate back
    let written = false;
    try {
      await savepoint(q, async () => {
        await upsertRoot(q, def.table, row);
        for (const ch of def.children ?? []) await replaceChildren(q, ch.table, ch.fk, agg.id, agg.children?.[ch.table] ?? [], orgId);
        written = true;
        // bar lines carry the bar's number (tag_no): keep them in step with the register
        if (def.entity === "gold_bar") await retagBarLines(q, orgId, agg.id, false);
        else if (def.entity === "gold_doc") await alignDocBarLines(q, agg.id);
      });
      return result;
    } catch (e) {
      if (!isUnique(e) || written || attempt === 3) throw e;
      // PGlite (pg-protocol) names it `constraint`, postgres.js `constraint_name`
      const constraint = String(e.constraint ?? e.constraint_name ?? "");
      if (def.numbered && constraint.includes("_no_")) {
        if (side === "incoming-yields") {
          const to = await nextNo(q, def.table, orgId, String(row.fiscal_year_id), def.numbered.byKind ? String(row.kind) : undefined);
          result.renumbered = { column: "no", from: row.no, to };
          row.no = to;
        } else {
          await savepoint(q, () => moveLocalAside(q, def, orgId, row, "no"));
        }
        continue;
      }
      if (def.table === "tz_org_members" && constraint === "tz_org_members_uk" && side === "local-yields") {
        // the same person already has a local membership under another id (a local account that
        // the cloud account replaced): the cloud's membership is the one that counts
        await q.query(`delete from tz_org_members where org_id = $1 and user_id = $2 and id <> $3`, [orgId, row.user_id, agg.id]);
        await q.query(`delete from tz_outbox where entity = 'member' and id not in (select id from tz_org_members)`);
        continue;
      }
      if (def.table === "tz_items" && constraint.includes("rate_key")) {
        // a board key belongs to one product: the later edit keeps it (updated_at, which syncs
        // unchanged). When the row being written is the later one, the other holder loses the key
        // (on a Windows app it is queued, so the cloud hears of it); otherwise the row being
        // written comes without it — on the cloud the pushing app is told (`renumbered`), on a
        // Windows app the local holder's push makes the cloud drop it there too
        const holder = await q.one<{ updated_at: string }>(
          `select updated_at from tz_items where org_id = $1 and id <> $2 and rate_key = $3 and deleted_at is null`,
          [orgId, agg.id, row.rate_key],
        );
        if (holder && isOlder(row.updated_at, holder.updated_at)) {
          if (side === "incoming-yields") result.renumbered = { column: "rate_key", from: row.rate_key, to: null };
          row.rate_key = null;
        } else {
          await savepoint(q, () => moveLocalAside(q, def, orgId, row, "rate_key", side === "local-yields"));
        }
        continue;
      }
      if (def.code && (constraint.includes("code") || constraint.includes("tag"))) {
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

/** Whether a row's updated_at is strictly earlier than another's (a row without one is not). */
function isOlder(a: unknown, b: unknown): boolean {
  const ta = a == null ? NaN : new Date(a as string | Date).getTime();
  const tb = b == null ? NaN : new Date(b as string | Date).getTime();
  return Number.isFinite(ta) && Number.isFinite(tb) && ta < tb;
}

/** Next free code; a bar number is never reused, so soft-deleted bars count (as in nextBarNo). */
async function nextFreeCode(q: Queryable, def: AggregateDef, orgId: string): Promise<string> {
  const column = def.code!.column;
  const start = def.code!.start || 1;
  if (def.entity !== "gold_bar") return nextCode(q, def.table, orgId, start, column);
  const r = await q.one<{ n: string | null }>(
    `select max(${ident(column)}::numeric) as n from ${ident(def.table)} where org_id = $1 and ${ident(column)} ~ '^[0-9]{1,15}$'`,
    [orgId],
  );
  return String(Math.max(r?.n ? Number(r.n) + 1 : start, start));
}

/**
 * Document lines of a bar carry its number (tag_no, and extra.bar.bar_no on the line that
 * brought it in): after the bar was renumbered they follow, and their documents get a new
 * revision (cloud) or are queued for upload (`queue`, desktop) so the other side sees it too.
 */
async function retagBarLines(q: Queryable, orgId: string, barId: string, queue: boolean) {
  const docs = await q.query<{ doc_id: string }>(
    `update tz_gold_lines l set tag_no = b.bar_no,
       extra = case when l.extra->'bar' ? 'bar_no' then jsonb_set(l.extra, '{bar,bar_no}', to_jsonb(b.bar_no)) else l.extra end
     from tz_gold_bars b
     where b.id = $2 and l.org_id = $1 and l.gold_bar_id = b.id
       and (l.tag_no is distinct from b.bar_no or (l.extra->'bar' ? 'bar_no' and l.extra->'bar'->>'bar_no' is distinct from b.bar_no))
     returning l.doc_id`,
    [orgId, barId],
  );
  const ids = [...new Set(docs.map((d) => d.doc_id))];
  if (!ids.length) return;
  const arr = `{${ids.join(",")}}`;
  // an update of the root assigns a new revision on the cloud (taraz.applying keeps updated_at)
  await q.query(`update tz_gold_docs set rev = rev where id = any($1::uuid[])`, [arr]);
  if (queue) {
    await q.query(
      `insert into tz_outbox (entity, id, changed_at) select 'gold_doc', id, now() from tz_gold_docs where id = any($1::uuid[])
       on conflict (entity, id) do update set changed_at = now()`,
      [arr],
    );
  }
}

/** The bar lines of a written document take the current numbers of their bars. */
async function alignDocBarLines(q: Queryable, docId: string) {
  await q.query(
    `update tz_gold_lines l set tag_no = b.bar_no,
       extra = case when l.extra->'bar' ? 'bar_no' then jsonb_set(l.extra, '{bar,bar_no}', to_jsonb(b.bar_no)) else l.extra end
     from tz_gold_bars b
     where l.doc_id = $1 and l.gold_bar_id = b.id and b.org_id = l.org_id
       and (l.tag_no is distinct from b.bar_no or (l.extra->'bar' ? 'bar_no' and l.extra->'bar'->>'bar_no' is distinct from b.bar_no))`,
    [docId],
  );
}

async function moveLocalAside(q: Queryable, def: AggregateDef, orgId: string, incoming: Record<string, unknown>, column: string, queue = true) {
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
  const clash = await q.one<{ id: string }>(`select id from ${ident(def.table)} where ${cond}`, params);
  if (!clash) return;
  let to: unknown;
  if (column === "no") to = await nextNo(q, def.table, orgId, String(incoming.fiscal_year_id), def.numbered?.byKind ? String(incoming.kind) : undefined);
  else if (column === "rate_key") to = null;
  else to = await nextFreeCode(q, def, orgId);
  await q.query(`update ${ident(def.table)} set ${ident(column)} = $2 where id = $1`, [clash.id, to]);
  if (queue) {
    await q.query(
      `insert into tz_outbox (entity, id, changed_at) values ($1, $2, now()) on conflict (entity, id) do update set changed_at = now()`,
      [def.entity, clash.id],
    );
  }
  if (def.entity === "gold_bar") await retagBarLines(q, orgId, clash.id, queue);
}
