// The service portfolio's lifecycle: the defaults of a new organisation (once), a proposal that charters a service,
// the service's and offering's CIs, the go-live guard, commitments that generate and follow SLA definitions, the
// retirement guard while live services depend on a service, deprecation notices to subscribers and subscriptions
// closed to deprecated services, the portfolio tree, design readiness and the TIME decision written on the CI.
import { beforeAll, describe, expect, it } from "vitest";
import { cmdbWorld, type CmdbWorld } from "./cmdb-helpers";

let w: CmdbWorld;
const R = (t: string, id?: string) => `${w.P}/r/${t}${id ? `/${id}` : ""}`;
const tr = (t: string, id: string, to: string, data: Record<string, unknown> = {}, expect = 200) => w.o.post(`${R(t, id)}/transition`, { to, data }, expect);

/** A live service with an owner, a description and an active offering. */
async function liveService(name: string, extra: Record<string, unknown> = {}) {
  const s = (await w.o.post(R("service"), { name, service_type: "business", description: `شرح ${name}`, owner_id: w.p.so.userId, ...extra })).row;
  await tr("service", s.id, "approved");
  const o = (await w.o.post(R("service_offering"), { name: "استاندارد", service_id: s.id })).row;
  await tr("service_offering", o.id, "active");
  await tr("service", s.id, "live");
  return { service: (await w.o.get(R("service", s.id))).row, offering: o };
}

beforeAll(async () => {
  w = await cmdbWorld();
  await w.o.post(`${w.P}/service_portfolio/seed`, {});
  await w.drain();
}, 120_000);

describe("defaults", () => {
  it("adds the taxonomy, technology standards, capabilities and rules once", async () => {
    const nodes = (await w.o.post(`${R("portfolio_node")}/query`, { size: 50, fields: ["name", "kind", "depth", "path", "parent_id"] })).rows;
    const top = nodes.find((n: any) => n.name === "خدمات کسب‌وکار");
    expect(top).toMatchObject({ kind: "portfolio", depth: 1 });
    const child = nodes.find((n: any) => n.name === "ارتباطات و همکاری");
    expect(child).toMatchObject({ depth: 2, parent_id: top.id });
    expect(child.path).toBe(`/${top.id}/${child.id}/`);
    const std = (await w.o.post(`${R("technology_standard")}/query`, { filter: { f: "status", op: "eq", v: "prohibited" }, fields: ["name", "product_version"] })).rows;
    expect(std.map((s: any) => `${s.name} ${s.product_version}`)).toContain("Windows Server 2012");
    const rules = (await w.o.post(`${R("notification_rule")}/query`, { filter: { f: "table_key", op: "eq", v: "service" }, fields: ["name"] })).rows;
    expect(rules.length).toBeGreaterThanOrEqual(3);
    const again = await w.o.post(`${w.P}/service_portfolio/seed`, {});
    expect(Object.values(again.created ?? {}).reduce((a: number, n: any) => a + Number(n), 0)).toBe(0);
  });

  it("keeps the portfolio tree free of loops and limited in depth", async () => {
    const a = (await w.o.post(R("portfolio_node"), { name: "الف" })).row;
    const b = (await w.o.post(R("portfolio_node"), { name: "ب", parent_id: a.id })).row;
    await w.o.patch(R("portfolio_node", a.id), { parent_id: b.id }, 400);
    await w.o.del(R("portfolio_node", a.id), 409);
  });
});

describe("proposals and charters", () => {
  it("charters a service from an approved proposal, with its CI", async () => {
    const p = (await w.o.post(R("service_proposal"), { name: "ایمیل سازمانی", kind: "new", value_score: "5", fit_score: "4", risk_score: "2" })).row;
    expect(p.score).toBeGreaterThan(70);
    await tr("service_proposal", p.id, "submitted", {}, 400); // the business need is required
    await w.o.patch(R("service_proposal", p.id), { business_need: "پیام‌رسانی امن کارکنان" });
    await tr("service_proposal", p.id, "submitted");
    await tr("service_proposal", p.id, "evaluation");
    await tr("service_proposal", p.id, "approved");
    const done = (await tr("service_proposal", p.id, "chartered")).row;
    expect(done.chartered_service_id).toBeTruthy();
    const s = (await w.o.get(R("service", done.chartered_service_id))).row;
    expect(s).toMatchObject({ name: "ایمیل سازمانی", state: "approved", description: "پیام‌رسانی امن کارکنان" });
    expect(s.approved_at ?? null).toBeNull(); // chartered straight into «تأییدشده», not through the transition
    const ci = (await w.o.get(R("ci", s.ci_id))).row;
    expect(ci).toMatchObject({ class: "business_service", name: "ایمیل سازمانی", state: "planned" });
  });

  it("asks for the service a change or retirement proposal is about", async () => {
    await w.o.post(R("service_proposal"), { name: "کنارگذاری", kind: "retire" }, 400);
  });
});

