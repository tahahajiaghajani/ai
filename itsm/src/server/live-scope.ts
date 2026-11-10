// «زنده» with a scope (GET /o/:org/pulse?since=…&t=…&r=…, PERFORMANCE_FA.md «دور دوم»): an open screen names the
// tables of its lists and the records it shows (`table:id`); the answer says which of them changed since the token
// it last saw, so a write elsewhere in the organisation no longer refetches every open page.
//
// What it never reveals: a table the member may not open is never answered; a table is «changed» only when a row the
// member may read now (the engine's read predicate — row rules, groups, secure workspaces — deleted rows included, so
// a removal shows) got a new sync revision in the window; a record only when it is readable and it, or what its page
// shows of it, changed: its journal (internal notes only for the «internal» field group), its history (only fields the
// member sees), its attachments, its links whose other record the member may read. Ids come only from the request.
// The token is the organisation's sync revision (what the sync protocol's `head` already tells a Windows app).
// The Windows app keeps its coarse local counter: any change there answers every scope it was asked about.
import type { Ctx } from "./context";
import type { TableDef } from "@shared/model/types";
import { pgArray } from "./db";
import { condEnv, orgSchema, readable } from "./engine";
import { access } from "./access/provider";
import { pulse as token } from "./live";

export const MAX_SCOPE_TABLES = 40;
export const MAX_SCOPE_RECORDS = 50;
/** A window this wide (a token from long ago) is not scanned: every scope the member may read answers «changed». */
const MAX_WINDOW = 200_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[a-z][a-z0-9_]{0,62}$/;

export interface PulseScope {
  /** the token of the screen's previous look */
  since?: string | null;
  /** table keys of the screen's lists, counts and aggregates */
  tables?: string[];
  /** records the screen shows, as `table:id` */
  records?: string[];
}

export interface PulseAnswer {
  pulse: string;
  /** the requested scopes that changed since `since` (absent: an answer without a scope, the token alone) */
  changed?: string[];
}

/** May the member open rows of the table at all (a role reading its area, or a participant's grant)? */
async function opens(ctx: Ctx, def: TableDef): Promise<boolean> {
  if (def.virtual) return false;
  if (access().canReadTable(ctx, def)) return true;
  const p = access().participations;
  return !!p && (await p.call(access(), ctx, ctx.db)).has(def.key);
}

/** The scopes of a request, cleaned: known table keys, `table:uuid` records (lower case), bounded. */
export function cleanScope(s: PulseScope): { tables: string[]; records: { table: string; id: string; ref: string }[] } {
  const tables = [...new Set((s.tables ?? []).map((t) => String(t).trim()).filter((t) => KEY.test(t)))].slice(0, MAX_SCOPE_TABLES);
  const seen = new Set<string>();
  const records: { table: string; id: string; ref: string }[] = [];
  for (const raw of s.records ?? []) {
    const [table, id] = String(raw).trim().split(":");
    if (!KEY.test(table ?? "") || !UUID.test(id ?? "")) continue;
    const ref = `${table}:${id.toLowerCase()}`;
    if (seen.has(ref)) continue;
    seen.add(ref);
    records.push({ table, id: id.toLowerCase(), ref });
    if (records.length >= MAX_SCOPE_RECORDS) break;
  }
  return { tables, records };
}

/** «زنده»: the token, and — when the screen names what it shows — which of it changed since its last look. */
export async function scopedPulse(ctx: Ctx, scope: PulseScope): Promise<PulseAnswer> {
  const now = await token(ctx);
  // a question without a scope (an older screen) gets the token alone
  if (!scope.tables?.length && !scope.records?.length) return { pulse: now };
  const { tables, records } = cleanScope(scope);
  if (!tables.length && !records.length) return { pulse: now, changed: [] };
  const since = typeof scope.since === "string" ? scope.since : null;
  if (!since || since === now) return { pulse: now, changed: [] };
  const schema = await orgSchema(ctx);
  const defs = new Map<string, TableDef>();
  for (const key of new Set([...tables, ...records.map((r) => r.table)])) {
    const def = schema.def(key);
    if (def && (await opens(ctx, def))) defs.set(key, def);
  }
  const askedTables = tables.filter((t) => defs.has(t));
  const askedRecords = records.filter((r) => defs.has(r.table));
  if (!askedTables.length && !askedRecords.length) return { pulse: now, changed: [] };

  // the Windows app: its own counter moved (any local write or download) — every scope it may read is answered
  const m = /^w(\d{1,18})$/.exec(since);
  const head = Number(now.slice(1));
  if (ctx.cfg.mode !== "cloud" || !now.startsWith("w")) return { pulse: now, changed: [...askedTables, ...(await readableRecords(ctx, defs, askedRecords))] };
  if (!m) return { pulse: now, changed: [] };
  const from = Number(m[1]);
  if (from >= head) return { pulse: now, changed: [] };
  if (head - from > MAX_WINDOW) return { pulse: now, changed: [...askedTables, ...(await readableRecords(ctx, defs, askedRecords))] };
  return { pulse: now, changed: await changedIn(ctx, defs, askedTables, askedRecords, from, head) };
}

/** The records of the request the member may read now (deleted ones too: a removal is news). */
async function readableRecords(ctx: Ctx, defs: Map<string, TableDef>, records: { table: string; id: string; ref: string }[]): Promise<string[]> {
  const env = await condEnv(ctx);
  const out: string[] = [];
  for (const [table, list] of groupBy(records)) {
    const def = defs.get(table)!;
    const params: unknown[] = [ctx.org.id, pgArray(list.map((r) => r.id))];
    const pred = readable(ctx, def, "t", params, env, { deleted: "any" });
    const rows = await ctx.db.query<{ id: string }>(`select t.id from ${def.table} t where t.org_id = $1 and t.id = any($2::uuid[]) and ${pred}`, params);
    out.push(...rows.map((r) => `${table}:${String(r.id).toLowerCase()}`));
  }
  return out;
}

