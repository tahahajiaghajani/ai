// Change enablement — the module's routes and background work: the risk panel and questionnaire, manual risk with a
// reason, copies for several dates, child changes, a change from another record, readiness / similar / impact /
// evidence / PIR draft, unauthorized-change detection, the CI timeline, suspects, the dashboard, and the sweep
// (window reminders, overruns, stale drafts, review auto-close), success scores, change-caused incident counts and the
// automatic suspension of a standard change that failed twice.
import { describe, expect, it, beforeAll } from "vitest";
import { changeAi, computeSuccessScores, countCausedIncidents, registerChangeAi, sweep } from "@server/modules/change";
import { at, world, HOUR, type World } from "./change-helpers";

let w: World;
let CI3 = ""; // a real CI: references to the CMDB are checked
const manual = (risk: string) => ({ risk, risk_source: "manual", risk_override_reason: "ارزیابی کارشناس" });
const soon = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

beforeAll(async () => {
  w = await world();
  CI3 = await w.ci("سرور وب");
}, 120_000);

/** A standard change from the catalogue, scheduled now and taken to implementation with its tasks done. */
async function implementedStandard(name: string, extra: Record<string, unknown> = {}) {
  const { P, p } = w;
  const item = (await p.agent.client.get(`${P}/change/catalog`)).items.find((x: any) => x.name.includes(name));
  const r = await p.agent.client.post(`${P}/change/catalog/${item.id}/order`, { planned_start: soon(10), planned_end: soon(40), assignment_group_id: w.g.network, submit: true, ...extra });
  expect(r.warning).toBeNull();
  await w.move(r.change.id, ["implement"]);
  const tasks = (await p.agent.client.post(`${P}/r/change_task/query`, { filter: { f: "change_id", op: "eq", v: r.change.id }, sort: "sort_order" })).rows;
  for (const t of tasks) await p.agent.client.post(`${P}/r/change_task/${t.id}/transition`, { to: "closed_complete" });
  return { change: r.change, template: item };
}

describe("risk", () => {
  it("serves the questionnaire and recalculates the risk from the answers", async () => {
    const { P, p } = w;
    const c = await w.change();
    const v = await p.agent.client.get(`${P}/change/records/${c.id}/risk`);
    expect(v.questions.length).toBe(7);
    expect(v.result.questionnaire.score).toBeNull();
    const answers = Object.fromEntries(v.questions.map((q: any) => [q.id, q.kind === "number" ? 200 : q.options[q.options.length - 1].value]));
    const after = await p.agent.client.put(`${P}/change/records/${c.id}/risk`, { answers, version: c.version });
    expect(after.result.questionnaire.answered).toBe(7);
    expect(after.risk).toBe(after.result.level);
    expect(after.result.score).toBeGreaterThan(v.result.score);
    const row = await w.get(c.id);
    expect(row.risk_score).toBe(after.result.score);
    expect(row.risk_explanation).toContain("پرسش‌نامه");
    const explain = await p.agent.client.post(`${P}/change/records/${c.id}/risk/explain`, {});
    expect(explain.ai).toBe(false);
  });

  it("a manual risk needs its reason", async () => {
    const { P, p } = w;
    const c = await w.change();
    const e = await p.agent.client.patch(`${P}/r/change_request/${c.id}`, { risk: "very_high", version: c.version }, 400);
    expect(e.error.details.fields.risk_override_reason).toBeTruthy();
    const ok = (await p.agent.client.patch(`${P}/r/change_request/${c.id}`, { risk: "very_high", risk_override_reason: "سامانهٔ پرداخت", version: c.version })).row;
    expect(ok.risk_source).toBe("manual");
    expect(ok.risk).toBe("very_high");
    expect(ok.cab_required).toBe(true);
  });
});

