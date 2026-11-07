// The access model end to end through the HTTP API: an organisation with two companies (domains), departments,
// IT and HR (secure) workspaces, nested, restricted and vendor groups, and members holding the built-in roles. Covers
// who reads and changes which tickets (own, group, unit tree, workspaces, domains, confidential rows, restricted
// groups, delegates), field security on every read path, the requester rules, scope epochs, the role catalogue API,
// the access checker, org trees and support sessions.
import { describe, it, expect, beforeAll } from "vitest";
import "./fixtures/access";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { Client } from "./helpers";
import { registerTable } from "@shared/tables";
import { create, update, systemCtx } from "@server/engine";
import type { Ctx } from "@server/context";

// an HR-area table: HR agents read their groups' cases, confidential ones with the hr field group
registerTable({
  key: "acc_case",
  table: "sm_acc_cases",
  label: "پرونده",
  plural: "پرونده‌ها",
  icon: "folder",
  module: "test",
  area: "hr",
  extends: "task",
  display: "short_description",
  fields: [{ name: "salary_note", label: "یادداشت حقوق", type: "string", group: "hr" }],
  scope: {},
  features: { confidential: true },
});

type Who = "req" | "mgr" | "agent" | "lead" | "hr" | "vendor" | "auditor" | "agentB" | "outsider" | "uadmin";

let e: EngineOrg;
let P = "";
let sys: Ctx;
const p = {} as Record<Who, { client: Client; userId: string }>;
const u = {} as Record<"co" | "a" | "a1" | "co2" | "b", string>;
const g = {} as Record<"it" | "itChild" | "hr" | "secret" | "vendor", string>;
const ws = {} as Record<"it" | "hr", string>;
const t = {} as Record<"own" | "it" | "child" | "secureWs" | "restricted" | "vendor" | "global" | "conf" | "reqConf", string>;

const ticket = async (data: Record<string, unknown>) => (await create(sys, "acc_ticket", { short_description: "تیکت آزمایشی", ...data })).row.id as string;
/** Which of the fixture tickets `who` sees in their list (records made by other tests are left out). */
const seen = async (who: Who) => {
  const r = await p[who].client.get(`${P}/r/acc_ticket?size=500&total=false`);
  const fixture = new Set(Object.values(t));
  return new Set<string>(r.rows.map((x: { id: string }) => x.id).filter((id: string) => fixture.has(id)));
};
const ids = (...keys: (keyof typeof t)[]) => new Set(keys.map((k) => t[k]));
const epoch = async (userId: string) => Number((await e.db.one<{ epoch: number }>(`select epoch from sm_scope_epochs where org_id = $1 and user_id = $2`, [e.org, userId]))?.epoch ?? 0);

