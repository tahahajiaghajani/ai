// Conditions → SQL, and the other SQL pieces of the record engine (column expressions, dot-walks, readable rows,
// text search, sort). `toSql` follows exactly the semantics `evaluate` implements (src/shared/model/conditions.ts);
// tests/engine-conditions.test.ts runs both on the same fixtures. Everything is parameterised: values go into
// `params` ($n), identifiers come from table definitions (validated at registration), never from requests.
import { createHash } from "node:crypto";
import type { FieldDef, FieldType, TableDef } from "@shared/model/types";
import { FIELD_TYPES, refTarget } from "@shared/model/types";
import {
  condField, envNow, envTz, normalizeSearch, operand, relativeWindow, resolvePath, SEARCH_FROM, SEARCH_TO,
  type Cond, type CondEnv, type Leaf, type Lookup,
} from "@shared/model/conditions";
import { windowDates, windowInstants } from "@shared/model/jalali-buckets";
import { tableDef, USER_DEF } from "@shared/tables";
import { pgArray } from "../db";
import type { Ctx } from "../context";
import { access, isSystem } from "../access/provider";
import { bad } from "../http/errors";

/** Push a parameter and return its placeholder. */
export function ph(params: unknown[], v: unknown): string {
  params.push(v);
  return `$${params.length}`;
}

const CASTS: Partial<Record<FieldType, string>> = {
  int: "integer", rating: "integer", duration: "bigint",
  decimal: "numeric", money: "numeric", percent: "numeric",
  bool: "boolean", date: "date", datetime: "timestamptz",
  ref: "uuid", user: "uuid", group: "uuid",
};
/** The SQL type a value of `type` is compared as. */
export const castOf = (type: FieldType) => CASTS[type] ?? "text";

/** `translate(x, …)`: the SQL twin of `normalizeSearch` (lower-cased ASCII, Persian digits and letters unified). */
export function normSql(expr: string): string {
  return `translate(${expr}, '${SEARCH_FROM}', '${SEARCH_TO}')`;
}

/** Escape LIKE wildcards (the default escape character is the backslash). */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Column expression of a field of `def` on the row aliased `alias` (custom fields read from `custom`). */
export function fieldExpr(def: TableDef, f: FieldDef, alias: string): string {
  if (def.virtual) {
    // the virtual user table: `alias` is a sm_org_members row
    if (f.name === "name") return `(select coalesce(nullif(su.full_name, ''), su.email) from sm_users su where su.id = ${alias}.user_id)`;
    if (f.name === "email") return `(select su.email from sm_users su where su.id = ${alias}.user_id)`;
    return `${alias}.${f.name}`;
  }
  if (f.custom) {
    const info = FIELD_TYPES[f.type];
    if (info.array || info.family === "json") return `(${alias}.custom -> '${f.name}')`;
    const text = `(${alias}.custom ->> '${f.name}')`;
    const cast = castOf(f.type);
    return cast === "text" ? text : `(${text})::${cast}`;
  }
  return `${alias}.${f.name}`;
}

export interface SqlOptions {
  /** apply the access provider (and row rules) to the rows a dot-walk reaches; omit for system queries */
  ctx?: Ctx;
  lookup?: Lookup;
  /** the alias of the outermost row (its org_id scopes dot-walks); defaults to the alias given */
  root?: string;
  /**
   * The predicate is only a row filter (WHERE / ON, never negated by the caller nor selected as a value): leaves at a
   * positive position (under an even number of `not`) are plain comparisons — `t.assignment_group_id = any($2)`,
   * `t.active = $3` — that indexes answer, instead of `coalesce(…, false)`. A filter selects the same rows either way
   * (a NULL leaf there is as good as false: AND/OR never turn it into true); negated leaves keep their coalesce, so
   * `not` composes exactly like `evaluate`. Default off: callers that select a condition as a value keep NULL-free SQL.
   */
  filter?: boolean;
  /** internal: the leaf sits under an odd number of `not` */
  negated?: boolean;
}

