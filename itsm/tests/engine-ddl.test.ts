// Generated DDL: one idempotent script per table definition (base columns, typed columns, the number, indexes, the
// sync trigger, row level security), applied by the migration 0006 and re-applied by `reconcileSchema` whenever the
// registry changed — a new table or field reaches an existing database without a hand-written migration. Plus the
// registry's checks of table definitions.
import { describe, it, expect } from "vitest";
import { createPgliteDb } from "@server/db/pglite";
import { migrate } from "@server/db/migrate";
import { ddlFor, ddlForAll, ddlHash, reconcileSchema, shortName } from "@server/engine/ddl";
import { buildTable, registerTable, tableDef, TABLES } from "@shared/tables";
import type { TableDef } from "@shared/model/types";

const probe = (extra: TableDef["fields"] = []): TableDef => ({
  key: "ddl_probe",
  table: "sm_ddl_probes",
  label: "آزمون",
  plural: "آزمون‌ها",
  icon: "box",
  module: "core",
  area: "work",
  numbered: { prefix: "PRB", pad: 5 },
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", unique: true },
    { name: "labels", label: "برچسب‌ها", type: "tags", index: true },
    { name: "flag", label: "پرچم", type: "bool", default: true },
    ...extra,
  ],
  scope: {},
});

describe("generated DDL", () => {
  it("describes a table completely", () => {
    const sql = ddlFor(tableDef("todo")!);
    expect(sql).toContain("create table if not exists sm_todos (\n  id uuid primary key,\n  org_id uuid not null references sm_orgs(id) on delete cascade,");
    for (const col of ["short_description text", "state text", "priority text", "tags jsonb", "estimate numeric", "due_at timestamptz", "active boolean not null default true", "time_worked bigint", "watch_list jsonb", "assigned_to uuid", "version integer not null default 1", "custom jsonb not null default '{}'::jsonb"]) {
      expect(sql).toContain(col);
    }
    expect(sql).toContain("number text generated always as (case when no is null then null when length(no::text) >= 7 then 'TODO' || no::text else 'TODO' || lpad(no::text, 7, '0') end) stored");
    expect(sql).toContain("create unique index if not exists sm_todos_no_uk on sm_todos (org_id, no);");
    expect(sql).toContain("create index if not exists sm_todos_state_idx on sm_todos (org_id, state) where deleted_at is null;");
    expect(sql).toContain("create index if not exists sm_todos_assigned_to_idx on sm_todos (org_id, assigned_to) where deleted_at is null;");
    expect(sql).toContain("create index if not exists sm_todos_assignment_group_id_idx on sm_todos (org_id, assignment_group_id) where deleted_at is null;");
    expect(sql).toContain("create trigger sm_todos_sync before insert or update on sm_todos for each row execute function sm_sync_touch('todo');");
    expect(sql).toContain("alter table sm_todos enable row level security;");
    const p = ddlFor(buildTable(probe()));
    expect(p).toContain("create unique index if not exists sm_ddl_probes_name_uk on sm_ddl_probes (org_id, name) where deleted_at is null;");
    expect(p).toContain("create index if not exists sm_ddl_probes_labels_gin on sm_ddl_probes using gin (labels);");
    expect(p).toContain("flag boolean not null default true");
    expect(shortName("x".repeat(80))).toHaveLength(63);
    expect(ddlHash()).toBe(ddlHash(ddlForAll()));
  });

  it("is idempotent and is reconciled only when the registry changed", async () => {
    const db = await createPgliteDb({});
    await migrate(db);
    const stored = await db.one<{ value: string }>(`select value from sm_meta where key = 'engine.ddl'`);
    expect(stored?.value).toBe(ddlHash());
    // the same script again: nothing fails, nothing changes
    await db.exec(ddlForAll());
    expect(await reconcileSchema(db)).toBe(false);
    // a new table reaches the database
    const before = new Map(TABLES);
    try {
      registerTable(probe());
      expect(await reconcileSchema(db)).toBe(true);
      await db.query(`insert into sm_ddl_probes (id, org_id, no, name) select gen_random_uuid(), id, 7, 'x' from sm_orgs limit 1`).catch(() => undefined);
      const cols = async () => (await db.query<{ c: string }>(`select column_name as c from information_schema.columns where table_name = 'sm_ddl_probes' order by 1`)).map((r) => r.c);
      expect(await cols()).toEqual(expect.arrayContaining(["id", "org_id", "no", "number", "name", "labels", "flag", "rev", "version", "custom", "deleted_at"]));
      expect(await reconcileSchema(db)).toBe(false);
      // and so does a new field of an existing table (additively)
      registerTable(probe([{ name: "weight", label: "وزن", type: "decimal" }]));
      expect(await reconcileSchema(db)).toBe(true);
      expect(await cols()).toContain("weight");
      expect((await db.one<{ value: string }>(`select value from sm_meta where key = 'engine.ddl'`))!.value).toBe(ddlHash());
      // the generated tables keep the sync trigger and row level security
      const t = await db.one<{ rls: boolean }>(`select relrowsecurity as rls from pg_class where relname = 'sm_ddl_probes'`);
      expect(t?.rls).toBe(true);
      expect(await db.one(`select 1 from pg_trigger where tgname = 'sm_ddl_probes_sync'`)).toBeTruthy();
    } finally {
      TABLES.clear();
      for (const [k, v] of before) TABLES.set(k, v);
    }
    await db.close();
  }, 240_000);

  it("refuses definitions that would generate bad SQL or confuse the engine", () => {
    const t = (patch: Partial<TableDef>) => () => buildTable({ ...probe(), ...patch });
    expect(t({ key: "Bad-Key" })).toThrow(/key/);
    expect(t({ table: "todos" })).toThrow(/sm_/);
    expect(t({ fields: [{ name: "select", label: "x", type: "string" }] })).toThrow(/reserved/);
    expect(t({ fields: [{ name: "version", label: "x", type: "int" }] })).toThrow(/base column/);
    expect(t({ fields: [{ name: "u_x", label: "x", type: "int" }] })).toThrow(/custom/);
    expect(t({ fields: [{ name: "a", label: "x", type: "ref" }] })).toThrow(/needs ref/);
    expect(t({ fields: [{ name: "a", label: "x", type: "nope" as never }] })).toThrow(/unknown type/);
    expect(t({ display: "missing" })).toThrow(/display/);
    expect(t({ list: { columns: ["missing"], order: "name" } })).toThrow(/list column/);
    expect(t({ states: { field: "state", initial: "x", states: [{ value: "a", label: "a", category: "new" }], transitions: [] } })).toThrow(/initial/);
    expect(t({ rowAccess: { read: { f: "missing", op: "is_me" } } })).not.toThrow(); // conditions are checked once registered
    expect(() => registerTable({ ...probe(), key: "ddl_probe_bad", table: "sm_ddl_probe_bads", rowAccess: { read: { f: "missing", op: "is_me" } } })).toThrow(/rowAccess/);
    TABLES.delete("ddl_probe_bad");
    // the task's own fields, scope and states come with extends: "task"
    const todo = tableDef("todo")!;
    expect(todo.fields.map((f) => f.name)).toEqual(expect.arrayContaining(["short_description", "state", "assigned_to", "watch_list", "tags", "estimate", "number", "created_at"]));
    expect(todo.scope).toMatchObject({ group: "assignment_group_id", watchers: "watch_list" });
    expect(todo.states?.initial).toBe("new");
    expect(todo.features).toMatchObject({ journal: true, attachments: true, watchers: true, links: true, history: true, sync: true });
    expect(todo.fields.find((f) => f.name === "close_code")?.choices).toBe("todo.close_code");
  });
});