beforeAll(async () => {
  e = await engineOrg();
  P = `/o/${e.org}`;
  const o = e.owner;
  ws.it = (await o.post(`${P}/r/workspace`, { key: "it", name: "فناوری اطلاعات", is_default: true })).row.id;
  ws.hr = (await o.post(`${P}/r/workspace`, { key: "hr", name: "منابع انسانی", secure: true })).row.id;
  const unit = async (name: string, parent: string | null, extra: Record<string, unknown> = {}) => (await o.post(`${P}/r/org_unit`, { name, parent_id: parent, ...extra })).row.id as string;
  u.co = await unit("شرکت الف", null, { kind: "company", is_domain: true });
  u.a = await unit("ادارهٔ الف", u.co);
  u.a1 = await unit("تیم الف۱", u.a, { kind: "team" });
  u.co2 = await unit("شرکت ب", null, { kind: "company", is_domain: true });
  u.b = await unit("ادارهٔ ب", u.co2);
  for (const k of ["req", "mgr", "agent", "lead", "hr", "vendor", "auditor", "agentB", "outsider", "uadmin"] as Who[]) p[k] = await e.member("member", `${k}@example.com`);
  const group = async (name: string, workspace: string | null, extra: Record<string, unknown> = {}) => (await o.post(`${P}/r/group`, { name, workspace_id: workspace, ...extra })).row.id as string;
  g.it = await group("پشتیبانی فنی", ws.it);
  g.itChild = await group("شبکه", ws.it, { parent_id: g.it });
  g.hr = await group("پرونده‌های کارکنان", ws.hr);
  g.secret = await group("حراست", ws.it, { restricted: true });
  g.vendor = await group("پیمانکار چاپگر", null);
  await o.post(`${P}/access/groups/${g.it}/members`, { user_ids: [p.agent.userId, p.agentB.userId] });
  await o.post(`${P}/access/groups/${g.it}/members`, { user_ids: [p.lead.userId], kind: "lead" });
  await o.post(`${P}/access/groups/${g.hr}/members`, { user_ids: [p.hr.userId] });
  await o.post(`${P}/access/groups/${g.vendor}/members`, { user_ids: [p.vendor.userId] });
  const set = (k: Who, body: Record<string, unknown>) => o.put(`${P}/access/members/${p[k].userId}`, body);
  await set("req", { roles: ["requester"], persona: "requester", org_unit_id: u.a1, manager_id: p.mgr.userId });
  await set("mgr", { roles: ["requester"], persona: "requester", org_unit_id: u.a });
  await o.patch(`${P}/r/org_unit/${u.a}`, { manager_id: p.mgr.userId });
  await set("agent", { roles: ["agent"], persona: "agent", org_unit_id: u.a });
  await set("lead", { roles: ["team_lead"], persona: "agent", org_unit_id: u.a });
  await set("hr", { roles: ["hr_agent"], persona: "agent", workspaces: [ws.hr] });
  await set("vendor", { roles: ["vendor_agent"], persona: "agent" });
  await set("auditor", { roles: ["auditor"], persona: "agent" });
  await set("agentB", { roles: ["agent"], persona: "agent", org_unit_id: u.b });
  await set("outsider", { roles: ["requester"], persona: "requester", org_unit_id: u.b });
  sys = await systemCtx(e.cfg, e.org);
  t.own = await ticket({ caller_id: p.req.userId });
  t.it = await ticket({ caller_id: p.outsider.userId, assignment_group_id: g.it, workspace_id: ws.it });
  t.child = await ticket({ caller_id: p.outsider.userId, assignment_group_id: g.itChild, workspace_id: ws.it });
  t.secureWs = await ticket({ caller_id: p.outsider.userId, assignment_group_id: g.it, workspace_id: ws.hr });
  t.restricted = await ticket({ caller_id: p.outsider.userId, assignment_group_id: g.secret, workspace_id: ws.it });
  t.vendor = await ticket({ caller_id: p.outsider.userId, assignment_group_id: g.vendor });
  t.global = await ticket({ caller_id: p.outsider.userId });
  t.conf = await ticket({ caller_id: p.outsider.userId, assignment_group_id: g.itChild, workspace_id: ws.it, confidential: true, access_list: [p.auditor.userId] });
  t.reqConf = await ticket({ caller_id: p.req.userId, assignment_group_id: g.itChild, confidential: true });
});

describe("records each built-in role reads", () => {
  it("anchors records to their requester's unit and domain", async () => {
    const own = await e.db.one<{ unit_id: string; domain_id: string }>(`select unit_id, domain_id from sm_acc_tickets where id = $1`, [t.own]);
    expect(own).toEqual({ unit_id: u.a1, domain_id: u.co });
    const it = await e.db.one<{ unit_id: string; domain_id: string }>(`select unit_id, domain_id from sm_acc_tickets where id = $1`, [t.it]);
    expect(it).toEqual({ unit_id: u.b, domain_id: u.co2 });
  });

  it("requester: own records only; department head and line manager: their people's (not confidential ones)", async () => {
    expect(await seen("req")).toEqual(ids("own", "reqConf"));
    expect(await seen("mgr")).toEqual(ids("own"));
    expect(await seen("outsider")).toEqual(ids("it", "child", "secureWs", "restricted", "vendor", "global", "conf"));
  });

  it("agent (open desk): every record of their workspaces and global ones, never secure workspaces, restricted groups or others' confidential rows", async () => {
    expect(await seen("agent")).toEqual(ids("own", "it", "child", "vendor", "global"));
    expect(await seen("agentB")).toEqual(ids("own", "it", "child", "vendor", "global"));
  });

  it("team lead: also the groups below the groups they lead, confidential rows of those groups included", async () => {
    expect(await seen("lead")).toEqual(ids("own", "it", "child", "vendor", "global", "conf", "reqConf"));
  });

  it("vendor agent: only records assigned to their groups", async () => {
    expect(await seen("vendor")).toEqual(ids("vendor"));
  });

  it("auditor: everything but secure workspaces, restricted groups and confidential rows (unless on the access list)", async () => {
    expect(await seen("auditor")).toEqual(ids("own", "it", "child", "vendor", "global", "conf"));
  });

  it("unreadable records are 404, not 403", async () => {
    await p.req.client.get(`${P}/r/acc_ticket/${t.it}`, 404);
    await p.vendor.client.get(`${P}/r/acc_ticket/${t.global}`, 404);
  });

  it("HR agents read their HR cases (in their secure workspace) with the hr fields", async () => {
    const hrCase = (await create(sys, "acc_case", { short_description: "پرونده", caller_id: p.outsider.userId, assignment_group_id: g.hr, workspace_id: ws.hr, confidential: true, salary_note: "محرمانه" })).row.id;
    const r = await p.hr.client.get(`${P}/r/acc_case/${hrCase}`);
    expect(r.row.salary_note).toBe("محرمانه");
    // an IT agent is a requester in the hr area: their own cases only; others' do not exist for them
    expect((await p.agent.client.get(`${P}/r/acc_case`)).rows).toEqual([]);
    await p.agent.client.get(`${P}/r/acc_case/${hrCase}`, 404);
    // the vendor agent has no grant in the hr area at all: the list is refused
    await p.vendor.client.get(`${P}/r/acc_case`, 403);
    await e.owner.get(`${P}/r/acc_case/${hrCase}`, 404); // tenant admin: secure workspace, confidential row
  });
});