let aliasSeq = 0;
const nextAlias = () => `w${(aliasSeq = (aliasSeq + 1) % 1_000_000)}`;

/**
 * Expression of a field path ("f", "ref.f", "ref.ref.f") on `alias`. A dot-walk is a correlated subquery on the
 * referenced row of the same organisation that is not deleted and — with `opts.ctx` — readable by the caller.
 */
export function pathExpr(def: TableDef, path: string, alias: string, params: unknown[], env: CondEnv, opts: SqlOptions = {}): { expr: string; field: FieldDef; def: TableDef } {
  const r = resolvePath(def, path, opts.lookup);
  if (!r) throw new Error(`unknown field path "${path}" on ${def.key}`);
  const root = opts.root ?? alias;
  const walk = (at: TableDef, a: string, parts: string[]): string => {
    const f = (parts.length === 1 ? condField(at, parts[0]) : at.fields.find((x) => x.name === parts[0]))!;
    const base = fieldExpr(at, f, a);
    if (parts.length === 1) return base;
    const targetKey = refTarget(f, at.key)!;
    const target = targetKey === at.key ? at : targetKey === "user" ? USER_DEF : (opts.lookup ?? tableDef)(targetKey)!;
    const b = nextAlias();
    const inner = walk(target, b, parts.slice(1));
    const guard = opts.ctx ? ` and ${readable(opts.ctx, target, b, params, env)}` : ` and ${b}.deleted_at is null`;
    if (target.virtual) {
      return `(select ${inner} from sm_org_members ${b} where ${b}.user_id = ${base} and ${b}.org_id = ${root}.org_id${guard})`;
    }
    return `(select ${inner} from ${target.table} ${b} where ${b}.id = ${base} and ${b}.org_id = ${root}.org_id${guard})`;
  };
  return { expr: walk(def, alias, path.split(".")), field: r.field, def: r.def };
}

const iso = (ms: number) => new Date(ms).toISOString();

function leafSql(leaf: Leaf, def: TableDef, alias: string, params: unknown[], env: CondEnv, opts: SqlOptions): string {
  const mark = params.length;
  const sql = leafBody(leaf, def, alias, params, env, opts);
  // a test that compiles to a constant (an empty «my groups», an invalid operand…) does not use the dot-walk's
  // subquery — drop the parameters it pushed (the linked table's access check), or PostgreSQL rejects the query for
  // parameters it cannot type
  if (params.length > mark && !placeholdersAbove(sql, mark)) params.length = mark;
  return sql;
}

/** Does `sql` reference a placeholder numbered above `mark`? */
function placeholdersAbove(sql: string, mark: number): boolean {
  for (const m of sql.matchAll(/\$(\d+)/g)) if (Number(m[1]) > mark) return true;
  return false;
}

