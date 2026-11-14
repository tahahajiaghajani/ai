// Security rules of the platform: organisations never reach each other's records or accounts, the Windows
// installation's administration stays with its administrators, request parsing never turns into a server error,
// platform administrators are who the owner configured, and a desktop receives only the password hashes it may hold.
import { describe, it, expect, beforeAll } from "vitest";
import { createHmac } from "node:crypto";
import "./fixtures/module";
import { makeServer, Client, signupWithOrg } from "./helpers";
import type { Db } from "@server/db";
import { SYNC_PROTOCOL } from "@shared/constants";
import type { DesktopBridge } from "@server/context";

type App = { fetch: (r: Request) => Response | Promise<Response> };

describe("cross-organisation access", () => {
  let app: App;
  let db: Db;
  let victim: Client;
  let attacker: Client;
  let victimOrg: string;
  let attackerOrg: string;
  beforeAll(async () => {
    const s = await makeServer();
    app = s.app;
    db = s.db;
    victim = new Client(app);
    victimOrg = await signupWithOrg(victim); // owner@example.com, the first account (platform admin)
    attacker = new Client(app);
    await attacker.post("/auth/signup", { email: "mallory@example.com", password: "mallory-pass-1", full_name: "مهاجم" });
    attackerOrg = (await attacker.post<{ id: string }>("/orgs", { name: "شرکت مهاجم" })).id;
  });

  it("does not let an organisation reset the password of a user who belongs to other organisations", async () => {
    // any signed-up user can add an existing account to their own organisation by email…
    const { user_id } = await attacker.post(`/o/${attackerOrg}/members`, { email: "owner@example.com", full_name: "قربانی", role: "viewer" });
    const { members } = await attacker.get(`/o/${attackerOrg}/members`);
    const m = members.find((x: { user_id: string }) => x.user_id === user_id);
    // …but must not be able to take that account over
    await attacker.post(`/o/${attackerOrg}/members/${m.id}/password`, { password: "taken-over-1" }, 403);
    const fresh = new Client(app);
    await fresh.post("/auth/login", { email: "owner@example.com", password: "taken-over-1" }, 401);
    await fresh.post("/auth/login", { email: "owner@example.com", password: "s3cret-pass" });
    await victim.get("/auth/me");
  });

  it("still resets the password of a member who only works for this organisation", async () => {
    await victim.post(`/o/${victimOrg}/members`, { email: "clerk@example.com", full_name: "کارمند", role: "member", password: "clerk-pass-1" });
    const { members } = await victim.get(`/o/${victimOrg}/members`);
    const m = members.find((x: { email: string }) => x.email === "clerk@example.com");
    const r = await victim.post(`/o/${victimOrg}/members/${m.id}/password`, {});
    expect(r.temp_password).toBeTruthy();
    await new Client(app).post("/auth/login", { email: "clerk@example.com", password: r.temp_password });
  });

  it("refuses references to rows of another organisation in master data", async () => {
    const groupB = (await attacker.post(`/o/${attackerOrg}/data/test_group`, { name: "گروه مهاجم" })).row;
    // creating with another organisation's group
    await victim.post(`/o/${victimOrg}/data/test_item`, { name: "قلم الف", group_id: groupB.id }, 400);
    // updating to another organisation's group
    const { row } = await victim.post(`/o/${victimOrg}/data/test_item`, { name: "قلم ج" });
    await victim.patch(`/o/${victimOrg}/data/test_item/${row.id}`, { group_id: groupB.id }, 400);
    // importing with a raw id of another organisation
    const r = await victim.post(`/o/${victimOrg}/data/test_item/import`, { rows: [{ name: "قلم د", group_id: groupB.id }] });
    expect(r.failed).toBe(1);
    // reading or changing another organisation's row by id
    await victim.get(`/o/${victimOrg}/data/test_group/${groupB.id}`, 404);
    await victim.patch(`/o/${victimOrg}/data/test_group/${groupB.id}`, { name: "ربوده" }, 404);
    // (the attacker made the victim a viewer of their organisation above: reading there is allowed, writing is not)
    await victim.post(`/o/${attackerOrg}/data/test_group`, { name: "از بیرون" }, 403);
    // own references still work
    const groupA = (await victim.post(`/o/${victimOrg}/data/test_group`, { name: "گروه خودی" })).row;
    const ok = await victim.post(`/o/${victimOrg}/data/test_item`, { name: "قلم ه", group_id: groupA.id });
    expect(ok.row.group_id).toBe(groupA.id);
    const items = await db.query<{ n: number }>(`select count(*)::int as n from sm_test_items where org_id = $1 and group_id = $2`, [victimOrg, groupB.id]);
    expect(items[0].n).toBe(0);
    expect((await db.one<{ name: string }>(`select name from sm_test_groups where id = $1`, [groupB.id]))!.name).toBe("گروه مهاجم");
  });
});

