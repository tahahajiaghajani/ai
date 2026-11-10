// Regressions of the AI review: agent drafts reach only those they are routed to and those who work the record; the
// first turn goes out under the data policy; only those who work a record start an agent on it (with a cap of their
// own); guardrails hold for history, aggregates and module tools; fields kept from prompts are never grouped; a stop
// is final; skipped runs use no budget; the virtual agent's switch and its confirmation cards hold; record-less drafts
// can be decided; agents start no agents; a scheduled round reaches every changed record once.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { world, type World } from "./incident-helpers";
import type { AgentRunView } from "@shared/ai/agents";
import type { AiActionView } from "@shared/ai/api";
import type { VaReply } from "@shared/ai/va";
import { FAKE_INBOX, clearFakeInbox } from "@server/modules/ai/adapters/fake";
import { advanceRun, ensureAgentSchedule, startAgent, stopRun } from "@server/modules/ai/agents";
import { principalCtx } from "@server/modules/ai/skills";
import { toolCatalog } from "@server/modules/ai/tools";

const before = process.env.ITSM_AI_FAKE;
afterAll(() => {
  if (before === undefined) delete process.env.ITSM_AI_FAKE;
  else process.env.ITSM_AI_FAKE = before;
});

describe("AI review fixes", () => {
  let w: World;
  let inc: string;

  async function agent(key: string, patch: Record<string, unknown>, opts: { roles?: string[] } = {}): Promise<string> {
    await w.o.get(`${w.P}/ai/agents/admin`);
    await w.o.post(`${w.P}/ai/agents/admin`, { key, name: `عامل ${key}`, from: "incident_triage" });
    const { agent: a } = await w.o.post(`${w.P}/ai/agents/admin/${key}/principal`, { roles: opts.roles ?? ["agent"] });
    const pid = a.principal.user_id as string;
    await w.o.post(`${w.P}/access/groups/${w.g.desk}/members`, { user_ids: [pid] });
    await w.o.patch(`${w.P}/ai/agents/admin/${key}`, { enabled: true, triggers: ["manual"], events: [], condition: null, ...patch });
    return pid;
  }

  async function run(key: string, id = inc): Promise<AgentRunView> {
    const r = await w.o.post(`${w.P}/ai/agents/${key}/start`, { table: "incident", id });
    expect(r.run_id).toBeTruthy();
    await w.drain();
    return (await w.o.get(`${w.P}/ai/agents/runs/${r.run_id}`)).run as AgentRunView;
  }

  const runsOf = async (key: string) => (await w.o.get(`${w.P}/ai/agents/runs?agent=${key}&limit=200`)).runs as AgentRunView[];

  beforeAll(async () => {
    process.env.ITSM_AI_FAKE = "1";
    w = await world();
    await w.o.post(`${w.P}/ai/connections`, { preset: "fake" });
    await w.o.post(`${w.P}/request/seed`, {});
    inc = String((await w.incident({ short_description: "چاپگر طبقهٔ دوم کار نمی‌کند", description: "شمارهٔ من 09121234567 است", caller_id: w.p.req.userId, assignment_group_id: w.g.desk, impact: "3" })).id);
    await w.drain();
  }, 180_000);

  it("an agent's draft is never shown to the requester, only to those who work the record (ai-proposal-preview-leak)", async () => {
    await agent("t_leak", { goal: `[tool:draft_journal_entry {"table":"incident","id":"${inc}","kind":"comment","body":"DRAFT-FROM-INTERNAL-NOTES"}]`, tools: ["draft_journal_entry"] });
    const r = await run("t_leak");
    expect(r.proposals.length).toBe(1);
    const id = r.proposals[0];
    const reqActions = (await w.p.req.client.get(`${w.P}/ai/actions?agents=1&limit=50`)).actions as AiActionView[];
    expect(reqActions.some((a) => a.id === id)).toBe(false);
    const reqPanel = await w.p.req.client.get(`${w.P}/ai/skills/for/incident/${inc}`).catch(() => ({}));
    expect(JSON.stringify(reqPanel)).not.toContain("DRAFT-FROM-INTERNAL-NOTES");
    // the desk agent works the incident: sees it
    const deskActions = (await w.p.agent.client.get(`${w.P}/ai/actions?agents=1&limit=50`)).actions as AiActionView[];
    expect(deskActions.some((a) => a.id === id)).toBe(true);
    // another requester never sees record-less agent drafts either
    await agent("t_rl_seen", { goal: `[tool:draft_create_incident {"values":{"short_description":"رخداد پیشنهادی عامل"}}]`, tools: ["draft_create_incident"] });
    const rl = await run("t_rl_seen");
    expect(rl.proposals.length).toBe(1);
    const other = (await w.p.req2.client.get(`${w.P}/ai/actions?agents=1&limit=50`)).actions as AiActionView[];
    expect(other.some((a) => a.id === rl.proposals[0])).toBe(false);
  });

  it("the record of the first turn goes out under the data policy (ai-agent-first-turn-unmasked)", async () => {
    await agent("t_mask", { goal: "رخداد را بخوان و گزارش بده.", tools: ["get_incident"] });
    clearFakeInbox();
    await run("t_mask");
    const first = FAKE_INBOX[0];
    expect(first.text).toContain('<data name="record">');
    expect(first.text).not.toContain("09121234567");
    expect(first.text).toContain("***4567");
  });

  it("only those who work a record start an agent on it, with a cap of their own (ai-agent-start-by-any-member)", async () => {
    await w.p.req.client.post(`${w.P}/ai/agents/t_mask/start`, { table: "incident", id: inc }, 403);
    const listed = (await w.p.req.client.get(`${w.P}/ai/agents/for?table=incident`).catch(() => ({ agents: [] }))).agents as { key: string }[] | undefined;
    expect((listed ?? []).some((a) => a.key === "t_mask")).toBe(false);
    const ok = await w.p.agent.client.post(`${w.P}/ai/agents/t_mask/start`, { table: "incident", id: inc });
    expect(ok.status).toBe("queued");
    await w.drain();
  });

  it("guardrails hold for history, aggregates and module tools (ai-agent-guardrails-partial)", async () => {
    const row = (await w.o.get(`${w.P}/r/incident/${inc}`)).row;
    await w.o.patch(`${w.P}/r/incident/${inc}`, { impact: "2", version: row.version });
    await agent("t_guard", { goal: `[tool:history_incident {"id":"${inc}"}] [tool:aggregate_incident {"group_by":[{"field":"impact"}]}]`, tools: ["history_incident", "aggregate_incident"], forbidden_fields: ["impact"] });
    clearFakeInbox();
    const r = await run("t_guard");
    const seen = FAKE_INBOX.map((t) => t.text).join("\n");
    expect(seen).not.toMatch(/"field":"اثر"/);
    expect(r.steps.some((s) => s.tool === "aggregate_incident" && !s.ok)).toBe(true);
    // a module tool that writes a forbidden table is refused (an order writes requests)
    await agent("t_order", { goal: `[tool:draft_order_catalog_item {"item":"لپ‌تاپ"}]`, tools: ["draft_order_catalog_item"], forbidden_tables: ["request_item"] });
    const o = await run("t_order");
    expect(o.proposals.length).toBe(0);
    expect(o.steps.some((s) => s.tool === "draft_order_catalog_item" && !s.ok)).toBe(true);
  });

  it("fields kept from prompts are never grouped or measured (ai-tools-aggregate-kept-fields)", async () => {
    const ctx = await w.e.ctxOf(w.e.ownerId);
    const gen = (await toolCatalog(ctx, { proposals: false })).generated.find((e) => e.name === "aggregate_request_answer");
    expect(gen).toBeTruthy();
    const tool = gen!.build();
    const rt = { today: "2026-11-09", dataPolicy: "masked" as const, putData: async () => "" };
    await expect(tool.run(ctx, { group_by: [{ field: "value_text" }] } as never, rt)).rejects.toThrow();
    await expect(tool.run(ctx, { metrics: [{ fn: "max", field: "value_num" }] } as never, rt)).rejects.toThrow();
  });

  it("a stop during a step is final (ai-agent-stop-overwritten)", async () => {
    await agent("t_stop", { goal: `[slow] [loop:4 get_incident {"id":"${inc}"}]`, tools: ["get_incident"] });
    const q = await w.o.post(`${w.P}/ai/agents/t_stop/start`, { table: "incident", id: inc });
    const going = advanceRun(w.e.cfg as never, w.e.org, q.run_id, { deadline: Date.now() + 60_000 });
    await new Promise((res) => setTimeout(res, 150));
    expect(await stopRun(w.e.cfg as never, w.e.org, q.run_id)).toBe(true);
    await going;
    const r = (await w.o.get(`${w.P}/ai/agents/runs/${q.run_id}`)).run as AgentRunView;
    expect(r.status).toBe("stopped");
    expect(r.step_count).toBeLessThanOrEqual(1);
    await w.drain();
  });

  it("runs skipped by their condition use no daily runs (ai-agent-skipped-runs-budget)", async () => {
    await agent("t_skip", { triggers: ["event"], events: ["created"], tables: ["incident"], condition: { f: "impact", op: "eq", v: "1" }, daily_runs: 2, goal: "گزارش بده.", tools: ["get_incident"] });
    for (const n of [1, 2]) await w.incident({ short_description: `رخداد عادی ${n}`, assignment_group_id: w.g.desk, impact: "3" });
    await w.drain();
    const urgent = String((await w.incident({ short_description: "رخداد فوری", assignment_group_id: w.g.desk, impact: "1" })).id);
    await w.drain();
    const runs = await runsOf("t_skip");
    expect(runs.filter((x) => x.status === "skipped").length).toBe(2);
    expect(runs.some((x) => (x as unknown as { record_id?: string }).record_id === urgent && x.status !== "skipped")).toBe(true);
  });

  it("with «دستیار مجازی» off no model writes an answer to a requester (ai-va-switch-not-honoured)", async () => {
    await w.o.put(`${w.P}/ai/settings`, { features: { virtual_agent: false } });
    try {
      clearFakeInbox();
      const r = (await w.p.req.client.post(`${w.P}/ai/va/conversations`, { channel: "test", text: "چطور چاپگر طبقهٔ دوم را درست کنم؟" })).reply as VaReply;
      expect(r.topic).toBe("knowledge");
      expect(r.model ?? null).toBeNull();
      expect(FAKE_INBOX.length).toBe(0);
    } finally {
      await w.o.put(`${w.P}/ai/settings`, { features: { virtual_agent: true } });
    }
  });

  it("a confirmation card is answered right away or not at all (ai-va-stale-confirmation)", async () => {
    const send = async (conv: string, input: unknown) => (await w.p.req.client.post(`${w.P}/ai/va/conversations/${conv}/messages`, input)).reply as VaReply;
    const card = <K extends string>(r: VaReply, kind: K) => r.cards.find((c) => c.kind === kind) as Extract<VaReply["cards"][number], { kind: K }> | undefined;
    const ritms = async () => (await w.p.req.client.get(`${w.P}/r/request_item?size=200`)).rows.length as number;
    const r = (await w.p.req.client.post(`${w.P}/ai/va/conversations`, { channel: "test", text: "یک لپ‌تاپ جدید می‌خواهم" })).reply as VaReply;
    let q = card(r, "question");
    let reply = r;
    for (let i = 0; i < 6 && q; i++) {
      reply = await send(r.conversation_id, q.options?.length ? { action: "choose", value: q.options[0].value } : { text: "برای کارمند تازه‌وارد واحد مالی" });
      q = card(reply, "question");
    }
    expect(card(reply, "confirm")?.what).toBe("order");
    const before = await ritms();
    await send(r.conversation_id, { text: "چطور وی‌پی‌ان را راه بیندازم؟" });
    const late = await send(r.conversation_id, { text: "اوکی" });
    expect(card(late, "created")).toBeUndefined();
    expect(await ritms()).toBe(before);
  });

  it("an approver decides an agent's draft that creates a record (ai-agent-approve-recordless-stuck)", async () => {
    await agent("t_rl", { autonomy: "approve", approvers: [w.p.agent.userId], goal: `[tool:draft_create_incident {"values":{"short_description":"رخداد پیشنهادی برای تأییدکننده"}}]`, tools: ["draft_create_incident"] });
    const r = await run("t_rl");
    expect(r.proposals.length).toBe(1);
    const inbox = (await w.p.agent.client.get(`${w.P}/ai/actions?inbox=1&limit=50`)).actions as AiActionView[];
    const mine = inbox.find((a) => a.id === r.proposals[0]);
    expect(mine?.can_decide).toBe(true);
    const done = (await w.p.agent.client.post(`${w.P}/ai/actions/${r.proposals[0]}/confirm`, {})).proposal;
    expect(done.status).toBe("executed");
  });

  it("agents start no agents (ai-agent-start-agent-tool)", async () => {
    // the target may be started from conversations: only the caller being an agent stops it
    await w.o.patch(`${w.P}/ai/agents/admin/t_mask`, { triggers: ["manual", "conversation"] });
    await agent("t_meta", { goal: `[tool:start_agent {"agent":"t_mask","table":"incident","id":"${inc}"}]`, tools: ["*"] });
    const before = (await runsOf("t_mask")).length;
    const r = await run("t_meta");
    expect(r.steps.some((s) => s.tool === "start_agent" && s.ok)).toBe(false);
    await w.drain();
    expect((await runsOf("t_mask")).length).toBe(before);
    const pctx = await principalCtx(w.e.cfg as never, w.e.org, "t_meta");
    await expect(startAgent(pctx!, "t_mask", { table: "incident", id: inc, how: "conversation" })).rejects.toThrow();
  });

  it("a scheduled round reaches every changed record of its filter once (ai-agent-schedule-first-ten)", async () => {
    for (let n = 1; n <= 13; n++) await w.incident({ short_description: `بررسی دسته‌ای ${n}`, assignment_group_id: w.g.desk });
    await w.drain();
    await agent("t_sched", { triggers: ["schedule"], schedule_minutes: 60, schedule_filter: { f: "short_description", op: "contains", v: "دسته‌ای" }, tables: ["incident"], daily_runs: 50, goal: "گزارش بده.", tools: ["get_incident"] });
    const round = async () => {
      await w.e.db.query(`update sm_ai_agents set last_scheduled_at = null where org_id = $1 and key = 't_sched'`, [w.e.org]);
      await ensureAgentSchedule(w.e.cfg as never, w.e.org);
      await w.e.db.query(`update sm_jobs set run_at = now() where org_id = $1 and kind = 'ai.agents.schedule' and status = 'queued'`, [w.e.org]);
      await w.drain();
    };
    await round();
    expect((await runsOf("t_sched")).filter((r) => r.trigger === "schedule").length).toBe(13);
    // nothing changed: the next round queues nothing new
    await round();
    expect((await runsOf("t_sched")).filter((r) => r.trigger === "schedule").length).toBe(13);
  });
});
