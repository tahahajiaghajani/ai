// Platform fixes found by the modules once they ran together: a test on a linked table that compiles to a constant
// (`base_id.k_groups in_my_groups` of a member without groups) leaves no parameters of the linked table's access check
// behind (PostgreSQL refuses parameters it cannot type), and conditions name the record id — `{ f: "id", op: "in" }`,
// `"base_id.id"`, the base columns created_at / updated_at — with the same answer in `evaluate` and `toSql`.
import { beforeAll, describe, expect, it } from "vitest";
import { kbWorld, type KbWorld } from "./knowledge-helpers";
import { condEnv, orgSchema, readable, toSql } from "@server/engine";
import { evaluate, validateCond, type Cond } from "@shared/model/conditions";
import { tableDef } from "@shared/tables";
import { liveRows } from "@server/modules/incident/common";

let w: KbWorld;
let a1: Record<string, any>;
let a2: Record<string, any>;
let a3: Record<string, any>;

beforeAll(async () => {
  w = await kbWorld();
  a1 = await w.published({ title: "بازنشانی گذرواژه", body: "## گام‌ها\n\n1. صفحهٔ ورود\n2. فراموشی گذرواژه\n" });
  a2 = await w.published({ title: "اتصال به وای‌فای", body: "## گام‌ها\n\n1. شبکهٔ مهمان\n2. ورود\n" });
  a3 = await w.published({ base_id: w.bases.agents, title: "راه‌اندازی دوبارهٔ سرور چاپ", body: "## مسئله\n\nچاپ متوقف است\n\n## محیط\n\nویندوز\n\n## راه‌حل\n\n1. توقف سرویس\n2. آغاز دوباره\n" });
}, 240_000);

/** Distinct placeholders of a SQL text. */
const placeholders = (sql: string) => new Set([...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));

describe("a linked-table test that compiles to a constant", () => {
  it("drops the parameters of the linked table's access check (member without groups)", async () => {
    const ctx = await w.e.ctxOf(w.p.req.userId);
    const schema = await orgSchema(ctx, w.e.db);
    const def = schema.def("kb_article")!;
    const env = await condEnv(ctx);
    expect(env.groups ?? []).toEqual([]);
    for (const op of ["in_my_groups", "is_my_group"] as const) {
      const params: unknown[] = [w.e.org];
      const where = toSql({ f: "base_id.k_groups", op }, def, "t", params, env, { ctx, lookup: schema.lookup });
      expect(where).toBe("(false)");
      // every parameter is referenced (PostgreSQL cannot type an unreferenced one)
      expect(params.length).toBe(1);
    }
    // inside a composition the other leaves keep their parameters, in order
    const params: unknown[] = [];
    const parts = [readable(ctx, def, "t", params, await condEnv(ctx))];
    parts.push(toSql({ or: [{ f: "base_id.k_groups", op: "in_my_groups" }, { f: "base_id.name", op: "contains", v: "راهنما" }, { f: "base_id.k_groups", op: "is_my_group" }] }, def, "t", params, env, { ctx, lookup: schema.lookup }));
    const sql = `select t.id from ${def.table} t where t.org_id = '${w.e.org}' and ${parts.join(" and ")}`;
    expect(placeholders(sql).size).toBe(params.length);
    const rows = await w.e.db.query<{ id: string }>(sql, params);
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining([a1.id, a2.id]));
  });

  it("works through the API and the modules' read helpers", async () => {
    const filter: Cond = { or: [{ f: "base_id.k_groups", op: "in_my_groups" }, { f: "base_id.k_groups", op: "is_my_group" }] };
    const r = await w.p.req.client.post(`${w.P}/r/kb_article/query`, { filter });
    expect(r.rows).toEqual([]);
    const ctx = await w.e.ctxOf(w.p.req.userId);
    expect(await liveRows(w.e.db, ctx, "kb_article", { f: "base_id.k_groups", op: "in_my_unit" })).toEqual([]);
    // a member of a group still matches through the walk
    const km = await w.e.ctxOf(w.p.km.userId);
    const mine = await liveRows(w.e.db, km, "kb_article", { f: "base_id.k_groups", op: "in_my_groups" });
    expect(mine.length).toBeGreaterThan(0);
  });
});

describe("conditions name the record id and the base columns", () => {
  const def = () => tableDef("kb_article")!;

  it("validates id, a dot-walk to an id and the base date columns", () => {
    for (const c of [
      { f: "id", op: "in", v: [a1?.id ?? "00000000-0000-7000-8000-000000000001"] },
      { f: "id", op: "eq", v: "00000000-0000-7000-8000-000000000001" },
      { f: "id", op: "empty" },
      { f: "base_id.id", op: "eq", v: "00000000-0000-7000-8000-000000000001" },
      { f: "created_at", op: "relative", v: { unit: "day", n: 1 } },
      { f: "updated_at", op: "gte", v: "2026-01-01T00:00:00Z" },
    ] as Cond[]) expect(validateCond(c, def()), JSON.stringify(c)).toBeNull();
    // walking through an id is not a path
    expect(validateCond({ f: "id.title", op: "empty" }, def())).not.toBeNull();
  });

  it("toSql and evaluate agree on real rows", async () => {
    const ctx = await w.e.ctxOf(w.p.km.userId);
    const all = await liveRows(w.e.db, ctx, "kb_article", { f: "id", op: "in", v: [a1.id, a2.id, a3.id] });
    expect(all.map((r) => r.id).sort()).toEqual([a1.id, a2.id, a3.id].sort());
    const env = await condEnv(ctx);
    const conds: Cond[] = [
      { f: "id", op: "eq", v: a2.id },
      { f: "id", op: "eq", v: a2.id.toUpperCase() },
      { f: "id", op: "ne", v: a2.id },
      { f: "id", op: "in", v: [a1.id, a3.id] },
      { f: "id", op: "nin", v: [a1.id] },
      { f: "id", op: "in", v: [] },
      { f: "id", op: "nin", v: [] },
      { f: "id", op: "empty" },
      { f: "id", op: "nempty" },
      { f: "id", op: "gt", v: a1.id },
      { f: "base_id.id", op: "eq", v: w.bases.agents },
      { f: "base_id", op: "eq", v: w.bases.agents },
      { f: "created_at", op: "relative", v: { unit: "day", n: 1 } },
      { f: "updated_at", op: "lt", v: "2000-01-01T00:00:00Z" },
      { and: [{ f: "id", op: "in", v: [a1.id, a2.id, a3.id] }, { not: { f: "id", op: "eq", v: a3.id } }] },
    ];
    for (const cond of conds) {
      const scoped: Cond = { and: [{ f: "id", op: "in", v: [a1.id, a2.id, a3.id] }, cond] };
      const sql = (await liveRows(w.e.db, ctx, "kb_article", scoped)).map((r) => r.id as string).sort();
      const js = all.filter((r) => evaluate(cond, { ...r, "base_id.id": r.base_id }, env, def())).map((r) => r.id as string).sort();
      expect(sql, JSON.stringify(cond)).toEqual(js);
    }
    // the record list's filter takes them too
    const r = await w.p.km.client.post(`${w.P}/r/kb_article/query`, { filter: { f: "id", op: "in", v: [a1.id, a3.id] } });
    expect(r.rows.map((x: any) => x.id).sort()).toEqual([a1.id, a3.id].sort());
  });
});
