import { beforeEach, describe, expect, it, vi } from "vitest";

type Err = { message: string; code?: string } | null;

// a fake Supabase: one in-memory pars_users table, plus a record of writes
const h = vi.hoisted(() => ({
  users: [] as Record<string, unknown>[],
  writes: [] as { table: string; op: string; row?: unknown }[],
  insertError: null as Err,
  readError: null as Err,
  mails: [] as { to: string; html: string }[],
}));

vi.mock("@/lib/db", () => {
  const client = {
    from: (table: string) => {
      let op = "select";
      let row: Record<string, unknown> | null = null;
      const filters: [string, unknown][] = [];
      const q: Record<string, unknown> = {};
      for (const m of ["select", "limit", "order", "single", "maybeSingle"]) q[m] = () => q;
      q.eq = (k: string, v: unknown) => (filters.push([k, v]), q);
      q.insert = (r: Record<string, unknown>) => ((op = "insert"), (row = r), q);
      q.update = (r: Record<string, unknown>) => ((op = "update"), (row = r), q);
      q.delete = () => ((op = "delete"), q);
      q.then = (ok: (r: unknown) => unknown) => {
        const match = (u: Record<string, unknown>) => filters.every(([k, v]) => u[k] === v);
        if (op !== "select") h.writes.push({ table, op, row: row ?? undefined });
        if (table !== "pars_users") return Promise.resolve({ data: null, error: null }).then(ok);
        if (op === "insert") {
          if (h.insertError) return Promise.resolve({ data: null, error: h.insertError }).then(ok);
          if (h.users.some((u) => u.email === row!.email)) return Promise.resolve({ data: null, error: { message: "duplicate key", code: "23505" } }).then(ok);
          const u = { id: "0f8fad5b-d9cb-469f-a165-70867728950e", role: "user", disabled: false, session_version: 0, phone: "", organization: "", ...row };
          h.users.push(u);
          return Promise.resolve({ data: { id: u.id }, error: null }).then(ok);
        }
        if (op === "update") {
          h.users.filter(match).forEach((u) => Object.assign(u, row));
          return Promise.resolve({ data: null, error: null }).then(ok);
        }
        if (op === "delete") return Promise.resolve({ data: null, error: null }).then(ok);
        if (h.readError) return Promise.resolve({ data: null, error: h.readError }).then(ok);
        return Promise.resolve({ data: h.users.find(match) ?? null, error: null }).then(ok);
      };
      return q;
    },
  };
  return { db: () => client, requireDb: () => client };
});
vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  startUserSession: vi.fn(async () => {}),
  endUserSession: vi.fn(async () => {}),
  currentUser: vi.fn(async () => null),
}));
vi.mock("@/lib/admin-auth", () => ({ endSession: async () => {}, assertAdmin: async () => {} }));
vi.mock("@/lib/request", () => ({ clientIp: async () => "127.0.0.1" }));
vi.mock("@/lib/rate-limit", () => ({ allow: async () => true }));
vi.mock("@/lib/email", () => ({ emailConfig: async () => ({ key: "re_x", from: "a@b.co" }), sendEmail: async (to: string, _s: string, html: string) => (h.mails.push({ to, html }), { ok: true }) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: () => unknown) => fn }));
vi.mock("next/server", () => ({ after: vi.fn() }));

import { changePassword, requestReset, signIn, signUp } from "@/app/actions/account";
import { submitTicket } from "@/app/actions/support";
import { deleteUserAccount, setUserRole } from "@/app/actions/users";
import { currentUser, hashPassword, startUserSession } from "@/lib/auth";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const good = { lang: "fa", name: "طاها", email: "User@Example.com", password: "long-enough-1" };

beforeEach(() => {
  h.users = [];
  h.writes = [];
  h.mails = [];
  h.insertError = null;
  h.readError = null;
  process.env.APP_SECRET = "test-secret-for-sessions-0123456789";
  vi.mocked(startUserSession).mockClear();
  vi.mocked(currentUser).mockResolvedValue(null);
});

