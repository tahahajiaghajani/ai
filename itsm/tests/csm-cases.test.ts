// Customer service management (CSM-001/002/006/008/009/011/012/013/014/018/020/026/028/033/034/039):
//   accounts bound to company units (the customer's administrator reads the account's cases through the access model),
//   contacts grouped by e-mail domain, entitlements resolved at intake with units consumed in a ledger, the customer's
//   own view (never internal notes — not in the API, not in an AI reply prompt), accepting or rejecting a resolution,
//   internal escalation with states flowing back as internal notes, proactive cases from the installed base, major
//   cases, escalations, notices with evidence, relationship health, customer 360 and next-case pull.
import "./fixtures/rag";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { esmWorld, memberAt, type EsmWorld } from "./esm-helpers";
import { FAKE_INBOX, clearFakeInbox } from "@server/modules/ai/adapters/fake";
import type { Client } from "./helpers";

const before = process.env.ITSM_AI_FAKE;
afterAll(() => {
  if (before === undefined) delete process.env.ITSM_AI_FAKE;
  else process.env.ITSM_AI_FAKE = before;
});

type P = { client: Client; userId: string };

describe("csm: accounts, entitlements and customer cases", () => {
  let w: EsmWorld;
  let agent: P, lead: P, cust: P, custAdmin: P, other: P;
  let group: string;
  let acme: Record<string, any>;
  let globex: Record<string, any>;
  let product: string;
  let ent: string;

  const slaNames = async (id: string) => (await w.e.db.query<{ name: string }>(`select name from sm_task_slas where org_id = $1 and record_id = $2 and deleted_at is null`, [w.e.org, id])).map((r) => r.name);

  beforeAll(async () => {
    process.env.ITSM_AI_FAKE = "1";
    w = await esmWorld();
    await w.o.post(`${w.P}/csm/seed`, {});
    agent = await memberAt(w.e, "csm.agent@example.com", "10.99.0.1");
    lead = await memberAt(w.e, "csm.lead@example.com", "10.99.0.2");
    cust = await memberAt(w.e, "ali@acme.example", "10.99.0.3");
    custAdmin = await memberAt(w.e, "boss@acme.example", "10.99.0.4");
    other = await memberAt(w.e, "sara@globex.example", "10.99.0.5");
    const groups = (await w.o.get(`${w.P}/r/group?size=200`)).rows as { id: string; name: string }[];
    group = groups.find((g) => g.name === "پشتیبانی مشتریان")!.id;
    await w.o.put(`${w.P}/access/members/${agent.userId}`, { roles: ["csm_agent"], persona: "agent" });
    await w.o.put(`${w.P}/access/members/${lead.userId}`, { roles: ["csm_manager"], persona: "agent" });
    for (const p of [cust, custAdmin, other]) await w.o.put(`${w.P}/access/members/${p.userId}`, { roles: ["requester"], persona: "requester" });
    await w.o.post(`${w.P}/access/groups/${group}/members`, { user_ids: [agent.userId, lead.userId] });
    acme = (await lead.client.post(`${w.P}/r/customer_account`, { name: "شرکت آکمه", code: "ACME", tier: "gold", email_domain: "acme.example", support_group_id: group, relationship_manager_id: lead.userId })).row;
    globex = (await lead.client.post(`${w.P}/r/customer_account`, { name: "گلوبکس", code: "GLX", support_group_id: group, relationship_manager_id: lead.userId })).row;
    product = (await lead.client.post(`${w.P}/r/customer_product`, { name: "سامانهٔ حسابداری", code: "ACC", support_group_id: group, skills: ["حسابداری"] })).row.id;
    await w.drain();
  });

  it("binds each account to a company unit under «مشتریان» and keeps its name", async () => {
    const a = await w.get("customer_account", acme.id, lead.client);
    expect(a.org_unit_id).toBeTruthy();
    const unit = await w.get("org_unit", a.org_unit_id, w.o);
    expect(unit.name).toBe("شرکت آکمه");
    expect(unit.kind).toBe("company");
    await lead.client.patch(`${w.P}/r/customer_account/${acme.id}`, { name: "شرکت آکمه ایران", version: a.version });
    expect((await w.get("org_unit", a.org_unit_id, w.o)).name).toBe("شرکت آکمه ایران");
    acme = await w.get("customer_account", acme.id, lead.client);
  });

  it("groups contacts by e-mail domain and puts their member in the customer's unit", async () => {
    const c = await lead.client.post(`${w.P}/r/customer_contact`, { name: "علی رضایی", email: "ali@acme.example", user_id: cust.userId, roles: ["customer", "user"] });
    expect(c.row.account_id).toBe(acme.id);
    await lead.client.post(`${w.P}/r/customer_contact`, { name: "مدیر آکمه", email: "boss@acme.example", user_id: custAdmin.userId, roles: ["admin"], is_primary: true });
    await lead.client.post(`${w.P}/r/customer_contact`, { name: "سارا", email: "sara@globex.example", user_id: other.userId, account_id: globex.id });
    await lead.client.post(`${w.P}/r/customer_contact`, { name: "بی‌حساب", email: "x@nowhere.example" }, 400);
    const prof = (await w.o.get(`${w.P}/access/members/${cust.userId}`)).profile;
    expect(prof.org_unit_id).toBe(acme.org_unit_id);
    // the customer's administrator manages the company's unit
    const unit = await w.get("org_unit", acme.org_unit_id, w.o);
    await w.o.patch(`${w.P}/r/org_unit/${unit.id}`, { manager_id: custAdmin.userId, version: unit.version });
    await w.drain();
  });

  it("resolves the entitlement at intake, consumes units on close and blocks when exhausted", async () => {
    ent = (await lead.client.post(`${w.P}/r/entitlement`, { name: "پشتیبانی طلایی", account_id: acme.id, product_id: product, support_level: "premium", channels: ["portal", "email"], starts_on: "2026-01-01", ends_on: "2027-12-30", unit_type: "cases", units_total: "2", block_when_exhausted: true, response_hours: 2, resolution_hours: 16 })).row.id;
    const e = await w.get("entitlement", ent, lead.client);
    await lead.client.post(`${w.P}/r/entitlement/${ent}/transition`, { to: "active", version: e.version });
    for (let i = 0; i < 2; i++) {
      const c = await cust.client.post(`${w.P}/r/customer_case`, { short_description: `گزارش ماهانه باز نمی‌شود ${i}`, product_id: product, channel: "portal" });
      expect(c.row.entitlement_id).toBe(ent);
      expect(c.row.entitlement_status).toBe("covered");
      expect(c.row.account_id).toBe(acme.id);
      await w.drain();
      const row = await w.get("customer_case", c.row.id, agent.client);
      expect(row.assignment_group_id).toBe(group);
      // the entitlement's support level picks the agreements (CSM-010)
      expect(row.support_level).toBe("premium");
      if (i === 0) expect((await slaNames(c.row.id)).sort()).toEqual(["حل پرونده — سطح ویژه", "نخستین پاسخ — سطح ویژه"]);
      const r1 = await agent.client.post(`${w.P}/r/customer_case/${c.row.id}/transition`, { to: "resolved", data: { close_notes: "تنظیم گزارش اصلاح شد" }, version: row.version });
      await cust.client.post(`${w.P}/r/customer_case/${c.row.id}/transition`, { to: "closed", version: r1.row.version });
      await w.drain();
      const closed = await w.get("customer_case", c.row.id, cust.client);
      expect(closed.resolution_accepted).toBe(true);
    }
    const after = await w.get("entitlement", ent, lead.client);
    expect(Number(after.units_used)).toBe(2);
    expect(Number(after.units_remaining)).toBe(0);
    const ledger = await lead.client.get(`${w.P}/r/entitlement_ledger?filter=${encodeURIComponent(JSON.stringify({ f: "entitlement_id", op: "eq", v: ent }))}`);
    expect(ledger.rows).toHaveLength(2);
    await cust.client.post(`${w.P}/r/customer_case`, { short_description: "پرسش تازه", product_id: product, channel: "portal" }, 400);
    // nobody writes the ledger by hand
    await lead.client.post(`${w.P}/r/entitlement_ledger`, { entitlement_id: ent, delta: "5", reason: "دستی" }, 403);
  });

  it("hands a case nothing entitles to the relationship manager instead of refusing it", async () => {
    const c = await other.client.post(`${w.P}/r/customer_case`, { short_description: "درخواست آموزش", channel: "email" });
    expect(c.row.entitlement_status).toBe("none");
    await w.drain();
    const row = await w.get("customer_case", c.row.id, lead.client);
    expect(row.assigned_to).toBe(lead.userId);
    expect(row.support_level ?? null).toBeNull();
    expect((await slaNames(c.row.id)).sort()).toEqual(["حل پروندهٔ مشتری", "نخستین پاسخ به مشتری"]);
  });

  it("shows customers only their cases (administrators their account's), never internal notes", async () => {
    const e = await w.get("entitlement", ent, lead.client);
    await lead.client.patch(`${w.P}/r/entitlement/${ent}`, { units_total: "20", version: e.version });
    const c = await cust.client.post(`${w.P}/r/customer_case`, { short_description: "خطای ورود به سامانه", description: "پیام خطای ۵۰۰", product_id: product });
    await w.drain();
    await agent.client.post(`${w.P}/r/customer_case/${c.row.id}/journal`, { kind: "work_note", body: "یادداشت داخلی: INTERNAL-NOTE-TOKEN پایگاه داده کند است" });
    await agent.client.post(`${w.P}/r/customer_case/${c.row.id}/journal`, { kind: "comment", body: "در حال بررسی هستیم" });
    const j = await cust.client.get(`${w.P}/r/customer_case/${c.row.id}/journal`);
    expect(JSON.stringify(j)).not.toContain("INTERNAL-NOTE-TOKEN");
    expect(JSON.stringify(j)).toContain("در حال بررسی هستیم");
    await w.get("customer_case", c.row.id, custAdmin.client);
    await w.get("customer_case", c.row.id, other.client, 404);
    await w.get("customer_case", c.row.id, w.p.it.client, 404);
    // an AI reply draft never sees internal notes, whoever drafts it
    await w.o.post(`${w.P}/ai/connections`, { preset: "fake" });
    clearFakeInbox();
    await agent.client.post(`${w.P}/ai/skills/csm.case_reply/run`, { table: "customer_case", id: c.row.id, params: { intent: "update" } });
    expect(FAKE_INBOX.length).toBeGreaterThan(0);
    expect(JSON.stringify(FAKE_INBOX)).not.toContain("INTERNAL-NOTE-TOKEN");
    expect(JSON.stringify(FAKE_INBOX)).toContain("در حال بررسی هستیم");
  });

  it("raises an incident from a case and brings its states back as internal notes only", async () => {
    const c = await cust.client.post(`${w.P}/r/customer_case`, { short_description: "سرویس گزارش‌گیری قطع است", product_id: product });
    await w.drain();
    const raised = await agent.client.post(`${w.P}/csm/cases/${c.row.id}/raise`, { table: "incident" });
    expect(raised.table).toBe("incident");
    let row = await w.get("customer_case", c.row.id, agent.client);
    expect(row.state).toBe("awaiting_internal");
    expect(row.customer_status).toBe("در حال بررسی");
    const inc = await w.get("incident", raised.id, w.o);
    await w.o.post(`${w.P}/r/incident/${raised.id}/transition`, { to: "resolved", data: { close_code: "solved", close_notes: "سرویس دوباره راه افتاد" }, version: inc.version });
    await w.drain();
    row = await w.get("customer_case", c.row.id, agent.client);
    expect(row.state).toBe("open");
    const j = await cust.client.get(`${w.P}/r/customer_case/${c.row.id}/journal`);
    expect(JSON.stringify(j)).not.toContain(String(inc.number));
    const all = await agent.client.get(`${w.P}/r/customer_case/${c.row.id}/journal`);
    expect(JSON.stringify(all)).toContain(String(inc.number));
  });

  it("opens proactive cases for the accounts whose installed base an incident touches (once)", async () => {
    await w.o.post(`${w.P}/cmdb/seed`, {});
    const ci = (await w.o.post(`${w.P}/r/ci`, { name: "سرور گزارش‌ها", class: "server" })).row.id;
    await lead.client.post(`${w.P}/r/install_base_item`, { name: "سامانهٔ حسابداری آکمه", account_id: acme.id, product_id: product, ci_id: ci });
    const inc = await w.o.post(`${w.P}/r/incident`, { short_description: "از کار افتادن سرور گزارش‌ها", ci_id: ci, priority: "2" });
    const r = await lead.client.post(`${w.P}/csm/incidents/${inc.row.id}/proactive`, {});
    expect(r.created).toBe(1);
    const again = await lead.client.post(`${w.P}/csm/incidents/${inc.row.id}/proactive`, {});
    expect(again.created).toBe(0);
    await w.drain();
    // the account's primary contact (its administrator) reads the proactive case opened for them, with the notice on it
    const mine = await custAdmin.client.get(`${w.P}/r/customer_case?filter=${encodeURIComponent(JSON.stringify({ f: "proactive", op: "eq", v: true }))}`);
    expect(mine.rows).toHaveLength(1);
    expect(mine.rows[0].requested_for).toBe(custAdmin.userId);
    const j = await custAdmin.client.get(`${w.P}/r/customer_case/${mine.rows[0].id}/journal`);
    expect(JSON.stringify(j)).toContain("اختلالی که بر خدمت شما اثر دارد");
    // another customer's account was not touched
    const theirs = await other.client.get(`${w.P}/r/customer_case?filter=${encodeURIComponent(JSON.stringify({ f: "proactive", op: "eq", v: true }))}`);
    expect(theirs.rows).toHaveLength(0);
  });

  it("accepts escalations only with the CSM manager's authority and marks the case", async () => {
    const c = await cust.client.post(`${w.P}/r/customer_case`, { short_description: "سه روز است پاسخ نگرفته‌ام", product_id: product, case_type: "complaint" });
    expect(c.row.complaint).toBe(true);
    const esc = await agent.client.post(`${w.P}/r/case_escalation`, { short_description: "مشتری ناراضی", case_id: c.row.id, account_id: acme.id, reason: "customer_request" });
    const e1 = await w.get("case_escalation", esc.row.id, agent.client);
    await agent.client.post(`${w.P}/r/case_escalation/${esc.row.id}/transition`, { to: "active", version: e1.version }, 403);
    await lead.client.post(`${w.P}/r/case_escalation/${esc.row.id}/transition`, { to: "active", version: e1.version });
    await w.drain();
    expect((await w.get("customer_case", c.row.id, agent.client)).escalated).toBe(true);
  });

  it("broadcasts one update to every child of a major case", async () => {
    const major = await agent.client.post(`${w.P}/r/customer_case`, { short_description: "اختلال سراسری ورود", account_id: acme.id, is_major: true });
    const child = await cust.client.post(`${w.P}/r/customer_case`, { short_description: "من هم نمی‌توانم وارد شوم", product_id: product });
    const ch = await w.get("customer_case", child.row.id, agent.client);
    await agent.client.patch(`${w.P}/r/customer_case/${child.row.id}`, { major_case_id: major.row.id, version: ch.version });
    const r = await agent.client.post(`${w.P}/csm/cases/${major.row.id}/broadcast`, { body: "ورود دوباره برقرار شد" });
    expect(r.sent).toBe(1);
    const j = await cust.client.get(`${w.P}/r/customer_case/${child.row.id}/journal`);
    expect(JSON.stringify(j)).toContain("ورود دوباره برقرار شد");
  });

  it("sends an approved notice to the affected accounts' contacts with evidence", async () => {
    const n = await lead.client.post(`${w.P}/r/customer_notice`, { title: "اطلاع‌رسانی اختلال", body: "خدمت گزارش‌ها از ساعت ۹ تا ۱۱ در دسترس نبود.", accounts: [acme.id], regulation: "major_incident" });
    await lead.client.post(`${w.P}/csm/notices/${n.row.id}/send`, {}, 400);
    const r1 = await w.get("customer_notice", n.row.id, lead.client);
    await agent.client.post(`${w.P}/r/customer_notice/${n.row.id}/transition`, { to: "approved", version: r1.version }, 403);
    await lead.client.post(`${w.P}/r/customer_notice/${n.row.id}/transition`, { to: "approved", version: r1.version });
    const sent = await lead.client.post(`${w.P}/csm/notices/${n.row.id}/send`, {});
    expect(sent.sent).toBe(2);
    const done = await w.get("customer_notice", n.row.id, lead.client);
    expect(done.state).toBe("sent");
    expect(done.recipient_count).toBe(2);
    await w.drain();
    // the customers read the notice they got; another account's contact does not
    await w.get("customer_notice", n.row.id, cust.client);
    await w.get("customer_notice", n.row.id, other.client, 404);
  });

  it("computes relationship health, the customer 360 and the next case", async () => {
    const h = await lead.client.post(`${w.P}/csm/health/refresh`, {});
    expect(h.accounts).toBeGreaterThanOrEqual(2);
    const a = await w.get("customer_account", acme.id, lead.client);
    expect(a.health_score).toBeGreaterThan(0);
    expect(a.health_status).not.toBe("unknown");
    const v = await agent.client.get(`${w.P}/csm/accounts/${acme.id}/360`);
    expect(v.contacts.length).toBe(2);
    expect(v.entitlements.length).toBe(1);
    expect(v.open_cases.length).toBeGreaterThan(0);
    await other.client.get(`${w.P}/csm/accounts/${acme.id}/360`, 404).catch(() => other.client.get(`${w.P}/csm/accounts/${acme.id}/360`, 403));
    const next = await agent.client.post(`${w.P}/csm/next`, {});
    expect(next.case?.assigned_to).toBe(agent.userId);
    const dash = await lead.client.get(`${w.P}/csm/dashboard`);
    expect(dash.created_30d).toBeGreaterThan(0);
  });
});
