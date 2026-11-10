// «ورود با حساب سازمانی» end to end against the fake domain controller: every login name form, wrong and empty
// passwords (the empty one never reaches the DC), LDAP injection, disabled / locked / expired / password-expired /
// must-change accounts (told only once the password was right), nested groups mapped to roles only while the
// approved mappings stand, just-in-time members with refreshed attributes, people the directory switches off losing
// their sessions (at sign-in and at the next synchronisation), the local lockout and rate limits that keep password
// spraying off the DC, certificate failures, the sign-in audit and the administrators' notifications.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { GENERIC_LOGIN_MESSAGE } from "@shared/auth/login";
import { adWorld, AGENTS, ADMINS, type AdWorld } from "./auth-ad-helpers";
import { BASE, person } from "./ldap-fake";

let w: AdWorld;
beforeAll(async () => {
  w = await adWorld();
});
afterAll(() => w.close());

const roles = async (email: string) => {
  const m = (await w.owner.get(`${w.P}/access/members`)).members as { email: string; roles: string[]; user_id: string }[];
  return m.find((x) => x.email === email);
};
const events = async (q: Record<string, string> = {}) => (await w.owner.get(`${w.P}/auth/signins?${new URLSearchParams(q)}`)).events as any[];

describe("signing in with a domain account", () => {
  it("accepts ali, CORP\\ali and ali@corp.test as the same person, created on first sign-in", async () => {
    const a = await w.signIn("ali", "Passw0rd!");
    expect(a.r).toMatchObject({ ok: true, org_id: w.org });
    const me = await a.c.get("/auth/me");
    expect(me.user.email).toBe("ali@corp.test");
    expect(me.user.full_name).toBe("Ali Rezaei");
    expect(me.session).toMatchObject({ method: "ldap", org_id: w.org });
    expect(me.orgs.map((o: { id: string }) => o.id)).toEqual([w.org]);
    const b = await w.signIn("CORP\\ali", "Passw0rd!");
    const c = await w.signIn("ali@corp.test", "Passw0rd!");
    expect(b.r.user_id).toBe(a.r.user_id);
    expect(c.r.user_id).toBe(a.r.user_id);
    // the member works in the organisation like anyone else
    await a.c.get(w.P);
    const ok = await events({ ok: "true", method: "ldap" });
    expect(ok.length).toBeGreaterThanOrEqual(3);
    expect(ok[0].data).toMatchObject({ method: "ldap", source: w.source.id });
    expect(ok[0].ip).toMatch(/^198\.51\.100\./);
  });

  it("maps nested directory groups to roles and groups (the approved mappings), and refreshes attributes", async () => {
    const ali = await roles("ali@corp.test");
    expect(ali!.roles.sort()).toEqual(["agent", "requester"]);
    const groupMembers = (await w.owner.get(`${w.P}/r/group_member?filter=${encodeURIComponent(JSON.stringify({ f: "group_id", op: "eq", v: w.team }))}`)).rows;
    expect(groupMembers.map((g: { user_id: string }) => g.user_id)).toContain(ali!.user_id);
    const detail = await w.owner.get(`${w.P}/access/members/${ali!.user_id}`);
    expect(detail.profile.title).toBe("کارشناس شبکه");
    expect(detail.profile.phone).toBe("021-5555");
    expect(detail.profile.org_unit_id).toBeTruthy();
    // sara: a requester whose manager is ali
    const s = await w.signIn("sara", "Passw0rd!");
    const sara = await roles("sara@corp.test");
    expect(sara!.roles).toEqual(["requester"]);
    const sd = await w.owner.get(`${w.P}/access/members/${s.r.user_id}`);
    expect(sd.profile.manager_id).toBe(ali!.user_id);
  });

  it("grants mapped roles only while the mappings are the approved ones", async () => {
    // a new mapping after the approval: reza signs in, the admin role waits
    await w.owner.patch(`${w.P}/r/directory_source/${w.source.id}`, { group_map: [{ source: AGENTS, role: "agent", group_id: w.team }, { source: ADMINS, role: "tenant_admin" }] });
    await w.signIn("reza", "Passw0rd!");
    expect((await roles("reza@corp.test"))!.roles).toEqual(["requester"]);
    const ev = (await events({ ok: "true", q: "reza" }))[0];
    expect(ev.data.pending_roles).toEqual(["tenant_admin"]);
    // approved: the next sign-in grants it; a mapping preview of the source shows who each mapping reaches
    await w.owner.post(`${w.P}/integration/directory/${w.source.id}/approve`);
    await w.signIn("reza", "Passw0rd!");
    expect((await roles("reza@corp.test"))!.roles.sort()).toEqual(["requester", "tenant_admin"]);
    const preview = await w.owner.get(`${w.P}/integration/directory/${w.source.id}/mappings`);
    expect(preview.approved).toBe(true);
    expect(preview.rows.find((r: { source: string }) => r.source === AGENTS)).toMatchObject({ found: true, members: 1 });
    // reza leaves the directory group: the role the mapping granted is taken back at his next sign-in
    const admins = w.dc.entries.find((e) => e.dn === ADMINS)!;
    admins.attrs.member = [];
    await w.signIn("reza", "Passw0rd!");
    expect((await roles("reza@corp.test"))!.roles).toEqual(["requester"]);
  });

  it("refuses a wrong password with the one sentence that tells nothing", async () => {
    const r = await w.client().raw("POST", "/auth/directory", { login: "sara", password: "nope" });
    expect(r.status).toBe(401);
    expect(r.json.error.message).toBe(GENERIC_LOGIN_MESSAGE);
    const unknown = await w.client().raw("POST", "/auth/directory", { login: "nobody", password: "nope" });
    expect(unknown.status).toBe(401);
    expect(unknown.json.error.message).toBe(GENERIC_LOGIN_MESSAGE);
    const failed = await events({ ok: "false", method: "ldap" });
    expect(failed.map((e) => e.data.reason)).toEqual(expect.arrayContaining(["wrong_password", "unknown_account"]));
  });

  it("refuses an empty password before contacting the domain controller", async () => {
    w.dc.reset();
    const r = await w.client().raw("POST", "/auth/directory", { login: "ali", password: "" });
    expect(r.status).toBe(400);
    expect(r.json.error.message).toMatch(/گذرواژه را وارد کنید/);
    expect(w.dc.connections).toBe(0);
    expect(w.dc.binds).toHaveLength(0);
  });

  it("makes LDAP injection in the username impossible", async () => {
    w.dc.reset();
    for (const login of ["*", "ali)(|(objectClass=*)", "*)(sAMAccountName=*", "CORP\\*", "a*@corp.test"]) {
      const r = await w.client().raw("POST", "/auth/directory", { login, password: "Passw0rd!" });
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.status).not.toBe(200);
    }
    // every typed value reached the DC escaped, and nobody but the service account bound
    const typed = w.dc.filters.filter((f) => f.includes("sAMAccountName") || f.includes("userPrincipalName"));
    expect(typed.length).toBeGreaterThan(0);
    for (const f of typed) expect(f).not.toMatch(/=\*\)/);
    expect(typed.some((f) => f.includes("ali\\29\\28|\\28objectClass=\\2a\\29"))).toBe(true);
    expect(w.dc.binds.filter((b) => b.ok && !b.dn.startsWith("CN=svc-kariz"))).toHaveLength(0);
  });
});

