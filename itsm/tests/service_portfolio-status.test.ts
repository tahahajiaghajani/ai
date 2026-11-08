// The service portfolio at work: live status from failing CIs, incidents and the owner's override (with the history the
// status page draws, the journal and subscribers told), the status page as a projection for everyone and by public key
// without signing in, self-service subscriptions and «my services», scores and the owner's scorecard, reports,
// rationalization overlaps, catalogue health, technology risk findings, the picker and affected services from CIs, and
// access: the service owner reads the records linked to their service (roles in context), a requester sees the page but
// not the records, an auditor reads but cannot manage.
import { beforeAll, describe, expect, it } from "vitest";
import { Client } from "./helpers";
import { cmdbWorld, type CmdbWorld } from "./cmdb-helpers";
import { approverSources } from "@server/modules/sla/approvals";

let w: CmdbWorld;
let S: Record<string, any>; // the live service
let host: Record<string, any>; // a server its application runs on
let owner2: { client: Client; userId: string };
let nobody: { client: Client; userId: string };
const R = (t: string, id?: string) => `${w.P}/r/${t}${id ? `/${id}` : ""}`;
const SP = (p: string) => `${w.P}/service_portfolio${p}`;
const tr = (t: string, id: string, to: string, data: Record<string, unknown> = {}, expect = 200) => w.o.post(`${R(t, id)}/transition`, { to, data }, expect);
const service = async (id: string) => (await w.o.get(R("service", id))).row;

async function liveService(name: string, extra: Record<string, unknown> = {}) {
  const s = (await w.o.post(R("service"), { name, service_type: "business", description: `شرح ${name}`, owner_id: w.p.so.userId, ...extra })).row;
  await tr("service", s.id, "approved");
  const o = (await w.o.post(R("service_offering"), { name: "استاندارد", service_id: s.id })).row;
  await tr("service_offering", o.id, "active");
  await tr("service", s.id, "live");
  return { ...(await service(s.id)), offering_id: o.id };
}

beforeAll(async () => {
  w = await cmdbWorld();
  await w.o.post(SP("/seed"), {});
  // a member who owns a service and reads only their own incidents (no global role over incidents)
  await w.o.put(`${w.P}/access/roles/svc_owner_only`, {
    name: "مالک خدمت بدون دسترسی رخداد", description: "", persona: "agent",
    grants: { service: { read: "own", write: "own", delete: "none", create: false, approve: false, admin: false }, incident: { read: "own", write: "own", delete: "none", create: true, approve: false, admin: false } },
    field_groups: [], contains: [], workspaces: "member", domains: "own", active: true,
  });
  owner2 = await w.e.member("member", "owner2@example.com");
  await w.o.put(`${w.P}/access/members/${owner2.userId}`, { roles: ["svc_owner_only"], persona: "agent" });
  // a member whose role grants nothing in the portfolio
  await w.o.put(`${w.P}/access/roles/no_portfolio`, { name: "بدون سبد خدمات", description: "", persona: "agent", grants: { cmdb: { read: "all", write: "none", delete: "none", create: false, approve: false, admin: false } }, field_groups: [], contains: [], workspaces: "member", domains: "own", active: true });
  nobody = await w.e.member("member", "nobody@example.com");
  await w.o.put(`${w.P}/access/members/${nobody.userId}`, { roles: ["no_portfolio"], persona: "agent" });
  S = await liveService("ایمیل سازمانی", { on_status_page: true, availability_target: "99.5", tier: "tier_1", tags: ["ایمیل", "پیام"] });
  // the service's CI → application → server
  const app = await w.ci({ name: "نرم‌افزار ایمیل", class: "application", support_group_id: w.g.infra });
  host = await w.ci({ name: "mail-01", class: "server", support_group_id: w.g.infra, serial_number: "MAIL-01", os: "Windows Server", os_version: "2012 R2" });
  await w.rel(S.ci_id, "depends_on", app.id);
  await w.rel(app.id, "runs_on", host.id);
  await w.drain();
}, 120_000);

