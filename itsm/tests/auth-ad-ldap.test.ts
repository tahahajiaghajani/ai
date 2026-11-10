// The LDAP client for «ورود با حساب سازمانی»: RFC 4515 escaping (no LDAP injection), an empty password never reaches
// the server, LDAPS and StartTLS checked against the organisation's root CA (untrusted, expired and wrong-name
// certificates refused with Persian reasons), failover across domain controllers, and nested groups through
// LDAP_MATCHING_RULE_IN_CHAIN — all against the in-process fake domain controller (tests/ldap-fake.ts).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { LdapClient, LdapError, adSubCode, caProblem, connectAny, encodeFilter, escapeDnValue, escapeFilterValue, readTlv, IN_CHAIN } from "@server/modules/integration/ldap";
import { BASE, SVC, deadPort, fakeLdap, filterText, group, person, serviceAccount, testPki, type FakeLdap } from "./ldap-fake";

const pki = testPki();
const ali = person("ali", { name: "Ali Rezaei" });
const people = () => [serviceAccount(), ali, person("sara"), group("Kariz-Agents-Network", [ali.dn]), group("Kariz-Agents", [`CN=Kariz-Agents-Network,OU=Groups,${BASE}`])];

describe("RFC 4515 escaping", () => {
  it("escapes every character that could change a filter", () => {
    expect(escapeFilterValue("*)(uid=*")).toBe("\\2a\\29\\28uid=\\2a");
    expect(escapeFilterValue("a\\b")).toBe("a\\5cb");
    expect(escapeFilterValue("x\u0000y")).toBe("x\\00y");
    expect(escapeFilterValue("علی")).toBe("علی");
    expect(escapeDnValue("Rezaei, Ali")).toBe("Rezaei\\, Ali");
    expect(escapeDnValue(" #lead")).toBe("\\ #lead");
  });

  it("an injection attempt stays one equality value", () => {
    for (const attempt of ["*", "admin)(|(objectClass=*)", "*)(memberOf=CN=Domain Admins*", "ali)(&(1=1", "\\2a"]) {
      const node = readTlv(encodeFilter(`(&(objectClass=user)(sAMAccountName=${escapeFilterValue(attempt)}))`))!.node;
      expect(node.tag).toBe(0xa0);
      expect(node.children).toHaveLength(2);
      const eq = node.children[1];
      expect(eq.tag).toBe(0xa3);
      expect(eq.children[1].value.toString("utf8")).toBe(attempt);
    }
  });

  it("reads Active Directory's sub-codes and checks root certificates", () => {
    expect(adSubCode("80090308: LdapErr: DSID-0C09044E, comment: AcceptSecurityContext error, data 775, v4563")).toBe("775");
    expect(adSubCode("invalid credentials")).toBeNull();
    expect(caProblem(pki.ca.pem)).toBeNull();
    expect(caProblem("hello")).toMatch(/BEGIN CERTIFICATE/);
    expect(caProblem("-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----")).toMatch(/خوانده نشد/);
  });
});

describe("binds and searches", () => {
  let dc: FakeLdap;
  beforeAll(async () => {
    dc = await fakeLdap(people());
  });
  afterAll(() => dc.close());

  it("refuses an empty password before anything is sent", async () => {
    dc.reset();
    const c = new LdapClient({ url: dc.url, bindDn: SVC.dn, password: "" });
    await expect(c.bindAs(ali.dn, "")).rejects.toMatchObject({ kind: "input" });
    await c.connect();
    await expect(c.bindAs(ali.dn, "")).rejects.toThrow(/خالی/);
    await expect(c.bind()).rejects.toThrow(/خالی/);
    c.close();
    expect(dc.binds).toHaveLength(0);
  });

  it("binds, reports AD's sub-code and resolves nested groups in chain", async () => {
    const c = new LdapClient({ url: dc.url, bindDn: SVC.dn, password: SVC.password });
    await c.connect();
    await c.bind();
    const [entry] = await c.search(BASE, `(sAMAccountName=${escapeFilterValue("ali")})`, ["displayName", "mail"]);
    expect(entry.dn).toBe(ali.dn);
    const groups = await c.search(BASE, `(&(objectClass=group)(member:${IN_CHAIN}:=${escapeFilterValue(ali.dn)}))`, ["cn"]);
    expect(groups.map((g) => g.attrs.cn[0]).sort()).toEqual(["Kariz-Agents", "Kariz-Agents-Network"]);
    const base = await c.search(ali.dn, "(objectClass=*)", ["msDS-User-Account-Control-Computed"], { scope: 0 });
    expect(base).toHaveLength(1);
    const user = new LdapClient({ url: dc.url, bindDn: ali.dn, password: "wrong" });
    await user.connect();
    const err = await user.bind().catch((e) => e);
    expect(err).toBeInstanceOf(LdapError);
    expect(err).toMatchObject({ kind: "result", code: 49, ad: "52e" });
    user.close();
    c.close();
  });

  it("an escaped value reaches the server as a literal", async () => {
    dc.reset();
    const c = new LdapClient({ url: dc.url, bindDn: SVC.dn, password: SVC.password });
    await c.connect();
    await c.bind();
    const found = await c.search(BASE, `(&(objectClass=user)(sAMAccountName=${escapeFilterValue("*)(sAMAccountName=*")}))`, ["cn"]);
    expect(found).toHaveLength(0);
    expect(dc.filters.at(-1)).toBe("(&(objectClass=user)(sAMAccountName=\\2a\\29\\28sAMAccountName=\\2a))");
    c.close();
  });
});

