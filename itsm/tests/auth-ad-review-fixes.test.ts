// AD sign-in review fixes: plaintext after StartTLS, e-mail fallback onto an account another identity holds, group
// mappings by DN matching look-alike CNs, Windows principals of unlisted domains, the local lockout under parallel and
// differently-typed guesses, re-authentication on the generic record API and the platform console, links that remember
// the directory object (a new person at a former employee's DN), the idle timeout under background polling, NTLM
// judged by the routed source, and the sign-in policy shown to members.
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { LdapClient, berInt, berStr, guidOf, seq } from "@server/modules/integration/ldap";
import { canonicalDn, groupMatches } from "@shared/integration/directory";
import { dnsDomainOf, entryInDomain } from "@server/modules/integration/directory-login";
import { setNegotiateValidator, type NegotiateValidator } from "@server/auth/sso";
import { adWorld, AGENTS, type AdWorld } from "./auth-ad-helpers";
import { BASE, SVC, fakeLdap, generalized, group, guidBytes, person, serviceAccount, testPki } from "./ldap-fake";

const pki = testPki();
const kerberos = (principal: string) => Buffer.from(`\x60\x82krb5-ap-req:${principal}`, "latin1").toString("base64");
const ntlmLeg = (n: number) => Buffer.concat([Buffer.from("NTLMSSP\u0000", "latin1"), Buffer.from([n, 0, 0, 0])]).toString("base64");
/** Kerberos «krb5-ap-req:<principal>» tokens; NTLM in two legs whose principal is CORP\sara. */
const fakeValidator: NegotiateValidator = {
  name: "test",
  async accept(token) {
    const text = token.toString("latin1");
    if (text.startsWith("NTLMSSP")) return text.charCodeAt(8) === 1 ? { done: false, response: Buffer.from("NTLMSSP\u0000\u0002challenge", "latin1") } : { done: true, principal: "CORP\\sara", response: null };
    const m = /krb5-ap-req:(.+)$/.exec(text);
    if (!m) throw new Error("SEC_E_INVALID_TOKEN");
    return { done: true, principal: m[1], response: null };
  },
};
afterEach(() => setNegotiateValidator(null));

const sessionIdOf = (cookie: string) => cookie.split("=")[1].split(".")[0];
const reasons = async (w: AdWorld, q: string) => ((await w.owner.get(`${w.P}/auth/signins?ok=false&q=${encodeURIComponent(q)}`)).events as { data: { reason: string } }[]).map((e) => e.data.reason);

describe("StartTLS", () => {
  it("refuses clear-text bytes behind the StartTLS answer instead of reading them as if they came over TLS", async () => {
    const ali = person("ali", { password: "Right-Pass-1!" });
    // an attacker on the path: a «success» for the next request (the user's bind), short of its last byte
    const forged = seq(0x30, berInt(2), seq(0x61, berInt(0, 0x0a), berStr(""), berStr("")));
    const dc = await fakeLdap([serviceAccount(), ali], { mode: "plain", cert: pki.server, requireTls: true, afterStartTls: forged.subarray(0, forged.length - 1) });
    try {
      const c = new LdapClient({ url: dc.url, bindDn: SVC.dn, password: SVC.password, ca: pki.ca.pem, startTls: true, requireTls: true, timeoutMs: 3000 });
      const attempt = (async () => {
        await c.connect();
        await c.bindAs(ali.dn, "wrong-password");
      })();
      await expect(attempt).rejects.toMatchObject({ kind: "protocol" });
      c.close();
      // an honest server still upgrades
      const honest = await fakeLdap([serviceAccount(), ali], { mode: "plain", cert: pki.server, requireTls: true });
      const h = new LdapClient({ url: honest.url, bindDn: SVC.dn, password: SVC.password, ca: pki.ca.pem, startTls: true, requireTls: true });
      await h.connect();
      await expect(h.bindAs(ali.dn, "wrong-password")).rejects.toMatchObject({ code: 49 });
      await h.bindAs(ali.dn, "Right-Pass-1!");
      h.close();
      await honest.close();
    } finally {
      await dc.close();
    }
  });
});