describe("signUp", () => {
  it("stores a lower-case e-mail and a scrypt hash, never the password, and starts a session", async () => {
    expect(await signUp(good)).toMatchObject({ ok: true, next: "/account" });
    const u = h.users[0];
    expect(u.email).toBe("user@example.com");
    expect(String(u.password_hash)).toMatch(/^scrypt\$/);
    expect(JSON.stringify(h.writes)).not.toContain("long-enough-1");
    expect(startUserSession).toHaveBeenCalledOnce();
  });
  it("validates name, e-mail and password length", async () => {
    expect(await signUp({ ...good, name: "x" })).toMatchObject({ ok: false });
    expect(await signUp({ ...good, email: "nope" })).toMatchObject({ ok: false });
    expect(await signUp({ ...good, password: "short" })).toMatchObject({ ok: false });
    expect(await signUp({ ...good, password: "x".repeat(129) })).toMatchObject({ ok: false });
    expect(await signUp({ ...good, website: "spam" })).toMatchObject({ ok: false });
    expect(startUserSession).not.toHaveBeenCalled();
  });
  it("says the e-mail is taken", async () => {
    await signUp(good);
    const r = await signUp({ ...good, email: "USER@example.com" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("قبلاً");
  });
  it("reports a missing table as unavailable", async () => {
    h.insertError = { message: "relation does not exist", code: "42P01" };
    expect((await signUp(good)).ok).toBe(false);
    expect(startUserSession).not.toHaveBeenCalled();
  });
  it("only returns to same-site paths", async () => {
    expect(await signUp({ ...good, next: "/support" })).toMatchObject({ next: "/support" });
    for (const [i, next] of ["//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "/ space"].entries()) {
      expect(await signUp({ ...good, email: `u${i}@example.com`, next })).toMatchObject({ next: "/account" });
    }
  });
});

describe("signIn", () => {
  it("signs in with the right password, case-insensitive e-mail", async () => {
    await signUp(good);
    vi.mocked(startUserSession).mockClear();
    expect(await signIn({ lang: "fa", email: "USER@example.com", password: "long-enough-1" })).toMatchObject({ ok: true });
    expect(startUserSession).toHaveBeenCalledOnce();
  });
  it("gives one message for an unknown e-mail or a wrong password", async () => {
    await signUp(good);
    const unknown = await signIn({ lang: "en", email: "nobody@example.com", password: "whatever1" });
    const wrong = await signIn({ lang: "en", email: "user@example.com", password: "whatever1" });
    expect(unknown).toEqual({ ok: false, error: "The e-mail or password is not correct." });
    expect(wrong).toEqual(unknown);
  });
  it("refuses a disabled account and reports a database error as unavailable, not as a wrong password", async () => {
    await signUp(good);
    h.users[0].disabled = true;
    expect(await signIn({ lang: "en", email: "user@example.com", password: "long-enough-1" })).toMatchObject({ ok: false, error: expect.stringContaining("disabled") });
    h.readError = { message: "fetch failed" };
    expect(await signIn({ lang: "en", email: "user@example.com", password: "long-enough-1" })).toMatchObject({ ok: false, error: expect.stringContaining("temporarily") });
  });
});

describe("changePassword", () => {
  it("needs the current password and moves the session version on", async () => {
    h.users.push({ id: ID, email: "a@b.co", name: "A", phone: "", organization: "", role: "user", disabled: false, session_version: 0, password_hash: await hashPassword("old-password-1") });
    vi.mocked(currentUser).mockResolvedValue({ id: ID, email: "a@b.co", name: "A", phone: "", organization: "", role: "user", disabled: false, session_version: 0 });
    expect(await changePassword({ lang: "fa", current: "wrong-one-1", password: "new-password-1" })).toMatchObject({ ok: false });
    expect(await changePassword({ lang: "fa", current: "old-password-1", password: "new-password-1" })).toMatchObject({ ok: true });
    expect(h.users[0].session_version).toBe(1);
  });
});

describe("requestReset", () => {
  it("matches the e-mail exactly and mails the stored address", async () => {
    h.users.push({ id: ID, email: "a_b@x.co", name: "", disabled: false, session_version: 0 });
    expect((await requestReset({ lang: "fa", email: "A_B@x.co" })).ok).toBe(true);
    expect(h.mails.map((m) => m.to)).toEqual(["a_b@x.co"]);
    expect(await requestReset({ lang: "fa", email: "axb@x.co" })).toMatchObject({ ok: true });
    expect(h.mails).toHaveLength(1);
  });
});

describe("submitTicket", () => {
  it("needs a signed-in account", async () => {
    expect((await submitTicket({ lang: "fa", name: "Ali", subject: "Subject", body: "A long enough body text" })).ok).toBe(false);
  });
});

describe("user management", () => {
  it("never touches Supabase Auth and refuses changes to the admin's own account", async () => {
    vi.mocked(currentUser).mockResolvedValue({ id: ID } as never);
    expect(await setUserRole(ID, "user")).toMatchObject({ ok: false });
    expect(await deleteUserAccount(ID)).toMatchObject({ ok: false });
    expect(await setUserRole("not-an-id", "admin")).toMatchObject({ ok: false });
    expect(await deleteUserAccount("1f8fad5b-d9cb-469f-a165-70867728950e")).toMatchObject({ ok: true });
    expect(h.writes.at(-1)).toMatchObject({ table: "pars_users", op: "delete" });
  });
});
