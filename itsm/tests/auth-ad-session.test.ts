// The session policy of a bank: idle timeout, absolute lifetime (tightening sessions already open), one session per
// person, re-authentication before sensitive administration, sign-out everywhere, administrators who list and end
// sessions, secure cookie flags (X-Forwarded-Proto believed only from a trusted proxy), local sign-in closed to all but
// break-glass accounts, and directory sessions that reach only their organisation (never the platform console).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { adWorld, type AdWorld } from "./auth-ad-helpers";
import { Client } from "./helpers";

let w: AdWorld;
beforeAll(async () => {
  w = await adWorld();
});
afterAll(() => w.close());

const sessionId = (cookie: string) => cookie.split("=")[1].split(".")[0];

describe("session policy", () => {
  it("validates and saves the policy (only through its own page, re-authenticated and audited)", async () => {
    const p = await w.owner.get(`${w.P}/auth/policy`);
    expect(p.policy.session).toMatchObject({ idle_minutes: 0, absolute_hours: 720, reauth_minutes: 15 });
    // the generic organisation settings cannot touch it
    const e = await w.owner.patch(`${w.P}`, { settings: { auth: { local_login: "breakglass" } } }, 400);
    expect(e.error.message).toMatch(/امنیت ورود و نشست‌ها/);
    // break-glass without one account is refused
    const bad = await w.owner.put(`${w.P}/auth/policy`, { local_login: "breakglass", breakglass: [] }, 400);
    expect(bad.error.message).toMatch(/حساب اضطراری/);
    const audit = (await w.owner.get(`${w.P}/audit`)) as { entries?: unknown[]; rows?: unknown[] };
    expect(audit).toBeTruthy();
  });

  it("ends a session after the idle timeout", async () => {
    await w.owner.put(`${w.P}/auth/policy`, { session: { idle_minutes: 15 } });
    const s = await w.signIn("sara", "Passw0rd!");
    await s.c.get("/auth/me");
    await w.db.query(`update sm_sessions set last_seen_at = now() - interval '20 minutes' where id = $1`, [sessionId(s.c.cookie)]);
    await s.c.get("/auth/me", 401);
    expect((await w.db.one<{ revoke_reason: string }>(`select revoke_reason from sm_sessions where id = $1`, [sessionId(s.c.cookie)]))!.revoke_reason).toBe("idle");
    await w.owner.put(`${w.P}/auth/policy`, { session: { idle_minutes: 0 } });
  });

  it("gives sessions the absolute lifetime and tightens the ones already open", async () => {
    const s = await w.signIn("sara", "Passw0rd!");
    const id = sessionId(s.c.cookie);
    const before = (await w.db.one<{ hours: number }>(`select extract(epoch from expires_at - created_at) / 3600 as hours from sm_sessions where id = $1`, [id]))!.hours;
    expect(Math.round(Number(before))).toBe(720);
    const r = await w.owner.put(`${w.P}/auth/policy`, { session: { absolute_hours: 10, idle_minutes: 20 } });
    expect(r.tightened).toBeGreaterThan(0);
    const after = (await w.db.one<{ hours: number; idle_minutes: number }>(`select extract(epoch from expires_at - created_at) / 3600 as hours, idle_minutes from sm_sessions where id = $1`, [id]))!;
    expect(Math.round(Number(after.hours))).toBe(10);
    expect(after.idle_minutes).toBe(20);
    await w.owner.put(`${w.P}/auth/policy`, { session: { absolute_hours: 720, idle_minutes: 0 } });
  });

  it("keeps one active session per person when asked", async () => {
    await w.owner.put(`${w.P}/auth/policy`, { session: { single_session: true } });
    const a = await w.signIn("sara", "Passw0rd!");
    const b = await w.signIn("sara", "Passw0rd!");
    await b.c.get("/auth/me");
    await a.c.get("/auth/me", 401);
    await w.owner.put(`${w.P}/auth/policy`, { session: { single_session: false } });
  });

  it("makes the cookie end with the browser when the policy says so", async () => {
    await w.owner.put(`${w.P}/auth/policy`, { session: { browser_session: true } });
    const c = w.client();
    const r = await c.raw("POST", "/auth/directory", { login: "sara", password: "Passw0rd!" });
    expect(r.headers.get("set-cookie")).not.toMatch(/Max-Age/i);
    await w.owner.put(`${w.P}/auth/policy`, { session: { browser_session: false } });
    const d = await w.client().raw("POST", "/auth/directory", { login: "sara", password: "Passw0rd!" });
    expect(d.headers.get("set-cookie")).toMatch(/Max-Age=\d+/);
  });
});

