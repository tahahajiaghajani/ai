// A stand-in module for the tests. The platform itself has no business records, so the generic machinery — master-data
// CRUD and spreadsheet import (@shared/entities + modules/data/crud.ts), record numbers, synchronisation of aggregates
// with children, the pulse, cross-organisation checks — is exercised through this fixture, registered exactly the way
// a real module registers itself: a migration, entries of ENTITIES, aggregates of the sync registry and routes on
// `moduleRoutes`. Importing this file (before the first server is made) is all a test needs.
//
//   test_group  sm_test_groups      master data, automatic code from 1, created by name on import (autoCreate)
//   test_item   sm_test_items       master data, automatic code from 1001, every field type a form offers
//   test_doc    sm_test_docs        a numbered record (no per organisation) with lines in sm_test_doc_lines
//                                   (no CRUD entity: its routes are /api/o/:org/test/docs)
import { z } from "zod";
import { MIGRATIONS } from "@server/db/migrations";
import { registerAggregate } from "@server/sync/registry";
import { moduleRoutes } from "@server/routes/modules";
import { router, body } from "@server/http/hono";
import { notFound } from "@server/http/errors";
import { insertRow, nextNo, updateRow } from "@server/db/sql";
import { ENTITIES, ACTIVE_FIELD, codeField } from "@shared/entities";
import { uuidv7 } from "@shared/id";

const SYNC_COLUMNS = `created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text`;

export const FIXTURE_MIGRATION = {
  id: "9001_test_fixture",
  title: "ماژول آزمایشی (فقط آزمون‌ها)",
  sql: /* sql */ `
create table if not exists sm_test_groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references sm_orgs(id) on delete cascade,
  code text,
  name text not null,
  is_active boolean not null default true,
  ${SYNC_COLUMNS}
);
create unique index if not exists sm_test_groups_code_uk on sm_test_groups (org_id, code) where deleted_at is null;
create index if not exists sm_test_groups_rev_idx on sm_test_groups (org_id, rev);

create table if not exists sm_test_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references sm_orgs(id) on delete cascade,
  code text,
  name text not null,
  kind text not null default 'hardware',
  group_id uuid,
  email text,
  mobile text,
  tags jsonb not null default '[]'::jsonb,
  qty numeric not null default 0,
  starts_on date,
  notes text,
  data jsonb,
  is_active boolean not null default true,
  ${SYNC_COLUMNS}
);
create unique index if not exists sm_test_items_code_uk on sm_test_items (org_id, code) where deleted_at is null;
create index if not exists sm_test_items_rev_idx on sm_test_items (org_id, rev);

create table if not exists sm_test_docs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references sm_orgs(id) on delete cascade,
  no int not null,
  title text not null default '',
  ${SYNC_COLUMNS}
);
create unique index if not exists sm_test_docs_no_uk on sm_test_docs (org_id, no) where deleted_at is null;
create index if not exists sm_test_docs_rev_idx on sm_test_docs (org_id, rev);

create table if not exists sm_test_doc_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  doc_id uuid not null references sm_test_docs(id) on delete cascade,
  line_no int not null,
  item_id uuid,
  qty numeric not null default 0,
  text text
);
create index if not exists sm_test_doc_lines_doc_idx on sm_test_doc_lines (doc_id);

drop trigger if exists sm_test_groups_sync on sm_test_groups;
create trigger sm_test_groups_sync before insert or update on sm_test_groups for each row execute function sm_sync_touch('test_group');
drop trigger if exists sm_test_items_sync on sm_test_items;
create trigger sm_test_items_sync before insert or update on sm_test_items for each row execute function sm_sync_touch('test_item');
drop trigger if exists sm_test_docs_sync on sm_test_docs;
create trigger sm_test_docs_sync before insert or update on sm_test_docs for each row execute function sm_sync_touch('test_doc');
`,
};