describe("live status", () => {
  it("goes to «قطعی بخشی» when a CI it depends on is down, and back when it recovers", async () => {
    await w.o.patch(R("ci", host.id), { operational_status: "non_operational" });
    await w.drain();
    const down = await service(S.id);
    expect(down.status).toBe("partial_outage");
    expect(down.status_reason).toContain("پیکربندی");
    expect(down.status_since).toBeTruthy();
    await w.o.patch(R("ci", host.id), { operational_status: "operational" });
    await w.drain();
    expect((await service(S.id)).status).toBe("operational");
    const hist = await w.o.get(`${R("service", S.id)}/history`);
    expect(hist.entries.filter((e: any) => e.field === "status").map((e: any) => e.new)).toEqual(expect.arrayContaining(["partial_outage", "operational"]));
  });

  it("follows incidents on the service by priority, and the owner's override wins", async () => {
    const p2 = (await w.o.post(R("incident"), { short_description: "کندی ایمیل", impact: "1", urgency: "2", service_id: S.id })).row;
    expect(p2.priority).toBe("2");
    await w.drain();
    expect((await service(S.id)).status).toBe("degraded");
    const p1 = (await w.o.post(R("incident"), { short_description: "ایمیل قطع است", impact: "1", urgency: "1", affected_services: [S.id] })).row;
    await w.drain();
    expect((await service(S.id))).toMatchObject({ status: "partial_outage", status_reason: "1 رخداد اولویت ۱" });
    await w.o.patch(R("service", S.id), { status_override: "maintenance", status_note: "ارتقای سرور ایمیل تا ساعت ۲۲" });
    await w.drain();
    expect((await service(S.id))).toMatchObject({ status: "maintenance", status_reason: "تعیین‌شده به دست مالک" });
    await w.o.patch(R("service", S.id), { status_override: "auto" });
    for (const i of [p1, p2]) await tr("incident", i.id, "canceled", { close_notes: "آزمایش" }, 200).catch(() => undefined);
    await w.o.post(SP("/status/refresh"), {});
  });

  it("tells subscribers of an outage on their subscription", async () => {
    await w.o.post(R("service_subscription"), { service_id: S.id, subscriber_kind: "user", user_id: w.p.req.userId });
    await w.o.patch(R("ci", host.id), { operational_status: "non_operational" });
    await w.drain();
    const inbox = (await w.p.req.client.get(`${w.P}/notify/inbox`)).items as { title: string }[];
    expect(inbox.some((i) => i.title.includes("ایمیل سازمانی"))).toBe(true);
    await w.o.patch(R("ci", host.id), { operational_status: "operational" });
    await w.drain();
  });
});

describe("the status page", () => {
  it("shows published services to everyone as a projection, with daily bars", async () => {
    const page = await w.p.req.client.get(SP("/status?days=30"));
    const row = page.services.find((s: any) => s.id === S.id);
    expect(row).toBeTruthy();
    expect(row.bars.length).toBeGreaterThan(0);
    expect(row.availability).toBeGreaterThan(0);
    expect(row.subscribed).toBe(true);
    expect(page.can_manage).toBe(false);
    expect(Object.keys(row).sort()).toEqual(["availability", "bars", "group", "id", "name", "note", "number", "since", "status", "subscribed", "tier"]);
    // someone who may not read the service record still sees it on the page
    await owner2.client.get(R("service", S.id), 404);
    expect((await owner2.client.get(SP("/status"))).services.map((x: any) => x.id)).toContain(S.id);
  });

  it("is published by a secret key without signing in, and withdrawn", async () => {
    await w.p.agent.client.post(SP("/status/public"), { enabled: true }, 403);
    const on = await w.o.post(SP("/status/public"), { enabled: true });
    expect(on.token).toMatch(/^[A-Za-z0-9_-]{24,}$/);
    const anon = new Client(w.e.app);
    const page = await anon.get(`/v1/status/${on.token}`);
    expect(page.services.map((s: any) => s.name)).toContain("ایمیل سازمانی");
    expect(page.services.every((s: any) => s.number === null && s.subscribed === undefined)).toBe(true);
    await anon.get(`/v1/status/${"x".repeat(32)}`, 404);
    const again = await w.o.post(SP("/status/public"), { enabled: true, regenerate: true });
    expect(again.token).not.toBe(on.token);
    await anon.get(`/v1/status/${on.token}`, 404);
    await w.o.post(SP("/status/public"), { enabled: false });
    await anon.get(`/v1/status/${again.token}`, 404);
  });

  it("lets people subscribe themselves and lists «my services»", async () => {
    const r = await w.p.agent.client.post(SP(`/services/${S.id}/subscribe`), {});
    expect(r.created).toBe(true);
    expect((await w.p.agent.client.post(SP(`/services/${S.id}/subscribe`), {})).created).toBe(false);
    const mine = await w.p.agent.client.get(SP("/mine"));
    const m = mine.services.find((s: any) => s.id === S.id);
    expect(m.via).toContain("subscription");
    expect(m.offerings.length).toBe(1);
    expect((await w.p.agent.client.post(SP(`/services/${S.id}/unsubscribe`), {})).removed).toBe(1);
    // an unpublished service someone may not read cannot be subscribed to
    const hidden = (await w.o.post(R("service"), { name: "سرویس محرمانه", description: "x", owner_id: w.p.cm.userId })).row;
    await w.p.req.client.post(SP(`/services/${hidden.id}/subscribe`), {}, 404);
  });

  it("offers an offering restricted to a group only to its members", async () => {
    const vip = (await w.o.post(R("service_offering"), { name: "ویژهٔ زیرساخت", service_id: S.id, entitled_everyone: false, entitled_groups: [w.g.infra] })).row;
    await tr("service_offering", vip.id, "active");
    const am = await w.p.am.client.get(SP("/entitled"));
    expect(am.offerings.map((o: any) => o.id)).toContain(vip.id);
    const am2 = await w.p.am2.client.get(SP("/entitled"));
    expect(am2.offerings.map((o: any) => o.id)).not.toContain(vip.id);
  });
});

