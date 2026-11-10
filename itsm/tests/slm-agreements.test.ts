// Service level management — agreements on the portfolio's `service_agreement`: the seed, templates, the lifecycle with
// the approvals service, the portfolio's status kept in step (and its expiry job moving the lifecycle), targets that
// generate the SLA service's timers (switched on only while the agreement is in force, scoped to its service and
// customer; OLAs started by the provider group), live compliance with breaches, final periods and credits, the
// document and the customer's acceptance, and access (a requester, an agent, an auditor).
import { beforeAll, describe, expect, it } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import type { Client } from "./helpers";
import { tick } from "@server/jobs";
import { systemCtx } from "@server/engine";
import { expireAgreements } from "@server/modules/service_portfolio";
import { slmSweep, storeMeasures, agreementPeriod } from "@server/modules/slm";
import { addDays } from "@shared/jalali";

type Who = "slm" | "owner" | "agent" | "req" | "auditor" | "contact";
const ROLES: Record<Who, string[]> = { slm: ["service_level_manager"], owner: ["service_owner"], agent: ["agent"], req: ["requester"], auditor: ["auditor"], contact: ["requester"] };

let e: EngineOrg;
let P = "";
let o: Client;
const p = {} as Record<Who, { client: Client; userId: string }>;
let svc: Record<string, any>;
let unit = "";
let group = "";

const drain = async () => {
  for (let i = 0; i < 40; i++) {
    const r = await tick(e.cfg, { budgetMs: 30_000 });
    if (!r.ran && !r.more) break;
  }
};
const q = (cond: unknown) => encodeURIComponent(JSON.stringify(cond));
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  e = await engineOrg();
  P = `/o/${e.org}`;
  o = e.owner;
  await o.post(`${P}/cmdb/seed`, {});
  await o.post(`${P}/service_portfolio/seed`, {});
  const seeded = await o.post(`${P}/slm/seed`, {});
  expect(seeded.skipped).toBe(false);
  for (const k of Object.keys(ROLES) as Who[]) p[k] = await e.member("member", `slm-${k}@example.com`);
  for (const k of Object.keys(ROLES) as Who[]) await o.put(`${P}/access/members/${p[k].userId}`, { roles: ROLES[k], persona: k === "req" || k === "contact" ? "requester" : "agent" });
  unit = (await o.post(`${P}/r/org_unit`, { name: "واحد مالی" })).row.id;
  group = (await o.post(`${P}/r/group`, { name: "شبکه", types: ["assignment"] })).row.id;
  svc = (await o.post(`${P}/r/service`, { name: "ایمیل سازمانی", service_type: "business", description: "ایمیل", owner_id: p.owner.userId })).row;
  await o.post(`${P}/r/service/${svc.id}/transition`, { to: "approved" });
  await drain();
}, 240_000);

describe("seed", () => {
  it("is idempotent and adds templates, the role, XLA policies, the CSI register, rules and indicators", async () => {
    expect((await o.post(`${P}/slm/seed`, {})).skipped).toBe(true);
    const templates = (await o.get(`${P}/r/slm_template?size=50`)).rows;
    expect(templates.map((t: any) => t.kind)).toEqual(expect.arrayContaining(["sla", "ola", "uc"]));
    expect(templates.length).toBe(5);
    const roles = (await o.get(`${P}/r/role?size=80`)).rows.map((r: any) => r.key);
    expect(roles).toContain("service_level_manager");
    const plans = (await o.get(`${P}/r/slm_csi_plan`)).rows;
    expect(plans.length).toBe(1);
    expect((await o.get(`${P}/r/slm_improvement?filter=${q({ f: "plan_id", op: "eq", v: plans[0].id })}`)).rows.length).toBe(3);
    expect((await o.get(`${P}/r/approval_rule?filter=${q({ f: "table_key", op: "eq", v: "service_agreement" })}`)).rows.length).toBe(1);
    const kpis = (await o.get(`${P}/r/analytics_indicator?filter=${q({ f: "key", op: "starts", v: "slm." })}&size=50`)).rows.map((r: any) => r.key);
    expect(kpis).toEqual(expect.arrayContaining(["slm.attainment", "slm.ola_attainment", "slm.compliance", "slm.xla_score"]));
    expect((await o.get(`${P}/r/slm_xla_policy`)).rows.length).toBeGreaterThan(0);
  });
});

