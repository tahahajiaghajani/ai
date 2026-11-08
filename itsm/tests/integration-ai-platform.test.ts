// The AI skills (A2) on the platform's second round (P2), side by side:
//   · «no AI» is an answer, never a 500: errorResponse maps AiUnavailableError and ai_* errors to the Persian answer of
//     their kind; the change module's CAB pack and PIR draft use the registered skills when a model answers and fall
//     back to their deterministic drafts (`ai: false`) when none does (no connection, a provider failure);
//   · the approver grant: a requester who reads a change only because they are asked to approve it runs a skill on
//     it — with the field groups of their own roles (the change's estimate never reaches the model) — and nothing
//     before they are asked; the record page offers them the «هوش مصنوعی» panel;
//   · an event-triggered skill runs as the «دستیار هوش مصنوعی» service member on a confidential incident it is on the
//     access list of, and its proposal stays invisible to an agent outside the confidential list.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { world as changeWorld, type World as ChangeWorld } from "./change-helpers";
import { world as incidentWorld, type World as IncidentWorld } from "./incident-helpers";
import { errorResponse } from "@server/http/hono";
import { AppError } from "@server/http/errors";
import { AiUnavailableError } from "@server/modules/ai/errors";
import { FAKE_INBOX, FAKE_QUEUE, clearFakeInbox } from "@server/modules/ai/adapters/fake";
import { principalEmail } from "@server/modules/ai/skills";
import { changeAi } from "@server/modules/change/ai";

const before = process.env.ITSM_AI_FAKE;
beforeAll(() => {
  process.env.ITSM_AI_FAKE = "1";
});
afterAll(() => {
  if (before === undefined) delete process.env.ITSM_AI_FAKE;
  else process.env.ITSM_AI_FAKE = before;
});

const inbox = () => FAKE_INBOX.map((t) => `${t.system}\n${t.text}`).join("\n");
const manual = (risk: string) => ({ risk, risk_source: "manual", risk_override_reason: "ارزیابی کارشناس" });

describe("«no AI» in the platform's error answer", () => {
  const app = new Hono();
  app.onError((err, c) => errorResponse(err, c));
  app.get("/unavailable/:kind", (c) => {
    throw new AiUnavailableError(c.req.param("kind") as never, "هوش مصنوعی پاسخ نداد");
  });
  app.get("/app-error", () => {
    throw new AppError(500, "ai_network", "ارتباط با سرویس هوش مصنوعی برقرار نشد");
  });

  it("maps AiUnavailableError to the status of its kind (503 when the provider is down), in Persian", async () => {
    const down = await app.fetch(new Request("http://x/unavailable/network"));
    expect(down.status).toBe(503);
    expect(await down.json()).toMatchObject({ error: { code: "ai_network", message: "هوش مصنوعی پاسخ نداد", details: { kind: "network" } } });
    expect((await app.fetch(new Request("http://x/unavailable/not_configured"))).status).toBe(403);
    expect((await app.fetch(new Request("http://x/unavailable/rate"))).status).toBe(429);
    const wrapped = await app.fetch(new Request("http://x/app-error"));
    expect(wrapped.status).toBe(503);
    expect((await wrapped.json()).error.code).toBe("ai_network");
  });
});