describe("accounts the directory refuses", () => {
  it("tells a disabled, expired, password-expired or must-change account apart only with the right password", async () => {
    const cases: [string, RegExp][] = [
      ["disabled", /غیرفعال است/],
      ["expired", /اعتبار حساب سازمانی شما به پایان رسیده/],
      ["oldpass", /منقضی شده است/],
      ["newbie", /باید گذرواژهٔ حساب سازمانی‌تان را عوض کنید/],
    ];
    for (const [login, message] of cases) {
      const right = await w.client().raw("POST", "/auth/directory", { login, password: "Passw0rd!" });
      expect(right.status).toBe(401);
      expect(right.json.error.message).toMatch(message);
      const wrong = await w.client().raw("POST", "/auth/directory", { login, password: "wrong" });
      expect(wrong.json.error.message).toBe(GENERIC_LOGIN_MESSAGE);
    }
  });

  it("refuses a locked account without asking the domain controller to check a password", async () => {
    w.dc.reset();
    const r = await w.client().raw("POST", "/auth/directory", { login: "locked", password: "Passw0rd!" });
    expect(r.status).toBe(401);
    expect(r.json.error.message).toBe(GENERIC_LOGIN_MESSAGE);
    expect(w.dc.binds.filter((b) => b.dn.includes("CN=locked"))).toHaveLength(0);
    expect((await events({ ok: "false", q: "locked" }))[0].data.reason).toBe("locked");
  });

  it("needs an e-mail to make a member", async () => {
    const r = await w.client().raw("POST", "/auth/directory", { login: "nomail", password: "Passw0rd!" });
    expect(r.status).toBe(401);
    expect(r.json.error.message).toMatch(/ایمیل ندارد/);
  });

  it("a person switched off in the directory loses access at the next sign-in, sessions included", async () => {
    const s = await w.signIn("sara", "Passw0rd!");
    await s.c.get("/auth/me");
    const entry = w.dc.entries.find((e) => e.dn.startsWith("CN=Sara"))!;
    entry.attrs.userAccountControl = ["514"];
    entry.bindCode = "533";
    const again = await w.client().raw("POST", "/auth/directory", { login: "sara", password: "Passw0rd!" });
    expect(again.json.error.message).toMatch(/غیرفعال است/);
    await s.c.get("/auth/me", 401);
    entry.attrs.userAccountControl = ["512"];
    entry.bindCode = undefined;
  });

  it("…and at the next synchronisation (removed from the directory: membership off, sessions ended)", async () => {
    const extra = person("temp", { name: "Temp Worker" });
    w.dc.entries.push(extra);
    const s = await w.signIn("temp", "Passw0rd!");
    await s.c.get("/auth/me");
    w.dc.entries.splice(w.dc.entries.indexOf(extra), 1);
    const p = await w.owner.post(`${w.P}/integration/directory/${w.source.id}/preview`);
    expect(p.plan.deactivate.map((d: { email: string }) => d.email)).toContain("temp@corp.test");
    await w.owner.post(`${w.P}/integration/directory/${w.source.id}/apply`, { run_id: p.run_id, roles: false });
    await s.c.get("/auth/me", 401);
  });

  it("never takes over an account of another organisation", async () => {
    const other = await w.owner.post("/orgs", { name: "شرکت دیگر" });
    await w.owner.post(`/o/${other.id}/members`, { email: "dual@corp.test", full_name: "عضو دو سازمان", role: "member" });
    w.dc.entries.push(person("dual", { name: "Dual Member" }));
    const r = await w.client().raw("POST", "/auth/directory", { login: "dual", password: "Passw0rd!" });
    expect(r.status).toBe(401);
    expect(r.json.error.message).toMatch(/پیوند نخورده است/);
  });

  it("links an existing member with a local password only through the administrator's synchronisation", async () => {
    await w.owner.post(`${w.P}/members`, { email: "clerk2@corp.test", full_name: "کارمند پیشین", role: "member" });
    w.dc.entries.push(person("clerk2", { name: "Clerk Two" }));
    const r = await w.client().raw("POST", "/auth/directory", { login: "clerk2", password: "Passw0rd!" });
    expect(r.status).toBe(401);
    expect(r.json.error.message).toMatch(/پیوند نخورده است/);
    const t = await w.owner.post(`${w.P}/integration/directory/${w.source.id}/login-test`, { login: "clerk2" });
    expect(t.member).toMatchObject({ linked: false, local_password: true });
    // the administrator's preview shows the link; once applied, the domain account signs in as that member
    const p = await w.owner.post(`${w.P}/integration/directory/${w.source.id}/preview`);
    expect(p.plan.links.map((l: { email: string }) => l.email)).toContain("clerk2@corp.test");
    await w.owner.post(`${w.P}/integration/directory/${w.source.id}/apply`, { run_id: p.run_id, roles: false });
    const ok = await w.signIn("clerk2", "Passw0rd!");
    expect((await ok.c.get("/auth/me")).user.email).toBe("clerk2@corp.test");
  });
});

