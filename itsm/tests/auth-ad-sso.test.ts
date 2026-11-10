// Windows single sign-on: Negotiate on the server through an injected validator (real Kerberos is not available in
// tests) — the 401 challenge, a Kerberos token mapped to the member (just-in-time like a password sign-in), mutual
// authentication, NTLM refused unless allowed, the validator missing; and the trusted-proxy mode (IIS Windows
// Authentication): the user header believed only from the listed proxy address with the shared secret — spoofed
// headers from any other address (X-Forwarded-For included) are refused, recorded and reported to administrators.
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setNegotiateValidator, type NegotiateValidator } from "@server/auth/sso";
import { adWorld, nextIp, type AdWorld } from "./auth-ad-helpers";

const kerberos = (principal: string) => Buffer.from(`\x60\x82krb5-ap-req:${principal}`, "latin1").toString("base64");
const ntlm = Buffer.concat([Buffer.from("NTLMSSP\u0000", "latin1"), Buffer.from([1, 0, 0, 0])]).toString("base64");

/** Accepts «krb5-ap-req:<principal>» tokens; NTLM takes two legs on one connection. */
const fakeValidator: NegotiateValidator = {
  name: "test",
  async accept(token) {
    const text = token.toString("latin1");
    if (text.startsWith("NTLMSSP")) return text.charCodeAt(8) === 1 ? { done: false, response: Buffer.from("NTLMSSP\u0000\u0002challenge", "latin1") } : { done: true, principal: "CORP\\sara", response: null };
    const m = /krb5-ap-req:(.+)$/.exec(text);
    if (!m) throw new Error("SEC_E_INVALID_TOKEN");
    return { done: true, principal: m[1], response: Buffer.from("krb5-ap-rep") };
  },
};

let w: AdWorld;
beforeAll(async () => {
  w = await adWorld({ source: { sso_mode: "negotiate", sso_host: "kariz.corp.test", sso_account: "CORP\\svc-kariz" } });
});
afterAll(() => w.close());
afterEach(() => setNegotiateValidator(fakeValidator));

