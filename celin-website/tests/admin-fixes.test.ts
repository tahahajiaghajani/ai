import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, FakeJar } from "./stubs/fake-db";

/**
 * The admin review fixes, against the in-memory database (tests/stubs/fake-db.ts): «مدیر کردن» follows the
 * activation rules, a renewal ends what a used (expired) code opened, the inbox shows only the code a message
 * was written for, the visitor's IP comes only from a proxy we can prove, the admin password forms' shared
 * ceiling counts failures only, the known-device cookie ends with the password, admin sign-out ends the
 * session everywhere, and more.
 */

const h = vi.hoisted(() => ({ db: null as unknown, jar: null as unknown, headers: {} as Record<string, string> }));

vi.mock("next/headers", () => ({ cookies: async () => h.jar, headers: async () => new Headers(h.headers) }));
vi.mock("next/cache", () => ({ unstable_cache: <T>(fn: T) => fn, revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));
vi.mock("@/lib/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...real,
    db: () => h.db,
    requireDb: () => {
      if (!h.db) throw new real.UserError("db");
      return h.db;
    },
  };
});

const USERS_COLS = ["id", "phone", "email", "name", "business", "city", "address", "postal_code", "role", "disabled", "session_version", "password_hash", "password_from_code", "created_by_admin", "admin_note", "last_sign_in_at", "created_at", "updated_at"];

let fake: FakeDb;
let jar: FakeJar;

function user(over: Record<string, unknown>) {
  const row = {
    id: crypto.randomUUID(),
    phone: "09120000000",
    email: "",
    name: "QA",
    business: "",
    city: "",
    address: "",
    postal_code: "",
    role: "user",
    disabled: false,
    session_version: 0,
    password_hash: null as string | null,
    password_from_code: false,
    created_by_admin: false,
    admin_note: "",
    created_at: new Date().toISOString(),
    ...over,
  };
  fake.table("celin_users").push(row);
  return row;
}

beforeAll(() => {
  process.env.APP_SECRET = "test-secret-test-secret-test-secret";
});

beforeEach(() => {
  fake = new FakeDb();
  fake.columns.celin_users = USERS_COLS;
  fake.rpcs.celin_hit_rate_limit = (a) => {
    const rows = fake.table("celin_rate_limits");
    const now = Date.now();
    let r = rows.find((x) => x.key === a.p_key) as { key: string; window_start: string; count: number } | undefined;
    if (!r) rows.push((r = { key: String(a.p_key), window_start: new Date(now).toISOString(), count: 0 }));
    if (Date.parse(r.window_start) < now - Number(a.p_window) * 1000) Object.assign(r, { window_start: new Date(now).toISOString(), count: 0 });
    r.count++;
    return { data: r.count <= Number(a.p_max), error: null };
  };
  h.db = fake;
  jar = new FakeJar();
  h.jar = jar;
  h.headers = { "x-forwarded-for": "198.51.100.7" };
  // a proxy in front writes the visitor's address (tests that need more pick their own)
  process.env.TRUSTED_IP_HEADER = "x-forwarded-for";
  delete process.env.TRUSTED_PROXY_SECRET;
  delete process.env.ADMIN_PHONES;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.VERCEL;
});

async function signInAs(u: { id: string; session_version: number }, via: "pw" | "code" = "pw") {
  const { sessionValue } = await import("@/lib/auth");
  jar.set("celin_session", sessionValue(u.id, u.session_version, Date.now(), via));
}

async function asAdmin() {
  const a = user({ phone: "09121119999", name: "Owner", role: "admin", password_hash: "scrypt$owner" });
  await signInAs(a, "pw");
  return a;
}

async function issue(userId: string, over: Record<string, unknown> = {}) {
  const { codeHashes, encrypt, generateCode, normalizeCode } = { ...(await import("@/lib/pro")), ...(await import("@/lib/crypto")) };
  const code = generateCode();
  const norm = normalizeCode(code);
  const row = { id: crypto.randomUUID(), user_id: userId, code_hash: codeHashes(norm)[0], code_enc: encrypt(code), hint: norm.slice(-4), request_id: null, expires_at: null as string | null, redeemed_at: null as string | null, last_used_at: null as string | null, revoked_at: null as string | null, created_at: new Date().toISOString(), ...over };
  fake.table("celin_pro_codes").push(row);
  return { code, row };
}

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

