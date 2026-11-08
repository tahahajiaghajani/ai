// Incident, problem, change and service requests in one organisation (each module's own tests run it alone): seeds
// in the order of the modules; «ثبت تغییر» from an incident, a problem, a known error and a requested item (a
// confidential incident's change stays confidential); the suspect changes of a real incident (its CIs, services and
// the time it began); the incidents counted on the change that caused them and the PIR draft; the catalogue's
// «گزارش مشکل» and «تبدیل به رخداد» making real incidents (channels the incident does not know fall back to its
// default; the order of a converted item closes with it).
import { describe, expect, it, beforeAll } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import type { Client } from "./helpers";
import { tick } from "@server/jobs";
import { systemCtx } from "@server/engine";
import type { Ctx } from "@server/context";
import { countCausedIncidents } from "@server/modules/change";
import { resetSweepThrottle } from "@server/modules/request";
import { PLANS } from "./change-helpers";

type Who = { client: Client; userId: string };
const HOUR = 3_600_000;
const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();
// real CIs and a service: references to the CMDB and the portfolio are checked
let CI = "";
let CI_OTHER = "";
let CI_ELSEWHERE = "";
let SERVICE = "";

let e: EngineOrg;
let P = "";
let o: Client;
let sys: Ctx;
let agent: Who; // incident + change work in «پشتیبانی شبکه» and «میز خدمت»
let fulfiller: Who; // fulfils requested items in «پشتیبانی کاربران»
let secAgent: Who; // «امنیت اطلاعات»
let outsider: Who; // an agent of another group (need-to-know does not apply: the open preset)
let requester: Who;
const g: Record<"desk" | "security" | "network" | "desktop", string> = { desk: "", security: "", network: "", desktop: "" };

async function drain() {
  for (let i = 0; i < 50; i++) {
    const r = await tick(e.cfg, { budgetMs: 20_000 });
    if (!r.more && r.ran + r.failed === 0) return;
  }
}

const groupId = async (name: string) => (await e.db.one<{ id: string }>(`select id from sm_groups where org_id = $1 and name = $2 and deleted_at is null`, [e.org, name]))!.id;
const row = async (table: string, id: string) => (await e.db.query<Record<string, any>>(`select * from ${table} where org_id = $1 and id = $2`, [e.org, id]))[0];
const linksOf = async (who: Client, table: string, id: string) => (await who.get(`${P}/r/${table}/${id}/links`)).links as Record<string, any>[];

/** A change implemented between `from` and `to` hours ago (a retrospective change, reviewed). */
async function implemented(data: Record<string, unknown>, from = 3, to = 2) {
  const c = (await agent.client.post(`${P}/r/change_request`, {
    short_description: "تغییر اجراشده", type: "latent", risk: "low", risk_source: "manual", risk_override_reason: "ارزیابی کارشناس",
    assignment_group_id: g.network, actual_start: ago(from), actual_end: ago(to), ...PLANS, ...data,
  })).row;
  let r = c;
  r = (await agent.client.post(`${P}/r/change_request/${c.id}/transition`, { to: "review", data: { close_code: "successful_issues" }, version: r.version })).row;
  expect(r.state).toBe("review");
  return r;
}

