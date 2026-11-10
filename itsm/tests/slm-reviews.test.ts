// Service level management — reviews and experience: the review pack built on «ساختن بستهٔ بازبینی», the narrative
// and CSI suggestions with their rule-based fallbacks (no AI provider in tests), review actions that become CSI items,
// the guard that keeps a review open while its proposed actions wait, live XLA scores of incidents (job and route),
// the at-risk timers of the caller's teams, and who may do what.
import { beforeAll, describe, expect, it } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import type { Client } from "./helpers";
import { tick } from "@server/jobs";
import { addDays } from "@shared/jalali";
import { improvementScore } from "@shared/slm/logic";

type Who = "slm" | "agent" | "req";
const ROLES: Record<Who, string[]> = { slm: ["service_level_manager"], agent: ["agent"], req: ["requester"] };

let e: EngineOrg;
let P = "";
let o: Client;
const p = {} as Record<Who, { client: Client; userId: string }>;
let svc: Record<string, any>;
let a: Record<string, any>;
let group = "";

const drain = async () => {
  for (let i = 0; i < 40; i++) {
    const r = await tick(e.cfg, { budgetMs: 30_000 });
    if (!r.ran && !r.more) break;
  }
};
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

beforeAll(async () => {
  e = await engineOrg();
  P = `/o/${e.org}`;
  o = e.owner;
  await o.post(`${P}/cmdb/seed`, {});
  await o.post(`${P}/service_portfolio/seed`, {});
  await o.post(`${P}/slm/seed`, {});
  for (const k of Object.keys(ROLES) as Who[]) p[k] = await e.member("member", `slmr-${k}@example.com`);
  for (const k of Object.keys(ROLES) as Who[]) await o.put(`${P}/access/members/${p[k].userId}`, { roles: ROLES[k], persona: k === "req" ? "requester" : "agent" });
  group = (await o.post(`${P}/r/group`, { name: "پشتیبانی ایمیل", types: ["assignment"] })).row.id;
  await o.post(`${P}/access/groups/${group}/members`, { user_ids: [p.agent.userId], kind: "member" });
  const unit = (await o.post(`${P}/r/org_unit`, { name: "واحد بازرگانی" })).row.id;
  svc = (await o.post(`${P}/r/service`, { name: "ایمیل", service_type: "business", description: "ایمیل", owner_id: p.slm.userId })).row;
  await o.post(`${P}/r/service/${svc.id}/transition`, { to: "approved" });
  a = (await o.post(`${P}/r/service_agreement`, { name: "توافق ایمیل بازرگانی", service_id: svc.id, customer_unit_id: unit, status: "active", valid_from: addDays(today(), -30), valid_to: addDays(today(), 300) })).row;
  // a one-hour timer on incidents: due within two hours, so «در خطر» at once
  await o.post(`${P}/r/sla_definition`, {
    name: "حل آزمایشی", table_key: "incident", type: "sla", target: "resolution", duration_mode: "fixed", duration: 3600,
    stop_condition: { f: "state", op: "in", v: ["resolved", "closed"] }, warn_percents: [],
  });
  await drain();
}, 240_000);

