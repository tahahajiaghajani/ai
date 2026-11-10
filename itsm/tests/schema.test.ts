// The database script: every migration is idempotent (a second run changes nothing and fails nowhere), the files
// for Supabase are exactly what `npm run schema` writes, and only the platform's neutral sm_* tables exist.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPgliteDb } from "@server/db/pglite";
import { MIGRATIONS } from "@server/db/migrations";
import { migrate } from "@server/db/migrate";

const ROOT = join(__dirname, "..");

describe("migrations", () => {
  it("are numbered, titled in Persian and in order", () => {
    expect(MIGRATIONS.map((m) => m.id)).toEqual(["0001_core", "0002_platform", "0003_integrations", "0004_ai", "0005_engine", "0006_engine_tables", "0007_access", "0010_notify", "0011_flows", "0020_ai_rag", "0045_knowledge", "0050_access_locations", "0052_ai_skills", "0053_grant_epochs", "0058_ai_agents", "0064_ai_ml", "0067_portal", "0070_portal_surveys", "0080_admin_integration", "0090_auth_directory", "0091_directory_identity", "0095_scale", "0098_demo", "0099_demo_touch"]);
    for (const m of MIGRATIONS) expect(m.title).toMatch(/[؀-ۿ]/);
  });

  it("run twice in a row without errors, on both runtimes' flavours", async () => {
    for (const desktop of [false, true]) {
      const db = await createPgliteDb({ desktop });
      for (let round = 0; round < 2; round++) for (const m of MIGRATIONS) await db.tx((tx) => tx.exec(m.sql));
      expect(await migrate(db)).toEqual(MIGRATIONS.map((m) => m.id)); // recorded only now; nothing failed
      expect(await migrate(db)).toEqual([]);
      await db.close();
    }
  });

  it("supabase/schema.sql applies twice to an empty database and creates the same tables as the app", async () => {
    const sql = readFileSync(join(ROOT, "supabase", "schema.sql"), "utf8");
    const a = await createPgliteDb({});
    await a.exec(sql);
    await a.exec(sql);
    const b = await createPgliteDb({});
    await migrate(b);
    const tables = async (db: typeof a) =>
      (await db.query<{ t: string }>(`select tablename as t from pg_tables where schemaname = 'public' order by tablename`)).map((r) => r.t);
    expect(await tables(a)).toEqual(await tables(b));
    expect((await tables(a)).every((t) => t.startsWith("sm_"))).toBe(true);
    // every table has row level security on (Supabase's public roles get nothing)
    const open = await a.query(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(open).toEqual([]);
    await a.close();
    await b.close();
  });

  it("names only the platform's settings (itsm.*) and its own functions (sm_*)", () => {
    const all = MIGRATIONS.map((m) => m.sql).join("\n");
    for (const m of all.matchAll(/current_setting\('([^']+)'/g)) expect(m[1]).toMatch(/^itsm\./);
    for (const m of all.matchAll(/create or replace function (\w+)/g)) expect(m[1]).toMatch(/^sm_/);
    for (const m of all.matchAll(/create table if not exists (\w+)/g)) expect(m[1]).toMatch(/^sm_/);
  });
});