// ---------------------------------------------------------------- registration (once per test file)
if (!MIGRATIONS.some((m) => m.id === FIXTURE_MIGRATION.id)) {
  MIGRATIONS.push(FIXTURE_MIGRATION);

  ENTITIES.test_group = {
    key: "test_group",
    table: "sm_test_groups",
    title: "گروه",
    plural: "گروه‌ها",
    area: "settings",
    display: "name",
    code: { field: "code", start: 1 },
    order: "code",
    autoCreate: true,
    fields: [codeField(1), { name: "name", label: "نام", type: "text", required: true, list: true, search: true, span: 12 }, ACTIVE_FIELD],
  };

  ENTITIES.test_item = {
    key: "test_item",
    table: "sm_test_items",
    title: "قلم",
    plural: "قلم‌ها",
    area: "settings",
    display: "name",
    sub: "code",
    code: { field: "code", start: 1001 },
    order: "code",
    fields: [
      codeField(1001),
      { name: "name", label: "نام", type: "text", required: true, list: true, search: true, span: 12 },
      {
        name: "kind",
        label: "نوع",
        type: "select",
        default: "hardware",
        list: true,
        filter: true,
        options: [
          { value: "hardware", label: "سخت‌افزار" },
          { value: "software", label: "نرم‌افزار" },
          { value: "service", label: "خدمت" },
        ],
      },
      { name: "group_id", label: "گروه", type: "ref", ref: "test_group", list: true },
      { name: "email", label: "ایمیل", type: "text", format: "email", ltr: true },
      { name: "mobile", label: "موبایل", type: "text", format: "mobile", search: true, ltr: true },
      {
        name: "tags",
        label: "برچسب‌ها",
        type: "multiselect",
        filter: true,
        options: [
          { value: "critical", label: "حیاتی" },
          { value: "shared", label: "مشترک" },
          { value: "spare", label: "یدکی" },
        ],
      },
      { name: "qty", label: "تعداد", type: "decimal", default: "0" },
      { name: "starts_on", label: "تاریخ شروع", type: "date" },
      { name: "notes", label: "یادداشت", type: "textarea" },
      { name: "data", label: "داده", type: "json", hidden: true },
      ACTIVE_FIELD,
    ],
  };

  registerAggregate({ entity: "test_group", table: "sm_test_groups", area: "settings", code: { column: "code", start: 1 }, order: 10 });
  registerAggregate({ entity: "test_item", table: "sm_test_items", area: "settings", code: { column: "code", start: 1001 }, order: 11 });
  registerAggregate({ entity: "test_doc", table: "sm_test_docs", area: "settings", children: [{ table: "sm_test_doc_lines", fk: "doc_id" }], numbered: { byKind: false }, order: 20 });

  // the numbered record: no under the organisation's write lock, lines replaced with their root (which is touched,
  // so the change synchronises)
  const docs = router();
  const lineSchema = z.object({ text: z.string().max(200).nullish(), qty: z.union([z.string(), z.number()]).optional(), item_id: z.string().uuid().nullish() });
  docs.get("/docs", async (c) => {
    const ctx = c.get("ctx");
    ctx.need("settings", "view");
    const rows = await ctx.db.query(`select * from sm_test_docs where org_id = $1 and deleted_at is null order by no`, [ctx.org.id]);
    return c.json({ rows, total: rows.length });
  });
  docs.get("/docs/:id", async (c) => {
    const ctx = c.get("ctx");
    ctx.need("settings", "view");
    const doc = await ctx.db.one(`select * from sm_test_docs where id = $1 and org_id = $2 and deleted_at is null`, [c.req.param("id"), ctx.org.id]);
    if (!doc) throw notFound("سند پیدا نشد");
    const lines = await ctx.db.query(`select * from sm_test_doc_lines where doc_id = $1 order by line_no`, [c.req.param("id")]);
    return c.json({ doc, lines });
  });
  docs.post("/docs", async (c) => {
    const ctx = c.get("ctx");
    ctx.need("settings", "edit");
    const input = await body(c, z.object({ title: z.string().max(200).default(""), lines: z.array(lineSchema).max(50).default([]) }));
    const doc = await ctx.write(async (tx) => {
      const id = uuidv7();
      const no = await nextNo(tx, "sm_test_docs", ctx.org.id);
      const row = await insertRow<{ id: string; no: number }>(tx, "sm_test_docs", { id, org_id: ctx.org.id, no, title: input.title, origin: ctx.cfg.origin });
      let i = 0;
      for (const l of input.lines) await insertRow(tx, "sm_test_doc_lines", { id: uuidv7(), org_id: ctx.org.id, doc_id: id, line_no: ++i, text: l.text ?? null, qty: String(l.qty ?? 0), item_id: l.item_id ?? null }, "id");
      return row;
    });
    return c.json({ doc });
  });
  docs.patch("/docs/:id", async (c) => {
    const ctx = c.get("ctx");
    ctx.need("settings", "edit");
    const input = await body(c, z.object({ title: z.string().max(200).optional(), lines: z.array(lineSchema).max(50).optional() }));
    const doc = await ctx.write(async (tx) => {
      const id = c.req.param("id");
      const row = await updateRow(tx, "sm_test_docs", { id, org_id: ctx.org.id }, { ...(input.title !== undefined ? { title: input.title } : {}), origin: ctx.cfg.origin });
      if (!row) throw notFound("سند پیدا نشد");
      if (input.lines) {
        await tx.query(`delete from sm_test_doc_lines where doc_id = $1`, [id]);
        let i = 0;
        for (const l of input.lines) await insertRow(tx, "sm_test_doc_lines", { id: uuidv7(), org_id: ctx.org.id, doc_id: id, line_no: ++i, text: l.text ?? null, qty: String(l.qty ?? 0), item_id: l.item_id ?? null }, "id");
      }
      return row;
    });
    return c.json({ doc });
  });
  moduleRoutes.route("/test", docs);
}

/** The fixture is registered (importing this file does it); call it to make the import explicit in a test. */
export function useFixtureModule(): void {}
