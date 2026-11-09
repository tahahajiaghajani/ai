// Regressions of the AI skills review (docs/spec/AI.md §11): the service member is never an account someone signed up;
// a proposal is shown only to people who read everything it was built from (the field groups of its sources and the
// rows its template showed); stored runs show their output only to those who may still read it; only people who work a
// record decide its proposals; internal notes and history values reach a model only through the skill's field groups;
// a record's own AI-use rule closes it to skills; a patch keeps a built-in's defaults; «similar» text skills search
// their own tables; auto-apply never fails the job and never overwrites a change made meanwhile; re-runs never stack
// proposals; prompt times are the organisation's local Jalali times.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import "./fixtures/rag";
import { world, type World } from "./incident-helpers";
import { kbWorld, type KbWorld } from "./knowledge-helpers";
import { Client } from "./helpers";
import { create, systemCtx, update } from "@server/engine";
import { FAKE_INBOX, FAKE_QUEUE, clearFakeInbox } from "@server/modules/ai/adapters/fake";
import { principalOf } from "@server/modules/ai/skills";
import { invalidateTriggers, runTriggered } from "@server/modules/ai/skills/triggers";
import { skillDef } from "@server/modules/ai/skills/registry";

const before = process.env.ITSM_AI_FAKE;
afterAll(() => {
  if (before === undefined) delete process.env.ITSM_AI_FAKE;
  else process.env.ITSM_AI_FAKE = before;
});

const inbox = () => FAKE_INBOX.map((t) => `${t.system}\n${t.text}`).join("\n");
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