describe("the portfolio's agreements keep working", () => {
  it("an agreement created «در جریان» starts in force; the expiry job ends its lifecycle", async () => {
    const a = (await o.post(`${P}/r/service_agreement`, { name: "توافق قدیمی", service_id: svc.id, customer_unit_id: unit, status: "active", valid_from: addDays(today(), -60), valid_to: addDays(today(), -1) })).row;
    expect(a.state).toBe("active");
    expect(a.status).toBe("active");
    expect(a.kind).toBe("sla");
    // a person changes the status only through the lifecycle
    await o.patch(`${P}/r/service_agreement/${a.id}`, { status: "draft", version: a.version }, 400);
    const sys = await systemCtx(e.cfg, e.org);
    await expireAgreements(sys as never);
    const after = (await o.get(`${P}/r/service_agreement/${a.id}`)).row;
    expect(after.status).toBe("expired");
    expect(after.state).toBe("expired");
  });
});

describe("an agreement from a template, through its lifecycle", () => {
  let a: Record<string, any>;
  let targets: Record<string, any>[];

  it("is created as the caller with the template's document and targets", async () => {
    const tpl = (await o.get(`${P}/r/slm_template?filter=${q({ f: "level", op: "eq", v: "silver" })}`)).rows[0];
    const created = await p.slm.client.post(`${P}/slm/agreements/from-template`, { template_id: tpl.id, name: "توافق ایمیل واحد مالی", service_id: svc.id, customer_unit_id: unit, valid_from: today() });
    a = (await o.get(`${P}/r/service_agreement/${created.id}`)).row;
    expect(a.state).toBe("requirements");
    expect(a.status).toBe("draft");
    expect(a.template_id).toBe(tpl.id);
    expect(String(a.terms)).toContain("نقره‌ای");
    targets = (await o.get(`${P}/r/slm_target?filter=${q({ f: "agreement_id", op: "eq", v: a.id })}&size=20`)).rows;
    expect(targets.length).toBe(4);
    const timers = targets.filter((t) => t.kind === "timer");
    expect(timers.every((t) => t.generated && t.definition_id)).toBe(true);
    // generated definitions are scoped to the service and customer and off until the agreement is in force
    const d = (await o.get(`${P}/r/sla_definition/${timers[0].definition_id}`)).row;
    expect(d.service_id).toBe(svc.id);
    expect(d.customer_unit_id).toBe(unit);
    expect(d.type).toBe("sla");
    expect(d.active).toBe(false);
  });

  it("goes for approval to the service's owner and becomes in force", async () => {
    let row = (await p.slm.client.post(`${P}/r/service_agreement/${a.id}/transition`, { to: "draft" })).row;
    row = (await p.slm.client.post(`${P}/r/service_agreement/${a.id}/transition`, { to: "awaiting_approval", version: row.version })).row;
    expect(row.approval).toBe("requested");
    await drain();
    const mine = await p.owner.client.get(`${P}/approvals/mine`);
    const ap = mine.approvals.find((x: any) => x.record_id === a.id);
    expect(ap).toBeTruthy();
    await p.owner.client.post(`${P}/approvals/${ap.id}/decide`, { decision: "approved" });
    row = (await o.get(`${P}/r/service_agreement/${a.id}`)).row;
    expect(row.state).toBe("enablement");
    expect(row.status).toBe("draft");
    // the sweep starts it on its start date
    const sys = await systemCtx(e.cfg, e.org);
    const r = await slmSweep(sys);
    expect(r.started).toBeGreaterThanOrEqual(1);
    row = (await o.get(`${P}/r/service_agreement/${a.id}`)).row;
    expect(row.state).toBe("active");
    expect(row.status).toBe("active");
    expect(row.next_review_at).toBeTruthy();
    const d = (await o.get(`${P}/r/sla_definition/${targets.find((t) => t.kind === "timer")!.definition_id}`)).row;
    expect(d.active).toBe(true);
    a = row;
  });

  it("measures live compliance from the SLA service's timers, with breaches", async () => {
    // a resolution target of one second for priority 2, on a 24×7 clock, to produce one met and one breached record
    const t = targets.find((x) => x.timer_target === "resolution")!;
    const tight = (await p.slm.client.patch(`${P}/r/slm_target/${t.id}`, { p2_hours: 0.0005 })).row;
    expect(tight.generated).toBe(true);
    const mk = async (title: string) => (await o.post(`${P}/r/incident`, { short_description: title, impact: "1", urgency: "2", service_id: svc.id, caller_id: p.contact.userId })).row;
    await o.put(`${P}/access/members/${p.contact.userId}`, { org_unit_id: unit });
    const fast = await mk("کندی ایمیل");
    const slow = await mk("قطع ایمیل");
    await o.post(`${P}/r/incident/${fast.id}/transition`, { to: "resolved", data: { close_code: "solved", close_notes: "رفع شد" } });
    await sleep(2500);
    await o.post(`${P}/r/incident/${slow.id}/transition`, { to: "resolved", data: { close_code: "solved", close_notes: "رفع شد" } });
    const timers = (await o.get(`${P}/r/task_sla?filter=${q({ f: "definition_id", op: "eq", v: tight.definition_id })}`)).rows;
    expect(timers.length).toBe(2);
    const v = await p.slm.client.get(`${P}/slm/agreements/${a.id}/360`);
    const live = v.targets.find((x: any) => x.id === t.id);
    expect(live.total).toBe(2);
    expect(live.breached).toBe(1);
    expect(live.value).toBe(50);
    expect(live.status).toBe("missed");
    expect(v.overall.status).toBe("missed");
    expect(v.breaches.some((b: any) => b.by === "definition" && b.count >= 1)).toBe(true);
    // measuring stores the period and raises «در خطر» once
    await p.slm.client.post(`${P}/slm/agreements/${a.id}/measure`, {});
    const stored = (await o.get(`${P}/r/service_agreement/${a.id}`)).row;
    expect(stored.compliance_status).toBe("missed");
    const rows = (await o.get(`${P}/r/slm_compliance?filter=${q({ f: "target_id", op: "eq", v: t.id })}`)).rows;
    expect(rows.length).toBe(1);
    expect(Number(rows[0].value)).toBe(50);
  });

  it("closes a period with credits for missed targets that have tiers", async () => {
    const t = targets.find((x) => x.timer_target === "resolution")!;
    await o.patch(`${P}/r/slm_target/${t.id}`, { credit_tiers: [{ below: 90, pct: 5 }, { below: 60, pct: 10 }], credit_cap_pct: "8" });
    await o.patch(`${P}/r/service_agreement/${a.id}`, { monthly_fee: "1000000" });
    const sys = await systemCtx(e.cfg, e.org);
    const raw = (await o.get(`${P}/r/service_agreement/${a.id}`)).row;
    await sys.write((tx) => storeMeasures(tx, sys, a.id, { period: agreementPeriod(raw, today()), final: true }));
    const credits = (await o.get(`${P}/r/slm_credit?filter=${q({ f: "agreement_id", op: "eq", v: a.id })}`)).rows;
    expect(credits.length).toBe(1);
    expect(Number(credits[0].credit_pct)).toBe(8); // 10% capped at 8%
    expect(Number(credits[0].amount)).toBe(80000);
    // an agent of the service desk sees the credit but not its amount (financial)
    const seen = (await p.agent.client.get(`${P}/r/slm_credit/${credits[0].id}`)).row;
    expect(seen.amount).toBeUndefined();
    // credits come only from measuring
    await o.post(`${P}/r/slm_credit`, { agreement_id: a.id, target_id: t.id, period_key: "x" }, 400);
  });

  it("renders the Persian document; the customer's contact sees customer-facing targets only and accepts", async () => {
    await o.patch(`${P}/r/service_agreement/${a.id}`, { customer_contact_id: p.contact.userId });
    const doc = await p.slm.client.get(`${P}/slm/agreements/${a.id}/document`);
    expect(doc.markdown).toContain("## ۴. اهداف سطح خدمت");
    expect(doc.markdown).toContain("حل رخداد");
    const draft = await p.slm.client.post(`${P}/slm/agreements/${a.id}/document/draft`, {});
    expect(draft.ai).toBe(false);
    expect(draft.markdown).toContain("اهداف سطح خدمت");
    const theirs = await p.contact.client.get(`${P}/slm/agreements/${a.id}/document`);
    expect(theirs.customer_view).toBe(true);
    const accepted = await p.contact.client.post(`${P}/slm/agreements/${a.id}/accept`, { note: "پذیرفته شد" });
    expect(accepted.accepted_by).toBe(p.contact.userId);
    await p.contact.client.post(`${P}/slm/agreements/${a.id}/accept`, {}, 409);
  });

  it("is read by a requester without its targets, by an agent with them, and changed by neither", async () => {
    const req = await p.req.client.get(`${P}/slm/agreements/${a.id}/360`);
    expect(req.targets).toBeNull();
    await p.req.client.get(`${P}/r/slm_target?filter=${q({ f: "agreement_id", op: "eq", v: a.id })}`, 403);
    const agent = await p.agent.client.get(`${P}/slm/agreements/${a.id}/360`);
    expect(agent.targets.length).toBe(4);
    expect(agent.can.write).toBe(false);
    await p.agent.client.post(`${P}/r/service_agreement/${a.id}/transition`, { to: "under_review" }, 403);
    await p.agent.client.post(`${P}/slm/agreements/${a.id}/measure`, {}, 403);
    const aud = await p.auditor.client.get(`${P}/slm/agreements/${a.id}/360`);
    expect(aud.targets.length).toBe(4);
    await p.auditor.client.patch(`${P}/r/slm_target/${agent.targets[0].id}`, { goal: 50 }, 403);
  });
});

