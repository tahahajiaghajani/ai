// The record engine's DDL only adds (engine/ddl.ts): a version once applied stays applied, which is why a version
// recorded as seen (`engine.ddl.seen:<hash>`) is never applied again — the web version's cold-start check
// (db/schema-check.ts) and the migration plan (db/migrate.ts) trust it. Two builds share one database for a while: the
// next build migrates the live database while the previous one still serves (Vercel runs `npm run build`, with
// `migrate:build`, before it switches), and Instant Rollback brings the previous one back over the newer schema
// (docs/SETUP_FA.md §۱۰). Neither may remove what the other reads. Here: a table whose search fields differ between the
// two builds — both stored search documents stay (columns, archive copies and, on PostgreSQL, their trigram indexes)
// and both builds' searches keep answering. With ITSM_TEST_PG_URL (a PostgreSQL superuser URL), the trigram indexes
// are checked on a real server too.
import { describe, it, expect, beforeAll } from "vitest";
import type { TableDef } from "@shared/model/types";
import { FIELD_TYPES } from "@shared/model/types";
import { tableDef } from "@shared/tables";
import { archiveDdl, archiveTableOf, ddlFor, engineChunks, shortName } from "@server/engine/ddl";
import { searchColumn, searchSql, storedSearchFieldsOf } from "@server/engine/sql";
import { migrate, migrateSteps, schemaProgress } from "@server/db/migrate";
import { schemaIsCurrent } from "@server/db/schema-check";
import { createPostgresDb } from "@server/db/postgres";
import type { Queryable } from "@server/db";
import { engineOrg, type EngineOrg } from "./engine-helpers";

const EXTRA = "close_notes";

/** The table as a later build that also searches `EXTRA` defines it: another stored search document (another hash). */
function searchingMore(def: TableDef): TableDef {
  const stored = new Set(storedSearchFieldsOf(def).map((f) => f.name));
  const extra = def.fields.find((f) => f.name === EXTRA);
  expect(extra && FIELD_TYPES[extra.type].sql === "text" && !extra.group && !extra.base && !extra.custom && !stored.has(EXTRA)).toBe(true);
  return { ...def, fields: def.fields.map((f) => (f.name === EXTRA || stored.has(f.name) ? { ...f, search: true } : f)) };
}

/** The stored search documents of a table (columns `search_<8 hex>`). */
async function searchColumns(q: Queryable, table: string): Promise<string[]> {
  const rows = await q.query<{ c: string }>(
    `select column_name as c from information_schema.columns where table_schema = current_schema() and table_name = $1 and column_name ~ '^search_[0-9a-f]{8}$' order by 1`,
    [table],
  );
  return rows.map((r) => r.c);
}

/** What the newer build's DDL does to the table on its way to completing (its chunk of the table and of the archive). */
async function newerBuildMigrates(q: Queryable, newer: TableDef) {
  await q.exec(ddlFor(newer));
  await q.exec(archiveDdl(newer));
  // its last chunk records its own version (and its own seen key)
  await q.query(`update sm_meta set value = 'a-newer-build' where key = 'engine.ddl'`);
  await q.query(`insert into sm_meta (key, value, updated_at) values ('engine.ddl.seen:a-newer-build', 'done', now()) on conflict (key) do nothing`);
}

