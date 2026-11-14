// The record service: the generic API every table gets (docs/spec/ENGINE.md § Record service). Every function takes
// the request's `ctx`; reads go through the access provider (rows by `readWhere`, fields by `visibleFields`), writes
// through the write pipeline (write.ts) inside `ctx.write`. Responses carry the referenced records' labels in
// `display` (one query per referenced table) and, for a single record, `meta` (what the caller may do with it).
import type { FieldDef, TableDef } from "@shared/model/types";
import type { Cond, CondEnv } from "@shared/model/conditions";
import { validateCond } from "@shared/model/conditions";
import { stateCategory, transitionsFrom } from "@shared/model/task";
import { USER_DEF } from "@shared/tables";
import type { Ctx } from "../context";
import type { Queryable } from "../db";
import { pgArray } from "../db";
import { AppError, bad, forbidden } from "../http/errors";
import { access } from "../access/provider";
import { condEnv, isSystemCtx } from "./env";
import { defFor, type OrgSchema } from "./schema";
import { fieldExpr, orderSql, pathExpr, ph, readable, searchSql, sortable, toSql } from "./sql";
import { RefSet, resolveDisplay } from "./display";
import { canOpenRecords, fromDb, loadReadable, pathVisible, requireReadable, toOutput, type Row } from "./read";
import { metaProvidersFor, redactRows } from "./hooks";
import { createIn, isLocked, removeIn, savepoint, transitionIn, updateIn, type WriteOptions } from "./write";
import { archivable, archiveTableOf } from "./ddl";

export interface ListParams {
  /** a condition (validated against the table; fields the caller may not see are refused) */
  filter?: Cond | null;
  /** search box: words in the `search` fields (Persian-normalised), or a record number / id */
  q?: string;
  /** "-priority,number": fields, "-" for descending (default: the table's list order, else -updated_at) */
  sort?: string;
  page?: number;
  /** rows per page (default 50, at most 500) */
  size?: number;
  /** the fields to return (dot-walks allowed: "caller_id.email"); default every visible field except long texts */
  fields?: string[];
  /** only these ids (pickers resolving their current value) */
  ids?: string[];
  /** a saved view (`view` record) whose filter, search, sort, columns and page size are the defaults */
  view?: string;
  /** count the matching rows (default true) */
  total?: boolean;
  /**
   * Count at most this many matching rows (the HTTP list API passes COUNT_LIMIT): an exact count reads every
   * matching row, so a list of millions is counted up to the limit and reported as `capped` («بیش از ۱۰٬۰۰۰»).
   * Server code that needs the exact number leaves it out.
   */
  countLimit?: number;
  /**
   * The `next` cursor of the previous page (keyset pagination): the page continues right after that row by the sort
   * key instead of skipping `(page − 1) × size` rows — constant time at any depth. Only for sorts on never-empty
   * keys (`updated_at`, `created_at`, `number`, in one direction); otherwise, or when the sort changed, `page` is used.
   */
  after?: string;
  /** read the table's archive (old closed records, engine/archive.ts) instead of the hot table */
  archived?: boolean;
  /**
   * Server-side only (never from a request body): one more SQL condition on the row alias with its parameters — the
   * AI-use rule of a table's records (`aiChannelRule`) when the assistant's generated tools list them.
   */
  where?: ((alias: string, params: unknown[]) => string) | null;
}

export interface ListResult {
  rows: Row[];
  /** matching rows (null when not counted; with `capped`, a lower bound) */
  total: number | null;
  /** more rows match than `total` (the count stopped at `countLimit`) */
  capped?: boolean;
  /** cursor of the next page (`after`), when the sort allows keyset pagination and the page was full */
  next?: string | null;
  page: number;
  size: number;
  /** labels of the referenced records and members in `rows` */
  display: Record<string, string>;
}

export interface RecordMeta {
  canWrite: boolean;
  canDelete: boolean;
  /** fields the caller cannot change on this record */
  readonly: string[];
  /** transitions the caller may take now */
  transitions: { to: string; label: string; requires: string[]; category: string | null }[];
  /** in a locked state: only transitions out of it */
  locked: boolean;
  /** the caller is on the watch list */
  watching?: boolean;
  /** "participant": the caller reads this record only through a participant grant (an approver): no area role */
  reach?: "participant";
  [k: string]: unknown;
}

export interface RecordResult {
  row: Row;
  display: Record<string, string>;
  meta: RecordMeta;
}

