// The skills runtime and its administration (docs/spec/AI.md §11): versions (draft → publish → roll back, the
// built-in default), copies, template and schema checks, JSON validation with one repair try, rule-based fallbacks
// when no model answers (and skills without one switched off with the reason), per-skill limits, evaluation sets and
// their scores, usage per skill, field suggestions applied as a proposal with the person's access (and refused when
// the field changed since), the guards of the skills tables, and the modules' AI extension points now answering.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { world, type World } from "./incident-helpers";
import { FAKE_INBOX, FAKE_QUEUE, clearFakeInbox } from "@server/modules/ai/adapters/fake";
import { memberCtx } from "@server/access";
import { runSkill, zodFromJsonSchema } from "@server/modules/ai/skills";
import { incidentAi, problemAi } from "@server/modules/incident/ai";
import { requestAi } from "@server/modules/request/ai";
import { SKILL_FALLBACK_LABEL } from "@shared/ai/skills";

const before = process.env.ITSM_AI_FAKE;
afterAll(() => {
  if (before === undefined) delete process.env.ITSM_AI_FAKE;
  else process.env.ITSM_AI_FAKE = before;
});

async function status(w: World, client: World["o"], path: string, body?: unknown, method = "POST"): Promise<number> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (client.cookie) headers.cookie = client.cookie;
  const res = await w.e.app.fetch(new Request(`http://local.test/api${path}`, { method, headers, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) }));
  return res.status;
}

describe("AI skills without a model", () => {
  let w: World;
  let inc: string;
  beforeAll(async () => {
    process.env.ITSM_AI_FAKE = "1";
    w = await world();
    inc = String((await w.incident({ short_description: "کندی سامانهٔ حقوق", caller_id: w.p.req.userId, assignment_group_id: w.g.desk })).id);
  });

  it("skills with a rule-based fallback answer without one (and say so); the rest are off with the remedy", async () => {
    const r = await w.p.agent.client.post(`${w.P}/ai/skills/record.summary/run`, { table: "incident", id: inc });
    expect(r.fallback).toBe(true);
    expect(r.label).toBe(SKILL_FALLBACK_LABEL);
    expect(r.text).toContain("کندی سامانهٔ حقوق");
    const panel = (await w.p.agent.client.get(`${w.P}/ai/skills/for/incident/${inc}`)).skills as { key: string; available: boolean; fallback: boolean; needs_settings: boolean; reason: string | null }[];
    const summary = panel.find((s) => s.key === "record.summary")!;
    expect(summary).toMatchObject({ available: true, fallback: true });
    const reply = panel.find((s) => s.key === "reply.draft")!;
    expect(reply).toMatchObject({ available: false, needs_settings: true });
    expect(reply.reason).toContain("تنظیمات هوش مصنوعی");
    expect(await status(w, w.p.agent.client, `${w.P}/ai/skills/reply.draft/run`, { table: "incident", id: inc })).toBe(403);
    // the writing tool «fix» has a rule-based fallback too (Persian typography)
    const fixed = await w.p.agent.client.post(`${w.P}/ai/skills/text.fix/run`, { text: "اين يك متن آزمايشي است ، با ك عربي" });
    expect(fixed.text).toContain("این یک متن");
    expect(fixed.text).not.toMatch(/[يك]/);
  });
});

