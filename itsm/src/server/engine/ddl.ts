// DDL generated from the table registry: one physical table per TableDef with the engine's base columns, a typed
// column per field, the indexes lists need, the sync trigger and row level security. Everything is idempotent
// (`if not exists`), so the same script creates a fresh database and brings an older one up to date additively.
//
// - The migration `0006_engine_tables` runs `ddlForAll()` (and `npm run schema` writes it to supabase/schema.sql).
// - `reconcileSchema(db)` runs right after the migrations on both runtimes (src/server/db/migrate.ts) and re-applies
//   the generated DDL whenever its hash (sm_meta 'engine.ddl') differs: a new table or field reaches every existing
//   database without a hand-written migration. Changes are additive only — a removed field keeps its column, a
//   changed type keeps the old column type (write a migration for those).
import { createHash } from "node:crypto";
import type { FieldDef, TableDef } from "@shared/model/types";
import { FIELD_TYPES } from "@shared/model/types";
import { onTableRegistered, physicalTables } from "@shared/tables";
import type { Db } from "../db";
import { normSql, searchColumn } from "./sql";

/** SQL type of a field's column. */
export function columnType(f: FieldDef): string {
  const sql = FIELD_TYPES[f.type].sql;
  if (f.type === "bool") return `boolean not null default ${f.default === true ? "true" : "false"}`;
  return sql;
}

/** A PostgreSQL identifier of at most 63 bytes (long index names keep a hash of the full name). */
export function shortName(name: string): string {
  if (name.length <= 63) return name;
  return `${name.slice(0, 54)}_${createHash("sha256").update(name).digest("hex").slice(0, 8)}`;
}

/** `TODO` + zero padded counter; the counter wider than `pad` is kept whole. */
function numberExpr(def: TableDef): string {
  const { prefix, pad } = def.numbered!;
  if (!/^[A-Z][A-Z0-9_-]{0,11}$/.test(prefix)) throw new Error(`table "${def.key}": numbering prefix must be [A-Z][A-Z0-9_-]*`);
  if (!Number.isInteger(pad) || pad < 1 || pad > 12) throw new Error(`table "${def.key}": numbering pad must be 1..12`);
  return `(case when no is null then null when length(no::text) >= ${pad} then '${prefix}' || no::text else '${prefix}' || lpad(no::text, ${pad}, '0') end)`;
}

const BASE_DDL = [
  "workspace_id uuid",
  "domain_id uuid",
  "unit_id uuid",
  "created_at timestamptz not null default now()",
  "created_by uuid",
  "updated_at timestamptz not null default now()",
  "updated_by uuid",
  "rev bigint not null default 0",
  "version integer not null default 1",
  "deleted_at timestamptz",
  "origin text",
  "custom jsonb not null default '{}'::jsonb",
];

/**
 * The demo pack's capture (docs/DEMO_FA.md, src/server/db/scope.ts): every table with `id` and `org_id` has an AFTER
 * INSERT trigger that, inside a transaction carrying `itsm.demo = <the row's organisation>`, records the new row in
 * `sm_demo_rows` (migration 0098_demo). The WHEN clause is evaluated without calling the function, so ordinary writes
 * pay nothing but one setting lookup per row.
 */
export const DEMO_CAPTURE_FN = `create or replace function sm_demo_capture() returns trigger language plpgsql as $demo$
begin
  insert into sm_demo_rows (org_id, row_id, tbl) values (new.org_id, new.id, tg_table_name) on conflict do nothing;
  return null;
end
$demo$;`;

/** The capture trigger of one table (it must have `id uuid` and `org_id uuid`). */
export function demoCaptureDdl(table: string): string {
  const name = shortName(`${table}_demo`);
  // one statement per table (a fresh database runs this for every table: migrations stay fast on the embedded one)
  return `create or replace trigger ${name} after insert on ${table} for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();`;
}

/**
 * What demo work changed in REAL rows (docs/DEMO_FA.md, migration 0099_demo_touch): an AFTER UPDATE OR DELETE trigger
 * that, inside the demo scope only, keeps the row's image before demo work first touched it and its image after the
 * last demo write in `sm_demo_touched`. The purge puts exactly those rows back, and only when nothing outside the demo
 * scope changed them since (otherwise it reports them). Demo rows themselves are skipped.
 */
