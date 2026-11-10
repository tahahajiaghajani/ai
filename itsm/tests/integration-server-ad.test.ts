// The server edition (S1) and Active Directory sign-in (S2) together: the server edition's HTTP front in front of S2's
// sign-in (one trusted-proxy list, the real TCP peer through @hono/node-server, the 401 Negotiate challenge and the
// security headers), the first-run setup's break-glass administrator and its gate, the platform console's
// re-authentication, the air-gap allowlist around every domain-controller connection, sign-in health, and the
// cross-module rules that came with the merge (SCIM under the approved mappings, the access service's rebuilt context,
// CMDB URL sources on every runtime).
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { request as httpRequest } from "node:http";
import net from "node:net";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { Hono } from "hono";
import { createFront, cspFor } from "../src/server-edition/front";
import { createStaticSite } from "../src/server-edition/static";
import { WorkerMetrics } from "../src/server-edition/metrics";
import { authConfig, nodeHandler } from "../src/server-edition/worker";
import { changeAllowlist, defaultConfig, ensureSecrets, loadServerConfig, saveServerConfig, envOverrides, type ServerEditionConfig } from "../src/server-edition/config";
import { createUsersProbe, issueSetupToken, setupRoutes } from "../src/server-edition/setup";
import { DIRECTORY_SETTINGS_PATH, SECURITY_SETTINGS_PATH } from "../src/server-edition/names";
import { setNegotiateValidator, type NegotiateValidator } from "@server/auth/sso";
import { localLoginAllowed, needRecentAuth } from "@server/auth/policy";
import { normalizePolicy, policyProblems } from "@shared/auth/policy";
import { createPgliteDb } from "@server/db/pglite";
import { migrate } from "@server/db/migrate";
import { createApp } from "@server/app";
import { networkFetch, type NetworkPolicy } from "@server/net";
import { systemCtx } from "@server/engine";
import { memberCtx, refreshed } from "@server/access/service";
import { runUrlSource } from "@server/modules/cmdb/jobs";
import { aiNet } from "@server/modules/ai/net";
import { signInHealth } from "@server/modules/platform/signin-health";
import type { ServerConfig, ServerEditionBridge } from "@server/context";
import { backendExecArgv, supportsSystemCa } from "@shared/desktop/node-flags";
import { adWorld, type AdWorld } from "./auth-ad-helpers";
import { Client, quietLog, signupWithOrg } from "./helpers";

const temp = () => mkdtempSync(join(tmpdir(), "itsm-srv-ad-"));
const log = { ...quietLog, debug() {} };