describe("re-authentication before sensitive administration", () => {
  it("asks again once the policy's minutes have passed, then lets the change through", async () => {
    const id = sessionId(w.owner.cookie);
    await w.db.query(`update sm_sessions set reauth_at = now() - interval '30 minutes' where id = $1`, [id]);
    const refused = await w.owner.put(`${w.P}/auth/policy`, { session: { reauth_minutes: 10 } }, 401);
    expect(refused.error.code).toBe("reauth_required");
    // sensitive elsewhere too: approving a source, member roles
    await w.owner.post(`${w.P}/integration/directory/${w.source.id}/approve`, {}, 401);
    const wrong = await w.owner.post("/auth/reauth", { password: "nope" }, 401);
    expect(wrong.error.code).toBe("reauth_failed");
    await w.owner.post("/auth/reauth", { password: "s3cret-pass" });
    await w.owner.put(`${w.P}/auth/policy`, { session: { reauth_minutes: 10 } });
  });

  it("re-authenticates a domain session with the domain password", async () => {
    const s = await w.signIn("ali", "Passw0rd!");
    await w.db.query(`update sm_sessions set reauth_at = now() - interval '1 hour' where id = $1`, [sessionId(s.c.cookie)]);
    expect((await s.c.raw("POST", "/auth/reauth", { password: "wrong" })).status).toBe(401);
    await s.c.post("/auth/reauth", { password: "Passw0rd!" });
    const at = (await w.db.one<{ reauth_at: string }>(`select reauth_at from sm_sessions where id = $1`, [sessionId(s.c.cookie)]))!.reauth_at;
    expect(Date.now() - new Date(at).getTime()).toBeLessThan(60_000);
  });

  it("ends the session after five wrong passwords", async () => {
    const s = await w.signIn("sara", "Passw0rd!");
    for (let i = 0; i < 4; i++) expect((await s.c.raw("POST", "/auth/reauth", { password: `bad-${i}` })).status).toBe(401);
    const last = await s.c.raw("POST", "/auth/reauth", { password: "bad-5" });
    expect(last.json.error.message).toMatch(/خارج شدید/);
    await s.c.get("/auth/me", 401);
  });
});

describe("sessions: the person's and the administrators'", () => {
  it("signs out everywhere else", async () => {
    const a = await w.signIn("sara", "Passw0rd!");
    const b = await w.signIn("sara", "Passw0rd!");
    const r = await b.c.post("/auth/sessions/revoke-all", {});
    expect(r.sessions).toBeGreaterThanOrEqual(1);
    await a.c.get("/auth/me", 401);
    await b.c.get("/auth/me");
  });

  it("lets administrators see and end members' sessions", async () => {
    const s = await w.signIn("reza", "Passw0rd!");
    const list = (await w.owner.get(`${w.P}/auth/sessions?method=ldap`)).sessions as { id: string; email: string; auth_method: string; org_id: string }[];
    const mine = list.find((x) => x.id === sessionId(s.c.cookie))!;
    expect(mine).toMatchObject({ email: "reza@corp.test", auth_method: "ldap", org_id: w.org });
    await w.owner.del(`${w.P}/auth/sessions/${mine.id}`);
    await s.c.get("/auth/me", 401);
    // everyone at once (but the administrator)
    const t = await w.signIn("reza", "Passw0rd!");
    const all = await w.owner.post(`${w.P}/auth/sessions/revoke-all`, {});
    expect(all.sessions).toBeGreaterThanOrEqual(1);
    await t.c.get("/auth/me", 401);
    await w.owner.get("/auth/me");
    const audit = (await w.owner.get(`${w.P}/auth/signins`)).events as { kind: string }[];
    expect(audit.some((e) => e.kind === "sessions_revoked")).toBe(true);
  });
});

