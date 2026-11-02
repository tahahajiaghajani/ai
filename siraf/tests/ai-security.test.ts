// AI security fixes: proposals survive the jsonb round trip and their idempotency key is per step,
// stored keys never go to another host, the platform switch blocks connection tests, AI access
// withdrawn closes conversations/data/proposals, the SSRF guard (DNS and redirects), the data
// policy in feature prompts and the page context, and the retention of captured documents.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { Client, quietLog, signupWithOrg } from "./helpers";
import { createPgliteDb } from "@server/db/pglite";
import { migrate } from "@server/db/migrate";
import { createApp } from "@server/app";
import { ALL_TOOLS } from "@server/modules/ai/tools";
import { defineTool, type AiToolDef } from "@server/modules/ai/tools/registry";
import { EXECUTORS } from "@server/modules/ai/tools/proposals";
import { hashPayload, storeProposal } from "@server/modules/ai/actions";
import { createThread, purgeOld } from "@server/modules/ai/threads";
import { aiNet, guardedFetch, internalAddress } from "@server/modules/ai/net";
import { hideNames, redactDataBlocks, redactPage, redactValue } from "@server/modules/ai/redact";
import { dataBlock } from "@server/modules/ai/features/narrative";
import { contextBlock } from "@server/modules/ai/prompts";
import { makeCtx, type AuthUser, type Ctx, type MemberRow, type OrgRow, type ServerConfig } from "@server/context";
import { uuidv7 } from "@shared/id";
import type { AiStreamEvent } from "@shared/ai/types";
import { ProviderError } from "@server/modules/ai/types";

const before = { fake: process.env.SIRAF_AI_FAKE, lookup: aiNet.lookup };

const proposeMulti = defineTool({
  name: "propose_multi",
  title_fa: "پیش‌نویس چندبخشی",
  description: "Prepare a draft whose payload has several keys (test only).",
  input: z.object({ party_id: z.string() }),
  kind: "propose",
  area: "sales",
  level: "edit",
  async run(_ctx, input) {
    // insertion order differs from jsonb's key order (by length, then bytes)
    const payload = { kind: "sale", party_id: input.party_id, lines: [{ item_id: "i-1", qty: "2", unit_price: "1500" }], date: "2026-11-02" };
    return {
      data: { party_id: input.party_id },
      summary_fa: "پیش‌نویس آماده شد",
      proposal: { kind: "test_multi", title_fa: "فاکتور آزمایشی", summary_fa: "فاکتور", payload, preview: [{ label: "شخص", value: input.party_id }], area: "sales", level: "edit" },
    };
  },
});

const echo = defineTool({
  name: "sec_echo",
  title_fa: "ابزار آزمایشی",
  description: "Store a row (test only).",
  input: z.object({ n: z.number().int() }),
  kind: "read",
  area: "reports",
  level: "view",
  async run(_ctx, input, rt) {
    const ref = await rt.putData([{ value: String(input.n) }], { title: "آزمایش" });
    return { data: { n: input.n }, summary_fa: "خوانده شد", data_ref: ref, table: { columns: [{ key: "value", title: "مقدار" }], total_rows: 1 } };
  },
});

let multiPayload: unknown = null;

beforeAll(() => {
  process.env.SIRAF_AI_FAKE = "1";
  ALL_TOOLS.push(proposeMulti as unknown as AiToolDef, echo as unknown as AiToolDef);
  EXECUTORS.test_multi = async (_ctx, payload) => {
    multiPayload = payload;
    return { type: "invoice", id: uuidv7(), label: "فاکتور آزمایشی" };
  };
});

afterAll(() => {
  if (before.fake === undefined) delete process.env.SIRAF_AI_FAKE;
  else process.env.SIRAF_AI_FAKE = before.fake;
  aiNet.lookup = before.lookup;
  for (const t of [proposeMulti, echo]) ALL_TOOLS.splice(ALL_TOOLS.indexOf(t as unknown as AiToolDef), 1);
  delete EXECUTORS.test_multi;
});

type App = ReturnType<typeof createApp>;