describe("writes", () => {
  it("agents change the records of their groups only; leads also the groups below", async () => {
    await p.agent.client.patch(`${P}/r/acc_ticket/${t.it}`, { diagnosis: "کابل" });
    await p.agent.client.patch(`${P}/r/acc_ticket/${t.child}`, { diagnosis: "سوئیچ" }, 403);
    await p.lead.client.patch(`${P}/r/acc_ticket/${t.child}`, { diagnosis: "سوئیچ" });
    await p.auditor.client.patch(`${P}/r/acc_ticket/${t.it}`, { diagnosis: "x" }, 403);
    await p.vendor.client.patch(`${P}/r/acc_ticket/${t.vendor}`, { short_description: "تعویض کارتریج" });
    const meta = (await p.agent.client.get(`${P}/r/acc_ticket/${t.child}`)).meta;
    expect(meta.canWrite).toBe(false);
  });

  it("an agent assigns only to groups of their workspaces", async () => {
    await p.agent.client.patch(`${P}/r/acc_ticket/${t.it}`, { assignment_group_id: g.hr }, 403);
    const moved = await ticket({ caller_id: p.outsider.userId, assignment_group_id: g.it, workspace_id: ws.it });
    await p.agent.client.patch(`${P}/r/acc_ticket/${moved}`, { assignment_group_id: g.itChild });
    // a hand-off: still readable (open desk), no longer the agent's to change
    expect((await p.agent.client.get(`${P}/r/acc_ticket/${moved}`)).meta.canWrite).toBe(false);
  });

  it("requesters change only the whitelist of their own records and take only the requester transitions", async () => {
    const r = await p.req.client.patch(`${P}/r/acc_ticket/${t.own}`, { description: "هنوز کار نمی‌کند", urgency: "1" });
    expect(r.row.description).toBe("هنوز کار نمی‌کند");
    const refused = await p.req.client.patch(`${P}/r/acc_ticket/${t.own}`, { priority: "1" }, 403);
    expect(refused.error.code).toBe("forbidden_field");
    expect(refused.error.message).toMatch(/اجازهٔ تغییر/);
    expect(r.meta.readonly).toContain("priority");
    expect(r.meta.transitions.map((x: { to: string }) => x.to)).toEqual(["canceled"]);
    await p.req.client.post(`${P}/r/acc_ticket/${t.own}/transition`, { to: "in_progress" }, 403);
    await p.req.client.post(`${P}/r/acc_ticket/${t.own}/journal`, { kind: "comment", body: "پیگیری" });
    await p.req.client.post(`${P}/r/acc_ticket/${t.own}/journal`, { kind: "work_note", body: "یادداشت" }, 403);
  });

  it("requesters file for themselves or their people; agents for anyone", async () => {
    const mine = (await p.req.client.post(`${P}/r/acc_ticket`, { short_description: "درخواست من" })).row;
    expect(mine.caller_id).toBe(p.req.userId);
    await p.req.client.post(`${P}/r/acc_ticket`, { short_description: "برای دیگری", caller_id: p.agent.userId }, 403);
    await p.mgr.client.post(`${P}/r/acc_ticket`, { short_description: "برای کارمندم", caller_id: p.req.userId });
    await p.agent.client.post(`${P}/r/acc_ticket`, { short_description: "از طرف کاربر", caller_id: p.outsider.userId });
  });

  it("a delegate works the records of an absent colleague", async () => {
    const assigned = await ticket({ caller_id: p.outsider.userId, assigned_to: p.vendor.userId, assignment_group_id: g.secret });
    await p.agentB.client.get(`${P}/r/acc_ticket/${assigned}`, 404);
    await e.owner.put(`${P}/access/members/${p.vendor.userId}`, { out_of_office: true, delegate_id: p.agentB.userId });
    await p.agentB.client.patch(`${P}/r/acc_ticket/${assigned}`, { diagnosis: "در غیاب همکار" });
    await e.owner.put(`${P}/access/members/${p.vendor.userId}`, { out_of_office: false });
    await p.agentB.client.get(`${P}/r/acc_ticket/${assigned}`, 404);
  });
});