describe("change enablement with the AI skills", () => {
  let w: ChangeWorld;
  let meeting: Record<string, any>;
  let done: Record<string, any>;
  let asked: Record<string, any>;

  beforeAll(async () => {
    w = await changeWorld();
    const cabId = (await w.o.get(`${w.P}/r/cab?size=10`)).rows.find((c: any) => c.kind === "change").id;
    const high = await w.change(manual("high"));
    await w.move(high.id, ["assess", "authorize"]);
    meeting = (await w.p.cm.client.post(`${w.P}/change/cab/${cabId}/next`, {})).meeting;
    done = await w.change({ ...manual("low"), type: "latent", actual_start: new Date(Date.now() - 3 * 86_400_000).toISOString(), actual_end: new Date(Date.now() - 3 * 86_400_000 + 3_600_000).toISOString() });
    await w.move(done.id, ["review"], w.p.agent.client, { close_code: "successful" });
    asked = await w.change(manual("moderate"));
    await w.o.patch(`${w.P}/r/change_request/${asked.id}`, { planned_cost: "987654321" });
    await w.move(asked.id, ["assess", "authorize"]);
  }, 240_000);

  it("the CAB pack and PIR skills are registered with the module", () => {
    expect(typeof changeAi().cabPack).toBe("function");
    expect(typeof changeAi().draftPir).toBe("function");
  });

  it("without a model: the deterministic pack and draft, marked as such; module AI routes answer «no AI» (not 500)", async () => {
    const { P, p } = w;
    const pack = await p.cab1.client.get(`${P}/change/cab/meetings/${meeting.id}/pack`);
    expect(pack.ai).toBe(false);
    expect(pack.markdown).toContain("بستهٔ جلسه");
    const draft = await p.agent.client.get(`${P}/change/records/${done.id}/pir-draft`);
    expect(draft.ai).toBe(false);
    expect(draft.sections.went_well).toContain("موفق");
    const err = await p.agent.client.post(`${P}/change/records/${done.id}/ai/summarize`, {}, 403);
    expect(err.error.code).toBe("ai_not_configured");
    // the risk explanation catches «no AI» from the registered skill and answers deterministically
    const risk = await p.agent.client.post(`${P}/change/records/${asked.id}/risk/explain`, {});
    expect(risk.ai).toBe(false);
    expect(risk.text.length).toBeGreaterThan(0);
  });

  it("with a model: the skills write the pack and the PIR sections (merged over the deterministic draft)", async () => {
    const { P, o, p } = w;
    await o.post(`${P}/ai/connections`, { preset: "fake" });
    FAKE_QUEUE.push("# بستهٔ هوشمند جلسه\n\n## ۱. تغییر پرریسک");
    const pack = await p.cab1.client.get(`${P}/change/cab/meetings/${meeting.id}/pack`);
    expect(pack.ai).toBe(true);
    expect(pack.markdown).toContain("بستهٔ هوشمند جلسه");
    FAKE_QUEUE.push(JSON.stringify({ went_well: "- اجرا در پنجرهٔ برنامه‌ریزی‌شده انجام شد", lessons: "- برنامهٔ بازگشت زودتر آزموده شود" }));
    const draft = await p.agent.client.get(`${P}/change/records/${done.id}/pir-draft`);
    FAKE_QUEUE.length = 0;
    expect(draft.ai).toBe(true);
    expect(draft.sections.went_well).toContain("پنجرهٔ برنامه‌ریزی‌شده");
    expect(draft.sections.lessons).toContain("برنامهٔ بازگشت");
    expect(draft.sections.timeline_md).toContain("اجرای واقعی"); // deterministic sections stay
  });

  it("a provider failure is «no AI» too: the deterministic draft, ai:false", async () => {
    const { P, p } = w;
    // the fake model fails on this directive inside the prompt (the change's description reaches it)
    const failing = await w.change({ ...manual("low"), type: "latent", description: "[error:network]", actual_start: new Date(Date.now() - 86_400_000).toISOString(), actual_end: new Date(Date.now() - 86_400_000 + 3_600_000).toISOString() });
    await w.move(failing.id, ["review"], p.agent.client, { close_code: "successful" });
    const draft = await p.agent.client.get(`${P}/change/records/${failing.id}/pir-draft`);
    expect(draft.ai).toBe(false);
    expect(draft.sections.went_well).toContain("موفق");
    // the skill did run and failed at the provider (stored as an error run), not refused before it
    const runs = await w.e.db.query<{ status: string }>(`select status from sm_ai_skill_runs where org_id = $1 and record_id = $2 and skill_key = 'change.pir'`, [w.e.org, failing.id]);
    expect(runs.map((r) => r.status)).toEqual(["error"]);
  });

  it("an approver who reads the change only through the approver grant runs a skill on it, with their own field groups", async () => {
    const { P, o, p } = w;
    // the skill may read the financial group; whoever runs it still sees only their own groups
    await o.patch(`${P}/ai/skills/admin/record.summary`, { field_groups: ["financial"] });
    // not asked yet: the record does not exist for them, nor for the skill
    await p.req.client.post(`${P}/ai/skills/record.summary/run`, { table: "change_request", id: asked.id }, 404);
    await o.post(`${P}/approvals/record/change_request/${asked.id}/request`, { users: [p.req.userId] });
    const page = await p.req.client.get(`${P}/r/change_request/${asked.id}`);
    expect(page.meta.reach).toBe("participant");
    expect(page.meta.ai_skills).toBe(true); // the «هوش مصنوعی» panel is offered (it declares participants: true)
    clearFakeInbox();
    const run = await p.req.client.post(`${P}/ai/skills/record.summary/run`, { table: "change_request", id: asked.id });
    expect(run.run_id).toBeTruthy();
    expect(inbox()).toContain("ارتقای دیوارهٔ آتش");
    expect(inbox()).not.toContain("987654321");
    // the owner carries «financial»: the same skill reads the estimate for them (the check is not vacuous)
    clearFakeInbox();
    await o.post(`${P}/ai/skills/record.summary/run`, { table: "change_request", id: asked.id });
    expect(inbox()).toContain("987654321");
    await o.patch(`${P}/ai/skills/admin/record.summary`, { field_groups: [] });
  });
});

