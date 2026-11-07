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
import { physicalTables } from "@shared/tables";
import type { Db } from "../db";

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
  out.push(`drop trigger if exists ${t}_sync on ${t};`);
  if (def.features?.sync !== false) {
    out.push(`create trigger ${t}_sync before insert or update on ${t} for each row execute function sm_sync_touch('${def.key}');`);
  }
  out.push(`alter table ${t} enable row level security;`);
  return out.join("\n");
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

/** The DDL of every registered table (deterministic: sorted by key). */
export function ddlForAll(): string {
  return `${physicalTables().map(ddlFor).join("\n\n")}\n\n${REVOKE}\n`;
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