describe("protecting the domain controller", () => {
  it("locks a login name locally after repeated failures — the DC never sees the next tries — and tells the administrators", async () => {
    const before = Number((await w.db.one<{ n: number }>(`select count(*)::int as n from sm_jobs where org_id = $1`, [w.org]))!.n);
    for (let i = 0; i < 5; i++) {
      const r = await w.client().raw("POST", "/auth/directory", { login: "ali", password: `guess-${i}` });
      expect(r.status).toBe(401);
    }
    w.dc.reset();
    const blocked = await w.client().raw("POST", "/auth/directory", { login: "ali", password: "Passw0rd!" });
    expect(blocked.status).toBe(401);
    expect(blocked.json.error.message).toBe(GENERIC_LOGIN_MESSAGE);
    expect(w.dc.connections).toBe(0);
    expect((await events({ ok: "false", q: "ali" }))[0].data.reason).toBe("throttled");
    const after = Number((await w.db.one<{ n: number }>(`select count(*)::int as n from sm_jobs where org_id = $1`, [w.org]))!.n);
    expect(after).toBeGreaterThan(before);
    // «رفع قفل» lets the person in again
    const locks = (await w.owner.get(`${w.P}/auth/locks`)).locks as { key: string; subject: string; kind: string }[];
    const lock = locks.find((l) => l.kind === "login" && l.subject === "ali")!;
    expect(lock).toBeTruthy();
    await w.owner.del(`${w.P}/auth/locks/${encodeURIComponent(lock.key)}`);
    await w.signIn("ali", "Passw0rd!");
  });

  it("holds back an address that sprays passwords across many names", async () => {
    await w.owner.put(`${w.P}/auth/policy`, { lockout: { ip_threshold: 5 } });
    const c = w.client();
    for (let i = 0; i < 5; i++) await c.raw("POST", "/auth/directory", { login: `user${i}`, password: "Winter2026!" });
    const r = await c.raw("POST", "/auth/directory", { login: "sara", password: "Passw0rd!" });
    expect(r.status).toBe(429);
    // another address is not affected
    await w.signIn("sara", "Passw0rd!");
    await w.owner.put(`${w.P}/auth/policy`, { lockout: { ip_threshold: 30 } });
  });
});