export const DEMO_TOUCH_FN = `create or replace function sm_demo_touch() returns trigger language plpgsql as $demo$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := case when tg_op = 'UPDATE' then to_jsonb(new) else null end;
begin
  if exists (select 1 from sm_demo_rows d where d.org_id = old.org_id and d.row_id = old.id) then
    return null;
  end if;
  insert into sm_demo_touched (org_id, row_id, tbl, before, after, conflict, at)
  values (old.org_id, old.id, tg_table_name, v_old, v_new, false, now())
  on conflict (org_id, row_id) do update
     set after = excluded.after,
         -- something outside the demo scope changed the row between two demo writes: never put it back blindly
         conflict = sm_demo_touched.conflict or sm_demo_touched.after is null
           or (sm_demo_touched.after - 'rev' - 'updated_at') <> (v_old - 'rev' - 'updated_at'),
         at = now();
  return null;
end
$demo$;`;

/** The change-capture trigger of one table (it must have `id uuid` and `org_id uuid`). */
export function demoTouchDdl(table: string): string {
  const name = shortName(`${table}_demo_t`);
  return `create or replace trigger ${name} after update or delete on ${table} for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();`;
}

/** Idempotent DDL of one table. */
export function ddlFor(def: TableDef): string {
  if (def.virtual) return "";
  const t = def.table;
  const out: string[] = [];
  out.push(`-- ${def.key}: ${def.plural}`);
  const own = def.fields.filter((f) => !f.base && !f.custom).map((f) => `${f.name} ${columnType(f)}`);
  const numbered = def.numbered ? ["no integer", `number text generated always as ${numberExpr(def)} stored`] : [];
  const searchCol = searchColumn(def);
  // a fresh table is created whole, in one statement (its stored columns too: adding one later rewrites the table);
  // an older copy of it is first brought up to date column by column — skipped on a fresh database, where those
  // thousands of statements would each find their column already there
  const columns = [...BASE_DDL, ...numbered, ...own, ...(searchCol ? [`${searchCol.name} text generated always as (${searchCol.expr}) stored`] : [])];
  const alters = [...BASE_DDL, ...numbered, ...own].map((col) => `    alter table ${t} add column if not exists ${col};`);
  out.push(["do $cols$", "begin", `  if to_regclass('${t}') is not null then`, ...alters, "  end if;", "end", "$cols$;"].join("\n"));
  out.push(`create table if not exists ${t} (\n  id uuid primary key,\n  org_id uuid not null references sm_orgs(id) on delete cascade,\n  ${columns.join(",\n  ")}\n);`);
  // the stored search document before any index: adding a stored generated column rewrites the table and rebuilds every
  // index already on it (each build is a file sync), so a fresh table gets it while it has only its primary key
  const search = searchIndex(def);
  if (search) out.push(search);
  const idx = (suffix: string, body: string, unique = false) =>
    out.push(`create ${unique ? "unique " : ""}index if not exists ${shortName(`${t}_${suffix}`)} on ${t} ${body};`);
  if (def.numbered) idx("no_uk", "(org_id, no)", true);
  idx("rev_idx", "(org_id, rev)");
  // the default list orders (newest first, ties by id) read straight from these
  idx("upd_idx", "(org_id, updated_at desc, id desc) where deleted_at is null");
  idx("crt_idx", "(org_id, created_at desc, id desc) where deleted_at is null");
  for (const f of def.fields) {
    if (f.base || f.custom) continue;
    if (f.unique) idx(`${f.name}_uk`, `(org_id, ${f.name}) where deleted_at is null`, true);
    if (!f.index && f.name !== def.states?.field) continue;
    if (FIELD_TYPES[f.type].array) idx(`${f.name}_gin`, `using gin (${f.name})`);
    else idx(`${f.name}_idx`, `(org_id, ${f.name}) where deleted_at is null`);
  }
  for (const u of def.unique ?? []) idx(`${u.join("_")}_uk`, `(org_id, ${u.join(", ")}) where deleted_at is null`, true);
  // the access model's predicate (src/server/access/predicate.ts) on scoped tables: workspace, unit and domain anchors
  // and the "own" (and readers) user fields, so a requester's or a department head's list is an index lookup too
  if (def.scope?.own?.length || def.scope?.group) {
    for (const col of ["workspace_id", "unit_id", "domain_id"]) idx(`${col.replace(/_id$/, "")}_acc_idx`, `(org_id, ${col}) where deleted_at is null and ${col} is not null`);
    for (const name of [...(def.scope.own ?? []), ...(def.scope.readers ?? []), def.scope.watchers].filter(Boolean) as string[]) {
      const f = def.fields.find((x) => x.name === name);
      if (!f || f.base || f.custom || f.index) continue;
      if (FIELD_TYPES[f.type].array) idx(`${f.name}_gin`, `using gin (${f.name})`);
      else idx(`${f.name}_idx`, `(org_id, ${f.name}) where deleted_at is null`);
    }
  }
  // work queues (docs/PERFORMANCE_FA.md §۶): the open records of a group, newest first — a small partial index (open
  // rows are a few percent of a task table) that answers «my groups' open work» for a group of any size
  if (def.fields.some((f) => f.name === "active" && f.type === "bool" && !f.custom) && def.scope?.group) {
    const g = def.fields.find((f) => f.name === def.scope!.group);
    if (g && !g.custom && !g.base) idx("open_grp_idx", `(org_id, ${g.name}, updated_at desc) where deleted_at is null and active`);
  }
  // time windows of dashboards and reports (opened in the last six months, by month…): records arrive in time order,
  // so a BRIN index of a few pages narrows a window to its share of the table
  if (def.fields.some((f) => f.name === "opened_at" && f.type === "datetime" && !f.custom && !f.base)) idx("opened_brin", "using brin (opened_at)");
  out.push(`drop trigger if exists ${t}_sync on ${t};`);
  if (def.features?.sync !== false) {
    out.push(`create trigger ${t}_sync before insert or update on ${t} for each row execute function sm_sync_touch('${def.key}');`);
  }
  out.push(demoCaptureDdl(t));
  out.push(demoTouchDdl(t));
  out.push(`alter table ${t} enable row level security;`);
  return out.join("\n");
}