function leafBody(leaf: Leaf, def: TableDef, alias: string, params: unknown[], env: CondEnv, opts: SqlOptions): string {
  const { expr, field, def: owner } = pathExpr(def, leaf.f, alias, params, env, opts);
  const type = field.type;
  const info = FIELD_TYPES[type];
  const array = !!info.array;
  const cast = castOf(type);
  const p = (v: unknown) => ph(params, v);
  let op = leaf.op;
  if (array && op === "eq") op = "contains";
  if (array && op === "ne") op = "ncontains";
  const val = (v: unknown) => operand(type, v, env);
  const values = (v: unknown) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
  const empty = () => {
    if (info.family === "json") return `(${expr} is null or ${expr} = 'null'::jsonb or ${expr} = '{}'::jsonb or ${expr} = '[]'::jsonb)`;
    if (array) return `(${expr} is null or ${expr} = '[]'::jsonb)`;
    if (info.sql === "text") return `(${expr} is null or ${expr} = '')`;
    return `(${expr} is null)`;
  };
  const eq = (v: unknown): string => {
    const o = val(v);
    if (o === undefined) return "false";
    if (type === "datetime") return nn(`${expr} >= ${p(iso(o as number))}::timestamptz and ${expr} < ${p(iso((o as number) + 1))}::timestamptz`);
    return nn(`${expr} = ${p(o)}::${cast}`);
  };
  const anyOf = (ids: string[]) => {
    const clean = ids.map((x) => String(x).toLowerCase()).filter((x) => /^[0-9a-f-]{36}$/.test(x));
    if (!clean.length) return "false";
    if (array) return nn(`${expr} ?| ${p(pgArray(clean))}::text[]`);
    return nn(`${expr} = any(${p(pgArray(clean))}::uuid[])`);
  };
  // a plain comparison where a NULL is as good as false (a positive leaf of a filter): indexes can answer it
  const plain = !!opts.filter && !opts.negated && op !== "ne" && op !== "nin" && op !== "ncontains";
  const nn = (x: string) => (plain ? `(${x})` : `coalesce(${x}, false)`);
  const text = (pattern: string) => nn(`${normSql(`${expr}::text`)} like ${p(pattern)}`);
  const userish = type === "user" || type === "users";
  switch (op) {
    case "empty":
      return empty();
    case "nempty":
      return `not ${empty()}`;
    case "eq":
      return eq(leaf.v);
    case "ne":
      return `not ${eq(leaf.v)}`;
    case "contains":
    case "ncontains": {
      let hit: string;
      if (array) {
        const o = val(leaf.v);
        hit = o === undefined ? "false" : nn(`${expr} @> jsonb_build_array(${p(String(o))}::text)`);
      } else hit = text(`%${likeEscape(normalizeSearch(leaf.v))}%`);
      return op === "contains" ? hit : `not ${hit}`;
    }
    case "starts":
      return text(`${likeEscape(normalizeSearch(leaf.v))}%`);
    case "ends":
      return text(`%${likeEscape(normalizeSearch(leaf.v))}`);
    case "in":
    case "nin": {
      const list = values(leaf.v).map((x) => val(x)).filter((x) => x !== undefined) as unknown[];
      let hit: string;
      if (!list.length) hit = "false";
      else if (array) hit = nn(`${expr} ?| ${p(pgArray(list.map(String)))}::text[]`);
      else if (type === "datetime") hit = `(${list.map((x) => eq(x)).join(" or ")})`;
      else hit = nn(`${expr} = any(${p(pgArray(list as (string | number)[]))}::${cast}[])`);
      return op === "in" ? hit : `not ${hit}`;
    }
    case "lt":
    case "lte":
    case "gt":
    case "gte": {
      const o = val(leaf.v);
      if (o === undefined || array) return "false";
      if (type === "datetime") {
        const ms = o as number;
        const bound = op === "lt" || op === "gte" ? ms : ms + 1;
        return nn(`${expr} ${op === "lt" || op === "lte" ? "<" : ">="} ${p(iso(bound))}::timestamptz`);
      }
      const sym = { lt: "<", lte: "<=", gt: ">", gte: ">=" }[op];
      return nn(`${expr} ${sym} ${p(o)}::${cast}`);
    }
    case "between": {
      const [a, b] = values(leaf.v).map((x) => val(x));
      if (a === undefined || b === undefined || array) return "false";
      if (type === "datetime") return nn(`${expr} >= ${p(iso(a as number))}::timestamptz and ${expr} < ${p(iso((b as number) + 1))}::timestamptz`);
      return nn(`${expr} >= ${p(a)}::${cast} and ${expr} <= ${p(b)}::${cast}`);
    }
    case "relative": {
      const w = relativeWindow(leaf.v);
      if (!w) return "false";
      if (type === "datetime") {
        const r = windowInstants(w, envNow(env), envTz(env));
        return nn(`${expr} >= ${p(iso(r.from))}::timestamptz and ${expr} < ${p(iso(r.to))}::timestamptz`);
      }
      const r = windowDates(w, envNow(env), envTz(env));
      return nn(`${expr} >= ${p(r.from)}::date and ${expr} < ${p(r.to)}::date`);
    }
    case "is_me":
      return env.userId ? anyOf([env.userId]) : "false";
    case "is_my_group":
      return anyOf(env.groups ?? []);
    case "in_my_groups":
      return anyOf(userish ? env.groupUsers ?? [] : env.groups ?? []);
    case "in_my_unit":
      return anyOf(userish ? env.unitUsers ?? [] : env.unitId ? [env.unitId] : []);
    case "in_my_unit_tree":
      return anyOf(userish ? env.unitTreeUsers ?? [] : env.unitTree ?? []);
    case "in_my_unit_line":
      return anyOf(env.unitLine ?? []);
    case "is_my_location":
      return anyOf(env.locations ?? []);
    case "changed":
    case "changes_to":
    case "changes_from":
      throw new Error(`"${op}" compares with the previous row and has no SQL form (${owner.key}.${field.name})`);
    default:
      return "false";
  }
}

