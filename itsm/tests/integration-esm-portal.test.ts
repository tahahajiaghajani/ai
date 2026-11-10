// ESM, CSM and field service in the self-service portal (after the ESM and portal merges): the documented
// «departments» widget renders the sections the service modules register (departments with their services and
// catalogue items, a customer contact's account, a requester's field visits), department cases, customer cases and
// work orders appear in «درخواست‌های من» and on their ticket pages with the person's own access — a sensitive HR case
// under its neutral title — and «رزرو فضا» is a quick link for those who may book. Nobody else sees them.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_LAYOUT, PORTAL_WIDGETS } from "@shared/portal/logic";
import { esmWorld, memberAt, type EsmWorld } from "./esm-helpers";
import type { Client } from "./helpers";

vi.setConfig({ testTimeout: 180_000 });

const TOKEN = "esmPortalCanary9";

let w: EsmWorld;
let hrCase: Record<string, any>;
let cust: { client: Client; userId: string };
let custCase: Record<string, any>;
let wo: Record<string, any>;

beforeAll(async () => {
  w = await esmWorld();
  await w.o.post(`${w.P}/portal/seed`, {});
  await w.o.post(`${w.P}/csm/seed`, {});
  await w.o.post(`${w.P}/field_service/seed`, {});
  // a sensitive HR case of the employee (payslip: a sensitive service → neutral title)
  hrCase = (await w.p.emp.client.post(`${w.P}/r/hr_case`, { short_description: `کسر بیمه ${TOKEN}`, dept_service_id: w.svc.hr_payslip.id })).row;
  // a customer contact with an account and a case
  const lead = await memberAt(w.e, "portal.lead@example.com", "10.98.0.1");
  cust = await memberAt(w.e, "ali@portal-acme.example", "10.98.0.2");
  await w.o.put(`${w.P}/access/members/${lead.userId}`, { roles: ["csm_manager"], persona: "agent" });
  await w.o.put(`${w.P}/access/members/${cust.userId}`, { roles: ["requester"], persona: "requester" });
  const groups = (await w.o.get(`${w.P}/r/group?size=200`)).rows as { id: string; name: string }[];
  const group = groups.find((g) => g.name === "پشتیبانی مشتریان")!.id;
  await w.o.post(`${w.P}/access/groups/${group}/members`, { user_ids: [lead.userId] });
  const acme = (await lead.client.post(`${w.P}/r/customer_account`, { name: "شرکت آکمهٔ درگاه", code: "PACME", email_domain: "portal-acme.example", support_group_id: group, relationship_manager_id: lead.userId })).row;
  await lead.client.post(`${w.P}/r/customer_contact`, { name: "علی", email: "ali@portal-acme.example", user_id: cust.userId, account_id: acme.id, roles: ["customer", "user"] });
  custCase = (await cust.client.post(`${w.P}/r/customer_case`, { short_description: `گزارش باز نمی‌شود ${TOKEN}`, channel: "portal" })).row;
  // a work order for the employee (a visit to their desk)
  wo = (await w.o.post(`${w.P}/r/work_order`, { short_description: "تعمیر چاپگر میز", requested_for: w.p.emp.userId, caller_id: w.p.emp.userId, site_address: "طبقهٔ سوم" })).row;
  await w.drain();
}, 300_000);