/** Runs a form action; a redirect comes back as { redirect }. */
async function submit<T>(fn: () => Promise<T>): Promise<T | { redirect: string }> {
  try {
    return await fn();
  } catch (e) {
    const url = (e as { url?: string }).url;
    if (url) return { redirect: url };
    throw e;
  }
}

describe("Users → «مدیر کردن» follows the activation rules", async () => {
  const { setMemberRole } = await import("@/lib/members");
  const { promotionBlock } = await import("@/lib/admin-auth");

  it("respects the ADMIN_PHONES allow-list, also from the ADMIN_PASSWORD-only session", async () => {
    process.env.ADMIN_PASSWORD = "the-admin-pass-1";
    process.env.ADMIN_PHONES = "0912 111 0101";
    const { startSession } = await import("@/lib/admin-auth");
    await startSession(); // break-glass: no account
    const outside = user({ phone: "09121110100", password_hash: "scrypt$own" });
    await expect(setMemberRole(outside.id, "admin")).rejects.toThrow(/ADMIN_PHONES/);
    expect(outside.role).toBe("user");
    const listed = user({ phone: "09121110101", password_hash: "scrypt$own", session_version: 3 });
    expect(await setMemberRole(listed.id, "admin")).toMatchObject({ changed: true });
    expect(listed.role).toBe("admin");
    expect(listed.session_version).toBe(4); // every session of the account ends
  });

  it("never makes an account without its own password an admin (it would be locked out or handed over)", async () => {
    await asAdmin();
    const codeOnly = user({ phone: "09121110102", created_by_admin: true });
    await expect(setMemberRole(codeOnly.id, "admin")).rejects.toThrow(/رمز عبور ندارد/);
    const madeWithCode = user({ phone: "09121110103", password_hash: "scrypt$x", password_from_code: true });
    await expect(setMemberRole(madeWithCode.id, "admin")).rejects.toThrow(/کد Pro/);
    expect(codeOnly.role).toBe("user");
    expect(madeWithCode.role).toBe("user");
    expect(promotionBlock({ phone: "09121110104", password_hash: "scrypt$own" })).toBe("");
    expect(promotionBlock({ phone: "09121110104", password_hash: "scrypt$own", disabled: true })).toMatch(/غیرفعال/);
  });

  it("logs who did it", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await asAdmin();
    const m = user({ phone: "09121110105", password_hash: "scrypt$own" });
    await setMemberRole(m.id, "admin");
    expect(info.mock.calls.flat().join(" ")).toMatch(new RegExp(`${m.id}.*made admin.*Owner`));
    info.mockRestore();
  });

  it("keeps the last admin account while ADMIN_PASSWORD is not set", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const owner = await asAdmin();
    await expect(setMemberRole(owner.id, "user")).rejects.toThrow(/تنها حساب مدیر/);
    expect(owner.role).toBe("admin");
    process.env.ADMIN_PASSWORD = "the-admin-pass-1";
    expect(await setMemberRole(owner.id, "user")).toMatchObject({ changed: true });
    expect(owner.role).toBe("user");
    info.mockRestore();
  });

  it("a member list row says why the account cannot be promoted", async () => {
    await asAdmin();
    const { listMembers } = await import("@/lib/members");
    const codeOnly = user({ phone: "09121110106" });
    const rows = (await listMembers())!;
    expect(rows.find((r) => r.id === codeOnly.id)?.promote_block).toMatch(/رمز عبور ندارد/);
  });
});

