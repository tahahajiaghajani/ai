// «فراخوانی HTTP» with a stub fetch: only the connection's base host and allowed hosts (exact or *.wildcard), auth
// from the connection's engine secret (Bearer, header, query, Basic) that never reaches a log, JSON bodies with
// pills, mapping values out of the answer, non-2xx answers and timeouts on the error path, the idempotency key, and
// the web version's SSRF guard (internal addresses, http).
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { E, N, flowsKit, graph, line, type FlowsKit } from "./flows-helpers";
import { executeRun, hostAllowed, startRun } from "@server/modules/flows";
import { aiNet } from "@server/modules/ai/net";
import type { ServerConfig } from "@server/context";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

describe("flows: HTTP step", () => {
  let o: EngineOrg;
  let k: FlowsKit;
  let flowId = "";
  const calls: Call[] = [];
  let answer: (c: Call, signal?: AbortSignal | null) => Promise<Response> = async () => Response.json({ ok: true });
  const stub = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const h: Record<string, string> = {};
    for (const [key, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) h[key.toLowerCase()] = v;
    const c: Call = { url: String(input), method: init?.method ?? "GET", headers: h, body: (init?.body as string) ?? null };
    calls.push(c);
    return answer(c, init?.signal);
  }) as typeof fetch;
  const lookup = aiNet.lookup;
  afterEach(() => {
    aiNet.lookup = lookup;
    calls.length = 0;
    answer = async () => Response.json({ ok: true });
  });

  let cfg: ServerConfig;
  const conn = async (fields: Record<string, unknown>) =>
    (await o.owner.post(`${k.P}/r/flow_connection`, { name: `سرویس ${Math.random().toString(36).slice(2, 8)}`, base_url: "https://api.example.com/v1", ...fields })).row.id as string;
  const run = async (g: unknown, c: Partial<ServerConfig> = {}, inputs: Record<string, unknown> = {}) => {
    const id = await o.db.tx((tx) =>
      startRun(tx, {
        orgId: o.org,
        flow: { id: flowId, name: "HTTP" },
        version: { id: null, no: null },
        graph: g as never,
        trigger: { kind: "test", inputs },
        actorId: o.ownerId,
        runAs: { kind: "user", userId: o.ownerId },
        depth: 0,
        test: true,
      }),
    );
    await executeRun({ ...cfg, ...c }, id, { deadline: Date.now() + 15_000 });
    return k.detail(id);
  };

  beforeAll(async () => {
    o = await engineOrg();
    k = flowsKit(o);
    cfg = { ...o.cfg, fetch: stub };
    flowId = await k.flow({}, line());
  });

  it("calls the connection with its secret, an idempotency key and pills, and maps the answer", async () => {
    aiNet.lookup = async () => ["93.184.216.34"];
    const c = await conn({ auth: "bearer", secret: "s3cr3t-token" });
    answer = async () => Response.json({ data: { ticket: { id: 42 } }, items: [{ name: "cpu", v: 7 }] });
    const d = await run(
      line(N("h", "call_http", { connection: c, path: "/tickets/{{trigger.inputs.n}}", query: [{ key: "q", value: "{{trigger.inputs.word}}" }], headers: [{ key: "X-Trace", value: "t-{{trigger.inputs.n}}" }], map: [{ name: "ticket", path: "data.ticket.id" }, { name: "cpu", path: "items[name=cpu].v" }] })),
      {},
      { n: 5, word: "چاپگر" },
    );
    expect(d.run.state).toBe("completed");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.example.com/v1/tickets/5?q=%DA%86%D8%A7%D9%BE%DA%AF%D8%B1");
    expect(calls[0].headers.authorization).toBe("Bearer s3cr3t-token");
    expect(calls[0].headers["x-trace"]).toBe("t-5");
    expect(calls[0].headers["idempotency-key"]).toBe(`${d.run.id}:s2`);
    expect(d.context.steps.h.output).toMatchObject({ status: 200, ok: true, ticket: 42, cpu: 7 });
    // the secret is nowhere in the run's log or data
    expect(JSON.stringify(d)).not.toContain("s3cr3t-token");
    expect(JSON.stringify(await o.db.query(`select * from sm_flow_run_steps where run_id = $1`, [d.run.id]))).not.toContain("s3cr3t-token");
  });

  it("goes only to the base host and the allowed hosts", async () => {
    aiNet.lookup = async () => ["93.184.216.34"];
    const c = await conn({ hosts: ["files.example.com", "*.cdn.example.com"] });
    expect(hostAllowed("FILES.example.com.", { base_url: "https://api.example.com", hosts: ["files.example.com"] })).toBe(true);
    expect(hostAllowed("cdn.example.com", { base_url: "https://api.example.com", hosts: ["*.cdn.example.com"] })).toBe(false);
    const g = (path: string) =>
      graph([N("h", "call_http", { connection: c, path }), N("e", "set_vars", { vars: [{ name: "err", value: "{{steps.h.error}}" }] })], [E("trigger", "h"), E("h", "e", "error")]);
    expect((await run(g("https://files.example.com/a.json"))).context.vars).toEqual({});
    expect((await run(g("https://eu.cdn.example.com/x"))).context.vars).toEqual({});
    const evil = await run(g("https://evil.example.org/steal"));
    expect(evil.context.vars.err).toMatch(/evil\.example\.org.*فهرست مجاز/);
    expect(calls.map((x) => new URL(x.url).hostname)).toEqual(["files.example.com", "eu.cdn.example.com"]);
    const http = await run(g("http://files.example.com/a"));
    expect(http.context.vars.err).toMatch(/https/);
  });

  it("applies the secret as a header, a query parameter or Basic auth", async () => {
    aiNet.lookup = async () => ["93.184.216.34"];
    const header = await conn({ auth: "header", auth_name: "X-API-Key", secret: "k1" });
    const query = await conn({ auth: "query", auth_name: "api_key", secret: "k2" });
    const basic = await conn({ auth: "basic", username: "bot", secret: "pw" });
    await run(line(N("a", "call_http", { connection: header }), N("b", "call_http", { connection: query }), N("c", "call_http", { connection: basic })));
    expect(calls[0].headers["x-api-key"]).toBe("k1");
    expect(new URL(calls[1].url).searchParams.get("api_key")).toBe("k2");
    expect(calls[2].headers.authorization).toBe(`Basic ${Buffer.from("bot:pw").toString("base64")}`);
  });

  it("sends JSON bodies with pills keeping their types", async () => {
    aiNet.lookup = async () => ["93.184.216.34"];
    const c = await conn({});
    await run(line(N("h", "call_http", { connection: c, method: "POST", path: "/items", body: '{"n": {{trigger.inputs.n}}, "t": "{{trigger.inputs.t}}", "tags": {{trigger.inputs.tags}}}' })), {}, { n: 3, t: 'a "quoted" word', tags: ["x"] });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers["content-type"]).toMatch(/application\/json/);
    expect(JSON.parse(calls[0].body!)).toEqual({ n: 3, t: 'a "quoted" word', tags: ["x"] });
  });

  it("puts a non-2xx answer and a timeout on the error path", async () => {
    aiNet.lookup = async () => ["93.184.216.34"];
    const c = await conn({});
    const g = graph([N("h", "call_http", { connection: c, timeout: 1 }), N("e", "set_vars", { vars: [{ name: "status", value: "{{steps.h.output.status}}" }, { name: "err", value: "{{steps.h.error}}" }] })], [E("trigger", "h"), E("h", "e", "error")]);
    answer = async () => new Response(JSON.stringify({ message: "no" }), { status: 503, headers: { "content-type": "application/json" } });
    let d = await run(g);
    expect(d.context.vars.status).toBe(503);
    expect(d.context.vars.err).toMatch(/503/);
    answer = (_c, signal) =>
      new Promise((_, reject) => {
        signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    d = await run(g);
    expect(d.context.vars.err).toMatch(/پاسخ نداد/);
    // without an error path the run fails
    answer = async () => new Response("x", { status: 500 });
    d = await run(line(N("h", "call_http", { connection: c })));
    expect(d.run.state).toBe("failed");
  });

  it("refuses internal addresses on the web version and lets the Windows app use its own network", async () => {
    const c = await conn({});
    aiNet.lookup = async () => ["10.0.0.5"];
    const g = graph([N("h", "call_http", { connection: c }), N("e", "set_vars", { vars: [{ name: "err", value: "{{steps.h.error}}" }] })], [E("trigger", "h"), E("h", "e", "error")]);
    expect((await run(g)).context.vars.err).toMatch(/داخلی/);
    expect(calls).toHaveLength(0);
    // the desktop runtime does not use the guard
    const d = await run(g, { mode: "desktop" });
    expect(d.context.vars).toEqual({});
    expect(calls).toHaveLength(1);
  });

  it("checks connections when they are saved, and refuses inactive ones", async () => {
    await o.owner.post(`${k.P}/r/flow_connection`, { name: "داخلی", base_url: "https://localhost/api" }, 400);
    await o.owner.post(`${k.P}/r/flow_connection`, { name: "بی‌نام", base_url: "https://api.example.com", auth: "header" }, 400);
    await o.owner.post(`${k.P}/r/flow_connection`, { name: "میزبان بد", base_url: "https://api.example.com", hosts: ["exa mple.com"] }, 400);
    const off = await conn({ active: false });
    const d = await run(line(N("h", "call_http", { connection: off })));
    expect(d.run.error).toMatch(/غیرفعال/);
  });

  it("calls nothing outside for a run started on a demo record, even by a real person outside the demo scope", async () => {
    aiNet.lookup = async () => ["93.184.216.34"];
    const c = await conn({});
    const todo = (await o.owner.post(`${k.P}/r/todo`, { short_description: "کار نمایشی" })).row.id as string;
    await o.db.query(`insert into sm_demo_rows (org_id, row_id, tbl) values ($1, $2, 'sm_todos') on conflict do nothing`, [o.org, todo]);
    const start = (id: string) =>
      o.db.tx((tx) =>
        startRun(tx, {
          orgId: o.org,
          flow: { id: flowId, name: "HTTP" },
          version: { id: null, no: null },
          graph: line(N("h", "call_http", { connection: c, method: "POST", path: "/tickets", body: '{"t": "{{trigger.record.short_description}}"}' })) as never,
          trigger: { kind: "record", table: "todo", id, event: "updated", actor: o.ownerId, at: new Date().toISOString(), changed: [], changes: {} } as never,
          actorId: o.ownerId,
          runAs: { kind: "user", userId: o.ownerId },
          depth: 0,
          test: false,
        }),
      );
    const id = await start(todo);
    await executeRun(cfg, id, { deadline: Date.now() + 15_000 });
    expect(calls).toEqual([]);
    expect((await k.detail(id)).run.error).toMatch(/نمایشی/);
    // control: the same flow on a real record calls out
    const real = (await o.owner.post(`${k.P}/r/todo`, { short_description: "کار واقعی" })).row.id as string;
    const rid = await start(real);
    await executeRun(cfg, rid, { deadline: Date.now() + 15_000 });
    expect(calls.length).toBe(1);
  });
});