describe("TLS: LDAPS and StartTLS against the organisation's root CA", () => {
  const servers: FakeLdap[] = [];
  afterAll(async () => {
    for (const s of servers) await s.close();
  });
  const start = async (mode: "plain" | "ldaps", cert = pki.server, requireTls = false) => {
    const s = await fakeLdap(people(), { mode, cert, requireTls });
    servers.push(s);
    return s;
  };

  it("LDAPS with the uploaded root CA", async () => {
    const dc = await start("ldaps");
    const c = new LdapClient({ url: dc.url, bindDn: SVC.dn, password: SVC.password, ca: pki.ca.pem, requireTls: true });
    await c.connect();
    expect(c.encrypted).toBe(true);
    await c.bind();
    c.close();
  });

  it("refuses certificates the root CA did not sign, expired ones and other names", async () => {
    const good = await start("ldaps");
    const untrusted = await new LdapClient({ url: good.url, bindDn: SVC.dn, password: SVC.password }).connect().catch((e) => e);
    expect(untrusted).toMatchObject({ kind: "tls" });
    expect(untrusted.message).toMatch(/مرجع معتبری امضا نکرده/);
    const foreignCa = await new LdapClient({ url: good.url, bindDn: SVC.dn, password: SVC.password, ca: pki.foreignCa.pem }).connect().catch((e) => e);
    expect(foreignCa.message).toMatch(/مرجع معتبری امضا نکرده/);
    const expired = await start("ldaps", pki.expired);
    const e1 = await new LdapClient({ url: expired.url, bindDn: SVC.dn, password: SVC.password, ca: pki.ca.pem }).connect().catch((e) => e);
    expect(e1.message).toMatch(/منقضی/);
    const other = await start("ldaps", pki.wrongName);
    const e2 = await new LdapClient({ url: other.url, bindDn: SVC.dn, password: SVC.password, ca: pki.ca.pem }).connect().catch((e) => e);
    expect(e2.message).toMatch(/هم‌خوان نیست/);
    const plain = await start("plain");
    const e3 = await new LdapClient({ url: plain.url.replace("ldap://", "ldaps://"), bindDn: SVC.dn, password: SVC.password, ca: pki.ca.pem, timeoutMs: 3000 }).connect().catch((e) => e);
    expect(e3).toBeInstanceOf(LdapError);
  });

  it("StartTLS upgrades an ldap:// connection; plaintext is refused when TLS is required", async () => {
    const dc = await start("plain", pki.server, true);
    const c = new LdapClient({ url: dc.url, bindDn: SVC.dn, password: SVC.password, ca: pki.ca.pem, startTls: true, requireTls: true });
    await c.connect();
    expect(c.encrypted).toBe(true);
    expect(dc.starttls).toBe(1);
    await c.bind();
    expect(await c.search(BASE, "(sAMAccountName=ali)", ["cn"])).toHaveLength(1);
    c.close();
    // TLS required by the source: an ldap:// address without StartTLS never connects
    await expect(new LdapClient({ url: dc.url, bindDn: SVC.dn, password: SVC.password, requireTls: true }).connect()).rejects.toMatchObject({ kind: "input" });
    // the server itself refuses a plaintext bind (AD's «strong auth required»)
    const plain = new LdapClient({ url: dc.url, bindDn: SVC.dn, password: SVC.password });
    await plain.connect();
    await expect(plain.bind()).rejects.toMatchObject({ code: 8 });
    plain.close();
    // StartTLS with an untrusted certificate fails the handshake
    const bad = await new LdapClient({ url: dc.url, bindDn: SVC.dn, password: SVC.password, ca: pki.foreignCa.pem, startTls: true }).connect().catch((e) => e);
    expect(bad).toMatchObject({ kind: "tls" });
  });

  it("fails over to the next domain controller and lists every reason when none answers", async () => {
    const dc = await start("ldaps");
    const down = await deadPort();
    const { client, url } = await connectAny([`ldaps://127.0.0.1:${down}`, dc.url], { bindDn: SVC.dn, password: SVC.password, ca: pki.ca.pem, timeoutMs: 3000 });
    expect(url).toBe(dc.url);
    await client.bind();
    client.close();
    const down2 = await deadPort();
    const all = await connectAny([`ldap://127.0.0.1:${down}`, `ldap://127.0.0.1:${down2}`], { bindDn: SVC.dn, password: SVC.password, timeoutMs: 3000 }).catch((e) => e);
    expect(all).toMatchObject({ kind: "network" });
    expect(all.message).toMatch(/هیچ‌یک از سرورهای LDAP پاسخ نداد/);
  });

  it("decodes what the server received", () => {
    const n = readTlv(encodeFilter("(&(cn=a*b*c)(!(x=*))(member:1.2.840.113556.1.4.1941:=CN=A\\5c,DC=x))"))!.node;
    expect(filterText(n)).toBe("(&(cn=a*b*c)(!(x=*))(member:1.2.840.113556.1.4.1941:=CN=A\\5c,DC=x))");
  });
});
