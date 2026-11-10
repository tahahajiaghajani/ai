// Access levels and «مدیریت سامانه»: no silent platform-admin bypass, support sessions (view / edit,
// expiry, ending early, audit), organisation status (read-only, suspended), account actions with their
// guards, security events, the console's read models and the role matrix of the platform's roles.
// Records are those of the fixture module (tests/fixtures/module.ts).
import { describe, it, expect, beforeAll } from "vitest";
import "./fixtures/module";
import type { Db } from "@server/db";
import { makeServer, Client, signupWithOrg } from "./helpers";
import { MIGRATIONS } from "@server/db/migrations";
import { SYNC_PROTOCOL } from "@shared/constants";

const item = (name: string) => ({ name, kind: "hardware" });

describe("support mode and platform administration", () => {
  let db: Db;
  let admin: Client; // owner@example.com — the first account, platform admin
  let owner: Client; // owner of «واحد پشتیبانی شرق», not a platform admin
  let staff: Client;
  let viewer: Client;
  let org: string; // «واحد پشتیبانی شرق»: the admin is not a member
  let adminId: string;

  beforeAll(async () => {
    const s = await makeServer();
    db = s.db;
    // a network address of its own, so that sign-ups here do not count against other tests
    const app = { fetch: (r: Request) => (r.headers.set("x-forwarded-for", "10.71.0.1"), s.app.fetch(r)) };
    admin = new Client(app);
    await signupWithOrg(admin);
    adminId = (await admin.get("/auth/me")).user.id;
    owner = new Client(app);
    await owner.post("/auth/signup", { email: "lead@example.com", password: "lead-pass-1", full_name: "مسئول واحد" });
    org = (await owner.post<{ id: string }>("/orgs", { name: "واحد پشتیبانی شرق", timezone: "Asia/Tehran" })).id;
    await owner.post(`/o/${org}/members`, { email: "tech@example.com", full_name: "کارشناس واحد", role: "member", password: "tech-pass-1" });
    await owner.post(`/o/${org}/members`, { email: "nazer@example.com", full_name: "ناظر واحد", role: "viewer", password: "nazer-pass-1" });
    staff = new Client(app);
    await staff.post("/auth/login", { email: "tech@example.com", password: "tech-pass-1" });
    viewer = new Client(app);
    await viewer.post("/auth/login", { email: "nazer@example.com", password: "nazer-pass-1" });
    await owner.post(`/o/${org}/data/test_item`, item("قلم نخست"));
  });

  describe("without a support session", () => {
    it("keeps the platform admin out of an organisation he is not a member of", async () => {
      await admin.get(`/o/${org}`, 403);
      await admin.get(`/o/${org}/data/test_item`, 403);
      await admin.post(`/o/${org}/data/test_item`, item("نفوذی"), 403);
      const me = await admin.get("/auth/me");
      expect(me.orgs.map((o: { id: string }) => o.id)).not.toContain(org);
      const { orgs } = await admin.get("/orgs");
      expect(orgs.map((o: { id: string }) => o.id)).not.toContain(org);
    });

    it("shows platform metadata only in the console", async () => {
      const d = await admin.get(`/admin/orgs/${org}`);
      expect(d.org.name).toBe("واحد پشتیبانی شرق");
      expect(d.is_member).toBe(false);
      expect(d.members.map((m: { email: string }) => m.email).sort()).toEqual(["lead@example.com", "nazer@example.com", "tech@example.com"]);
      expect(d.sizes.items.find((i: { entity: string }) => i.entity === "test_item")?.rows).toBeGreaterThanOrEqual(1);
      expect(d.org.timezone).toBe("Asia/Tehran");
      // counts and sizes, never the records themselves
      expect(JSON.stringify(d)).not.toContain("قلم نخست");
      const { orgs } = await admin.get("/admin/orgs?q=lead");
      expect(orgs).toHaveLength(1);
      expect(orgs[0]).toMatchObject({ id: org, status: "active", members: 3, support_active: false });
    });
  });

  describe("support sessions", () => {
    it("needs a reason, a level and at most four hours, and only for outsiders", async () => {
      await admin.post(`/admin/orgs/${org}/support`, { level: "view", reason: "  " }, 400);
      await admin.post(`/admin/orgs/${org}/support`, { level: "view", reason: "بررسی تنظیمات سازمان", hours: 5 }, 400);
      await admin.post(`/admin/orgs/${org}/support`, { level: "all", reason: "بررسی تنظیمات سازمان" }, 400);
      await owner.post(`/admin/orgs/${org}/support`, { level: "view", reason: "بررسی تنظیمات سازمان" }, 403);
      const own = (await admin.get("/auth/me")).orgs[0].id;
      await admin.post(`/admin/orgs/${own}/support`, { level: "view", reason: "بررسی تنظیمات سازمان" }, 400);
    });

    it("«فقط مشاهده» sees everything and changes nothing", async () => {
      const { session } = await admin.post(`/admin/orgs/${org}/support`, { level: "view", reason: "درخواست مالک: بررسی گزارش", hours: 1 });
      expect(session).toMatchObject({ level: "view", state: "active" });
      const info = await admin.get(`/o/${org}`);
      expect(info.support).toMatchObject({ active: true, level: "view" });
      expect(info.member.permissions).toEqual({ settings: "view", users: "view", integrations: "view", ai: "none", reports: "view", work: "view" });
      const { rows } = await admin.get(`/o/${org}/data/test_item`);
      expect(rows.map((r: { name: string }) => r.name)).toContain("قلم نخست");
      await admin.post(`/o/${org}/data/test_item`, item("نفوذی"), 403);
      await admin.patch(`/o/${org}`, { name: "تغییر" }, 403);
      // the organisation is listed for him with the session
      const me = await admin.get("/auth/me");
      expect(me.orgs.find((o: { id: string }) => o.id === org)?.support).toMatchObject({ level: "view" });
      await admin.post(`/admin/support/${session.id}/end`);
      await admin.get(`/o/${org}`, 403);
    });

    it("«مشاهده و اصلاح» changes data, never members, and every change is audited as support", async () => {
      const { session } = await admin.post(`/admin/orgs/${org}/support`, { level: "edit", reason: "اصلاح داده به درخواست مالک", hours: 2 });
      const created = await admin.post(`/o/${org}/data/test_item`, item("قلم پشتیبانی"));
      expect(created).toBeTruthy();
      await admin.post(`/o/${org}/members`, { email: "x@example.com", full_name: "کاربر تازه", role: "owner" }, 403);
      await admin.get(`/o/${org}/members`);
      const tagged = await db.query<{ action: string; actor_kind: string; support_session_id: string }>(
        `select action, actor_kind, support_session_id from sm_audit where org_id = $1 and support_session_id = $2 order by at`,
        [org, session.id],
      );
      expect(tagged.length).toBeGreaterThanOrEqual(2); // the start and the new record
      expect(tagged.every((r) => r.actor_kind === "support")).toBe(true);
      expect(tagged[0].action).toBe("support_start");
      // the organisation sees the session and its changes
      const { rows } = await owner.get(`/o/${org}/audit`);
      expect(rows.some((r: { actor_kind: string; action: string }) => r.actor_kind === "support" && r.action !== "support_start")).toBe(true);
      const list = await owner.get(`/o/${org}/support-sessions`);
      expect(list.can_end).toBe(true);
      expect(list.sessions[0]).toMatchObject({ id: session.id, state: "active", level: "edit", admin_email: "owner@example.com" });
      // a member sees the sessions but cannot end them; the owner can
      expect((await staff.get(`/o/${org}/support-sessions`)).can_end).toBe(false);
      await staff.post(`/o/${org}/support-sessions/${session.id}/end`, {}, 403);
      const ended = await owner.post(`/o/${org}/support-sessions/${session.id}/end`);
      expect(ended.session).toMatchObject({ state: "ended", ended_by_name: "مسئول واحد" });
      await admin.post(`/o/${org}/data/test_item`, item("پس از پایان"), 403);
    });

    it("ends by itself when the time is up", async () => {
      const { session } = await admin.post(`/admin/orgs/${org}/support`, { level: "edit", reason: "آزمون پایان خودکار", hours: 1 });
      await admin.get(`/o/${org}`);
      await db.query(`update sm_support_sessions set expires_at = now() - interval '1 second' where id = $1`, [session.id]);
      await admin.get(`/o/${org}`, 403);
      const { sessions } = await admin.get(`/admin/orgs/${org}/support`);
      expect(sessions.find((s: { id: string }) => s.id === session.id)?.state).toBe("expired");
    });

    it("records support sessions as security events", async () => {
      const { events } = await admin.get(`/admin/security-events?org=${org}`);
      const kinds = events.map((e: { kind: string }) => e.kind);
      expect(kinds).toContain("support_start");
      expect(kinds).toContain("support_end");
      const { rows } = await admin.get("/admin/audit?actor=support");
      expect(rows.some((r: { action: string }) => r.action === "support_start")).toBe(true);
    });

    it("lets a platform admin who is a member work through his membership only", async () => {
      await owner.post(`/o/${org}/members`, { email: "owner@example.com", full_name: "مالک آزمایشی", role: "viewer" });
      const info = await admin.get(`/o/${org}`);
      expect(info.support).toBeNull();
      expect(info.member.role).toBe("viewer");
      await admin.post(`/o/${org}/data/test_item`, item("از راه عضویت"), 403);
      await admin.post(`/admin/orgs/${org}/support`, { level: "edit", reason: "تلاش برای دور زدن نقش" }, 400);
      const { members } = await owner.get(`/o/${org}/members`);
      const me = members.find((m: { email: string }) => m.email === "owner@example.com");
      await owner.patch(`/o/${org}/members/${me.id}`, { is_active: false });
      await admin.get(`/o/${org}`, 403);
    });
  });

  describe("organisation status", () => {
    it("read-only refuses every change and says why", async () => {
      await admin.patch(`/admin/orgs/${org}`, { status: "read_only" }, 400);
      await admin.patch(`/admin/orgs/${org}`, { status: "read_only", status_reason: "بدهی اشتراک" });
      const info = await owner.get(`/o/${org}`);
      expect(info.status).toEqual({ status: "read_only", reason: "بدهی اشتراک" });
      await owner.get(`/o/${org}/data/test_item`);
      await expect(owner.post(`/o/${org}/data/test_item`, item("در حالت فقط‌خواندنی"))).rejects.toThrow(/423.*فقط‌خواندنی.*بدهی اشتراک/);
      await expect(owner.patch(`/o/${org}`, { name: "نام تازه" })).rejects.toThrow(/423/);
    });

    it("suspended closes the organisation to its members", async () => {
      await admin.patch(`/admin/orgs/${org}`, { status: "suspended", status_reason: "درخواست قضایی" });
      await expect(owner.get(`/o/${org}`)).rejects.toThrow(/423.*معلق/);
      await admin.patch(`/admin/orgs/${org}`, { status: "active" });
      expect((await owner.get(`/o/${org}`)).status.status).toBe("active");
      await owner.post(`/o/${org}/data/test_item`, item("پس از فعال شدن"));
      const { rows } = await owner.get(`/o/${org}/audit`);
      expect(rows.filter((r: { action: string; actor_kind: string }) => r.action === "org_status" && r.actor_kind === "platform").length).toBe(3);
    });

    it("keeps internal notes out of the organisation's audit log and switches AI off", async () => {
      const r = await admin.patch(`/admin/orgs/${org}`, { notes: "مشتری ویژه؛ پیگیری تمدید", ai_disabled: true });
      expect(r.admin).toMatchObject({ notes: "مشتری ویژه؛ پیگیری تمدید", ai_disabled: true, status: "active" });
      const { rows } = await owner.get(`/o/${org}/audit`);
      expect(JSON.stringify(rows)).not.toContain("پیگیری تمدید");
      expect(rows.some((r: { action: string }) => r.action === "org_ai")).toBe(true);
      const { orgs } = await admin.get("/admin/orgs?q=lead");
      expect(orgs[0].ai_disabled).toBe(true);
      await admin.patch(`/admin/orgs/${org}`, { ai_disabled: false });
    });
  });

  describe("accounts", () => {
    it("grants and revokes platform admin with guards", async () => {
      const { users } = await admin.get("/admin/users?q=tech");
      const id = users[0].id;
      await admin.post(`/admin/users/${adminId}/platform-admin`, { granted: false }, 400);
      await admin.post(`/admin/users/${id}/platform-admin`, { granted: true });
      expect((await staff.get("/auth/me")).user.is_platform_admin).toBe(true);
      // the new admin cannot take the role from himself either
      await staff.post(`/admin/users/${id}/platform-admin`, { granted: false }, 400);
      await admin.post(`/admin/users/${id}/platform-admin`, { granted: false });
      await staff.get("/admin/overview", 403);
      const { events } = await admin.get(`/admin/security-events?kind=platform_admin&user=${id}`);
      expect(events.map((e: { data: { granted: boolean } }) => e.data.granted)).toEqual([false, true]);
      const { rows } = await admin.get("/admin/audit?actor=platform");
      expect(rows.some((r: { action: string; target_user_id: string }) => r.action === "admin_grant" && r.target_user_id === id)).toBe(true);
    });

    it("never revokes an address listed in PLATFORM_ADMIN_EMAILS", async () => {
      const s = await makeServer({ config: { platformAdmins: ["boss@example.com"] } });
      const app = { fetch: (r: Request) => (r.headers.set("x-forwarded-for", "10.71.0.2"), s.app.fetch(r)) };
      const boss = new Client(app);
      await boss.post("/auth/signup", { email: "boss@example.com", password: "boss-pass-1", full_name: "مالک سامانه" });
      const deputy = new Client(app);
      await deputy.post("/auth/signup", { email: "deputy@example.com", password: "deputy-pass-1", full_name: "معاون" });
      const { users } = await boss.get("/admin/users?q=deputy");
      await boss.post(`/admin/users/${users[0].id}/platform-admin`, { granted: true });
      const bossId = (await boss.get("/auth/me")).user.id;
      await expect(deputy.post(`/admin/users/${bossId}/platform-admin`, { granted: false })).rejects.toThrow(/400.*PLATFORM_ADMIN_EMAILS/);
    });

    it("sets a temporary password with a reason and signs out everywhere", async () => {
      const { users } = await admin.get("/admin/users?q=nazer");
      const id = users[0].id;
      await admin.post(`/admin/users/${id}/password`, { reason: "" }, 400);
      await admin.post(`/admin/users/${adminId}/password`, { reason: "رمز خودم را فراموش کردم" }, 400);
      const { temp_password } = await admin.post(`/admin/users/${id}/password`, { reason: "درخواست تلفنی پس از احراز هویت" });
      await viewer.get("/auth/me", 401);
      await viewer.post("/auth/login", { email: "nazer@example.com", password: temp_password });
      const r = await admin.post(`/admin/users/${id}/sign-out`);
      expect(r.sessions).toBe(1);
      await viewer.get("/auth/me", 401);
      await viewer.post("/auth/login", { email: "nazer@example.com", password: temp_password });
      const d = await admin.get(`/admin/users/${id}`);
      expect(d.memberships[0]).toMatchObject({ org_id: org, role: "viewer" });
      expect(d.events.map((e: { kind: string }) => e.kind)).toEqual(expect.arrayContaining(["password_reset", "sessions_revoked", "sign_in"]));
      expect(d.events.find((e: { kind: string }) => e.kind === "password_reset").data).toMatchObject({ scope: "platform", reason: "درخواست تلفنی پس از احراز هویت" });
    });

    it("records sign-ins, failed ones, password changes and role changes", async () => {
      await owner.post("/auth/login", { email: "lead@example.com", password: "wrong-pass-1" }, 401);
      await owner.post("/auth/login", { email: "nobody@example.com", password: "wrong-pass-1" }, 401);
      await owner.post("/auth/login", { email: "lead@example.com", password: "lead-pass-1" });
      await owner.post("/auth/password", { current: "lead-pass-1", next: "lead-pass-2" });
      const { members } = await owner.get(`/o/${org}/members`);
      const acc = members.find((m: { email: string }) => m.email === "tech@example.com");
      await owner.patch(`/o/${org}/members/${acc.id}`, { overrides: { ai: "view" } });
      await owner.patch(`/o/${org}/members/${acc.id}`, { overrides: {} });
      const { events } = await admin.get("/admin/security-events?q=lead");
      const failed = events.filter((e: { kind: string; ok: boolean }) => e.kind === "sign_in" && !e.ok);
      expect(failed[0].data.reason).toBe("wrong_password");
      expect(events.some((e: { kind: string; ok: boolean }) => e.kind === "sign_in" && e.ok)).toBe(true);
      expect(events.some((e: { kind: string }) => e.kind === "password_change")).toBe(true);
      const unknown = (await admin.get("/admin/security-events?q=nobody")).events;
      expect(unknown[0]).toMatchObject({ kind: "sign_in", ok: false, user_id: null });
      expect(unknown[0].data.reason).toBe("unknown_account");
      const changed = (await admin.get(`/admin/security-events?kind=member_changed&org=${org}`)).events;
      expect(changed[1].data.changes.overrides).toEqual([{}, { ai: "view" }]);
      // never a password in a log line
      const all = await db.query(`select data::text as t from sm_security_events`);
      expect(all.some((r) => /lead-pass|wrong-pass/.test(String(r.t)))).toBe(false);
      await admin.get("/admin/users/not-an-id", 404);
    });
  });

  describe("console", () => {
    it("serves the overview and the system health", async () => {
      const o = await admin.get("/admin/overview");
      expect(o.kpis.orgs.total).toBe(2);
      expect(o.kpis.users.total).toBe(4);
      expect(o.kpis.users.admins).toBe(1);
      expect(o.kpis.db.bytes).toBeGreaterThan(0);
      expect(o.kpis.db.limit).toBe(500 * 1024 * 1024);
      expect(o.kpis.security.failed_sign_ins_24h).toBeGreaterThanOrEqual(2);
      expect(o.recent_orgs[0].name).toBe("واحد پشتیبانی شرق");
      const h = await admin.get("/admin/health");
      expect(h.db.reachable).toBe(true);
      expect(h.migrations).toMatchObject({ applied: MIGRATIONS.length, expected: MIGRATIONS.length, missing: [] });
      expect(h.checks.find((c: { key: string }) => c.key === "migrations").tone).toBe("ok");
      expect(h.checks.find((c: { key: string }) => c.key === "admins").tone).toBe("warning");
      expect(["env", "derived"]).toContain(h.secret);
      await owner.get("/admin/health", 403);
      await owner.get("/admin/overview", 403);
    });

    it("filters organisations and accounts", async () => {
      expect((await admin.get(`/admin/orgs?q=${encodeURIComponent("سازمان آزمایشی")}`)).orgs.map((o: { name: string }) => o.name)).toEqual(["سازمان آزمایشی"]);
      expect((await admin.get("/admin/orgs?module=no-such-module")).orgs).toHaveLength(0);
      expect((await admin.get("/admin/orgs?status=suspended")).orgs).toHaveLength(0);
      expect((await admin.get("/admin/orgs")).orgs.map((o: { timezone: string }) => o.timezone)).toEqual(["Asia/Tehran", "Asia/Tehran"]);
      expect((await admin.get("/admin/users?filter=admins")).users.map((u: { email: string }) => u.email)).toEqual(["owner@example.com"]);
    });
  });
});