/**
 * A parameterised SQL predicate for `cond` on the rows of `def` aliased `alias` — never NULL, so `not` composes
 * exactly like `evaluate`. Validate the condition first (`validateCond`): unknown fields throw here.
 */
export function toSql(cond: Cond | null | undefined, def: TableDef, alias: string, params: unknown[], env: CondEnv = {}, opts: SqlOptions = {}): string {
  if (!cond) return "true";
  if ("and" in cond) return cond.and.length ? `(${cond.and.map((c) => toSql(c, def, alias, params, env, opts)).join(" and ")})` : "true";
  if ("or" in cond) return cond.or.length ? `(${cond.or.map((c) => toSql(c, def, alias, params, env, opts)).join(" or ")})` : "false";
  if ("not" in cond) return `(not ${toSql(cond.not, def, alias, params, env, { ...opts, negated: !opts.negated })})`;
  return `(${leafSql(cond, def, alias, params, env, opts)})`;
}

/**
 * Rows of `def` (aliased `alias`) the caller may read: the access provider's predicate, the table's row rule and —
 * unless `deleted: "any"` — only live rows. Every read path of the engine starts here.
 */
export function readable(ctx: Ctx, def: TableDef, alias: string, params: unknown[], env: CondEnv, opts: { deleted?: "live" | "any" } = {}): string {
  const parts = [access().readWhere(ctx, def, alias, params)];
  if (opts.deleted !== "any") parts.push(`${alias}.deleted_at is null`);
  if (def.rowAccess?.read && !isSystem(ctx) && !(def.rowAccess.managersReadAll && access().canCreate(ctx, def, null))) parts.push(toSql(def.rowAccess.read, def, alias, params, env, { ctx, filter: true }));
  return parts.map((x) => `(${x})`).join(" and ");
}

/** Rows the caller may change on top of `canWrite`: the table's write row rule (true when it has none). */
export function writableRule(ctx: Ctx, def: TableDef, alias: string, params: unknown[], env: CondEnv): string {
  if (!def.rowAccess?.write || isSystem(ctx)) return "true";
  return toSql(def.rowAccess.write, def, alias, params, env, { ctx });
}

/**
 * The built-in fields the search box looks in (text `search` fields, else the display field) — the same list for every
 * organisation, so a trigram index can hold their text (ddl.ts `searchIndex`); custom search fields come on top.
 */
export function searchFieldsOf(def: TableDef): FieldDef[] {
  const text = (f: FieldDef) => FIELD_TYPES[f.type].sql === "text" && f.type !== "secret" && !f.base && !f.custom;
  const fields = def.fields.filter((f) => f.search && text(f));
  if (fields.length) return fields;
  return def.fields.filter((f) => f.name === def.display && text(f));
}

/** The normalised text of `fields` on the row aliased `alias` (null: the bare columns): `translate(coalesce(a, '') || ' ' || …)`. */
export function searchDoc(fields: FieldDef[], alias: string | null): string {
  const col = (name: string) => (alias ? `${alias}.${name}` : name);
  return normSql(fields.map((f) => `coalesce(${col(f.name)}, '')`).join(` || ' ' || `));
}