describe("a renewal after the code expired", async () => {
  const { issueForMember, revokeMemberCode } = await import("@/lib/members");

  it("ends the sessions and the password that the used (now expired) code opened", async () => {
    await asAdmin();
    const m = user({ phone: "09121110110", session_version: 3, password_hash: "scrypt$made-with-code", password_from_code: true });
    await issue(m.id, { redeemed_at: new Date(Date.now() - 400 * 86400_000).toISOString(), expires_at: new Date(Date.now() - 86400_000).toISOString() });
    const r = await issueForMember(m.id, 365);
    expect(r).toMatchObject({ ended: true, passwordCleared: true });
    expect(m.session_version).toBe(4);
    expect(m.password_hash).toBeNull();
  });

  it("leaves the account alone when the replaced code was never entered", async () => {
    await asAdmin();
    const m = user({ phone: "09121110111", session_version: 1 });
    await issue(m.id, { expires_at: new Date(Date.now() - 86400_000).toISOString() });
    expect(await issueForMember(m.id, 30)).toMatchObject({ ended: false });
    expect(m.session_version).toBe(1);
  });

  it("revoking counts a code that was used, even if only last_used_at says so", async () => {
    await asAdmin();
    const m = user({ phone: "09121110112", session_version: 0 });
    const { row } = await issue(m.id, { last_used_at: new Date().toISOString() });
    expect(await revokeMemberCode(row.id)).toMatchObject({ ended: true });
    expect(m.session_version).toBe(1);
  });

  it("a code revoked between its lookup and its use opens nothing", async () => {
    const { touchCode, CodeRevokedError } = await import("@/lib/pro");
    const m = user({ phone: "09121110113" });
    const { row } = await issue(m.id);
    const seen = { ...row }; // what enterCode read a moment ago
    row.revoked_at = new Date().toISOString(); // the admin revoked it meanwhile
    await expect(touchCode(seen)).rejects.toBeInstanceOf(CodeRevokedError);
    expect(row.redeemed_at).toBeNull();
  });
});

describe("the inbox shows only the code a message was written for", async () => {
  const { listMessages, codeMark, CODE_MARK } = await import("@/lib/messages");

  function message(userId: string, body: string, at = new Date().toISOString()) {
    fake.table("celin_messages").push({ id: crypto.randomUUID(), user_id: userId, kind: "pro", title_fa: "", title_en: "", body_fa: `کد: ${body}`, body_en: `Code: ${body}`, link: "", read_at: null, created_at: at });
  }

  it("never puts a newer code into an older message", async () => {
    const m = user({ phone: "09121110120" });
    const t0 = Date.now() - 60_000;
    const old = await issue(m.id, { created_at: new Date(t0).toISOString(), revoked_at: new Date(t0 + 30_000).toISOString() });
    message(m.id, codeMark(old.row.id), new Date(t0 + 20).toISOString());
    const now = await issue(m.id, { created_at: new Date(t0 + 30_000).toISOString() });
    message(m.id, codeMark(now.row.id), new Date(t0 + 30_020).toISOString());
    const [latest, earlier] = await listMessages(m.id);
    expect(latest.body_en).toBe(`Code: ${now.code}`);
    expect(earlier.body_en).toBe("Code: (no longer active)");
    expect(earlier.body_fa).not.toContain(now.code);
  });

  it("ties a message written before codes were named to the code issued for it", async () => {
    const m = user({ phone: "09121110121" });
    const t0 = Date.now() - 60_000;
    const old = await issue(m.id, { created_at: new Date(t0).toISOString(), revoked_at: new Date(t0 + 30_000).toISOString() });
    message(m.id, CODE_MARK, new Date(t0 + 20).toISOString());
    const now = await issue(m.id, { created_at: new Date(t0 + 30_000).toISOString() });
    message(m.id, CODE_MARK, new Date(t0 + 30_020).toISOString());
    const [latest, earlier] = await listMessages(m.id);
    expect(latest.body_en).toBe(`Code: ${now.code}`);
    expect(earlier.body_en).toBe("Code: (no longer active)");
    expect(old.code).not.toBe(now.code);
  });

  it("shows no code at all while «نمایش کد در پیام‌های حساب عضو» is off", async () => {
    const m = user({ phone: "09121110122" });
    const { code, row } = await issue(m.id);
    message(m.id, codeMark(row.id));
    fake.table("celin_settings").push({ key: "pro", value: { codeInInbox: false } });
    const [msg] = await listMessages(m.id);
    expect(msg.body_en).not.toContain(code);
    expect(msg.body_fa).not.toContain(code);
    expect(msg.body_en).toMatch(/not shown/);
  });
});

