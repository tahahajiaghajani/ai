// The demo module reads the schema over pg_catalog (src/server/modules/demo/catalog.ts), no longer through
// information_schema: on CI's PostgreSQL the web version's load had its read of every column (purge.ts `tablesInfo`)
// canceled at the 30 s statement limit again and again and the pack ended «failed» (1.1.5) — information_schema
// deparses every default with pg_get_expr, which opens the table and waits behind any lock that excludes readers.
// Each new read must answer exactly as the old one did — the same rows and values in the same order — on a fully
// migrated database with a probe of every kind of column it may meet (domains over a built-in type, an array and an
// enum, arrays, enums, serial, identity, generated, a dropped column, a partitioned table, a view, a materialized
// view). Runs on PGlite and, with ITSM_PG_URL or ITSM_PG_BIN (tests/pg-real.ts), on a real PostgreSQL; logs how long
// the old and the new reads took.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "@server/app";
import { createPgliteDb } from "@server/db/pglite";
import { createPostgresDb } from "@server/db/postgres";
import { migrate } from "@server/db/migrate";
import type { Db } from "@server/db";
import { archivable, archiveTableOf } from "@server/engine/ddl";
import { physicalTables } from "@shared/tables";
import { ORG_TABLES, TABLE_COLUMNS, hasColumn, hasTable } from "@server/modules/demo/catalog";
import { realPg, realPgAvailable } from "./pg-real";

// What the demo module read through information_schema before, word for word: purge.ts tablesInfo, verify.ts
// danglingRefs, ledger.ts recordPurged / reclaimLeftovers, clean.ts planNames.
const OLD_TABLE_COLUMNS = `select c.table_name as t, c.column_name as c, c.data_type as dt, c.is_nullable as nul, c.column_default is not null as def, c.is_generated as gen
       from information_schema.columns c
       join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
      where c.table_schema = current_schema() and c.table_name like 'sm\\_%'
      order by c.table_name, c.ordinal_position`;
const OLD_ORG_TABLES = `select c.table_name as t,
            bool_or(c.column_name = 'id') as has_id,
            bool_or(c.column_name = 'deleted_at') as has_deleted
       from information_schema.columns c
       join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
      where c.table_schema = current_schema() and c.table_name like 'sm\\_%'
      group by c.table_name
     having bool_or(c.column_name = 'org_id')
      order by 1`;
const oldHasColumn = (table: string, column: string) =>
  `exists (select 1 from information_schema.columns c where c.table_schema = current_schema() and c.table_name = ${table} and c.column_name = '${column}')`;
const OLD_HAS_TABLE = `select 1 from information_schema.tables where table_schema = current_schema() and table_name = $1`;

const PROBE = `
  create type sm_zz_mood as enum ('calm', 'busy');
  create domain sm_zz_code as varchar(8) default 'x';
  create domain sm_zz_label as text not null;
  create domain sm_zz_ints as int[];
  create domain sm_zz_moods as sm_zz_mood;
  create table sm_zz_probe (
    id uuid primary key default gen_random_uuid(),
    org_id uuid,
    n serial,
    k bigint generated always as identity,
    title text not null,
    code sm_zz_code,
    label sm_zz_label,
    tags text[],
    nums sm_zz_ints,
    mood sm_zz_mood,
    moods sm_zz_moods,
    grade numeric(10, 2) default 0,
    gone int,
    big bigint generated always as (n * 2) stored,
    deleted_at timestamptz
  );
  alter table sm_zz_probe drop column gone;
  create table sm_zz_probe_p (id uuid, org_id uuid, day date not null) partition by range (day);
  create table sm_zz_probe_p1 partition of sm_zz_probe_p for values from ('2020-01-01') to ('2040-01-01');
  create view sm_zz_probe_v as select id, org_id, deleted_at from sm_zz_probe;
  create materialized view sm_zz_probe_m as select id, org_id, deleted_at from sm_zz_probe;
  create sequence sm_zz_probe_seq;`;

const col = (c: string, dt: string, nul: "YES" | "NO", def: boolean, gen: "ALWAYS" | "NEVER" = "NEVER") => ({ t: "sm_zz_probe", c, dt, nul, def, gen });

async function timed<T>(db: Db, sql: string): Promise<{ rows: T[]; ms: number }> {
  const t = performance.now();
  const rows = await db.query<T>(sql);
  return { rows, ms: Math.round(performance.now() - t) };
}

