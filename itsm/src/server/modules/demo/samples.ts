// What the purge's preview and report call a row (docs/DEMO_FA.md «حذف کامل»): words a person reads — its number and
// its display, a reference resolved to the referenced row's own display (a person's name, a position's, a group's, a
// service's), never an id. A person placed somewhere reads «نگار کارشناس‌پور در «مدیر گروه»» (a holder of a position, a
// member of a group: the display is the person, the row's required reference the place); a row whose display is an
// identifier (a delivery id, a batch id) is named by that place. Every bucket of the preview uses it: the real rows
// deleted with the pack (`planReport` in index.ts), the definitions cleaned and the records routed again (clean.ts).
// One sub-select per reference, through the caller's transaction (PGlite has one connection).
import type { FieldDef, TableDef } from "@shared/model/types";
import { FIELD_TYPES, refTarget } from "@shared/model/types";
import { TABLES } from "@shared/tables";
import type { Queryable } from "../../db";
import { inSavepoint } from "./purge";

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

/** The words of the first `limit` rows `from` selects (alias `x`, a row of `def`); none when the read fails. */
export async function sampleWords(q: Queryable, def: TableDef, from: string, params: unknown[], limit = 3): Promise<string[]> {
  const r = await inSavepoint(q, () => q.query<{ s: string | null }>(`select ${wordsSql(def, "x")} as s ${from} limit ${limit}`, params));
  return r.ok ? r.value.map((x) => x.s ?? "").filter(Boolean) : [];
}

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