describe("the visitor's IP behind a proxy or CDN", async () => {
  const { clientIp, ipSetup } = await import("@/lib/request");

  it("honours TRUSTED_IP_HEADER with TRUSTED_PROXY_SECRET only on requests that carry the secret", async () => {
    process.env.TRUSTED_IP_HEADER = "ar-real-ip";
    process.env.TRUSTED_PROXY_SECRET = "proxy-secret-1";
    h.headers = { "ar-real-ip": "192.0.2.5", "x-celin-proxy": "proxy-secret-1", "x-forwarded-for": "6.6.6.6" };
    expect(await clientIp()).toBe("192.0.2.5");
    h.headers = { "ar-real-ip": "192.0.2.77", "x-celin-proxy": "guess", "x-forwarded-for": "6.6.6.6" };
    expect(await clientIp()).toBe("0.0.0.0"); // self-hosted: a request that bypassed the proxy is never trusted
  });

  it("on Vercel a CDN header counts only with the secret; a direct request falls back to Vercel's own header", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.VERCEL = "1";
    process.env.TRUSTED_IP_HEADER = "ar-real-ip";
    h.headers = { "ar-real-ip": "192.0.2.5", "x-vercel-forwarded-for": "198.51.100.1" };
    expect(ipSetup()).toMatchObject({ mode: "vercel", ignored: true });
    expect(await clientIp()).toBe("198.51.100.1"); // no secret configured: anyone could send ar-real-ip to *.vercel.app
    process.env.TRUSTED_PROXY_SECRET = "proxy-secret-1";
    expect(await clientIp()).toBe("198.51.100.1"); // no secret on the request
    h.headers = { "ar-real-ip": "192.0.2.5", "x-vercel-forwarded-for": "198.51.100.1", "x-celin-proxy": "proxy-secret-1" };
    expect(await clientIp()).toBe("192.0.2.5");
    err.mockRestore();
  });
});

