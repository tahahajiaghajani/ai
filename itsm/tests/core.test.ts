// The platform core: accounts (sign-up, sign-in, recovery), organisations (the generic wizard: a name and an
// optional time zone), their settings, members and the audit log, and the generic master-data CRUD (through the
// fixture module, as a later module will use it).
import { describe, it, expect, beforeAll } from "vitest";
import "./fixtures/module";
import { makeServer, Client, signupWithOrg, ORG_NAME } from "./helpers";
import type { Db } from "@server/db";
import { DEFAULT_TIMEZONE, SYNC_PROTOCOL } from "@shared/constants";

describe("core: accounts, organisations, settings and members", () => {
  let c: Client;
  let db: Db;
  let app: Awaited<ReturnType<typeof makeServer>>["app"];
  let org: string;
  let recovery = "";
  beforeAll(async () => {
    const s = await makeServer();
    db = s.db;
    app = s.app;
    c = new Client(s.app);
    expect(await c.get("/meta")).toMatchObject({ first_run: true, allow_signup: true, mode: "cloud" });
    const r = await c.post("/auth/signup", { email: "owner@example.com", password: "s3cret-pass", full_name: "مالک آزمایشی" });
    recovery = r.recovery_code;
    org = (await c.post<{ id: string }>("/orgs", { name: ORG_NAME })).id;
  });

  it("makes the first account the platform administrator and reports the app's identity", async () => {
    const me = await c.get("/auth/me");
    expect(me.user).toMatchObject({ email: "owner@example.com", is_platform_admin: true });
    expect(me.orgs.map((o: { id: string }) => o.id)).toEqual([org]);
    const meta = await c.get("/meta");
    expect(meta).toMatchObject({ app: "ITSM", version: "1.0.0", sync_protocol: SYNC_PROTOCOL, first_run: false, signed_in: true });
    expect(meta.schema.pending).toEqual([]);
    const health = await c.get("/health");
    expect(health).toMatchObject({ ok: true, db: "ok", mode: "cloud" });
  });

  it("creates an organisation from its name alone, with the default time zone and the creator as owner", async () => {
    const info = await c.get(`/o/${org}`);
    expect(info.org).toMatchObject({ name: ORG_NAME, modules: [] });
    expect(info.org.settings.timezone).toBe(DEFAULT_TIMEZONE);
    expect(info.member.role).toBe("owner");
    expect(Object.values(info.member.permissions).every((l) => l === "full")).toBe(true);
    expect(info.counts.members).toBe(1);
    expect(info.status).toEqual({ status: "active", reason: null });
    // a chosen time zone, an unknown one, a name too short, unknown modules dropped
    const other = await c.post<{ id: string }>("/orgs", { name: "دفتر کابل", timezone: "Asia/Kabul", modules: ["no-such-module"] });
    const o2 = await c.get(`/o/${other.id}`);
    expect(o2.org.settings.timezone).toBe("Asia/Kabul");
    expect(o2.org.modules).toEqual([]);
    await c.post("/orgs", { name: "بد بد", timezone: "Mars/Olympus" }, 400);
    await c.post("/orgs", { name: "x" }, 400);
    const list = await c.get("/orgs");
    expect(list.orgs.map((o: { name: string; timezone: string }) => [o.name, o.timezone])).toEqual([
      [ORG_NAME, DEFAULT_TIMEZONE],
      ["دفتر کابل", "Asia/Kabul"],
    ]);
  });

  it("updates the profile and merges settings one level deep; refuses an unknown time zone", async () => {
    await c.patch(`/o/${org}`, { legal_name: "شرکت نمونه", city: "تهران", settings: { timezone: "Europe/Istanbul", print: { footer: "پانویس" } } });
    const info = await c.get(`/o/${org}`);
    expect(info.org).toMatchObject({ legal_name: "شرکت نمونه", city: "تهران" });
    expect(info.org.settings.timezone).toBe("Europe/Istanbul");
    // the rest of the print group is kept
    expect(info.org.settings.print).toEqual({ show_logo: true, footer: "پانویس" });
    await c.patch(`/o/${org}`, { settings: { timezone: "Nowhere/City" } }, 400);
  });

  it("adds a member with a temporary password, changes the role and records both", async () => {
    const added = await c.post(`/o/${org}/members`, { email: "Member@Example.com", full_name: "همکار نمونه", role: "member" });
    expect(added.temp_password).toBeTruthy();
    const { members, roles } = await c.get(`/o/${org}/members`);
    expect(roles.map((r: { key: string }) => r.key)).toEqual(["owner", "member", "viewer", "admin"]);
    const m = members.find((x: { email: string }) => x.email === "member@example.com");
    expect(m).toMatchObject({ role: "member", is_active: true, full_name: "همکار نمونه" });
    await c.post(`/o/${org}/members`, { email: "member@example.com", full_name: "تکراری", role: "viewer" }, 409);
    await c.post(`/o/${org}/members`, { email: "x@example.com", full_name: "نقش ناشناخته", role: "accountant" }, 400);

    const member = new Client(app);
    await member.post("/auth/login", { email: "member@example.com", password: added.temp_password });
    const seen = await member.get(`/o/${org}`);
    expect(seen.member.permissions).toEqual({ settings: "view", users: "view", integrations: "none", ai: "edit", reports: "view", work: "edit" });
    await member.patch(`/o/${org}`, { name: "تغییر نام" }, 403);

    await c.patch(`/o/${org}/members/${m.id}`, { role: "viewer" });
    expect((await member.get(`/o/${org}`)).member.role).toBe("viewer");
    await member.get(`/o/${org}/members`, 403);
    // the last owner stays an owner
    const own = members.find((x: { role: string }) => x.role === "owner");
    await c.patch(`/o/${org}/members/${own.id}`, { role: "admin" }, 400);

    const audit = await c.get(`/o/${org}/audit`);
    expect(audit.rows.some((r: { action: string; entity: string }) => r.action === "member_add" && r.entity === "member")).toBe(true);
    const changed = await db.one(`select 1 from sm_security_events where kind = 'member_changed' and org_id = $1`, [org]);
    expect(changed).toBeTruthy();
  });

  it("signs in, refuses a wrong password, signs out, and resets the password with the recovery code", async () => {
    const other = new Client(app);
    await other.post("/auth/login", { email: "owner@example.com", password: "wrong-password" }, 401);
    await other.post("/auth/login", { email: "OWNER@example.com", password: "s3cret-pass" });
    await other.get("/auth/me");
    await other.post("/auth/logout");
    await other.get("/auth/me", 401);

    await other.post("/auth/recover", { email: "owner@example.com", code: "AAAA-BBBB-CCCC-DDDD", next: "another-pass-1" }, 400);
    const r = await other.post("/auth/recover", { email: "owner@example.com", code: recovery.toLowerCase(), next: "another-pass-1" });
    expect(r.recovery_code).toBeTruthy();
    expect(r.recovery_code).not.toBe(recovery);
    // every session of the account ended with the reset
    await c.get("/auth/me", 401);
    await c.post("/auth/login", { email: "owner@example.com", password: "another-pass-1" });
    const events = await db.query<{ kind: string }>(`select kind from sm_security_events order by at`);
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(["sign_up", "sign_in", "password_recover", "member_added"]));
  });
});

