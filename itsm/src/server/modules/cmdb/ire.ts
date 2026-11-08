// The identification and reconciliation engine (catalogue CMDB-023…025, CMDB-028, CMDB-077): the one write path of
// imports, the local collector, webhooks and the API. For every item a source reports:
//   identify   the class's identification rules (its own and its ancestors', most specific first; the built-in rules
//              when the organisation has none) — ordered entries of attributes that must all be present and equal, with
//              `@<rel_type>` for dependent identity (software «روی همان میزبان»); none → create, one → update, several →
//              a de-duplication task and no write
//   reconcile  per attribute: a locked attribute is never overwritten; a value set by a more authoritative source (or by
//              hand, with the settings' manual priority) is kept unless that source has gone quiet for longer than its
//              reconciliation rule allows; every observation is kept per source (`attr_meta.<attr>.obs`) for the
//              multisource view; values the source may not write are reported as skipped
//   relate     relationships to other items, existing CIs or identified CIs are created once and refreshed after
// Every item runs in its own savepoint: one bad row never blocks the others. A dry run computes everything and rolls
// it back. Writes are the system's, on behalf of the caller (history names them; via «import»).
import { IDENT_RULES, type IdentEntry } from "@shared/cmdb/classes";
import { normalizeIdent, type ClassTree } from "@shared/cmdb/logic";
import type { IreInput, IreItem, IreItemResult, IreRelation, IreResult } from "@shared/cmdb/api";
import { FIELD_TYPES, type FieldDef } from "@shared/model/types";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import { pgArray } from "../../db";
import type { Queryable, Tx } from "../../db";
import { AppError, bad, forbidden, notFound } from "../../http/errors";
import { condEnv, createIn, loadReadable, normSql, optionsOf, orgSchema, readable, savepoint, transitionIn, updateIn } from "../../engine";
import { access } from "../../access/provider";
import { ANCHOR_FIELDS, classTree, cmdbConfig, ciColumnSql, eqAll, isCmdbAdmin, isUuid, liveRow, liveRows, relTypes, SOURCE_FIELDS, sysOf, type Row } from "./common";
import { attrField } from "./hooks";

const DAY = 86_400_000;
const MAX_ITEMS = 1000;
/** Persian and Arabic-Indic digits and their Latin ones, for SQL `translate` */
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩";
const LATIN_DIGITS = "01234567890123456789";

class DryRun extends Error {
  constructor(public result: IreResult) {
    super("dry run");
  }
}

interface Rule {
  class: string;
  entries: IdentEntry[];
  order: number;
}

interface Source {
  id: string | null;
  key: string;
  name: string;
  kind: string;
  priority: number;
  stale_after_days: number;
  default_class: string | null;
  owner_id: string | null;
}

/** The identification entries for a class: rules of the class and its ancestors, most specific first. */
export async function identEntries(q: Queryable, ctx: Ctx, tree: ClassTree, cls: string): Promise<{ entries: (IdentEntry & { scope: string })[] }> {
  const rows = await liveRows(q, sysOf(ctx), "ci_identification_rule", { f: "active", op: "eq", v: true }, { order: "t.sort_order nulls last, t.name" });
  const rules: Rule[] = rows.length
    ? rows.map((r, i) => ({ class: String(r.class), entries: Array.isArray(r.entries) ? r.entries : [], order: i }))
    : IDENT_RULES.map((r, i) => ({ class: r.class, entries: r.entries, order: i }));
  const ancestry = tree.ancestry(cls);
  const applicable = rules.filter((r) => ancestry.includes(r.class)).sort((a, b) => ancestry.indexOf(b.class) - ancestry.indexOf(a.class) || a.order - b.order);
  const entries: (IdentEntry & { scope: string })[] = [];
  for (const r of applicable) for (const e of r.entries) if (Array.isArray(e?.attrs) && e.attrs.length) entries.push({ ...e, scope: r.class });
  return { entries };
}

/** An item's value for an identification attribute (normalised), or null. */
function identValue(item: NormItem, attr: string): string | null {
  const bare = attr.replace(/^attrs\./, "");
  const v = attr.startsWith("attrs.") ? item.attrs[bare] : item.values[bare] ?? item.attrs[bare];
  return normalizeIdent(attr, v);
}

export interface NormItem {
  class: string;
  values: Record<string, unknown>;
  attrs: Record<string, unknown>;
  relations: IreRelation[];
}