describe("the admin password forms", async () => {
  const { login, activateAdmin } = await import("@/app/actions/admin");

  it("a correct password never uses up the shared ceiling, and a browser that proved it before passes it", async () => {
    process.env.ADMIN_PASSWORD = "the-admin-pass-1";
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    expect(await submit(() => login(null, form({ password: "the-admin-pass-1" })))).toEqual({ redirect: "/admin" });
    expect(fake.table("celin_rate_limits").find((r) => r.key === "admin-login:global")).toBeUndefined();
    const device = jar.get("celin_admin_device")!.value;
    // strangers from many addresses have used up the ceiling
    fake.table("celin_rate_limits").push({ key: "admin-login:global", window_start: new Date().toISOString(), count: 40 });
    jar = new FakeJar();
    h.jar = jar;
    h.headers = { "x-forwarded-for": "192.0.2.9" };
    expect(await submit(() => login(null, form({ password: "the-admin-pass-1" })))).toEqual({ error: "تلاش‌های زیادی انجام شد؛ ۱۵ دقیقه‌ی دیگر امتحان کنید." });
    jar.set("celin_admin_device", device);
    expect(await submit(() => login(null, form({ password: "the-admin-pass-1" })))).toEqual({ redirect: "/admin" });
    expect(await submit(() => login(null, form({ password: "wrong" })))).toEqual({ error: "رمز مدیریت درست نیست." });
    info.mockRestore();
  });

  it("says «one hour» when the account's own allowance is what refuses", async () => {
    process.env.ADMIN_PASSWORD = "the-admin-pass-1";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const a = user({ phone: "09121110130" });
    await signInAs(a, "pw");
    for (let i = 0; i < 8; i++) {
      h.headers = { "x-forwarded-for": `203.0.113.${i + 1}` }; // a new address each time: only the account counts
      expect(await submit(() => activateAdmin(null, form({ password: `guess-${i}` })))).toEqual({ error: "رمز مدیریت درست نیست." });
    }
    h.headers = { "x-forwarded-for": "203.0.113.50" };
    expect(await submit(() => activateAdmin(null, form({ password: "the-admin-pass-1" })))).toEqual({ error: "تلاش‌های زیادی برای این حساب انجام شد؛ یک ساعت دیگر امتحان کنید." });
    expect(a.role).toBe("user");
    warn.mockRestore();
  }, 30_000);

  it("the account sign-in of /admin/login is a form action: errors come back with the typed number, success redirects", async () => {
    const { adminSignIn } = await import("@/app/actions/admin");
    const { hashPassword } = await import("@/lib/auth");
    user({ phone: "09121110131", role: "admin", password_hash: await hashPassword("owner-pass-1") });
    expect(await submit(() => adminSignIn(null, form({ username: "09121110131", password: "nope-nope" })))).toMatchObject({ login: "09121110131", error: expect.any(String) });
    expect(await submit(() => adminSignIn(null, form({ username: "09121110131", password: "owner-pass-1" })))).toEqual({ redirect: "/admin" });
    // an ordinary account comes back to the page, which says it has no access
    user({ phone: "09121110132", password_hash: await hashPassword("member-pass-1") });
    expect(await submit(() => adminSignIn(null, form({ username: "09121110132", password: "member-pass-1" })))).toEqual({ redirect: "/admin/login" });
  }, 30_000);
});

describe("the known-device cookie ends with the password", async () => {
  const { signIn } = await import("@/app/actions/account");
  const { hashPassword } = await import("@/lib/auth");
  const { setMemberPassword } = await import("@/lib/members");

  it("an old browser loses its pass once the admin resets the password, and a known browser still has a ceiling", async () => {
    const m = user({ phone: "09121110140", password_hash: await hashPassword("right-pass-1") });
    expect((await signIn({ login: m.phone, password: "right-pass-1", lang: "fa" })).ok).toBe(true);
    const device = jar.get("celin_device")!.value;
    // the account's failure ceiling is used up
    const { sha256 } = await import("@/lib/crypto");
    const who = sha256(m.phone).slice(0, 24);
    fake.table("celin_rate_limits").push({ key: `signin-fail:${who}`, window_start: new Date().toISOString(), count: 40 });
    jar = new FakeJar();
    h.jar = jar;
    jar.set("celin_device", device);
    expect((await signIn({ login: m.phone, password: "right-pass-1", lang: "fa" })).ok).toBe(true); // the owner's browser
    // the admin resets the password: the old browser is a stranger now
    const admin = user({ phone: "09121119998", role: "admin", password_hash: "scrypt$a" });
    await signInAs(admin, "pw");
    await setMemberPassword(m.id, "brand-new-pass-1");
    jar = new FakeJar();
    h.jar = jar;
    jar.set("celin_device", device);
    expect(await signIn({ login: m.phone, password: "brand-new-pass-1", lang: "en" })).toEqual({ ok: false, error: "Too many attempts — please try again in a few minutes." });
    // a known browser has a ceiling of its own
    const { markKnownDevice } = await import("@/lib/auth");
    await markKnownDevice(m.id, m.password_hash);
    fake.table("celin_rate_limits").push({ key: `signin-fail-dev:${who}`, window_start: new Date().toISOString(), count: 100 });
    expect((await signIn({ login: m.phone, password: "brand-new-pass-1", lang: "fa" })).ok).toBe(false);
  }, 30_000);
});

