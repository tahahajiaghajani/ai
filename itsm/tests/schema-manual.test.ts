// The database scripts for running by hand (supabase/schema.sql and supabase/manual/*): built from the very steps the
// app runs, each part small enough for the Supabase SQL Editor, in sync with the code, and — run in order — they leave
// a database the app finds complete (nothing left to do) and identical to one the app built itself. Run partly, the
// app resumes where they stopped.
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createPgliteDb } from "@server/db/pglite";
import { migrate, migrateSteps, schemaProgress } from "@server/db/migrate";
import { manualSchema, MANUAL_PART_BYTES, SQL_EDITOR_LIMIT_BYTES } from "@server/db/manual";
import { schemaIsCurrent, SCHEMA_FINGERPRINT } from "@server/db/schema-check";
import { engineChunks } from "@server/engine/ddl";
import type { Db } from "@server/db";

const ROOT = join(__dirname, "..");
const manualDir = join(ROOT, "supabase", "manual");
const partFiles = () => readdirSync(manualDir).filter((f) => f.endsWith(".sql")).sort();

/** Columns, indexes and triggers of the public schema (order-free): what two ways of building must agree on. */
async function signature(db: Db): Promise<string[]> {
  const rows = await db.query<{ s: string }>(`
    select 'col ' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') || ' ' || coalesce(generation_expression, '') as s
      from information_schema.columns where table_schema = 'public'
    union all select 'idx ' || indexdef from pg_indexes where schemaname = 'public'
    union all select 'trg ' || tgrelid::regclass::text || ' ' || tgname from pg_trigger where not tgisinternal
    order by 1`);
  return rows.map((r) => r.s);
}

describe("database scripts for running by hand", () => {
  it("are what `npm run schema` writes from the app's own steps (and the fingerprint is this build's)", () => {
    const out = manualSchema();
    for (const [rel, content] of Object.entries(out.files)) expect(readFileSync(join(ROOT, rel), "utf8"), `${rel} is stale: npm run schema`).toBe(content);
    const expected = Object.keys(out.files).filter((f) => f.startsWith("supabase/manual/")).map((f) => f.slice("supabase/manual/".length)).sort();
    expect(partFiles()).toEqual(expected);
    // the setup guide names the parts the owner pastes, first to last, and no other count (docs/SETUP_FA.md §۱)
    const guide = readFileSync(join(ROOT, "docs", "SETUP_FA.md"), "utf8");
    for (const f of [expected[0], expected[1], expected[expected.length - 1]]) expect(guide, `docs/SETUP_FA.md names ${f}`).toContain(`\`${f}\``);
    // and no fixed number of migration steps: the plan changes with the engine's chunks (it says `done: <n>/<n> steps`)
    expect(guide.match(/done: \d+\/\d+ steps/g) ?? []).toEqual([]);
    expect(guide).toContain("`done: <n>/<n> steps`");
    const totals = [...guide.matchAll(/\b\d\d-of-(\d\d)\.sql\b/g)].map((m) => m[1]);
    expect(totals.filter((n) => n !== String(expected.length).padStart(2, "0"))).toEqual([]);
    expect(SCHEMA_FINGERPRINT.engine).toBe(engineChunks().hash);
    expect(SCHEMA_FINGERPRINT.engineChunks).toBe(engineChunks().chunks.length);
  });

  it("come in parts well under the SQL Editor's limit that hold every step once, in order", () => {
    const files = partFiles();
    expect(files.length).toBeGreaterThan(1);
    const text = files.map((f) => readFileSync(join(manualDir, f), "utf8"));
    for (const t of text) {
      const bytes = Buffer.byteLength(t);
      expect(bytes).toBeLessThan(SQL_EDITOR_LIMIT_BYTES / 2);
      expect(bytes).toBeLessThan(MANUAL_PART_BYTES + 2_000);
    }
    const all = text.join("\n");
    let at = -1;
    for (const s of manualSchema().steps) {
      const i = all.indexOf(s.sql);
      expect(i, `step ${s.id}`).toBeGreaterThan(at);
      expect(all.indexOf(s.sql, i + 1), `step ${s.id} appears once`).toBe(-1);
      at = i;
    }
    // schema.sql is the same steps in one file
    const whole = readFileSync(join(ROOT, "supabase", "schema.sql"), "utf8");
    for (const s of manualSchema().steps) expect(whole.includes(s.sql)).toBe(true);
  });

  it("run in order, leave nothing for the app to do and the same schema the app builds", async () => {
    const byHand = await createPgliteDb({});
    for (const f of partFiles()) await byHand.exec(readFileSync(join(manualDir, f), "utf8"));
    expect((await schemaProgress(byHand)).complete).toBe(true);
    expect(await schemaIsCurrent(byHand)).toBe(true);
    expect(await migrate(byHand)).toEqual([]);
    // a part run again changes nothing
    await byHand.exec(readFileSync(join(manualDir, partFiles()[1]), "utf8"));
    expect((await schemaProgress(byHand)).complete).toBe(true);
    const byApp = await createPgliteDb({});
    await migrate(byApp);
    expect(await signature(byHand)).toEqual(await signature(byApp));
    await byHand.close();
    await byApp.close();
  }, 300_000);

  it("run partly, the app resumes where they stopped", async () => {
    const db = await createPgliteDb({});
    const files = partFiles();
    for (const f of files.slice(0, 3)) await db.exec(readFileSync(join(manualDir, f), "utf8"));
    const before = await schemaProgress(db);
    expect(before.complete).toBe(false);
    expect(before.done).toBeGreaterThan(5);
    const r = await migrateSteps(db, {});
    expect(r.complete).toBe(true);
    // nothing the parts did is done again
    expect(r.ran).not.toContain("0001_core");
    expect(r.ran).not.toContain("engine:0");
    // only what was missing: the rest of the engine chunks and the later migrations, never the reconcile
    expect(r.ran.some((id) => id.startsWith("reconcile:"))).toBe(false);
    expect(new Set(r.ran).size).toBe(r.ran.length);
    expect(r.ran).toContain("0099_demo_touch");
    expect(await schemaIsCurrent(db)).toBe(true);
    await db.close();
  }, 300_000);
});