describe("copies, children, origins", () => {
  it("copies a change with its tasks for several dates, and makes child changes", async () => {
    const { P, p } = w;
    const c = await w.change();
    await p.agent.client.post(`${P}/r/change_task`, { change_id: c.id, short_description: "پشتیبان‌گیری", sort_order: 10 });
    const copies = await p.agent.client.post(`${P}/change/records/${c.id}/copy`, { dates: [{ start: at(50, 8), end: at(50, 9) }, { start: at(57, 8), end: at(57, 9) }] });
    expect(copies.changes.length).toBe(2);
    const second = await w.get(copies.changes[1].id);
    expect(second.planned_start).toBe(at(57, 8));
    expect(second.state).toBe("new");
    const tasks = (await p.agent.client.post(`${P}/r/change_task/query`, { filter: { f: "change_id", op: "eq", v: second.id } })).rows;
    expect(tasks.length).toBe(1);
    const kids = await p.agent.client.post(`${P}/change/records/${c.id}/children`, { titles: ["شعبهٔ مرکزی", "شعبهٔ شمال"] });
    expect(kids.changes.length).toBe(2);
    expect((await w.get(kids.changes[0].id)).parent_id).toBe(c.id);
  });

  it("a change from another record is linked «آغازشده از»", async () => {
    const { P, p } = w;
    const todo = (await p.agent.client.post(`${P}/r/todo`, { short_description: "به‌روزرسانی نرم‌افزار حسابداری", description: "نسخهٔ تازه منتشر شده است" })).row;
    const r = await p.agent.client.post(`${P}/change/from/todo/${todo.id}`, {});
    expect(r.row.origin_table).toBe("todo");
    expect(r.row.description).toContain(String(todo.number));
    const links = (await p.agent.client.get(`${P}/r/change_request/${r.row.id}/links`)).links;
    expect(links.some((l: any) => l.kind === "initiated_by" && l.other.id === todo.id)).toBe(true);
    await p.agent.client.post(`${P}/change/from/user/${p.agent.userId}`, {}, 400);
  });
});

describe("insights", () => {
  it("readiness, similar changes, impact, evidence and the PIR draft", async () => {
    const { P, p } = w;
    const a = await w.change({ ...manual("low"), type: "latent", affected_cis: [CI3], actual_start: at(-3), actual_end: at(-3, 10) });
    await w.move(a.id, ["review"], p.agent.client, { close_code: "successful" });
    const b = await w.change({ affected_cis: [CI3] });
    const ready = await p.agent.client.get(`${P}/change/records/${b.id}/readiness`);
    expect(ready.checks.length).toBe(10);
    expect(ready.unanswered).toBe(7);
    const similar = await p.agent.client.get(`${P}/change/records/${b.id}/similar`);
    expect(similar.items.map((x: any) => x.id)).toContain(a.id);
    const impact = await p.agent.client.get(`${P}/change/records/${b.id}/impact`);
    expect(impact.cis).toEqual([CI3]);
    expect(impact.provider).toBe(true); // the CMDB is the impact provider (tests/integration-cmdb.test.ts)
    expect(impact.impacted).toEqual([]); // a CI nothing depends on reaches no service
    const evidence = await p.agent.client.get(`${P}/change/records/${a.id}/evidence`);
    expect(evidence.markdown).toContain("پروندهٔ شواهد");
    const draft = await p.agent.client.get(`${P}/change/records/${a.id}/pir-draft`);
    expect(draft.sections.timeline_md).toContain("اجرای واقعی");
    expect(draft.sections.went_well).toContain("موفق");
  });

  it("detects configuration changes without an authorized change, lists a CI's changes and suspects", async () => {
    const { P, p } = w;
    const CI4 = await w.ci("سرور فایل");
    const lone = await p.agent.client.post(`${P}/change/detected`, { ci_id: CI4, summary: "تغییر پیکربندی سرور بدون درخواست" });
    expect(lone.authorized).toBe(false);
    expect(lone.change.type).toBe("latent");
    expect(lone.change.discovered_by).toBe("drift");
    const { change } = await implementedStandard("دیسک", { affected_cis: [CI4] });
    const covered = await p.agent.client.post(`${P}/change/detected`, { ci_id: CI4, summary: "افزایش دیسک" });
    expect(covered.authorized).toBe(true);
    expect(covered.changes.map((c: any) => c.id)).toContain(change.id);
    const timeline = await p.agent.client.get(`${P}/change/ci/${CI4}/timeline`);
    expect(timeline.items.map((c: any) => c.id)).toEqual(expect.arrayContaining([change.id, lone.change.id]));
    const suspects = await p.agent.client.get(`${P}/change/suspects?ci=${CI4}`);
    expect(suspects.items[0].id).toBe(change.id);
    expect(suspects.items[0].why).toContain("همان پیکربندی");
  });

  it("the dashboard counts what the person may read", async () => {
    const d = await w.p.agent.client.get(`${w.P}/change/dashboard?days=30`);
    expect(d.kpis.total).toBeGreaterThan(0);
    expect(d.risk_bands.map((b: any) => b.risk)).toEqual(["low", "moderate", "high", "very_high"]);
    expect(Array.isArray(d.trend)).toBe(true);
  });
});