/** CIs matching one identification entry (system rights; retired ones count, merged and disposed ones do not). */
async function matchEntry(q: Queryable, ctx: Ctx, tree: ClassTree, item: NormItem, entry: IdentEntry & { scope: string }, parents: Map<string, string>): Promise<Row[] | null> {
  const sys = sysOf(ctx);
  const schema = await orgSchema(sys, q);
  const def = schema.def("ci") ?? tableDef("ci")!;
  const env = await condEnv(sys);
  const params: unknown[] = [];
  const parts = [readable(sys, def, "t", params, env), `t.merged_into is null`, `t.state not in ('disposed', 'canceled')`];
  params.push(pgArray(tree.descendants(entry.scope)));
  parts.push(`t.class = any($${params.length}::text[])`);
  for (const attr of entry.attrs) {
    if (attr.startsWith("@")) {
      const parent = parents.get(attr.slice(1));
      if (!parent) return null;
      params.push(attr.slice(1), parent);
      parts.push(`exists (select 1 from sm_ci_rels r where r.org_id = t.org_id and r.deleted_at is null and r.parent_id = t.id and r.type = $${params.length - 1} and r.child_id = $${params.length}::uuid and (r.valid_to is null or r.valid_to > now()))`);
      continue;
    }
    const v = identValue(item, attr);
    if (!v) return null;
    const bare = attr.replace(/^attrs\./, "");
    const col = ciColumnSql("t", attr, params);
    params.push(v);
    // case, spaces and the digits' script (rows typed with Persian or Arabic digits before they were stored Latin) aside
    if (bare === "serial_number" || bare === "asset_tag" || bare === "bios_uuid" || bare === "cert_serial" || bare === "imei") parts.push(`upper(replace(translate(${col}, '${PERSIAN_DIGITS}', '${LATIN_DIGITS}'), ' ', '')) = $${params.length}`);
    else if (bare === "name") parts.push(`lower(${normSql(col)}) = lower(${normSql(`$${params.length}`)})`);
    else if (bare === "cloud_resource_id") parts.push(`${col} = $${params.length}`);
    else parts.push(`lower(${col}) = lower($${params.length})`);
  }
  return q.query<Row>(`select t.* from ${def.table} t where ${parts.join(" and ")} order by t.updated_at desc limit 6`, params);
}

export interface Identified {
  match: Row | null;
  candidates: Row[];
  entry: string | null;
}

/** Identify one item: the first entry that has all its attributes decides (several matches = duplicates). */
export async function identifyItem(q: Queryable, ctx: Ctx, tree: ClassTree, item: NormItem, parents: Map<string, string> = new Map()): Promise<Identified> {
  const { entries } = await identEntries(q, ctx, tree, item.class);
  for (const e of entries) {
    const rows = await matchEntry(q, ctx, tree, item, e, parents);
    if (rows === null) continue;
    if (rows.length === 1) return { match: rows[0], candidates: rows, entry: e.label ?? e.attrs.join(" + ") };
    if (rows.length > 1) return { match: null, candidates: rows, entry: e.label ?? e.attrs.join(" + ") };
  }
  return { match: null, candidates: [], entry: null };
}

// ---------------------------------------------------------------------------------------------------------------
// References and choices from imported text (members by e-mail or name, records by number or display value)

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/‌/g, "");

async function refResolver(q: Queryable, ctx: Ctx, items: NormItem[]) {
  const ciDef = tableDef("ci")!;
  const sys = sysOf(ctx);
  const schema = await orgSchema(sys, q);
  const env = await condEnv(sys);
  const maps = new Map<string, Map<string, string>>();
  const want = new Map<string, Set<string>>();
  for (const f of ciDef.fields) {
    if (FIELD_TYPES[f.type].family !== "ref") continue;
    const target = f.type === "user" || f.type === "users" ? "user" : f.type === "group" ? "group" : f.ref!;
    for (const it of items) {
      const v = it.values[f.name];
      if (v === null || v === undefined || v === "") continue;
      const set = want.get(target) ?? new Set<string>();
      set.add(String(v).trim());
      want.set(target, set);
    }
  }
  for (const [t, values] of want) {
    const m = new Map<string, string>();
    if (t === "user") {
      const rows = await q.query<{ id: string; email: string; name: string }>(
        `select m.user_id as id, u.email, u.full_name as name from sm_org_members m join sm_users u on u.id = m.user_id where m.org_id = $1 and m.deleted_at is null`,
        [ctx.org.id],
      );
      for (const r of rows) {
        m.set(r.id, r.id);
        m.set(norm(r.email), r.id);
        if (r.name) m.set(norm(r.name), r.id);
      }
    } else {
      const td = schema.def(t);
      if (!td || td.virtual) continue;
      const params: unknown[] = [];
      const where = readable(sys, td, "t", params, env);
      const display = td.fields.find((f) => f.name === td.display);
      const extra = td.fields.some((f) => f.name === "code") ? ", t.code" : "";
      const rows = await q.query<Row>(`select t.id${td.numbered ? ", t.number" : ""}${display && FIELD_TYPES[display.type].sql === "text" && !display.custom ? `, t.${display.name} as d` : ""}${extra} from ${td.table} t where ${where} limit 20000`, params);
      for (const r of rows) {
        m.set(r.id, r.id);
        if (r.number) m.set(norm(r.number), r.id);
        if (r.d) m.set(norm(r.d), r.id);
        if (r.code) m.set(norm(r.code), r.id);
      }
      void values;
    }
    maps.set(t, m);
  }
  return (f: FieldDef, raw: unknown): unknown => {
    if (raw === null || raw === undefined || raw === "") return null;
    const t = f.type === "user" || f.type === "users" ? "user" : f.type === "group" ? "group" : f.ref!;
    const m = maps.get(t);
    const s = String(raw).trim();
    return m?.get(s.toLowerCase()) ?? m?.get(norm(s)) ?? (isUuid(s) ? s : undefined);
  };
}