describe("generic master data (the fixture module's entities)", () => {
  let c: Client;
  let org: string;
  beforeAll(async () => {
    const s = await makeServer();
    c = new Client(s.app);
    org = await signupWithOrg(c);
  });

  it("creates rows with automatic codes, normalises and validates fields, searches and filters", async () => {
    const g = await c.post(`/o/${org}/data/test_group`, { name: "شبکه" });
    expect(g.row.code).toBe("1");
    const a = await c.post(`/o/${org}/data/test_item`, { name: "سوئیچ طبقهٔ دوم", mobile: "۰۹۱۲۱۲۳۴۵۶۷", group_id: g.row.id, tags: ["critical"], qty: "۱۲" });
    expect(a.row).toMatchObject({ code: "1001", kind: "hardware", mobile: "09121234567", tags: ["critical"], is_active: true });
    expect(Number(a.row.qty)).toBe(12);
    const b = await c.post(`/o/${org}/data/test_item`, { name: "مجوز نرم‌افزار", kind: "software" });
    expect(b.row.code).toBe("1002");
    await c.post(`/o/${org}/data/test_item`, { name: "بد", email: "not-an-email" }, 400);
    await c.post(`/o/${org}/data/test_item`, { name: "بد", kind: "vehicle" }, 400);
    await c.post(`/o/${org}/data/test_item`, { kind: "software" }, 400);
    await c.post(`/o/${org}/data/test_item`, { name: "بد", group_id: "00000000-0000-7000-8000-000000000099" }, 400);
    await c.get(`/o/${org}/data/no_such_entity`, 404);

    expect((await c.get(`/o/${org}/data/test_item?q=سوئیچ`)).total).toBe(1);
    expect((await c.get(`/o/${org}/data/test_item?f.kind=software`)).rows.map((r: { code: string }) => r.code)).toEqual(["1002"]);
    expect((await c.get(`/o/${org}/data/test_item?f.tags=critical`)).total).toBe(1);
    const opts = await c.get(`/o/${org}/data/test_item/options?q=مجوز`);
    expect(opts.options).toHaveLength(1);
    expect(opts.options[0]).toMatchObject({ label: "مجوز نرم‌افزار", sub: "1002" });

    const u = await c.patch(`/o/${org}/data/test_item/${b.row.id}`, { notes: "تمدید سالانه", is_active: false });
    expect(u.row).toMatchObject({ notes: "تمدید سالانه", is_active: false });
    // inactive rows stay in lists but not in pickers
    expect((await c.get(`/o/${org}/data/test_item/options?q=مجوز`)).options).toHaveLength(0);
    await c.del(`/o/${org}/data/test_item/${b.row.id}`);
    await c.get(`/o/${org}/data/test_item/${b.row.id}`, 404);
    const audit = await c.get(`/o/${org}/audit`);
    expect(audit.rows.map((r: { action: string; entity: string }) => `${r.action}:${r.entity}`)).toEqual(expect.arrayContaining(["create:test_item", "update:test_item", "delete:test_item"]));
  });

  it("numbers a fixture module's records per organisation", async () => {
    const d1 = await c.post(`/o/${org}/test/docs`, { title: "اول", lines: [{ text: "ردیف", qty: 2 }] });
    const d2 = await c.post(`/o/${org}/test/docs`, { title: "دوم" });
    expect([d1.doc.no, d2.doc.no]).toEqual([1, 2]);
    const read = await c.get(`/o/${org}/test/docs/${d1.doc.id}`);
    expect(read.lines.map((l: { text: string; qty: string }) => [l.text, Number(l.qty)])).toEqual([["ردیف", 2]]);
  });
});