/**
 * The stored search document of a numbered table: a generated column (ddl.ts) holding `searchDoc` of its built-in
 * search fields, normalised once when a row is written — PostgreSQL computes it on every write path (the engine, a
 * Windows app's push, imports) — so a search reads a plain column instead of normalising every candidate row
 * (`translate` costs ~25 µs a row; a `like` on the stored text ~1 µs) and a trigram index answers it. Its name
 * carries a hash of the expression: changed search fields make a new column (and index), the old one is dropped.
 * Null for tables without one (not numbered, or no text search field).
 */
export function searchColumn(def: TableDef): { name: string; expr: string } | null {
  if (def.virtual || !def.numbered) return null;
  const fields = searchFieldsOf(def);
  if (!fields.length) return null;
  const expr = searchDoc(fields, null);
  return { name: `search_${createHash("sha256").update(expr).digest("hex").slice(0, 8)}`, expr };
}

/** A stored search column's name (they never leave the engine: rows drop them in `fromDb` and the sync pull). */
export const SEARCH_COLUMN = /^search_[0-9a-f]{8}$/;

/**
 * Text search: every word must appear in one of the `search` fields (or the display field), compared with
 * Persian normalisation; a record number (TODO0000012, 12) or an id matches exactly. Each word is a `like` on the
 * indexed document of the built-in search fields (a trigram index answers it on PostgreSQL), checked again on the
 * fields the caller sees when some are hidden from them; custom search fields are searched besides.
 */
export function searchSql(def: TableDef, alias: string, q: string, params: unknown[], visible: (f: FieldDef) => boolean = () => true): string | null {
  const raw = String(q ?? "").trim().slice(0, 200);
  if (!raw) return null;
  // a full record number with its prefix (TODO0000012, todo-12) is looked up by number alone (an index lookup)
  if (def.numbered && new RegExp(`^${def.numbered.prefix.toLowerCase().replace(/[-_]/g, "[-_]?")}[-_ ]?\\d+$`).test(normalizeSearch(raw).trim())) {
    const no = parseNumber(def, raw);
    if (no !== null) return `${alias}.no = ${ph(params, no)}::integer`;
  }
  const terms = normalizeSearch(raw).split(/\s+/).filter(Boolean).slice(0, 8);
  if (!terms.length) return null;
  const builtIn = searchFieldsOf(def);
  const seen = builtIn.filter(visible);
  const stored = searchColumn(def);
  // the built-in fields: the stored document (one `like` on a column a trigram index answers), checked again on the
  // fields the caller sees when some are hidden from them; without a stored column (tables that are not numbered),
  // the document is computed as before
  const builtInDoc = stored ? `${alias}.${stored.name}` : builtIn.length ? searchDoc(builtIn, alias) : null;
  const shownDoc = !seen.length ? null : seen.length === builtIn.length ? null : searchDoc(seen, alias);
  const customs = def.fields.filter((f) => f.search && f.custom && FIELD_TYPES[f.type].sql === "text" && f.type !== "secret" && visible(f));
  const customDoc = customs.length ? normSql(`concat_ws(' ', ${customs.map((f) => fieldExpr(def, f, alias)).join(", ")})`) : null;
  // custom values: the normalised text of the row's `custom` (a small partial trigram index holds it) narrows the rows,
  // the custom search fields decide; a word with a quote or a backslash is escaped in that JSON text, so it skips it
  const customIdx = normSql(`${alias}.custom::text`);
  const ors: string[] = [];
  if (seen.length || customDoc) {
    ors.push(
      `(${terms
        .map((t) => {
          const pattern = ph(params, `%${likeEscape(t)}%`);
          const arms: string[] = [];
          // a word never spans two fields (it has no spaces): the whole document finds a superset of the shown fields
          if (seen.length && builtInDoc) arms.push(shownDoc ? `(${builtInDoc} like ${pattern} and ${shownDoc} like ${pattern})` : `${builtInDoc} like ${pattern}`);
          // (`custom <> '{}'` is the partial index's own condition: a row without custom values matches nothing here)
          if (customDoc) arms.push(/["\\]/.test(t) ? `${customDoc} like ${pattern}` : `(${alias}.custom <> '{}'::jsonb and ${customIdx} like ${pattern} and ${customDoc} like ${pattern})`);
          return arms.length > 1 ? `(${arms.join(" or ")})` : arms[0];
        })
        .join(" and ")})`,
    );
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) ors.push(`${alias}.id = ${ph(params, raw.toLowerCase())}::uuid`);
  const no = def.numbered ? parseNumber(def, raw) : null;
  if (no !== null) ors.push(`${alias}.no = ${ph(params, no)}::integer`);
  return ors.length ? `(${ors.join(" or ")})` : "false";
}