/** Text from a file or a source → the stored form of a CI field (choice labels, members, records, numbers). */
function cellValue(f: FieldDef, raw: unknown, schema: Awaited<ReturnType<typeof orgSchema>>, ref: (f: FieldDef, raw: unknown) => unknown): unknown {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && !raw.trim()) return null;
  if (f.type === "choice") {
    const s = norm(raw);
    const options = optionsOf(f, schema);
    return options.find((o) => norm(o.value) === s || norm(o.label) === s)?.value ?? String(raw).trim();
  }
  if (FIELD_TYPES[f.type].family === "ref") {
    const v = ref(f, raw);
    if (v === undefined) throw new AppError(400, "validation", `«${f.label}»: «${String(raw).slice(0, 60)}» پیدا نشد`);
    return v;
  }
  if (f.type === "tags") return Array.isArray(raw) ? raw : String(raw).split(/[،,;]/).map((x) => x.trim()).filter(Boolean);
  return raw;
}

// ---------------------------------------------------------------------------------------------------------------
// Reconciliation

interface ReconRule {
  class: string;
  attributes: string[];
  source_id: string;
  priority: number;
  max_age_days: number;
}

async function loadSources(q: Queryable, ctx: Ctx): Promise<Map<string, Source>> {
  const rows = await liveRows(q, sysOf(ctx), "cmdb_data_source", null, { limit: 1000 });
  return new Map(rows.map((r) => [r.id, { id: r.id, key: r.id, name: r.name, kind: r.kind, priority: Number(r.priority ?? 100), stale_after_days: Number(r.stale_after_days ?? 30), default_class: r.default_class ?? null, owner_id: r.owner_id ?? null }]));
}

/**
 * May the caller import as this source? Nobody imports as «ثبت دستی» (hand entries are not an import). A source as
 * authoritative as hand entries (its priority at or below the settings' manual priority) overrides what people set,
 * so only CMDB administrators and the source's own person use it; any other source is open to whoever may import.
 */
function checkSource(ctx: Ctx, src: Source | null, manualPriority: number, admin: boolean): void {
  if (!src) return;
  if (src.kind === "manual") throw forbidden(`«${src.name}» منبع ویرایش دستی است، نه ورود داده؛ منبع دیگری انتخاب کنید`);
  if (ctx.actor === "system" || admin || (src.owner_id && src.owner_id === ctx.user.id)) return;
  if (src.priority <= manualPriority) throw forbidden(`منبع «${src.name}» هم‌تراز ویرایش دستی معتبر است؛ ورود داده با آن کار مدیر پیکربندی یا مسئول منبع است`);
}

/** Priority and allowed age of a source for an attribute of a class (its reconciliation rule, else the source's). */
function policyOf(rules: ReconRule[], tree: ClassTree, cls: string, attr: string, src: Source | null, manualPriority: number): { priority: number; maxAge: number } {
  if (!src) return { priority: manualPriority, maxAge: 0 };
  const ancestry = tree.ancestry(cls);
  const r = rules
    .filter((x) => x.source_id === src.id && ancestry.includes(x.class) && (!x.attributes.length || x.attributes.includes(attr)))
    .sort((a, b) => ancestry.indexOf(b.class) - ancestry.indexOf(a.class))[0];
  return r ? { priority: r.priority, maxAge: r.max_age_days } : { priority: src.priority, maxAge: src.stale_after_days };
}

interface Provenance {
  src?: string;
  at?: string;
  by?: string | null;
  p?: number;
  obs?: Record<string, { v: unknown; at: string }>;
}

const short = (v: unknown) => (typeof v === "string" && v.length > 200 ? `${v.slice(0, 200)}…` : v);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * May `src` overwrite the current value of `attr`? Locks never; no setter, the same setter, a setter at least as weak
 * (by priority) or a setter that has gone quiet beyond its allowed age — yes.
 */