const LONG: string[] = ["text", "markdown", "json", "conditions"];

function needTable(ctx: Ctx, def: TableDef): void {
  if (!access().canReadTable(ctx, def)) throw forbidden(`به «${def.plural}» دسترسی ندارید`);
}

/** A filter checked against the table and the caller's field visibility (400 with a Persian reason). */
export function checkFilter(ctx: Ctx, def: TableDef, schema: OrgSchema, filter: unknown): Cond | null {
  if (filter === null || filter === undefined) return null;
  const problem = validateCond(filter, def, { lookup: schema.lookup, visible: (path) => pathVisible(ctx, def, path, schema) });
  if (problem) throw bad(problem);
  return filter as Cond;
}

interface Selection {
  /** select list (aliased) */
  sql: string[];
  /** plain fields returned */
  fields: FieldDef[];
  /** dot-walked paths returned (key = the path) */
  paths: { path: string; field: FieldDef; def: TableDef }[];
}

function selection(ctx: Ctx, def: TableDef, schema: OrgSchema, env: CondEnv, wanted: string[] | undefined, params: unknown[]): Selection {
  const visible = access().visibleFields(ctx, def);
  const sql = ["t.id", "t.version", "t.custom"];
  if (def.numbered) sql.push("t.number", "t.no");
  const fields: FieldDef[] = [];
  const paths: Selection["paths"] = [];
  const names = wanted?.length ? wanted : def.fields.filter((f) => !LONG.includes(f.type) || f.name === def.display).map((f) => f.name);
  const seen = new Set<string>();
  for (const name of names.slice(0, 80)) {
    if (seen.has(name) || name === "id" || name === "number") continue;
    seen.add(name);
    if (name.includes(".")) {
      if (!pathVisible(ctx, def, name, schema)) throw bad(`ستون «${name}» در دسترس نیست`);
      const p = pathExpr(def, name, "t", params, env, { ctx, lookup: schema.lookup });
      if (p.field.type === "secret") throw bad(`ستون «${name}» در دسترس نیست`);
      sql.push(`${p.expr} as "${name}"`);
      paths.push({ path: name, field: p.field, def: p.def });
      continue;
    }
    const f = def.fields.find((x) => x.name === name);
    if (!f) throw bad(`فیلد «${name}» در «${def.label}» وجود ندارد`);
    if (visible && !visible.has(name)) continue;
    fields.push(f);
    if (!f.custom) sql.push(`t.${f.name}`);
  }
  if (def.states && !seen.has(def.states.field)) {
    const f = def.fields.find((x) => x.name === def.states!.field);
    if (f && (!visible || visible.has(f.name))) {
      fields.push(f);
      sql.push(`t.${f.name}`);
    }
  }
  return { sql, fields, paths };
}

function outputSelected(def: TableDef, raw: Row, sel: Selection): Row {
  const row = fromDb(def, raw);
  const out: Row = { id: row.id, version: row.version ?? 1 };
  if (def.numbered) out.number = row.number ?? null;
  const full = toOutput({ ...def, fields: sel.fields }, row, null);
  for (const f of sel.fields) if (f.name in full) out[f.name] = full[f.name];
  for (const p of sel.paths) out[p.path] = raw[p.path] ?? null;
  return out;
}

/** Load a saved view the caller may read (its defaults for a list). */
async function viewDefaults(ctx: Ctx, def: TableDef, viewId: string, env: CondEnv, schema: OrgSchema): Promise<Partial<ListParams>> {
  const viewDef = schema.def("view");
  if (!viewDef) return {};
  const v = await loadReadable(ctx.db, ctx, viewDef, viewId, env);
  if (!v || v.table_key !== def.key) throw bad("نمای ذخیره‌شده پیدا نشد");
  return {
    filter: (v.filter as Cond | null) ?? null,
    q: v.q ?? undefined,
    sort: v.sort ?? undefined,
    fields: Array.isArray(v.columns) ? (v.columns as unknown[]).map(String) : undefined,
    size: v.page_size ?? undefined,
  };
}

/**
 * A page of the records of `table` the caller may read. A participant with a grant of its own (an approver, an asset's
 * holder — no role reads the area) lists exactly the rows it takes part in: the read rule (`readWhere`) of a member
 * whose roles do not read the area is the participant grant alone, so filters, search and pages run over those rows
 * and nothing else. A member with neither gets 403.
 */
