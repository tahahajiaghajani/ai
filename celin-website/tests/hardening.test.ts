import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, FakeJar } from "./stubs/fake-db";

/**
 * Accounts, admin access and the security fixes, run against an in-memory database (tests/stubs/fake-db.ts):
 * the Pro code never signs into an admin or password account, revoking a used code ends its sessions and
 * the password made with it, ADMIN_PHONES promotes on sign-in/up, the per-account sign-in ceiling spares
 * known browsers, stock edits never undo orders, and more.
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
  // the rate limiter's SQL function, in memory
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
  delete process.env.ADMIN_PHONES;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.VERCEL;
  delete process.env.TRUSTED_IP_HEADER;
});

async function signInAs(u: { id: string; session_version: number }, via: "pw" | "code" = "pw") {
  const { sessionValue } = await import("@/lib/auth");
  jar.set("celin_session", sessionValue(u.id, u.session_version, Date.now(), via));
}

async function issue(userId: string, redeemed: boolean) {
  const { codeHashes, encrypt, generateCode, normalizeCode } = { ...(await import("@/lib/pro")), ...(await import("@/lib/crypto")) };
  const code = generateCode();
  const norm = normalizeCode(code);
  const row = { id: crypto.randomUUID(), user_id: userId, code_hash: codeHashes(norm)[0], code_enc: encrypt(code), hint: norm.slice(-4), request_id: null, expires_at: null, redeemed_at: redeemed ? new Date().toISOString() : null, last_used_at: null, revoked_at: null, created_at: new Date().toISOString() };
  fake.table("celin_pro_codes").push(row);
  return { code, row };
}

describe("the Pro code as a sign-in", async () => {
  const { enterCode } = await import("@/app/actions/account");

  it("never signs into an admin account", async () => {
    const admin = user({ phone: "09121110000", role: "admin", password_hash: "scrypt$x" });
    const codeOnlyAdmin = user({ phone: "09121110001", role: "admin" });
    for (const u of [admin, codeOnlyAdmin]) {
      const { code } = await issue(u.id, true);
      const r = await enterCode({ code, lang: "fa" });
      expect(r.ok).toBe(false);
      expect(jar.get("celin_session")).toBeUndefined();
    }
  });

  it("signs a password-less member in with a code session that does not count for the panel", async () => {
    const m = user({ phone: "09121110003", created_by_admin: true });
    const { code } = await issue(m.id, false);
    const r = await enterCode({ code, lang: "en" });
    expect(r).toMatchObject({ ok: true, signedIn: true });
    const { readSession } = await import("@/lib/auth");
    expect(readSession(jar.get("celin_session")!.value)).toMatchObject({ id: m.id, via: "code" });
    expect(jar.get("celin_admin_ui")).toBeUndefined();
  });
});

describe("admin access", async () => {
  const { isAdmin } = await import("@/lib/admin-auth");

  it("needs an admin account signed in with its password; a listed phone alone gets nothing", async () => {
    process.env.ADMIN_PHONES = "0912 111 0010";
    const owner = user({ phone: "09121110012", role: "admin" });
    const listed = user({ phone: "09121110010" }); // in ADMIN_PHONES, never activated
    await signInAs(owner, "pw");
    expect(await isAdmin()).toBe(true);
    await signInAs(owner, "code");
    expect(await isAdmin()).toBe(false);
    await signInAs(listed, "pw");
    expect(await isAdmin()).toBe(false);
  });
});

describe("sign-in and sign-up", async () => {
  const { signIn, signUp } = await import("@/app/actions/account");
  const { hashPassword } = await import("@/lib/auth");

  it("sends an admin back to the panel", async () => {
    user({ phone: "09121110020", role: "admin", password_hash: await hashPassword("owner-pass-1") });
    const r = await signIn({ login: "+98 912 111 0020", password: "owner-pass-1", next: "/admin/orders", lang: "fa" });
    expect(r).toMatchObject({ ok: true, next: "/admin/orders" });
    expect(jar.get("celin_admin_ui")?.value).toBe("1");
  });

  it("never promotes a listed number on sign-in or sign-up", async () => {
    process.env.ADMIN_PHONES = "09121110021, 09121110022";
    const listed = user({ phone: "09121110021", password_hash: await hashPassword("member-pass-1") });
    const r = await signIn({ login: "09121110021", password: "member-pass-1", lang: "fa" });
    expect(r).toMatchObject({ ok: true, next: "/account" });
    expect(listed.role).toBe("user");
    const up = await signUp({ name: "Someone", phone: "۰۹۱۲۱۱۱۰۰۲۲", password: "owner-pass-2", lang: "fa" });
    expect(up).toMatchObject({ ok: true, next: "/account" });
    expect(fake.table("celin_users").find((u) => u.phone === "09121110022")?.role ?? "user").toBe("user");
    expect(jar.get("celin_admin_ui")).toBeUndefined();
  });

  it("sends someone who came from the panel to its sign-in only if the account may be made admin", async () => {
    user({ phone: "09121110027", password_hash: await hashPassword("member-pass-1") });
    // no ADMIN_PASSWORD: nobody can be made admin
    expect(await signIn({ login: "09121110027", password: "member-pass-1", next: "/admin", lang: "fa" })).toMatchObject({ ok: true, next: "/account" });
    process.env.ADMIN_PASSWORD = "the-admin-pass-1";
    expect(await signIn({ login: "09121110027", password: "member-pass-1", next: "/admin", lang: "fa" })).toMatchObject({ ok: true, next: "/admin/login" });
    process.env.ADMIN_PHONES = "09121110099"; // an allow-list without this number
    expect(await signIn({ login: "09121110027", password: "member-pass-1", next: "/admin", lang: "fa" })).toMatchObject({ ok: true, next: "/account" });
  });

  it("answers calmly when accounts are not set up (no database)", async () => {
    h.db = null;
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const up = await signUp({ name: "Visitor", phone: "09121110023", password: "visitor-pass", lang: "fa" });
    expect(up).toEqual({ ok: false, error: "ثبت‌نام به‌زودی فعال می‌شود." });
    const inn = await signIn({ login: "09121110023", password: "visitor-pass", lang: "en" });
    expect(inn).toEqual({ ok: false, error: "Accounts open soon." });
    expect(err.mock.calls.flat().join(" ")).toMatch(/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/);
    err.mockRestore();
  });

  it("does not tell whether a number has an account without a password", async () => {
    user({ phone: "09121110024", created_by_admin: true });
    const known = await signIn({ login: "09121110024", password: "whatever-1", lang: "fa" });
    const unknown = await signIn({ login: "09121110025", password: "whatever-1", lang: "fa" });
    expect(known.ok).toBe(false);
    expect(!known.ok && !unknown.ok && known.error === unknown.error).toBe(true);
  });

  it("strangers' failures cannot lock the owner out of a browser that signed in before", async () => {
    const m = user({ phone: "09121110026", password_hash: await hashPassword("right-pass-1") });
    // a known browser: signed in once
    expect((await signIn({ login: m.phone, password: "right-pass-1", lang: "fa" })).ok).toBe(true);
    const device = jar.get("celin_device")!.value;
    // 40 failures from 40 addresses
    for (let i = 1; i <= 40; i++) {
      h.headers = { "x-forwarded-for": `203.0.113.${i}` };
      jar = new FakeJar();
      h.jar = jar;
      await signIn({ login: m.phone, password: "wrong-pass", lang: "fa" });
    }
    // a new browser, right password: refused while the ceiling holds
    h.headers = { "x-forwarded-for": "192.0.2.200" };
    jar = new FakeJar();
    h.jar = jar;
    expect(await signIn({ login: m.phone, password: "right-pass-1", lang: "en" })).toEqual({ ok: false, error: "Too many attempts — please try again in a few minutes." });
    // the owner's own browser: accepted
    jar.set("celin_device", device);
    expect((await signIn({ login: m.phone, password: "right-pass-1", lang: "fa" })).ok).toBe(true);
  }, 60_000); // 43 scrypt checks
});

describe("making an account admin with ADMIN_PASSWORD", async () => {
  const { activateAdmin } = await import("@/app/actions/admin");
  const { isAdmin } = await import("@/lib/admin-auth");
  const { readSession } = await import("@/lib/auth");
  const form = (password: string) => {
    const f = new FormData();
    f.set("password", password);
    return f;
  };
  const activate = async (password: string) => {
    try {
      return await activateAdmin(null, form(password));
    } catch (e) {
      return { redirect: (e as { url?: string }).url };
    }
  };

  it("promotes only on the right password, ends the other sessions and opens the panel here", async () => {
    process.env.ADMIN_PASSWORD = "the-admin-pass-1";
    const owner = user({ phone: "09121110060", session_version: 4 });
    await signInAs(owner, "pw");
    const other = jar.get("celin_session")!.value; // the same account on another device
    expect(await activate("wrong")).toEqual({ error: "رمز مدیریت درست نیست." });
    expect(owner.role).toBe("user");
    expect(await activate("the-admin-pass-1")).toEqual({ redirect: "/admin" });
    expect(owner.role).toBe("admin");
    expect(owner.session_version).toBe(5);
    expect(readSession(jar.get("celin_session")!.value)).toMatchObject({ id: owner.id, ver: 5, via: "pw" });
    expect(await isAdmin()).toBe(true);
    jar.set("celin_session", other);
    expect(await isAdmin()).toBe(false); // the older session has ended
  });

  it("does nothing without ADMIN_PASSWORD, for a code session, or for a number outside ADMIN_PHONES", async () => {
    const a = user({ phone: "09121110061" });
    await signInAs(a, "pw");
    expect(await activate("")).toMatchObject({ error: expect.any(String) }); // ADMIN_PASSWORD not set
    process.env.ADMIN_PASSWORD = "the-admin-pass-1";
    await signInAs(a, "code");
    expect(await activate("the-admin-pass-1")).toMatchObject({ error: expect.any(String) });
    process.env.ADMIN_PHONES = "09121110062";
    await signInAs(a, "pw");
    expect(await activate("the-admin-pass-1")).toMatchObject({ error: expect.any(String) });
    expect(a.role).toBe("user");
    // the allow-list is honoured: a listed number can be made admin (with the password)
    const listed = user({ phone: "09121110062" });
    await signInAs(listed, "pw");
    expect(await activate("the-admin-pass-1")).toEqual({ redirect: "/admin" });
    expect(listed.role).toBe("admin");
  });

  it("is rate-limited: after the allowance even the right password is refused", async () => {
    process.env.ADMIN_PASSWORD = "the-admin-pass-1";
    const a = user({ phone: "09121110063" });
    await signInAs(a, "pw");
    for (let i = 0; i < 8; i++) expect(await activate("guess-" + i)).toEqual({ error: "رمز مدیریت درست نیست." });
    expect(await activate("the-admin-pass-1")).toEqual({ error: "تلاش‌های زیادی انجام شد؛ ۱۵ دقیقه‌ی دیگر امتحان کنید." });
    expect(a.role).toBe("user");
  }, 30_000);
});

describe("a password set from a code session", async () => {
  const { changePassword } = await import("@/app/actions/account");

  it("is remembered as made with the code", async () => {
    const m = user({ phone: "09121110030", created_by_admin: true, session_version: 2 });
    await signInAs(m, "code");
    expect(await changePassword({ current: "", password: "new-pass-123", lang: "fa" })).toMatchObject({ ok: true });
    expect(m.password_from_code).toBe(true);
    expect(m.session_version).toBe(3);
  });

  it("is refused for an admin account", async () => {
    const a = user({ phone: "09121110031", role: "admin" });
    await signInAs(a, "code");
    expect((await changePassword({ current: "", password: "new-pass-123", lang: "fa" })).ok).toBe(false);
    expect(a.password_hash).toBeNull();
  });

  it("still works before the hardening migration (no password_from_code column)", async () => {
    fake.columns.celin_users = USERS_COLS.filter((c) => c !== "password_from_code");
    const m = user({ phone: "09121110032", created_by_admin: true });
    delete (m as Record<string, unknown>).password_from_code;
    await signInAs(m, "code");
    expect(await changePassword({ current: "", password: "new-pass-123", lang: "fa" })).toMatchObject({ ok: true });
    expect(m.password_hash).toMatch(/^scrypt\$/);
  });
});

describe("revoking or replacing a used code", async () => {
  const { revokeMemberCode, issueForMember, approveRequest } = await import("@/lib/members");

  async function asAdmin() {
    const a = user({ phone: "09121119999", role: "admin" });
    await signInAs(a, "pw");
  }

  it("ends every session of the account and the password made with the code", async () => {
    await asAdmin();
    const m = user({ phone: "09121110040", session_version: 5, password_hash: "scrypt$made-with-code", password_from_code: true });
    const { row } = await issue(m.id, true);
    const r = await revokeMemberCode(row.id);
    expect(r).toEqual({ ended: true, passwordCleared: true });
    expect(m.session_version).toBe(6);
    expect(m.password_hash).toBeNull();
    expect(fake.table("celin_messages").some((x) => x.user_id === m.id && x.kind === "pro")).toBe(true);
  });

  it("keeps a password the member chose on their own (but still signs them out)", async () => {
    await asAdmin();
    const m = user({ phone: "09121110041", session_version: 1, password_hash: "scrypt$own" });
    const { row } = await issue(m.id, true);
    expect(await revokeMemberCode(row.id)).toEqual({ ended: true, passwordCleared: false });
    expect(m.session_version).toBe(2);
    expect(m.password_hash).toBe("scrypt$own");
  });

  it("leaves the account alone for a code that was never entered", async () => {
    await asAdmin();
    const m = user({ phone: "09121110042", session_version: 1 });
    const { row } = await issue(m.id, false);
    expect(await revokeMemberCode(row.id)).toEqual({ ended: false, passwordCleared: false });
    expect(m.session_version).toBe(1);
  });

  it("re-issuing over an active code signs the member out too", async () => {
    await asAdmin();
    const m = user({ phone: "09121110043", session_version: 0, password_hash: "scrypt$x", password_from_code: true });
    await issue(m.id, true);
    const r = await issueForMember(m.id, 30);
    expect(r.ended).toBe(true);
    expect(m.session_version).toBe(1);
    expect(m.password_hash).toBeNull();
    // the inbox keeps a placeholder, never the code itself
    const msg = fake.table("celin_messages").find((x) => x.user_id === m.id && String(x.title_fa).includes("صادر"));
    expect(String(msg?.body_fa)).toContain("{{pro-code}}");
    expect(String(msg?.body_fa)).not.toContain(r.code);
    expect(r.delivered).toMatchObject({ inbox: true, sms: false, email: false });
  });

  it("approves a request once only", async () => {
    await asAdmin();
    const m = user({ phone: "09121110044" });
    fake.table("celin_pro_requests").push({ id: "11111111-2222-4333-8444-555555555555", user_id: m.id, status: "pending" });
    await approveRequest("11111111-2222-4333-8444-555555555555", 30);
    await expect(approveRequest("11111111-2222-4333-8444-555555555555", 30)).rejects.toThrow(/قبلاً بررسی/);
    expect(fake.table("celin_pro_codes").filter((c) => c.user_id === m.id)).toHaveLength(1);
  });
});

describe("the inbox shows the current code", async () => {
  const { listMessages, CODE_MARK } = await import("@/lib/messages");

  it("fills the placeholder while the code works, and says so once it does not", async () => {
    const m = user({ phone: "09121110050" });
    const { code, row } = await issue(m.id, true);
    fake.table("celin_messages").push({ id: crypto.randomUUID(), user_id: m.id, kind: "pro", title_fa: "", title_en: "", body_fa: `کد: ${CODE_MARK}`, body_en: `Code: ${CODE_MARK}`, link: "", read_at: null, created_at: new Date().toISOString() });
    let [msg] = await listMessages(m.id);
    expect(msg.body_en).toBe(`Code: ${code}`);
    expect(msg.body_fa).toBe(`کد: ‎${code}`);
    (row as { revoked_at: string | null }).revoked_at = new Date().toISOString();
    [msg] = await listMessages(m.id);
    expect(msg.body_en).toBe("Code: (no longer active)");
  });
});

describe("stock in the product editor", async () => {
  const { saveProduct } = await import("@/lib/admin-catalog");

  it("saves a stock edit as a change, so orders placed meanwhile are not undone", async () => {
    const a = user({ phone: "09121119998", role: "admin" });
    await signInAs(a, "pw");
    fake.table("celin_settings").push({ key: "catalog", value: { initialized: true } });
    const id = "77777777-7777-4777-8777-777777777777";
    const p = { id, slug: "qa-c-ring", name_fa: "انگشتر", stock: 3 };
    fake.table("celin_products").push(p);
    const form = { name_fa: "انگشتر", slug: "qa-c-ring", status: "published", price: 1000, stock: 3, stock_loaded: 3, variants: [] };
    p.stock = 1; // an order took two pieces while the editor was open
    await saveProduct(id, { ...form, subtitle_fa: "تازه" });
    expect(p.stock).toBe(1);
    await saveProduct(id, { ...form, stock: 10 }); // the admin added seven
    expect(p.stock).toBe(8);
    await saveProduct(id, { ...form, stock: 0, stock_loaded: 3 }); // "none left": never below zero
    expect(p.stock).toBe(5);
  });
});

describe("orders", async () => {
  const { canMove, restocksOnCancel } = await import("@/lib/order-meta");
  const { cleanLines, setOrderStatus } = await import("@/lib/orders");

  it("follows the status rules: shipped is final except a cancel without restock", () => {
    expect(canMove("pending", "shipped")).toBe(true);
    expect(canMove("ready", "packing")).toBe(true);
    expect(canMove("shipped", "pending")).toBe(false);
    expect(canMove("shipped", "ready")).toBe(false);
    expect(canMove("shipped", "cancelled")).toBe(true);
    expect(canMove("cancelled", "pending")).toBe(false);
    expect(restocksOnCancel("ready")).toBe(true);
    expect(restocksOnCancel("shipped")).toBe(false);
  });

  it("knows when the database changed nothing", async () => {
    fake.rpcs.celin_set_order_status = (a) => ({ data: a.p_status === "cancelled" ? "unchanged" : a.p_status, error: null });
    expect(await setOrderStatus("o", "cancelled", "", "admin")).toEqual({ ok: true, changed: false });
    expect(await setOrderStatus("o", "packing", "", "admin")).toEqual({ ok: true, changed: true });
    fake.rpcs.celin_set_order_status = () => ({ data: null, error: { message: "bad_transition" } });
    expect(await setOrderStatus("o", "pending", "", "admin")).toEqual({ ok: false, reason: "transition" });
  });

  it("sorts lines so concurrent orders lock rows in the same order", () => {
    const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const one = cleanLines([{ productId: B, qty: 1 }, { productId: A, qty: 1 }]);
    const two = cleanLines([{ productId: A, qty: 1 }, { productId: B, qty: 1 }]);
    expect(one).toEqual(two);
    expect(one[0].productId).toBe(A);
  });
});

describe("the visitor's IP for rate limits", async () => {
  const { clientIp } = await import("@/lib/request");

  it("trusts only headers a proxy wrote", async () => {
    h.headers = { "x-forwarded-for": "6.6.6.6, 203.0.113.9", "x-vercel-forwarded-for": "198.51.100.1", "ar-real-ip": "192.0.2.5" };
    expect(await clientIp()).toBe("203.0.113.9"); // self-hosted: the entry the closest proxy appended
    process.env.VERCEL = "1";
    expect(await clientIp()).toBe("198.51.100.1");
    process.env.TRUSTED_IP_HEADER = "AR-Real-IP";
    expect(await clientIp()).toBe("192.0.2.5");
  });
});