export function mayWrite(meta: Provenance | undefined, locked: boolean, mine: { key: string; priority: number }, setterPolicy: (src: string) => { priority: number; maxAge: number }, now: number): boolean {
  if (locked) return false;
  if (!meta?.src) return true;
  if (meta.src === mine.key) return true;
  const theirs = setterPolicy(meta.src);
  if (mine.priority <= theirs.priority) return true;
  const at = Date.parse(meta.at ?? "");
  return theirs.maxAge > 0 && !Number.isNaN(at) && now - at > theirs.maxAge * DAY;
}

// ---------------------------------------------------------------------------------------------------------------
// De-duplication tasks

/**
 * The open de-duplication task of these candidates, or a new one (one per candidate set). The task names the CIs by
 * number only and takes their anchors — a restricted support group first, else the first one's group, and their
 * workspace — so it is read where the CIs are read.
 */
export async function ensureDedupTask(tx: Tx, ctx: Ctx, candidates: string[], reason: string, opts: { source?: string | null; score?: number } = {}): Promise<Row> {
  const sys = sysOf(ctx);
  const list = [...new Set(candidates)].sort();
  const key = list.join(",").slice(0, 600);
  const [open] = await liveRows(tx, sys, "cmdb_dedup_task", { and: [{ f: "candidate_key", op: "eq", v: key }, { f: "active", op: "eq", v: true }] }, { limit: 1 });
  if (open) return open;
  const cis = await liveRows(tx, sys, "ci", { f: "id", op: "in", v: list }, { order: "t.number" });
  const groups = [...new Set(cis.map((c) => c.support_group_id).filter(isUuid))];
  const restricted = new Set(groups.length ? (await liveRows(tx, sys, "group", { and: [{ f: "id", op: "in", v: groups }, { f: "restricted", op: "eq", v: true }] })).map((g) => g.id) : []);
  const anchor = cis.find((c) => restricted.has(c.support_group_id)) ?? cis.find((c) => isUuid(c.support_group_id));
  const numbers = cis.map((r) => String(r.number ?? "")).filter(Boolean);
  return createIn(tx, sys, "cmdb_dedup_task", {
    short_description: `پیکربندی‌های تکراری محتمل: ${numbers.slice(0, 3).join("، ")}${numbers.length > 3 ? " …" : ""}`.slice(0, 200),
    candidates: list, reason, score: opts.score ?? 90, source_id: opts.source ?? null,
    assignment_group_id: anchor?.support_group_id ?? null, workspace_id: anchor?.workspace_id ?? cis.find((c) => c.workspace_id)?.workspace_id ?? null,
  }, { trusted: true });
}

// ---------------------------------------------------------------------------------------------------------------
// createOrUpdate

/** Order items so that the ones others depend on (hosts) are reconciled first. */
function processingOrder(items: NormItem[]): number[] {
  const order: number[] = [];
  const state = new Map<number, 1 | 2>();
  const visit = (i: number) => {
    if (state.get(i) === 2 || state.get(i) === 1) return;
    state.set(i, 1);
    for (const r of items[i].relations) if (typeof r.item === "number" && r.item !== i && items[r.item] && (r.direction ?? "out") === "out") visit(r.item);
    state.set(i, 2);
    order.push(i);
  };
  for (let i = 0; i < items.length; i++) visit(i);
  return order;
}

/** Shape and clean the items (class, known fields, attributes); problems go into the results. */
function normalizeItems(input: IreInput, src: Source | null): { items: NormItem[]; problems: Map<number, string> } {
  const problems = new Map<number, string>();
  const allowed = new Set(SOURCE_FIELDS);
  const items = input.items.map((it, i): NormItem => {
    const values: Record<string, unknown> = {};
    const attrs: Record<string, unknown> = { ...(it.attrs && typeof it.attrs === "object" ? it.attrs : {}) };
    for (const [k, v] of Object.entries(it.values ?? {})) {
      if (k.startsWith("attrs.")) attrs[k.slice(6)] = v;
      else if (allowed.has(k) || k === "state") values[k] = v;
      else if (k !== "class") problems.set(i, `فیلد «${k}» شناخته نیست`);
    }
    const cls = String(it.class ?? (it.values as Record<string, unknown>)?.class ?? input.default_class ?? src?.default_class ?? "").trim();
    if (!cls) problems.set(i, "کلاس پیکربندی مشخص نیست");
    return { class: cls, values, attrs, relations: Array.isArray(it.relations) ? it.relations.slice(0, 50) : [] };
  });
  return { items, problems };
}