/** The counter of a record number typed by a user: "TODO0000012", "todo12", "۱۲" → 12 (null otherwise). */
export function parseNumber(def: TableDef, q: string): number | null {
  if (!def.numbered) return null;
  const s = normalizeSearch(q).trim();
  const m = new RegExp(`^(?:${def.numbered.prefix.toLowerCase().replace(/[-_]/g, "[-_]?")})?[-_ ]?0*(\\d{1,9})$`).exec(s);
  return m ? Number(m[1]) : null;
}

/** Fields a list can be sorted by. */
export function sortable(f: FieldDef): boolean {
  const info = FIELD_TYPES[f.type];
  return !info.array && info.family !== "json" && f.type !== "secret" && f.type !== "markdown" && f.type !== "text";
}

/**
 * ORDER BY for "-priority,number": static choices in their option order, users and references by their display
 * text, numbers by their counter, empty values last, ties by id.
 */
export function orderSql(def: TableDef, alias: string, sort: string, params: unknown[], check: (f: FieldDef) => string | null): string {
  const out: string[] = [];
  let lastDir = "desc";
  for (const part of String(sort ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 4)) {
    const desc = part.startsWith("-");
    const name = part.replace(/^[-+]/, "");
    const f = def.fields.find((x) => x.name === name);
    const problem = f ? check(f) : `فیلد «${name}» در «${def.label}» وجود ندارد`;
    if (problem) throw bad(problem);
    const dir = desc ? "desc" : "asc";
    lastDir = dir;
    let expr = fieldExpr(def, f!, alias);
    if (f!.name === "number" && def.numbered) expr = `${alias}.no`;
    else if (f!.type === "choice" && Array.isArray(f!.choices) && f!.choices.length) {
      expr = `array_position(${ph(params, pgArray(f!.choices.map((o) => o.value)))}::text[], ${expr})`;
    } else if (f!.type === "user") {
      expr = `(select coalesce(nullif(su.full_name, ''), su.email) from sm_users su where su.id = ${expr})`;
    } else if (f!.type === "ref") {
      const target = refTarget(f!, def.key);
      const t = target ? tableDef(target) : undefined;
      if (t && !t.virtual) {
        const d = t.fields.find((x) => x.name === t.display);
        if (d && !d.custom) expr = `(select sd.${d.name} from ${t.table} sd where sd.id = ${expr})`;
      }
    }
    // columns that are never empty sort plainly, so the (org_id, updated_at desc) / (org_id, no) indexes serve them
    const notNull = (f!.base && (f!.name === "created_at" || f!.name === "updated_at")) || (f!.name === "number" && def.numbered);
    out.push(notNull ? `${expr} ${dir}` : `${expr} ${dir} nulls last`);
  }
  // ties by id (not needed after the number, which is unique)
  if (!/^\s*-?\+?number\s*$/.test(String(sort ?? "").split(",").filter((x) => x.trim()).pop() ?? "") || !def.numbered) out.push(`${alias}.id ${lastDir}`);
  return out.join(", ");
}