export async function list(ctx: Ctx, table: string, p: ListParams = {}): Promise<ListResult> {
  const { def, schema } = await defFor(ctx, table);
  if (!(await canOpenRecords(ctx, def))) needTable(ctx, def);
  const env = await condEnv(ctx);
  if (p.view) {
    const d = await viewDefaults(ctx, def, p.view, env, schema);
    const filter = d.filter && p.filter ? ({ and: [d.filter, p.filter] } as Cond) : (p.filter ?? d.filter ?? null);
    p = { ...d, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)), filter };
  }
  if (def.virtual) return listUsers(ctx, def, schema, env, p);
  const filter = checkFilter(ctx, def, schema, p.filter);
  const size = Math.min(Math.max(Math.trunc(p.size ?? 50) || 50, 1), MAX_PAGE);
  const page = Math.max(Math.trunc(p.page ?? 1) || 1, 1);
  const params: unknown[] = [];
  const where = [readable(ctx, def, "t", params, env)];
  if (filter) where.push(toSql(filter, def, "t", params, env, { ctx, lookup: schema.lookup, filter: true }));
  if (typeof p.where === "function") where.push(p.where("t", params));
  const visible = access().visibleFields(ctx, def);
  if (p.q) {
    const s = searchSql(def, "t", p.q, params, (f) => !visible || visible.has(f.name));
    if (s) where.push(s);
  }
  if (p.ids) {
    const ids = p.ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 500);
    params.push(pgArray(ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]));
    where.push(`t.id = any($${params.length}::uuid[])`);
  }
  const whereSql = where.map((w) => `(${w})`).join(" and ");
  const countParams = [...params];
  const sel = selection(ctx, def, schema, env, p.fields, params);
  const sortSpec = p.sort || def.list?.order || "-updated_at";
  const order = orderSql(def, "t", sortSpec, params, (f) => {
    if (visible && !visible.has(f.name)) return `فیلد «${f.label}» در دسترس نیست`;
    return sortable(f) ? null : `فهرست بر پایهٔ «${f.label}» مرتب نمی‌شود`;
  });
  // keyset pagination: continue after the cursor's row instead of skipping rows (an index range scan at any depth)
  const seek = p.ids ? null : seekOf(def, sortSpec);
  const after = seek ? decodeCursor(p.after, sortSpec, seek.cols.length) : null;
  let pageWhere = whereSql;
  if (seek && after) {
    const lhs = seek.cols.length > 1 ? `(${seek.cols.join(", ")})` : seek.cols[0];
    const rhs = after.map((v, i) => `${ph(params, v)}::${seek.casts[i]}`);
    pageWhere = `${whereSql} and ${lhs} ${seek.dir === "desc" ? "<" : ">"} ${rhs.length > 1 ? `(${rhs.join(", ")})` : rhs[0]}`;
  }
  // the archive has the same columns and the same read rule
  const from = p.archived && archivable(def) ? archiveTableOf(def) : def.table;
  const rows = await ctx.db.query<Row>(
    `select ${[...sel.sql, ...(seek ? seek.select : [])].join(", ")} from ${from} t where ${pageWhere} order by ${order} limit ${size}${after ? "" : ` offset ${(page - 1) * size}`}`,
    params,
  );
  let total: number | null = null;
  let capped = false;
  if (p.total !== false) {
    if (page === 1 && !after && rows.length < size) total = rows.length;
    else if (p.countLimit && p.countLimit > 0) {
      const limit = Math.trunc(p.countLimit);
      const n = Number((await ctx.db.one<{ n: number }>(`select count(*)::int as n from (select 1 from ${from} t where ${whereSql} limit ${limit + 1}) x`, countParams))?.n ?? 0);
      capped = n > limit;
      total = capped ? limit : n;
    } else total = Number((await ctx.db.one<{ n: number }>(`select count(*)::int as n from ${from} t where ${whereSql}`, countParams))?.n ?? 0);
  }
  const last = rows[rows.length - 1];
  const next = seek && rows.length === size && last ? encodeCursor(sortSpec, seek.select.map((_, i) => String(last[`$seek${i}`]))) : null;
  const out = rows.map((r) => outputSelected(def, r, sel));
  await redactRows(ctx.db, ctx, def, out);
  const refs = new RefSet();
  for (const r of out) {
    refs.addRow(def, r, sel.fields);
    for (const x of sel.paths) refs.addRow(x.def, { [x.field.name]: r[x.path] }, [x.field]);
  }
  return { rows: out, total, ...(capped ? { capped } : {}), ...(seek ? { next } : {}), page, size, display: await resolveDisplay(ctx.db, ctx, env, schema, refs) };
}