/** Reconcile a batch of items (≤ 1000) as the caller's import (CMDB-023): creates, updates, duplicates, relationships. */
export async function createOrUpdate(ctx: Ctx, input: IreInput): Promise<IreResult> {
  if (!Array.isArray(input.items)) throw bad("فهرست اقلام لازم است");
  if (input.items.length > MAX_ITEMS) throw bad(`در هر بار حداکثر ${MAX_ITEMS} قلم`);
  const schema0 = await orgSchema(ctx);
  const ciDef = schema0.def("ci") ?? tableDef("ci")!;
  const people = ctx.actor !== "system";
  if (people && !access().canCreate(ctx, ciDef, null)) throw forbidden("ورود داده به پایگاه پیکربندی با مدیران پیکربندی و دارایی است");
  // an import changes what the caller may change by hand: CIs they may write, and their ownership only as an administrator
  const admin = !people || (await isCmdbAdmin(ctx));
  const sources = await loadSources(ctx.db, ctx);
  const src = input.source_id ? sources.get(input.source_id) ?? null : null;
  if (input.source_id && !src) throw notFound("منبع داده پیدا نشد");
  checkSource(ctx, src, (await cmdbConfig(ctx.db, ctx)).manual_priority, admin);
  const run = async (tx: Tx): Promise<IreResult> => {
    const sys = sysOf(ctx, ctx.actor === "system" ? null : ctx.user.id);
    const env = await condEnv(ctx);
    /** the CI as the caller reads it (null: they may not), for matches and relationship targets */
    const asCaller = (id: string) => (people ? loadReadable(tx, ctx, ciDef, id, env) : liveRow(tx, sys, "ci", id));
    const tree = await classTree(tx, ctx);
    const types = await relTypes(tx, ctx);
    const cfg = await cmdbConfig(tx, ctx);
    const schema = await orgSchema(sys, tx);
    const rules: ReconRule[] = (await liveRows(tx, sys, "ci_reconciliation_rule", { f: "active", op: "eq", v: true })).map((r) => ({
      class: String(r.class), attributes: Array.isArray(r.attributes) ? r.attributes : [], source_id: String(r.source_id), priority: Number(r.priority ?? 10), max_age_days: Number(r.max_age_days ?? 30),
    }));
    const { items, problems } = normalizeItems(input, src);
    const ref = await refResolver(tx, ctx, items);
    const out: IreResult = { results: [], created: 0, updated: 0, unchanged: 0, duplicates: 0, failed: 0, relations: { created: 0, refreshed: 0, failed: 0 }, dry_run: !!input.dry_run, run_id: input.run_id ?? null };
    const ciOf = new Map<number, string>();
    const results = new Map<number, IreItemResult>();
    const now = Date.now();
    const at = new Date(now).toISOString();
    const mine = { key: src?.id ?? "import", priority: src?.priority ?? 100 };
    const setterPolicy = (cls: string, attr: string) => (key: string) => (key === "manual" ? { priority: cfg.manual_priority, maxAge: 0 } : policyOf(rules, tree, cls, attr, sources.get(key) ?? null, cfg.manual_priority));
    for (const i of processingOrder(items)) {
      const item = items[i];
      const base: IreItemResult = { index: i, action: "error", ci_id: null, number: null, name: (item.values.name as string) ?? null };
      if (problems.has(i) && !item.class) {
        results.set(i, { ...base, message: problems.get(i) });
        continue;
      }
      if (!tree.get(item.class)) {
        results.set(i, { ...base, message: `کلاس «${item.class}» پیدا نشد` });
        continue;
      }
      try {
        const r = await savepoint(tx, async () => {
          // the stored form of every field (choice labels, members, records)
          const values: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(item.values)) {
            const f = ciDef.fields.find((x) => x.name === k);
            if (f) values[k] = cellValue(f, v, schema, ref);
          }
          const normalized: NormItem = { ...item, values };
          // dependent identity: parents named through this item's relationships
          const parents = new Map<string, string>();
          for (const rel of item.relations) {
            if ((rel.direction ?? "out") !== "out") continue;
            const target = typeof rel.item === "number" ? ciOf.get(rel.item) : isUuid(rel.ci_id) ? rel.ci_id : null;
            if (target) parents.set(rel.type, target);
          }
          const idf = await identifyItem(tx, ctx, tree, normalized, parents);
          if (idf.match && people) {
            // identification sees every CI; the update is the caller's: a CI they may not read or change is not theirs to
            // reconcile (nor to name in the result)
            const seen = await asCaller(idf.match.id);
            if (!seen) return { ...base, matched_by: idf.entry, message: "این قلم با پیکربندی‌ای می‌خورد که به آن دسترسی ندارید؛ به‌روزرسانی آن با مدیر پیکربندی است" };
            if (!access().canWrite(ctx, ciDef, seen) || seen.$writable === false) return { ...base, number: seen.number ?? null, matched_by: idf.entry, message: `این قلم با «${seen.number ?? seen.name}» می‌خورد که اجازهٔ تغییرش را ندارید` };
          }
          if (!idf.match && idf.candidates.length > 1) {
            const task = await ensureDedupTask(tx, ctx, idf.candidates.map((c) => c.id), `منبع «${src?.name ?? "ورود داده"}» قلمی گزارش کرد که با «${idf.entry}» به ${idf.candidates.length} پیکربندی می‌خورد`, { source: src?.id ?? null });
            return { ...base, action: "duplicate" as const, matched_by: idf.entry, dedup_task_id: task.id, message: `${idf.candidates.length} پیکربندی هم‌شناسه؛ برای بررسی «${task.number}» ساخته شد` };
          }
          if (!idf.match) {
            const meta: Record<string, Provenance> = {};
            for (const k of Object.keys(values)) meta[k] = { src: mine.key, at, p: mine.priority, obs: { [mine.key]: { v: short(values[k]), at } } };
            for (const k of Object.keys(item.attrs)) meta[`attrs.${k}`] = { src: mine.key, at, p: mine.priority, obs: { [mine.key]: { v: short(item.attrs[k]), at } } };
            const name = String(values.name ?? values.hostname ?? values.fqdn ?? values.serial_number ?? "").trim();
            if (!name) throw new AppError(400, "validation", "نام پیکربندی (یا نام میزبان) لازم است");
            const row = await createIn(tx, sys, "ci", {
              ...values, name, class: item.class, attrs: item.attrs, state: typeof values.state === "string" && values.state ? values.state : "operational",
              discovery_source_id: src?.id ?? null, first_discovered_at: at, last_discovered_at: at, attr_meta: meta,
            }, { trusted: true, via: "import" });
            return { ...base, action: "created" as const, ci_id: row.id, number: row.number ?? null, name: row.name, matched_by: null };
          }
          const cur = idf.match;
          const locked = new Set<string>(Array.isArray(cur.locked_attrs) ? cur.locked_attrs : []);
          const meta: Record<string, Provenance> = { ...((cur.attr_meta ?? {}) as Record<string, Provenance>) };
          const patch: Record<string, unknown> = {};
          const skipped: string[] = [];
          const changed: string[] = [];
          const consider = (path: string, value: unknown, current: unknown) => {
            const m: Provenance = { ...(meta[path] ?? {}) };
            m.obs = { ...(m.obs ?? {}), [mine.key]: { v: short(value), at } };
            const equal = same(value, current);
            if (!equal) {
              if (mayWrite(meta[path], locked.has(path) || (path.startsWith("attrs.") && locked.has(path.slice(6))), mine, setterPolicy(cur.class, path), now)) {
                changed.push(path);
                m.src = mine.key;
                m.at = at;
                m.p = mine.priority;
                m.by = null;
                meta[path] = m;
                return true;
              }
              skipped.push(path);
            } else if (!m.src || m.src === mine.key) {
              m.src = mine.key;
              m.at = at;
              m.p = mine.priority;
            }
            meta[path] = m;
            return false;
          };
          for (const [k, v] of Object.entries(values)) {
            if (k === "state") continue;
            if (!admin && ANCHOR_FIELDS.has(k)) {
              // who owns and approves a CI that exists is not an import's to change (see ANCHOR_FIELDS)
              if (!same(v, cur[k])) skipped.push(k);
              continue;
            }
            if (consider(k, v, cur[k])) patch[k] = v;
          }
          const attrs = { ...((cur.attrs ?? {}) as Record<string, unknown>) };
          let attrsChanged = false;
          for (const [k, v] of Object.entries(item.attrs)) {
            if (consider(`attrs.${k}`, v, attrs[k])) {
              attrs[k] = v;
              attrsChanged = true;
            }
          }
          if (attrsChanged) patch.attrs = attrs;
          if (item.class !== cur.class && tree.isA(item.class, cur.class)) {
            // a source that knows more (server under computer) refines the class
            patch.class = item.class;
            changed.push("class");
          }
          const stamps: Record<string, unknown> = { last_discovered_at: at, attr_meta: meta, is_stale: false };
          if (!cur.first_discovered_at) stamps.first_discovered_at = at;
          if (!cur.discovery_source_id && src) stamps.discovery_source_id = src.id;
          const row = await updateIn(tx, sys, "ci", cur.id, { ...patch, ...stamps }, { trusted: true, via: "import", allowLocked: true, keepVersion: !Object.keys(patch).length });
          return {
            ...base, action: (Object.keys(patch).length ? "updated" : "unchanged") as IreItemResult["action"], ci_id: row.id, number: row.number ?? null, name: row.name,
            matched_by: idf.entry, changed, skipped: skipped.length ? skipped : undefined,
          };
        });
        if (r.ci_id && r.action !== "error") ciOf.set(i, r.ci_id);
        results.set(i, problems.has(i) ? { ...r, message: [r.message, problems.get(i)].filter(Boolean).join("؛ ") } : r);
      } catch (e) {
        results.set(i, { ...base, action: "error", message: (e as Error).message });
      }
    }
    // relationships (after every item has its CI)
    for (let i = 0; i < items.length; i++) {
      const from = ciOf.get(i);
      if (!from) continue;
      for (const rel of items[i].relations) {
        try {
          if (!types.get(rel.type)) throw new AppError(400, "validation", `نوع رابطهٔ «${rel.type}» پیدا نشد`);
          // the item's own CI is one the caller created or may change (above); the other end must be one they may read —
          // the relationship hook's rule (change one of the two CIs) through the import
          let target: string | null = null;
          if (typeof rel.item === "number") target = ciOf.get(rel.item) ?? null;
          else if (isUuid(rel.ci_id)) target = (await asCaller(rel.ci_id))?.id ?? null;
          else if (rel.match?.values) {
            const mcls = String(rel.match.class ?? "ci");
            const idf = await identifyItem(tx, ctx, tree, { class: tree.get(mcls) ? mcls : "ci", values: rel.match.values, attrs: {}, relations: [] });
            target = idf.match && (await asCaller(idf.match.id)) ? idf.match.id : null;
          }
          if (!target || target === from) {
            out.relations.failed++;
            continue;
          }
          const [parent, child] = (rel.direction ?? "out") === "out" ? [from, target] : [target, from];
          const [existing] = await liveRows(tx, sysOf(ctx), "ci_rel", { and: [{ f: "parent_id", op: "eq", v: parent }, { f: "child_id", op: "eq", v: child }, { f: "type", op: "eq", v: rel.type }, { f: "valid_to", op: "empty" }] }, { limit: 1 });
          if (existing) {
            await updateIn(tx, sysOf(ctx), "ci_rel", existing.id, { last_seen_at: at }, { trusted: true, keepVersion: true });
            out.relations.refreshed++;
          } else {
            await savepoint(tx, () => createIn(tx, sysOf(ctx), "ci_rel", { parent_id: parent, child_id: child, type: rel.type, origin_kind: src?.kind === "collector" || src?.kind === "discovery" ? "discovery" : "import", source_id: src?.id ?? null, discovered_at: at, last_seen_at: at }, { trusted: true, via: "import" }));
            out.relations.created++;
          }
        } catch {
          out.relations.failed++;
        }
      }
    }
    for (let i = 0; i < items.length; i++) {
      const r = results.get(i) ?? { index: i, action: "error" as const, ci_id: null, number: null, name: null, message: "پردازش نشد" };
      out.results.push(r);
      if (r.action === "created") out.created++;
      else if (r.action === "updated") out.updated++;
      else if (r.action === "unchanged") out.unchanged++;
      else if (r.action === "duplicate") out.duplicates++;
      else if (r.action === "error") out.failed++;
    }
    if (src?.id && !input.dry_run) await updateIn(tx, sysOf(ctx), "cmdb_data_source", src.id, { last_run_at: at, last_status: `${out.created} ساخته، ${out.updated} به‌روز، ${out.duplicates} تکراری، ${out.failed} ناموفق`.slice(0, 300) }, { trusted: true, keepVersion: true });
    if (input.run_id && !input.dry_run) await appendToRun(tx, ctx, input.run_id, out);
    if (input.dry_run) throw new DryRun(out);
    return out;
  };
  try {
    return await ctx.write(run);
  } catch (e) {
    if (e instanceof DryRun) return e.result;
    throw e;
  }
}