describe("going live", () => {
  it("needs an owner, a description and an active offering, then moves the CI to operational", async () => {
    const s = (await w.o.post(R("service"), { name: "حقوق و دستمزد", service_type: "business" })).row;
    await tr("service", s.id, "approved");
    const refused = await tr("service", s.id, "live", {}, 409);
    expect(refused.error.message).toContain("مالک خدمت");
    await w.o.patch(R("service", s.id), { owner_id: w.p.so.userId, description: "پرداخت حقوق کارکنان" });
    const o = (await w.o.post(R("service_offering"), { name: "پایه", service_id: s.id, level: "standard" })).row;
    expect(o.number).toMatch(/^OFR/);
    const oci = (await w.o.get(R("ci", o.ci_id))).row;
    expect(oci).toMatchObject({ class: "offering", owned_by: w.p.so.userId });
    await tr("service_offering", o.id, "active");
    const live = (await tr("service", s.id, "live")).row;
    expect(live.live_at).toBeTruthy();
    expect((await w.o.get(R("ci", s.ci_id))).row.state).toBe("operational");
    // the service's CI has the offering under it («دارای گزینه»)
    const rels = (await w.o.post(`${R("ci_rel")}/query`, { filter: { f: "parent_id", op: "eq", v: s.ci_id }, fields: ["type", "child_id"] })).rows;
    expect(rels).toEqual(expect.arrayContaining([expect.objectContaining({ type: "has_offering", child_id: o.ci_id })]));
  });

  it("renames the CI with the service and derives criticality from the tier", async () => {
    const { service } = await liveService("پرتال کارکنان");
    await w.o.patch(R("service", service.id), { name: "درگاه کارکنان", tier: "tier_1" });
    const s = (await w.o.get(R("service", service.id))).row;
    expect(s.criticality).toBe("1");
    expect((await w.o.get(R("ci", s.ci_id))).row).toMatchObject({ name: "درگاه کارکنان", tier: "tier_1" });
  });
});

describe("commitments", () => {
  it("generate the SLA definition of incidents on the offering and follow its changes", async () => {
    const { offering } = await liveService("شبکهٔ بی‌سیم");
    await w.o.post(R("service_commitment"), { offering_id: offering.id, kind: "resolution", target: "4" }, 400); // priority required
    const c = (await w.o.post(R("service_commitment"), { offering_id: offering.id, kind: "resolution", target: "4", priority: "1" })).row;
    expect(c.label).toContain("زمان حل");
    expect(c.sla_definition_id).toBeTruthy();
    const def = (await w.o.get(R("sla_definition", c.sla_definition_id))).row;
    expect(def).toMatchObject({ table_key: "incident", target: "resolution", active: true });
    expect(def.durations).toEqual({ "1": 14400 });
    const up = (await w.o.patch(R("service_commitment", c.id), { target: "8" })).row;
    expect(up.revision).toBe(2);
    expect((await w.o.get(R("sla_definition", c.sla_definition_id))).row.durations).toEqual({ "1": 28800 });
    await w.o.del(R("service_commitment", c.id));
    expect((await w.o.get(R("sla_definition", c.sla_definition_id))).row.active).toBe(false);
    const avail = await w.o.post(R("service_commitment"), { offering_id: offering.id, kind: "availability", target: "120" }, 400);
    expect(avail.error.code).toBe("validation");
  });
});

