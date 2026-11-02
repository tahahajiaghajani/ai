// The assistant end to end with the scripted fake model (SIRAF_AI_FAKE=1): SSE events and their
// order, persistence, continue and stop, permissions (viewer: read tools only), proposals
// (confirm/reject/idempotency/expiry, audit), connections CRUD (keys never returned) and the
// platform overview.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { Client, makeServer, signupWithOrg } from "./helpers";
import { ALL_TOOLS } from "@server/modules/ai/tools";
import { defineTool, type AiToolDef } from "@server/modules/ai/tools/registry";
import { EXECUTORS } from "@server/modules/ai/tools/proposals";
import { AGENT_LIMITS } from "@server/modules/ai/agent";
import { history } from "@server/modules/ai/threads";
import { makeCtx, type AuthUser, type MemberRow, type OrgRow, type ServerConfig } from "@server/context";
import { quietLog } from "./helpers";
import { redactRelay, registerCloudLink } from "@server/modules/ai/relay";
import { uuidv7 } from "@shared/id";
import type { AiStreamEvent } from "@shared/ai/types";

const before = { fake: process.env.SIRAF_AI_FAKE, budget: AGENT_LIMITS.budgetMs, hard: AGENT_LIMITS.hardMs };

const echo = defineTool({
  name: "test_echo",
  title_fa: "ابزار آزمایشی",
  description: "Echo a number (test only).",
  input: z.object({ n: z.number().int(), mobile: z.string().optional() }),
  kind: "read",
  area: "reports",
  level: "view",
  async run(_ctx, input, rt) {
    const ref = await rt.putData([{ month: "مهر", value: String(input.n * 100) }], { title: "آزمایش" });
    return {
      data: { total: String(input.n * 100), unit: "rial", mobile: input.mobile ?? null },
      summary_fa: "جمع آزمایشی خوانده شد",
      refs: [{ type: "report", id: "test", label: "گزارش آزمایشی" }],
      data_ref: ref,
      chart: { kind: "bar", x: "month", series: [{ field: "value", label: "مبلغ" }], unit: "ریال" },
    };
  },
});

const propose = defineTool({
  name: "propose_test",
  title_fa: "پیش‌نویس آزمایشی",
  description: "Prepare a test draft (test only).",
  input: z.object({ amount: z.string() }),
  kind: "propose",
  area: "sales",
  level: "edit",
  async run(_ctx, input) {
    return {
      data: { amount: input.amount },
      summary_fa: "پیش‌نویس آماده شد",
      proposal: {
        kind: "test_doc",
        title_fa: "سند آزمایشی",
        summary_fa: `مبلغ ${input.amount}`,
        payload: { amount: input.amount },
        preview: [{ label: "مبلغ", value: input.amount }],
        area: "sales",
        level: "edit",
      },
    };
  },
});

let executed = 0;

beforeAll(() => {
  process.env.SIRAF_AI_FAKE = "1";
  ALL_TOOLS.push(echo as unknown as AiToolDef, propose as unknown as AiToolDef);
  EXECUTORS.test_doc = async (ctx, payload) => {
    ctx.need("sales", "edit");
    executed++;
    return { type: "invoice", id: uuidv7(), label: `سند ${(payload as { amount: string }).amount}` };
  };
});

afterAll(() => {
  if (before.fake === undefined) delete process.env.SIRAF_AI_FAKE;
  else process.env.SIRAF_AI_FAKE = before.fake;
  AGENT_LIMITS.budgetMs = before.budget;
  AGENT_LIMITS.hardMs = before.hard;
  for (const t of [echo, propose]) ALL_TOOLS.splice(ALL_TOOLS.indexOf(t as unknown as AiToolDef), 1);
  delete EXECUTORS.test_doc;
});

type App = Awaited<ReturnType<typeof makeServer>>["app"];

function parseSse(text: string): AiStreamEvent[] {
  return text
    .split("\n\n")
    .map((frame) => frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n"))
    .filter(Boolean)
    .map((d) => JSON.parse(d) as AiStreamEvent);
}

async function stream(app: App, c: Client, path: string, body: unknown, onEvent?: (e: AiStreamEvent) => void): Promise<{ status: number; events: AiStreamEvent[] }> {
  const res = await app.fetch(new Request(`http://local.test/api${path}`, { method: "POST", headers: { "content-type": "application/json", cookie: c.cookie }, body: JSON.stringify(body) }));
  if (!res.body || !res.headers.get("content-type")?.includes("text/event-stream")) return { status: res.status, events: [] };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const events: AiStreamEvent[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, i + 2);
      buf = buf.slice(i + 2);
      for (const e of parseSse(frame)) {
        events.push(e);
        onEvent?.(e);
      }
    }
  }
  return { status: res.status, events };
}

async function member(owner: Client, app: App, orgId: string, email: string, role: string) {
  await owner.post(`/o/${orgId}/members`, { email, full_name: `عضو ${role}`, role, password: "member-pass-1" });
  const c = new Client(app);
  await c.post("/auth/login", { email, password: "member-pass-1" });
  return c;
}