describe("field security on every read path", () => {
  it("strips fields of groups the caller lacks from records and lists", async () => {
    await update(sys, "acc_ticket", t.it, { cost: "1250000", salary_note: "-" });
    // the owner (tenant admin) has no hr field group: writing it is refused with a Persian message
    const refused = await e.owner.patch(`${P}/r/acc_ticket/${t.it}`, { salary_note: "x" }, 403);
    expect(refused.error.code).toBe("forbidden_field");
    const agent = (await p.agent.client.get(`${P}/r/acc_ticket/${t.it}`)).row;
    expect(agent).toHaveProperty("diagnosis");
    expect(agent).not.toHaveProperty("cost");
    expect(agent).not.toHaveProperty("salary_note");
    const auditor = (await p.auditor.client.get(`${P}/r/acc_ticket/${t.it}`)).row;
    expect(auditor.cost).toBe("1250000");
    expect(auditor).not.toHaveProperty("salary_note");
    const req = (await p.req.client.get(`${P}/r/acc_ticket/${t.own}`)).row;
    expect(req).not.toHaveProperty("diagnosis");
    const list = await p.agent.client.get(`${P}/r/acc_ticket?fields=number,cost,diagnosis`, 200).catch(() => null);
    if (list) for (const row of list.rows) expect(row).not.toHaveProperty("cost");
    const meta = await p.agent.client.get(`${P}/meta/tables/acc_ticket`);
    expect(meta.table.fields.map((f: { name: string }) => f.name)).not.toContain("cost");
  });

  it("refuses filters and groupings on hidden fields, and strips them from exports", async () => {
    await p.req.client.post(`${P}/r/acc_ticket/query`, { filter: { f: "diagnosis", op: "nempty" } }, 400);
    await p.req.client.post(`${P}/r/acc_ticket/agg`, { groupBy: ["diagnosis"] }, 400);
    const agg = await p.agent.client.post(`${P}/r/acc_ticket/agg`, { groupBy: ["diagnosis"] });
    expect(agg.rows.length).toBeGreaterThan(0);
    const exp = await p.agent.client.post(`${P}/r/acc_ticket/export`, { fields: ["number", "short_description", "cost", "diagnosis"] });
    expect(exp.columns.map((c: { name: string }) => c.name)).toEqual(["number", "short_description", "diagnosis"]);
  });

  it("history leaves out hidden fields; the journal leaves out internal notes for requesters", async () => {
    const hist = await p.agent.client.get(`${P}/r/acc_ticket/${t.it}/history`);
    expect(hist.entries.some((x: { field: string }) => x.field === "cost")).toBe(false);
    const audHist = await p.auditor.client.get(`${P}/r/acc_ticket/${t.it}/history`);
    expect(audHist.entries.some((x: { field: string }) => x.field === "cost")).toBe(true);
    // whoever reads a record may comment on it; internal notes need the internal field group and stay internal
    await p.agent.client.post(`${P}/r/acc_ticket/${t.own}/journal`, { kind: "work_note", body: "بررسی داخلی" });
    const forReq = await p.req.client.get(`${P}/r/acc_ticket/${t.own}/journal`);
    expect(forReq.entries.some((x: { kind: string }) => x.kind === "work_note")).toBe(false);
    const forAgent = await p.agent.client.get(`${P}/r/acc_ticket/${t.own}/journal`);
    expect(forAgent.entries.some((x: { kind: string }) => x.kind === "work_note")).toBe(true);
  });

  it("display values leave out records the caller may not read", async () => {
    await e.owner.patch(`${P}/r/acc_ticket/${t.own}`, { parent_id: t.it });
    const r = await p.req.client.get(`${P}/r/acc_ticket/${t.own}`);
    expect(r.row.parent_id).toBe(t.it);
    expect(r.display[t.it]).toBeUndefined();
    const a = await p.agent.client.get(`${P}/r/acc_ticket/${t.own}`);
    expect(a.display[t.it]).toMatch(/TKT/);
  });
});