describe("role matrix", () => {
  let owner: Client;
  let staff: Client;
  let viewer: Client;
  let db: Db;
  let org: string;

  beforeAll(async () => {
    const s = await makeServer();
    db = s.db;
    const app = { fetch: (r: Request) => (r.headers.set("x-forwarded-for", "10.71.0.3"), s.app.fetch(r)) };
    owner = new Client(app);
    org = await signupWithOrg(owner);
    await owner.post(`/o/${org}/members`, { email: "acc@example.com", full_name: "کارشناس", role: "member", password: "acc-pass-1" });
    await owner.post(`/o/${org}/members`, { email: "view@example.com", full_name: "ناظر", role: "viewer", password: "view-pass-1" });
    staff = new Client(app);
    await staff.post("/auth/login", { email: "acc@example.com", password: "acc-pass-1" });
    viewer = new Client(app);
    await viewer.post("/auth/login", { email: "view@example.com", password: "view-pass-1" });
  });

  it("lets a member see the organisation, its members and reports and use the assistant, but change no settings", async () => {
    const info = await staff.get(`/o/${org}`);
    expect(info.member.permissions).toEqual({ settings: "view", users: "view", integrations: "none", ai: "edit", reports: "view", work: "edit" });
    await staff.get(`/o/${org}/data/test_item`);
    await staff.post(`/o/${org}/data/test_item`, item("قلم کارشناس"), 403);
    await staff.patch(`/o/${org}`, { phone: "02100000000" }, 403);
    await staff.get(`/o/${org}/members`);
    await staff.post(`/o/${org}/members`, { email: "new@example.com", full_name: "تازه", role: "viewer" }, 403);
    await staff.get(`/o/${org}/integrations`, 403);
    await staff.get(`/o/${org}/audit`);
  });

  it("lets the viewer see and ask, never write", async () => {
    const info = await viewer.get(`/o/${org}`);
    expect(info.member.permissions).toEqual({ settings: "view", users: "none", integrations: "none", ai: "view", reports: "view", work: "view" });
    const { row } = await owner.post(`/o/${org}/data/test_item`, item("قلم مالک"));
    await viewer.get(`/o/${org}/data/test_item`);
    await viewer.post(`/o/${org}/data/test_item`, item("نوشتن ناظر"), 403);
    await viewer.patch(`/o/${org}/data/test_item/${row.id}`, { name: "تغییر ناظر" }, 403);
    await viewer.del(`/o/${org}/data/test_item/${row.id}`, 403);
    await viewer.patch(`/o/${org}`, { phone: "02100000001" }, 403);
    await viewer.get(`/o/${org}/members`, 403);
  });

  it("gives per-area access above the role only through an owner's override", async () => {
    const { members } = await owner.get(`/o/${org}/members`);
    const v = members.find((m: { email: string }) => m.email === "view@example.com");
    await owner.patch(`/o/${org}/members/${v.id}`, { overrides: { settings: "edit" } });
    await viewer.post(`/o/${org}/data/test_item`, item("با دسترسی افزوده"));
    await owner.patch(`/o/${org}/members/${v.id}`, { overrides: { magic: "full" } }, 400);
    await owner.patch(`/o/${org}/members/${v.id}`, { overrides: {} });
    await viewer.post(`/o/${org}/data/test_item`, item("پس از برداشتن"), 403);
  });

  it("keeps only the modules the app knows when an owner switches modules", async () => {
    const { id } = await owner.post<{ id: string }>("/orgs", { name: "سازمان دوم" });
    const r = await owner.patch(`/o/${id}`, { modules: ["no-such-module"] });
    expect(r.org.modules).toEqual([]);
    // modules are the owner's call (settings full)
    await staff.patch(`/o/${org}`, { modules: [] }, 403);
    expect((await db.one<{ n: number }>(`select count(*)::int as n from sm_orgs where id = $1`, [id]))!.n).toBe(1);
  });

  it("keeps the last owner and lets only owners change owners", async () => {
    const { members } = await owner.get(`/o/${org}/members`);
    const me = members.find((m: { email: string }) => m.email === "owner@example.com");
    await owner.patch(`/o/${org}/members/${me.id}`, { role: "member" }, 400);
    await owner.patch(`/o/${org}/members/${me.id}`, { overrides: { magic: "full" } }, 400);
    const acc = members.find((m: { email: string }) => m.email === "acc@example.com");
    await owner.patch(`/o/${org}/members/${acc.id}`, { role: "admin" });
    const manager = staff; // now «مدیر»
    await manager.patch(`/o/${org}`, { phone: "02100000002" });
    await manager.post(`/o/${org}/data/test_item`, item("قلم مدیر"));
    await manager.post(`/o/${org}/members`, { email: "deputy-made@example.com", full_name: "عضو تازه", role: "member" });
    await manager.patch(`/o/${org}/members/${me.id}`, { role: "viewer" }, 403);
    await manager.post(`/o/${org}/members`, { email: "own2@example.com", full_name: "مالک دوم", role: "owner" }, 403);
    const { roles } = await owner.get(`/o/${org}/members`);
    expect(roles.filter((r: { kind: string }) => r.kind === "core").map((r: { key: string }) => r.key)).toEqual(["owner", "member", "viewer"]);
    expect(roles.filter((r: { kind: string }) => r.kind === "preset").map((r: { key: string }) => r.key)).toEqual(["admin"]);
  });
});