describe("operational level agreements", () => {
  it("generate OLA timers started by the provider group and stopped when the work leaves it", async () => {
    const a = (await p.slm.client.post(`${P}/r/service_agreement`, { name: "OLA شبکه برای ایمیل", kind: "ola", service_id: svc.id, customer_unit_id: unit, provider_group_id: group, valid_from: today() })).row;
    const t = (await p.slm.client.post(`${P}/r/slm_target`, { agreement_id: a.id, name: "حل در گروه شبکه", kind: "timer", table_key: "incident", timer_target: "resolution", p1_hours: 2, p2_hours: 4, p3_hours: 8, p4_hours: 16 })).row;
    const d = (await o.get(`${P}/r/sla_definition/${t.definition_id}`)).row;
    expect(d.type).toBe("ola");
    expect(d.customer_unit_id).toBeNull();
    expect(JSON.stringify(d.start_condition)).toContain(group);
    expect(JSON.stringify(d.stop_condition)).toContain("ne");
    // OLAs need their provider group to be ready
    const noGroup = (await p.slm.client.post(`${P}/r/service_agreement`, { name: "OLA بی‌گروه", kind: "ola", service_id: svc.id, customer_unit_id: unit, valid_from: today() })).row;
    await p.slm.client.post(`${P}/r/slm_target`, { agreement_id: noGroup.id, name: "پذیرش", kind: "manual" });
    await p.slm.client.post(`${P}/r/service_agreement/${noGroup.id}/transition`, { to: "draft" });
    await p.slm.client.post(`${P}/r/service_agreement/${noGroup.id}/transition`, { to: "awaiting_approval" }, 409);
  });
});