describe("Negotiate (Kerberos) on the server", () => {
  it("challenges, accepts a Kerberos ticket, maps the principal to a member and opens the normal session", async () => {
    setNegotiateValidator(fakeValidator);
    const c = w.client();
    const first = await c.raw("GET", "/auth/sso");
    expect(first.status).toBe(401);
    expect(first.headers.get("www-authenticate")).toBe("Negotiate");
    const ok = await c.raw("GET", "/auth/sso", undefined, { authorization: `Negotiate ${kerberos("CORP\\ali")}` });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("www-authenticate")).toBe(`Negotiate ${Buffer.from("krb5-ap-rep").toString("base64")}`);
    const me = await c.get("/auth/me");
    expect(me.user.email).toBe("ali@corp.test");
    expect(me.session).toMatchObject({ method: "sso", org_id: w.org });
    // the same mappings as a password sign-in
    const members = (await w.owner.get(`${w.P}/access/members`)).members as { email: string; roles: string[] }[];
    expect(members.find((m) => m.email === "ali@corp.test")!.roles.sort()).toEqual(["agent", "requester"]);
    const ev = (await w.owner.get(`${w.P}/auth/signins?method=sso&ok=true`)).events;
    expect(ev[0].data).toMatchObject({ method: "sso", source: w.source.id });
  });

  it("redirects a top-level navigation to a path of this site only", async () => {
    const c = w.client();
    const r = await c.raw("GET", `/auth/sso?redirect=1&next=${encodeURIComponent("/o/x/incidents")}`, undefined, { authorization: `Negotiate ${kerberos("CORP\\sara")}` });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/o/x/incidents");
    const evil = await w.client().raw("GET", `/auth/sso?redirect=1&next=${encodeURIComponent("//evil.example/x")}`, undefined, { authorization: `Negotiate ${kerberos("CORP\\sara")}` });
    expect(evil.headers.get("location")).toBe("/");
  });

  it("refuses NTLM unless the source allows it, then takes its two legs", async () => {
    const r = await w.client().raw("GET", "/auth/sso", undefined, { authorization: `Negotiate ${ntlm}` });
    expect(r.status).toBe(401);
    const ev = (await w.owner.get(`${w.P}/auth/signins?method=sso&ok=false`)).events;
    expect(ev[0].data.reason).toBe("ntlm_refused");
    await w.owner.patch(`${w.P}/r/directory_source/${w.source.id}`, { ntlm: true });
    const c = w.client();
    const leg1 = await c.raw("GET", "/auth/sso", undefined, { authorization: `Negotiate ${ntlm}` });
    expect(leg1.status).toBe(401);
    expect(leg1.headers.get("www-authenticate")).toMatch(/^Negotiate \S+/);
    const leg3 = Buffer.concat([Buffer.from("NTLMSSP\u0000", "latin1"), Buffer.from([3, 0, 0, 0])]).toString("base64");
    const done = await c.raw("GET", "/auth/sso", undefined, { authorization: `Negotiate ${leg3}` });
    expect(done.status).toBe(200);
    await w.owner.patch(`${w.P}/r/directory_source/${w.source.id}`, { ntlm: false });
  });

  it("refuses a disabled domain account even with a valid ticket, and ends its sessions", async () => {
    const c = w.client();
    await c.raw("GET", "/auth/sso", undefined, { authorization: `Negotiate ${kerberos("CORP\\reza")}` });
    await c.get("/auth/me");
    const reza = w.dc.entries.find((e) => e.dn.startsWith("CN=Reza"))!;
    reza.attrs.userAccountControl = ["514"];
    const r = await w.client().raw("GET", "/auth/sso", undefined, { authorization: `Negotiate ${kerberos("CORP\\reza")}` });
    expect(r.status).toBe(401);
    expect(r.json.error.message).toMatch(/غیرفعال است/);
    await c.get("/auth/me", 401);
    reza.attrs.userAccountControl = ["512"];
  });

  it("an unknown principal or a bad token is refused without telling anything", async () => {
    const r = await w.client().raw("GET", "/auth/sso", undefined, { authorization: `Negotiate ${kerberos("CORP\\ghost")}` });
    expect(r.status).toBe(401);
    expect(r.json.error.message).toMatch(/ورود خودکار ویندوز انجام نشد/);
    const bad = await w.client().raw("GET", "/auth/sso", undefined, { authorization: `Negotiate ${Buffer.from("garbage").toString("base64")}` });
    expect(bad.status).toBe(401);
  });

  it("is offered on the sign-in page only where this server can speak Kerberos", async () => {
    setNegotiateValidator(fakeValidator);
    expect((await w.client().get("/auth/options")).sso).toMatchObject({ source_id: w.source.id, mode: "negotiate" });
    setNegotiateValidator(null);
    expect((await w.client().get("/auth/options")).sso).toBeNull();
    const r = await w.client().raw("GET", "/auth/sso");
    expect(r.status).toBe(503);
  });

  it("re-authenticates the session through Windows (the same person only)", async () => {
    setNegotiateValidator(fakeValidator);
    const c = w.client();
    await c.raw("GET", "/auth/sso", undefined, { authorization: `Negotiate ${kerberos("CORP\\ali")}` });
    const before = (await w.db.one<{ reauth_at: string }>(`select reauth_at from sm_sessions where id = $1`, [c.cookie.split("=")[1].split(".")[0]]))!.reauth_at;
    await new Promise((r) => setTimeout(r, 20));
    // only from the app itself (a cross-site navigation cannot add the header)
    expect((await c.raw("GET", "/auth/sso?reauth=1", undefined, { authorization: `Negotiate ${kerberos("CORP\\ali")}` })).status).toBe(400);
    expect((await c.raw("GET", "/auth/sso?reauth=1", undefined, { authorization: `Negotiate ${kerberos("CORP\\ali")}`, "x-itsm-reauth": "1" })).status).toBe(200);
    const after = (await w.db.one<{ reauth_at: string }>(`select reauth_at from sm_sessions where id = $1`, [c.cookie.split("=")[1].split(".")[0]]))!.reauth_at;
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
    expect((await c.raw("GET", "/auth/sso?reauth=1", undefined, { authorization: `Negotiate ${kerberos("CORP\\sara")}`, "x-itsm-reauth": "1" })).status).toBe(401);
  });
});