/** The page size `list` never exceeds. */
export const MAX_PAGE = 500;

/** What the HTTP list API counts up to (beyond it a list says «بیش از ۱۰٬۰۰۰»). */
export const COUNT_LIMIT = 10_000;

/** Sort keys keyset pagination can seek on: never empty, compared as their column type. */
const SEEK_KEYS: Record<string, { col: (def: TableDef) => string; cast: string }> = {
  updated_at: { col: () => "t.updated_at", cast: "timestamptz" },
  created_at: { col: () => "t.created_at", cast: "timestamptz" },
  number: { col: () => "t.no", cast: "integer" },
};

interface Seek {
  /** the sort as given (a cursor only continues the sort it was made for) */
  sort: string;
  /** select-list expressions of the key values (exact text: timestamps keep their microseconds) */
  select: string[];
  /** columns compared, in order */
  cols: string[];
  casts: string[];
  dir: "asc" | "desc";
}

/** The keyset of a sort ("-updated_at", "number"…), or null when the sort cannot be sought. */
function seekOf(def: TableDef, sort: string): Seek | null {
  const parts = sort.split(",").map((x) => x.trim()).filter(Boolean);
  if (parts.length !== 1) return null;
  const desc = parts[0].startsWith("-");
  const name = parts[0].replace(/^[-+]/, "");
  const key = SEEK_KEYS[name];
  if (!key || (name === "number" && !def.numbered) || !def.fields.some((f) => f.name === name)) return null;
  const col = key.col(def);
  // the number is unique; the instants are tied by the id (as orderSql orders them)
  const cols = name === "number" ? [col] : [col, "t.id"];
  const casts = name === "number" ? [key.cast] : [key.cast, "uuid"];
  return { sort, select: cols.map((c, i) => `${c}::text as "$seek${i}"`), cols, casts, dir: desc ? "desc" : "asc" };
}

const encodeCursor = (sort: string, values: string[]) => Buffer.from(JSON.stringify({ s: sort, v: values })).toString("base64url");

function decodeCursor(cursor: string | undefined, sort: string, n: number): string[] | null {
  if (!cursor) return null;
  try {
    const c = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { s?: unknown; v?: unknown };
    if (c.s !== sort || !Array.isArray(c.v) || c.v.length !== n || c.v.some((x) => typeof x !== "string" || x.length > 64)) return null;
    return c.v as string[];
  } catch {
    return null;
  }
}

/**
 * All the rows of a list the caller may read (page after page of `MAX_PAGE`), up to `max` — for views that compute
 * over every row (DORA metrics, dashboards, heat maps, a plan). `truncated` says the cap was reached: the view shows
 * it rather than computing silently from a part. Sort newest first when a cap may be reached.
 */
export async function listAll(ctx: Ctx, table: string, p: Omit<ListParams, "page" | "size" | "total"> = {}, max = 20_000): Promise<ListResult & { truncated: boolean }> {
  const rows: Row[] = [];
  const seen = new Set<string>();
  const display: Record<string, string> = {};
  let truncated = false;
  for (let page = 1; ; page++) {
    const r = await list(ctx, table, { ...p, page, size: MAX_PAGE, total: false });
    for (const row of r.rows) {
      // a row a concurrent write moved across a page boundary is read once
      if (seen.has(String(row.id))) continue;
      seen.add(String(row.id));
      rows.push(row);
    }
    Object.assign(display, r.display);
    if (r.rows.length < MAX_PAGE) break;
    if (rows.length >= max) {
      truncated = true;
      break;
    }
  }
  return { rows: rows.slice(0, max), total: null, page: 1, size: Math.min(rows.length, max), display, truncated };
}