/** Add a batch's results to its import run (counts and up to 1000 row results). */
async function appendToRun(tx: Tx, ctx: Ctx, runId: string, r: IreResult): Promise<void> {
  const run = await liveRow(tx, sysOf(ctx), "cmdb_import_run", runId);
  if (!run || run.state !== "running") return;
  const prev = Array.isArray(run.results) ? run.results : [];
  const offset = Number(run.total ?? 0);
  const rows = [...prev, ...r.results.filter((x) => x.action !== "unchanged").map((x) => ({ ...x, index: x.index + offset }))].slice(0, 1000);
  await updateIn(tx, sysOf(ctx), "cmdb_import_run", runId, {
    total: offset + r.results.length,
    created: Number(run.created ?? 0) + r.created,
    updated: Number(run.updated ?? 0) + r.updated,
    unchanged: Number(run.unchanged ?? 0) + r.unchanged,
    duplicates: Number(run.duplicates ?? 0) + r.duplicates,
    failed: Number(run.failed ?? 0) + r.failed,
    results: rows,
  }, { trusted: true, keepVersion: true });
}

/** Identify without writing (API «identify»): the match, the candidates and the entry that decided. */
export async function identifyOnly(ctx: Ctx, item: IreItem): Promise<{ action: "create" | "update" | "duplicate"; ci_id: string | null; number: string | null; candidates: { id: string; number: string | null; name: string }[]; matched_by: string | null }> {
  const schema = await orgSchema(ctx);
  const ciDef = schema.def("ci") ?? tableDef("ci")!;
  if (ctx.actor !== "system" && !access().canReadTable(ctx, ciDef)) throw forbidden("به پایگاه پیکربندی دسترسی ندارید");
  const tree = await classTree(ctx.db, ctx);
  const { items } = normalizeItems({ items: [item] }, null);
  if (!items[0].class || !tree.get(items[0].class)) throw bad("کلاس پیکربندی مشخص نیست");
  const idf = await identifyItem(ctx.db, ctx, tree, items[0]);
  const readable = new Set((await liveRows(ctx.db, ctx, "ci", { f: "id", op: "in", v: idf.candidates.map((c) => c.id).concat(["00000000-0000-0000-0000-000000000000"]) })).map((r) => r.id));
  const shown = idf.candidates.filter((c) => readable.has(c.id)).map((c) => ({ id: c.id, number: c.number ?? null, name: c.name }));
  return {
    action: idf.match ? "update" : idf.candidates.length > 1 ? "duplicate" : "create",
    ci_id: idf.match && readable.has(idf.match.id) ? idf.match.id : null,
    number: idf.match && readable.has(idf.match.id) ? idf.match.number ?? null : null,
    candidates: shown,
    matched_by: idf.entry,
  };
}