describe("admin sign-out", async () => {
  const { logout } = await import("@/app/actions/admin");
  const { isAdmin } = await import("@/lib/admin-auth");

  it("ends the admin account's session on every device", async () => {
    const owner = user({ phone: "09121110150", role: "admin", password_hash: "scrypt$own", session_version: 2 });
    await signInAs(owner, "pw");
    const copied = jar.get("celin_session")!.value;
    expect(await submit(() => logout())).toEqual({ redirect: "/admin/login" });
    expect(owner.session_version).toBe(3);
    jar.set("celin_session", copied);
    expect(await isAdmin()).toBe(false);
  });
});

describe("/api/me and the «پنل مدیریت» hint", async () => {
  const { GET } = await import("@/app/api/me/route");

  it("drops the admin hint once the panel would not open", async () => {
    const m = user({ phone: "09121110160", role: "user", session_version: 1 });
    await signInAs({ id: m.id, session_version: 0 }, "pw"); // demoted meanwhile: session ended
    jar.set("celin_ui", "1");
    jar.set("celin_admin_ui", "1");
    const r = await GET();
    expect(await r.json()).toMatchObject({ user: null, admin: false });
    expect(jar.get("celin_admin_ui")).toBeUndefined();
    expect(jar.get("celin_ui")).toBeUndefined();
  });

  it("keeps it for an admin account signed in with its password", async () => {
    const owner = user({ phone: "09121110161", role: "admin", password_hash: "scrypt$own" });
    await signInAs(owner, "pw");
    jar.set("celin_admin_ui", "1");
    const r = await GET();
    expect(await r.json()).toMatchObject({ user: { role: "admin" }, admin: true });
    expect(jar.get("celin_admin_ui")?.value).toBe("1");
  });
});

describe("settings links are refused, not dropped", async () => {
  const { saveContact, saveAnnouncement } = await import("@/app/actions/admin");

  it("answers an http:// map link with a message, and completes a pasted address without the scheme", async () => {
    await asAdmin();
    expect(await saveContact({ mapUrl: "http://maps.example.com/x" })).toEqual({ ok: false, error: "لینک نقشه باید با https:// شروع شود." });
    expect(await saveContact({ mapUrl: "maps.app.goo.gl/abc" })).toMatchObject({ ok: true });
    expect((fake.table("celin_settings").find((r) => r.key === "contact")?.value as { mapUrl: string }).mapUrl).toBe("https://maps.app.goo.gl/abc");
    expect(await saveAnnouncement({ link: "javascript:alert(1)" })).toMatchObject({ ok: false });
    expect(await saveAnnouncement({ link: "//evil.example" })).toMatchObject({ ok: false });
    expect(await saveAnnouncement({ link: "/collections" })).toMatchObject({ ok: true });
  });
});

