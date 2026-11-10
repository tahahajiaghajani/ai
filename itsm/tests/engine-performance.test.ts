// Lists stay fast on a large table: the engine's own page queries (as generated, with the access predicate) are
// answered through indexes — never a sequential scan of the table — and display values take one query per
// referenced table, whatever the page size.
import { describe, it, expect, beforeAll } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { list } from "@server/engine";
import type { Ctx } from "@server/context";

describe("list performance", () => {
  let e: EngineOrg;
  let ctx: Ctx;
  let seen: { sql: string; params: unknown[] }[] = [];

  beforeAll(async () => {
    e = await engineOrg();
    await e.db.query(
      `insert into sm_todos (id, org_id, no, short_description, state, priority, assigned_to, caller_id, created_by, custom, updated_at)
       select gen_random_uuid(), $1, g, 'کار شمارهٔ ' || g, case when g % 3 = 0 then 'new' else 'closed' end, (1 + g % 5)::text,
              case when g % 100 = 0 then $2::uuid end, $2::uuid, $2::uuid, '{}'::jsonb, now() - (g || ' minutes')::interval
       from generate_series(1, 20000) g`,
      [e.org, e.ownerId],
    );
    await e.db.query(`insert into sm_numbers (org_id, table_key, last) values ($1, 'todo', 20000)`, [e.org]);
    await e.db.query(`analyze sm_todos`);
    const real = await e.ctxOf(e.ownerId);
    const spy = (fn: (sql: string, params?: unknown[]) => Promise<unknown>) => (sql: string, params?: unknown[]) => {
      seen.push({ sql, params: params ?? [] });
      return fn(sql, params);
    };
    const db = { ...real.db, query: spy(real.db.query.bind(real.db)), one: spy(real.db.one.bind(real.db)) } as Ctx["db"];
    ctx = { ...real, db };
  });

  async function plan(params: Parameters<typeof list>[2]): Promise<{ plans: string[]; queries: number }> {
    seen = [];
    await list(ctx, "todo", params);
    const queries = seen.filter((q) => /from sm_todos t where/.test(q.sql) || /from sm_org_members m join sm_users/.test(q.sql));
    const plans: string[] = [];
    // the page itself (counting every matching row of a one-organisation table is a scan by nature: `total: false` skips it)
    for (const q of queries.filter((x) => /from sm_todos t where/.test(x.sql) && / limit \d+/.test(x.sql))) {
      const rows = await e.db.query<{ "QUERY PLAN": string }>(`explain ${q.sql}`, q.params);
      plans.push(rows.map((r) => r["QUERY PLAN"]).join("\n"));
    }
    return { plans, queries: queries.length };
  }

  it("answers the default list, filters, number search and sorts from indexes", async () => {
    const cases: Parameters<typeof list>[2][] = [
      {},
      { sort: "-number" },
      { filter: { f: "state", op: "eq", v: "new" } },
      { filter: { f: "assigned_to", op: "is_me" } },
      { q: "TODO0012345" },
      { page: 3, size: 100, sort: "-created_at" },
    ];
    for (const c of cases) {
      const { plans } = await plan(c);
      expect(plans.length, JSON.stringify(c)).toBeGreaterThan(0);
      for (const p of plans) {
        expect(p, `${JSON.stringify(c)}\n${p}`).not.toMatch(/Seq Scan on sm_todos/);
        expect(p, JSON.stringify(c)).toMatch(/Index/);
      }
    }
  });

  it("labels the references of a whole page with one query per referenced table", async () => {
    const small = await plan({ size: 5, fields: ["number", "assigned_to", "caller_id", "created_by"] });
    const big = await plan({ size: 500, fields: ["number", "assigned_to", "caller_id", "created_by"] });
    expect(big.queries).toBe(small.queries);
  });

  // docs/PERFORMANCE_FA.md §۶: the HTTP API counts up to COUNT_LIMIT; pages continue after a cursor (no OFFSET)
  it("counts a long list up to the limit and pages by cursor", async () => {
    const capped = await list(ctx, "todo", { countLimit: 1000, size: 20 });
    expect(capped.total).toBe(1000);
    expect(capped.capped).toBe(true);
    const exact = await list(ctx, "todo", { size: 20 });
    expect(exact.total).toBe(20000);
    expect(exact.capped).toBeUndefined();
    const ids = (r: { rows: Record<string, unknown>[] }) => r.rows.map((x) => String(x.id));
    const p1 = await list(ctx, "todo", { sort: "-updated_at", size: 50, total: false });
    expect(p1.next).toBeTruthy();
    const viaCursor = await list(ctx, "todo", { sort: "-updated_at", size: 50, page: 2, after: p1.next!, total: false });
    expect(ids(viaCursor)).toEqual(ids(await list(ctx, "todo", { sort: "-updated_at", size: 50, page: 2, total: false })));
    expect(ids(viaCursor)).not.toContain(ids(p1)[0]);
    // a cursor of another sort is ignored: the page number decides
    const other = await list(ctx, "todo", { sort: "-created_at", size: 50, page: 2, after: p1.next!, total: false });
    expect(ids(other)).toEqual(ids(await list(ctx, "todo", { sort: "-created_at", size: 50, page: 2, total: false })));
    // sorts on keys that may be empty page by number
    expect((await list(ctx, "todo", { sort: "priority", size: 50, total: false })).next).toBeUndefined();
    // the cursor's page is an index range scan without OFFSET
    seen = [];
    await list(ctx, "todo", { sort: "-updated_at", size: 50, page: 300, after: p1.next!, total: false });
    const q = seen.find((x) => /from sm_todos t where/.test(x.sql) && / limit 50/.test(x.sql))!;
    expect(q.sql).not.toMatch(/offset/);
    const plan = (await e.db.query<{ "QUERY PLAN": string }>(`explain ${q.sql}`, q.params)).map((r) => r["QUERY PLAN"]).join("\n");
    expect(plan).toMatch(/Index Scan using sm_todos_upd_idx/);
  });
});

