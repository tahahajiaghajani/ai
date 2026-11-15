// Several list queries in one request (POST /o/:org/batch/query): each answers exactly as its own POST /r/:table/query
// would — same rows, same totals, same access — and a failing query fails alone, with the Persian error it would have
// had on its own. The web version's shell sends its badge counts this way (src/ui/records/data/batch.ts).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { makeServer, Client, signupWithOrg } from "./helpers";

describe("batched list queries", () => {
  let s: Awaited<ReturnType<typeof makeServer>>;
  let owner: Client;
  let org = "";

  beforeAll(async () => {
    s = await makeServer({ mode: "cloud" });
    owner = new Client(s.app);
    org = await signupWithOrg(owner);
    for (const t of ["یک", "دو", "سه"]) await owner.post(`/o/${org}/r/todo`, { short_description: `کار ${t}` });
  }, 120_000);
  afterAll(async () => s?.db.close());

  it("answers each query as its own request would, and a bad one alone", async () => {
    const count = { size: 1, fields: ["number"], total: true };
    const list = { size: 2, sort: "number" };
    const single = await owner.post(`/o/${org}/r/todo/query`, count);
    const singleList = await owner.post(`/o/${org}/r/todo/query`, list);
    const r = await owner.post(`/o/${org}/batch/query`, {
      queries: [
        { table: "todo", query: count },
        { table: "no_such_table", query: {} },
        { table: "todo", query: list },
      ],
    });
    expect(r.results).toHaveLength(3);
    expect(r.results[0]).toEqual({ ok: true, result: single });
    expect(r.results[0].result.total).toBe(3);
    expect(r.results[1].ok).toBe(false);
    expect(r.results[1].status).toBeGreaterThanOrEqual(400);
    expect(r.results[1].error.message).toMatch(/[؀-ۿ]/);
    expect(r.results[2]).toEqual({ ok: true, result: singleList });
  });

  it("is an organisation request like any other: a non-member gets nothing", async () => {
    const other = new Client(s.app);
    await other.post("/auth/signup", { email: "stranger@example.com", password: "Stranger-pass-1", full_name: "غریبه" });
    await other.post(`/o/${org}/batch/query`, { queries: [{ table: "todo", query: {} }] }, 403);
    await owner.post(`/o/${org}/batch/query`, { queries: [] }, 400);
    await owner.post(`/o/${org}/batch/query`, { queries: Array.from({ length: 26 }, () => ({ table: "todo", query: {} })) }, 400);
  });
});
