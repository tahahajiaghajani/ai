// AI governance (docs/spec/AI.md §14): the data-use policy per table enforced by the chain before any model call —
// «هرگز» refuses (logged), «فقط محلی» lets only a connection on the organisation's own computers answer — stricter
// masking per table, the tool and conversation rules of the assistant and agents, the policy rows kept to AI
// administrators, and the console's read models for them only.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "@shared/id";
import { conversationTables, dataUsePlan, isLocalConnection, strictestPii, toolTables, assertToolData } from "@server/modules/ai/datause";
import { embeddable } from "@server/modules/ai/rag/indexer";
import { world, type World } from "./incident-helpers";

const before = process.env.ITSM_AI_FAKE;
let w: World;
let inc = "";

beforeAll(async () => {
  process.env.ITSM_AI_FAKE = "1";
  w = await world();
  await w.o.post(`${w.P}/ai/connections`, { preset: "fake" });
  inc = String((await w.incident({ short_description: "قطعی وی‌پی‌ان شعبهٔ شرق", description: "کاربران به وی‌پی‌ان وصل نمی‌شوند", assignment_group_id: w.g.desk })).id);
  await w.drain();
}, 120_000);

afterAll(() => {
  if (before === undefined) delete process.env.ITSM_AI_FAKE;
  else process.env.ITSM_AI_FAKE = before;
});

const usage = async () => Number((await w.e.db.one<{ n: number }>(`select count(*)::int as n from sm_ai_usage where org_id = $1`, [w.e.org]))!.n);
const policy = (table: string, use: string, pii = "inherit") => w.o.put(`${w.P}/ai/governance/data-policies/${table}`, { use, pii });
const run = (expect = 200) => w.o.post(`${w.P}/ai/skills/record.summary/run`, { table: "incident", id: inc }, expect);

describe("the data-use policy in the chain", () => {
  it("lets a model answer while the table is open to cloud models", async () => {
    const n0 = await usage();
    const r = await run();
    expect(r.fallback).toBe(false);
    expect(await usage()).toBeGreaterThan(n0);
  });

  it("never sends a «هرگز» table to a model and logs the refusal", async () => {
    await policy("incident", "never");
    const n0 = await usage();
    const r = await w.o.req("POST", `${w.P}/ai/skills/record.summary/run`, { table: "incident", id: inc }, undefined as never).catch((e: Error) => e);
    // the skill answers by its rules, or is refused; either way no model was called
    if (r instanceof Error) expect(r.message).toMatch(/403|ai_policy/);
    else expect((r as { fallback: boolean }).fallback).toBe(true);
    expect(await usage()).toBe(n0);
    const log = await w.o.get(`${w.P}/ai/governance/guard-log?kind=policy`);
    expect(log.entries[0].tables).toContain("incident");
    expect(log.entries[0].detail).toMatch(/هیچ مدل/);
  });

  it("keeps a «فقط محلی» table on local connections: refused without one, answered by one", async () => {
    await policy("incident", "local");
    const n0 = await usage();
    const r = await w.o.req("POST", `${w.P}/ai/skills/record.summary/run`, { table: "incident", id: inc }, undefined as never).catch((e: Error) => e);
    if (!(r instanceof Error)) expect((r as { fallback: boolean }).fallback).toBe(true);
    expect(await usage()).toBe(n0);
    // a connection on this computer (the test responder at a loopback address)
    const fake = (await w.e.db.one<Record<string, unknown>>(`select * from sm_ai_connections where org_id = $1 limit 1`, [w.e.org]))!;
    const localId = uuidv7();
    await w.e.db.query(
      `insert into sm_ai_connections (id, org_id, label, preset, protocol, base_url, models, enabled, status) values ($1, $2, 'محلی', 'fake', $3, 'http://127.0.0.1:9/v1', $4::jsonb, true, 'ok')`,
      [localId, w.e.org, fake.protocol, JSON.stringify(fake.models)],
    );
    const ok = await run();
    expect(ok.fallback).toBe(false);
    const last = await w.e.db.one<{ connection_id: string }>(`select connection_id from sm_ai_usage where org_id = $1 order by created_at desc limit 1`, [w.e.org]);
    expect(last!.connection_id).toBe(localId);
    await policy("incident", "cloud");
  });

  it("keeps the policy rows to AI administrators", async () => {
    await w.p.agent.client.put(`${w.P}/ai/governance/data-policies/incident`, { use: "cloud" }, 403);
    const rows = await w.o.get(`${w.P}/ai/governance/data-policies`);
    const row = rows.tables.find((t: any) => t.table === "incident");
    expect(row).toMatchObject({ explicit: true, use: "cloud", rag: true });
    await w.o.put(`${w.P}/ai/governance/data-policies/no_such_table`, { use: "never" }, 400);
  });
});