describe("workspaces and domains", () => {
  it("domain separation: members see their domain's records (and global ones) unless a role reaches every domain", async () => {
    await e.owner.put(`${P}/access/settings`, { domain_separation: true });
    try {
      expect(await seen("agent")).toEqual(ids("own"));
      expect(await seen("agentB")).toEqual(ids("it", "child", "vendor", "global"));
      expect(await seen("auditor")).toEqual(ids("own", "it", "child", "vendor", "global", "conf"));
      expect(await seen("req")).toEqual(ids("own", "reqConf"));
    } finally {
      await e.owner.put(`${P}/access/settings`, { domain_separation: false });
    }
  });

  it("the need-to-know preset narrows agents to their groups", async () => {
    await e.owner.put(`${P}/access/settings`, { preset: "need_to_know" });
    try {
      expect(await seen("agent")).toEqual(ids("it"));
    } finally {
      await e.owner.put(`${P}/access/settings`, { preset: "open" });
    }
    expect(await seen("agent")).toEqual(ids("own", "it", "child", "vendor", "global"));
  });
});

describe("scope epochs", () => {
  it("move for a member when their groups, profile or the roles change", async () => {
    const before = await epoch(p.outsider.userId);
    await e.owner.post(`${P}/access/groups/${g.vendor}/members`, { user_ids: [p.outsider.userId] });
    const afterGroup = await epoch(p.outsider.userId);
    expect(afterGroup).toBeGreaterThan(before);
    await e.owner.put(`${P}/access/members/${p.outsider.userId}`, { title: "کارمند" });
    expect(await epoch(p.outsider.userId)).toBe(afterGroup); // not what they may read
    await e.owner.put(`${P}/access/members/${p.outsider.userId}`, { org_unit_id: u.a });
    expect(await epoch(p.outsider.userId)).toBeGreaterThan(afterGroup);
    const everyone = await epoch(p.req.userId);
    await e.owner.put(`${P}/access/roles/custom_epoch`, { name: "نقش آزمایشی", persona: "agent", grants: { work: { read: "own" } }, field_groups: [], contains: [], workspaces: "member", domains: "own" });
    expect(await epoch(p.req.userId)).toBeGreaterThan(everyone);
  });
});

