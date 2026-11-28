// What the purge's preview and report call a row (docs/DEMO_FA.md «حذف کامل»): words a person reads — its number and
// its display, a reference resolved to the referenced row's own display (a person's name, a position's, a group's, a
// service's), never an id. A person placed somewhere reads «نگار کارشناس‌پور در «مدیر گروه»» (a holder of a position, a
// member of a group: the display is the person, the row's required reference the place); a row whose display is an
// identifier (a delivery id, a batch id) is named by that place. Every bucket of the preview uses it: the real rows
// deleted with the pack (`planReport` in index.ts), the definitions cleaned and the records routed again (clean.ts).
// The purge plans as the system, so a report holds references (`SampleRef`: table, id, number), never words: the words
// are read when the report is shown (`sampleTexts`), through the viewer's own read predicate — a row they may not read
// (a confidential case they take no part in, a record of a secure workspace) is named by its number alone.
import type { FieldDef, TableDef } from "@shared/model/types";
import { FIELD_TYPES, refTarget } from "@shared/model/types";
import { TABLES } from "@shared/tables";
import type { Ctx } from "../../context";
import { pgArray, type Queryable } from "../../db";
import { condEnv, orgSchema, readable } from "../../engine";
import { access } from "../../access/provider";
import { inSavepoint, type SampleRef } from "./purge";

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The table a single reference field names ("user" for a person); null for anything else (lists included). */
function target(def: TableDef, f: FieldDef | null | undefined): string | null {
  if (!f || f.base || FIELD_TYPES[f.type]?.family !== "ref" || FIELD_TYPES[f.type]?.array) return null;
  return refTarget(f, def.key);
}

/** An identifier kept as text (a delivery id, a batch id): it has no words of its own. */
const idText = (f: FieldDef) => FIELD_TYPES[f.type]?.family !== "ref" && /(^|_)id$/.test(f.name);

/** The display field of `def` (null: none, or a base column). */
const displayOf = (def: TableDef) => def.fields.find((f) => f.name === def.display && !f.base) ?? null;

/** The place a row is in: its first required single reference that is not the display and not a person. */
const placeOf = (def: TableDef, display: FieldDef | null) => def.fields.find((f) => f !== display && f.required && target(def, f) && target(def, f) !== "user") ?? null;

/** SQL: the words of the row of `table` whose id is `id` (a person's name; any other row's own words). */
function refWords(table: string, id: string, depth: number): string {
  if (table === "user") return `(select coalesce(nullif(u.full_name, ''), u.email) from sm_users u where u.id = ${id})`;
  const def = TABLES.get(table);
  if (!def || def.virtual || depth > 1) return "null";
  const a = `w${depth}`;
  return `(select ${wordsSql(def, a, depth + 1)} from ${ident(def.table)} ${a} where ${a}.id = ${id})`;
}

/** SQL (text, null when it has none): the words of the row aliased `x` of `def` — see the header. */
export function wordsSql(def: TableDef, x: string, depth = 0): string {
  const f = displayOf(def);
  const to = target(def, f);
  const col = f ? `${x}.${ident(f.name)}` : "";
  let own = "null";
  if (f && to) own = refWords(to, col, depth);
  else if (f && !idText(f) && FIELD_TYPES[f.type]?.family !== "ref") own = `(case when ${col}::text ~* '${UUID.source}' then null else nullif(${col}::text, '') end)`;
  const place = placeOf(def, f);
  if (place) {
    const where = refWords(target(def, place)!, `${x}.${ident(place.name)}`, depth);
    // a person in a place: «… در «…»»; a row without words of its own: its place
    if (to === "user") own = `(${own} || coalesce(' در «' || nullif(${where}, '') || '»', ''))`;
    else if (own === "null") own = where;
  }
  const num = def.numbered ? `nullif(${x}.number::text, '')` : "null";
  return `nullif(concat_ws(' — ', ${num}, nullif(${own}, '')), '')`;
}

/** A row of `def` as a report keeps it: by reference, its number when it has one (never its words). */
export function refOf(def: TableDef, row: Record<string, unknown>): SampleRef {
  const n = typeof row.number === "string" && row.number ? row.number : null;
  return { table: def.key, id: String(row.id), ...(n ? { number: n } : {}) };
}