async function setup(ip?: string) {
  const { app, db } = await makeServer({ config: { secretSource: "env" } });
  // a sign-up from another address (sign-ups are limited per address and hour)
  const owner = new Client(ip ? { fetch: (r: Request) => (r.headers.set("x-forwarded-for", ip), app.fetch(r)) } : app);
  const orgId = await signupWithOrg(owner, ["goods"]);
  const { connection } = await owner.post(`/o/${orgId}/ai/connections`, { preset: "fake" });
  return { app, db, owner, orgId, connection };
}

describe("assistant chat over SSE (fake model)", () => {
  it("streams events in order, runs a tool, persists the conversation and masks tool data", async () => {
    const { app, db, owner, orgId } = await setup();
    const status = await owner.get(`/o/${orgId}/ai/status`);
    expect(status).toMatchObject({ ok: true, configured: true, can_use: true, can_manage: true, model: "fake-smart" });

    const { events } = await stream(app, owner, `/o/${orgId}/ai/chat`, { text: 'جمع آزمایشی؟ [tool:test_echo {"n":12,"mobile":"09121234567"}]', context: { path: "reports", title: "گزارش‌ها" } });
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("meta");
    expect(types.indexOf("tool_start")).toBeLessThan(types.indexOf("chart"));
    expect(types.indexOf("chart")).toBeLessThan(types.indexOf("tool_end"));
    expect(types.slice(-2)).toEqual(["usage", "done"]);
    const meta = events[0] as Extract<AiStreamEvent, { type: "meta" }>;
    const done = events[events.length - 1] as Extract<AiStreamEvent, { type: "done" }>;
    expect(done).toEqual({ type: "done", message_id: meta.message_id, stop: "end" });
    const end = events.find((e) => e.type === "tool_end") as Extract<AiStreamEvent, { type: "tool_end" }>;
    expect(end).toMatchObject({ ok: true, summary_fa: "جمع آزمایشی خوانده شد", refs: [{ type: "report", id: "test" }] });
    const text = events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("");
    expect(text).toContain("total: 1200");

    // what reached the model: the mobile number was masked (data policy "masked")
    const step = await db.one<{ parts: { results: { content: string }[] } }>(`select parts from tz_ai_messages where role = 'assistant' and parts->>'final' = 'false'`);
    expect(step!.parts.results[0].content).not.toContain("09121234567");

    const { threads } = await owner.get(`/o/${orgId}/ai/threads`);
    expect(threads).toHaveLength(1);
    const { messages, running } = await owner.get(`/o/${orgId}/ai/threads/${meta.thread_id}/messages`);
    expect(running).toBe(false);
    expect(messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
    expect(messages[1]).toMatchObject({ id: meta.message_id, status: "done", tools: [{ tool: "test_echo", ok: true }], refs: [{ id: "test" }] });
    expect(messages[1].text).toContain("total: 1200");
    expect(messages[1].charts).toHaveLength(1);
    const data = await owner.get(`/o/${orgId}/ai/data/${end.data_ref}`);
    expect(data.rows).toEqual([{ month: "مهر", value: "1200" }]);
    await owner.post(`/o/${orgId}/ai/messages/${meta.message_id}/rating`, { rating: 1 });
    expect((await owner.get(`/o/${orgId}/ai/threads/${meta.thread_id}/messages`)).messages[1].rating).toBe(1);

    // a follow-up in the same thread sees the earlier turns
    const second = await stream(app, owner, `/o/${orgId}/ai/chat`, { thread_id: meta.thread_id, text: "و ماه بعد؟" });
    expect(second.events[second.events.length - 1]).toMatchObject({ type: "done", stop: "end" });
    expect((await owner.get(`/o/${orgId}/ai/threads/${meta.thread_id}/messages`)).messages).toHaveLength(4);
    const log = await owner.get(`/o/${orgId}/ai/tool-calls`);
    expect(log.calls[0]).toMatchObject({ tool: "test_echo", ok: true, title_fa: "ابزار آزمایشی" });
    expect(JSON.stringify(log.calls[0].input)).not.toContain("09121234567");
  });

  it("accepts files without a question and tool directives whose input holds arrays", async () => {
    const { app, owner, orgId } = await setup();
    const file = { name: "فاکتور.pdf", mime: "application/pdf", data: Buffer.from("%PDF-1.4 test").toString("base64") };
    const r = await stream(app, owner, `/o/${orgId}/ai/chat`, { text: "", attachments: [file] });
    expect(r.events[r.events.length - 1]).toMatchObject({ type: "done", stop: "end" });
    const meta = r.events[0] as Extract<AiStreamEvent, { type: "meta" }>;
    const { messages } = await owner.get(`/o/${orgId}/ai/threads/${meta.thread_id}/messages`);
    expect(messages[0]).toMatchObject({ role: "user", text: "", attachments: [{ name: "فاکتور.pdf" }] });
    expect((await owner.get(`/o/${orgId}/ai/threads`)).threads[0].title).toBe("فاکتور.pdf");
    // nothing at all is still refused before streaming
    await owner.post(`/o/${orgId}/ai/chat`, { text: "  " }, 400);
    const t = await stream(app, owner, `/o/${orgId}/ai/chat`, { text: '[tool:test_echo {"n":3,"list":[1,[2]],"o":{"a":"]"}}]' });
    expect(t.events.find((e) => e.type === "tool_end")).toMatchObject({ ok: true });
  });

  it("asks the client to continue when the request's step budget runs out, then finishes", async () => {
    const { app, owner, orgId } = await setup();
    AGENT_LIMITS.budgetMs = 0;
    try {
      const first = await stream(app, owner, `/o/${orgId}/ai/chat`, { text: '[loop:2 test_echo {"n":3}]' });
      const last = first.events[first.events.length - 1];
      expect(last.type).toBe("continue");
      const threadId = (first.events[0] as { thread_id: string }).thread_id;
      expect((await owner.get(`/o/${orgId}/ai/threads/${threadId}/messages`)).messages[1]).toMatchObject({ status: "pending", can_continue: true });
      const second = await stream(app, owner, `/o/${orgId}/ai/threads/${threadId}/continue`, {});
      expect(second.events[0]).toMatchObject({ type: "meta", message_id: (first.events[0] as { message_id: string }).message_id });
      expect(second.events[second.events.length - 1].type).toBe("continue");
      const third = await stream(app, owner, `/o/${orgId}/ai/threads/${threadId}/continue`, {});
      expect(third.events[third.events.length - 1]).toMatchObject({ type: "done", stop: "end" });
      const view = (await owner.get(`/o/${orgId}/ai/threads/${threadId}/messages`)).messages;
      expect(view).toHaveLength(2);
      expect(view[1].tools).toHaveLength(2);
      expect(view[1].status).toBe("done");
      // nothing left to continue
      const again = await stream(app, owner, `/o/${orgId}/ai/threads/${threadId}/continue`, {});
      expect(again.events).toEqual([{ type: "done", message_id: "", stop: "end" }]);
    } finally {
      AGENT_LIMITS.budgetMs = before.budget;
    }
  });

  it("stops a running answer", async () => {
    const { app, owner, orgId } = await setup();
    let threadId = "";
    let stopped = false;
    const run = stream(app, owner, `/o/${orgId}/ai/chat`, { text: `[slow] ${"این یک پاسخ طولانی است. ".repeat(20)}` }, (e) => {
      if (e.type === "meta") threadId = e.thread_id;
      if (e.type === "text" && !stopped) {
        stopped = true;
        void owner.post(`/o/${orgId}/ai/threads/${threadId}/stop`);
      }
    });
    const { events } = await run;
    expect(events[events.length - 1]).toMatchObject({ type: "done", stop: "stopped" });
    const view = (await owner.get(`/o/${orgId}/ai/threads/${threadId}/messages`)).messages;
    expect(view[1].status).toBe("stopped");
    expect(view[1].text.length).toBeGreaterThan(0);
    expect(view[1].text.length).toBeLessThan(400);
    // the thread is free again
    const next = await stream(app, owner, `/o/${orgId}/ai/chat`, { thread_id: threadId, text: "سلام" });
    expect(next.events[next.events.length - 1]).toMatchObject({ type: "done", stop: "end" });
  });

  it("reports provider errors as an error event and keeps conversations private", async () => {
    const { app, owner, orgId } = await setup();
    const { events } = await stream(app, owner, `/o/${orgId}/ai/chat`, { text: "[error:auth] سلام" });
    expect(events.find((e) => e.type === "error")).toMatchObject({ kind: "auth" });
    expect(events[events.length - 1]).toMatchObject({ type: "done", stop: "error" });
    const threadId = (events[0] as { thread_id: string }).thread_id;
    const view = (await owner.get(`/o/${orgId}/ai/threads/${threadId}/messages`)).messages;
    expect(view[1]).toMatchObject({ status: "error", error: { kind: "auth" } });

    const accountant = await member(owner, app, orgId, "acc@example.com", "accountant");
    await accountant.get(`/o/${orgId}/ai/threads/${threadId}`, 404);
    await accountant.get(`/o/${orgId}/ai/threads/${threadId}/messages`, 404);
    expect((await accountant.get(`/o/${orgId}/ai/threads`)).threads).toEqual([]);
    await owner.patch(`/o/${orgId}/ai/threads/${threadId}`, { title: "گفتگوی خطا", pinned: true });
    expect((await owner.get(`/o/${orgId}/ai/threads`)).threads[0]).toMatchObject({ title: "گفتگوی خطا", pinned: true });
    await owner.del(`/o/${orgId}/ai/threads/${threadId}`);
    expect((await owner.get(`/o/${orgId}/ai/threads`)).threads).toEqual([]);
  });
});

describe("answers cut short, switched off or replayed", () => {
  let S: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => {
    S = await setup("10.62.0.1");
  });

  it("ends an answer stopped during a tool round as stopped, not as pending", async () => {
    const { app, owner, orgId } = S;
    const wait = defineTool({
      name: "test_wait", title_fa: "ابزار کند", description: "Waits (test only).", input: z.object({}), kind: "read", area: "reports", level: "view",
      async run() {
        await new Promise((r) => setTimeout(r, 150));
        return { data: { ok: true }, summary_fa: "تمام شد" };
      },
    });
    ALL_TOOLS.push(wait as unknown as AiToolDef);
    try {
      let threadId = "";
      const { events } = await stream(app, owner, `/o/${orgId}/ai/chat`, { text: "[tool:test_wait {}]" }, (e) => {
        if (e.type === "meta") threadId = e.thread_id;
        if (e.type === "tool_start") void owner.post(`/o/${orgId}/ai/threads/${threadId}/stop`);
      });
      expect(events[events.length - 1]).toMatchObject({ type: "done", stop: "stopped" });
      const view = (await owner.get(`/o/${orgId}/ai/threads/${threadId}/messages`)).messages;
      expect(view[1]).toMatchObject({ status: "stopped", tools: [{ tool: "test_wait", ok: true }] });
      expect(view[1].can_continue).toBeFalsy();
      // and there is nothing to continue
      const again = await stream(app, owner, `/o/${orgId}/ai/threads/${threadId}/continue`, {});
      expect(again.events).toEqual([{ type: "done", message_id: "", stop: "end" }]);
    } finally {
      ALL_TOOLS.splice(ALL_TOOLS.indexOf(wait as unknown as AiToolDef), 1);
    }
  });

  it("cuts a step off before the web function's limit and stores what was said", async () => {
    const { app, owner, orgId } = S;
    AGENT_LIMITS.hardMs = 150;
    try {
      const { events } = await stream(app, owner, `/o/${orgId}/ai/chat`, { text: `[slow] ${"پاسخی که دیر تمام می‌شود. ".repeat(20)}` });
      expect(events.find((e) => e.type === "error")).toMatchObject({ kind: "timeout" });
      expect(events[events.length - 1]).toMatchObject({ type: "done", stop: "error" });
      const threadId = (events[0] as { thread_id: string }).thread_id;
      const view = (await owner.get(`/o/${orgId}/ai/threads/${threadId}/messages`)).messages;
      expect(view[1]).toMatchObject({ status: "error", error: { kind: "timeout" } });
      expect(view[1].text.length).toBeGreaterThan(0);
      // the lease is free: the next question runs at once
      AGENT_LIMITS.hardMs = before.hard;
      const next = await stream(app, owner, `/o/${orgId}/ai/chat`, { thread_id: threadId, text: "سلام" });
      expect(next.events[next.events.length - 1]).toMatchObject({ type: "done", stop: "end" });
    } finally {
      AGENT_LIMITS.hardMs = before.hard;
    }
  });

  it("bounds the tools by the step's deadline too, and continues in the next request", async () => {
    const { app, owner, orgId } = S;
    const slow = defineTool({
      name: "test_stuck", title_fa: "ابزار گیرکرده", description: "Takes too long (test only).", input: z.object({}), kind: "read", area: "reports", level: "view",
      async run() {
        await new Promise((r) => setTimeout(r, 3_000));
        return { data: { ok: true }, summary_fa: "تمام شد" };
      },
    });
    ALL_TOOLS.push(slow as unknown as AiToolDef);
    AGENT_LIMITS.hardMs = 400;
    AGENT_LIMITS.budgetMs = 300;
    try {
      const t0 = Date.now();
      const { events } = await stream(app, owner, `/o/${orgId}/ai/chat`, { text: "[tool:test_stuck {}]" });
      expect(Date.now() - t0).toBeLessThan(2_500);
      expect(events.find((e) => e.type === "tool_end")).toMatchObject({ ok: false, summary_fa: "زمان ابزار تمام شد" });
      expect(events[events.length - 1]).toMatchObject({ type: "continue" });
    } finally {
      AGENT_LIMITS.hardMs = before.hard;
      AGENT_LIMITS.budgetMs = before.budget;
      ALL_TOOLS.splice(ALL_TOOLS.indexOf(slow as unknown as AiToolDef), 1);
    }
  });

  it("replays the answer to a question with files without its native content, every time the same way", async () => {
    const { app, db, owner, orgId } = S;
    const file = { name: "رسید.png", mime: "image/png", data: Buffer.from("png bytes").toString("base64") };
    const r = await stream(app, owner, `/o/${orgId}/ai/chat`, { text: "این چیست؟", attachments: [file] });
    const threadId = (r.events[0] as { thread_id: string }).thread_id;
    const plain = await stream(app, owner, `/o/${orgId}/ai/chat`, { thread_id: threadId, text: "ممنون" });
    expect(plain.events[plain.events.length - 1]).toMatchObject({ type: "done", stop: "end" });
    // both answers carry native content (thinking blocks, signatures) as the provider returned it
    expect((await db.query(`select 1 from tz_ai_messages where thread_id = $1 and role = 'assistant' and native is not null`, [threadId])).length).toBe(2);
    const u = (await db.one<AuthUser>(`select id, email, full_name, mobile, is_platform_admin, disabled, prefs from tz_users limit 1`))!;
    const org = (await db.one<OrgRow>(`select * from tz_orgs where id = $1`, [orgId]))!;
    const m = (await db.one<MemberRow>(`select id, org_id, user_id, role, overrides, is_active from tz_org_members where org_id = $1`, [orgId]))!;
    const ctx = makeCtx({ mode: "cloud", db, secret: "s", allowSignup: true, platformAdmins: [], origin: "cloud", log: quietLog, fetch: globalThis.fetch.bind(globalThis) } as ServerConfig, u, org, m);
    const h = await history(ctx, threadId);
    expect(h.messages.map((x) => x.role)).toEqual(["user", "assistant", "user", "assistant"]);
    // the file itself is not kept: its question is replayed with a placeholder, so the answer the
    // model gave while seeing the file is replayed as plain text (no thinking bound to the file)
    expect(JSON.stringify(h.messages[0].parts)).toContain("[attachment: رسید.png");
    expect(h.messages[1].native).toBeNull();
    expect(h.messages[1].parts[0]).toMatchObject({ type: "text" });
    // later answers keep their native content
    expect(h.messages[3].native).not.toBeNull();
  });

  it("refuses to continue an answer once the assistant is switched off", async () => {
    const { app, owner, orgId } = S;
    AGENT_LIMITS.budgetMs = 0;
    try {
      const first = await stream(app, owner, `/o/${orgId}/ai/chat`, { text: '[loop:2 test_echo {"n":3}]' });
      expect(first.events[first.events.length - 1].type).toBe("continue");
      const threadId = (first.events[0] as { thread_id: string }).thread_id;
      await owner.put(`/o/${orgId}/ai/settings`, { features: { assistant: false } });
      const r = await stream(app, owner, `/o/${orgId}/ai/threads/${threadId}/continue`, {});
      expect(r.events).toEqual([{ type: "error", kind: "disabled", message_fa: expect.any(String) }, { type: "done", message_id: "", stop: "error" }]);
      expect((await owner.get(`/o/${orgId}/ai/threads/${threadId}/messages`)).messages[1].tools).toHaveLength(1);
    } finally {
      AGENT_LIMITS.budgetMs = before.budget;
    }
  });

});