/**
 * The stored search document of a numbered table (sql.ts `searchColumn`): a generated column with the normalised text
 * of its built-in search fields — on every runtime (PGlite included: searches read it instead of normalising rows) —
 * and, where pg_trgm is installed (PostgreSQL, Supabase; migration 0095 creates it when available), a trigram index on
 * it plus a small partial one on the normalised custom values, so `like '%word%'` from the search box and the global
 * search is an index lookup. A column of an earlier list of search fields (another hash) is dropped with its indexes;
 * the operator class is taken from the extension's own schema.
 */
export function searchIndex(def: TableDef): string {
  const col = searchColumn(def);
  const t = def.table;
  if (!col) {
    // no stored document (any more): a column of an earlier list of search fields goes, with its indexes
    if (def.virtual || !def.numbered) return "";
    return [
      "do $search$",
      "declare old record;",
      "begin",
      `  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = '${t}' and column_name ~ '^search_[0-9a-f]{8}$' loop`,
      `    execute format('alter table %I drop column if exists %I', '${t}', old.column_name);`,
      "  end loop;",
      "end",
      "$search$;",
    ].join("\n");
  }
  const like =`${t.replace(/_/g, "\\_")}\\_search\\_%`;
  const custom = normSql("custom::text");
  return [
    "do $search$",
    "declare s text; old record;",
    "begin",
    `  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = '${t}' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> '${col.name}' loop`,
    `    execute format('alter table %I drop column if exists %I', '${t}', old.column_name);`,
    "  end loop;",
    `  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', '${t}', '${col.name}', $x$${col.expr}$x$);`,
    "  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';",
    "  if s is not null then",
    `    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = '${t}' and indexname like '${like}' and indexname not in ('${shortName(`${t}_${col.name}_trgm`)}', '${shortName(`${t}_search_custom_trgm`)}') loop`,
    "      execute format('drop index if exists %I', old.indexname);",
    "    end loop;",
    `    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', '${shortName(`${t}_${col.name}_trgm`)}', '${t}', '${col.name}', s);`,
    `    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', '${shortName(`${t}_search_custom_trgm`)}', '${t}', $x$${custom}$x$, s);`,
    "  end if;",
    "end",
    "$search$;",
  ].join("\n");
}