describe("cookies", () => {
  const cookieOf = async (headers: Record<string, string>, peer: string | null, url = "http://local.test") => {
    const res = await w.app.fetch(
      new Request(`${url}/api/auth/directory`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${200 + Math.floor(Math.random() * 50)}`, ...headers }, body: JSON.stringify({ login: "sara", password: "Passw0rd!" }) }),
      peer ? { incoming: { socket: { remoteAddress: peer } } } : undefined,
    );
    return res.headers.get("set-cookie") ?? "";
  };

  it("is HttpOnly and SameSite, and Secure on HTTPS — X-Forwarded-Proto only from a trusted proxy", async () => {
    const plain = await cookieOf({}, null);
    expect(plain).toMatch(/HttpOnly/);
    expect(plain).toMatch(/SameSite=Lax/);
    expect(plain).not.toMatch(/Secure/);
    expect(await cookieOf({}, null, "https://local.test")).toMatch(/Secure/);
    // behind the platform's proxy (no socket) or a loopback proxy (IIS on the same server): believed
    expect(await cookieOf({ "x-forwarded-proto": "https" }, null)).toMatch(/Secure/);
    expect(await cookieOf({ "x-forwarded-proto": "https" }, "127.0.0.1")).toMatch(/Secure/);
    // straight from a client that claims HTTPS: not believed
    expect(await cookieOf({ "x-forwarded-proto": "https" }, "203.0.113.9")).not.toMatch(/Secure/);
  });
});

describe("where a session reaches", () => {
  it("closes local sign-in to all but the break-glass accounts once the organisation signs in with its directory", async () => {
    const added = await w.owner.post(`${w.P}/members`, { email: "clerk@bank.test", full_name: "کارمند محلی", role: "member" });
    const local = new Client(w.app);
    await local.post("/auth/login", { email: "clerk@bank.test", password: added.temp_password });
    await local.get(w.P);
    await w.owner.put(`${w.P}/auth/policy`, { local_login: "breakglass", breakglass: [w.ownerId] });
    // the open local session no longer reaches the organisation, and a new local sign-in is refused (after the password)
    const closed = await local.get(w.P, 403);
    expect(closed.error.message).toMatch(/بسته است/);
    const again = await new Client(w.app).post("/auth/login", { email: "clerk@bank.test", password: added.temp_password }, 403);
    expect(again.error.message).toMatch(/با حساب سازمانی وارد شوید/);
    const wrong = await new Client(w.app).post("/auth/login", { email: "clerk@bank.test", password: "not-it-at-all" }, 401);
    expect(wrong.error.message).not.toMatch(/حساب سازمانی/);
    // the break-glass owner still signs in locally; the directory still works
    await new Client(w.app).post("/auth/login", { email: "owner@bank.test", password: "s3cret-pass" });
    await w.signIn("sara", "Passw0rd!");
    await w.owner.put(`${w.P}/auth/policy`, { local_login: "all" });
  });

  it("a directory session reaches only its organisation, never another or the platform console", async () => {
    const s = await w.signIn("ali", "Passw0rd!");
    const other = await w.owner.post("/orgs", { name: "سازمان دیگر" });
    // even as a member there (added by its owner), the session opened by this organisation's directory stays here
    await w.owner.post(`/o/${other.id}/members`, { email: "ali@corp.test", full_name: "Ali Rezaei", role: "member" });
    const refused = await s.c.get(`/o/${other.id}`, 403);
    expect(refused.error.message).toMatch(/سازمان دیگری/);
    expect((await s.c.get("/orgs")).orgs.map((o: { id: string }) => o.id)).toEqual([w.org]);
    await s.c.post("/orgs", { name: "تازه" }, 403);
    // a platform administrator who signs in with a domain account does not reach the platform console
    await w.db.query(`update sm_users set is_platform_admin = true where email = 'ali@corp.test'`);
    await s.c.get("/admin/overview", 403);
    await w.db.query(`update sm_users set is_platform_admin = false where email = 'ali@corp.test'`);
  });
});