/** Start an import run (a file, JSON, a URL or the collector): its record collects the batches' results. */
export async function startRun(ctx: Ctx, input: { name: string; source_id?: string | null; class?: string | null; file_name?: string | null; dry_run?: boolean }): Promise<Row> {
  const schema = await orgSchema(ctx);
  const ciDef = schema.def("ci") ?? tableDef("ci")!;
  if (ctx.actor !== "system" && !access().canCreate(ctx, ciDef, null)) throw forbidden("ورود داده به پایگاه پیکربندی با مدیران پیکربندی و دارایی است");
  if (input.source_id) {
    const src = (await loadSources(ctx.db, ctx)).get(input.source_id);
    if (!src) throw notFound("منبع داده پیدا نشد");
    checkSource(ctx, src, (await cmdbConfig(ctx.db, ctx)).manual_priority, ctx.actor === "system" || (await isCmdbAdmin(ctx)));
  }
  return ctx.write((tx) =>
    createIn(tx, sysOf(ctx, ctx.actor === "system" ? null : ctx.user.id), "cmdb_import_run", {
      name: input.name.slice(0, 160), source_id: input.source_id ?? null, class: input.class ?? null, file_name: input.file_name ?? null, dry_run: !!input.dry_run,
      started_at: new Date().toISOString(), total: 0, created: 0, updated: 0, unchanged: 0, duplicates: 0, failed: 0, results: [],
    }, { trusted: true }),
  );
}