function groupBy(records: { table: string; id: string; ref: string }[]): Map<string, { table: string; id: string; ref: string }[]> {
  const m = new Map<string, { table: string; id: string; ref: string }[]>();
  for (const r of records) m.set(r.table, [...(m.get(r.table) ?? []), r]);
  return m;
}

/**
 * One statement answers every table and record: for a table, does a row the member may read have a revision in
 * (from, head]; for a record, is it readable and did it or its journal, history or attachments move in the window.
 * Links come second (their other record must be readable too), only for records the first answer left out.
 */
async function changedIn(ctx: Ctx, defs: Map<string, TableDef>, tables: string[], records: { table: string; id: string; ref: string }[], from: number, head: number): Promise<string[]> {
  const env = await condEnv(ctx);
  const params: unknown[] = [ctx.org.id, from, head];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const window = (a: string) => `${a}.org_id = $1 and ${a}.rev > $2 and ${a}.rev <= $3`;
  const branches: string[] = [];
  for (const key of tables) {
    const def = defs.get(key)!;
    const pred = readable(ctx, def, "t", params, env, { deleted: "any" });
    branches.push(`select ${p(key)}::text as k where exists (select 1 from ${def.table} t where ${window("t")} and ${pred})`);
  }
  const internal = access().hasFieldGroup(ctx, "internal");
  for (const [table, list] of groupBy(records)) {
    const def = defs.get(table)!;
    const pred = readable(ctx, def, "t", params, env, { deleted: "any" });
    const tk = p(table);
    const visible = access().visibleFields(ctx, def);
    const fields = visible ? ` and h.field = any(${p(pgArray([...visible]))}::text[])` : "";
    branches.push(
      `select ${tk}::text || ':' || t.id::text as k from ${def.table} t
       where t.org_id = $1 and t.id = any(${p(pgArray(list.map((r) => r.id)))}::uuid[]) and ${pred} and (
         (t.rev > $2 and t.rev <= $3)
         or exists (select 1 from sm_journal j where ${window("j")} and j.table_key = ${tk} and j.record_id = t.id${internal ? "" : ` and j.visibility is distinct from 'internal'`})
         or exists (select 1 from sm_history h where ${window("h")} and h.table_key = ${tk} and h.record_id = t.id${fields})
         or exists (select 1 from sm_attachments a where ${window("a")} and a.table_key = ${tk} and a.record_id = t.id))`,
    );
  }
  const out = new Set<string>();
  if (branches.length) for (const r of await ctx.db.query<{ k: string }>(branches.join("\nunion all\n"), params)) out.add(String(r.k).toLowerCase());
  const rest = records.filter((r) => !out.has(r.ref));
  if (rest.length) for (const ref of await linkChanges(ctx, defs, rest, from, head)) out.add(ref);
  // in the order asked
  return [...tables.filter((t) => out.has(t)), ...records.filter((r) => out.has(r.ref)).map((r) => r.ref)];
}

/** Records whose links moved in the window — counted only when the record and the link's other record are readable. */
async function linkChanges(ctx: Ctx, defs: Map<string, TableDef>, records: { table: string; id: string; ref: string }[], from: number, head: number): Promise<string[]> {
  const ids = records.map((r) => r.id);
  const links = await ctx.db.query<{ from_table: string; from_id: string; to_table: string; to_id: string }>(
    `select l.from_table, l.from_id, l.to_table, l.to_id from sm_links l
     where l.org_id = $1 and l.rev > $2 and l.rev <= $3 and (l.from_id = any($4::uuid[]) or l.to_id = any($4::uuid[]))
     limit 500`,
    [ctx.org.id, from, head, pgArray(ids)],
  );
  if (!links.length) return [];
  const mine = new Set(await readableRecords(ctx, defs, records));
  const schema = await orgSchema(ctx);
  const others = new Map<string, Set<string>>();
  const pairs: { ref: string; other: string }[] = [];
  for (const l of links) {
    for (const [self, otherTable, otherId] of [[`${l.from_table}:${String(l.from_id).toLowerCase()}`, l.to_table, l.to_id], [`${l.to_table}:${String(l.to_id).toLowerCase()}`, l.from_table, l.from_id]] as const) {
      if (!mine.has(self)) continue;
      pairs.push({ ref: self, other: `${otherTable}:${String(otherId).toLowerCase()}` });
      others.set(otherTable, (others.get(otherTable) ?? new Set()).add(String(otherId).toLowerCase()));
    }
  }
  const env = await condEnv(ctx);
  const seen = new Set<string>();
  for (const [table, set] of others) {
    const def = schema.def(table);
    if (!def || !(await opens(ctx, def))) continue;
    const params: unknown[] = [ctx.org.id, pgArray([...set])];
    const pred = readable(ctx, def, "t", params, env, { deleted: "any" });
    for (const r of await ctx.db.query<{ id: string }>(`select t.id from ${def.table} t where t.org_id = $1 and t.id = any($2::uuid[]) and ${pred}`, params)) seen.add(`${table}:${String(r.id).toLowerCase()}`);
  }
  return [...new Set(pairs.filter((x) => seen.has(x.other)).map((x) => x.ref))];
}
