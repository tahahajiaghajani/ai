// Guard: every business table travels between the Windows app and the web, unless it is listed
// here as deliberately local. A new module table that is neither a sync root nor a child of one
// would otherwise silently stay on one side.
import { describe, it, expect, beforeAll } from "vitest";
import { createPgliteDb } from "@server/db/pglite";
import { migrate } from "@server/db/migrate";
import { AGGREGATES } from "@server/sync/registry";
import type { Db } from "@server/db";

const LOCAL_ONLY: Record<string, string> = {
  tz_audit: "each side keeps its own event log",
  tz_devices: "registered Windows apps (cloud side)",
  tz_api_keys: "API keys are used against the web version only",
  tz_integrations: "online shops post their orders to the web version",
  tz_integration_events: "raw webhook deliveries (web version)",
  tz_org_sync: "per-organisation revision counter",
};

describe("sync registry covers every business table", () => {
  let db: Db;
  let tables: { name: string; cols: string[] }[];
  beforeAll(async () => {
    db = await createPgliteDb({});
    await migrate(db, () => {});
    const rows = await db.query<{ table_name: string; cols: string[] }>(
      `select t.table_name, array_agg(c.column_name::text order by c.column_name) as cols
       from information_schema.tables t join information_schema.columns c on c.table_name = t.table_name and c.table_schema = t.table_schema
       where t.table_schema = 'public' and t.table_type = 'BASE TABLE' group by t.table_name`,
    );
    tables = rows.map((r) => ({ name: r.table_name, cols: r.cols }));
  });

  it("classifies every table with an org_id as a sync root, a child of one, or deliberately local", () => {
    const roots = new Set(AGGREGATES.map((a) => a.table));
    const children = new Set(AGGREGATES.flatMap((a) => (a.children ?? []).map((c) => c.table)));
    const stray = tables.filter((t) => t.cols.includes("org_id") && !roots.has(t.name) && !children.has(t.name) && !(t.name in LOCAL_ONLY)).map((t) => t.name);
    expect(stray).toEqual([]);
  });

  it("gives every root the sync columns and its trigger", async () => {
    const triggers = new Set((await db.query<{ tgname: string }>(`select tgname from pg_trigger where not tgisinternal`)).map((r) => r.tgname));
    for (const a of AGGREGATES) {
      const t = tables.find((x) => x.name === a.table);
      expect(t, a.table).toBeTruthy();
      for (const col of ["rev", "updated_at", "deleted_at", "origin", "org_id"]) expect(t!.cols, `${a.table}.${col}`).toContain(col);
      expect(triggers.has(`${a.table}_sync`), `${a.table}_sync trigger`).toBe(true);
      for (const ch of a.children ?? []) expect(tables.find((x) => x.name === ch.table)?.cols, `${ch.table}.${ch.fk}`).toContain(ch.fk);
    }
  });
});