describe("the role catalogue", () => {
  it("lists the built-in roles, stores an organisation's version with its diff, and resets it", async () => {
    const list = (await e.owner.get(`${P}/access/roles`)).roles;
    const agent = list.find((r: { key: string }) => r.key === "agent");
    expect(agent).toMatchObject({ builtin: true, modified: false, diff: [] });
    expect(agent.holders).toBeGreaterThanOrEqual(2);
    const changed = await e.owner.put(`${P}/access/roles/agent`, { ...agent, grants: { ...agent.grants, incident: { read: "group", create: true, write: "group" } } });
    expect(changed.role.modified).toBe(true);
    expect(changed.role.diff).toContainEqual({ what: "grant", area: "incident", op: "read", from: "all", to: "group" });
    expect(await seen("agent")).toEqual(ids("it"));
    await e.owner.post(`${P}/access/roles/agent/reset`);
    const back = (await e.owner.get(`${P}/access/roles`)).roles.find((r: { key: string }) => r.key === "agent");
    expect(back.modified).toBe(false);
    expect(await seen("agent")).toEqual(ids("own", "it", "child", "vendor", "global"));
  });

  it("refuses containment loops and unknown roles", async () => {
    const base = { persona: "agent", grants: {}, field_groups: [], workspaces: "member", domains: "own" };
    await e.owner.put(`${P}/access/roles/night_shift`, { ...base, name: "شیفت شب", contains: ["agent"] });
    const loop = await e.owner.put(`${P}/access/roles/agent`, { ...base, name: "کارشناس", contains: ["night_shift"] }, 400);
    expect(loop.error.message).toMatch(/دور/);
    await e.owner.put(`${P}/access/roles/x_role`, { ...base, name: "x", contains: ["ghost"] }, 400);
    await e.owner.put(`${P}/access/members/${p.outsider.userId}`, { roles: ["ghost"] }, 400);
  });

  it("nobody grants or defines access above their own, or changes their own roles", async () => {
    // a user-access administrator: manages users (and org), works as an agent
    await e.owner.put(`${P}/access/roles/access_admin`, {
      name: "مدیر دسترسی", persona: "admin", grants: { users: { read: "all", create: true, write: "all", admin: true }, org: { read: "all", create: true, write: "all" } },
      field_groups: [], contains: ["agent"], workspaces: "member", domains: "own",
    });
    await e.owner.put(`${P}/access/members/${p.uadmin.userId}`, { roles: ["access_admin"] });
    const ua = p.uadmin.client;
    await ua.put(`${P}/access/members/${p.outsider.userId}`, { roles: ["agent"] });
    const above = await ua.put(`${P}/access/members/${p.outsider.userId}`, { roles: ["tenant_admin"] }, 403);
    expect(above.error.message).toMatch(/بیشتر از دسترسی خودتان/);
    await ua.put(`${P}/access/members/${p.uadmin.userId}`, { roles: ["access_admin", "auditor"] }, 403);
    await ua.put(`${P}/access/roles/super`, { name: "فرا", persona: "admin", grants: { "*": { read: "all", write: "all", delete: "all" } }, field_groups: [], contains: [], workspaces: "all", domains: "all" }, 403);
    await p.lead.client.put(`${P}/access/roles/super`, { name: "فرا", persona: "agent", grants: {}, field_groups: [], contains: [], workspaces: "member", domains: "own" }, 403);
    await e.owner.put(`${P}/access/members/${p.outsider.userId}`, { roles: ["requester"] });
  });
});

describe("the access checker", () => {
  it("explains why a member can or cannot read a record, layer by layer, and agrees with SQL", async () => {
    const yes = await e.owner.post(`${P}/access/check`, { user_id: p.req.userId, table: "acc_ticket", record_id: t.own });
    expect(yes.record.explanation).toMatchObject({ read: true, via: "own", write: "requester" });
    expect(yes.record.sql_read).toBe(true);
    expect(yes.record.writable_fields).toEqual(["description", "urgency", "watch_list"]);
    expect(yes.hidden_fields.map((f: { name: string }) => f.name).sort()).toEqual(["cost", "diagnosis", "salary_note"]);
    const no = await e.owner.post(`${P}/access/check`, { user_id: p.vendor.userId, table: "acc_ticket", record_id: t.it });
    expect(no.record.explanation.read).toBe(false);
    expect(no.record.sql_read).toBe(false);
    expect(no.record.explanation.layers.find((l: { key: string }) => l.key === "scope").ok).toBe(false);
    // a record the checking admin may not read (confidential, no security clearance) is not explained
    await e.owner.post(`${P}/access/check`, { user_id: p.agent.userId, table: "acc_ticket", record_id: t.conf }, 404);
    const table = await e.owner.post(`${P}/access/check`, { user_id: p.vendor.userId, table: "acc_ticket" });
    expect(table.grant).toMatchObject({ read: "group", write: "group", create: false });
    await p.agent.client.post(`${P}/access/check`, { user_id: p.req.userId, table: "acc_ticket" }, 403);
  });

  it("reports the caller's own effective access", async () => {
    const me = await p.lead.client.get(`${P}/access/me`);
    expect(me.roles).toEqual(["agent", "requester", "team_lead"]);
    expect(me.grants.incident).toMatchObject({ read: "all", write: "group", approve: true });
    expect(me.groups).toContain(g.itChild);
    expect(me.led_groups).toEqual([g.it]);
    expect(me.legacy).toBe(false);
  });
});