describe("pictures that orders still show", async () => {
  const { deleteMedia, mediaInOrders } = await import("@/lib/admin-media");

  it("leave the library but keep their files", async () => {
    await asAdmin();
    const kept = { id: crypto.randomUUID(), path: "m/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ext: "webp", widths: [480, 960] };
    const free = { id: crypto.randomUUID(), path: "m/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ext: "webp", widths: [480] };
    fake.table("celin_media").push(kept, free);
    fake.table("celin_order_items").push({ id: crypto.randomUUID(), image: { path: kept.path, ext: "webp", widths: [480, 960] } });
    expect(await mediaInOrders(kept.id)).toBe(1);
    expect(await deleteMedia(kept.id)).toEqual({ keptForOrders: 1 });
    expect(fake.removed).toEqual([]);
    expect(fake.table("celin_media").some((r) => r.id === kept.id)).toBe(false);
    expect(await deleteMedia(free.id)).toEqual({ keptForOrders: 0 });
    expect(fake.removed).toEqual(["celin-media/m/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/480.webp"]);
  });
});

describe("admin lists", async () => {
  const { orderSearch } = await import("@/lib/admin-data");
  const { stockLevel } = await import("@/components/admin/catalog-labels");

  it("finds orders by phone or code typed with Persian digits", () => {
    expect(orderSearch("۰۹۹۹۰۰۰۸۸۰۱")).toMatchObject({ phone: "09990008801" });
    expect(orderSearch("0999 000 8801")).toMatchObject({ phone: "09990008801" });
    expect(orderSearch("+98 999 000 8801")).toMatchObject({ phone: "09990008801" });
    expect(orderSearch("CL-۹۱۷۰۷۴")).toEqual({ code: "917074" });
    expect(orderSearch("cl 917074")).toEqual({ code: "917074" });
    expect(orderSearch("۹۱۷۰۷۴")).toMatchObject({ digits: "917074" });
    expect(orderSearch("نگار, (x)")).toMatchObject({ text: "نگار x" });
    expect(orderSearch("  ")).toBeNull();
  });

  it("flags a product low when any option is low, with the settings' threshold", () => {
    expect(stockLevel({ stock: 5, min_stock: 2 }, 3)).toBe("low"); // options 3 and 2
    expect(stockLevel({ stock: 18, min_stock: 2 }, 3)).toBe("low");
    expect(stockLevel({ stock: 18, min_stock: 4 }, 3)).toBeNull();
    expect(stockLevel({ stock: 3, min_stock: 3 }, 3)).toBe("low"); // members see «only 3 left» too
    expect(stockLevel({ stock: 0, min_stock: 0 }, 3)).toBe("out");
  });

  it("counts on the dashboard exactly what the list's filter shows", async () => {
    await asAdmin();
    const { lowStockCount } = await import("@/lib/admin-catalog");
    const p = (id: string, stock: number, status = "published") => fake.table("celin_products").push({ id, stock, status });
    p("p1", 10);
    p("p2", 0);
    p("p3", 0, "draft");
    p("p4", 0);
    fake.table("celin_variants").push({ product_id: "p2", stock: 3 }, { product_id: "p2", stock: 2 }, { product_id: "p4", stock: 9 });
    expect(await lowStockCount(3)).toBe(1); // p2 (an option at 2); p1 has 10, p3 is a draft, p4's option has 9
    expect(await lowStockCount(10)).toBe(3);
  });
});

describe("Admin → Connections knows which SQL files have run", async () => {
  const { pendingMigrations, migrationFiles } = await import("@/lib/admin-data");

  it("asks for a content file whose effect is missing, and for newer files that did not record themselves", async () => {
    await asAdmin();
    fake.rpcs.celin_admin_counts = () => ({ data: {}, error: null });
    fake.rpcs.celin_schema_version = () => ({ data: 20261024, error: null });
    fake.table("celin_products").push({ id: "p1", specs: [{ label_fa: "نگین", value_fa: "زیرکونیای مکعبی سفید", label_en: "Stones", value_en: "white cubic zirconia" }] });
    fake.table("celin_products").push({ id: "p2", specs: [{ label_fa: "پرداخت", value_fa: "نشانده و پرداخت‌شده با دست", label_en: "Finishing", value_en: "Hand-set and hand-finished" }] });
    const files = migrationFiles().map((f) => f.name);
    let pending = (await pendingMigrations()).map((p) => p.file);
    expect(pending).toContain("20261024100000_celin_no_stone_material.sql");
    expect(pending).toContain("20261024120000_celin_admin_fixes.sql");
    expect(pending).not.toContain("20261024090000_celin_hardening.sql");
    const cleanup = files.find((f) => f.startsWith("20261024110000"));
    if (cleanup) expect(pending).toContain(cleanup);
    // the files have run: the specs are clean and the newer files recorded their names
    fake.tables.celin_products = [{ id: "p1", specs: [{ label_fa: "نگین", value_fa: "سفید", label_en: "Stones", value_en: "white" }] }];
    for (const f of files) if (f >= "20261024120000") fake.table("celin_migrations").push({ name: f.replace(/\.sql$/, "") });
    pending = (await pendingMigrations()).map((p) => p.file);
    expect(pending).toEqual([]);
    // before the hardening file: it is asked for too
    delete fake.rpcs.celin_schema_version;
    expect((await pendingMigrations()).map((p) => p.file)).toEqual(["20261024090000_celin_hardening.sql"]);
  });
});