// Review round: support sessions leave nothing that outlives them, grants never exceed the
// granter's own access, an organisation never resets an account it did not create, the env-listed
// owner of the platform cannot be locked out or impersonated, and member changes pushed by a
// Windows app follow the members page's rules.
describe("access review fixes", () => {
  let db: Db;
  let app: { fetch: (r: Request) => Response | Promise<Response> };
  let admin: Client; // first account: platform admin
  let owner: Client;
  let org: string;
  const member = async (email: string) => {
    const { members } = await owner.get(`/o/${org}/members`);
    return members.find((m: { email: string }) => m.email === email);
  };
  const login = async (email: string, password: string) => {
    const c = new Client(app);
    await c.post("/auth/login", { email, password });
    return c;
  };

  beforeAll(async () => {
    const s = await makeServer();
    db = s.db;
    app = { fetch: (r: Request) => (r.headers.set("x-forwarded-for", "10.72.0.1"), s.app.fetch(r)) };
    admin = new Client(app);
    await signupWithOrg(admin);
    owner = new Client(app);
    await owner.post("/auth/signup", { email: "rev-owner@example.com", password: "rev-owner-pass-1", full_name: "مالک بازبینی" });
    org = (await owner.post<{ id: string }>("/orgs", { name: "سازمان بازبینی" })).id;
    await owner.post(`/o/${org}/members`, { email: "rev-acc@example.com", full_name: "کارشناس بازبینی", role: "member", password: "rev-acc-pass-1" });
  });

  it("an edit support session cannot leave an API key, a webhook or an AI connection behind", async () => {
    const { session } = await admin.post(`/admin/orgs/${org}/support`, { level: "edit", reason: "بررسی اتصال سامانهٔ پایش", hours: 1 });
    const info = await admin.get(`/o/${org}`);
    expect(info.member.permissions).toEqual({ settings: "full", users: "view", integrations: "view", ai: "edit", reports: "full", work: "full" });
    await admin.get(`/o/${org}/integrations/api-keys`);
    await admin.post(`/o/${org}/integrations/api-keys`, { name: "کلید پشتیبانی", scopes: ["read"] }, 403);
    await admin.post(`/o/${org}/integrations`, { name: "وب‌هوک پشتیبانی", secret: "chosen-secret-0123456789" }, 403);
    await admin.post(`/o/${org}/integrations/events/00000000-0000-7000-8000-000000000000/retry`, {}, 403);
    await admin.post(`/o/${org}/ai/connections`, { label: "درگاه من", preset: "openai", key: "sk-test" }, 403);
    // data changes are allowed (and audited as support)
    await admin.post(`/o/${org}/data/test_item`, item("اصلاح پشتیبانی"));
    await admin.post(`/admin/support/${session.id}/end`);
    await admin.post(`/o/${org}/data/test_item`, item("پس از پشتیبانی"), 403);
  });

  it("refuses the public API of a suspended organisation", async () => {
    const { key } = await owner.post(`/o/${org}/integrations/api-keys`, { name: "داشبورد بیرونی", scopes: ["read"] });
    const api = new Client(app);
    api.token = key;
    await api.get("/v1/ping");
    await admin.patch(`/admin/orgs/${org}`, { status: "suspended", status_reason: "بررسی حقوقی" });
    await expect(api.get("/v1/ping")).rejects.toThrow(/423/);
    await admin.patch(`/admin/orgs/${org}`, { status: "active" });
    await api.get("/v1/ping");
  });

  it("never resets the password of an account the organisation did not create", async () => {
    const victim = new Client(app);
    await victim.post("/auth/signup", { email: "rev-victim@example.com", password: "victim-pass-1", full_name: "قربانی" });
    await owner.post(`/o/${org}/members`, { email: "rev-victim@example.com", full_name: "قربانی", role: "viewer" });
    const m = await member("rev-victim@example.com");
    await owner.post(`/o/${org}/members/${m.id}/password`, { password: "taken-over-1" }, 403);
    await new Client(app).post("/auth/login", { email: "rev-victim@example.com", password: "taken-over-1" }, 401);
    await victim.get("/auth/me");
    // nor does the owner's Windows app receive its password hash
    const { users } = await owner.get(`/sync/pull?org_id=${org}&cursor=0&user_cursor=0`);
    const v = users.find((u: { email: string }) => u.email === "rev-victim@example.com");
    expect(v).toMatchObject({ password_hash: null, password_withheld: true });
    // an account this organisation made is still reset here
    const { temp_password } = await owner.post(`/o/${org}/members`, { email: "rev-made@example.com", full_name: "کارمند تازه", role: "viewer" });
    expect(temp_password).toBeTruthy();
    const made = await member("rev-made@example.com");
    await owner.post(`/o/${org}/members/${made.id}/password`, { password: "fresh-pass-12" });
    await login("rev-made@example.com", "fresh-pass-12");
    expect(users.find((u: { email: string }) => u.email === "rev-acc@example.com").password_withheld).toBe(false);
  });

  it("still resets the accounts it made before the new_account marker, never ones that joined by e-mail", async () => {
    // accounts added before the marker: their audit row «member_add» has no data
    await owner.post(`/o/${org}/members`, { email: "rev-old-staff@example.com", full_name: "کارمند قدیمی", role: "viewer", password: "old-staff-pass-1" });
    const joiner = new Client(app);
    await joiner.post("/auth/signup", { email: "rev-old-joiner@example.com", password: "old-joiner-pass-1", full_name: "عضو قدیمی" });
    await owner.post(`/o/${org}/members`, { email: "rev-old-joiner@example.com", full_name: "عضو قدیمی", role: "viewer" });
    await db.query(
      `update sm_audit set data = null where org_id = $1 and action = 'member_add'
         and entity_id in (select id from sm_users where email in ('rev-old-staff@example.com', 'rev-old-joiner@example.com'))`,
      [org],
    );
    const staff = await member("rev-old-staff@example.com");
    const joined = await member("rev-old-joiner@example.com");
    expect(staff.password_reset).toBe(true);
    expect(joined.password_reset).toBe(false);
    await owner.post(`/o/${org}/members/${staff.id}/password`, { password: "old-staff-new-1" });
    await login("rev-old-staff@example.com", "old-staff-new-1");
    await owner.post(`/o/${org}/members/${joined.id}/password`, { password: "taken-over-2" }, 403);
    // the owner's Windows app keeps the hash of the account it made (offline sign-in after the update)
    const { users } = await owner.get(`/sync/pull?org_id=${org}&cursor=0&user_cursor=0`);
    expect(users.find((u: { email: string }) => u.email === "rev-old-staff@example.com")).toMatchObject({ password_withheld: false });
    expect(users.find((u: { email: string }) => u.email === "rev-old-staff@example.com").password_hash).toBeTruthy();
    expect(users.find((u: { email: string }) => u.email === "rev-old-joiner@example.com")).toMatchObject({ password_hash: null, password_withheld: true });
    // only those who may reset are told whether a reset can work
    const acc = await login("rev-acc@example.com", "rev-acc-pass-1");
    const seen = (await acc.get(`/o/${org}/members`)).members;
    expect(seen.every((m: { password_reset: boolean }) => m.password_reset === false)).toBe(true);
  });

  it("never lets a member give more access than they have", async () => {
    await owner.post(`/o/${org}/members`, { email: "rev-delegate@example.com", full_name: "نمایندهٔ کاربران", role: "viewer", password: "rev-delegate-1" });
    await owner.post(`/o/${org}/members`, { email: "rev-peer@example.com", full_name: "ناظر دیگر", role: "viewer", password: "rev-peer-pass-1" });
    const d = await member("rev-delegate@example.com");
    await owner.patch(`/o/${org}/members/${d.id}`, { overrides: { users: "edit" } });
    const delegate = await login("rev-delegate@example.com", "rev-delegate-1");
    // not himself
    await delegate.patch(`/o/${org}/members/${d.id}`, { role: "admin", overrides: {} }, 403);
    await delegate.patch(`/o/${org}/members/${d.id}`, { overrides: { users: "full" } }, 403);
    expect((await delegate.get(`/o/${org}`)).member.role).toBe("viewer");
    // not above his own levels
    const peer = await member("rev-peer@example.com");
    await delegate.patch(`/o/${org}/members/${peer.id}`, { role: "admin" }, 403);
    await delegate.patch(`/o/${org}/members/${peer.id}`, { overrides: { integrations: "edit" } }, 403);
    await delegate.patch(`/o/${org}/members/${peer.id}`, { overrides: { users: "edit" } });
    await delegate.post(`/o/${org}/members`, { email: "rev-new-admin@example.com", full_name: "مدیر تازه", role: "admin", password: "chosen-pass-1" }, 403);
    await delegate.post(`/o/${org}/members`, { email: "rev-new-acc@example.com", full_name: "کارشناس تازه", role: "member", password: "chosen-pass-1" }, 403);
    await delegate.post(`/o/${org}/members`, { email: "rev-new-viewer@example.com", full_name: "ناظر تازه", role: "viewer", password: "chosen-pass-1" });
    // nor touches a member who has more access than he does
    const acc = await member("rev-acc@example.com");
    await delegate.patch(`/o/${org}/members/${acc.id}`, { is_active: false }, 403);
    // a removed member who comes back starts from the role, without old overrides
    const p = await member("rev-peer@example.com");
    await db.query(`update sm_org_members set deleted_at = now() where id = $1`, [p.id]);
    await owner.post(`/o/${org}/members`, { email: "rev-peer@example.com", full_name: "ناظر دیگر", role: "viewer" });
    expect((await member("rev-peer@example.com")).overrides).toEqual({});
  });

  it("applies the members page's rules to member changes pushed by a Windows app", async () => {
    const push = (c: Client, row: Record<string, unknown>) =>
      c.post(`/sync/push`, {
        org_id: org, device_id: "00000000-0000-7000-8000-0000000000aa", protocol: SYNC_PROTOCOL,
        aggregates: [{ entity: "member", id: String(row.id), base_rev: Number(row.rev), row: { ...row, updated_at: new Date().toISOString() }, children: {} }],
      });
    const rowOf = async (email: string) =>
      (await db.one<Record<string, unknown>>(`select m.* from sm_org_members m join sm_users u on u.id = m.user_id where m.org_id = $1 and u.email = $2`, [org, email]))!;
    const delegate = await login("rev-delegate@example.com", "rev-delegate-1");
    const self = await push(delegate, { ...(await rowOf("rev-delegate@example.com")), role: "admin", overrides: {} });
    expect(self.results[0]).toMatchObject({ status: "error" });
    const up = await push(delegate, { ...(await rowOf("rev-new-viewer@example.com")), overrides: { settings: "full" } });
    expect(up.results[0]).toMatchObject({ status: "error" });
    expect((await rowOf("rev-delegate@example.com")).role).toBe("viewer");
    // the owner's Windows app cannot leave the organisation without an active owner
    const mine = await rowOf("rev-owner@example.com");
    const gone = await push(owner, { ...mine, is_active: false });
    expect(gone.results[0]).toMatchObject({ status: "error" });
    expect((await rowOf("rev-owner@example.com")).is_active).toBe(true);
    // a role change made there is a security event
    const ok = await push(owner, { ...(await rowOf("rev-new-viewer@example.com")), role: "member" });
    expect(ok.results[0]).toMatchObject({ status: "ok" });
    const { events } = await admin.get(`/admin/security-events?kind=member_changed&org=${org}&q=rev-new-viewer`);
    expect(events[0].data.changes.role).toEqual(["viewer", "member"]);
    expect(events[0].data.via).toBe("sync");
  });

  it("keeps a membership on its account when a Windows app pushes it", async () => {
    const push = (c: Client, aggs: { entity: string; row: Record<string, unknown>; children?: Record<string, unknown[]> }[]) =>
      c.post(`/sync/push`, {
        org_id: org, device_id: "00000000-0000-7000-8000-0000000000ab", protocol: SYNC_PROTOCOL,
        aggregates: aggs.map((a) => ({ entity: a.entity, id: String(a.row.id), base_rev: Number(a.row.rev), row: { ...a.row, updated_at: new Date().toISOString() }, children: a.children ?? {} })),
      });
    // a removed membership never comes back on another account
    await owner.post(`/o/${org}/members`, { email: "rev-moved@example.com", full_name: "ناظر رفته", role: "viewer", password: "rev-moved-pass-1" });
    const viewer = (await db.one<Record<string, unknown>>(`select m.* from sm_org_members m join sm_users u on u.id = m.user_id where m.org_id = $1 and u.email = 'rev-moved@example.com'`, [org]))!;
    const other = (await db.one<{ id: string }>(`select id from sm_users where email = 'rev-acc@example.com'`))!.id;
    await db.query(`update sm_org_members set deleted_at = now() where id = $1`, [viewer.id]);
    const fresh = (await db.one<Record<string, unknown>>(`select * from sm_org_members where id = $1`, [viewer.id]))!;
    const moved = await push(owner, [{ entity: "member", row: { ...fresh, user_id: other, deleted_at: null, is_active: true } }]);
    expect(moved.results[0]).toMatchObject({ status: "error", message: "عضویت به حساب دیگری منتقل نمی‌شود" });
    expect((await db.one<{ user_id: string }>(`select user_id from sm_org_members where id = $1`, [viewer.id]))!.user_id).toBe(viewer.user_id);
  });
});