describe("scores, scorecard and reports", () => {
  it("scores the catalogue's services and fills the owner's scorecard", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const r = await w.o.post(SP("/score/run"), { day: today });
    expect(r.scored).toBeGreaterThan(0);
    const fact = (await w.o.post(`${R("service_score_fact")}/query`, { filter: { f: "service_id", op: "eq", v: S.id }, fields: ["day", "score", "incidents"] })).rows[0];
    expect(fact.score).toBeGreaterThanOrEqual(0);
    const card = await w.p.so.client.get(SP(`/services/${S.id}/scorecard`));
    expect(card.service.name).toBe("ایمیل سازمانی");
    expect(card.kpis.incidents_30d).toBeGreaterThanOrEqual(2);
    expect(card.kpis.dependencies).toBeGreaterThanOrEqual(2);
    expect(card.offerings.length).toBe(2);
    expect(card.trend.length).toBeGreaterThanOrEqual(1);
  });

  it("reports the portfolio, its health and rationalization overlaps", async () => {
    await liveService("ایمیل سازمانی جدید", { tags: ["ایمیل"] });
    const rep = await w.o.get(SP("/report"));
    expect(rep.views.catalogue).toBeGreaterThanOrEqual(2);
    expect(rep.by_state.find((x: any) => x.key === "live").count).toBeGreaterThanOrEqual(2);
    const health = await w.o.get(SP("/health"));
    expect(health.checks.find((c: any) => c.key === "owner").passing).toBeGreaterThanOrEqual(2);
    expect(health.checks.find((c: any) => c.key === "commitments").total).toBeGreaterThanOrEqual(1);
    const rat = await w.o.get(SP("/rationalization"));
    const row = rat.rows.find((x: any) => x.id === S.id);
    expect(row.overlaps.map((o: any) => o.name)).toContain("ایمیل سازمانی جدید");
    expect(["invest", "maintain", "review", "retire"]).toContain(row.quadrant);
  });

  it("finds CIs on prohibited technology and the services they reach", async () => {
    const tech = await w.o.get(SP("/technology"));
    const ws2012 = tech.rows.find((r: any) => r.name === "Windows Server" && r.product_version === "2012");
    expect(ws2012).toMatchObject({ risk: "ممنوع", cis: 1 });
    expect(ws2012.services.map((s: any) => s.id)).toContain(S.id);
  });
});

describe("pickers", () => {
  it("offers the services a CI reaches first, then the rest", async () => {
    const r = await w.o.get(SP(`/picker?ci=${host.id}`));
    expect(r.hits[0]).toMatchObject({ id: S.id, derived: true });
    const aff = await w.o.post(SP("/affected"), { ci_ids: [host.id] });
    expect(aff.services.map((s: any) => s.id)).toContain(S.id);
    const offerings = await w.o.get(SP(`/picker?kind=offering&service=${S.id}`));
    expect(offerings.hits.every((h: any) => h.service_id === S.id)).toBe(true);
  });
});

describe("access", () => {
  it("lets a service's owner read the records linked to it (and only those) without an incident role", async () => {
    const mine = await liveService("بستر آموزش مجازی", { owner_id: owner2.userId });
    const linked = (await w.o.post(R("incident"), { short_description: "کلاس مجازی باز نمی‌شود", service_id: mine.id })).row;
    const affected = (await w.o.post(R("incident"), { short_description: "کندی کلاس", affected_services: [mine.id] })).row;
    const other = (await w.o.post(R("incident"), { short_description: "چاپگر", service_id: S.id })).row;
    expect((await owner2.client.get(R("incident", linked.id))).row.id).toBe(linked.id);
    expect((await owner2.client.get(R("incident", affected.id))).row.id).toBe(affected.id);
    await owner2.client.get(R("incident", other.id), 404);
    await owner2.client.patch(R("incident", linked.id), { short_description: "تغییر" }, 403);
    expect(approverSources()).toEqual(expect.arrayContaining(["service_owner", "service_change_approvers"]));
  });

  it("cuts reports to the services people read, and keeps management from auditors", async () => {
    await nobody.client.get(SP("/report"), 403);
    expect((await owner2.client.get(SP("/report"))).total).toBe(1);
    expect((await w.p.auditor.client.get(SP("/report"))).total).toBeGreaterThan(0);
    await w.p.auditor.client.post(R("service"), { name: "ممیز" }, 403);
    await w.p.auditor.client.post(SP("/status/refresh"), {}, 403);
    await w.p.auditor.client.post(SP("/score/run"), {}, 403);
    const meta = await w.p.cm.client.get(SP("/meta"));
    expect(meta.can_manage).toBe(true);
  });
});