/** The server edition's front over an API, served by Node like the worker does (nodeHandler). */
async function serveFront(api: { fetch(req: Request, env?: unknown): Response | Promise<Response> }, config: () => ServerEditionConfig, opts: { setupRequired?: () => Promise<boolean>; setup?: Hono } = {}) {
  const front = createFront({
    api,
    config,
    site: createStaticSite(temp(), () => "<!doctype html>"),
    metrics: new WorkerMetrics(0, 5, 1500),
    log,
    ready: async () => ({ ok: true, checks: {} }),
    cluster: async () => ({ workers: [], expected_workers: 1, restarts: 0, started_at: "" }),
    queue: async () => null,
    setup: opts.setup ?? new Hono(),
    setupRequired: opts.setupRequired ?? (async () => false),
    https: true,
  });
  const handler = nodeHandler(front.fetch, () => config().trusted_proxies);
  // the test stands in for the network: «x-test-peer» is the TCP peer the socket reports (then removed)
  const server: Server = createServer((req: IncomingMessage, res) => {
    const peer = req.headers["x-test-peer"];
    delete req.headers["x-test-peer"];
    if (typeof peer === "string") Object.defineProperty(req.socket, "remoteAddress", { value: peer, configurable: true });
    handler(req, res);
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as net.AddressInfo).port;
  const call = (method: string, path: string, headers: Record<string, string> = {}, body?: unknown) =>
    new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }>((ok, fail) => {
      const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
      const r = httpRequest({ host: "127.0.0.1", port, method, path, headers: { ...(data ? { "content-type": "application/json", "content-length": String(data.length) } : {}), ...headers } }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => ok({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      r.on("error", fail);
      r.end(data);
    });
  return { call, close: () => new Promise<void>((ok) => server.close(() => ok())) };
}

const jsonOf = (b: Buffer) => JSON.parse(b.toString("utf8") || "null");

// ------------------------------------------------------------------------------------------------------------------

describe("configuration: kariz.json and ITSM_* → cfg.auth, one trusted-proxy list", () => {
  it("maps auth settings and the trusted proxies, with the environment over the file", () => {
    const dir = temp();
    const file = join(dir, "kariz.json");
    const c = defaultConfig(dir);
    expect(c.auth).toEqual({ directory_lan: true, cookie_secure: "always", cookie_samesite: "Lax" });
    expect(c.trusted_proxies).toEqual([]);
    c.trusted_proxies = ["10.9.0.5"];
    saveServerConfig(file, c);
    const env = { ITSM_TRUSTED_PROXIES: "10.9.0.5, 10.9.1.0/24", ITSM_COOKIE_SECURE: "auto", ITSM_COOKIE_SAMESITE: "Strict", ITSM_DIRECTORY_LAN: "false" };
    const loaded = loadServerConfig(file, env).config;
    expect(loaded.trusted_proxies).toEqual(["10.9.0.5", "10.9.1.0/24"]);
    expect(authConfig(loaded)).toEqual({ directoryLan: false, cookieSecure: "auto", cookieSameSite: "Strict", trustedProxies: ["10.9.0.5", "10.9.1.0/24"] });
    expect(envOverrides({ ITSM_DIRECTORY_LAN: "1" })).toMatchObject({ auth: { directory_lan: "1" } });
    // host names are no proxies (a proxy is judged by its TCP peer); the old boolean is replaced with a warning
    const w = loadServerConfig(file, { ITSM_TRUSTED_PROXIES: "iis.bank.local" });
    expect(w.config.trusted_proxies).toEqual([]);
    expect(w.warnings.join(" ")).toContain("iis.bank.local");
    const legacy = defaultConfig(dir) as unknown as Record<string, unknown>;
    legacy.trust_proxy = true;
    saveServerConfig(file, legacy as unknown as ServerEditionConfig);
    expect(loadServerConfig(file, {}).warnings.join(" ")).toContain("trusted_proxies");
  });
});

describe("the front and S2's sign-in: trusted-proxy SSO, the client address, Negotiate", () => {
  let w: AdWorld;
  let neg: AdWorld;
  let srv: ServerEditionConfig;
  let front: Awaited<ReturnType<typeof serveFront>>;
  let negFront: Awaited<ReturnType<typeof serveFront>>;
  const headers = { "x-remote-user": "CORP\\ali", "x-itsm-proxy-secret": "proxy-shared-secret-1" };

  beforeAll(async () => {
    srv = defaultConfig(temp());
    srv.trusted_proxies = ["10.9.0.5"];
    // the API holds the same list (cfg.auth.trustedProxies): one list for the front and for sign-in
    w = await adWorld({ source: { sso_mode: "proxy", proxy_ips: "10.9.0.5\n10.9.0.77", proxy_secret: "proxy-shared-secret-1", proxy_header: "X-Remote-User" }, config: { auth: authConfig(srv) } });
    front = await serveFront(w.app, () => srv);
    neg = await adWorld({ source: { sso_mode: "negotiate", sso_host: "kariz.bank.local", sso_account: "CORP\\svc-kariz" }, config: { auth: authConfig(srv), network: { lan: true, airGapped: true, allow: [] } } });
    negFront = await serveFront(neg.app, () => srv);
  });
  afterAll(async () => {
    await front.close();
    await negFront.close();
    await w.close();
    await neg.close();
  });
  afterEach(() => setNegotiateValidator(undefined));

  it("accepts the proxy's user header from the allowed peer through the front", async () => {
    const r = await front.call("GET", "/api/auth/sso", { ...headers, "x-test-peer": "10.9.0.5" });
    expect(r.status).toBe(200);
    const cookie = String(r.headers["set-cookie"]).split(";")[0];
    const me = jsonOf((await front.call("GET", "/api/auth/me", { cookie, "x-test-peer": "10.9.0.5" })).body);
    expect(me.user.email).toBe("ali@corp.test");
    expect(me.session.method).toBe("proxy");
  });

  it("refuses and audits the same header from another peer — even one the source lists but the installation does not", async () => {
    const other = await front.call("GET", "/api/auth/sso", { ...headers, "x-test-peer": "10.9.0.66" });
    expect(other.status).toBe(401);
    // 10.9.0.77 is on the source's list but not on kariz.json trusted_proxies
    const notInstallation = await front.call("GET", "/api/auth/sso", { ...headers, "x-test-peer": "10.9.0.77" });
    expect(notInstallation.status).toBe(401);
    const ev = (await w.owner.get(`${w.P}/auth/signins?method=proxy&ok=false`)).events as { ip: string; data: { reason: string } }[];
    expect(ev.slice(0, 2).map((e) => e.data.reason)).toEqual(["proxy_untrusted", "proxy_untrusted"]);
    expect(ev.slice(0, 2).map((e) => e.ip).sort()).toEqual(["10.9.0.66", "10.9.0.77"]);
  });

  it("never trusts a client's X-Forwarded-For: neither for SSO nor for the address in the audit", async () => {
    const spoof = await front.call("GET", "/api/auth/sso", { ...headers, "x-forwarded-for": "10.9.0.5", "x-real-ip": "10.9.0.5", forwarded: "for=10.9.0.5", "x-test-peer": "203.0.113.9" });
    expect(spoof.status).toBe(401);
    const ev = (await w.owner.get(`${w.P}/auth/signins?method=proxy&ok=false`)).events as { ip: string }[];
    expect(ev[0].ip).toBe("203.0.113.9");
    // a password sign-in from the same client is recorded (and rate-limited) under its own address
    await front.call("POST", "/api/auth/directory", { "x-forwarded-for": "198.51.100.1", "x-test-peer": "203.0.113.9" }, { login: "CORP\\ali", password: "wrong-password" });
    const failed = (await w.owner.get(`${w.P}/auth/signins?ok=false`)).events as { ip: string; data: { method: string } }[];
    expect(failed.find((e) => e.data.method === "ldap")?.ip).toBe("203.0.113.9");
    // the installation's proxy may pass the client's address on
    await front.call("POST", "/api/auth/directory", { "x-forwarded-for": "10.20.30.40", "x-test-peer": "10.9.0.5" }, { login: "CORP\\ali", password: "wrong-password" });
    const viaProxy = (await w.owner.get(`${w.P}/auth/signins?ok=false`)).events as { ip: string; data: { method: string } }[];
    expect(viaProxy.find((e) => e.data.method === "ldap")?.ip).toBe("10.20.30.40");
  });

  it("passes the 401 Negotiate challenge through the front and its compression unchanged, with the security headers", async () => {
    setNegotiateValidator({ name: "test", accept: async () => ({ done: true, principal: "CORP\\ali", response: null }) });
    const r = await negFront.call("GET", "/api/auth/sso?redirect=1&next=%2F", { "accept-encoding": "gzip, br", "x-test-peer": "10.9.0.20" });
    expect(r.status).toBe(401);
    expect(r.headers["www-authenticate"]).toBe("Negotiate");
    expect(r.headers.location).toBeUndefined();
    const enc = r.headers["content-encoding"];
    const body = enc === "gzip" ? gunzipSync(r.body) : enc === "br" ? brotliDecompressSync(r.body) : r.body;
    expect(jsonOf(body).error).toBeTruthy();
    // the security headers of the front; the CSP names no external origin and no inline script
    const csp = String(r.headers["content-security-policy"]);
    expect(csp).toBe(cspFor([]));
    expect(csp).not.toMatch(/https?:|unsafe-eval|'unsafe-inline'[^;]*script|script-src[^;]*unsafe-inline/);
    expect(r.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(r.headers["cache-control"]).toBe("private, no-store");
  });

  it("Negotiate (SSPI) needs no outbound connection: no socket opens while the ticket is checked, air-gapped with an empty allowlist", async () => {
    let during = -1;
    const opened: { host?: string; port?: number }[] = [];
    const validator: NegotiateValidator = {
      name: "test",
      accept: async () => {
        during = opened.length;
        await new Promise((r) => setTimeout(r, 20));
        during = opened.length - during;
        return { done: true, principal: "CORP\\ali", response: Buffer.from("krb5-ap-rep") };
      },
    };
    setNegotiateValidator(validator);
    const original = net.Socket.prototype.connect;
    net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
      const o = (Array.isArray(args[0]) ? args[0][0] : args[0]) as { host?: string; port?: number };
      opened.push({ host: o?.host, port: Number(o?.port) });
      return (original as (...a: unknown[]) => net.Socket).apply(this, args);
    } as typeof original;
    try {
      const token = Buffer.from("\x60\x82krb5-ap-req:CORP\\ali", "latin1").toString("base64");
      const res = await neg.app.fetch(new Request("http://kariz.bank.local/api/auth/sso", { headers: { authorization: `Negotiate ${token}` } }), { incoming: { socket: { remoteAddress: "10.9.0.20" } } });
      expect(res.status).toBe(200);
    } finally {
      net.Socket.prototype.connect = original;
    }
    // the ticket itself: no connection; afterwards only the directory lookup of the principal, to the domain
    // controller (through the allowlist — loopback here)
    expect(during).toBe(0);
    expect(opened.every((o) => o.port === neg.dc.port)).toBe(true);
  });

  it("the sign-in UI adds nothing to the CSP: index.html keeps no external origin, the SSO auto-try and ReauthGate are bundled code", () => {
    const sources = ["src/ui/pages/auth/Login.tsx", "src/ui/pages/auth/Reauth.tsx", "src/ui/lib/api.ts"].map((f) => readFileSync(join(__dirname, "..", f), "utf8")).join("\n");
    expect(sources).not.toMatch(/https?:\/\/(?!localhost)[a-z0-9.-]+\.[a-z]{2,}/i);
    expect(sources).not.toMatch(/dangerouslySetInnerHTML|new Function\(|eval\(/);
    const html = readFileSync(join(__dirname, "..", "src/ui/index.html"), "utf8");
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["'](https?:)?\/\//i);
  });
});

describe("the first-run setup and the directory", () => {
  let dir: string;
  let file: string;
  let current: ServerEditionConfig;
  let db: Awaited<ReturnType<typeof createPgliteDb>>;
  let api: ReturnType<typeof createApp>;
  let fr: Awaited<ReturnType<typeof serveFront>>;
  const platformAdmins: string[] = [];

  beforeAll(async () => {
    dir = temp();
    file = join(dir, "kariz.json");
    const c0 = defaultConfig(dir);
    ensureSecrets(c0);
    c0.public_url = "https://kariz.bank.local";
    saveServerConfig(file, c0);
    current = loadServerConfig(file, {}).config;
    const network: NetworkPolicy = { lan: true, airGapped: true, allow: [...current.network.allow] };
    db = await createPgliteDb({});
    await migrate(db);
    api = createApp({ mode: "cloud", db, secret: current.secret, secretSource: "installation", allowSignup: false, platformAdmins, origin: "cloud", log: quietLog, fetch: networkFetch(network, globalThis.fetch.bind(globalThis)), network, auth: authConfig(current) });
    const reload = () => {
      current = loadServerConfig(file, {}).config;
      platformAdmins.splice(0, platformAdmins.length, ...current.platform_admins);
    };
    const hasUsers = createUsersProbe(db);
    fr = await serveFront(api, () => current, { setup: setupRoutes({ file, config: () => current, reload, restart: () => undefined, api, db, log }, hasUsers), setupRequired: async () => !(await hasUsers()) });
  });
  afterAll(async () => {
    await fr.close();
    await db.close();
  });

  it("keeps /api/auth/sso and directory sign-in closed while the setup gate is closed", async () => {
    expect((await fr.call("GET", "/api/auth/sso", { "x-test-peer": "10.0.0.9" })).status).toBe(503);
    expect((await fr.call("GET", "/api/auth/sso?redirect=1", { "x-test-peer": "10.0.0.9" })).status).toBe(503);
    expect((await fr.call("POST", "/api/auth/directory", { "x-test-peer": "10.0.0.9" }, { login: "CORP\\ali", password: "x" })).status).toBe(503);
    expect((await fr.call("GET", "/api/auth/options", { "x-test-peer": "10.0.0.9" })).status).toBe(503);
  });

  it("makes the first administrator a local break-glass account and links to the sign-in settings", async () => {
    const { token } = issueSetupToken(file);
    const done = await fr.call("POST", "/api/setup/complete", { "x-test-peer": "10.0.0.9" }, { token, org: { name: "بانک نمونه" }, admin: { full_name: "مدیر فناوری", email: "admin@bank.local", password: "Kariz-Strong-Pass-1405" }, public_url: "https://kariz.bank.local", ai: [], allow: [] });
    expect(done.status).toBe(200);
    const out = jsonOf(done.body);
    expect(out.directory_path).toBe(`/${out.org_id}${DIRECTORY_SETTINGS_PATH}`);
    expect(out.security_path).toBe(`/${out.org_id}${SECURITY_SETTINGS_PATH}`);
    expect(DIRECTORY_SETTINGS_PATH).toBe("/integrations/directory");
    expect(SECURITY_SETTINGS_PATH).toBe("/settings/security");
    const admin = (await db.one<{ id: string }>(`select id from sm_users where email = 'admin@bank.local'`))!;
    const org = (await db.one<{ settings: Record<string, unknown> }>(`select settings from sm_orgs where id = $1`, [out.org_id]))!;
    const policy = normalizePolicy(org.settings.auth);
    expect(policy.breakglass).toEqual([admin.id]);
    // closing local sign-in for the directory keeps the administrator's way in, even once they are no longer the
    // platform's administrator: the policy check finds the break-glass account it asks for
    expect(policyProblems({ ...policy, local_login: "breakglass" }, { directoryLogin: true })).toEqual([]);
    await db.query(`update sm_orgs set settings = jsonb_set(settings, '{auth,local_login}', '"breakglass"') where id = $1`, [out.org_id]);
    await db.query(`update sm_users set is_platform_admin = false where id = $1`, [admin.id]);
    platformAdmins.splice(0);
    expect(await localLoginAllowed(db, { id: admin.id, is_platform_admin: false })).toBe(true);
    const login = await fr.call("POST", "/api/auth/login", { "x-test-peer": "10.0.0.9" }, { email: "admin@bank.local", password: "Kariz-Strong-Pass-1405" });
    expect(login.status).toBe(200);
    // the gate is open now: SSO answers itself (no source yet) instead of the setup gate
    const sso = jsonOf((await fr.call("GET", "/api/auth/sso", { "x-test-peer": "10.0.0.9" })).body);
    expect(sso.error.code).not.toBe("setup_required");
  });
});

describe("re-authentication on the server edition's sensitive actions", () => {
  it("asks again before changing the air-gap allowlist and before backup files and restores", async () => {
    const dir = temp();
    const file = join(dir, "kariz.json");
    const c0 = defaultConfig(dir);
    ensureSecrets(c0);
    saveServerConfig(file, c0);
    const db = await createPgliteDb({});
    await migrate(db);
    const bridge: ServerEditionBridge = {
      health: async () => ({}),
      info: () => ({ air_gapped: true, public_url: "https://kariz.bank.local", directory_path: DIRECTORY_SETTINGS_PATH }),
      allow: async (change) => ({ allow: changeAllowlist(file, change) }),
    };
    const app = createApp({ mode: "cloud", db, secret: "test-secret", allowSignup: true, platformAdmins: [], origin: "cloud", log: quietLog, fetch: globalThis.fetch.bind(globalThis), server: bridge });
    try {
      const owner = new Client(app);
      await signupWithOrg(owner, { email: "owner@bank.local" });
      const stale = () => db.query(`update sm_sessions set reauth_at = null, created_at = now() - interval '2 hours'`);
      await stale();
      const refused = await owner.put("/admin/server/allow", { add: ["dc1.bank.local"] }, 401);
      expect(refused.error.code).toBe("reauth_required");
      expect(loadServerConfig(file, {}).config.network.allow).toEqual([]);
      expect((await owner.post(`/admin/backups/${"0".repeat(8)}-0000-7000-8000-000000000000/restore`, {}, 401)).error.code).toBe("reauth_required");
      expect((await owner.post(`/admin/backups/${"0".repeat(8)}-0000-7000-8000-000000000000/download-check`, {}, 401)).error.code).toBe("reauth_required");
      expect((await owner.get(`/admin/backups/${"0".repeat(8)}-0000-7000-8000-000000000000/download`, 401)).error.code).toBe("reauth_required");
      await owner.post("/auth/reauth", { password: "s3cret-pass" });
      expect((await owner.put("/admin/server/allow", { add: ["dc1.bank.local", "10.20.0.0/16"] })).allow).toEqual(["dc1.bank.local", "10.20.0.0/16"]);
      expect((await owner.put("/admin/server/allow", { add: ["not a host"] }, 400)).error.message).toContain("not a host");
      expect((await owner.put("/admin/server/allow", { remove: ["10.20.0.0/16"] })).allow).toEqual(["dc1.bank.local"]);
      expect(loadServerConfig(file, {}).config.network.allow).toEqual(["dc1.bank.local"]);
      // audited in the platform's log
      const audit = await db.query<{ action: string }>(`select action from sm_audit where action = 'server.allow'`);
      expect(audit.length).toBe(2);
      // the restore itself is reached once confirmed (an unknown backup)
      await owner.post(`/admin/backups/${"0".repeat(8)}-0000-7000-8000-000000000000/restore`, {}, 404);
    } finally {
      await db.close();
    }
  });

  it("the access service's rebuilt context keeps the session, so needRecentAuth applies there too", async () => {
    const w = await adWorld({});
    try {
      const session = (await w.db.one<{ id: string }>(`select id from sm_sessions where user_id = $1 order by created_at desc limit 1`, [w.ownerId]))!;
      const cfg = { mode: "cloud", db: w.db, secret: "test-secret", allowSignup: true, platformAdmins: [], origin: "cloud", log: quietLog, fetch: globalThis.fetch.bind(globalThis) } as ServerConfig;
      const ctx = await memberCtx(cfg, w.org, w.ownerId);
      const stale = { ...ctx, session: { id: session.id, user_id: w.ownerId, kind: "web", expires_at: new Date(Date.now() + 3600_000).toISOString(), auth_method: "password", org_id: null, source_id: null, reauth_at: new Date(Date.now() - 3 * 3600_000).toISOString(), created_at: new Date(Date.now() - 3 * 3600_000).toISOString() } } as typeof ctx;
      const fresh = await refreshed(stale);
      expect(fresh.session?.id).toBe(session.id);
      expect(() => needRecentAuth(fresh)).toThrow(/دوباره هویت/);
      // a member who just confirmed passes on the rebuilt context as well
      const ok = await refreshed({ ...stale, session: { ...stale.session!, reauth_at: new Date().toISOString() } } as typeof ctx);
      expect(() => needRecentAuth(ok)).not.toThrow();
    } finally {
      await w.close();
    }
  });
});

describe("air gap and the domain controllers", () => {
  let w: AdWorld;
  const network: NetworkPolicy = { lan: true, airGapped: true, allow: [] };
  beforeAll(async () => {
    w = await adWorld({ config: { network } });
  });
  afterAll(() => w.close());

  it("names a domain controller off the allowlist, says how to allow it, and never adds it by itself", async () => {
    const cur = await w.owner.get(`${w.P}/r/directory_source/${w.source.id}`);
    await w.owner.patch(`${w.P}/r/directory_source/${w.source.id}`, { ldap_url: "ldaps://dc1.bank.test:636", version: cur.row.version });
    const test = await w.owner.post(`${w.P}/integration/directory/${w.source.id}/test`);
    expect(test.ok).toBe(false);
    expect(test.message).toContain("dc1.bank.test");
    expect(test.message).toContain("karizctl allow add dc1.bank.test");
    expect(test.message).toContain("سلامت سرور");
    expect(network.allow).toEqual([]);
    // sign-in reaches no domain controller either (the same guard), and the source's sync preview says why
    const before = w.dc.connections;
    const signIn = await w.client().raw("POST", "/auth/directory", { login: "CORP\\ali", password: "Passw0rd!" });
    expect(signIn.status).toBeGreaterThanOrEqual(400);
    expect(w.dc.connections).toBe(before);
    const ev = (await w.owner.get(`${w.P}/auth/signins?ok=false`)).events as { data: { reason: string; detail?: string } }[];
    expect(ev[0].data.detail ?? "").toContain("dc1.bank.test");
    // an allowed host passes the guard (the connection then fails on the name, not on the air gap)
    network.allow.push("dc1.bank.test");
    const allowed = await w.owner.post(`${w.P}/integration/directory/${w.source.id}/test`);
    expect(allowed.ok).toBe(false);
    expect(allowed.message).not.toContain("karizctl");
    // «سلامت سرور»: the latest test of each source, counts of failed sign-ins (no names or addresses)
    const h = await signInHealth(w.db);
    expect(h.failed_1h).toBeGreaterThan(0);
    expect(h.sources[0]).toMatchObject({ source: "اکتیو دایرکتوری بانک", ok: false });
    expect(JSON.stringify(h)).not.toContain("ali");
  });
});

describe("SCIM grants roles only under the approved mappings", () => {
  it("withholds mapped roles after the mappings change and after another administrator's edit, until approved again", async () => {
    const w = await adWorld({});
    try {
      const team = w.team;
      const cur = await w.owner.get(`${w.P}/r/directory_source/${w.source.id}`);
      const scimSrc = (await w.owner.post(`${w.P}/r/directory_source`, { name: "Entra ID", kind: "scim", mode: "preview", auto_roles: true, group_map: [{ source: "Agents", group_id: team, role: "agent" }] })).row;
      expect(cur.row.id).toBeTruthy();
      const token = (await w.owner.post(`${w.P}/integration/secret`, { table: "directory_source", id: scimSrc.id })).secret as string;
      await w.owner.post(`${w.P}/integration/directory/${scimSrc.id}/approve`);
      const now = await w.owner.get(`${w.P}/r/directory_source/${scimSrc.id}`);
      await w.owner.patch(`${w.P}/r/directory_source/${scimSrc.id}`, { mode: "apply", version: now.row.version });
      const scim = async (method: string, path: string, body?: unknown) => {
        const r = await w.app.fetch(new Request(`http://local.test/api/v1/scim/${scimSrc.id}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/scim+json" }, body: body === undefined ? undefined : JSON.stringify(body) }));
        const text = await r.text();
        return { status: r.status, json: text ? JSON.parse(text) : null };
      };
      const roles = async (email: string) => (((await w.owner.get(`${w.P}/access/members`)).members as { email: string; roles: string[] }[]).find((m) => m.email === email)?.roles ?? []).sort();
      const person = (name: string) => ({ schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"], userName: `${name}@bank.test`, externalId: `aad-${name}`, displayName: name, emails: [{ value: `${name}@bank.test`, primary: true }], active: true });
      const group = (await scim("POST", "/Groups", { schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"], displayName: "Agents" })).json;
      const add = (id: string) => scim("PATCH", `/Groups/${group.id}`, { schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: [{ op: "add", path: "members", value: [{ value: id }] }] });

      // approved as they are: the role is granted
      const a = (await scim("POST", "/Users", person("arash"))).json;
      expect((await add(a.id)).status).toBe(204);
      expect(await roles("arash@bank.test")).toEqual(["agent", "requester"]);

      // the approver changes the mappings (approved_by stays, the fingerprint does not match): no role until approved
      const v = await w.owner.get(`${w.P}/r/directory_source/${scimSrc.id}`);
      await w.owner.patch(`${w.P}/r/directory_source/${scimSrc.id}`, { group_map: [{ source: "Agents", group_id: team, role: "agent" }, { source: "Others", group_id: null, role: "agent" }], version: v.row.version });
      const b = (await scim("POST", "/Users", person("bahar"))).json;
      expect((await add(b.id)).status).toBe(204);
      expect(await roles("bahar@bank.test")).toEqual(["requester"]);
      await w.owner.post(`${w.P}/integration/directory/${scimSrc.id}/approve`);
      expect((await add(b.id)).status).toBe(204);
      expect(await roles("bahar@bank.test")).toEqual(["agent", "requester"]);

      // another administrator's edit withdraws the approval (and its fingerprint): SCIM falls back to the dry run
      await w.owner.post(`${w.P}/members`, { email: "second-admin@bank.test", full_name: "مدیر دوم", role: "admin", password: "member-pass-1" });
      const other = new Client(w.app);
      await other.post("/auth/login", { email: "second-admin@bank.test", password: "member-pass-1" });
      const v2 = await other.get(`${w.P}/r/directory_source/${scimSrc.id}`);
      await other.patch(`${w.P}/r/directory_source/${scimSrc.id}`, { group_map: [{ source: "Agents", group_id: team, role: "agent" }], version: v2.row.version });
      const after = await w.owner.get(`${w.P}/r/directory_source/${scimSrc.id}`);
      expect(after.row).toMatchObject({ approved_by: null, mode: "preview" });
      const c = (await scim("POST", "/Users", person("cyrus"))).json;
      expect(c.meta?.note).toBe("dry-run");
      expect(await roles("cyrus@bank.test")).toEqual([]);
    } finally {
      await w.close();
    }
  });
});

describe("CMDB URL sources on the web, the Windows app and the server edition", () => {
  const items = JSON.stringify([{ name: "srv-app-01", class: "server" }]);
  let runs = 0;
  const lookup = aiNet.lookup;
  afterEach(() => {
    aiNet.lookup = lookup;
  });

  async function run(mode: "cloud" | "desktop", url: string, extra: Partial<ServerConfig> = {}) {
    const calls: string[] = [];
    const stub = (async (input: RequestInfo | URL) => {
      calls.push(String(input instanceof Request ? input.url : input));
      return new Response(items, { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const db = await createPgliteDb({ desktop: mode === "desktop" });
    await migrate(db);
    const fetchFn = extra.network ? networkFetch(extra.network, stub) : stub;
    const cfg: ServerConfig = { mode, db, secret: "test-secret", allowSignup: true, platformAdmins: [], origin: mode === "desktop" ? "00000000-0000-7000-8000-000000000001" : "cloud", log: quietLog, fetch: fetchFn, ...extra } as ServerConfig;
    const app = createApp(cfg);
    try {
      const ip = `192.0.2.${++runs}`;
      const owner = new Client({ fetch: (r: Request) => (r.headers.set("x-forwarded-for", ip), app.fetch(r)) });
      const org = await signupWithOrg(owner, { email: "cmdb@bank.test" });
      const src = (await owner.post(`/o/${org}/r/cmdb_data_source`, { name: "فهرست سرورها", kind: "url", url, format: "json", default_class: "server" })).row;
      const out = await runUrlSource(await systemCtx(cfg, org), src.id);
      return { out, calls };
    } finally {
      await db.close();
    }
  }

  it("the web version reads public https URLs only, checked on the resolved addresses (SSRF-safe)", async () => {
    aiNet.lookup = async (h: string) => (h === "inventory.example.com" ? ["93.184.216.34"] : h === "rebind.example.com" ? ["10.1.2.3"] : []);
    const ok = await run("cloud", "https://inventory.example.com/servers.json");
    expect(ok.out.error).toBeUndefined();
    expect(ok.out.rows).toBe(1);
    expect(ok.calls).toEqual(["https://inventory.example.com/servers.json"]);
    const internal = await run("cloud", "https://10.0.0.5/servers.json");
    expect(internal.out.error).toBeTruthy();
    expect(internal.calls).toEqual([]);
    const rebind = await run("cloud", "https://rebind.example.com/servers.json");
    expect(rebind.out.error).toBeTruthy();
    expect(rebind.calls).toEqual([]);
  });

  it("the Windows app reads its office network", async () => {
    const r = await run("desktop", "http://cmdb.office.local/servers.json");
    expect(r.out.rows).toBe(1);
  });

  it("the server edition reads its intranet through the air-gap allowlist only", async () => {
    const network: NetworkPolicy = { lan: true, airGapped: true, allow: ["cmdb.bank.local"] };
    const ok = await run("cloud", "http://cmdb.bank.local/servers.json", { network });
    expect(ok.out.rows).toBe(1);
    const blocked = await run("cloud", "http://other.bank.local/servers.json", { network });
    expect(blocked.out.error).toContain("other.bank.local");
    expect(blocked.calls).toEqual([]);
  });
});

describe("the Windows app trusts the bank's CA from the Windows certificate store", () => {
  it("starts the backend with --use-system-ca where Electron's Node supports it", () => {
    expect(supportsSystemCa("v24.22.1")).toBe(true); // Electron 45
    expect(supportsSystemCa("22.15.0")).toBe(true);
    expect(supportsSystemCa("23.8.0")).toBe(true);
    expect(supportsSystemCa("22.14.0")).toBe(false);
    expect(supportsSystemCa("23.7.0")).toBe(false);
    expect(backendExecArgv("v24.22.1")).toEqual(["--use-system-ca"]);
    expect(backendExecArgv("v20.18.0")).toEqual([]);
    const main = readFileSync(join(__dirname, "..", "desktop/src/main.ts"), "utf8");
    expect(main).toMatch(/utilityProcess\.fork\(entry, \[\], \{[\s\S]{0,500}execArgv: backendExecArgv\(process\.versions\.node\)/);
  });
});