describe("the platform's owner (PLATFORM_ADMIN_EMAILS)", () => {
  it("cannot be disabled or given a temporary password by another admin", async () => {
    const s = await makeServer({ config: { platformAdmins: ["boss@example.com"] } });
    const app = { fetch: (r: Request) => (r.headers.set("x-forwarded-for", "10.72.0.2"), s.app.fetch(r)) };
    const boss = new Client(app);
    await boss.post("/auth/signup", { email: "boss@example.com", password: "boss-pass-1", full_name: "مالک سامانه" });
    const deputy = new Client(app);
    await deputy.post("/auth/signup", { email: "deputy@example.com", password: "deputy-pass-1", full_name: "معاون" });
    const third = new Client(app);
    await third.post("/auth/signup", { email: "third@example.com", password: "third-pass-12", full_name: "سوم" });
    const { users } = await boss.get("/admin/users");
    const id = (e: string) => users.find((u: { email: string }) => u.email === e).id;
    await boss.post(`/admin/users/${id("deputy@example.com")}/platform-admin`, { granted: true });
    await boss.post(`/admin/users/${id("third@example.com")}/platform-admin`, { granted: true });
    await deputy.patch(`/admin/users/${id("boss@example.com")}`, { disabled: true }, 400);
    await deputy.post(`/admin/users/${id("boss@example.com")}/password`, { reason: "درخواست تلفنی مالک" }, 400);
    // no admin sets another admin's password either (it would let him sign in as that admin)
    await deputy.post(`/admin/users/${id("third@example.com")}/password`, { reason: "درخواست تلفنی همکار" }, 400);
    await boss.get("/admin/overview");
  });

  it("never resets the password of an admin right after taking the role away", async () => {
    const s = await makeServer({ config: { platformAdmins: ["boss@example.com"] } });
    const app = { fetch: (r: Request) => (r.headers.set("x-forwarded-for", "10.72.0.5"), s.app.fetch(r)) };
    const boss = new Client(app);
    await boss.post("/auth/signup", { email: "boss@example.com", password: "boss-pass-1", full_name: "مالک سامانه" });
    const deputy = new Client(app);
    await deputy.post("/auth/signup", { email: "deputy@example.com", password: "deputy-pass-1", full_name: "معاون" });
    const third = new Client(app);
    await third.post("/auth/signup", { email: "third@example.com", password: "third-pass-12", full_name: "سوم" });
    const { users } = await boss.get("/admin/users");
    const id = (e: string) => users.find((u: { email: string }) => u.email === e).id;
    await boss.post(`/admin/users/${id("deputy@example.com")}/platform-admin`, { granted: true });
    await boss.post(`/admin/users/${id("third@example.com")}/platform-admin`, { granted: true });
    await deputy.post(`/admin/users/${id("third@example.com")}/platform-admin`, { granted: false });
    expect((await deputy.get(`/admin/users/${id("third@example.com")}`)).user.recently_admin).toBe(true);
    await deputy.post(`/admin/users/${id("third@example.com")}/password`, { reason: "درخواست تلفنی همکار" }, 400);
    await third.get("/auth/me");
    // once the cool-down has passed, a former admin is an ordinary account again
    await s.db.query(`update sm_audit set at = now() - interval '8 days' where action = 'admin_revoke' and entity_id = $1`, [id("third@example.com")]);
    await deputy.post(`/admin/users/${id("third@example.com")}/password`, { reason: "درخواست تلفنی همکار" });
  });

  it("is granted only while the platform has no administrator; later addresses are granted from the console", async () => {
    const s = await makeServer({ config: { platformAdmins: ["boss@example.com", "second@example.com"], allowSignup: false } });
    const app = { fetch: (r: Request) => (r.headers.set("x-forwarded-for", "10.72.0.3"), s.app.fetch(r)) };
    const boss = new Client(app);
    await boss.post("/auth/signup", { email: "boss@example.com", password: "boss-pass-1", full_name: "مالک سامانه" });
    await boss.get("/admin/overview");
    // sign-up is closed: the second address is no way in once an administrator exists
    await new Client(app).post("/auth/signup", { email: "second@example.com", password: "claimed-pass-1", full_name: "مدعی" }, 403);
    // nor can an organisation make an account with it and sign in as the platform's administrator
    const org = (await boss.post<{ id: string }>("/orgs", { name: "سازمان مالک" })).id;
    await boss.post(`/o/${org}/members`, { email: "second@example.com", full_name: "مدعی", role: "viewer", password: "claimed-pass-1" }, 400);
  });

  it("does not make an address an administrator at sign-in once the platform has one", async () => {
    const s = await makeServer({ config: { platformAdmins: ["boss@example.com", "second@example.com"] } });
    const app = { fetch: (r: Request) => (r.headers.set("x-forwarded-for", "10.72.0.4"), s.app.fetch(r)) };
    const boss = new Client(app);
    await boss.post("/auth/signup", { email: "boss@example.com", password: "boss-pass-1", full_name: "مالک سامانه" });
    const claimer = new Client(app);
    await claimer.post("/auth/signup", { email: "second@example.com", password: "claimed-pass-1", full_name: "مدعی" });
    expect((await claimer.get("/auth/me")).user.is_platform_admin).toBe(false);
    await claimer.post("/auth/login", { email: "second@example.com", password: "claimed-pass-1" });
    expect((await claimer.get("/auth/me")).user.is_platform_admin).toBe(false);
    await claimer.get("/admin/overview", 403);
    // such an account proves nothing about the address: the administrators can disable it
    const { users } = await boss.get("/admin/users");
    const squatter = users.find((u: { email: string }) => u.email === "second@example.com");
    expect(squatter).toMatchObject({ env_admin: true, is_platform_admin: false });
    await boss.patch(`/admin/users/${squatter.id}`, { disabled: true });
    await new Client(app).post("/auth/login", { email: "second@example.com", password: "claimed-pass-1" }, 403);
  });
});