describe("background work", () => {
  it("reminds before a scheduled window and alerts an overrun, once", async () => {
    const { P, p } = w;
    const item = (await p.agent.client.get(`${P}/change/catalog`)).items.find((x: any) => x.name.includes("DNS"));
    const r = await p.agent.client.post(`${P}/change/catalog/${item.id}/order`, { planned_start: soon(30), planned_end: soon(50), assignment_group_id: w.g.network, submit: true });
    const first = await sweep(w.sys, Number.POSITIVE_INFINITY);
    expect(first.reminded).toBeGreaterThanOrEqual(1);
    expect((await w.get(r.change.id)).window_alerted_at).toBeTruthy();
    expect((await sweep(w.sys)).reminded).toBe(0);
    await w.move(r.change.id, ["implement"]);
    const later = await sweep(w.sys, Number.POSITIVE_INFINITY, Date.now() + 2 * HOUR);
    expect(later.overruns).toBeGreaterThanOrEqual(1);
    expect((await w.get(r.change.id)).overrun_alerted_at).toBeTruthy();
    expect((await sweep(w.sys, Number.POSITIVE_INFINITY, Date.now() + 2 * HOUR)).overruns).toBe(0);
  });

  it("cancels stale drafts and closes reviews when the settings ask for it", async () => {
    const { P, o, p } = w;
    const cfg = (await o.get(`${P}/r/change_config?size=1`)).rows[0];
    await o.patch(`${P}/r/change_config/${cfg.id}`, { stale_draft_days: 1, review_auto_close_days: 1, version: cfg.version });
    const draft = await w.change();
    const latent = await w.change({ ...manual("low"), type: "latent", actual_start: at(-2), actual_end: at(-2, 10) });
    await w.move(latent.id, ["review"], p.agent.client, { close_code: "successful" });
    // three days later (the sync trigger stamps updated_at, so the clock moves instead of the rows)
    const r = await sweep(w.sys, Number.POSITIVE_INFINITY, Date.now() + 3 * 24 * HOUR);
    expect(r.canceled).toBeGreaterThanOrEqual(1);
    expect(r.closed).toBeGreaterThanOrEqual(1);
    const d = await w.get(draft.id);
    expect(d.state).toBe("canceled");
    expect(d.close_code).toBe("auto_canceled");
    expect((await w.get(latent.id)).state).toBe("closed");
    const after = (await o.get(`${P}/r/change_config/${cfg.id}`)).row;
    await o.patch(`${P}/r/change_config/${cfg.id}`, { stale_draft_days: 0, review_auto_close_days: 0, version: after.version });
  });

  it("counts change-caused incidents and scores the teams", async () => {
    const { P, p } = w;
    const c = await w.change({ ...manual("low"), type: "latent", actual_start: at(-1), actual_end: at(-1, 10) });
    await w.move(c.id, ["review"], p.agent.client, { close_code: "successful_issues" });
    const incident = (await p.agent.client.post(`${P}/r/incident`, { short_description: "خطای پس از تغییر", assignment_group_id: w.g.network })).row;
    await p.agent.client.post(`${P}/r/incident/${incident.id}/links`, { kind: "caused_by", table: "change_request", id: c.id });
    // with incident management installed only incidents count, not other records linked «ناشی از» the change
    const todo = (await p.agent.client.post(`${P}/r/todo`, { short_description: "کار پس از تغییر" })).row;
    await p.agent.client.post(`${P}/r/todo/${todo.id}/links`, { kind: "caused_by", table: "change_request", id: c.id });
    expect(await countCausedIncidents(w.sys)).toBeGreaterThanOrEqual(1);
    expect((await w.get(c.id)).incidents_caused).toBe(1);
    expect(await computeSuccessScores(w.sys)).toBeGreaterThanOrEqual(1);
    const scores = (await w.o.get(`${P}/r/change_success_score?size=20`)).rows;
    const mine = scores.find((s: any) => s.group_id === w.g.network);
    expect(mine.implemented).toBeGreaterThanOrEqual(1);
    expect(mine.caused_incidents).toBeGreaterThanOrEqual(1);
    expect(typeof mine.score).toBe("number");
  });

  it("a standard change that fails twice suspends its template", async () => {
    const { P, o, p } = w;
    let template: Record<string, any> | null = null;
    for (let i = 0; i < 2; i++) {
      const { change, template: t } = await implementedStandard("گواهی");
      template = t;
      const review = await w.move(change.id, ["review"], p.agent.client, { close_code: "unsuccessful" });
      expect(review.pir_id).toBeTruthy();
      await o.post(`${P}/r/change_pir/${review.pir_id}/transition`, { to: "completed", data: { objectives_met: "no", lessons: "گواهی زنجیره‌ای نصب نشد" } });
      await w.move(change.id, ["closed"], p.agent.client, { close_notes: "ناموفق" });
    }
    const t = (await o.get(`${P}/r/change_template/${template!.id}`)).row;
    expect(t.failure_count).toBe(2);
    expect(t.state).toBe("suspended");
    const catalogue = (await p.agent.client.get(`${P}/change/catalog`)).items.map((x: any) => x.id);
    expect(catalogue).not.toContain(template!.id);
  });
});

describe("AI extension points", () => {
  it("answers 409 without the AI layer and serves a registered skill to whoever may read the change", async () => {
    const { P, p } = w;
    const c = await w.change();
    // the AI skills register an implementation when the app is created: set it aside for this test, restore it after
    const layer = changeAi();
    registerChangeAi({});
    const none = await p.agent.client.post(`${P}/change/records/${c.id}/ai/summarize`, {}, 409);
    expect(none.error.code).toBe("ai_unavailable");
    const off = registerChangeAi({ summarize: async (_ctx, id) => ({ text: `خلاصهٔ ${id}` }), similar: async () => [] });
    try {
      const r = await p.agent.client.post(`${P}/change/records/${c.id}/ai/summarize`, {});
      expect(r.text).toBe(`خلاصهٔ ${c.id}`);
      expect((await p.agent.client.get(`${P}/r/change_request/${c.id}`)).meta.change.ai).toEqual(expect.arrayContaining(["change.summarize", "change.similar"]));
      await p.req.client.post(`${P}/change/records/${c.id}/ai/summarize`, {}, 404);
      await p.agent.client.post(`${P}/change/records/${c.id}/ai/draftPlans`, {}, 409);
    } finally {
      off();
      registerChangeAi(layer);
    }
  });
});