describe("AI skills: runtime and administration", () => {
  let w: World;
  let inc: string;
  const P = () => w.P;

  beforeAll(async () => {
    process.env.ITSM_AI_FAKE = "1";
    w = await world();
    await w.o.post(`${P()}/ai/connections`, { preset: "fake" });
    inc = String((await w.incident({ short_description: "قطعی وی‌پی‌ان در شعبهٔ شرق", description: "کاربران شعبه به وی‌پی‌ان وصل نمی‌شوند", caller_id: w.p.req.userId, assignment_group_id: w.g.desk })).id);
    await w.drain();
  });

  it("the admin page seeds a row per built-in skill once, and members without ai:full are refused", async () => {
    const a = await w.o.get(`${P()}/ai/skills/admin`);
    const keys = (a.skills as { key: string }[]).map((s) => s.key);
    for (const k of ["record.summary", "incident.triage", "problem.rca", "change.risk_narrative", "request.item_generate", "kb.kcs_draft", "cmdb.relationships", "service.describe", "text.translate"]) expect(keys).toContain(k);
    await w.o.get(`${P()}/ai/skills/admin`);
    const n = await w.e.db.one<{ n: number }>(`select count(*)::int as n from sm_ai_skills where org_id = $1 and key = 'record.summary' and deleted_at is null`, [w.e.org]);
    expect(n!.n).toBe(1);
    expect(await status(w, w.p.agent.client, `${P()}/ai/skills/admin`, undefined, "GET")).toBe(403);
    // the generic record API is held to the same rule (a hook on every path)
    const id = (await w.e.db.one<{ id: string }>(`select id from sm_ai_skills where org_id = $1 and key = 'record.summary'`, [w.e.org]))!.id;
    expect(await status(w, w.p.agent.client, `${P()}/r/ai_skill/${id}`, { enabled: false }, "PATCH")).toBe(404); // no grant in «ai»: not even seen
    // a member without ITSM roles keeps the membership's «ai» edit level in the record API — the hook still refuses
    const legacy = await w.e.member("member", "legacy@example.com");
    expect(await status(w, legacy.client, `${P()}/r/ai_skill/${id}`, { enabled: false }, "PATCH")).toBe(403);
    expect(await status(w, legacy.client, `${P()}/r/ai_skill`, { key: "x.y", name: "مهارت", base_key: "record.summary" })).toBe(403);
  });

  it("versions: a draft is tested, published, diffed against the default and rolled back", async () => {
    // a template with an unknown placeholder is refused, and so is one without the record
    expect(await status(w, w.o, `${P()}/ai/skills/admin/record.summary/versions`, { system: "x", template: "{{secret_things}}", note: "آزمون" })).toBe(400);
    expect(await status(w, w.o, `${P()}/ai/skills/admin/record.summary/versions`, { system: "x", template: "فقط {{today}}", note: "آزمون" })).toBe(400);
    const v = (await w.o.post(`${P()}/ai/skills/admin/record.summary/versions`, { system: "خلاصه را در سه خط بنویس. MARKER_V1", template: "رکورد:\n{{record}}\n{{journal}}", note: "خلاصهٔ کوتاه‌تر" })).version;
    expect(v.state).toBe("draft");
    // the test run uses the draft (with the administrator's own access); members still get the default
    clearFakeInbox();
    await w.o.post(`${P()}/ai/skills/admin/record.summary/test`, { table: "incident", id: inc, version_id: v.id });
    expect(FAKE_INBOX.at(-1)!.system).toContain("MARKER_V1");
    clearFakeInbox();
    await w.p.agent.client.post(`${P()}/ai/skills/record.summary/run`, { table: "incident", id: inc });
    expect(FAKE_INBOX.at(-1)!.system).not.toContain("MARKER_V1");
    // published: everyone's runs use it
    await w.o.post(`${P()}/ai/skills/admin/record.summary/publish`, { version_id: v.id });
    clearFakeInbox();
    await w.p.agent.client.post(`${P()}/ai/skills/record.summary/run`, { table: "incident", id: inc });
    expect(FAKE_INBOX.at(-1)!.system).toContain("MARKER_V1");
    // a published version never changes; a second one and a roll back to the built-in default
    const vid = (await w.e.db.one<{ id: string }>(`select id from sm_ai_skill_versions where org_id = $1 and id = $2`, [w.e.org, v.id]))!.id;
    expect(await status(w, w.o, `${P()}/r/ai_skill_version/${vid}`, { template: "{{record}} changed" }, "PATCH")).toBe(400);
    const admin = await w.o.get(`${P()}/ai/skills/admin`);
    const item = (admin.skills as { key: string; versions: { id: string | null; state: string }[]; active_version_id: string | null }[]).find((s) => s.key === "record.summary")!;
    expect(item.active_version_id).toBe(v.id);
    expect(item.versions.map((x) => x.state)).toEqual(expect.arrayContaining(["published", "default"]));
    await w.o.post(`${P()}/ai/skills/admin/record.summary/publish`, { version_id: null });
    clearFakeInbox();
    await w.p.agent.client.post(`${P()}/ai/skills/record.summary/run`, { table: "incident", id: inc });
    expect(FAKE_INBOX.at(-1)!.system).not.toContain("MARKER_V1");
  });

  it("a copy runs under its own key with its own prompt, off until switched on", async () => {
    const copy = (await w.o.post(`${P()}/ai/skills/admin/record.summary/copy`, { key: "org.brief", name: "خلاصهٔ مدیریتی" })).skill;
    expect(copy).toMatchObject({ key: "org.brief", builtin: false, enabled: false, base_key: "record.summary" });
    expect(await status(w, w.p.agent.client, `${P()}/ai/skills/org.brief/run`, { table: "incident", id: inc })).toBe(403);
    await w.o.patch(`${P()}/ai/skills/admin/org.brief`, { enabled: true });
    const r = await w.p.agent.client.post(`${P()}/ai/skills/org.brief/run`, { table: "incident", id: inc });
    expect(r.skill).toBe("org.brief");
    expect(await status(w, w.o, `${P()}/ai/skills/admin/record.summary/copy`, { key: "record.summary", name: "دوباره" })).toBe(409);
  });

  it("JSON answers are validated against the schema with one repair try", async () => {
    FAKE_QUEUE.push("این JSON نیست", JSON.stringify({ subject: "به‌روزرسانی قطعی وی‌پی‌ان", body: "کار روی اتصال ادامه دارد." }));
    clearFakeInbox();
    const r = await w.p.agent.client.post(`${P()}/ai/skills/incident.stakeholder_update/run`, { table: "incident", id: inc, params: { audience: "users" } });
    expect(r.json).toMatchObject({ subject: "به‌روزرسانی قطعی وی‌پی‌ان" });
    expect(FAKE_INBOX.length).toBe(2);
    expect(FAKE_INBOX[1].text).toContain("not valid JSON");
    // a tenant's own output schema is enforced the same way
    expect(zodFromJsonSchema({ type: "object", properties: { n: { type: "integer" } }, required: ["n"] }).safeParse({ n: 1.5 }).success).toBe(false);
  });

  it("field suggestions become a proposal with a diff, applied with the person's access, refused once the field changed", async () => {
    FAKE_QUEUE.push(JSON.stringify({ suggestions: [{ field: "urgency", value: "1", confidence: 0.85, reason: "همهٔ شعبه بی‌اتصال است" }, { field: "assignment_group_id", value: "پشتیبانی شبکه", confidence: 0.7, reason: "وی‌پی‌ان" }, { field: "state", value: "resolved", confidence: 1 }] }));
    const r = await w.p.agent.client.post(`${P()}/ai/skills/incident.triage/run`, { table: "incident", id: inc });
    const fields = (r.suggestions as { field: string; value: unknown; current_display: string }[]).map((s) => s.field).sort();
    expect(fields).toEqual(["assignment_group_id", "urgency"]); // the state moves only by transitions
    expect(r.suggestions.find((s: { field: string }) => s.field === "assignment_group_id").value).toBe(w.g.network);
    expect(r.proposal.kind).toBe("skill.fields");
    expect(r.proposal.line_headers).toEqual(["فیلد", "مقدار کنونی", "پیشنهاد", "اطمینان", "دلیل"]);
    const applied = (await w.p.agent.client.post(`${P()}/ai/actions/${r.proposal.id}/confirm`, {})).proposal;
    expect(applied.status).toBe("executed");
    const row = (await w.o.get(`${P()}/r/incident/${inc}`)).row;
    expect(row.urgency).toBe("1");
    expect(row.assignment_group_id).toBe(w.g.network);
    // a second suggestion while someone changes the field: applying it is refused
    FAKE_QUEUE.push(JSON.stringify({ suggestions: [{ field: "urgency", value: "2", confidence: 0.6 }] }));
    const r2 = await w.o.post(`${P()}/ai/skills/incident.triage/run`, { table: "incident", id: inc });
    await w.o.patch(`${P()}/r/incident/${inc}`, { urgency: "3" });
    const failed = (await w.o.post(`${P()}/ai/actions/${r2.proposal.id}/confirm`, {})).proposal;
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("تغییر کرده");
  });

  it("per-skill limits stop runs for the day", async () => {
    await w.o.patch(`${P()}/ai/skills/admin/incident.sentiment`, { user_daily_limit: 1 });
    await w.p.agent.client.post(`${P()}/ai/skills/incident.sentiment/run`, { table: "incident", id: inc });
    expect(await status(w, w.p.agent.client, `${P()}/ai/skills/incident.sentiment/run`, { table: "incident", id: inc })).toBe(429);
    await w.o.post(`${P()}/ai/skills/incident.sentiment/run`, { table: "incident", id: inc }); // another member's quota
    await w.o.patch(`${P()}/ai/skills/admin/incident.sentiment`, { user_daily_limit: null });
  });

  it("evaluation sets run with the organisation's model and keep their scores; usage is counted per skill", async () => {
    const e = (
      await w.o.post(`${P()}/ai/skills/admin/text.translate/evals`, {
        name: "ترجمهٔ پیام‌های کوتاه",
        cases: [
          { name: "خوشامد", text: "Welcome to the service desk", params: { language: "fa" }, expect: { min_chars: 5, contains: ["Welcome"] } },
          { name: "نبود متن", text: "x", expect: { not_contains: ["رمز"] } },
        ],
      })
    ).eval;
    const ran = (await w.o.post(`${P()}/ai/skills/admin/text.translate/evals/run`, { eval_id: e.id })).evals as { last_score: number; last_results: { case: string; score: number }[]; last_model: string }[];
    expect(ran[0].last_results.length).toBe(2);
    expect(ran[0].last_score).toBeGreaterThan(0);
    expect(ran[0].last_model).toMatch(/^fake-/);
    // usage is counted per day of the organisation's time zone: from 20:30 UTC it is already tomorrow in Tehran, so the
    // window ends a day after the UTC date (the test passes at any hour)
    const until = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const usage = (await w.o.get(`${P()}/ai/skills/admin/usage?from=2020-01-01&to=${until}`)).rows as { skill: string; runs: number }[];
    expect(usage.find((u) => u.skill === "record.summary")!.runs).toBeGreaterThan(0);
  });

  it("the modules' AI extension points answer through the skills (as the person asking)", async () => {
    expect(typeof incidentAi().summarize).toBe("function");
    const agent = await memberCtx(w.e.cfg, w.e.org, w.p.agent.userId);
    const s = await incidentAi().summarize!(agent, inc);
    expect(s.text.length).toBeGreaterThan(0);
    const http = await w.p.agent.client.post(`${P()}/incident/${inc}/ai/summarize`, {});
    expect(http.text.length).toBeGreaterThan(0);
    FAKE_QUEUE.push(JSON.stringify({ subject: "اطلاع‌رسانی", body: "متن" }));
    expect((await w.p.agent.client.post(`${P()}/incident/${inc}/ai/draftUpdate`, { audience: "executives" })).subject).toBe("اطلاع‌رسانی");
    // similar incidents come from retrieval with the agent's access (no model)
    expect(Array.isArray(await incidentAi().similar!(agent, inc, { limit: 5 }))).toBe(true);
    const prb = String((await w.o.post(`${P()}/r/problem`, { short_description: "قطعی‌های تکراری وی‌پی‌ان" })).row.id);
    FAKE_QUEUE.push(JSON.stringify({ whys: [{ question: "چرا قطع شد؟", answer: "گواهی منقضی شد" }], fishbone: { technology: ["گواهی"] }, hypotheses: [{ text: "گواهی", evidence: "یادداشت", confidence: "high" }], conclusion: "شاهد کافی نیست" }));
    const rca = await problemAi().draftRca!(await memberCtx(w.e.cfg, w.e.org, w.e.ownerId), prb);
    expect(rca.whys?.[0].answer).toBe("گواهی منقضی شد");
    expect(rca.hypotheses?.[0]).toMatchObject({ status: "open", confidence: "high" });
    // the request module no longer answers 501 for its AI features
    expect(typeof requestAi().generateItem).toBe("function");
    // the registered capabilities reach the screens
    const meta = (await w.p.agent.client.get(`${P()}/r/incident/${inc}`)).meta as { incident: { ai: string[] } };
    expect(meta.incident.ai).toEqual(expect.arrayContaining(["incident.summarize", "incident.suggestResolution", "incident.draftKnowledge", "incident.draftUpdate"]));
  });

  it("a skill reads only the published version's placeholders as data and answers in the member's language", async () => {
    const ctx = await memberCtx(w.e.cfg, w.e.org, w.p.agent.userId);
    clearFakeInbox();
    await runSkill(ctx, "text.translate", { text: "سلام، اتصال برقرار شد", params: { language: "en" } });
    const t = FAKE_INBOX.at(-1)!;
    expect(t.system).toContain("Write the answer in English.");
    expect(t.text).toContain('<data name="text">');
    clearFakeInbox();
    await runSkill(ctx, "text.improve", { text: "The VPN is down for the east branch since morning." });
    expect(FAKE_INBOX.at(-1)!.system).toContain("Write the answer in English."); // an English text is improved in English
  });
});
