// The stored search document of a numbered table (sql.ts `searchColumn`, ddl.ts `searchIndex`) holds only the search
// fields every reader of a row may see. A field of a field group (internal, personal, financial…) is searched on its
// own column, and only for a caller who sees it: a member who may read the row but not that group never finds the row
// by its hidden text — not through the stored column, not through its trigram index.
import { describe, it, expect, beforeAll } from "vitest";
import { registerTable, tableDef, TABLES } from "@shared/tables";
import { searchColumn, searchFieldsOf, searchSql, storedSearchFieldsOf } from "@server/engine/sql";
import { archiveDdl, ddlFor } from "@server/engine/ddl";
import type { Db } from "@server/db";
import { makeServer, Client, signupWithOrg } from "./helpers";

registerTable({
  key: "srch_row",
  table: "sm_srch_rows",
  label: "ردیف جست‌وجو",
  plural: "ردیف‌های جست‌وجو",
  icon: "box",
  module: "core",
  area: "work",
  numbered: { prefix: "SR", pad: 4 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", search: true },
    { name: "note", label: "یادداشت داخلی", type: "text", search: true, group: "internal" },
  ],
  scope: {},
  features: { sync: false },
});

describe("stored search document and field groups", () => {
  let db: Db;
  let org = "";
  const def = () => tableDef("srch_row")!;

  beforeAll(async () => {
    const s = await makeServer();
    db = s.db;
    org = await signupWithOrg(new Client(s.app));
    const rows: [string, string | null][] = [
      ["printer jam", "zebra secret"],
      ["zebra crossing", null],
      ["mail queue", "nothing here"],
    ];
    for (const [i, [title, note]] of rows.entries()) {
      await db.query(`insert into sm_srch_rows (id, org_id, no, title, note) values (gen_random_uuid(), $1, $2, $3, $4)`, [org, i + 1, title, note]);
    }
  });

  const run = async (q: string, visible?: (name: string) => boolean) => {
    const params: unknown[] = [org];
    const where = searchSql(def(), "t", q, params, visible ? (f) => visible(f.name) : undefined)!;
    return (await db.query<{ no: number }>(`select t.no from sm_srch_rows t where t.org_id = $1 and ${where} order by t.no`, params)).map((r) => Number(r.no));
  };

  it("no numbered table keeps a field of a field group in its stored document", () => {
    let checked = 0;
    for (const d of TABLES.values()) {
      const col = searchColumn(d);
      if (!col) continue;
      checked++;
      expect(storedSearchFieldsOf(d).filter((f) => f.group)).toEqual([]);
      for (const f of searchFieldsOf(d).filter((x) => x.group)) expect(col.expr, `${d.key}.${f.name}`).not.toMatch(new RegExp(`\\b${f.name}\\b`));
    }
    expect(checked).toBeGreaterThan(50);
    // the two built-in tables that search a restricted field keep searching it — on its own column
    for (const [key, field] of [["service_agreement", "supplier_name"], ["grc_dsr", "subject_name"]] as const) {
      const d = tableDef(key);
      if (!d || !searchFieldsOf(d).some((f) => f.name === field && f.group)) continue;
      expect(searchColumn(d)?.expr ?? "").not.toMatch(new RegExp(`\\b${field}\\b`));
      expect(searchSql(d, "t", "word", [])).toMatch(new RegExp(`t\\.${field}\\b`));
      expect(searchSql(d, "t", "word", [], (f) => f.name !== field)).not.toMatch(new RegExp(`\\b${field}\\b`));
    }
  });

  it("the stored column of the database holds only the open fields", async () => {
    const col = searchColumn(def())!;
    expect(col.expr).toMatch(/\btitle\b/);
    expect(col.expr).not.toMatch(/\bnote\b/);
    const docs = (await db.query<Record<string, string>>(`select ${col.name} as doc from sm_srch_rows where org_id = $1 order by no`, [org])).map((r) => r.doc);
    expect(docs.join(" ")).not.toMatch(/secret/);
    expect(ddlFor(def())).toContain(col.name);
  });

  it("a member without the group never finds a row by the group's text; one with it does", async () => {
    const withoutGroup = (name: string) => name !== "note";
    expect(await run("secret", withoutGroup)).toEqual([]);
    expect(await run("zebra", withoutGroup)).toEqual([2]);
    expect(searchSql(def(), "t", "zebra", [], (f) => f.name !== "note")).not.toMatch(/\bnote\b/);
    // a caller who sees the group searches it through the per-field path
    expect(await run("secret")).toEqual([1]);
    expect(await run("zebra")).toEqual([1, 2]);
    expect(await run("zebra secret")).toEqual([1]);
    expect(await run("printer secret", withoutGroup)).toEqual([]);
    expect(await run("printer secret")).toEqual([1]);
    // the open field still goes through the stored (indexable) column
    expect(searchSql(def(), "t", "printer", [])).toMatch(/t\.search_[0-9a-f]{8} like/);
  });

  it("archives drop a stale stored column and fill the current one once", () => {
    for (const d of TABLES.values()) {
      const col = searchColumn(d);
      const sql = archiveDdl(d);
      if (!sql || !col) continue;
      expect(sql).toContain(`column_name <> '${col.name}'`);
      expect(sql).toMatch(new RegExp(`add column %I text', '[a-z0-9_]+', '${col.name}'`));
      expect(sql).toMatch(new RegExp(`update %I set %I = \\(%s\\)', '[a-z0-9_]+', '${col.name}'`));
      return;
    }
  });
});