describe("plans, tools and conversations", () => {
  it("picks the strictest rule of the tables and the strictest masking", async () => {
    await policy("problem", "local", "aggregates");
    await policy("change_request", "never");
    const plan = await dataUsePlan(w.sys, ["incident", "problem"]);
    expect(plan).toMatchObject({ use: "local", pii: "aggregates", local: ["problem"] });
    expect((await dataUsePlan(w.sys, ["problem", "change_request"])).use).toBe("never");
    expect(strictestPii("masked", "aggregates")).toBe("aggregates");
    expect(strictestPii("aggregates", "masked")).toBe("aggregates");
    expect(strictestPii("full", null)).toBe("full");
  });

  it("names the tables of tool calls and of a stored conversation", () => {
    expect(toolTables("search_incident", {})).toEqual(["incident"]);
    expect(toolTables("analytics_report", { table: "change_request" })).toEqual(["change_request"]);
    expect(toolTables("search_knowledge", { tables: ["kb_article"] })).toEqual(["kb_article"]);
    const messages = [
      { parts: [{ type: "tool_call", id: "a", name: "get_problem", input: {} }, { type: "tool_call", id: "b", name: "get_change_request", input: {} }] },
      { parts: [{ type: "tool_result", id: "a", name: "get_problem", content: "{}" }, { type: "tool_result", id: "b", name: "get_change_request", content: "{}", is_error: true }] },
      { parts: [{ type: "tool_result", id: "c", name: "search_knowledge", content: '<data name="tool_result">\n{"hits":[],"data_tables":["kb_article"]}\n</data>' }] },
    ];
    expect(conversationTables(messages)).toEqual(["kb_article", "problem"]);
  });

  it("refuses a tool whose data may not join the conversation", async () => {
    await expect(assertToolData(w.sys, ["change_request"], "assistant", true)).rejects.toThrow(/هیچ مدل/);
    await expect(assertToolData(w.sys, ["problem"], "assistant", false)).rejects.toThrow(/فقط به مدل‌های محلی/);
    await expect(assertToolData(w.sys, ["problem"], "assistant", true)).resolves.toMatchObject({ use: "local" });
    await expect(assertToolData(w.sys, ["incident"], "assistant", false)).resolves.toMatchObject({ use: "cloud" });
  });

  it("knows which connections run on the organisation's computers", () => {
    expect(isLocalConnection({ preset: "ollama", base_url: null })).toBe(true);
    expect(isLocalConnection({ preset: "openai", base_url: null })).toBe(false);
    expect(isLocalConnection({ preset: "custom-openai", base_url: "http://192.168.1.20:8000/v1" })).toBe(true);
    expect(isLocalConnection({ preset: "custom-openai", base_url: "https://api.example.com/v1" })).toBe(false);
    expect(isLocalConnection({ preset: "fake", base_url: null })).toBe(false);
  });

  it("keeps a restricted table from a cloud embedding model", async () => {
    const cloud = { sys: w.sys, embedder: { key: "openai:m:n", row: { preset: "openai", base_url: null } as never, config: {} as never } };
    const local = { sys: w.sys, embedder: { key: "ollama:m:n", row: { preset: "ollama", base_url: null } as never, config: {} as never } };
    expect(await embeddable(cloud, "incident")).toBe(true);
    expect(await embeddable(cloud, "problem")).toBe(false);
    expect(await embeddable(local, "problem")).toBe(true);
    expect(await embeddable(local, "change_request")).toBe(false);
  });
});

describe("the governance console", () => {
  it("is for AI administrators only and holds no record content", async () => {
    for (const p of ["overview", "usage", "quality", "feedback", "guard-log", "data-policies", "oversight", "model-cards", "export"]) await w.p.agent.client.get(`${w.P}/ai/governance/${p}`, 403);
    const o = await w.o.get(`${w.P}/ai/governance/overview`);
    expect(o.skills.some((s: any) => s.key === "record.summary" && s.runs_30d >= 1)).toBe(true);
    expect(o.connections.some((c: any) => c.local)).toBe(true);
    const u = await w.o.get(`${w.P}/ai/governance/usage?days=7`);
    expect(u.by_feature.some((f: any) => f.feature === "skill:record.summary")).toBe(true);
    const x = await w.o.get(`${w.P}/ai/governance/export?days=30`);
    expect(x.data_policies.length).toBeGreaterThan(0);
    expect(JSON.stringify(x)).not.toContain("قطعی وی‌پی‌ان شعبهٔ شرق");
    const cards = await w.o.get(`${w.P}/ai/governance/model-cards`);
    expect(cards.cards.some((c: any) => c.kind === "skill")).toBe(true);
  });
});