describe("a trusted proxy (IIS Windows Authentication)", () => {
  let proxied: AdWorld;
  beforeAll(async () => {
    proxied = await adWorld({ source: { sso_mode: "proxy", proxy_ips: "10.0.0.5\n10.1.0.0/24", proxy_secret: "proxy-shared-secret-1", proxy_header: "X-Remote-User" } });
  });
  afterAll(() => proxied.close());

  const viaProxy = (peer: string | null, headers: Record<string, string>) => {
    const c = proxied.client();
    c.peer = peer;
    return { c, r: c.raw("GET", "/auth/sso", undefined, headers) };
  };

  it("accepts the user header from a listed proxy with the shared secret", async () => {
    const { c, r } = viaProxy("10.0.0.5", { "x-remote-user": "CORP\\ali", "x-itsm-proxy-secret": "proxy-shared-secret-1" });
    expect((await r).status).toBe(200);
    const me = await c.get("/auth/me");
    expect(me.user.email).toBe("ali@corp.test");
    expect(me.session.method).toBe("proxy");
    const net = viaProxy("10.1.0.77", { "x-remote-user": "ali@corp.test", "x-itsm-proxy-secret": "proxy-shared-secret-1" });
    expect((await net.r).status).toBe(200);
  });

  it("refuses the header from any other address — X-Forwarded-For does not help — and tells the administrators", async () => {
    const jobs = async () => Number((await proxied.db.one<{ n: number }>(`select count(*)::int as n from sm_jobs where org_id = $1`, [proxied.org]))!.n);
    const before = await jobs();
    const spoof = viaProxy("203.0.113.7", { "x-remote-user": "CORP\\ali", "x-itsm-proxy-secret": "proxy-shared-secret-1", "x-forwarded-for": "10.0.0.5" });
    const r = await spoof.r;
    expect(r.status).toBe(401);
    await spoof.c.get("/auth/me", 401);
    // a serverless platform hides the TCP peer: never trusted
    const hidden = viaProxy(null, { "x-remote-user": "CORP\\ali", "x-itsm-proxy-secret": "proxy-shared-secret-1", "x-forwarded-for": "10.0.0.5" });
    expect((await hidden.r).status).toBe(401);
    const ev = (await proxied.owner.get(`${proxied.P}/auth/signins?method=proxy&ok=false`)).events;
    expect(ev[0].data.reason).toBe("proxy_untrusted");
    expect(ev[0].email).toBe("corp\\ali");
    expect(await jobs()).toBeGreaterThan(before);
  });

  it("refuses a listed proxy without the right shared secret", async () => {
    expect((await viaProxy("10.0.0.5", { "x-remote-user": "CORP\\ali", "x-itsm-proxy-secret": "wrong" }).r).status).toBe(401);
    expect((await viaProxy("10.0.0.5", { "x-remote-user": "CORP\\ali" }).r).status).toBe(401);
    const ev = (await proxied.owner.get(`${proxied.P}/auth/signins?method=proxy&ok=false`)).events;
    expect(ev[0].data.reason).toBe("proxy_secret");
  });

  it("the proxy's name must belong to the source's domains", async () => {
    expect((await viaProxy("10.0.0.5", { "x-remote-user": "EVIL\\ali", "x-itsm-proxy-secret": "proxy-shared-secret-1" }).r).status).toBe(400);
  });

  it("is offered on the sign-in page with automatic sign-in when chosen", async () => {
    await proxied.owner.patch(`${proxied.P}/r/directory_source/${proxied.source.id}`, { sso_auto: true });
    const c = proxied.client(nextIp());
    expect((await c.get("/auth/options")).sso).toMatchObject({ mode: "proxy", auto: true });
  });

  it("shows the SSO checklist with the SPN commands for the host and account", async () => {
    const list = await w.owner.get(`${w.P}/integration/directory/${w.source.id}/sso`);
    expect(list.spn).toEqual(["setspn -Q HTTP/kariz.corp.test", "setspn -S HTTP/kariz.corp.test CORP\\svc-kariz", "setspn -S HTTP/kariz CORP\\svc-kariz"]);
    expect(list.checks.find((x: { key: string }) => x.key === "login").ok).toBe(true);
    const p = await proxied.owner.get(`${proxied.P}/integration/directory/${proxied.source.id}/sso`);
    expect(p.proxy).toMatchObject({ ips: ["10.0.0.5", "10.1.0.0/24"], secret: true, secret_header: "X-ITSM-Proxy-Secret" });
    expect(JSON.stringify(p)).not.toContain("proxy-shared-secret-1");
  });
});
