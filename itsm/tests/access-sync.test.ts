// The access model on the Windows app's replica: an agent's desktop receives only what the agent may read (their
// groups' tickets under the need-to-know preset, never confidential rows of other groups, never fields of groups they
// lack); when a ticket leaves their scope it is tombstoned there; when their scope widens (a new group membership
// moves their scope epoch by trigger) the desktop reads everything again. The access tables themselves travel as
// reference data, so the desktop's own provider judges local reads the same way.
import { describe, it, expect, beforeAll } from "vitest";
import { TICKET } from "./fixtures/access";
import { makeServer, Client, quietLog } from "./helpers";
import { SyncClient } from "@local/sync-client";
import { defaultConfig } from "@local/config";
import type { DesktopBridge, ServerConfig } from "@server/context";
import { create, update, systemCtx } from "@server/engine";
import type { Db } from "@server/db";

const OWNER = { email: "access-sync-owner@example.com", password: "owner-pass-1405" };
const AGENT = { email: "access-sync-agent@example.com", password: "agent-pass-1405" };

describe("access-filtered synchronisation", () => {
  let cloudDb: Db;
  let deskDb: Db;
  let cloudCfg: ServerConfig;
  let web: Client;
  let local: Client;
  let client: SyncClient;
  let org = "";
  let agentId = "";
  const g: Record<"one" | "two", string> = { one: "", two: "" };
  const t: Record<"mine" | "other" | "conf", string> = { mine: "", other: "", conf: "" };

  const deskTickets = async () => (await deskDb.query<{ id: string }>(`select id from ${TICKET.table} where org_id = $1 and deleted_at is null`, [org])).map((r) => r.id).sort();

  beforeAll(async () => {
    const cloud = await makeServer();
    cloudDb = cloud.db;
    cloudCfg = { mode: "cloud", db: cloudDb, secret: "test-secret", allowSignup: true, platformAdmins: [], origin: "cloud", log: quietLog, fetch };
    web = new Client(cloud.app, "http://cloud.test");
    await web.post("/auth/signup", { ...OWNER, full_name: "مالک" });
    org = (await web.post<{ id: string }>("/orgs", { name: "سازمان هم‌گام دسترسی", timezone: "Asia/Tehran" })).id;
    const P = `/o/${org}`;
    await web.post(`${P}/members`, { ...AGENT, full_name: "کارشناس شبکه", role: "member" });
    agentId = (await cloudDb.one<{ id: string }>(`select id from sm_users where email = $1`, [AGENT.email]))!.id;
    await web.put(`${P}/access/settings`, { preset: "need_to_know" });
    g.one = (await web.post(`${P}/r/group`, { name: "شبکه" })).row.id;
    g.two = (await web.post(`${P}/r/group`, { name: "سرورها" })).row.id;
    await web.post(`${P}/access/groups/${g.one}/members`, { user_ids: [agentId] });
    await web.put(`${P}/access/members/${agentId}`, { roles: ["agent"] });
    const sys = await systemCtx(cloudCfg, org);
    t.mine = (await create(sys, "acc_ticket", { short_description: "قطعی شبکه", assignment_group_id: g.one, cost: "900", diagnosis: "کابل" })).row.id;
    t.other = (await create(sys, "acc_ticket", { short_description: "دیسک سرور", assignment_group_id: g.two })).row.id;
    t.conf = (await create(sys, "acc_ticket", { short_description: "محرمانه", assignment_group_id: g.two, confidential: true })).row.id;
    const desk = await makeServer({ mode: "desktop", config: { desktop: { notifyLocalWrite() {}, fetchBlob: async () => null } as unknown as DesktopBridge, secret: "desktop-secret" } });
    deskDb = desk.db;
    const cloudFetch = (async (u: RequestInfo | URL, init?: RequestInit) => cloud.app.fetch(new Request(String(u), init))) as typeof fetch;
    client = new SyncClient({ db: deskDb, config: defaultConfig(), save() {}, log: quietLog, fetch: cloudFetch });
    await client.link({ url: "http://cloud.test", ...AGENT, orgId: org, direction: "download" });
    local = new Client(desk.app, "http://desk.test");
    await local.post("/auth/login", AGENT);
  });

  it("pulls only the tickets the agent may read, without the fields they may not see", async () => {
    expect(await deskTickets()).toEqual([t.mine]);
    const row = await deskDb.one<{ cost: string | null; diagnosis: string | null }>(`select cost, diagnosis from ${TICKET.table} where id = $1`, [t.mine]);
    expect(row).toEqual({ cost: null, diagnosis: "کابل" });
    // the access tables travel as reference data: the desktop's provider judges the same way
    expect((await deskDb.query(`select id from sm_groups where org_id = $1`, [org])).length).toBe(2);
    const list = await local.get(`/o/${org}/r/acc_ticket`);
    expect(list.rows.map((r: { id: string }) => r.id)).toEqual([t.mine]);
    expect(list.rows[0]).not.toHaveProperty("cost");
  });

  it("tombstones a ticket that leaves the agent's scope", async () => {
    const sys = await systemCtx(cloudCfg, org);
    await update(sys, "acc_ticket", t.mine, { assignment_group_id: g.two });
    await client.syncNow();
    expect(await deskTickets()).toEqual([]);
  });

  it("reads everything again when a new membership widens the scope (the epoch moves by trigger)", async () => {
    const before = Number((await cloudDb.one<{ epoch: number }>(`select epoch from sm_scope_epochs where org_id = $1 and user_id = $2`, [org, agentId]))!.epoch);
    await web.post(`/o/${org}/access/groups/${g.two}/members`, { user_ids: [agentId] });
    const after = Number((await cloudDb.one<{ epoch: number }>(`select epoch from sm_scope_epochs where org_id = $1 and user_id = $2`, [org, agentId]))!.epoch);
    expect(after).toBeGreaterThan(before);
    await client.syncNow();
    // the confidential ticket of their (new) group comes too: group members read it
    expect(await deskTickets()).toEqual([t.conf, t.mine, t.other].sort());
    // the pull's epoch is the organisation's sync epoch and the member's scope epoch (SYNC_PROTOCOL 15)
    const orgEpoch = Number((await cloudDb.one<{ epoch: number }>(`select epoch from sm_org_sync where org_id = $1`, [org]))?.epoch ?? 0);
    expect(await deskDb.one<{ value: string }>(`select value from sm_kv where key = 'sync.epoch'`)).toMatchObject({ value: `${orgEpoch}.${after}` });
  });

  it("refuses a pushed change the agent may not make, and keeps hidden fields at the cloud's values", async () => {
    const sys = await systemCtx(cloudCfg, org);
    await update(sys, "acc_ticket", t.mine, { assignment_group_id: g.one });
    await client.syncNow();
    await local.patch(`/o/${org}/r/acc_ticket/${t.mine}`, { diagnosis: "سوئیچ" });
    await client.syncNow();
    const c = await cloudDb.one<{ cost: string; diagnosis: string }>(`select cost, diagnosis from ${TICKET.table} where id = $1`, [t.mine]);
    expect(c).toEqual({ cost: "900", diagnosis: "سوئیچ" });
  });
});