describe("an event-triggered skill on a confidential incident", () => {
  let w: IncidentWorld;

  beforeAll(async () => {
    w = await incidentWorld();
    await w.o.post(`${w.P}/ai/connections`, { preset: "fake" });
  }, 240_000);

  it("runs as «دستیار هوش مصنوعی» on it; an agent outside the confidential list never sees the proposal", async () => {
    const { P, o, p } = w;
    const principal = (await o.post(`${P}/ai/skills/admin/principal`, { roles: ["incident_manager"] })).principal;
    const svc = await w.e.db.one<{ id: string }>(`select id from sm_users where email = $1`, [principalEmail(w.e.org)]);
    expect(svc!.id).toBe(principal.user_id);
    await o.patch(`${P}/ai/skills/admin/note.draft`, { triggers: ["manual", "event"], events: ["created"] });
    clearFakeInbox();
    const inc = String(
      (await w.incident({ short_description: "نشت داده‌های کارکنان", description: "شرح محرمانهٔ رخداد", caller_id: p.req.userId, assignment_group_id: w.g.network, confidential: true, access_list: [svc!.id] })).id,
    );
    await w.drain();
    const runs = await w.e.db.query<{ invoker_id: string; principal: string }>(`select invoker_id, principal from sm_ai_skill_runs where org_id = $1 and record_id = $2 and skill_key = 'note.draft'`, [w.e.org, inc]);
    expect(runs).toEqual([{ invoker_id: svc!.id, principal: "service" }]);
    expect(inbox()).toContain("شرح محرمانهٔ رخداد");
    const props = await w.e.db.query<{ id: string }>(`select id from sm_ai_actions where org_id = $1 and record_id = $2 and principal = 'service'`, [w.e.org, inc]);
    expect(props.length).toBe(1);
    const id = props[0].id;
    // the desk agent reads every incident of the open desk, but not this confidential one (not its group, not on its list)
    await p.agent.client.get(`${P}/r/incident/${inc}`, 404);
    await p.agent.client.get(`${P}/ai/skills/for/incident/${inc}`, 404);
    const listed = (await p.agent.client.get(`${P}/ai/actions?status=proposed`)).actions as { id: string }[];
    expect(listed.map((a) => a.id)).not.toContain(id);
    await p.agent.client.post(`${P}/ai/actions/${id}/confirm`, {}, 404);
    // the network agent (its assignment group passes the confidentiality rule) sees it: the check is not vacuous
    const seen = (await p.other.client.get(`${P}/ai/skills/for/incident/${inc}`)).proposals as { id: string }[];
    expect(seen.map((x) => x.id)).toContain(id);
    await o.patch(`${P}/ai/skills/admin/note.draft`, { triggers: ["manual"], events: [] });
  });
});