describe("retirement", () => {
  it("is refused while live services depend on the service, and retires its offerings", async () => {
    const platform = await liveService("بستر میزبانی", { service_type: "technical" });
    const app = await liveService("سامانهٔ فروش");
    await w.rel(app.service.ci_id, "depends_on", platform.service.ci_id);
    await tr("service", platform.service.id, "deprecated", {}, 400); // a reason is required
    await tr("service", platform.service.id, "deprecated", { retire_reason: "انتقال به ابر" });
    const refused = await tr("service", platform.service.id, "retired", { retire_reason: "انتقال به ابر" }, 409);
    expect(refused.error.message).toContain("سامانهٔ فروش");
    await tr("service", app.service.id, "deprecated", { retire_reason: "جایگزین شد" });
    await tr("service", app.service.id, "retired", { retire_reason: "جایگزین شد" });
    await tr("service", platform.service.id, "retired", { retire_reason: "انتقال به ابر" });
    const off = (await w.o.get(R("service_offering", platform.offering.id))).row;
    expect(off.state).toBe("retired");
    expect((await w.o.get(R("ci", platform.service.ci_id))).row.state).toBe("retired");
  });

  it("tells subscribers of a deprecation and accepts no new subscribers", async () => {
    const { service } = await liveService("دورکاری (VPN)");
    await w.o.post(R("service_subscription"), { service_id: service.id, subscriber_kind: "user", user_id: w.p.req.userId });
    const group = await w.o.post(R("service_subscription"), { service_id: service.id, subscriber_kind: "group", group_id: w.g.infra, user_id: w.p.req.userId });
    expect(group.row.user_id).toBeNull(); // only the subscriber field of its kind is kept
    await tr("service", service.id, "deprecated", { retire_reason: "جایگزینی با دسترسی صفر-اعتماد" });
    await w.drain();
    const inbox = (await w.p.req.client.get(`${w.P}/notify/inbox`)).items as { title: string }[];
    expect(inbox.some((i) => i.title.includes("دورکاری (VPN)"))).toBe(true);
    const refused = await w.o.post(R("service_subscription"), { service_id: service.id, subscriber_kind: "user", user_id: w.p.agent.userId }, 400);
    expect(refused.error.message ?? JSON.stringify(refused)).toBeTruthy();
  });
});

describe("design, assessments and capabilities", () => {
  it("accepts a design package in operations only with a complete readiness checklist", async () => {
    const { service } = await liveService("بایگانی اسناد");
    const d = (await w.o.post(R("service_design_package"), { name: "طراحی بایگانی", service_id: service.id, readiness: [{ item: "مستندات پشتیبانی", done: true }, { item: "آموزش میز خدمت", done: false }] })).row;
    expect(Number(d.readiness_pct)).toBe(50);
    await tr("service_design_package", d.id, "in_review");
    await tr("service_design_package", d.id, "approved");
    await tr("service_design_package", d.id, "accepted", {}, 409);
    await w.o.patch(R("service_design_package", d.id), { readiness: [{ item: "مستندات پشتیبانی", done: true }, { item: "آموزش میز خدمت", done: true }] });
    expect((await tr("service_design_package", d.id, "accepted")).row.state).toBe("accepted");
  });

  it("writes the TIME decision of an application assessment on the application's CI", async () => {
    const app = await w.ci({ name: "سامانهٔ انبار", class: "business_application" });
    const a = (await w.o.post(R("app_assessment"), { title: "ارزیابی ۱۴۰۵", ci_id: app.id, assessor_id: w.p.cm.userId })).row;
    await tr("app_assessment", a.id, "completed", { business_value: 2, technical_fit: 1, time_disposition: "migrate" });
    expect((await w.o.get(R("ci", app.id))).row.attrs.time_disposition).toBe("migrate");
  });

  it("keeps the capability tree within three levels", async () => {
    const l1 = (await w.o.post(R("business_capability"), { name: "ق۱" })).row;
    const l2 = (await w.o.post(R("business_capability"), { name: "ق۲", parent_id: l1.id })).row;
    const l3 = (await w.o.post(R("business_capability"), { name: "ق۳", parent_id: l2.id })).row;
    expect(l3.level).toBe(3);
    await w.o.post(R("business_capability"), { name: "ق۴", parent_id: l3.id }, 400);
  });
});