describe("permissions and proposals", () => {
  it("gives a viewer read tools only and lets nobody without the document's level confirm", async () => {
    const { app, db, owner, orgId } = await setup();
    const viewer = await member(owner, app, orgId, "viewer@example.com", "viewer");
    const vs = await viewer.get(`/o/${orgId}/ai/status`);
    expect(vs).toMatchObject({ can_use: true, can_propose: false, can_manage: false });
    const v = await stream(app, viewer, `/o/${orgId}/ai/chat`, { text: '[tool:propose_test {"amount":"5000"}]' });
    expect(v.events.some((e) => e.type === "proposal" || e.type === "tool_start")).toBe(false);
    expect(v.events[v.events.length - 1]).toMatchObject({ type: "done", stop: "end" });
    await viewer.get(`/o/${orgId}/ai/connections`, 403);
    await viewer.get(`/o/${orgId}/ai/usage`, 403);
    await viewer.put(`/o/${orgId}/ai/settings`, { enabled: false }, 403);
    const vset = await viewer.get(`/o/${orgId}/ai/settings`);
    expect(vset.can_manage).toBe(false);
    expect(vset.settings.instructions).toBe("");

    // the owner's draft
    const o = await stream(app, owner, `/o/${orgId}/ai/chat`, { text: '[tool:propose_test {"amount":"5000"}]' });
    const p = (o.events.find((e) => e.type === "proposal") as Extract<AiStreamEvent, { type: "proposal" }>).proposal;
    expect(p).toMatchObject({ kind: "test_doc", title_fa: "سند آزمایشی", status: "proposed", preview: [{ label: "مبلغ", value: "5000" }] });
    const answer = o.events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("");
    expect(answer).toContain("تأیید نکنید چیزی ثبت نمی‌شود");
    expect(executed).toBe(0);

    await viewer.post(`/o/${orgId}/ai/actions/${p.id}/confirm`, {}, 404);
    const { actions } = await owner.get(`/o/${orgId}/ai/actions`);
    expect(actions[0]).toMatchObject({ id: p.id, can_decide: true, area: "sales", level: "edit" });
    expect((await viewer.get(`/o/${orgId}/ai/actions`)).actions).toEqual([]);

    const c1 = await owner.post(`/o/${orgId}/ai/actions/${p.id}/confirm`, {});
    expect(c1.proposal).toMatchObject({ status: "executed", result: { type: "invoice" } });
    const c2 = await owner.post(`/o/${orgId}/ai/actions/${p.id}/confirm`, {});
    expect(c2.proposal.result).toEqual(c1.proposal.result);
    expect(executed).toBe(1);
    const audit = await db.one<{ user_id: string; data: { source: string; proposal_id: string } }>(`select user_id, data from tz_audit where action = 'ai_action'`);
    expect(audit?.data).toMatchObject({ source: "ai", proposal_id: p.id });
    await owner.post(`/o/${orgId}/ai/actions/${p.id}/reject`, {}, 409);

    // reject and expiry
    const o2 = await stream(app, owner, `/o/${orgId}/ai/chat`, { text: '[tool:propose_test {"amount":"7"}]' });
    const p2 = (o2.events.find((e) => e.type === "proposal") as Extract<AiStreamEvent, { type: "proposal" }>).proposal;
    expect((await owner.post(`/o/${orgId}/ai/actions/${p2.id}/reject`, { reason: "نه" })).proposal.status).toBe("rejected");
    await owner.post(`/o/${orgId}/ai/actions/${p2.id}/confirm`, {}, 409);
    const o3 = await stream(app, owner, `/o/${orgId}/ai/chat`, { text: '[tool:propose_test {"amount":"8"}]' });
    const p3 = (o3.events.find((e) => e.type === "proposal") as Extract<AiStreamEvent, { type: "proposal" }>).proposal;
    await db.query(`update tz_ai_actions set expires_at = now() - interval '1 minute' where id = $1`, [p3.id]);
    await owner.post(`/o/${orgId}/ai/actions/${p3.id}/confirm`, {}, 409);
    expect(executed).toBe(1);
    const threadId = (o.events[0] as { thread_id: string }).thread_id;
    expect((await owner.get(`/o/${orgId}/ai/threads/${threadId}/messages`)).messages[1].proposals[0]).toMatchObject({ id: p.id, status: "executed" });
  });
});