async function fetchStatus(app: World["e"]["app"], client: Client, path: string, body?: unknown, method = "POST"): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (client.cookie) headers.cookie = client.cookie;
  const res = await app.fetch(new Request(`http://local.test/api${path}`, { method, headers, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) }));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe("AI skills review: the incident organisation", () => {
  let w: World;
  const P = () => w.P;
  const st = (client: Client, path: string, body?: unknown, method = "POST") => fetchStatus(w.e.app, client, path, body, method);

  beforeAll(async () => {
    process.env.ITSM_AI_FAKE = "1";
    w = await world({ preset: "open" });
    await w.o.post(`${P()}/ai/connections`, { preset: "fake", embed: { model: "fake-embed", dims: 32 } });
  });

  it("patching a built-in before its row exists keeps its roles, field groups, grounding and tier", async () => {
    // nobody opened «مهارت‌ها» yet: no row of the organisation
    expect((await w.e.db.query(`select 1 from sm_ai_skills where org_id = $1`, [w.e.org])).length).toBe(0);
    const id = String((await w.incident({ short_description: "چاپگر کار نمی‌کند", caller_id: w.p.req.userId, assignment_group_id: w.g.desk })).id);
    expect((await st(w.p.req.client, `${P()}/ai/skills/incident.triage/run`, { table: "incident", id })).status).toBe(403);
    await w.o.patch(`${P()}/ai/skills/admin/incident.triage`, { daily_limit: 50 });
    const def = skillDef("incident.triage")!;
    const row = (await w.e.db.one<{ roles: string[]; grounding: string; tier: string; daily_limit: number }>(
      `select roles, grounding, tier, daily_limit from sm_ai_skills where org_id = $1 and key = 'incident.triage' and deleted_at is null`,
      [w.e.org],
    ))!;
    expect(row.daily_limit).toBe(50);
    expect(row.roles).toEqual(def.roles);
    expect(row.grounding).toBe(def.grounding?.kind);
    expect(row.tier).toBe(def.tier);
    // the requester still may not run the agents' skill
    expect((await st(w.p.req.client, `${P()}/ai/skills/incident.triage/run`, { table: "incident", id })).status).toBe(403);
  });

  it("the service member is never an account someone signed up: reserved addresses, a random address, no adoption", async () => {
    const legacy = `ai-assistant+${w.e.org}@service.invalid`;
    const anon = new Client(w.e.app);
    await anon.post("/auth/signup", { email: legacy, password: "s3cret-pass-1", full_name: "مهاجم آزمایشی" }, 400);
    await anon.post("/auth/signup", { email: "someone@corp.invalid", password: "s3cret-pass-1", full_name: "مهاجم آزمایشی" }, 400);
    await w.o.post(`${P()}/members`, { email: "helper@service.invalid", full_name: "حساب خدمت", role: "member" }, 400);
    // an account with the old, predictable address, registered before such addresses were reserved
    const pre = randomUUID();
    await w.e.db.query(`insert into sm_users (id, email, full_name, password_hash) values ($1, $2, 'مهاجم آزمایشی', 'not-a-real-hash')`, [pre, legacy]);
    const principal = (await w.o.post(`${P()}/ai/skills/admin/principal`, { roles: ["incident_manager"] })).principal;
    expect(principal.user_id).toBeTruthy();
    expect(principal.user_id).not.toBe(pre);
    expect(await w.e.db.one(`select 1 from sm_org_members where org_id = $1 and user_id = $2`, [w.e.org, pre])).toBeNull();
    const svc = (await w.e.db.one<{ email: string; password_hash: string | null }>(`select email, password_hash from sm_users where id = $1`, [principal.user_id]))!;
    expect(svc.email).toMatch(/^ai-assistant\+[0-9a-f-]{36}@service\.invalid$/);
    expect(svc.email).not.toBe(legacy);
    expect(svc.password_hash).toBeNull();
    // set up again: the same member
    expect((await w.o.post(`${P()}/ai/skills/admin/principal`, { roles: ["incident_manager"] })).principal.user_id).toBe(principal.user_id);
    // a member with a service address that someone signs in with is never the service member, and is refused
    await w.e.db.query(`update sm_users set password_hash = 'not-a-real-hash' where id = $1`, [principal.user_id]);
    expect((await principalOf(w.e.db, w.e.org)).user_id).toBeNull();
    await w.o.post(`${P()}/ai/skills/admin/principal`, { roles: ["incident_manager"] }, 409);
    await w.e.db.query(`update sm_users set password_hash = null where id = $1`, [principal.user_id]);
    expect((await principalOf(w.e.db, w.e.org)).user_id).toBe(principal.user_id);
  });

  it("a proposal built from a source's internal text is shown only to people who carry «internal»", async () => {
    const sys = await systemCtx(w.e.cfg, w.e.org);
    const a = String((await create(sys, "rag_ticket", { short_description: "خرابی سوئیچ zqswitch طبقهٔ سوم", description: "پورت‌های zqswitch کار نمی‌کنند", caller_id: w.p.req.userId, assignment_group_id: w.g.desk })).row.id);
    await create(sys, "rag_ticket", { short_description: "قطعی شبکهٔ طبقهٔ دوم", description: "کندی شبکه", diagnosis: "zqswitch پورت دوازده سوخته است diagQz7", caller_id: w.p.req.userId, assignment_group_id: w.g.desk });
    await w.drain();
    await w.o.patch(`${P()}/ai/skills/admin/reply.draft`, { grounding: "similar" });
    try {
      clearFakeInbox();
      const draft = await w.p.agent.client.post(`${P()}/ai/skills/reply.draft/run`, { table: "rag_ticket", id: a, params: { intent: "update" } });
      expect(inbox()).toContain("diagQz7"); // the agent carries «internal»: the other ticket's diagnosis was a source
      expect(draft.proposal?.kind).toBe("skill.journal");
      const seen = async (c: Client) => ((await c.get(`${P()}/ai/skills/for/rag_ticket/${a}`)).proposals as { id: string }[]).map((p) => p.id);
      expect(await seen(w.p.agent.client)).toContain(draft.proposal.id);
      // the requester reads both tickets, but not the internal group the draft was built from
      expect(await seen(w.p.req.client)).not.toContain(draft.proposal.id);
    } finally {
      await w.o.patch(`${P()}/ai/skills/admin/reply.draft`, { grounding: "knowledge" });
    }
  });

  it("the governance list shows a run's output only to those who may read its record now", async () => {
    // a confidential incident of the network group, opened by its agent
    const conf = String((await w.incident({ short_description: "نشت دادهٔ کارکنان confQz5", description: "شرح محرمانه confQz5", caller_id: w.p.req2.userId, assignment_group_id: w.g.network, confidential: true }, w.p.other.client)).id);
    expect((await st(w.o, `${P()}/r/incident/${conf}`, undefined, "GET")).status).toBe(404); // the owner does not read it
    const run = await w.p.other.client.post(`${P()}/ai/skills/record.summary/run`, { table: "incident", id: conf });
    expect(run.run_id).toBeTruthy();
    const all = (await w.o.get(`${P()}/ai/skills/runs?all=1`)).runs as { id: string; text: string | null; number: string | null; record_id: string | null; restricted?: boolean; tokens_in: number }[];
    const theirs = all.find((x) => x.id === run.run_id)!;
    expect(theirs).toBeTruthy(); // the run is listed (metadata: skill, status, cost…)
    expect(theirs.restricted).toBe(true);
    expect(theirs.text).toBeNull();
    expect(theirs.number).toBeNull();
    expect(theirs.record_id).toBeNull();
    expect(JSON.stringify(theirs)).not.toContain("confQz5");
    // its author still reads their own run
    const own = (await w.p.other.client.get(`${P()}/ai/skills/runs?table=incident&id=${conf}`)).runs as { id: string; text: string | null; restricted?: boolean }[];
    const mine = own.find((x) => x.id === run.run_id)!;
    expect(mine.restricted).toBe(false);
    expect(mine.text).toBeTruthy();
  });

  it("only people who work a record apply or reject its proposals — never a reader or its requester", async () => {
    const id = String((await w.incident({ short_description: "قطعی کامل اینترنت ساختمان", caller_id: w.p.req.userId, assignment_group_id: w.g.desk, urgency: "3", impact: "3" })).id);
    // no sources: the proposal involves only the incident's own fields, which the auditor reads
    await w.o.patch(`${P()}/ai/skills/admin/incident.triage`, { grounding: "none" });
    FAKE_QUEUE.push(JSON.stringify({ suggestions: [{ field: "urgency", value: "1", confidence: 0.9, reason: "قطعی کامل" }] }));
    const run = await w.p.agent.client.post(`${P()}/ai/skills/incident.triage/run`, { table: "incident", id });
    FAKE_QUEUE.length = 0;
    await w.o.patch(`${P()}/ai/skills/admin/incident.triage`, { grounding: "similar" });
    expect(run.proposal?.kind).toBe("skill.fields");
    const pid = String(run.proposal.id);
    const view = async (c: Client, which = pid) => ((await c.get(`${P()}/ai/skills/for/incident/${id}`)).proposals as { id: string; can_decide?: boolean }[]).find((p) => p.id === which);
    // the auditor reads every incident and writes none: sees it, may not decide it
    expect((await view(w.p.auditor.client))?.can_decide).toBe(false);
    expect((await st(w.p.auditor.client, `${P()}/ai/actions/${pid}/confirm`, {})).status).toBe(403);
    expect((await st(w.p.auditor.client, `${P()}/ai/actions/${pid}/reject`, {})).status).toBe(403);
    expect((await w.e.db.one<{ status: string }>(`select status from sm_ai_actions where id = $1`, [pid]))!.status).toBe("proposed");
    // the desk agent who works it decides
    expect((await view(w.p.agent.client))?.can_decide).toBe(true);
    const done = await w.p.agent.client.post(`${P()}/ai/actions/${pid}/confirm`, {});
    expect(done.proposal.status).toBe("executed");
    expect((await w.o.get(`${P()}/r/incident/${id}`)).row.urgency).toBe("1");
    // a reply drafted for the requester: they see it on their ticket, but neither send nor reject it
    const draft = await w.p.agent.client.post(`${P()}/ai/skills/reply.draft/run`, { table: "incident", id, params: { intent: "update" } });
    const rid = String(draft.proposal.id);
    expect((await view(w.p.req.client, rid))?.can_decide).toBe(false);
    expect((await st(w.p.req.client, `${P()}/ai/actions/${rid}/confirm`, {})).status).toBe(403);
    expect((await st(w.p.req.client, `${P()}/ai/actions/${rid}/reject`, {})).status).toBe(403);
    expect((await w.e.db.one<{ status: string }>(`select status from sm_ai_actions where id = $1`, [rid]))!.status).toBe("proposed");
  });

  it("history values of field groups the skill may not read never reach its model", async () => {
    const sys = await systemCtx(w.e.cfg, w.e.org);
    const id = String((await create(sys, "rag_ticket", { short_description: "تیکت تاریخچه", diagnosis: "تشخیص نخست", caller_id: w.p.req.userId, assignment_group_id: w.g.desk })).row.id);
    await update(sys, "rag_ticket", id, { diagnosis: "تشخیص دوم histQz3", short_description: "تیکت تاریخچهٔ تازه pubHist4" });
    clearFakeInbox();
    await w.p.agent.client.post(`${P()}/ai/skills/record.history/run`, { table: "rag_ticket", id });
    expect(inbox()).toContain("pubHist4"); // public changes are told
    expect(inbox()).not.toContain("histQz3"); // the agent sees the internal diagnosis, the skill may not read «internal»
  });

  it("a text skill's «similar» sources come from its own tables, never every indexed table", async () => {
    const sys = await systemCtx(w.e.cfg, w.e.org);
    await create(sys, "rag_ticket", { short_description: "چاپگر zqprinter خراب است", description: "چاپگر zqprinter کاغذ گیر می‌اندازد ragSimQ8", caller_id: w.p.req.userId, assignment_group_id: w.g.desk });
    await w.incident({ short_description: "چاپگر zqprinter طبقهٔ اول", description: "چاپگر zqprinter چاپ نمی‌کند incSimQ9", caller_id: w.p.req.userId, assignment_group_id: w.g.desk });
    await w.drain();
    clearFakeInbox();
    await w.p.agent.client.post(`${P()}/ai/skills/incident.triage_text/run`, { text: "چاپگر zqprinter چاپ نمی‌کند" });
    expect(inbox()).toContain("incSimQ9"); // a similar incident is a source
    expect(inbox()).not.toContain("ragSimQ8"); // a record of another table is not
  });

  it("re-running a skill keeps one open proposal per skill and record", async () => {
    const id = String((await w.incident({ short_description: "کندی سامانهٔ حقوق", caller_id: w.p.req.userId, assignment_group_id: w.g.desk, urgency: "3" })).id);
    const answer = (v: string) => JSON.stringify({ suggestions: [{ field: "urgency", value: v, confidence: 0.8, reason: "کندی" }] });
    const open = async () => (await w.e.db.query<{ id: string }>(`select id from sm_ai_actions where org_id = $1 and record_id = $2 and kind = 'skill.fields' and status = 'proposed'`, [w.e.org, id])).map((r) => r.id);
    FAKE_QUEUE.push(answer("2"), answer("2"));
    const first = await w.p.agent.client.post(`${P()}/ai/skills/incident.triage/run`, { table: "incident", id });
    const second = await w.p.agent.client.post(`${P()}/ai/skills/incident.triage/run`, { table: "incident", id });
    expect(second.proposal.id).toBe(first.proposal.id); // the same proposal is still open
    expect(await open()).toEqual([first.proposal.id]);
    FAKE_QUEUE.push(answer("1"));
    const third = await w.p.agent.client.post(`${P()}/ai/skills/incident.triage/run`, { table: "incident", id });
    FAKE_QUEUE.length = 0;
    expect(third.proposal.id).not.toBe(first.proposal.id);
    expect(await open()).toEqual([third.proposal.id]); // the newer one replaced it
    expect((await w.e.db.one<{ status: string }>(`select status from sm_ai_actions where id = $1`, [first.proposal.id]))!.status).toBe("expired");
  });

  it("auto-apply the service member may not make never fails the job: the model is called once", async () => {
    // «agent» in the open preset reads every incident and writes only its own groups' (the member is in none)
    await w.o.post(`${P()}/ai/skills/admin/principal`, { roles: ["agent"] });
    await w.o.patch(`${P()}/ai/skills/admin/incident.triage`, { triggers: ["manual", "event"], events: ["created"], auto_apply: ["urgency"] });
    try {
      FAKE_QUEUE.push(JSON.stringify({ suggestions: [{ field: "urgency", value: "1", confidence: 0.9, reason: "قطعی" }, { field: "impact", value: "1", confidence: 0.8, reason: "همه" }] }));
      const id = String((await w.incident({ short_description: "قطعی سراسری ایمیل", caller_id: w.p.req.userId, assignment_group_id: w.g.desk, urgency: "3", impact: "3" })).id);
      await w.drain();
      FAKE_QUEUE.length = 0;
      const runs = await w.e.db.query(`select 1 from sm_ai_skill_runs where org_id = $1 and record_id = $2 and skill_key = 'incident.triage'`, [w.e.org, id]);
      expect(runs.length).toBe(1);
      const jobs = await w.e.db.query<{ status: string; attempts: number; last_error: string | null }>(`select status, attempts, last_error from sm_jobs where kind = 'ai.skill.run' and payload->>'id' = $1`, [id]);
      expect(jobs.length).toBe(1);
      expect(jobs[0]).toMatchObject({ status: "done", attempts: 1, last_error: null });
      expect((await w.o.get(`${P()}/r/incident/${id}`)).row.urgency).toBe("3");
    } finally {
      await w.o.patch(`${P()}/ai/skills/admin/incident.triage`, { triggers: ["manual"], events: [], auto_apply: [] });
    }
  });

  it("auto-apply never overwrites a change a person made while the model was answering", async () => {
    await w.o.post(`${P()}/ai/skills/admin/principal`, { roles: ["incident_manager"] });
    // triggered (only by a comment: the test runs it itself), urgency applied without a person
    await w.o.patch(`${P()}/ai/skills/admin/incident.triage`, { triggers: ["manual", "event"], events: ["commented"], auto_apply: ["urgency"] });
    try {
      const id = String((await w.incident({ short_description: "قطعی تلفن‌ها", description: "همهٔ تلفن‌ها قطع است [slow]", caller_id: w.p.req.userId, assignment_group_id: w.g.desk, urgency: "3" })).id);
      await w.drain();
      FAKE_QUEUE.push(JSON.stringify({ suggestions: [{ field: "urgency", value: "1", confidence: 0.9, reason: "همهٔ تلفن‌های ساختمان قطع است و کار مرکز تماس کاملاً متوقف شده است" }] }));
      const seen = FAKE_INBOX.length;
      const running = runTriggered(w.e.cfg, w.e.org, "incident.triage", "incident", id);
      // the model is answering (slowly): the dispatcher sets the urgency meanwhile
      for (let i = 0; i < 300 && FAKE_INBOX.length === seen; i++) await new Promise((r) => setTimeout(r, 10));
      expect(FAKE_INBOX.length).toBeGreaterThan(seen);
      await w.o.patch(`${P()}/r/incident/${id}`, { urgency: "2" });
      const r = await running;
      FAKE_QUEUE.length = 0;
      expect(r.ran).toBe(true);
      expect((await w.o.get(`${P()}/r/incident/${id}`)).row.urgency).toBe("2"); // the person's choice stands
      // the suggestion waits for a person instead
      const props = await w.e.db.query<{ payload: { data: Record<string, unknown> } }>(`select payload from sm_ai_actions where org_id = $1 and record_id = $2 and kind = 'skill.fields' and status = 'proposed'`, [w.e.org, id]);
      expect(props.map((p) => p.payload.data.urgency)).toEqual(["1"]);
    } finally {
      await w.o.patch(`${P()}/ai/skills/admin/incident.triage`, { triggers: ["manual"], events: [], auto_apply: [] });
    }
  });

  it("a scheduled skill runs again only on records changed since it last ran on them", async () => {
    await w.o.post(`${P()}/ai/skills/admin/principal`, { roles: ["incident_manager"] });
    const title = "رخداد زمان‌بندی‌شدهٔ آزمایشی";
    const id = String((await w.incident({ short_description: title, caller_id: w.p.req.userId, assignment_group_id: w.g.desk })).id);
    await w.drain();
    const round = async () => {
      // the round is due now (the organisation's round waits 15 minutes; the skill's own interval is reset)
      await w.e.db.query(`update sm_ai_skills set last_scheduled_at = null where org_id = $1 and key = 'record.summary'`, [w.e.org]);
      invalidateTriggers(w.e.org); // the cached configuration of triggered skills (30 s) is read again
      await w.e.db.query(`update sm_jobs set run_at = now() where org_id = $1 and kind = 'ai.skills.schedule' and status = 'queued'`, [w.e.org]);
      await w.drain();
    };
    const runs = async () => (await w.e.db.query(`select 1 from sm_ai_skill_runs where org_id = $1 and record_id = $2 and skill_key = 'record.summary'`, [w.e.org, id])).length;
    await w.o.patch(`${P()}/ai/skills/admin/record.summary`, { triggers: ["manual", "schedule"], schedule_minutes: 15, tables: ["incident"], schedule_filter: { f: "short_description", op: "eq", v: title } });
    try {
      await round();
      expect(await runs()).toBe(1);
      await round(); // nothing changed: not run again
      expect(await runs()).toBe(1);
      await w.o.patch(`${P()}/r/incident/${id}`, { description: "شرح تازه" });
      await round(); // changed since: run again
      expect(await runs()).toBe(2);
    } finally {
      await w.o.patch(`${P()}/ai/skills/admin/record.summary`, { triggers: ["manual"], schedule_minutes: null, schedule_filter: null, tables: ["*"] });
    }
  });

  it("journal times and SLA deadlines reach the model as local Jalali times, never raw UTC timestamps", async () => {
    const id = String((await w.incident({ short_description: "کندی ورود به سامانه", caller_id: w.p.req.userId, assignment_group_id: w.g.desk })).id);
    await w.o.post(`${P()}/r/incident/${id}/journal`, { kind: "comment", body: "پاسخ عمومی timeQz2" });
    clearFakeInbox();
    await w.p.agent.client.post(`${P()}/ai/skills/record.summary/run`, { table: "incident", id });
    expect(inbox()).toContain("timeQz2");
    expect(inbox()).not.toMatch(ISO);
    // the handover lists the open incidents of the agent's groups with their deadlines
    clearFakeInbox();
    await w.p.agent.client.post(`${P()}/ai/skills/incident.handover/run`, {});
    expect(FAKE_INBOX.length).toBeGreaterThan(0);
    expect(inbox()).toContain("کندی ورود به سامانه");
    expect(inbox()).not.toMatch(ISO);
  });
});