describe("desktop installation administration", () => {
  it("does not make a member a desktop administrator by creating an organisation of their own", async () => {
    const calls: string[] = [];
    const bridge = {
      info: async () => ({}),
      listBackups: async () => {
        calls.push("list");
        return [];
      },
      backupNow: async () => ({ file: "x" }),
      restoreBackup: async () => {
        calls.push("restore");
      },
      getSettings: async () => ({}),
      setSettings: async () => ({}),
      syncStatus: async () => ({}),
      syncNow: async () => ({}),
      link: async () => ({}),
      unlink: async () => {},
      cloudOrgs: async () => [],
      notifyLocalWrite: () => {},
    } as unknown as DesktopBridge;
    const s = await makeServer({ mode: "desktop", config: { desktop: bridge } });
    const owner = new Client(s.app);
    const org = await signupWithOrg(owner);
    await owner.post(`/o/${org}/members`, { email: "staff@example.com", full_name: "کارشناس", role: "member", password: "staff-pass-1" });
    const staff = new Client(s.app);
    await staff.post("/auth/login", { email: "staff@example.com", password: "staff-pass-1" });
    await staff.get("/local/backups", 403);
    await staff.post("/orgs", { name: "سازمان دوم" }, 403);
    await staff.get("/local/backups", 403);
    await staff.post("/local/backups/restore", { file: "x" }, 403);
    expect(calls).toEqual([]);
    // the installation's administrator still creates organisations
    await owner.post("/orgs", { name: "سازمان سوم" });
  });
});

describe("request parsing and webhooks", () => {
  let app: App;
  let c: Client;
  let org: string;
  beforeAll(async () => {
    const s = await makeServer();
    app = s.app;
    c = new Client(app);
    org = await signupWithOrg(c);
  });

  it("answers a bad page or size with a normal page instead of a server error", async () => {
    const a = await c.get(`/o/${org}/data/test_item?page=abc&size=xyz`);
    expect(a).toMatchObject({ page: 1, size: 50 });
    const b = await c.get(`/o/${org}/data/test_item?page=1e300`);
    expect(b.rows).toEqual([]);
    const d = await c.get(`/o/${org}/data/test_item?size=-5&sort=nonsense;drop`);
    expect(d).toMatchObject({ page: 1, size: 1 });
    const { key } = await c.post(`/o/${org}/integrations/api-keys`, { name: "کلید خواندن", scopes: ["read"] });
    for (const page of ["abc", "1e300", "-5"]) {
      const res = await app.fetch(new Request(`http://local.test/api/v1/ping?page=${page}`, { headers: { authorization: `Bearer ${key}` } }));
      expect(res.status).toBe(200);
    }
    // a body that is not JSON is a 400, not a 500
    const res = await app.fetch(new Request(`http://local.test/api/orgs`, { method: "POST", headers: { "content-type": "application/json", cookie: c.cookie }, body: "{not json" }));
    expect(res.status).toBe(400);
  });

  it("keeps events of two webhooks with the same sender event id apart", async () => {
    const hookA = (await c.post(`/o/${org}/integrations`, { name: "سامانهٔ یک" })).integration;
    const hookB = (await c.post(`/o/${org}/integrations`, { name: "سامانهٔ دو" })).integration;
    const send = async (hook: { webhook_path: string; secret: string }, payload: unknown) => {
      const raw = JSON.stringify(payload);
      const sig = createHmac("sha256", hook.secret).update(raw, "utf8").digest("hex");
      const res = await app.fetch(new Request(`http://hooks.test${hook.webhook_path}`, {
        method: "POST", headers: { "content-type": "application/json", "x-signature": sig, "x-event-id": "77", "x-topic": "ticket.created" }, body: raw,
      }));
      return res.json();
    };
    const a = await send(hookA, { from: "a" });
    const b = await send(hookB, { from: "b" });
    expect(a).toMatchObject({ ok: true, status: "received" });
    expect(b).toMatchObject({ ok: true, status: "received" });
    expect(b.id).not.toBe(a.id);
    // the same system sending its event again is still a duplicate
    const again = await send(hookB, { from: "b" });
    expect(again).toMatchObject({ ok: true, duplicate: true });
    // one webhook's secret does not open the other
    const raw = JSON.stringify({ from: "x" });
    const forged = await app.fetch(new Request(`http://hooks.test${hookB.webhook_path}`, { method: "POST", headers: { "x-signature": createHmac("sha256", hookA.secret).update(raw).digest("hex") }, body: raw }));
    expect(forged.status).toBe(401);
  });
});