describe("the source's administration", () => {
  it("tests a login name without its password: account state, nested groups, the access it would get", async () => {
    const t = await w.owner.post(`${w.P}/integration/directory/${w.source.id}/login-test`, { login: "CORP\\ali" });
    expect(t.ok).toBe(true);
    expect(t.steps.map((s: { key: string }) => s.key)).toEqual(["connect", "bind", "search", "groups"]);
    expect(t.steps[0].detail).toMatch(/TLS/);
    expect(t.groups.map((g: { name: string }) => g.name).sort()).toEqual(["Kariz-Agents", "Kariz-Agents-Network"]);
    expect(t.access.roles.map((r: { role: string }) => r.role)).toEqual(["agent"]);
    expect(t.member.linked).toBe(true);
    expect(JSON.stringify(t)).not.toContain("Passw0rd");
    const missing = await w.owner.post(`${w.P}/integration/directory/${w.source.id}/login-test`, { login: "ghost" });
    expect(missing.ok).toBe(false);
    // the service account's password never comes back
    const row = (await w.owner.get(`${w.P}/r/directory_source/${w.source.id}`)).row;
    expect(JSON.stringify(row)).not.toContain("Svc-Pass-1!");
  });

  it("refuses certificates its root CA did not sign (and says why to the administrators)", async () => {
    const bad = (await w.owner.post(`${w.P}/r/directory_source`, {
      name: "گواهی بیگانه", kind: "ldap", ldap_url: w.dc.url, tls_mode: "ldaps", ca_cert: w.pki.foreignCa.pem, bind_dn: "CN=svc-kariz,OU=Service Accounts," + BASE, bind_password: "Svc-Pass-1!", base_dn: BASE,
      login_enabled: true, login_domains: ["OTHER"],
    })).row;
    await w.owner.post(`${w.P}/integration/directory/${bad.id}/approve`);
    const r = await w.client().raw("POST", "/auth/directory", { login: "OTHER\\ali", password: "Passw0rd!" });
    expect(r.status).toBe(503);
    expect(r.json.error.message).toMatch(/درست پیکربندی نشده/);
    const ev = (await events({ ok: "false", source: bad.id }))[0];
    expect(ev.data.reason).toBe("tls");
    expect(ev.data.detail).toMatch(/مرجع معتبری امضا نکرده/);
    const t = await w.owner.post(`${w.P}/integration/directory/${bad.id}/login-test`, { login: "ali" });
    expect(t.ok).toBe(false);
    expect(t.steps[0].detail).toMatch(/مرجع معتبری امضا نکرده/);
    await w.owner.del(`${w.P}/r/directory_source/${bad.id}`);
  });

  it("checks addresses, TLS and the root CA when a source is saved", async () => {
    const base = { name: "نادرست", kind: "ldap", bind_dn: "CN=x", base_dn: BASE };
    const e1 = await w.owner.post(`${w.P}/r/directory_source`, { ...base, ldap_url: "ldap://dc1.corp.test", tls_mode: "ldaps" }, 400);
    expect(e1.error.message).toMatch(/ldaps:\/\//);
    const e2 = await w.owner.post(`${w.P}/r/directory_source`, { ...base, ldap_url: "ldaps://dc1.corp.test", tls_mode: "ldaps", ca_cert: "not a certificate" }, 400);
    expect(e2.error.message).toMatch(/BEGIN CERTIFICATE/);
    const e3 = await w.owner.post(`${w.P}/r/directory_source`, { ...base, ldap_url: "ldaps://dc1.corp.test", tls_mode: "ldaps", proxy_ips: "not-an-ip" }, 400);
    expect(e3.error.message).toMatch(/پراکسی/);
  });
});

describe("an installation with several organisations", () => {
  it("routes a domain account only through the organisation's own sign-in link", async () => {
    const other = await w.owner.post("/orgs", { name: "شعبهٔ دوم" });
    await w.db.query(`insert into sm_org_admin (org_id, limits) values ($1, '{"plan":"enterprise"}'::jsonb) on conflict (org_id) do update set limits = excluded.limits`, [other.id]);
    const src2 = (await w.owner.post(`/o/${other.id}/r/directory_source`, {
      name: "AD شعبه", kind: "ldap", mode: "apply", ldap_url: w.dc.url, tls_mode: "ldaps", ca_cert: w.pki.ca.pem, bind_dn: "CN=svc-kariz,OU=Service Accounts," + BASE, bind_password: "Svc-Pass-1!", base_dn: BASE,
      login_enabled: true, login_domains: ["BRANCH"],
    })).row;
    await w.owner.post(`/o/${other.id}/integration/directory/${src2.id}/approve`);
    // without the link nothing is sent anywhere (no domain is matched across organisations)
    const r = await w.client().raw("POST", "/auth/directory", { login: "CORP\\ali", password: "Passw0rd!" });
    expect(r.status).toBe(400);
    const opts = await w.client().get("/auth/options");
    expect(opts.directory).toBeNull();
    const linked = await w.client().get(`/auth/options?dir=${w.source.id}`);
    expect(linked.directory.sources[0]).toMatchObject({ id: w.source.id, domains: ["CORP", "corp.test"] });
    await w.signIn("CORP\\ali", "Passw0rd!", 200, { source: w.source.id });
    await w.owner.del(`/o/${other.id}/r/directory_source/${src2.id}`);
  });
});