describe("connections, settings and the platform overview", () => {
  it("never returns a key; accountants manage, viewers cannot; blank key keeps the old one", async () => {
    const { app, owner, orgId } = await setup();
    const key = "sk-live-VERY-SECRET-1234567890";
    const created = await owner.post(`/o/${orgId}/ai/connections`, { preset: "deepseek", key: ` ${key}‏ ` });
    expect(JSON.stringify(created)).not.toContain(key);
    expect(created.connection).toMatchObject({ has_key: true, key_hint: "…7890", key_unreadable: false, preset: "deepseek" });
    expect(created.connection.models.smart.length).toBeGreaterThan(0);
    const list = await owner.get(`/o/${orgId}/ai/connections`);
    expect(JSON.stringify(list)).not.toContain("VERY-SECRET");

    const accountant = await member(owner, app, orgId, "acc2@example.com", "accountant");
    const patched = await accountant.patch(`/o/${orgId}/ai/connections/${created.connection.id}`, { label: "دیپ‌سیک", key: "" });
    expect(patched.connection).toMatchObject({ label: "دیپ‌سیک", has_key: true, key_hint: "…7890" });
    const replaced = await accountant.put(`/o/${orgId}/ai/connections/${created.connection.id}/key`, { key: "sk-new-key-abcdefgh" });
    expect(replaced.connection.key_hint).toBe("…efgh");
    const viewer = await member(owner, app, orgId, "viewer2@example.com", "viewer");
    await viewer.post(`/o/${orgId}/ai/connections`, { preset: "deepseek", key }, 403);
    await viewer.del(`/o/${orgId}/ai/connections/${created.connection.id}`, 403);

    // web version: internal addresses and local-model presets are refused
    await owner.post(`/o/${orgId}/ai/connections`, { preset: "custom-openai", base_url: "http://127.0.0.1:11434/v1", key: "x-123456789" }, 400);
    await owner.post(`/o/${orgId}/ai/connections`, { preset: "ollama" }, 400);

    // routing must name this business's connections
    await owner.put(`/o/${orgId}/ai/settings`, { routing: { assistant: [{ connection_id: uuidv7(), model: "x" }] } }, 400);
    const s = await owner.put(`/o/${orgId}/ai/settings`, { routing: { assistant: [{ connection_id: created.connection.id, model: created.connection.models.smart[0] }] }, data_policy: "aggregates", instructions: "مبالغ به تومان" });
    expect(s.settings).toMatchObject({ data_policy: "aggregates", instructions: "مبالغ به تومان" });

    await owner.del(`/o/${orgId}/ai/connections/${created.connection.id}`);
    expect((await owner.get(`/o/${orgId}/ai/connections`)).connections.some((c: { id: string }) => c.id === created.connection.id)).toBe(false);

    // the platform admin (first account) sees metadata only
    const overview = await owner.get(`/admin/ai/overview`);
    expect(overview.businesses[0]).toMatchObject({ org_id: orgId, connections: 1, presets: ["fake"] });
    expect(JSON.stringify(overview)).not.toMatch(/sk-|VERY-SECRET|secret_enc|key_hint/);
    const policy = await owner.put(`/admin/ai/policy`, { disabled_orgs: [orgId] });
    expect(policy.policy.disabled_orgs).toEqual([orgId]);
    const st = await owner.get(`/o/${orgId}/ai/status`);
    expect(st).toMatchObject({ ok: false, kind: "disabled", enabled: false });
    await viewer.get(`/admin/ai/overview`, 403);
  });

  it("refuses to store keys on the web version without APP_SECRET", async () => {
    const prev = process.env.APP_SECRET;
    delete process.env.APP_SECRET;
    try {
      const { app } = await makeServer();
      const owner = new Client(app);
      const orgId = await signupWithOrg(owner, ["goods"]);
      const err = await owner.post(`/o/${orgId}/ai/connections`, { preset: "deepseek", key: "sk-1234567890abcdef" }, 400);
      expect(err.error.message).toContain("APP_SECRET");
      expect((await owner.get(`/o/${orgId}/ai/status`)).app_secret_missing).toBe(true);
    } finally {
      if (prev !== undefined) process.env.APP_SECRET = prev;
    }
  });
});