/** Supabase: nothing for the public roles (same block as every migration ends with). */
const REVOKE = `do $do$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'sm\\_%' loop
    execute format('alter table %I enable row level security', t.tablename);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table %I from anon', t.tablename);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table %I from authenticated', t.tablename);
    end if;
  end loop;
end
$do$;`;

/** Keys of the tables another table scopes as its parent (`scope.parent`), recomputed when a table registers. */
let scopeParentKeys: Set<string> | null = null;
onTableRegistered(() => {
  scopeParentKeys = null;
});
function scopeParents(): Set<string> {
  if (!scopeParentKeys) {
    scopeParentKeys = new Set();
    for (const x of physicalTables()) {
      const ref = x.scope?.parent ? x.fields.find((f) => f.name === x.scope?.parent)?.ref : undefined;
      if (ref) scopeParentKeys.add(ref);
    }
  }
  return scopeParentKeys;
}

/**
 * Tables whose closed records may leave the hot table for an archive (docs/PERFORMANCE_FA.md §۸, engine/archive.ts):
 * numbered work records with an open/closed flag (`active`) that neither scope a parent nor are scoped as one — a
 * child's read rule takes its parent's rule on the parent's hot row (access/predicate.ts `readTerms`, service.ts
 * `parentOf`), so purging an archived parent's tombstone would hide its children (a security incident's tasks,
 * evidence and regulatory clocks) from everyone.
 */
export function archivable(def: TableDef): boolean {
  if (def.virtual || !def.numbered || def.scope?.parent || scopeParents().has(def.key)) return false;
  return def.fields.some((f) => f.name === "active" && f.type === "bool" && !f.custom) && def.fields.some((f) => f.name === "closed_at" && !f.custom);
}

/** The archive table of an archivable table. */
export const archiveTableOf = (def: TableDef) => shortName(`${def.table}_arc`);

/**
 * The archive of an archivable table: the same columns (numbers and the search document kept as stored, not
 * generated), the record's archival time, the indexes reads of old records use — by number, by the requester and
 * the group, newest first, the search document (trigram, where pg_trgm exists) — no sync trigger (archived records
 * stay on the server) and row level security.
 */
export function archiveDdl(def: TableDef): string {
  if (!archivable(def)) return "";
  const a = archiveTableOf(def);
  const out: string[] = [`-- ${def.key}: archive`];
  out.push(`create table if not exists ${a} (\n  id uuid primary key,\n  org_id uuid not null references sm_orgs(id) on delete cascade,\n  archived_at timestamptz not null default now()\n);`);
  for (const col of BASE_DDL) out.push(`alter table ${a} add column if not exists ${col};`);
  out.push(`alter table ${a} add column if not exists no integer;`, `alter table ${a} add column if not exists number text;`);
  for (const f of def.fields) {
    if (f.base || f.custom) continue;
    out.push(`alter table ${a} add column if not exists ${f.name} ${columnType(f)};`);
  }
  const search = searchColumn(def);
  // the archive's copy of the stored search document (archival copies it): a column of an earlier list of search fields
  // is dropped (with its index), and a new one is filled once from the archived rows' own fields
  out.push(
    [
      "do $arcs$",
      "declare old record;",
      "begin",
      `  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = '${a}' and column_name ~ '^search_[0-9a-f]{8}$'${search ? ` and column_name <> '${search.name}'` : ""} loop`,
      `    execute format('alter table %I drop column if exists %I', '${a}', old.column_name);`,
      "  end loop;",
      ...(search
        ? [
            `  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = '${a}' and column_name = '${search.name}') then`,
            `    execute format('alter table %I add column %I text', '${a}', '${search.name}');`,
            `    execute format('update %I set %I = (%s)', '${a}', '${search.name}', $x$${search.expr}$x$);`,
            "  end if;",
          ]
        : []),
      "end",
      "$arcs$;",
    ].join("\n"),
  );
  const idx =(suffix: string, body: string) => out.push(`create index if not exists ${shortName(`${a}_${suffix}`)} on ${a} ${body};`);
  idx("no_idx", "(org_id, no)");
  idx("arch_idx", "(org_id, archived_at)");
  idx("upd_idx", "(org_id, updated_at desc, id desc) where deleted_at is null");
  for (const name of [...new Set([...(def.scope?.own ?? []), def.scope?.group, "unit_id"].filter(Boolean) as string[])]) {
    const f = def.fields.find((x) => x.name === name);
    if (f && !f.custom && !FIELD_TYPES[f.type].array) idx(`${name}_idx`, `(org_id, ${name}) where deleted_at is null`);
  }
  if (search) {
    out.push(
      [
        "do $arc$",
        "declare s text;",
        "begin",
        "  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';",
        `  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', '${shortName(`${a}_${search.name}_trgm`)}', '${a}', '${search.name}', s); end if;`,
        "end",
        "$arc$;",
      ].join("\n"),
    );
  }
  out.push(`alter table ${a} enable row level security;`);
  return out.join("\n");
}