describe("platform administrators", () => {
  it("does not make the first stranger to sign up an administrator when the owner's email is configured", async () => {
    const s = await makeServer({ config: { platformAdmins: ["boss@example.com"] } });
    const stranger = new Client(s.app);
    await stranger.post("/auth/signup", { email: "early@example.com", password: "early-pass-1", full_name: "کاربر زودرس" });
    const me = await stranger.get("/auth/me");
    expect(me.user.is_platform_admin).toBe(false);
    await stranger.get("/admin/stats", 403);
    const boss = new Client(s.app);
    await boss.post("/auth/signup", { email: "boss@example.com", password: "boss-pass-1", full_name: "مالک سامانه" });
    await boss.get("/admin/stats");
  });

  it("still makes the first account the administrator when no email is configured", async () => {
    const s = await makeServer();
    const first = new Client(s.app);
    await first.post("/auth/signup", { email: "first@example.com", password: "first-pass-1", full_name: "نخستین" });
    await first.get("/admin/stats");
  });
});

describe("what a desktop receives when it synchronises", () => {
  let app: App;
  let db: Db;
  let org: string;
  let owner: Client;
  let manager: Client;
  let viewer: Client;
  type U = { email: string; password_hash: string | null; password_withheld: boolean; mobile: string | null };
  const pull = async (c: Client, extra = "") => (await c.get<{ users: U[] }>(`/sync/pull?org_id=${org}&protocol=${SYNC_PROTOCOL}${extra}`)).users;
  const of = (users: U[], email: string) => users.find((u) => u.email === email)!;
  const hashed = /^scrypt\$/;

  beforeAll(async () => {
    const s = await makeServer();
    db = s.db;
    // a network address of its own, so that sign-ups here do not count against other tests
    app = { fetch: (r: Request) => (r.headers.set("x-forwarded-for", "10.61.0.1"), s.app.fetch(r)) };
    await new Client(app).post("/auth/signup", { email: "operator@example.com", password: "operator-pass-1", full_name: "گرداننده‌ی سامانه" }); // the platform admin
    owner = new Client(app);
    await owner.post("/auth/signup", { email: "boss@example.com", password: "boss-pass-1", full_name: "مالک", mobile: "09120000010" });
    org = (await owner.post<{ id: string }>("/orgs", { name: "سازمان هم‌گام" })).id;
    await owner.post(`/o/${org}/members`, { email: "manager@example.com", full_name: "مدیر", role: "admin", password: "manager-pass-1" });
    await owner.post(`/o/${org}/members`, { email: "clerk2@example.com", full_name: "کارشناس", role: "member", password: "clerk2-pass-1" });
    await owner.post(`/o/${org}/members`, { email: "viewer2@example.com", full_name: "ناظر", role: "viewer", password: "viewer2-pass-1" });
    await db.query(`update sm_users set mobile = '09120000011' where email = 'clerk2@example.com'`);
    // a consultant who also runs an organisation of their own
    const freelance = new Client(app);
    await freelance.post("/auth/signup", { email: "freelance@example.com", password: "freelance-pass-1", full_name: "مشاور آزاد" });
    await freelance.post("/orgs", { name: "دفتر مشاوره" });
    await owner.post(`/o/${org}/members`, { email: "freelance@example.com", full_name: "مشاور آزاد", role: "member" });
    manager = new Client(app);
    await manager.post("/auth/login", { email: "manager@example.com", password: "manager-pass-1" });
    viewer = new Client(app);
    await viewer.post("/auth/login", { email: "viewer2@example.com", password: "viewer2-pass-1" });
  });

  it("gives an owner's desktop the password hashes of the accounts that work for this organisation alone", async () => {
    const users = await pull(owner);
    for (const e of ["boss@example.com", "manager@example.com", "clerk2@example.com", "viewer2@example.com"]) {
      expect(of(users, e).password_hash).toMatch(hashed);
      expect(of(users, e).password_withheld).toBe(false);
    }
    // the owner could not set this one's password either: it works for another organisation too
    expect(of(users, "freelance@example.com").password_hash).toBeNull();
    expect(of(users, "freelance@example.com").password_withheld).toBe(true);
    expect(of(users, "clerk2@example.com").mobile).toBe("09120000011");
  });

  it("does not give an administrator's desktop the owner's password hash", async () => {
    const users = await pull(manager);
    expect(of(users, "boss@example.com").password_hash).toBeNull();
    expect(of(users, "boss@example.com").password_withheld).toBe(true);
    expect(of(users, "clerk2@example.com").password_hash).toMatch(hashed);
    expect(of(users, "manager@example.com").password_hash).toMatch(hashed);
  });

  it("gives a viewer's desktop only its own password hash and no one else's phone number", async () => {
    const users = await pull(viewer);
    expect(users.length).toBe(5);
    for (const u of users) {
      if (u.email === "viewer2@example.com") {
        expect(u.password_hash).toMatch(hashed);
        expect(u.password_withheld).toBe(false);
      } else {
        expect(u.password_hash).toBeNull();
        expect(u.password_withheld).toBe(true);
        expect(u.mobile).toBeNull();
      }
    }
  });

  it("keeps a device record with the account and organisation that registered it", async () => {
    const mine = await owner.post<{ device_id: string }>("/sync/register", { org_id: org, name: "رایانه‌ی مالک" });
    // device ids are no secret: they ride along as the origin of synchronised rows
    const theirs = await viewer.post<{ device_id: string }>("/sync/register", { org_id: org, device_id: mine.device_id, name: "دستکاری‌شده" });
    expect(theirs.device_id).not.toBe(mine.device_id);
    const row = await db.one<{ name: string; user_id: string }>(`select name, user_id from sm_devices where id = $1`, [mine.device_id]);
    expect(row!.name).toBe("رایانه‌ی مالک");
    await pull(viewer, `&device_id=${mine.device_id}`);
    expect((await db.one<{ at: string | null }>(`select last_pull_at as at from sm_devices where id = $1`, [mine.device_id]))!.at).toBeNull();
    await pull(owner, `&device_id=${mine.device_id}`);
    expect((await db.one<{ at: string | null }>(`select last_pull_at as at from sm_devices where id = $1`, [mine.device_id]))!.at).not.toBeNull();
    const again = await owner.post<{ device_id: string }>("/sync/register", { org_id: org, device_id: mine.device_id, name: "رایانه‌ی مالک (نو)" });
    expect(again.device_id).toBe(mine.device_id);
  });
});