beforeAll(async () => {
  resetSweepThrottle();
  e = await engineOrg();
  P = `/o/${e.org}`;
  o = e.owner;
  // the modules' seeds in the order of routes/modules.ts (incident and problem, the CMDB and the portfolio, then
  // change, then requests)
  await o.post(`${P}/incident/seed`, {});
  await o.post(`${P}/cmdb/seed`, {});
  await o.post(`${P}/service_portfolio/seed`, {});
  await o.post(`${P}/change/seed`, {});
  await o.post(`${P}/request/seed`, {});
  const ci = async (name: string, cls: string) => (await o.post(`${P}/r/ci`, { name, class: cls, state: "operational" })).row.id as string;
  CI = await ci("سوئیچ هسته", "network_device");
  CI_OTHER = await ci("سرور پرداخت", "server");
  CI_ELSEWHERE = await ci("سرور بایگانی", "server");
  const svc = (await o.post(`${P}/r/service`, { name: "پرداخت الکترونیک", service_type: "business", description: "پرداخت", owner_id: e.ownerId })).row;
  await o.post(`${P}/r/service/${svc.id}/transition`, { to: "approved" });
  const off = (await o.post(`${P}/r/service_offering`, { name: "استاندارد", service_id: svc.id })).row;
  await o.post(`${P}/r/service_offering/${off.id}/transition`, { to: "active" });
  await o.post(`${P}/r/service/${svc.id}/transition`, { to: "live" });
  SERVICE = svc.id;
  g.desk = await groupId("میز خدمت");
  g.security = await groupId("امنیت اطلاعات");
  g.desktop = await groupId("پشتیبانی کاربران");
  g.network = (await o.post(`${P}/r/group`, { name: "پشتیبانی شبکه", types: ["assignment"] })).row.id;
  const person = async (email: string, roles: string[], groups: string[]) => {
    const who = await e.member("member", email);
    await o.put(`${P}/access/members/${who.userId}`, { roles, persona: roles.includes("requester") ? "requester" : "agent" });
    for (const gid of groups) await o.post(`${P}/access/groups/${gid}/members`, { user_ids: [who.userId] });
    return who;
  };
  agent = await person("int-agent@example.com", ["agent"], [g.network, g.desk]);
  fulfiller = await person("int-fulfiller@example.com", ["agent"], [g.desktop]);
  secAgent = await person("int-security@example.com", ["agent"], [g.security]);
  outsider = await person("int-outsider@example.com", ["agent"], []);
  requester = await person("int-requester@example.com", ["requester"], []);
  sys = await systemCtx(e.cfg, e.org);
  await drain();
}, 180_000);