describe("a service review", () => {
  let review: Record<string, any>;
  let action = "";

  it("builds its pack on «ساختن بستهٔ بازبینی»", async () => {
    review = (await p.slm.client.post(`${P}/r/slm_review`, { title: "بازبینی فصلی ایمیل", agreement_id: a.id, period_from: addDays(today(), -30), period_to: today() })).row;
    expect(review.state).toBe("scheduled");
    expect(review.service_id).toBe(svc.id);
    const built = await p.slm.client.post(`${P}/slm/reviews/${review.id}/pack`, {});
    expect(built.pack.agreement.id).toBe(a.id);
    expect(built.pack.overall).toHaveProperty("status");
    expect((await o.get(`${P}/r/slm_review/${review.id}`)).row.state).toBe("prepared");
    const read = await p.agent.client.get(`${P}/slm/reviews/${review.id}/pack`);
    expect(read.stored).toBe(true);
    // agents read the pack but do not rebuild it; requesters see nothing of the module
    await p.agent.client.post(`${P}/slm/reviews/${review.id}/pack`, {}, 403);
    await p.req.client.get(`${P}/slm/reviews/${review.id}/pack`, 403);
  });

  it("writes the narrative from the pack's numbers (rule-based without AI) and saves it", async () => {
    const n = await p.slm.client.post(`${P}/slm/reviews/${review.id}/narrative`, { save: true });
    expect(n.ai).toBe(false);
    expect(n.text).toContain("وضعیت کلی");
    const row = (await o.get(`${P}/r/slm_review/${review.id}`)).row;
    expect(row.narrative).toBe(n.text);
    expect(row.narrative_ai).toBe(false);
    await p.agent.client.post(`${P}/slm/reviews/${review.id}/narrative`, { save: true }, 403);
  });

  it("suggests improvements and turns chosen actions into CSI items", async () => {
    const s = await p.slm.client.post(`${P}/slm/reviews/${review.id}/suggest`, {});
    expect(s.ai).toBe(false);
    expect(Array.isArray(s.items)).toBe(true);
    const r = await p.slm.client.post(`${P}/slm/reviews/${review.id}/actions`, { items: [{ title: "پایش صندوق‌های پر", description: "هشدار پیش از پر شدن", value: 4, effort: 2 }] });
    expect(r.created).toHaveLength(1);
    action = r.created[0];
    const item = (await o.get(`${P}/r/slm_improvement/${action}`)).row;
    expect(item).toMatchObject({ review_id: review.id, agreement_id: a.id, service_id: svc.id, source: "review", state: "proposed" });
    expect(Number(item.score)).toBe(improvementScore(4, 2));
    await p.agent.client.post(`${P}/slm/reviews/${review.id}/actions`, { items: [{ title: "اقدام کارشناس" }] }, 403);
  });

  it("stays open while its proposed actions wait, then closes and is not rebuilt", async () => {
    await p.slm.client.post(`${P}/r/slm_review/${review.id}/transition`, { to: "held", data: { minutes: "نشست برگزار شد" } });
    await p.slm.client.post(`${P}/r/slm_review/${review.id}/transition`, { to: "closed" }, 409);
    await p.slm.client.post(`${P}/r/slm_improvement/${action}/transition`, { to: "approved" });
    const closed = await p.slm.client.post(`${P}/r/slm_review/${review.id}/transition`, { to: "closed" });
    expect(closed.row.state).toBe("closed");
    await p.slm.client.post(`${P}/slm/reviews/${review.id}/pack`, {}, 409);
  });

  it("shows on the overview", async () => {
    const v = await p.slm.client.get(`${P}/slm/overview`);
    expect(v.agreements.in_force).toBeGreaterThanOrEqual(1);
    expect(v.improvements.open).toBeGreaterThanOrEqual(1);
    const meta = await p.req.client.get(`${P}/slm/meta`);
    expect(meta).toMatchObject({ reads: false, manages: false });
  });
});

describe("experience and timers at risk", () => {
  let inc: Record<string, any>;

  it("scores an incident's experience when it changes (job) and on request (route)", async () => {
    inc = (await o.post(`${P}/r/incident`, { short_description: "ایمیل ارسال نمی‌شود", impact: "2", urgency: "2", service_id: svc.id, caller_id: p.req.userId, assignment_group_id: group })).row;
    // the rescoring job waits 20 seconds for more changes: make it due now
    await drain();
    await e.db.query(`update sm_jobs set run_at = now() - interval '1 second' where org_id = $1 and kind = 'slm.xla' and status = 'queued'`, [e.org]);
    await drain();
    const first = await p.slm.client.get(`${P}/slm/records/incident/${inc.id}/xla`);
    expect(first.xla).not.toBeNull();
    expect(first.xla.score).toBeGreaterThanOrEqual(0);
    expect(first.xla.score).toBeLessThanOrEqual(100);
    expect(first.xla.policy).toBe("تجربهٔ رخدادها");
    expect(typeof first.xla.explanation).toBe("string");
    const again = await p.slm.client.post(`${P}/slm/records/incident/${inc.id}/xla`, {});
    expect(again.xla.score).toBe(first.xla.score);
    await p.req.client.get(`${P}/slm/records/incident/${inc.id}/xla`, 403);
  });

  it("lists the timers at risk in the caller's teams", async () => {
    const groups = await p.agent.client.get(`${P}/slm/at-risk?scope=groups`);
    const mine = groups.items.find((i: any) => i.record_id === inc.id);
    expect(mine).toBeTruthy();
    expect(mine).toMatchObject({ table: "incident", number: inc.number, name: "حل آزمایشی", breached: false });
    expect(["critical", "high", "medium", "low"]).toContain(mine.level);
    expect(typeof mine.reason).toBe("string");
    // not assigned to the agent: «کارهای من» leaves it out
    expect((await p.agent.client.get(`${P}/slm/at-risk?scope=mine`)).items.find((i: any) => i.record_id === inc.id)).toBeUndefined();
    await p.req.client.get(`${P}/slm/at-risk`, 403);
  });
});