describe("group mappings by DN", () => {
  it("matches a mapping's DN to that very group only; a bare name to any group of that CN", () => {
    const real = "CN=Kariz-Admins,OU=Groups,DC=corp,DC=test";
    expect(groupMatches("CN=Kariz-Admins,OU=Branch12,DC=corp,DC=test", real)).toBe(false);
    expect(groupMatches("cn=kariz-admins, ou=groups, dc=corp, dc=test", real)).toBe(true);
    expect(groupMatches("CN=Kariz\\2DAdmins,OU=Groups,DC=corp,DC=test", real)).toBe(true);
    expect(groupMatches("CN=Kariz-Admins,OU=Branch12,DC=corp,DC=test", "Kariz-Admins")).toBe(true);
    expect(groupMatches("CN=Kariz-Admins,OU=Branch12,DC=corp,DC=test", "CN=Kariz-Admins")).toBe(true);
    expect(canonicalDn("CN=Smith\\, John,OU=Staff,DC=corp")).toBe("cn=smith, john,ou=staff,dc=corp");
    expect(canonicalDn("CN=\\D8\\A7\\D9\\84\\DB\\8C,DC=corp")).toBe("cn=الی,dc=corp");
  });
});

describe("Windows principals and domains (pure)", () => {
  it("knows a DN's DNS domain and whether an entry lives in the principal's domain", () => {
    expect(dnsDomainOf("CN=Sara,OU=Staff,DC=corp,DC=test")).toBe("corp.test");
    expect(dnsDomainOf("CN=x,o=bank")).toBeNull();
    const sara = { dn: "CN=Sara,OU=Staff,DC=corp,DC=test", attrs: { userPrincipalName: ["sara@corp.test"] } };
    const forest = { domains: ["CORP", "corp.test", "BRANCH", "branch.corp.test"] };
    expect(entryInDomain(forest, sara, "CORP")).toBe(true);
    expect(entryInDomain(forest, sara, "BRANCH")).toBe(false);
    expect(entryInDomain(forest, sara, "corp.test")).toBe(true);
    expect(entryInDomain(forest, sara, "branch.corp.test")).toBe(false);
    expect(entryInDomain({ domains: ["CORP"] }, sara, "CORP")).toBe(false);
    expect(guidOf(guidBytes("6f0a3c2e-1d4b-4e5f-8a9b-0c1d2e3f4a5b"))).toBe("6f0a3c2e-1d4b-4e5f-8a9b-0c1d2e3f4a5b");
  });
});

// ------------------------------------------------------------------------------------------------------------------

