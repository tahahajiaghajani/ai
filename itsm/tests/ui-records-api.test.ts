// The engine behaviour the record UI relies on, end to end through the HTTP API: the form layout designer's
// arrangement row (`custom_field` named "_form" → `def.form.arrangement`), saved views as the list page stores them,
// and the list/record/bulk round trip of the generic pages (version conflicts included).
import { describe, it, expect, beforeAll } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { FORM_ROW } from "@shared/model/arrangement";
import { formLayout } from "../src/ui/records/model/layout";
import { quickCond } from "../src/ui/records/model/filter";
import { viewBody, emptyListState, stateOfView, VIEW_FIELDS } from "../src/ui/records/model/views";
import type { TableDef } from "@shared/model/types";

describe("record UI ↔ engine", () => {
  let e: EngineOrg;
  beforeAll(async () => {
    e = await engineOrg();
  });

  it("surfaces the organisation's form arrangement and never turns its row into a field", async () => {
    const arrangement = {
      tabs: [
        { label: "اصلی", sections: [{ label: "خلاصه", fields: ["priority", "short_description", "short_description", "Bad"] }] },
        { label: "بستن", sections: [{ label: null, fields: ["close_code", "close_notes"] }] },
      ],
    };
    await e.owner.post(`/o/${e.org}/r/custom_field`, { table_key: "todo", name: FORM_ROW, label: "چیدمان فرم", options: arrangement });
    const meta = await e.owner.get(`/o/${e.org}/meta/tables/todo`);
    const def = meta.table as TableDef;
    expect(def.form?.arrangement).toEqual({
      tabs: [
        { label: "اصلی", sections: [{ label: "خلاصه", fields: ["priority", "short_description"] }] },
        { label: "بستن", sections: [{ label: null, fields: ["close_code", "close_notes"] }] },
      ],
    });
    expect(def.fields.some((f) => f.name === FORM_ROW)).toBe(false);
    expect(formLayout(def, { mode: "create" }).map((t) => t.label)).toEqual(["اصلی", "بستن"]);
    // records are untouched by it
    const r = await e.owner.post(`/o/${e.org}/r/todo`, { short_description: "چیدمان" });
    expect(r.row.short_description).toBe("چیدمان");
    // an inactive arrangement row is ignored
    const rows = await e.owner.get(`/o/${e.org}/r/custom_field?filter=${encodeURIComponent(JSON.stringify({ f: "name", op: "eq", v: FORM_ROW }))}`);
    const row = rows.rows[0];
    await e.owner.patch(`/o/${e.org}/r/custom_field/${row.id}`, { active: false, version: row.version });
    expect((await e.owner.get(`/o/${e.org}/meta/tables/todo`)).table.form?.arrangement).toBeUndefined();
  });

  it("stores and applies a saved view the way the list page writes it", async () => {
    const def = (await e.owner.get(`/o/${e.org}/meta/tables/todo`)).table as TableDef;
    const state = emptyListState({ filter: { f: "priority", op: "in", v: ["1", "2"] }, q: "", sort: "-priority", size: 20, mode: "board" });
    const body = viewBody(state, ["number", "short_description", "priority"], quickCond(def, ["open"]));
    const v = await e.owner.post(`/o/${e.org}/r/view`, { table_key: "todo", name: "فوری‌های باز", shared: true, is_default: true, ...body });
    expect(v.row).toMatchObject({ kind: "kanban", page_size: 20, columns: ["number", "short_description", "priority"], shared: true });
    await e.owner.post(`/o/${e.org}/r/todo`, { short_description: "فوری", priority: "1" });
    await e.owner.post(`/o/${e.org}/r/todo`, { short_description: "عادی", priority: "4" });
    const listed = await e.owner.post(`/o/${e.org}/r/todo/query`, { filter: v.row.filter, sort: v.row.sort, size: v.row.page_size });
    expect(listed.rows.map((x: { short_description: string }) => x.short_description)).toEqual(["فوری"]);
    // a list leaves the long fields (filter, columns) out unless they are asked for: the views menu asks for them
    const bare = (await e.owner.get(`/o/${e.org}/r/view?ids=${v.row.id}`)).rows[0];
    expect(bare.filter).toBeUndefined();
    const full = (await e.owner.get(`/o/${e.org}/r/view?ids=${v.row.id}&fields=${VIEW_FIELDS.join(",")}`)).rows[0];
    expect(stateOfView(full).state.filter).toEqual(body.filter);
    expect(stateOfView(full).columns).toEqual(["number", "short_description", "priority"]);
    // another member sees the shared view but cannot change it
    const m = await e.member("member");
    const seen = await m.client.post(`/o/${e.org}/r/view/query`, { filter: { f: "table_key", op: "eq", v: "todo" } });
    expect(seen.rows.map((x: { id: string }) => x.id)).toContain(v.row.id);
    await m.client.patch(`/o/${e.org}/r/view/${v.row.id}`, { name: "x", version: v.row.version }, 403);
  });

  it("answers a stale save with version_conflict and a bulk change with per-record results", async () => {
    const a = await e.owner.post(`/o/${e.org}/r/todo`, { short_description: "همزمانی" });
    await e.owner.patch(`/o/${e.org}/r/todo/${a.row.id}`, { priority: "2", version: a.row.version });
    const stale = await e.owner.patch(`/o/${e.org}/r/todo/${a.row.id}`, { priority: "3", version: a.row.version }, 409);
    expect(stale.error.code).toBe("version_conflict");
    const b = await e.owner.post(`/o/${e.org}/r/todo`, { short_description: "دسته‌جمعی" });
    const bulk = await e.owner.post(`/o/${e.org}/r/todo/bulk`, { ids: [a.row.id, b.row.id], transition: "resolved", data: { close_code: "solved", close_notes: "انجام شد" } });
    expect(bulk).toEqual({ updated: 2, failed: [] });
    const refused = await e.owner.post(`/o/${e.org}/r/todo/bulk`, { ids: [a.row.id], transition: "new" });
    expect(refused.updated).toBe(0);
    expect(refused.failed[0].message).toBeTruthy();
  });
});