/** The first `limit` rows `from` selects (alias `x`, a row of `def`), by reference; none when the read fails. */
export async function sampleRefs(q: Queryable, def: TableDef, from: string, params: unknown[], limit = 3): Promise<SampleRef[]> {
  const num = def.numbered ? `nullif(x.number::text, '')` : "null";
  const r = await inSavepoint(q, () => q.query<{ id: string; n: string | null }>(`select x.id::text as id, ${num} as n ${from} limit ${limit}`, params));
  return r.ok ? r.value.map((x) => ({ table: def.key, id: x.id, ...(x.n ? { number: x.n } : {}) })) : [];
}

const isRef = (x: unknown): x is SampleRef => !!x && typeof x === "object" && typeof (x as SampleRef).table === "string" && typeof (x as SampleRef).id === "string" && UUID.test((x as SampleRef).id);
export const refKey = (r: Pick<SampleRef, "table" | "id">): string => `${r.table}:${r.id.toLowerCase()}`;

/**
 * The words of the rows a report names, for its viewer (by `refKey`): read through the viewer's read predicate
 * (`readable`, as every list — the access provider's scope and the table's row rule), deleted rows included; a row
 * they may not read, a row that is gone, or a table whose display or place they may not see gets none — the caller
 * names it by its number alone. Through `ctx.db`, outside any transaction (the preview reads after its dry run).
 */
export async function sampleTexts(ctx: Ctx, refs: unknown[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const byTable = new Map<string, Set<string>>();
  for (const r of refs) {
    if (!isRef(r)) continue;
    const ids = byTable.get(r.table) ?? new Set<string>();
    ids.add(r.id.toLowerCase());
    byTable.set(r.table, ids);
  }
  if (!byTable.size) return out;
  const schema = await orgSchema(ctx);
  const env = await condEnv(ctx);
  for (const [table, ids] of byTable) {
    const def = schema.def(table);
    if (!def || def.virtual) continue;
    // the words come from the display and the place: a viewer who may not see one of them gets the number alone
    const visible = access().visibleFields(ctx, def);
    const display = displayOf(def);
    const place = placeOf(def, display);
    if (visible && ((display && !visible.has(display.name)) || (place && !visible.has(place.name)))) continue;
    const params: unknown[] = [pgArray([...ids])];
    const where = readable(ctx, def, "x", params, env, { deleted: "any" });
    const rows = await ctx.db.query<{ id: string; s: string | null }>(`select x.id::text as id, ${wordsSql(def, "x")} as s from ${ident(def.table)} x where x.id = any($1::uuid[]) and ${where}`, params);
    for (const row of rows) if (row.s) out.set(`${table}:${row.id.toLowerCase()}`, row.s.slice(0, 120));
  }
  return out;
}

/** A sample as its viewer reads it (`sampleTexts`): its words, else its number, else nothing (a report's old words too). */
export const sampleText = (s: unknown, texts: Map<string, string>): string | null => (isRef(s) ? (texts.get(refKey(s)) ?? s.number ?? null) : null);

/**
 * The words of a row of `def` held in memory (clean.ts): its number and display as they are when the display is plain
 * text, else read through `wordsSql`; the table's own name when nothing is left (never an id).
 */
export async function rowWords(q: Queryable, def: TableDef, row: Record<string, unknown>): Promise<string> {
  const f = displayOf(def);
  const n = typeof row.number === "string" && row.number ? row.number : null;
  const d = f ? row[f.name] : undefined;
  const text = typeof d === "string" ? d.trim() : d === null || d === undefined || typeof d === "object" ? "" : String(d);
  if (f && !idText(f) && FIELD_TYPES[f.type]?.family !== "ref" && text && !UUID.test(text)) return [n, text].filter(Boolean).join(" — ").slice(0, 120);
  if (typeof row.id === "string" && UUID.test(row.id)) {
    // in its own savepoint, as the samples: a read that fails never stops the purge's step
    const r = await inSavepoint(q, () => q.one<{ s: string | null }>(`select ${wordsSql(def, "x")} as s from ${ident(def.table)} x where x.id = $1`, [row.id]));
    if (r.ok && r.value?.s) return r.value.s.slice(0, 120);
  }
  return (n ?? def.label).slice(0, 120);
}