describe("relayed turns follow the web version's data policy", () => {
  it("hides names and identifiers the Windows app sent under its own, laxer policy", () => {
    const ctxBlock = `<context>\n${JSON.stringify({ business: "طلای نمونه", member: { name: "مریم احمدی", role: "owner" }, current_page: { path: "parties/1", title: "علی رضایی", record: { type: "party", id: "1", label: "علی رضایی" } } })}\n</context>`;
    const body = {
      job: "assistant" as const,
      feature: "assistant",
      request: {
        system: "S",
        maxTokens: 100,
        messages: [
          { role: "user" as const, parts: [{ type: "text" as const, text: `${ctxBlock}\nبدهی علی رضایی با موبایل 09121234567 چقدر است؟` }] },
          { role: "assistant" as const, parts: [{ type: "tool_call" as const, id: "c1", name: "find_records", input: { query: "علی" } }], native: { protocol: "anthropic" as const, model: "m", connection_id: "x", content: [] } },
          { role: "user" as const, parts: [{ type: "tool_result" as const, id: "c1", name: "find_records", content: JSON.stringify({ rows: [{ party_id: "p1", name: "علی رضایی", mobile: "09121234567", balance: "5000" }] }) }] },
          { role: "user" as const, parts: [{ type: "text" as const, text: `<data name="plan_facts">\n${JSON.stringify({ collections: [{ party: "شرکت الف", overdue: "10" }] })}\n</data>\nWrite.` }] },
        ],
      },
    };
    const agg = redactRelay(body, "aggregates");
    const sent = JSON.stringify(agg.request.messages);
    expect(sent).not.toContain("مریم احمدی");
    expect(sent).not.toContain("شرکت الف");
    expect(sent).not.toContain("09121234567");
    // the tool result: names hidden, numbers kept
    expect(agg.request.messages[2].parts[0]).toMatchObject({ type: "tool_result" });
    expect((agg.request.messages[2].parts[0] as { content: string }).content).not.toContain("علی رضایی");
    expect((agg.request.messages[2].parts[0] as { content: string }).content).toContain("5000");
    // the page title and record label of the context are gone; the person's own question keeps the name they typed
    expect((agg.request.messages[0].parts[0] as { text: string }).text).toContain("بدهی علی رضایی");
    expect(JSON.parse((agg.request.messages[0].parts[0] as { text: string }).text.split("\n")[1])).toMatchObject({ member: { role: "owner" }, current_page: { path: "parties/1", record: { id: "1" } } });
    expect(JSON.stringify(JSON.parse((agg.request.messages[0].parts[0] as { text: string }).text.split("\n")[1]))).not.toContain("علی رضایی");
    // "full" on the web version: sent as the Windows app wrote it
    expect(redactRelay(body, "full")).toBe(body);
    expect(JSON.stringify(redactRelay(body, "masked").request.messages)).not.toContain("09121234567");
  });
});

