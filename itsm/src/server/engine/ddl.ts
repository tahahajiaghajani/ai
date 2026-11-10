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

/** Idempotent DDL of one table. */
export function ddlFor(def: TableDef): string {
  if (def.virtual) return "";
  const t = def.table;
  const out: string[] = [];
  out.push(`-- ${def.key}: ${def.plural}`);
  out.push(`create table if not exists ${t} (\n  id uuid primary key,\n  org_id uuid not null references sm_orgs(id) on delete cascade,\n  ${BASE_DDL.join(",\n  ")}\n);`);
  for (const col of BASE_DDL) out.push(`alter table ${t} add column if not exists ${col};`);
  if (def.numbered) {
    out.push(`alter table ${t} add column if not exists no integer;`);
    out.push(`alter table ${t} add column if not exists number text generated always as ${numberExpr(def)} stored;`);
  }
  for (const f of def.fields) {
    if (f.base || f.custom) continue;
    out.push(`alter table ${t} add column if not exists ${f.name} ${columnType(f)};`);
  }
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
  const search = searchIndex(def);
  if (search) out.push(search);
  out.push(`drop trigger if exists ${t}_sync on ${t};`);
  if (def.features?.sync !== false) {
    out.push(`create trigger ${t}_sync before insert or update on ${t} for each row execute function sm_sync_touch('${def.key}');`);
  }
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

/** The DDL of every registered table (deterministic: sorted by key), archives after their tables. */
export function ddlForAll(): string {
  const archives = physicalTables().map(archiveDdl).filter(Boolean);
  return `${physicalTables().map(ddlFor).join("\n\n")}\n\n${archives.length ? `${archives.join("\n\n")}\n\n` : ""}${REVOKE}\n`;
}

export function ddlHash(sql = ddlForAll()): string {
  return createHash("sha256").update(sql).digest("hex");
}

const META_KEY = "engine.ddl";

/**
 * Apply the generated DDL when it changed since it was last applied to this database. Returns true when it ran.
 * Serialised with the migrations' advisory lock (several cloud instances may start at once).
 */
export async function reconcileSchema(db: Db, log: (msg: string) => void = () => {}): Promise<boolean> {
  const sql = ddlForAll();
  const hash = ddlHash(sql);
  const stored = await db.one<{ value: string }>(`select value from sm_meta where key = $1`, [META_KEY]).catch(() => null);
  if (stored?.value === hash) return false;
  const ran = await db.tx(async (tx) => {
    await tx.query("select pg_advisory_xact_lock(724100)");
    const again = await tx.one<{ value: string }>(`select value from sm_meta where key = $1`, [META_KEY]);
    if (again?.value === hash) return false;
    await tx.exec(sql);
    await tx.query(
      `insert into sm_meta (key, value, updated_at) values ($1, $2, now()) on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [META_KEY, hash],
    );
    return true;
  });
  if (ran) log("engine schema reconciled");
  return ran;
}