describe("the «departments» widget", () => {
  it("is a documented widget type in the default layout", () => {
    expect(PORTAL_WIDGETS.departments.type).toBe("departments");
    expect(DEFAULT_LAYOUT.some((x) => x.type === "departments" && x.enabled)).toBe(true);
  });

  it("shows the employee the live departments with their services and catalogue items, and their open cases", async () => {
    const home = await w.p.emp.client.get(`${w.P}/portal/home`);
    const sections = home.sections as any[];
    const hr = sections.find((s) => s.key === "department:hr");
    expect(hr).toBeTruthy();
    expect(hr.kind).toBe("department");
    const payslip = (hr.services as any[]).find((s) => s.id === w.svc.hr_payslip.id);
    expect(payslip?.catalog_item_id).toBe(w.svc.hr_payslip.catalog_item_id);
    expect((hr.links as any[]).find((l) => l.key === "my-cases")?.count).toBeGreaterThanOrEqual(1);
    // the same sections as ESM's own registration endpoint
    const direct = await w.p.emp.client.get(`${w.P}/esm/portal/sections`);
    expect((direct.sections as any[]).map((s) => s.key).sort()).toEqual(sections.map((s) => s.key).sort());
    // the field visit of the employee, with its appointment link, and no case text anywhere
    const field = sections.find((s) => s.key === "field:customer");
    expect(field?.links.some((l: any) => l.path === `field/work-orders/${wo.id}`)).toBe(true);
    expect(JSON.stringify(sections)).not.toContain(TOKEN);
  });

  it("shows a customer contact their account section; nobody else", async () => {
    const home = await cust.client.get(`${w.P}/portal/home`);
    const acc = (home.sections as any[]).find((s) => s.kind === "customer");
    expect(acc?.title).toBeTruthy();
    expect(acc.links.find((l: any) => l.key === "cases")?.count).toBeGreaterThanOrEqual(1);
    for (const who of ["emp", "it", "hr"] as const) {
      const other = await w.p[who].client.get(`${w.P}/portal/home`);
      expect((other.sections as any[]).some((s) => s.kind === "customer"), who).toBe(false);
    }
  });

  it("is left out when the widget is off", async () => {
    const portal = ((await w.o.get(`${w.P}/r/portal?size=5`)).rows as any[])[0];
    const layout = (portal.published_layout ?? DEFAULT_LAYOUT).map((x: any) => (x.type === "departments" ? { ...x, enabled: false } : x));
    await w.e.db.query(`update sm_portals set published_layout = $1::jsonb where id = $2`, [JSON.stringify(layout), portal.id]);
    const home = await w.p.emp.client.get(`${w.P}/portal/home`);
    expect(home.sections).toEqual([]);
    await w.e.db.query(`update sm_portals set published_layout = $1::jsonb where id = $2`, [JSON.stringify(portal.published_layout ?? DEFAULT_LAYOUT), portal.id]);
  });
});

describe("«درخواست‌های من» and ticket pages", () => {
  it("lists the employee's HR case under its neutral title, and their work order", async () => {
    const items = (await w.p.emp.client.get(`${w.P}/portal/items?tab=mine&state=all`)).items as any[];
    const hr = items.find((i) => i.id === hrCase.id);
    expect(hr?.table).toBe("hr_case");
    expect(hr.title).toBe("پروندهٔ محرمانه");
    expect(items.some((i) => i.id === wo.id && i.table === "work_order")).toBe(true);
    const ticket = await w.p.emp.client.get(`${w.P}/portal/tickets/hr_case/${hrCase.id}`);
    expect(JSON.stringify(ticket)).toContain(hrCase.number);
  });

  it("lists the customer's case for the contact", async () => {
    const items = (await cust.client.get(`${w.P}/portal/items?tab=mine&state=all`)).items as any[];
    expect(items.some((i) => i.id === custCase.id && i.table === "customer_case")).toBe(true);
    await cust.client.get(`${w.P}/portal/tickets/customer_case/${custCase.id}`);
  });

  // (the manager sees the work order in «تیم من», as for any IT record of a reportee — never an HR or customer case)
  it("shows them to nobody else (IT, the IT administrator, the auditor, the manager)", async () => {
    for (const who of ["it", "admin", "auditor", "mgr", "fac"] as const) {
      const c = w.p[who].client;
      for (const tab of ["mine", "shared", "team"]) {
        const page = await c.get(`${w.P}/portal/items?tab=${tab}&state=all`).catch(() => ({ items: [] }));
        const s = JSON.stringify(page);
        for (const x of [hrCase.id, custCase.id, TOKEN]) expect(s, `${who} ${tab}`).not.toContain(x);
      }
      for (const [table, id] of [["hr_case", hrCase.id], ["customer_case", custCase.id]]) {
        const r = await c.req("GET", `${w.P}/portal/tickets/${table}/${id}`, undefined, undefined as never).catch((e: Error) => e);
        expect(r instanceof Error && /→ (403|404)/.test(r.message), `${who} ${table}`).toBe(true);
      }
    }
  });

  it("lets the work order's requester see free appointment slots (the slots panel's capability)", async () => {
    const meta = await w.p.emp.client.get(`${w.P}/r/work_order/${wo.id}`);
    expect(meta.meta?.field?.can_book).toBe(true);
    await w.p.emp.client.get(`${w.P}/field_service/work-orders/${wo.id}/slots`);
    await w.p.it.client.get(`${w.P}/field_service/work-orders/${wo.id}/slots`, 404);
  });
});

describe("quick links", () => {
  it("offers «رزرو فضا» to those who may book a space", async () => {
    const home = await w.p.emp.client.get(`${w.P}/portal/home`);
    const mayBook = await w.p.emp.client.get(`${w.P}/r/reservation?size=1`).then(() => true, () => false);
    const link = (home.links as any[]).find((l) => l.url === "facilities/book" || l.id === "esm.book_space");
    if (mayBook) expect(link?.internal).toBe(true);
    else expect(link).toBeUndefined();
  });
});
