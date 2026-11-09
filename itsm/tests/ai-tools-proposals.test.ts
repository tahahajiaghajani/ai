// Drafts of the generated record tools are proposals (docs/spec/AI.md §11.4, §11.8): nothing is written when the
// assistant drafts; a person applies a proposal with their OWN access (the record service checks everything again);
// a proposal fails closed when the applier's access changed or a field moved since the draft; a proposal about a record
// is visible only to people who read that record; a batch proposal shows its count and a sample and reports every row.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { backdate, world, type World } from "./incident-helpers";
import type { AiProposal } from "@shared/ai/types";

const before = process.env.ITSM_AI_FAKE;
afterAll(() => {
  if (before === undefined) delete process.env.ITSM_AI_FAKE;
  else process.env.ITSM_AI_FAKE = before;
});

type Ev = { type: string; proposal?: AiProposal; ok?: boolean; summary_fa?: string; [k: string]: unknown };

describe("record proposals from the assistant", () => {
  let w: World;
  let inc: string;

  async function ask(client: World["o"], text: string, context?: unknown): Promise<Ev[]> {
    const res = await w.e.app.fetch(new Request(`http://local.test/api${w.P}/ai/chat`, { method: "POST", headers: { "content-type": "application/json", cookie: client.cookie }, body: JSON.stringify({ text, context }) }));
    return (await res.text())
      .split("\n\n")
      .map((f) => f.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n"))
      .filter(Boolean)
      .map((d) => JSON.parse(d) as Ev);
  }
  const proposalOf = (events: Ev[]) => events.find((e) => e.type === "proposal")?.proposal;
  async function confirm(client: World["o"], id: string, expect = 200) {
    return (await client.post(`${w.P}/ai/actions/${id}/confirm`, {}, expect)) as { proposal: AiProposal };
  }

  beforeAll(async () => {
    process.env.ITSM_AI_FAKE = "1";
    w = await world();
    await w.o.post(`${w.P}/ai/connections`, { preset: "fake" });
    inc = String((await w.incident({ short_description: "کندی شبکهٔ طبقهٔ سوم", caller_id: w.p.req.userId, assignment_group_id: w.g.desk })).id);
    await w.drain();
  });

  it("a draft writes nothing; the person applies it with their own access and the card shows the field diff", async () => {
    const events = await ask(w.p.agent.client, `[tool:draft_update_incident {"id":"${inc}","values":{"impact":"1"}}] اثر را تغییر بده`, { record: { type: "incident", id: inc } });
    const p = proposalOf(events)!;
    expect(p).toBeTruthy();
    expect(p.kind).toBe("record.update");
    expect(p.line_headers).toEqual(["فیلد", "مقدار کنونی", "مقدار تازه"]);
    expect(p.lines?.[0].cells[0]).toBe("اثر");
    expect(p.record).toEqual({ table: "incident", id: inc });
    const now = (await w.o.get(`${w.P}/r/incident/${inc}`)).row;
    expect(now.impact).not.toBe("1");
    // someone who cannot read the record does not see the proposal, let alone apply it
    await confirm(w.p.req2.client, p.id, 404);
    const done = await confirm(w.p.agent.client, p.id);
    expect(done.proposal.status).toBe("executed");
    expect((await w.o.get(`${w.P}/r/incident/${inc}`)).row.impact).toBe("1");
    const audit = await w.e.db.one<{ user_id: string }>(`select user_id from sm_audit where org_id = $1 and action = 'ai_action' and entity = 'record.update'`, [w.e.org]);
    expect(audit?.user_id).toBe(w.p.agent.userId);
  });

  it("fails closed when a field moved since the draft", async () => {
    const p = proposalOf(await ask(w.p.agent.client, `[tool:draft_update_incident {"id":"${inc}","values":{"urgency":"1"}}] فوریت را تغییر بده`, { record: { type: "incident", id: inc } }))!;
    await w.o.patch(`${w.P}/r/incident/${inc}`, { urgency: "2" });
    const r = await confirm(w.p.agent.client, p.id);
    expect(r.proposal.status).toBe("failed");
    expect(r.proposal.error).toContain("تغییر کرده است");
    expect((await w.o.get(`${w.P}/r/incident/${inc}`)).row.urgency).toBe("2");
  });

  it("fails closed when the applier's access changed", async () => {
    const p = proposalOf(await ask(w.p.agent.client, `[tool:draft_update_incident {"id":"${inc}","values":{"impact":"3"}}] اثر را تغییر بده`, { record: { type: "incident", id: inc } }))!;
    expect(p).toBeTruthy();
    // the agent is now only a requester: the write is refused with their own access
    await w.o.put(`${w.P}/access/members/${w.p.agent.userId}`, { roles: ["requester"], persona: "requester" });
    const res = await w.e.app.fetch(new Request(`http://local.test/api${w.P}/ai/actions/${p.id}/confirm`, { method: "POST", headers: { "content-type": "application/json", cookie: w.p.agent.client.cookie }, body: "{}" }));
    if (res.status === 200) expect(((await res.json()) as { proposal: AiProposal }).proposal.status).toBe("failed");
    else expect([403, 404]).toContain(res.status);
    expect((await w.o.get(`${w.P}/r/incident/${inc}`)).row.impact).toBe("1");
    await w.o.put(`${w.P}/access/members/${w.p.agent.userId}`, { roles: ["agent"], persona: "agent" });
  });

  it("a multi-record request is one batch proposal: count, sample, and every row's result", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = String((await w.incident({ short_description: `درخواست قدیمی ${i}`, caller_id: w.p.req.userId, assignment_group_id: w.g.desk, assigned_to: w.p.agent.userId })).id);
      await backdate(w.e, "sm_incidents", id, "opened_at", 40);
      ids.push(id);
    }
    // a recent one is left out by the condition
    await w.incident({ short_description: "درخواست تازه", caller_id: w.p.req.userId, assignment_group_id: w.g.desk, assigned_to: w.p.agent.userId });
    const ask1 = `همهٔ رخدادهای بالای ۳۰ روز که به من محول شده را با یادداشت ببند [tool:draft_batch_incident {"where":[{"field":"assigned_to","op":"is_me"},{"field":"opened_at","op":"lt","value":"${new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)}"}],"action":"transition","to":"resolved","values":{"close_code":"solved","close_notes":"بسته شد با هماهنگی"},"note":"بسته شد؛ در صورت تکرار دوباره ثبت کنید","plan":["یافتن رخدادهای قدیمی","حل با یادداشت"]}]`;
    const p = proposalOf(await ask(w.p.agent.client, ask1))!;
    expect(p).toBeTruthy();
    expect(p.kind).toBe("record.batch");
    expect(p.count).toBe(3);
    expect(p.lines?.length).toBe(3);
    expect(p.preview.map((x) => x.value)).toContain("یافتن رخدادهای قدیمی");
    for (const id of ids) expect((await w.o.get(`${w.P}/r/incident/${id}`)).row.state).not.toBe("resolved");
    // one record moves before the person applies: that row fails, the others are written
    await w.o.patch(`${w.P}/r/incident/${ids[1]}`, { state: "in_progress" }, 200).catch(() => w.o.post(`${w.P}/r/incident/${ids[1]}/transition`, { to: "in_progress" }));
    const done = await confirm(w.p.agent.client, p.id);
    expect(done.proposal.status).toBe("executed");
    expect(done.proposal.outcome).toMatchObject({ ok: 2, failed: 1 });
    expect(done.proposal.outcome!.rows.find((r) => !r.ok)?.message).toContain("تغییر کرده است");
    expect((await w.o.get(`${w.P}/r/incident/${ids[0]}`)).row.state).toBe("resolved");
    expect((await w.o.get(`${w.P}/r/incident/${ids[1]}`)).row.state).toBe("in_progress");
    const notes = (await w.o.get(`${w.P}/r/incident/${ids[0]}/journal`)).entries as { body: string }[];
    expect(notes.some((n) => n.body.includes("در صورت تکرار"))).toBe(true);
    // a requester who reads none of these records never sees the batch
    const reqList = (await w.p.req2.client.get(`${w.P}/ai/actions?limit=200`)).actions as { id: string }[];
    expect(reqList.some((a) => a.id === p.id)).toBe(false);
  });

  it("refuses drafts the person could not apply (a transition they may not take, a field they may not set)", async () => {
    const events = await ask(w.p.req.client, `[tool:draft_update_incident {"id":"${inc}","values":{"impact":"2"}}] اثر را تغییر بده`, { record: { type: "incident", id: inc } });
    expect(proposalOf(events)).toBeUndefined();
    const end = events.find((e) => e.type === "tool_end");
    // the requester either is not offered the draft at all or is refused by it
    if (end) expect(end.ok).toBe(false);
  });
});