describe("change ↔ incident and problem", () => {
  it("«ثبت تغییر» on an incident copies its context and links the two both ways", async () => {
    const inc = (await agent.client.post(`${P}/r/incident`, { short_description: "کندی شدید شبکهٔ شعبه", description: "از صبح", ci_id: CI, service_id: SERVICE, assignment_group_id: g.network })).row;
    const r = await agent.client.post(`${P}/change/from/incident/${inc.id}`, {});
    expect(r.row).toMatchObject({ origin_table: "incident", origin_id: inc.id, ci_id: CI, service_id: SERVICE, assignment_group_id: g.network, confidential: false });
    expect(r.row.description).toContain(String(inc.number));
    expect((await linksOf(agent.client, "change_request", r.row.id)).some((l) => l.kind === "initiated_by" && l.other.table === "incident" && l.other.id === inc.id)).toBe(true);
    // the incident shows the change it started
    const back = await linksOf(agent.client, "incident", inc.id);
    expect(back.some((l) => l.kind === "initiated_by" && l.direction === "in" && l.other.id === r.row.id)).toBe(true);
    // a requester may not start changes
    const own = (await requester.client.post(`${P}/r/incident`, { short_description: "چاپگر کار نمی‌کند" })).row;
    await requester.client.post(`${P}/change/from/incident/${own.id}`, {}, 403);
  });

  it("from a problem and a known error: «آغازشده از» and «رفع می‌کند»", async () => {
    const prb = (await agent.client.post(`${P}/r/problem`, { short_description: "قطعی‌های تکراری سوئیچ هسته", ci_id: CI, assignment_group_id: g.network })).row;
    const fromProblem = (await agent.client.post(`${P}/change/from/problem/${prb.id}`, {})).row;
    expect(fromProblem).toMatchObject({ origin_table: "problem", ci_id: CI });
    const kinds = (await linksOf(agent.client, "change_request", fromProblem.id)).filter((l) => l.other.id === prb.id).map((l) => l.kind).sort();
    expect(kinds).toEqual(["fixes", "initiated_by"]);
    const ke = (await agent.client.post(`${P}/r/known_error`, { short_description: "خطای حافظهٔ سوئیچ هسته", problem_id: prb.id, ci_id: CI, assignment_group_id: g.network })).row;
    const fromKe = (await agent.client.post(`${P}/change/from/known_error/${ke.id}`, {})).row;
    expect(fromKe.origin_table).toBe("known_error");
    expect((await linksOf(agent.client, "known_error", ke.id)).some((l) => l.kind === "fixes" && l.direction === "in" && l.other.id === fromKe.id)).toBe(true);
  });

  it("a change from a confidential (security) incident stays confidential", async () => {
    const inc = (await secAgent.client.post(`${P}/r/incident`, { short_description: "دسترسی مشکوک به سرور حقوق", description: "نشانی‌های ناشناس", security_incident: true, ci_id: CI })).row;
    const stored = await row("sm_incidents", inc.id);
    expect(stored.confidential).toBe(true);
    const change = (await secAgent.client.post(`${P}/change/from/incident/${inc.id}`, {})).row;
    expect(change.confidential).toBe(true);
    expect(change.short_description).toContain("دسترسی مشکوک");
    // an agent who may not read the incident may not read the change made from it
    await outsider.client.get(`${P}/r/incident/${inc.id}`, 404);
    await outsider.client.get(`${P}/r/change_request/${change.id}`, 404);
    expect((await secAgent.client.get(`${P}/r/change_request/${change.id}`)).row.id).toBe(change.id);
  });

  it("suspects of a real incident: changes on its CIs and services that ended before it began", async () => {
    const onCi = await implemented({ ci_id: CI_OTHER, affected_cis: [CI_OTHER], short_description: "به‌روزرسانی سفت‌افزار" }, 3, 2);
    const onService = await implemented({ affected_services: [SERVICE], short_description: "جابه‌جایی پایگاه داده" }, 5, 4);
    const elsewhere = await implemented({ ci_id: CI_ELSEWHERE, short_description: "تغییر نامرتبط" }, 3, 2);
    // the incident's main CI is another one; the suspect's CI is among those it affects
    const inc = (await agent.client.post(`${P}/r/incident`, { short_description: "خطای پرداخت", ci_id: CI, affected_cis: [CI_OTHER], service_id: SERVICE, assignment_group_id: g.network })).row;
    const s = await agent.client.get(`${P}/change/suspects?incident=${inc.id}`);
    const ids = s.items.map((x: any) => x.id);
    expect(ids).toEqual(expect.arrayContaining([onCi.id, onService.id]));
    expect(ids).not.toContain(elsewhere.id);
    expect(ids.indexOf(onCi.id)).toBeLessThan(ids.indexOf(onService.id));
    expect(s.items.find((x: any) => x.id === onCi.id).why).toContain("همان پیکربندی");
    expect(s.items.find((x: any) => x.id === onService.id).why).toContain("همان خدمت");
    // back-dated: the incident began before that change started, so it is not a suspect
    const early = (await agent.client.post(`${P}/r/incident`, { short_description: "خطای پرداخت از دیشب", affected_cis: [CI_OTHER], detected_at: ago(3.5), assignment_group_id: g.network })).row;
    const before = await agent.client.get(`${P}/change/suspects?incident=${early.id}`);
    expect(before.items.map((x: any) => x.id)).not.toContain(onCi.id);
    expect(Math.abs(Date.parse(before.window.to) - Date.parse(early.detected_at))).toBeLessThan(1000);
    // only people who read changes ask
    await requester.client.get(`${P}/change/suspects?incident=${inc.id}`, 403);
  });

  it("counts the incidents linked «ناشی از» a change (not other records) and drafts the PIR from them", async () => {
    const c = await implemented({ ci_id: CI, short_description: "ارتقای سوئیچ هسته" }, 6, 5);
    const inc = (await agent.client.post(`${P}/r/incident`, { short_description: "قطعی پس از ارتقا", ci_id: CI, assignment_group_id: g.network })).row;
    await agent.client.post(`${P}/r/incident/${inc.id}/links`, { kind: "caused_by", table: "change_request", id: c.id });
    const prb = (await agent.client.post(`${P}/r/problem`, { short_description: "ناپایداری پس از ارتقا", assignment_group_id: g.network })).row;
    await agent.client.post(`${P}/r/problem/${prb.id}/links`, { kind: "caused_by", table: "change_request", id: c.id });
    // at once: the link events (record.linked) count it, the sweep is only a safety net
    await drain();
    expect((await row("sm_change_requests", c.id)).incidents_caused).toBe(1);
    expect(await countCausedIncidents(sys)).toBe(0);
    expect((await row("sm_change_requests", c.id)).incidents_caused).toBe(1);
    // once more: nothing to update
    await countCausedIncidents(sys);
    expect((await row("sm_change_requests", c.id)).incidents_caused).toBe(1);
    const draft = await agent.client.get(`${P}/change/records/${c.id}/pir-draft`);
    expect(draft.sections.side_effects).toContain(String(inc.number));
    expect(draft.sections.went_wrong).toContain("1 رخداد");
    // the link removed: the count follows
    const link = (await linksOf(agent.client, "incident", inc.id)).find((l) => l.kind === "caused_by")!;
    await agent.client.del(`${P}/r/incident/${inc.id}/links/${link.id}`);
    await drain();
    expect((await row("sm_change_requests", c.id)).incidents_caused).toBe(0);
  });
});

