import { beforeEach, describe, expect, it, vi } from "vitest";

// fake Supabase: records writes and auth admin calls; answers from h.*
const h = vi.hoisted(() => ({
  writes: [] as { table: string; op: string; row: unknown; eq?: unknown[] }[],
  createUser: { data: { user: { id: "0f8fad5b-d9cb-469f-a165-70867728950e" } }, error: null } as { data: { user: { id: string } | null }; error: { message: string; code?: string } | null },
  insertError: null as { message: string; code?: string } | null,
  deleted: [] as string[],
  profileByEmail: null as unknown,
  mails: [] as { to: string; html: string }[],
}));

vi.mock("@/lib/db", () => {
  const client = {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      let op = "select";
      let row: unknown = null;
      const eq: unknown[] = [];
      for (const m of ["select", "limit", "order"]) q[m] = () => q;
      q.eq = (...a: unknown[]) => (eq.push(a), q);
      q.insert = (r: unknown) => ((op = "insert"), (row = r), q);
      q.update = (r: unknown) => ((op = "update"), (row = r), q);
      q.maybeSingle = () => q;
      q.then = (ok: (r: unknown) => unknown) => {
        if (op !== "select") h.writes.push({ table, op, row, eq });
        if (op === "insert") return Promise.resolve({ error: h.insertError }).then(ok);
        return Promise.resolve({ data: op === "select" ? h.profileByEmail : null, error: null }).then(ok);
      };
      return q;
    },
    auth: {
      admin: {
        createUser: async () => h.createUser,
        deleteUser: async (id: string) => (h.deleted.push(id), { error: null }),
        updateUserById: async () => ({ error: null }),
      },
    },
  };
  return { db: () => client, requireDb: () => client };
});
vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  startUserSession: vi.fn(async () => {}),
  endUserSession: vi.fn(async () => {}),
  verifyPassword: vi.fn(async () => null),
  getProfile: vi.fn(async () => null),
  currentUser: vi.fn(async () => null),
}));
vi.mock("@/lib/admin-auth", () => ({ endSession: async () => {}, assertAdmin: async () => {} }));
vi.mock("@/lib/request", () => ({ clientIp: async () => "127.0.0.1" }));
vi.mock("@/lib/rate-limit", () => ({ allow: async () => true }));
vi.mock("@/lib/email", () => ({ emailConfig: async () => ({ key: "re_x", from: "a@b.co" }), sendEmail: async (to: string, _s: string, html: string) => (h.mails.push({ to, html }), { ok: true }) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: () => unknown) => fn }));
vi.mock("next/server", () => ({ after: vi.fn() }));

import { requestReset, signIn, signUp } from "@/app/actions/account";
import { submitTicket } from "@/app/actions/support";
import { deleteUserAccount, setUserRole } from "@/app/actions/users";
import { currentUser, startUserSession, verifyPassword } from "@/lib/auth";

const good = { lang: "fa", name: "طاها", email: "User@Example.com", password: "long-enough-1" };

beforeEach(() => {
  h.writes = [];
  h.deleted = [];
  h.mails = [];
  h.insertError = null;
  h.profileByEmail = null;
  h.createUser = { data: { user: { id: "0f8fad5b-d9cb-469f-a165-70867728950e" } }, error: null };
  vi.mocked(startUserSession).mockClear();
  vi.mocked(currentUser).mockResolvedValue(null);
});

describe("signUp", () => {
  it("creates the user, a lower-case profile and a session", async () => {
    const r = await signUp(good);
    expect(r).toMatchObject({ ok: true, next: "/account" });
    expect(h.writes[0]).toMatchObject({ table: "pars_profiles", op: "insert", row: { email: "user@example.com", name: "طاها" } });
    expect(startUserSession).toHaveBeenCalledOnce();
  });
  it("validates name, e-mail and password length", async () => {
    expect(await signUp({ ...good, name: "x" })).toMatchObject({ ok: false });
    expect(await signUp({ ...good, email: "nope" })).toMatchObject({ ok: false });
    expect(await signUp({ ...good, password: "short" })).toMatchObject({ ok: false });
    expect(await signUp({ ...good, password: "x".repeat(73) })).toMatchObject({ ok: false });
    expect(await signUp({ ...good, website: "spam" })).toMatchObject({ ok: false });
    expect(startUserSession).not.toHaveBeenCalled();
  });
  it("says the e-mail is taken", async () => {
    h.createUser = { data: { user: null }, error: { message: "A user with this email address has already been registered", code: "email_exists" } };
    const r = await signUp(good);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("قبلاً");
  });
  it("removes the auth user when the profile cannot be stored", async () => {
    h.insertError = { message: "relation does not exist", code: "42P01" };
    expect((await signUp(good)).ok).toBe(false);
    expect(h.deleted).toEqual(["0f8fad5b-d9cb-469f-a165-70867728950e"]);
    expect(startUserSession).not.toHaveBeenCalled();
  });
  it("only returns to same-site paths", async () => {
    expect(await signUp({ ...good, next: "/support" })).toMatchObject({ next: "/support" });
    for (const next of ["//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "/ space"]) {
      expect(await signUp({ ...good, next })).toMatchObject({ next: "/account" });
    }
  });
});

describe("signIn", () => {
  it("gives one message for an unknown e-mail or a wrong password", async () => {
    vi.mocked(verifyPassword).mockResolvedValueOnce(null);
    const r = await signIn({ lang: "en", email: "a@b.co", password: "whatever1" });
    expect(r).toEqual({ ok: false, error: "The e-mail or password is not correct." });
  });
});

describe("requestReset", () => {
  it("matches the e-mail exactly and mails the stored address", async () => {
    h.profileByEmail = { id: "0f8fad5b-d9cb-469f-a165-70867728950e", email: "a_b@x.co", name: "", disabled: false, session_version: 0 };
    process.env.APP_SECRET = "test-secret-for-sessions-0123456789";
    const r = await requestReset({ lang: "fa", email: "A_B@x.co" });
    expect(r.ok).toBe(true);
    expect(h.mails.map((m) => m.to)).toEqual(["a_b@x.co"]);
  });
  it("answers the same when there is no such account", async () => {
    const r = await requestReset({ lang: "fa", email: "nobody@x.co" });
    expect(r.ok).toBe(true);
    expect(h.mails).toHaveLength(0);
  });
});

describe("submitTicket", () => {
  it("needs a signed-in account", async () => {
    const r = await submitTicket({ lang: "fa", name: "Ali", subject: "Subject", body: "A long enough body text" });
    expect(r.ok).toBe(false);
  });
});

describe("user management", () => {
  it("refuses role changes and deletion on the admin's own account", async () => {
    vi.mocked(currentUser).mockResolvedValue({ id: "0f8fad5b-d9cb-469f-a165-70867728950e" } as never);
    expect(await setUserRole("0f8fad5b-d9cb-469f-a165-70867728950e", "user")).toMatchObject({ ok: false });
    expect(await deleteUserAccount("0f8fad5b-d9cb-469f-a165-70867728950e")).toMatchObject({ ok: false });
    expect(await setUserRole("not-an-id", "admin")).toMatchObject({ ok: false });
  });
});