describe("AI skills review: a record's own AI-use rule", () => {
  let k: KbWorld;
  beforeAll(async () => {
    process.env.ITSM_AI_FAKE = "1";
    k = await kbWorld();
    await k.o.post(`${k.P}/ai/connections`, { preset: "fake" });
  }, 240_000);

  it("an article «هرگز» for AI is never read by a skill (the article itself, a duplicate check, its drafts)", async () => {
    const open = await k.published({ title: "راه‌اندازی چاپگر", body: "## گام‌ها\n\n1. روشن کنید openKbQ1\n" });
    const closed = await k.published({ title: "تنظیم دیواره آتش", body: "## گام‌ها\n\n1. قاعده بسازید closedKbQ2\n" });
    await k.e.db.query(`update sm_kb_articles set ai_use = 'none' where id = $1`, [closed.id]);
    const st = (path: string, body: unknown) => fetchStatus(k.e.app, k.p.km.client, path, body);
    // the open article: summarised (the rule is not vacuous)
    clearFakeInbox();
    expect((await st(`${k.P}/ai/skills/record.summary/run`, { table: "kb_article", id: open.id })).status).toBe(200);
    expect(inbox()).toContain("openKbQ1");
    // the closed one: refused, nothing reaches a model
    clearFakeInbox();
    const r = await st(`${k.P}/ai/skills/record.summary/run`, { table: "kb_article", id: closed.id });
    expect(r.status).toBe(400);
    expect(String(r.body?.error?.message ?? r.body?.message ?? JSON.stringify(r.body))).toContain("این رکورد برای هوش مصنوعی بسته است");
    expect((await st(`${k.P}/ai/skills/kb.duplicate/run`, { table: "kb_article", id: open.id, params: { other: closed.id } })).status).toBe(400);
    expect(FAKE_INBOX.length).toBe(0);
    expect(inbox()).not.toContain("closedKbQ2");
    // a draft of a closed article follows it
    const draft = await k.article({ title: "پیش‌نویس بسته", body: "## گام‌ها\n\n1. چیزی draftKbQ3\n" });
    await k.e.db.query(`update sm_kb_articles set ai_use = 'none' where id = $1`, [draft.article.id]);
    expect((await st(`${k.P}/ai/skills/kb.metadata/run`, { table: "kb_version", id: draft.version.id })).status).toBe(400);
    expect(inbox()).not.toContain("draftKbQ3");
  });
});