describe("request ↔ incident and change", () => {
  it("the seeded «گزارش مشکل» makes a real incident with the requester's own access", async () => {
    const item = (await e.db.query<Record<string, any>>(`select * from sm_catalog_items where org_id = $1 and code = 'report_issue'`, [e.org]))[0];
    expect(item.target_table).toBe("incident");
    // ordered through the assistant: a channel incidents do not have
    const r = await requester.client.post(`${P}/request/order`, { lines: [{ item_id: item.id, answers: { subject: "چاپگر طبقهٔ سوم کار نمی‌کند", details: "کاغذ گیر می‌کند", urgency: "2" } }], channel: "assistant" });
    expect(r.request).toBeNull();
    expect(r.produced.table).toBe("incident");
    const inc = await row("sm_incidents", r.produced.id);
    expect(inc).toMatchObject({ short_description: "چاپگر طبقهٔ سوم کار نمی‌کند", description: "کاغذ گیر می‌کند", urgency: "2", caller_id: requester.userId, channel: "portal", state: "new" });
    expect(inc.number).toBe(r.produced.number);
    expect((await requester.client.get(`${P}/r/incident/${inc.id}`)).row.id).toBe(inc.id);
    await drain();
    // the incident module's rules ran on it (assignment to the service desk)
    expect((await row("sm_incidents", inc.id)).assignment_group_id).toBe(g.desk);
  });

  it("«تبدیل به رخداد» makes an incident for the requester, links it and closes the item as converted", async () => {
    const item = (await e.db.query<Record<string, any>>(`select * from sm_catalog_items where org_id = $1 and code = 'other_request'`, [e.org]))[0];
    const order = await requester.client.post(`${P}/request/order`, { lines: [{ item_id: item.id, answers: { subject: "اینترنت قطع است", details: "از ساعت ده" } }], channel: "assistant" });
    const ritmId = order.items[0].id as string;
    await drain();
    expect((await row("sm_request_items", ritmId)).assignment_group_id).toBe(g.desktop);
    // a requester does not convert
    await requester.client.post(`${P}/request/items/${ritmId}/convert`, {}, 403);
    const made = await fulfiller.client.post(`${P}/request/items/${ritmId}/convert`, { note: "قطعی است، نه درخواست" });
    expect(made.table).toBe("incident");
    const inc = await row("sm_incidents", made.id);
    expect(inc).toMatchObject({ short_description: "اینترنت قطع است", caller_id: requester.userId, channel: "portal" });
    expect(inc.description).toContain("قطعی است، نه درخواست");
    const ritm = await row("sm_request_items", ritmId);
    expect(ritm).toMatchObject({ state: "cancelled", close_code: "converted" });
    // it was the order's only item: the order closes with its note
    const header = await row("sm_requests", order.request.id);
    expect(header.state).toBe("cancelled");
    expect(header.close_notes).toContain(String(inc.number));
    await drain();
    const links = await linksOf(fulfiller.client, "request_item", ritmId);
    expect(links.some((l) => l.kind === "related" && l.other.table === "incident" && l.other.id === made.id)).toBe(true);
    // the requester follows the incident
    expect((await requester.client.get(`${P}/r/incident/${made.id}`)).row.id).toBe(made.id);
  });

  it("«ثبت تغییر» on a requested item", async () => {
    const item = (await e.db.query<Record<string, any>>(`select * from sm_catalog_items where org_id = $1 and code = 'other_request'`, [e.org]))[0];
    const order = await requester.client.post(`${P}/request/order`, { lines: [{ item_id: item.id, answers: { subject: "قانون تازهٔ دیوارهٔ آتش", details: "دسترسی به سامانهٔ تازه" } }] });
    const ritmId = order.items[0].id as string;
    await drain();
    const change = (await fulfiller.client.post(`${P}/change/from/request_item/${ritmId}`, {})).row;
    expect(change).toMatchObject({ origin_table: "request_item", origin_id: ritmId, assignment_group_id: g.desktop });
    expect((await linksOf(fulfiller.client, "request_item", ritmId)).some((l) => l.kind === "initiated_by" && l.direction === "in" && l.other.id === change.id)).toBe(true);
  });
});