/**
 * pg_trgm where the server offers it (PostgreSQL, Supabase), before any table: the search documents' trigram indexes
 * (`searchIndex`) are created with their tables, so a fresh database never builds the tables twice. The same block as
 * migration 0095_scale (which still runs for databases made before it); PGlite has no pg_trgm and skips it.
 */
export const TRGM_EXTENSION = `do $ext$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_trgm')
     and exists (select 1 from pg_available_extensions where name = 'pg_trgm') then
    begin
      create extension pg_trgm;
    exception when others then
      raise notice 'pg_trgm not installed: %', sqlerrm;
    end;
  end if;
end
$ext$;`;

/** The generated DDL in its pieces, in order: functions and extension, one per table (sorted by key), archives, REVOKE. */
function ddlPieces(): string[] {
  const tables = physicalTables();
  return [`${DEMO_CAPTURE_FN}\n\n${DEMO_TOUCH_FN}\n\n${TRGM_EXTENSION}`, ...tables.map(ddlFor).filter(Boolean), ...tables.map(archiveDdl).filter(Boolean), REVOKE];
}

/** The DDL of every registered table (deterministic: sorted by key), archives after their tables. */
export function ddlForAll(): string {
  return `${ddlPieces().join("\n\n")}\n`;
}

export function ddlHash(sql = ddlForAll()): string {
  return createHash("sha256").update(sql).digest("hex");
}

const META_KEY = "engine.ddl";
/** sm_meta keys of the chunks of one DDL version already applied: `engine.ddl.part:<hash>:<index>`. */
const PART_KEY = "engine.ddl.part:";
/**
 * sm_meta keys of every DDL version ever completed here: `engine.ddl.seen:<hash>`. The DDL is additive (a removed field
 * keeps its column), so a version once applied stays applied: an older deployment still serving while a newer build
 * migrated the database (Vercel builds before it switches) finds its own version seen and does not apply it again.
 */
const SEEN_KEY = "engine.ddl.seen:";

/**
 * Bytes of generated DDL per chunk. A chunk is one step of the migration (one transaction): about 25 tables, a second
 * or two on a small database — well inside one request of a serverless function (Vercel: 60 s) — and a few of them
 * together still fit the Supabase SQL Editor (supabase/manual, ≈ 0.98 MB per query there).
 */
export const ENGINE_CHUNK_BYTES = 100_000;

export interface EngineChunk {
  /** 0-based position and the number of chunks of this DDL version */
  index: number;
  total: number;
  /** the DDL version (sha256 of `ddlForAll()`) */
  hash: string;
  /** names of the tables it creates or brings up to date (progress and logs) */
  tables: string[];
  /**
   * The chunk's DDL and its own bookkeeping: it records itself in sm_meta and, when it completes the set, records the
   * version (`engine.ddl`) and the migration 0006 — so the app (src/server/db/migrate.ts) and a person pasting
   * supabase/manual into the SQL Editor run the very same text and either resumes where the other stopped.
   */
  sql: string;
}

let plan: { hash: string; chunks: EngineChunk[] } | null = null;
onTableRegistered(() => {
  plan = null;
});