describe("password sign-in", () => {
  let w: AdWorld;
  beforeAll(async () => {
    const entries = [
      serviceAccount(),
      person("ali", { name: "Ali Rezaei" }),
      person("sara", { name: "Sara Ahmadi" }),
      person("arezaei", { name: "Ali Rezaei 2", upn: "ali.rezaei@corp.test", mail: "ali.rezaei@corp.test" }),
      person("temp", { name: "Temp Person" }),
      person("mover", { name: "Mover Person" }),
      person("lookalike", { name: "Look Alike" }),
      group("Kariz-Agents", [], "Groups"),
      group("Kariz-Agents", [], "Branch12"),
    ];
    // a member of the look-alike group only (memberOf as AD reports it)
    entries.find((e) => e.dn.startsWith("CN=Look Alike"))!.attrs.memberOf = [`CN=Kariz-Agents,OU=Branch12,${BASE}`];
    w = await adWorld({ entries });
  });
  afterAll(() => w.close());

  it("never signs a second directory identity into an account another identity holds through its e-mail", async () => {
    const ali = (await w.signIn("CORP\\ali", "Passw0rd!")).c;
    const aliId = (await ali.get("/auth/me")).user.id as string;
    // someone who can set «mail» on another account points it at Ali's address and signs in with their own password
    w.dc.entries.push(person("mallory", { name: "Mallory", mail: "ali@corp.test", password: "Mallory-Pass-1!" }));
    const r = await w.client().raw("POST", "/auth/directory", { login: "CORP\\mallory", password: "Mallory-Pass-1!" });
    expect(r.status).toBe(401);
    expect(await reasons(w, "mallory")).toContain("account_conflict");
    const links = await w.db.query<{ external_id: string }>(`select external_id from sm_directory_links where local_id = $1 and kind = 'user'`, [aliId]);
    expect(links.map((l) => l.external_id)).toEqual([`CN=Ali Rezaei,OU=Staff,${BASE}`]);
  });

  it("does not grant a role mapped to a group's DN to a member of a same-named group elsewhere", async () => {
    expect(w.source.group_map[0].source).toBe(AGENTS);
    const { c } = await w.signIn("CORP\\lookalike", "Passw0rd!");
    const me = (await c.get("/auth/me")).user.id as string;
    const members = (await w.owner.get(`${w.P}/access/members`)).members as { user_id: string; roles: string[] }[];
    expect(members.find((m) => m.user_id === me)!.roles).toEqual(["requester"]);
  });

  it("gives a new person at a former employee's DN their own account; a person whose DN moved keeps theirs", async () => {
    const first = (await w.signIn("CORP\\temp", "Passw0rd!")).c;
    const oldId = (await first.get("/auth/me")).user.id as string;
    // the employee leaves; a new hire gets the same name, so the same DN — another directory object
    const i = w.dc.entries.findIndex((e) => e.dn.startsWith("CN=Temp Person"));
    w.dc.entries[i] = person("temp", { name: "Temp Person", mail: "newhire@corp.test", password: "New-Hire-Pass-1!", extra: { whenCreated: [generalized()] } });
    const { c } = await w.signIn("CORP\\temp", "New-Hire-Pass-1!");
    const me = (await c.get("/auth/me")).user;
    expect(me.id).not.toBe(oldId);
    expect(me.email).toBe("newhire@corp.test");
    expect((await w.db.one<{ email: string }>(`select email from sm_users where id = $1`, [oldId]))!.email).toBe("temp@corp.test");

    // a link written before links remembered the object (an older version) is not taken by a newer object either
    const again = person("temp", { name: "Temp Person", mail: "third@corp.test", password: "Third-Pass-1!", extra: { whenCreated: [generalized(new Date(Date.now() + 60_000))] } });
    w.dc.entries[i] = again;
    await w.db.query(`update sm_directory_links set object_id = null where source_id = $1 and external_id = $2`, [w.source.id, again.dn]);
    const third = (await (await w.signIn("CORP\\temp", "Third-Pass-1!")).c.get("/auth/me")).user;
    expect(third.id).not.toBe(me.id);
    expect(third.email).toBe("third@corp.test");

    // the same DN and the former employee's mailbox address: still another object — refused, never the old account
    w.dc.entries[i] = person("temp", { name: "Temp Person", mail: "temp@corp.test", password: "Fourth-Pass-1!", extra: { whenCreated: [generalized()] } });
    expect((await w.client().raw("POST", "/auth/directory", { login: "CORP\\temp", password: "Fourth-Pass-1!" })).status).toBe(401);
    expect(await reasons(w, "corp\\temp")).toContain("account_conflict");

    // moved to another OU: the same object, the same account, the link follows
    const mover = (await w.signIn("CORP\\mover", "Passw0rd!")).c;
    const moverId = (await mover.get("/auth/me")).user.id as string;
    const m = w.dc.entries.find((e) => e.dn.startsWith("CN=Mover Person"))!;
    m.dn = m.dn.replace("OU=Staff", "OU=Moved");
    const moved = (await (await w.signIn("CORP\\mover", "Passw0rd!")).c.get("/auth/me")).user.id;
    expect(moved).toBe(moverId);
    const links = await w.db.query<{ external_id: string }>(`select external_id from sm_directory_links where local_id = $1 and kind = 'user' and active`, [moverId]);
    expect(links.map((l) => l.external_id)).toEqual([m.dn]);
  });

  it("counts parallel guesses before the domain is asked: never more binds than the threshold", async () => {
    const sara = w.dc.entries.find((e) => e.dn.startsWith("CN=Sara Ahmadi"))!;
    w.dc.reset();
    const tries = await Promise.all(Array.from({ length: 10 }, (_, i) => w.client().raw("POST", "/auth/directory", { login: "CORP\\sara", password: `parallel-guess-${i}` })));
    expect(tries.every((t) => t.status === 401)).toBe(true);
    expect(w.dc.binds.filter((b) => b.dn === sara.dn).length).toBeLessThanOrEqual(5);
  });

  it("counts every login name of one account together (sAMAccountName and UPN)", async () => {
    const acc = w.dc.entries.find((e) => e.dn.startsWith("CN=Ali Rezaei 2"))!;
    for (let i = 0; i < 5; i++) await w.client().raw("POST", "/auth/directory", { login: "CORP\\arezaei", password: `guess-${i}` });
    w.dc.reset();
    const r = await w.client().raw("POST", "/auth/directory", { login: "ali.rezaei@corp.test", password: "another-guess" });
    expect(r.status).toBe(401);
    expect(w.dc.binds.filter((b) => b.dn === acc.dn)).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------------------------

describe("re-authentication", () => {
  let w: AdWorld;
  beforeAll(async () => {
    w = await adWorld();
  });
  afterAll(() => w.close());

  const ageOwnerSessions = () => w.db.query(`update sm_sessions set reauth_at = now() - interval '2 hours', created_at = now() - interval '2 hours' where user_id = $1`, [w.ownerId]);
  const freshOwnerSessions = () => w.db.query(`update sm_sessions set reauth_at = now() where user_id = $1`, [w.ownerId]);

  it("asks for it on the generic record API as on the access routes (roles, role-granting groups)", async () => {
    const { c } = await w.signIn("CORP\\sara", "Passw0rd!");
    const saraId = (await c.get("/auth/me")).user.id as string;
    const profile = (await w.db.one<{ id: string }>(`select id from sm_member_profiles where org_id = $1 and user_id = $2 and deleted_at is null`, [w.org, saraId]))!.id;
    const granting = (await w.owner.post(`${w.P}/r/group`, { name: "کارشناسان", types: ["assignment"], roles: ["agent"] })).row.id as string;
    await ageOwnerSessions();
    try {
      await w.owner.req("PUT", `${w.P}/access/members/${saraId}`, { roles: ["requester", "agent"] }, 401);
      const viaRecord = await w.owner.req("PATCH", `${w.P}/r/member_profile/${profile}`, { roles: ["requester", "agent"] }, 401);
      expect(viaRecord.error.code).toBe("reauth_required");
      const join = await w.owner.req("POST", `${w.P}/r/group_member`, { group_id: granting, user_id: saraId }, 401);
      expect(join.error.code).toBe("reauth_required");
      const roles = (await w.db.one<{ roles: string[] }>(`select roles from sm_member_profiles where id = $1`, [profile]))!.roles;
      expect(roles).not.toContain("agent");
      // an ordinary field of the profile needs no new proof
      await w.owner.patch(`${w.P}/r/member_profile/${profile}`, { title: "کارشناس" });
    } finally {
      await freshOwnerSessions();
    }
    await w.owner.patch(`${w.P}/r/member_profile/${profile}`, { roles: ["requester", "agent"] });
  });

  it("asks for it in the platform console before a temporary password or platform administration", async () => {
    await w.db.query(`update sm_users set is_platform_admin = true where id = $1`, [w.ownerId]);
    const { c } = await w.signIn("CORP\\reza", "Passw0rd!");
    const reza = (await c.get("/auth/me")).user.id as string;
    await ageOwnerSessions();
    try {
      const pw = await w.owner.req("POST", `/admin/users/${reza}/password`, { reason: "پشتیبانی" }, 401);
      expect(pw.error.code).toBe("reauth_required");
      await w.owner.req("POST", `/admin/users/${reza}/platform-admin`, { granted: true }, 401);
      await w.owner.req("PATCH", `/admin/users/${reza}`, { disabled: true }, 401);
      expect((await w.db.one<{ is_platform_admin: boolean }>(`select is_platform_admin from sm_users where id = $1`, [reza]))!.is_platform_admin).toBe(false);
    } finally {
      await freshOwnerSessions();
      await w.db.query(`update sm_users set is_platform_admin = false where id = $1`, [w.ownerId]);
    }
  });
});

// ------------------------------------------------------------------------------------------------------------------

describe("sessions and the sign-in policy", () => {
  let w: AdWorld;
  beforeAll(async () => {
    w = await adWorld();
  });
  afterAll(() => w.close());

  it("ends an idle session although the screen keeps polling in the background", async () => {
    await w.owner.put(`${w.P}/auth/policy`, { session: { idle_minutes: 15 } });
    const { c } = await w.signIn("CORP\\ali", "Passw0rd!");
    const id = sessionIdOf(c.cookie);
    const seen = async () => new Date((await w.db.one<{ last_seen_at: string }>(`select last_seen_at from sm_sessions where id = $1`, [id]))!.last_seen_at).getTime();
    await w.db.query(`update sm_sessions set last_seen_at = now() - interval '5 minutes' where id = $1`, [id]);
    const before = await seen();
    expect((await c.raw("GET", "/auth/me", undefined, { "x-itsm-background": "1" })).status).toBe(200);
    expect(await seen()).toBe(before);
    // what the person does keeps it alive
    expect((await c.raw("GET", "/auth/me")).status).toBe(200);
    expect(await seen()).toBeGreaterThan(before);
    // the pulse alone never does: past the idle minutes the session ends
    await w.db.query(`update sm_sessions set last_seen_at = now() - interval '16 minutes' where id = $1`, [id]);
    expect((await c.raw("GET", `/o/${w.org}/pulse`, undefined, { "x-itsm-background": "1" })).status).toBe(401);
    await w.owner.put(`${w.P}/auth/policy`, { session: { idle_minutes: 0 } });
  });

  it("shows members the session rules only: no break-glass accounts, no lockout thresholds", async () => {
    await w.owner.put(`${w.P}/auth/policy`, { breakglass: [w.ownerId] });
    const { c } = await w.signIn("CORP\\sara", "Passw0rd!");
    const viewer = await c.get(`${w.P}/auth/policy`);
    expect(viewer.breakglass).toEqual([]);
    expect(viewer.policy.lockout).toBeUndefined();
    expect(viewer.policy.breakglass).toBeUndefined();
    expect(JSON.stringify(viewer)).not.toContain("owner@bank.test");
    expect(viewer.policy.session.reauth_minutes).toBeGreaterThan(0);
    const admin = await w.owner.get(`${w.P}/auth/policy`);
    expect(admin.breakglass.map((p: { email: string }) => p.email)).toEqual(["owner@bank.test"]);
    expect(admin.policy.lockout.threshold).toBe(5);
  });
});

// ------------------------------------------------------------------------------------------------------------------

describe("Windows sign-in", () => {
  let w: AdWorld;
  beforeAll(async () => {
    w = await adWorld({ source: { sso_mode: "negotiate", sso_host: "kariz.corp.test", sso_account: "CORP\\svc-kariz" } });
  });
  afterAll(() => w.close());

  it("never takes a principal of an unlisted domain for the same-named account here", async () => {
    setNegotiateValidator(fakeValidator);
    // a source cannot be saved for Windows sign-in without its domains
    const cur = await w.owner.get(`${w.P}/r/directory_source/${w.source.id}`);
    await w.owner.req("PATCH", `${w.P}/r/directory_source/${w.source.id}`, { login_domains: [], version: cur.row.version }, 400);
    // one saved before that rule: still no sign-in for BRANCH\sara as CORP\sara
    await w.db.query(`update sm_directory_sources set login_domains = '[]'::jsonb where id = $1`, [w.source.id]);
    try {
      const r = await w.client().raw("GET", "/auth/sso", undefined, { authorization: `Negotiate ${kerberos("BRANCH\\sara")}` });
      expect(r.status).toBe(400);
      expect(await reasons(w, "branch\\sara")).toContain("unknown_domain");
    } finally {
      await w.db.query(`update sm_directory_sources set login_domains = '["CORP","corp.test"]'::jsonb where id = $1`, [w.source.id]);
    }
    expect((await w.client().raw("GET", "/auth/sso", undefined, { authorization: `Negotiate ${kerberos("BRANCH\\sara")}` })).status).toBe(400);
    expect((await w.client().raw("GET", "/auth/sso", undefined, { authorization: `Negotiate ${kerberos("CORP\\sara")}` })).status).toBe(200);
  });

  it("refuses NTLM for a source that refuses it, although another source allows it", async () => {
    setNegotiateValidator(fakeValidator);
    const other = (
      await w.owner.post(`${w.P}/r/directory_source`, {
        name: "دامنهٔ قدیمی",
        kind: "ldap",
        mode: "apply",
        ldap_url: w.dc.url,
        tls_mode: "ldaps",
        ca_cert: w.pki.ca.pem,
        bind_dn: SVC.dn,
        bind_password: SVC.password,
        base_dn: BASE,
        login_enabled: true,
        login_domains: ["OTHER", "other.test"],
        sso_mode: "negotiate",
        ntlm: true,
      })
    ).row;
    await w.owner.post(`${w.P}/integration/directory/${other.id}/approve`);
    const c = w.client();
    expect((await c.raw("GET", "/auth/sso", undefined, { authorization: `Negotiate ${ntlmLeg(1)}` })).status).toBe(401);
    const done = await c.raw("GET", "/auth/sso", undefined, { authorization: `Negotiate ${ntlmLeg(3)}` });
    expect(done.status).toBe(401);
    expect(await reasons(w, "corp\\sara")).toContain("ntlm_refused");
    await w.owner.del(`${w.P}/r/directory_source/${other.id}`);
  });
});