function schemaReads(title: string, open: () => Promise<{ db: Db; close: () => Promise<void> }>, skip = false) {
  describe.skipIf(skip)(`the demo module's schema reads over pg_catalog answer as information_schema did (${title})`, () => {
    let db: Db;
    let close = async () => {};

    beforeAll(async () => {
      ({ db, close } = await open());
      await migrate(db);
      await db.exec(PROBE);
    }, 900_000);
    afterAll(async () => close(), 120_000);

    it("every column of every table (tablesInfo): name, type, nullability, default and generation, in order", async () => {
      const old = await timed<Record<string, unknown>>(db, OLD_TABLE_COLUMNS);
      const now = await timed<Record<string, unknown>>(db, TABLE_COLUMNS);
      console.log(`[demo-catalog ${title}] tablesInfo, ${old.rows.length} columns: information_schema ${old.ms} ms, pg_catalog ${now.ms} ms`);
      expect(now.rows).toEqual(old.rows);
      const tables = new Set(now.rows.map((r) => r.t));
      const registered = physicalTables().flatMap((d) => (archivable(d) ? [d.table, archiveTableOf(d)] : [d.table]));
      expect(registered.filter((t) => !tables.has(t))).toEqual([]); // fully migrated: every table of every module, archives too
      for (const t of ["sm_users", "sm_jobs", "sm_demo_rows", "sm_demo_purged", "sm_zz_probe_p", "sm_zz_probe_p1"]) expect(tables).toContain(t);
      for (const t of ["sm_zz_probe_v", "sm_zz_probe_m", "sm_zz_probe_seq"]) expect(tables).not.toContain(t);
      expect(now.rows.filter((r) => r.t === "sm_zz_probe")).toEqual([
        col("id", "uuid", "NO", true),
        col("org_id", "uuid", "YES", false),
        col("n", "integer", "NO", true),
        col("k", "bigint", "NO", false),
        col("title", "text", "NO", false),
        col("code", "character varying", "YES", false),
        col("label", "text", "NO", false),
        col("tags", "ARRAY", "YES", false),
        col("nums", "ARRAY", "YES", false),
        col("mood", "USER-DEFINED", "YES", false),
        col("moods", "USER-DEFINED", "YES", false),
        col("grade", "numeric", "YES", true),
        col("big", "bigint", "YES", false, "ALWAYS"),
        col("deleted_at", "timestamp with time zone", "YES", false),
      ]);
    }, 600_000);

    it("the tables with org_id, and whether they have id and deleted_at (danglingRefs)", async () => {
      const old = await timed<Record<string, unknown>>(db, OLD_ORG_TABLES);
      const now = await timed<Record<string, unknown>>(db, ORG_TABLES);
      console.log(`[demo-catalog ${title}] danglingRefs' tables, ${old.rows.length}: information_schema ${old.ms} ms, pg_catalog ${now.ms} ms`);
      expect(now.rows).toEqual(old.rows);
      expect(now.rows.filter((r) => String(r.t).startsWith("sm_zz_"))).toEqual([
        { t: "sm_zz_probe", has_id: true, has_deleted: true },
        { t: "sm_zz_probe_p", has_id: true, has_deleted: false },
        { t: "sm_zz_probe_p1", has_id: true, has_deleted: false },
      ]);
    }, 600_000);

    it("a table's column (the ledger) and a table (planNames), for every name of the schema and one that is not there", async () => {
      const names = `(select r.relname::text as name from pg_class r join pg_namespace s on s.oid = r.relnamespace
                       where s.nspname = current_schema() and r.relname like 'sm\\_%' union all select 'sm_zz_nope') x`;
      for (const column of ["deleted_at", "org_id"]) {
        const rows = await db.query<{ name: string; was: boolean; is: boolean }>(
          `select x.name, ${oldHasColumn("x.name", column)} as was, ${hasColumn("x.name", column)} as is from ${names} order by 1`,
        );
        expect(rows.filter((r) => r.was !== r.is)).toEqual([]);
        expect(rows.find((r) => r.name === "sm_zz_probe_v")?.is).toBe(true); // a view's columns too, as information_schema.columns
        expect(rows.find((r) => r.name === "sm_zz_probe_m")?.is).toBe(false);
        expect(rows.find((r) => r.name === "sm_zz_nope")?.is).toBe(false);
      }
      for (const name of ["sm_positions", "sm_position_holders", "sm_zz_probe_p", "sm_zz_probe_v", "sm_zz_probe_m", "sm_zz_probe_seq", "sm_zz_probe_pkey", "sm_zz_nope"]) {
        const was = !!(await db.one(OLD_HAS_TABLE, [name]));
        const is = !!(await db.one<{ x: boolean }>(`select ${hasTable("$1")} as x`, [name]))?.x;
        expect({ name, is }).toEqual({ name, is: was });
      }
    }, 600_000);
  });
}

schemaReads("PGlite", async () => {
  const db = await createPgliteDb({});
  return { db, close: () => db.close() };
});
schemaReads(
  "PostgreSQL",
  async () => {
    const pg = await realPg("demo_catalog");
    const db = createPostgresDb({ url: pg.url, ssl: false, max: 2 });
    return {
      db,
      close: async () => {
        await db.close().catch(() => undefined);
        await pg.stop();
      },
    };
  },
  !realPgAvailable(),
);