function parseSse(text: string): AiStreamEvent[] {
  return text
    .split("\n\n")
    .map((frame) => frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n"))
    .filter(Boolean)
    .map((d) => JSON.parse(d) as AiStreamEvent);
}

async function stream(app: App, c: Client, path: string, body: unknown): Promise<AiStreamEvent[]> {
  const res = await app.fetch(new Request(`http://local.test/api${path}`, { method: "POST", headers: { "content-type": "application/json", cookie: c.cookie }, body: JSON.stringify(body) }));
  return parseSse(await res.text());
}

async function member(owner: Client, app: App, orgId: string, email: string, role: string) {
  await owner.post(`/o/${orgId}/members`, { email, full_name: `عضو ${role}`, role, password: "member-pass-1" });
  const c = new Client(app);
  await c.post("/auth/login", { email, password: "member-pass-1" });
  return c;
}

let shared: Awaited<ReturnType<typeof setup>> | null = null;
async function setup() {
  const db = await createPgliteDb({});
  await migrate(db);
  const cfg: ServerConfig = { mode: "cloud", db, secret: "test-secret", secretSource: "env", allowSignup: true, platformAdmins: [], origin: "cloud", log: quietLog, fetch: globalThis.fetch.bind(globalThis) };
  const app = createApp(cfg);
  const owner = new Client(app);
  const orgId = await signupWithOrg(owner, ["goods"]);
  await owner.post(`/o/${orgId}/ai/connections`, { preset: "fake" });
  const ctx = async (): Promise<Ctx> => {
    const u = (await db.one<AuthUser>(`select id, email, full_name, mobile, is_platform_admin, disabled, prefs from tz_users where email = 'owner@example.com'`))!;
    const org = (await db.one<OrgRow>(`select * from tz_orgs where id = $1`, [orgId]))!;
    const m = (await db.one<MemberRow>(`select id, org_id, user_id, role, overrides, is_active from tz_org_members where org_id = $1 and user_id = $2`, [orgId, u.id]))!;
    return makeCtx(cfg, u, org, m);
  };
  return { app, db, owner, orgId, ctx };
}
async function server() {
  shared ??= await setup();
  return shared;
}

const proposalOf = (events: AiStreamEvent[]) => (events.find((e) => e.type === "proposal") as Extract<AiStreamEvent, { type: "proposal" }>).proposal;

describe("proposals", () => {
  it("confirms a multi-key proposal after the jsonb round trip, and still refuses a changed payload", async () => {
    const { app, db, owner, orgId } = await server();
    const p = proposalOf(await stream(app, owner, `/o/${orgId}/ai/chat`, { text: '[tool:propose_multi {"party_id":"p-77"}]' }));
    // the stored jsonb really has another key order than the object that was hashed
    const stored = await db.one<{ payload: Record<string, unknown> }>(`select payload from tz_ai_actions where id = $1`, [p.id]);
    expect(Object.keys(stored!.payload)).not.toEqual(["kind", "party_id", "lines", "date"]);
    const c = await owner.post(`/o/${orgId}/ai/actions/${p.id}/confirm`, {});
    expect(c.proposal).toMatchObject({ status: "executed", result: { type: "invoice" }, error: null });
    expect(multiPayload).toMatchObject({ kind: "sale", party_id: "p-77", date: "2026-11-02" });

    const p2 = proposalOf(await stream(app, owner, `/o/${orgId}/ai/chat`, { text: '[tool:propose_multi {"party_id":"p-78"}]' }));
    await db.query(`update tz_ai_actions set payload = jsonb_set(payload, '{party_id}', '"p-99"') where id = $1`, [p2.id]);
    await owner.post(`/o/${orgId}/ai/actions/${p2.id}/confirm`, {}, 409);
  });

  it("hashes the same payload the same way whatever its key order", () => {
    expect(hashPayload({ b: 1, a: [{ y: "2", x: null }] })).toBe(hashPayload({ a: [{ x: null, y: "2" }], b: 1 }));
    expect(hashPayload({ a: 1, u: undefined })).toBe(hashPayload({ a: 1 }));
    expect(hashPayload({ a: 1 })).not.toBe(hashPayload({ a: 2 }));
  });

  it("keeps a new draft apart from an older one with the same made-up tool-call id", async () => {
    const { ctx } = await server();
    const c = await ctx();
    const thread = await createThread(c, "آزمایش", null);
    const proposal = (amount: string) => ({ kind: "test_multi", title_fa: `فاکتور ${amount}`, summary_fa: "", payload: { amount }, preview: [], area: "sales" as const, level: "edit" as const });
    const first = await storeProposal(c, { threadId: thread.id, messageId: uuidv7(), callId: "call_0_propose_invoice", tool: "propose_multi", proposal: proposal("1") });
    const second = await storeProposal(c, { threadId: thread.id, messageId: uuidv7(), callId: "call_0_propose_invoice", tool: "propose_multi", proposal: proposal("2") });
    expect(second.id).not.toBe(first.id);
    expect(second.title_fa).toBe("فاکتور 2");
    // the same step retried keeps one row
    const msg = uuidv7();
    const a = await storeProposal(c, { threadId: thread.id, messageId: msg, callId: "x", tool: "propose_multi", proposal: proposal("3") });
    const b = await storeProposal(c, { threadId: thread.id, messageId: msg, callId: "x", tool: "propose_multi", proposal: proposal("3") });
    expect(b.id).toBe(a.id);
  });
});

describe("AI access withdrawn", () => {
  it("closes conversations, stored data and proposals to a member whose AI level is none", async () => {
    const { app, db, owner, orgId } = await server();
    const acc = await member(owner, app, orgId, "acc-none@example.com", "accountant");
    const events = await stream(app, acc, `/o/${orgId}/ai/chat`, { text: '[tool:sec_echo {"n":2}] [tool:propose_multi {"party_id":"p-1"}]' });
    const meta = events[0] as Extract<AiStreamEvent, { type: "meta" }>;
    const end = events.find((e) => e.type === "tool_end" && e.data_ref) as Extract<AiStreamEvent, { type: "tool_end" }>;
    const p = proposalOf(events);
    await acc.get(`/o/${orgId}/ai/threads/${meta.thread_id}/messages`);
    await acc.get(`/o/${orgId}/ai/data/${end.data_ref}`);
    await db.query(`update tz_org_members set overrides = '{"ai":"none"}'::jsonb where user_id = (select id from tz_users where email = 'acc-none@example.com')`);
    await acc.get(`/o/${orgId}/ai/threads/${meta.thread_id}`, 403);
    await acc.get(`/o/${orgId}/ai/threads/${meta.thread_id}/messages`, 403);
    await acc.patch(`/o/${orgId}/ai/threads/${meta.thread_id}`, { title: "x" }, 403);
    await acc.post(`/o/${orgId}/ai/threads/${meta.thread_id}/stop`, {}, 403);
    await acc.post(`/o/${orgId}/ai/messages/${meta.message_id}/rating`, { rating: 1 }, 403);
    await acc.get(`/o/${orgId}/ai/data/${end.data_ref}`, 403);
    await acc.post(`/o/${orgId}/ai/actions/${p.id}/confirm`, {}, 403);
    await acc.post(`/o/${orgId}/ai/actions/${p.id}/reject`, {}, 403);
    await acc.del(`/o/${orgId}/ai/threads/${meta.thread_id}`, 403);
    expect((await db.one<{ status: string }>(`select status from tz_ai_actions where id = $1`, [p.id]))!.status).toBe("proposed");
  });
});

describe("stored keys and connection tests", () => {
  it("never sends a stored key to another service or address, and tests nothing while the platform has AI off", async () => {
    const { app, owner, orgId } = await server();
    const created = await owner.post(`/o/${orgId}/ai/connections`, { preset: "deepseek", key: "sk-live-OWNER-KEY-1234567890" });
    const id = created.connection.id;
    const accountant = await member(owner, app, orgId, "acc-keys@example.com", "accountant");
    // «test» with the saved key but another service or address: refused before any request
    const t = await accountant.post(`/o/${orgId}/ai/test`, { connection_id: id, preset: "custom-openai", base_url: "https://attacker.example/v1", key: "" }, 400);
    expect(t.error.message).toContain("کلید API را دوباره وارد کنید");
    await accountant.post(`/o/${orgId}/ai/test`, { connection_id: id, preset: "deepseek", base_url: "https://attacker.example/v1", key: "" }, 400);
    // editing the address of a key-required service needs the key again
    await accountant.patch(`/o/${orgId}/ai/connections/${id}`, { base_url: "https://attacker.example/v1" }, 400);
    expect((await owner.get(`/o/${orgId}/ai/connections/${id}`)).connection).toMatchObject({ has_key: true, base_url: created.connection.base_url });
    // moving to a service without a required key drops the stored key
    const moved = await accountant.patch(`/o/${orgId}/ai/connections/${id}`, { preset: "custom-openai", base_url: "https://attacker.example/v1" });
    expect(moved.connection).toMatchObject({ has_key: false, key_hint: null, base_url: "https://attacker.example/v1" });
    // edits that keep the destination keep the key
    const again = await owner.post(`/o/${orgId}/ai/connections`, { preset: "deepseek", key: "sk-live-OTHER-KEY-1234567890" });
    const kept = await owner.patch(`/o/${orgId}/ai/connections/${again.connection.id}`, { label: "x", preset: "deepseek", base_url: again.connection.base_url });
    expect(kept.connection).toMatchObject({ has_key: true, key_hint: "…7890" });

    // the platform switched AI off for this business: tests and model lists make no calls
    await owner.put(`/admin/ai/policy`, { disabled_orgs: [orgId] });
    try {
      expect((await owner.post(`/o/${orgId}/ai/connections/${again.connection.id}/test`, {}, 403)).error.code).toBe("ai_disabled");
      await owner.post(`/o/${orgId}/ai/connections/${again.connection.id}/models`, {}, 403);
      await owner.post(`/o/${orgId}/ai/test`, { preset: "deepseek", key: "sk-test-1234567890" }, 403);
    } finally {
      await owner.put(`/admin/ai/policy`, { disabled_orgs: [] });
    }
  });
});

describe("AI key security events", () => {
  it("records each key added, replaced or removed, never the key itself", async () => {
    const { db, owner, orgId } = await server();
    const first = await owner.post(`/o/${orgId}/ai/connections`, { preset: "deepseek", key: "sk-live-EVENT-KEY-1234567890", label: "کلید رویداد" });
    const a = first.connection.id;
    await owner.patch(`/o/${orgId}/ai/connections/${a}`, { key: "sk-live-EVENT-KEY-0987654321" });
    await owner.patch(`/o/${orgId}/ai/connections/${a}`, { label: "فقط نام" }); // no key change: no event
    await owner.patch(`/o/${orgId}/ai/connections/${a}`, { preset: "custom-openai", base_url: "https://other.example/v1" }); // the key is dropped
    const second = await owner.post(`/o/${orgId}/ai/connections`, { preset: "deepseek", key: "sk-live-EVENT-KEY-5555555555" });
    const b = second.connection.id;
    await owner.del(`/o/${orgId}/ai/connections/${b}`);
    const rows = await db.query<{ user_id: string; data: Record<string, unknown> }>(
      `select user_id, data from tz_security_events where kind = 'ai_key' and org_id = $1 and data->>'connection_id' in ($2, $3) order by at, id`,
      [orgId, a, b],
    );
    expect(rows.map((r) => [r.data.connection_id === a ? "a" : "b", r.data.action, r.data.key_hint])).toEqual([
      ["a", "added", "…7890"],
      ["a", "replaced", "…4321"],
      ["a", "removed", "…4321"],
      ["b", "added", "…5555"],
      ["b", "removed", "…5555"],
    ]);
    expect(rows[2].data.reason).toBe("destination_changed");
    expect(rows.every((r) => !!r.user_id)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("EVENT-KEY");
  });
});

describe("web version SSRF guard", () => {
  const okFetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;

  it("refuses host names that resolve to internal addresses", async () => {
    aiNet.lookup = async (host) => (host === "evil.example" ? ["203.0.113.5", "10.0.0.7"] : host === "meta.example" ? ["169.254.169.254"] : host === "v6.example" ? ["::1"] : ["104.18.6.192"]);
    const f = guardedFetch(okFetch);
    await expect(f("https://evil.example/v1/models")).rejects.toBeInstanceOf(ProviderError);
    await expect(f("https://meta.example/v1/models")).rejects.toThrow(/داخلی/);
    await expect(f("https://v6.example/v1/models")).rejects.toThrow(/داخلی/);
    await expect(f("https://127.0.0.1/v1")).rejects.toThrow(/داخلی/);
    expect((await f("https://api.openai.com/v1/models")).status).toBe(200);
    aiNet.lookup = async () => {
      throw new Error("ENOTFOUND");
    };
    await expect(f("https://nowhere.example/v1")).rejects.toThrow(/پیدا نشد/);
    expect(internalAddress("192.168.1.2")).toBe(true);
    expect(internalAddress("fe80::1")).toBe(true);
    expect(internalAddress("8.8.8.8")).toBe(false);
  });

  it("never follows a redirect", async () => {
    aiNet.lookup = async () => ["104.18.6.192"];
    let init: RequestInit | undefined;
    const redirecting = (async (_u: RequestInfo | URL, i?: RequestInit) => {
      init = i;
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
    }) as typeof fetch;
    await expect(guardedFetch(redirecting)("https://public.example/v1/chat/completions", { method: "POST" })).rejects.toThrow(/ارجاع/);
    expect(init?.redirect).toBe("manual");
    expect(init?.method).toBe("POST");
  });
});

describe("data policy in feature prompts and the page context", () => {
  it("hides party names inside data blocks under aggregates and masks identifiers under masked", () => {
    const facts = { collections: [{ party: "علی رضایی", overdue: "5000000" }], rows: [{ party_id: "p1", name: "شرکت الف", balance: "10" }], note: "تماس 09121234567" };
    const prompt = `${dataBlock("plan_facts", facts)}\nWrite the plan.`;
    const agg = redactDataBlocks(prompt, "aggregates");
    expect(agg).not.toContain("علی رضایی");
    expect(agg).not.toContain("شرکت الف");
    expect(agg).not.toContain("09121234567");
    expect(agg).toContain("5000000");
    expect(agg).toContain("Write the plan.");
    const masked = redactDataBlocks(prompt, "masked");
    expect(masked).toContain("علی رضایی");
    expect(masked).not.toContain("09121234567");
    expect(redactDataBlocks(prompt, "full")).toBe(prompt);
    // rows of a detail/party list (kind person) and rows carrying a party id
    expect(JSON.stringify(redactValue({ rows: [{ code: "1001", name: "حسن", kind: "person" }] }, "aggregates"))).not.toContain("حسن");
    expect(hideNames("«علی رضایی» ۵ میلیون معوق", ["علی رضایی"])).toBe("«[نام پنهان]» ۵ میلیون معوق");
  });

  it("redacts the page the person is on", async () => {
    const page = { path: "parties/1", title: "علی رضایی", record: { type: "party", id: "1", label: "علی رضایی 09121234567" }, report: { key: "ledger", params: { party: "علی رضایی" } } };
    const agg = redactPage(page, "aggregates");
    expect(JSON.stringify(agg)).not.toContain("علی رضایی");
    const masked = redactPage(page, "masked");
    expect(masked.record?.label).toContain("علی رضایی");
    expect(masked.record?.label).not.toContain("09121234567");
    const { ctx } = await server();
    const block = await contextBlock(await ctx(), page, "aggregates");
    expect(block).not.toContain("علی رضایی");
    expect(block).not.toContain("09121234567");
    expect(block).toContain("parties/1");
  });
});

describe("captured documents", () => {
  it("are purged after the retention (never kept over 30 days)", async () => {
    const { db, ctx, orgId } = await server();
    const c = await ctx();
    const ins = (days: number) =>
      db.query(`insert into tz_ai_captures (id, org_id, user_id, kind, sha256, mime, result, model, created_at) values ($1, $2, $3, 'id_card', $4, 'image/png', '{}'::jsonb, 'm', now() - ($5::int * interval '1 day'))`, [uuidv7(), orgId, c.user.id, uuidv7(), days]);
    await ins(1);
    await ins(10);
    await ins(40);
    await purgeOld(c, 90);
    expect((await db.query(`select 1 from tz_ai_captures where org_id = $1`, [orgId])).length).toBe(2);
    await purgeOld(c, 7);
    expect((await db.query(`select 1 from tz_ai_captures where org_id = $1`, [orgId])).length).toBe(1);
  });
});