describe("org structure", () => {
  it("keeps materialised paths through moves, refuses cycles and deleting a unit with children", async () => {
    const path = async (id: string) => (await e.db.one<{ path: string }>(`select path from sm_org_units where id = $1`, [id]))!.path;
    expect(await path(u.a1)).toBe(`/${u.co}/${u.a}/${u.a1}/`);
    const x = (await e.owner.post(`${P}/r/org_unit`, { name: "واحد موقت", parent_id: u.co })).row.id;
    const y = (await e.owner.post(`${P}/r/org_unit`, { name: "زیرواحد موقت", parent_id: x })).row.id;
    await e.owner.patch(`${P}/r/org_unit/${x}`, { parent_id: u.co2 });
    expect(await path(y)).toBe(`/${u.co2}/${x}/${y}/`);
    const loop = await e.owner.patch(`${P}/r/org_unit/${x}`, { parent_id: y }, 400);
    expect(loop.error.message).toMatch(/زیرمجموعه/);
    await e.owner.del(`${P}/r/org_unit/${x}`, 409);
    await e.owner.del(`${P}/r/org_unit/${y}`);
    await e.owner.del(`${P}/r/org_unit/${x}`);
    // requesters read the structure, only admins change it
    await p.req.client.get(`${P}/r/org_unit/${u.a}`);
    await p.req.client.patch(`${P}/r/org_unit/${u.a}`, { name: "نام دیگر" }, 403);
  });

  it("moving a requester to another unit re-anchors their new records, keeps old ones", async () => {
    await e.owner.put(`${P}/access/members/${p.outsider.userId}`, { org_unit_id: u.b });
    const r = (await p.outsider.client.post(`${P}/r/acc_ticket`, { short_description: "پس از جابه‌جایی" })).row;
    const row = await e.db.one<{ unit_id: string; domain_id: string }>(`select unit_id, domain_id from sm_acc_tickets where id = $1`, [r.id]);
    expect(row).toEqual({ unit_id: u.b, domain_id: u.co2 });
    // changing the requester of a record re-anchors it
    await e.owner.patch(`${P}/r/acc_ticket/${r.id}`, { caller_id: p.req.userId });
    expect(await e.db.one(`select unit_id, domain_id from sm_acc_tickets where id = $1`, [r.id])).toEqual({ unit_id: u.a1, domain_id: u.co });
  });
});

describe("support sessions", () => {
  it("«مشاهده» reads, «مشاهده و اصلاح» changes, neither passes secure workspaces or restricted groups", async () => {
    const other = new Client(e.app);
    await other.post("/auth/signup", { email: "other-owner@example.com", password: "other-pass-1", full_name: "مالک دیگر" });
    const org2 = (await other.post<{ id: string }>("/orgs", { name: "سازمان دیگر" })).id;
    const Q = `/o/${org2}`;
    const secure = (await other.post(`${Q}/r/workspace`, { key: "sec", name: "امن", secure: true })).row.id;
    const open = (await other.post(`${Q}/r/acc_ticket`, { short_description: "عمومی", cost: "10" })).row.id;
    const hidden = (await other.post(`${Q}/r/acc_ticket`, { short_description: "امن", workspace_id: secure })).row.id;
    await e.owner.get(`${Q}/r/acc_ticket`, 403);
    const { session } = await e.owner.post(`/admin/orgs/${org2}/support`, { level: "view", reason: "بررسی دسترسی‌ها" });
    const list = await e.owner.get(`${Q}/r/acc_ticket`);
    expect(list.rows.map((x: { id: string }) => x.id)).toEqual([open]);
    expect(list.rows[0].cost).toBe("10");
    await e.owner.post(`${Q}/r/acc_ticket`, { short_description: "x" }, 403);
    await e.owner.post(`/admin/support/${session.id}/end`);
    const edit = (await e.owner.post(`/admin/orgs/${org2}/support`, { level: "edit", reason: "اصلاح داده‌ها" })).session;
    await e.owner.patch(`${Q}/r/acc_ticket/${open}`, { short_description: "اصلاح‌شده" });
    await e.owner.get(`${Q}/r/acc_ticket/${hidden}`, 404);
    await e.owner.put(`${Q}/access/members/${(await other.get("/auth/me")).user.id}`, { roles: ["agent"] }, 403);
    await e.owner.post(`/admin/support/${edit.id}/end`);
  });
});