/** Members of the organisation (the virtual `user` table): pickers and the people directory. */
async function listUsers(ctx: Ctx, def: TableDef, schema: OrgSchema, env: CondEnv, p: ListParams): Promise<ListResult> {
  const filter = checkFilter(ctx, def, schema, p.filter);
  const size = Math.min(Math.max(Math.trunc(p.size ?? 50) || 50, 1), 500);
  const page = Math.max(Math.trunc(p.page ?? 1) || 1, 1);
  const params: unknown[] = [];
  const where = [readable(ctx, USER_DEF, "m", params, env)];
  if (filter) where.push(toSql(filter, def, "m", params, env, { ctx, lookup: schema.lookup }));
  if (p.q) {
    const name = def.fields.find((f) => f.name === "name")!;
    const email = def.fields.find((f) => f.name === "email")!;
    const s = String(p.q).trim().slice(0, 100);
    if (s) {
      params.push(`%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      where.push(`(${fieldExpr(def, name, "m")} ilike $${params.length} or ${fieldExpr(def, email, "m")} ilike $${params.length})`);
    }
  }
  if (p.ids) {
    params.push(pgArray(p.ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 500)));
    where.push(`m.user_id = any($${params.length}::uuid[])`);
  }
  const whereSql = where.map((w) => `(${w})`).join(" and ");
  const rows = await ctx.db.query<Row>(
    `select m.user_id as id, coalesce(nullif(u.full_name, ''), u.email) as name, u.email, m.title, m.role, m.is_active
     from sm_org_members m join sm_users u on u.id = m.user_id
     where ${whereSql} order by 2, 1 limit ${size} offset ${(page - 1) * size}`,
    params,
  );
  const total = p.total === false ? null : Number((await ctx.db.one<{ n: number }>(`select count(*)::int as n from sm_org_members m where ${whereSql}`, params))?.n ?? 0);
  const visible = access().visibleFields(ctx, def);
  const out = rows.map((r) => {
    const o: Row = { id: r.id };
    for (const f of def.fields) if (!visible || visible.has(f.name)) o[f.name] = r[f.name] ?? null;
    return o;
  });
  return { rows: out, total, page, size, display: Object.fromEntries(out.map((r) => [r.id, String(r.name ?? "")])) };
}

/** What the caller may do with a loaded row (engine shape, `$writable` from loadReadable). */
export async function recordMeta(q: Queryable, ctx: Ctx, def: TableDef, row: Row, env: CondEnv): Promise<RecordMeta> {
  const system = isSystemCtx(ctx);
  const rule = row.$writable !== false;
  const locked = isLocked(def, row);
  const mayWrite = system || (rule && access().canWrite(ctx, def, row));
  const canWrite = mayWrite && !locked;
  const canDelete = system || (rule && access().canDelete(ctx, def, row));
  const visible = access().visibleFields(ctx, def);
  const writable = canWrite ? access().writableFields(ctx, def, row) : null;
  const readonly = def.fields
    .filter((f) => {
      if (visible && !visible.has(f.name)) return false;
      if (!canWrite) return true;
      if (f.system || f.readonly || (f.base && f.name !== "workspace_id")) return true;
      if (f.name === def.states?.field) return true;
      return !!writable && !writable.has(f.name);
    })
    .map((f) => f.name);
  const transitions: RecordMeta["transitions"] = [];
  if (def.states && mayWrite) {
    for (const t of transitionsFrom(def.states, row[def.states.field])) {
      if (!system && !access().canTransition(ctx, def, row, t)) continue;
      transitions.push({ to: t.to, label: t.label, requires: t.requires ?? [], category: stateCategory(def.states, t.to) ?? null });
    }
  }
  const meta: RecordMeta = { canWrite, canDelete, readonly, transitions, locked };
  if (def.features?.watchers) {
    const list = Array.isArray(row.watch_list) ? (row.watch_list as string[]) : [];
    meta.watching = list.includes(ctx.user.id);
  }
  for (const fn of metaProvidersFor(def.key)) {
    const extra = await fn({ q, ctx, def, row, env });
    if (extra) Object.assign(meta, extra);
  }
  return meta;
}

/** One record with display values and meta (404 when the caller may not read it). */
export async function get(ctx: Ctx, table: string, id: string): Promise<RecordResult> {
  const { def, schema } = await defFor(ctx, table);
  if (def.virtual) {
    const r = await list(ctx, table, { ids: [id], total: false });
    if (!r.rows.length) throw new AppError(404, "not_found", "کاربر پیدا نشد");
    return { row: r.rows[0], display: r.display, meta: { canWrite: false, canDelete: false, readonly: def.fields.map((f) => f.name), transitions: [], locked: false } };
  }
  const env = await condEnv(ctx);
  // a record moved to the archive is read there, read-only (engine/archive.ts)
  const row = await requireReadable(ctx, def, id, env, ctx.db, { archived: true });
  await redactRows(ctx.db, ctx, def, [row]);
  const visible = access().visibleFields(ctx, def);
  const out = toOutput(def, row, visible);
  const refs = new RefSet();
  refs.addRow(def, out);
  const [display, meta] = await Promise.all([
    resolveDisplay(ctx.db, ctx, env, schema, refs),
    row.$archived
      ? Promise.resolve<RecordMeta>({ canWrite: false, canDelete: false, readonly: def.fields.map((f) => f.name), transitions: [], locked: true, archived: true })
      : recordMeta(ctx.db, ctx, def, row, env),
  ]);
  // read only as a participant with a grant of its own (an approver without a role in the area)
  if (!access().canReadTable(ctx, def)) meta.reach = "participant";
  return { row: out, display, meta };
}

/**
 * Create a record; returns it as `get` does. These single-record writes run again when the database aborts them for a
 * deadlock or a serialization failure (`retry`: a record write's every effect is inside its transaction).
 */
export async function create(ctx: Ctx, table: string, data: Record<string, unknown>, opts: WriteOptions = {}): Promise<RecordResult> {
  const row = await ctx.write((tx) => createIn(tx, ctx, table, data, opts), { retry: true });
  return get(ctx, table, row.id);
}

/** Change a record (`opts.version` for optimistic concurrency; a state change is a transition). */
export async function update(ctx: Ctx, table: string, id: string, data: Record<string, unknown>, opts: WriteOptions = {}): Promise<RecordResult> {
  await ctx.write((tx) => updateIn(tx, ctx, table, id, data, opts), { retry: true });
  return get(ctx, table, id);
}

/** Take a transition of the state model (with the values it requires). */
export async function transition(ctx: Ctx, table: string, id: string, to: string, data: Record<string, unknown> = {}, opts: WriteOptions = {}): Promise<RecordResult> {
  await ctx.write((tx) => transitionIn(tx, ctx, table, id, to, data, opts), { retry: true });
  return get(ctx, table, id);
}

/** Soft-delete a record. */
export async function remove(ctx: Ctx, table: string, id: string, opts: WriteOptions = {}): Promise<{ ok: true }> {
  await ctx.write((tx) => removeIn(tx, ctx, table, id, opts), { retry: true });
  return { ok: true };
}

export interface BulkParams {
  /** the records (at most 500) … */
  ids?: string[];
  /** … or every readable record matching a filter (at most 500 are changed) */
  filter?: Cond | null;
  /** values to set on each */
  data?: Record<string, unknown>;
  /** a transition to take on each (with `data`) */
  transition?: string;
  /** delete instead */
  delete?: boolean;
}

export interface BulkResult {
  updated: number;
  failed: { id: string; message: string }[];
}

/** The same change on many records; each record succeeds or fails on its own (savepoints in one transaction). */
export async function bulkUpdate(ctx: Ctx, table: string, p: BulkParams): Promise<BulkResult> {
  const { def, schema } = await defFor(ctx, table);
  needTable(ctx, def);
  let ids = (p.ids ?? []).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (!ids.length && p.filter) {
    const r = await list(ctx, table, { filter: checkFilter(ctx, def, schema, p.filter), size: 500, fields: [def.display], total: false });
    ids = r.rows.map((x) => String(x.id));
  }
  ids = [...new Set(ids)].slice(0, 500);
  if (!ids.length) return { updated: 0, failed: [] };
  if (!p.delete && !p.transition && (!p.data || !Object.keys(p.data).length)) throw bad("تغییری برای اعمال داده نشده است");
  const failed: BulkResult["failed"] = [];
  let updated = 0;
  await ctx.write(async (tx) => {
    for (const id of ids) {
      try {
        await savepoint(tx, async () => {
          if (p.delete) await removeIn(tx, ctx, table, id);
          else if (p.transition) await transitionIn(tx, ctx, table, id, p.transition, p.data ?? {});
          else await updateIn(tx, ctx, table, id, p.data ?? {});
        });
        updated++;
      } catch (e) {
        failed.push({ id, message: e instanceof AppError ? e.message : "خطای داخلی" });
        if (!(e instanceof AppError)) ctx.cfg.log.warn("bulk update failed", String((e as Error)?.message ?? e));
      }
    }
  });
  return { updated, failed };
}