describe("Windows app → web version relay", () => {
  it("serves model turns to a linked device only, while tools run on the Windows app", async () => {
    const cloud = await setup();
    // a device session of the same account (what linking the Windows app creates)
    const device = new Client(cloud.app);
    const login = await device.post("/auth/login", { email: "owner@example.com", password: "s3cret-pass", device: { name: "ویندوز آزمایشی", platform: "windows" } });
    const relayBody = { job: "fast", feature: "digest", request: { system: "S", messages: [{ role: "user", parts: [{ type: "text", text: "سلام" }] }], maxTokens: 100 } };
    // a browser session may not use the relay
    const web = await cloud.app.fetch(new Request(`http://local.test/api/o/${cloud.orgId}/ai/relay`, { method: "POST", headers: { "content-type": "application/json", cookie: cloud.owner.cookie }, body: JSON.stringify(relayBody) }));
    expect(web.status).toBe(403);
    const res = await cloud.app.fetch(new Request(`http://local.test/api/o/${cloud.orgId}/ai/relay`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${login.token}` }, body: JSON.stringify(relayBody) }));
    const events = parseSse(await res.text()) as unknown as { type: string; result?: { result: { text: string } } }[];
    expect(events[events.length - 1].type).toBe("result");
    expect(events[events.length - 1].result!.result.text).toContain("سلام");

    // the Windows app: no local connection, «use the web version's connections» on
    const desk = await makeServer({
      mode: "desktop",
      config: {
        // requests for the desktop's business go to the linked cloud business
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => cloud.app.fetch(new Request(String(input).replace(/\/o\/[0-9a-f-]{36}\//, `/o/${cloud.orgId}/`), init))) as typeof fetch,
      },
    });
    const owner = new Client(desk.app);
    const deskOrg = await signupWithOrg(owner, ["goods"]);
    registerCloudLink(desk.db, () => ({ url: "http://local.test", token: login.token, org_id: deskOrg }));
    expect((await owner.get(`/o/${deskOrg}/ai/status`)).ok).toBe(false);
    await owner.put(`/o/${deskOrg}/ai/settings`, { use_cloud: true });
    expect(await owner.get(`/o/${deskOrg}/ai/status`)).toMatchObject({ ok: true, route: "via_cloud" });
    const { events: ev } = await stream(desk.app, owner, `/o/${deskOrg}/ai/chat`, { text: '[tool:test_echo {"n":4}]' });
    expect(ev.find((e) => e.type === "tool_end")).toMatchObject({ ok: true });
    expect(ev[ev.length - 1]).toMatchObject({ type: "done", stop: "end" });
    const local = await desk.db.query<{ route: string }>(`select route from tz_ai_usage`);
    expect(local.length).toBe(2);
    expect(local.every((u) => u.route === "via_cloud")).toBe(true);
    const remote = await cloud.db.query<{ feature: string }>(`select feature from tz_ai_usage where feature = 'assistant'`);
    expect(remote.length).toBe(2);
    // the tool ran on the Windows app's database, never on the web version
    expect(await desk.db.one(`select 1 as x from tz_ai_tool_calls`)).not.toBeNull();
    expect(await cloud.db.one(`select 1 as x from tz_ai_tool_calls`)).toBeNull();

    // the web version's switches bind relayed turns too
    const relay = (b: unknown) => cloud.app.fetch(new Request(`http://local.test/api/o/${cloud.orgId}/ai/relay`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${login.token}` }, body: JSON.stringify(b) }));
    const asAssistant = { ...relayBody, job: "assistant", feature: "assistant" };
    const withFile = { ...relayBody, job: "vision", feature: "capture", request: { ...relayBody.request, messages: [{ role: "user", parts: [{ type: "file", mime: "application/pdf", data: "JVBERi0=" }, { type: "text", text: "بخوان" }] }] } };
    expect((await relay({ ...relayBody, feature: "anything-else" })).status).toBe(400);
    await cloud.owner.put(`/o/${cloud.orgId}/ai/settings`, { features: { assistant: false, capture: false } });
    const off = await relay(asAssistant);
    expect(off.status).toBe(403);
    expect(((await off.json()) as { error: { code: string } }).error.code).toBe("ai_disabled");
    expect((await relay(withFile)).status).toBe(403);
    // a feature whose own switch is on still works
    expect(parseSse(await (await relay(relayBody)).text()).pop()).toMatchObject({ type: "result" });
    // a relayed turn ends before the web function's limit: what was streamed, then a timeout (not a "stopped" result)
    AGENT_LIMITS.hardMs = 150;
    try {
      const slowBody = { ...relayBody, request: { ...relayBody.request, messages: [{ role: "user", parts: [{ type: "text", text: `[slow] ${"پاسخی که دیر تمام می‌شود. ".repeat(20)}` }] }] } };
      const cut = parseSse(await (await relay(slowBody)).text()) as unknown as { type: string; kind?: string }[];
      expect(cut.some((e) => e.type === "text")).toBe(true);
      expect(cut.pop()).toMatchObject({ type: "error", kind: "timeout" });
    } finally {
      AGENT_LIMITS.hardMs = before.hard;
    }
    // and the Windows app shows the switch as an error, not an answer
    const { events: offEv } = await stream(desk.app, owner, `/o/${deskOrg}/ai/chat`, { text: "سلام" });
    expect(offEv.find((e) => e.type === "error")).toMatchObject({ kind: "disabled" });
  });
});