describe("the engine DDL only adds: a version once applied stays applied", () => {
  let e: EngineOrg;
  const todo = () => tableDef("todo")!;
  const P = () => `/o/${e.org}/r/todo`;
  let id = "";

  beforeAll(async () => {
    e = await engineOrg();
    id = (await e.owner.post(P(), { short_description: "printer jam", close_notes: "toner replaced" })).row.id;
  });

  it("a newer build's search document for a table leaves this build's own: this build trusts its seen version and its search keeps answering", async () => {
    const current = searchColumn(todo())!;
    const next = searchColumn(searchingMore(todo()))!;
    expect(next.name).not.toBe(current.name);
    expect((await e.owner.get(`${P()}?q=printer`)).rows.map((r: { id: string }) => r.id)).toEqual([id]);

    await newerBuildMigrates(e.db, searchingMore(todo()));
    // both documents, on the table and on its archive
    expect(await searchColumns(e.db, "sm_todos")).toEqual([current.name, next.name].sort());
    expect(await searchColumns(e.db, archiveTableOf(todo()))).toEqual([current.name, next.name].sort());
    // this build finds its own version applied (no 503, and it never runs its DDL against the newer build's)...
    expect(await schemaIsCurrent(e.db)).toBe(true);
    expect((await schemaProgress(e.db)).complete).toBe(true);
    expect((await migrateSteps(e.db, {})).ran).toEqual([]);
    // ...and that is true: its search, its archive search and its aggregates answer
    expect((await e.owner.get(`${P()}?q=printer`)).rows.map((r: { id: string }) => r.id)).toEqual([id]);
    expect((await e.owner.get(`${P()}?q=printer&archived=1`)).total).toBe(0);
    expect((await e.owner.post(`${P()}/agg`, { q: "printer", groupBy: ["state"] })).rows).toHaveLength(1);
    // the newer build's document holds the rows already there (with the field it added)
    expect((await e.db.one<{ doc: string }>(`select ${next.name} as doc from sm_todos where id = $1`, [id]))?.doc).toMatch(/printer.*toner/);
  }, 300_000);

  it("this build's chunks run again (a version without the seen key, or the reconcile) keep another build's search document", async () => {
    const current = searchColumn(todo())!;
    const newer = searchingMore(todo());
    const next = searchColumn(newer)!;
    // this build's version unknown here: it reconciles, every chunk once
    await e.db.query(`delete from sm_meta where key like 'engine.ddl.seen:%'`);
    expect(await schemaIsCurrent(e.db)).toBe(false);
    const r = await migrateSteps(e.db, {});
    expect(r.complete).toBe(true);
    expect(r.ran).toEqual(engineChunks().chunks.map((c) => `reconcile:${c.index}`));
    expect(await searchColumns(e.db, "sm_todos")).toEqual([current.name, next.name].sort());
    expect(await searchColumns(e.db, archiveTableOf(todo()))).toEqual([current.name, next.name].sort());
    expect((await e.owner.get(`${P()}?q=printer`)).rows.map((r: { id: string }) => r.id)).toEqual([id]);
    // the other build still finds the row through its own column (its search reads nothing else)
    const params: unknown[] = [e.org];
    const where = searchSql(newer, "t", "toner", params)!;
    expect(where).toContain(`t.${next.name} like`);
    expect((await e.db.query<{ id: string }>(`select t.id from sm_todos t where t.org_id = $1 and ${where}`, params)).map((x) => x.id)).toEqual([id]);
    // and this build's own DDL text never removes a column or an index
    for (const c of engineChunks().chunks) expect(c.sql).not.toMatch(/\bdrop\s+(column|index)\b/i);
  }, 300_000);

  it.skipIf(!process.env.ITSM_TEST_PG_URL)("on PostgreSQL with pg_trgm, both documents keep their trigram indexes", async () => {
    const admin = createPostgresDb({ url: process.env.ITSM_TEST_PG_URL!, ssl: false, max: 1 });
    const name = `itsm_additive_${Date.now()}`;
    await admin.exec(`create database ${name}`);
    const db = createPostgresDb({ url: process.env.ITSM_TEST_PG_URL!.replace(/\/[^/]*$/, `/${name}`), ssl: false, max: 1 });
    try {
      await migrate(db);
      expect(await db.one(`select 1 as ok from pg_extension where extname = 'pg_trgm'`)).toEqual({ ok: 1 });
      const def = todo();
      const newer = searchingMore(def);
      const [current, next] = [searchColumn(def)!, searchColumn(newer)!];
      const arc = archiveTableOf(def);
      const trgm = async () =>
        (await db.query<{ i: string }>(`select indexname as i from pg_indexes where schemaname = current_schema() and tablename in ($1, $2) and indexname like '%trgm' order by 1`, ["sm_todos", arc])).map((r) => r.i);
      const both = [`sm_todos_${current.name}_trgm`, `sm_todos_${next.name}_trgm`, "sm_todos_search_custom_trgm", `${arc}_${current.name}_trgm`, `${arc}_${next.name}_trgm`].map(shortName).sort();
      await newerBuildMigrates(db, newer);
      expect(await trgm()).toEqual(both);
      expect(await schemaIsCurrent(db)).toBe(true);
      // this build's chunks again: nothing of the newer build's goes
      await db.query(`delete from sm_meta where key like 'engine.ddl.seen:%'`);
      expect((await migrateSteps(db, {})).complete).toBe(true);
      expect(await trgm()).toEqual(both);
      expect(await searchColumns(db, "sm_todos")).toEqual([current.name, next.name].sort());
      // and this build's search reads its own column (the planner may use its trigram index)
      const params: unknown[] = [];
      const where = searchSql(def, "t", "printer", params)!;
      expect(where).toContain(`t.${current.name} like`);
      expect(await db.one(`select count(*)::int as n from sm_todos t where ${where}`, params)).toEqual({ n: 0 });
    } finally {
      await db.close();
      await admin.exec(`drop database if exists ${name} with (force)`).catch(() => undefined);
      await admin.close();
    }
  }, 600_000);
});