/** The generated DDL in chunks of about `ENGINE_CHUNK_BYTES` (cached until a table registers). */
export function engineChunks(): { hash: string; chunks: EngineChunk[] } {
  if (plan) return plan;
  const pieces = ddlPieces();
  const hash = ddlHash(`${pieces.join("\n\n")}\n`);
  const groups: string[][] = [];
  let size = Infinity;
  for (const p of pieces) {
    if (size + p.length > ENGINE_CHUNK_BYTES && groups.length && groups[groups.length - 1].length) size = Infinity;
    if (size === Infinity) {
      groups.push([]);
      size = 0;
    }
    groups[groups.length - 1].push(p);
    size += p.length;
  }
  const total = groups.length;
  const chunks = groups.map((g, index): EngineChunk => {
    const body = g.join("\n\n");
    const tables = [...new Set([...body.matchAll(/^create table if not exists (\w+)/gm)].map((m) => m[1]))];
    const part = `${PART_KEY}${hash}:${index}`;
    const sql = [
      `-- engine DDL ${index + 1}/${total} (${hash.slice(0, 12)})`,
      body,
      `insert into sm_meta (key, value, updated_at) values ('${part}', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();`,
      "do $engine$",
      "begin",
      `  if (select count(*) from sm_meta where key like '${PART_KEY}${hash}:%') >= ${total} then`,
      `    insert into sm_meta (key, value, updated_at) values ('${META_KEY}', '${hash}', now()) on conflict (key) do update set value = excluded.value, updated_at = now();`,
      `    insert into sm_meta (key, value, updated_at) values ('${SEEN_KEY}${hash}', 'done', now()) on conflict (key) do nothing;`,
      `    delete from sm_meta where key like '${PART_KEY}%';`,
      "    insert into sm_migrations (id) values ('0006_engine_tables') on conflict (id) do nothing;",
      "  end if;",
      "end",
      "$engine$;",
    ].join("\n");
    return { index, total, hash, tables, sql };
  });
  plan = { hash, chunks };
  return plan;
}

/** What of the current DDL version this database has: everything (`complete`), or the chunks already applied. */
export interface EngineProgress {
  complete: boolean;
  done: Set<number>;
}

/** Parse what sm_meta says about the engine DDL (the stored version and the chunk keys). */
export function engineProgress(stored: string | null | undefined, parts: string[], hash = engineChunks().hash): EngineProgress {
  if (stored === hash || parts.includes(`${SEEN_KEY}${hash}`)) return { complete: true, done: new Set() };
  const prefix = `${PART_KEY}${hash}:`;
  return { complete: false, done: new Set(parts.filter((k) => k.startsWith(prefix)).map((k) => Number(k.slice(prefix.length)))) };
}

/** sm_meta's facts about the engine DDL: the stored version, and the chunk and version keys (`parts`). */
export async function readEngineProgress(q: Pick<Db, "query">): Promise<{ stored: string | null; parts: string[] }> {
  const rows = await q.query<{ key: string; value: string | null }>(`select key, value from sm_meta where key = '${META_KEY}' or key like '${PART_KEY}%' or key like '${SEEN_KEY}%'`);
  return { stored: rows.find((r) => r.key === META_KEY)?.value ?? null, parts: rows.filter((r) => r.key !== META_KEY).map((r) => r.key) };
}

/**
 * Apply the generated DDL when it changed since it was last applied to this database, chunk by chunk (each its own
 * transaction under the migrations' advisory lock; several cloud instances may start at once). Returns true when it ran.
 * The web version runs the same chunks within a time budget per request (src/server/db/migrate.ts `migrateSteps`).
 */
export async function reconcileSchema(db: Db, log: (msg: string) => void = () => {}): Promise<boolean> {
  const { hash, chunks } = engineChunks();
  const first = await readEngineProgress(db).catch(() => ({ stored: null, parts: [] as string[] }));
  if (first.stored === hash) return false;
  let ran = false;
  for (const chunk of chunks) {
    const did = await db.tx(async (tx) => {
      await tx.query("select pg_advisory_xact_lock(724100)");
      const r = await readEngineProgress(tx);
      const p = engineProgress(r.stored, r.parts, hash);
      if (p.complete || p.done.has(chunk.index)) return false;
      await tx.exec(chunk.sql);
      return true;
    });
    ran ||= did;
  }
  if (ran) log("engine schema reconciled");
  return ran;
}