/** Close an import run (completed, or failed with a message). */
export async function finishRun(ctx: Ctx, runId: string, error?: string | null): Promise<Row> {
  return ctx.write(async (tx) => {
    const sys = sysOf(ctx);
    const run = await liveRow(tx, sys, "cmdb_import_run", runId);
    if (!run) throw notFound("اجرای ورود داده پیدا نشد");
    if (run.state !== "running") return run;
    if (ctx.actor !== "system" && run.created_by !== ctx.user.id) {
      const schema = await orgSchema(ctx, tx);
      if (!access().canWrite(ctx, schema.def("cmdb_import_run")!, run)) throw forbidden("این اجرا را دیگری آغاز کرده است");
    }
    await updateIn(tx, sys, "cmdb_import_run", runId, { finished_at: new Date().toISOString(), error: error ?? null }, { trusted: true, keepVersion: true });
    return transitionIn(tx, sys, "cmdb_import_run", runId, error ? "failed" : "completed", {}, { trusted: true });
  });
}

/** Map a flat record (a spreadsheet row, a JSON object) to an item with a column → field mapping. */
export function mapRow(row: Record<string, unknown>, mapping: Record<string, string>, defaultClass: string | null): IreItem {
  const values: Record<string, unknown> = {};
  const attrs: Record<string, unknown> = {};
  const relations: IreRelation[] = [];
  let cls = defaultClass;
  for (const [col, target] of Object.entries(mapping)) {
    if (!target) continue;
    const v = row[col];
    if (v === undefined || v === null || v === "") continue;
    if (target === "class") cls = String(v).trim();
    else if (target.startsWith("attrs.")) attrs[target.slice(6)] = v;
    else if (target.startsWith("rel:")) {
      // rel:<type>:<identifying field>[:in] — e.g. rel:runs_on:hostname links the item to the CI with that host name
      const [, type, field, dir] = target.split(":");
      if (type && field) relations.push({ type, direction: dir === "in" ? "in" : "out", match: { values: { [field]: v } } });
    } else values[target] = v;
  }
  return { class: cls, values, attrs, relations };
}

export { attrField };
