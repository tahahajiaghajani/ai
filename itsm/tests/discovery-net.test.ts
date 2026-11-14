// Outbound safety of connectors (design A §14.1–§14.3, §17 «discovery-net»): the web version reaches public hosts
// only; the server edition only its allowlist, with the documented Persian message; loopback, link-local, the server's
// own addresses and the database host are refused on every edition even when allowed; credentials go only to hosts the
// allowlist names exactly; a redirect to another host is refused; plain http only with the server edition's tick;
// forbidden headers are never sent; credentials in the address are refused; the connector's own root CA is trusted
// and nothing turns verification off; a host change clears the secrets; secrets never reach run errors or item data;
// a keyed connector without its key (a restored backup) does not run. Nothing reaches the tool before every check
// passed, and demo work reaches nothing at all. The fixed-script PowerShell runner runs only on the server edition on
// Windows, never for demo work, judges the host first, keeps the script's address on that host, binds values to
// declared parameters, keeps passwords off the command line and refuses a redirect.
import os from "node:os";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { uuidv7 } from "@shared/id";
import { inDemoScope } from "@server/db/scope";
import type { NetworkPolicy } from "@server/net";
import { CONNECTOR_MESSAGES, type ConnectorView } from "@server/modules/discovery/kind";
import {
  connectorFetcher, databaseHosts, discoveryNet, namedExactly, reachProblem, resetDiscoveryNet, setDatabaseHosts, setDiscoveryTransport, type NetConfig,
} from "@server/modules/discovery/net";
import { previewConnector } from "@server/modules/discovery/runner";
import { SECRETS_CLEARED } from "@server/modules/discovery/guard";
import { psArgs, PS_MESSAGES, PS_SCRIPTS, psrunSeam, runPs } from "@server/modules/discovery/psrun";
import { workerExecArgv } from "../src/server-edition/cluster";
import { fixtureCa, TOOL_HOST } from "./fixtures/discovery-ca";
import { json, mountMocks, serve, serveTls, type Handler } from "./mocks/discovery/harness";
import { REST_CONNECTOR, RestMock, makeDevices } from "./mocks/discovery/rest";
import { discoveryWorld, type DiscoveryWorld } from "./discovery-helpers";

const view = (over: Partial<ConnectorView> = {}): ConnectorView => ({
  id: uuidv7(), name: "ابزار آزمایشی", kind: "rest", base_url: `https://${TOOL_HOST}/`, hosts: [], auth: "token", username: null, api_key_header: "X-API-Key",
  plain_http: false, collect: ["inventory"], options: {}, mapping: {}, default_class: null, rate_per_second: 100, ca_cert: null, ...over,
});

const web: NetConfig = { mode: "cloud" };
const seamLookup = discoveryNet.lookup;
function server(allow: string[], airGapped = true): { cfg: NetConfig; refused: string[] } {
  const refused: string[] = [];
  const network: NetworkPolicy = { lan: true, airGapped, allow, onRefused: (host, label) => refused.push(`${host}|${label}`) };
  return { cfg: { mode: "cloud", server: {} as never, network }, refused };
}

/** The Persian message a call ends with (or "ok" when it answered). */
async function outcome(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return (e as Error).message;
  }
}

describe("where a connector may connect (design A §14.1)", () => {
  const calls: string[] = [];
  const ok: Handler = (req) => {
    calls.push(req.url);
    return json({ ok: true });
  };
  let unmount: (() => void) | null = null;
  const mount = (addresses: Record<string, string[]>, byHost: Record<string, Handler> = {}) => {
    unmount = mountMocks(new Proxy(byHost, { get: (t, k: string) => t[k] ?? ok }) as Record<string, Handler>, { addresses });
  };
  beforeEach(() => {
    calls.length = 0;
    setDatabaseHosts(undefined, { names: [], addresses: [] });
  });
  afterEach(() => {
    unmount?.();
    unmount = null;
    setDatabaseHosts(undefined, null);
  });

  it("web version: public hosts only, judged on the addresses the name resolves to; no redirect; no plain http", async () => {
    mount({ "tool.example.com": ["203.0.113.20"], "intranet.bank.test": ["10.1.2.3"], "mixed.bank.test": ["203.0.113.21", "192.168.1.9"] });
    expect(await outcome(connectorFetcher(web, view({ base_url: "https://tool.example.com/" }), []).fetchJson("api"))).toBe("ok");
    for (const base of ["https://intranet.bank.test/", "https://mixed.bank.test/", "https://10.1.2.3/", "https://zbx.bank.local/"]) {
      expect(await outcome(connectorFetcher(web, view({ base_url: base }), []).fetchJson("api"))).toBe(CONNECTOR_MESSAGES.webPrivate);
    }
    expect(await outcome(connectorFetcher(web, view({ base_url: "http://tool.example.com/", plain_http: true }), []).fetchJson("api"))).toBe(CONNECTOR_MESSAGES.plainHttp);
    unmount!();
    mount({ "tool.example.com": ["203.0.113.20"] }, { "tool.example.com": () => new Response(null, { status: 302, headers: { location: "https://tool.example.com/next" } }) });
    expect(await outcome(connectorFetcher(web, view({ base_url: "https://tool.example.com/" }), []).fetchJson("api"))).toBe(CONNECTOR_MESSAGES.redirect);
    expect(calls).toEqual(["https://tool.example.com/api"]);
  });

  it("server edition: the allowlist with the documented message, logged; credentials only to hosts named exactly", async () => {
    const { cfg, refused } = server(["zbx.bank.local", "*.corp.bank", "10.50.0.0/16", "10.60.1.7"]);
    mount({ "zbx.bank.local": ["10.40.0.2"], "other.bank.local": ["10.40.0.3"], "app.corp.bank": ["10.41.0.9"], "inv.bank.local": ["10.50.3.4"], "idrac.bank.local": ["10.60.1.7"] });
    const keyed = (base: string) => outcome(connectorFetcher(cfg, view({ base_url: base }), [], { credentialed: true }).fetchJson("api"));
    expect(await outcome(connectorFetcher(cfg, view({ base_url: "https://other.bank.local/" }), []).fetchJson("api"))).toBe(CONNECTOR_MESSAGES.notAllowed("other.bank.local"));
    expect(CONNECTOR_MESSAGES.notAllowed("zbx.bank.local")).toBe("میزبان zbx.bank.local در فهرست مجاز سرور نیست؛ مدیر سرور باید آن را در پیکربندی سرور (network.allow) بیفزاید");
    expect(refused).toEqual(["other.bank.local|discovery:allow"]);
    // a wildcard and a range admit the host — not with credentials
    expect(await outcome(connectorFetcher(cfg, view({ base_url: "https://app.corp.bank/" }), []).fetchJson("api"))).toBe("ok");
    expect(await keyed("https://app.corp.bank/")).toBe(CONNECTOR_MESSAGES.exactName);
    expect(await outcome(connectorFetcher(cfg, view({ base_url: "https://inv.bank.local/" }), []).fetchJson("api"))).toBe("ok");
    expect(await keyed("https://inv.bank.local/")).toBe(CONNECTOR_MESSAGES.exactName);
    expect(CONNECTOR_MESSAGES.exactName).toBe("برای فرستادن کلید، نام دقیق این میزبان باید در فهرست مجاز سرور باشد");
    // named exactly: by its name, or by the single address it resolves to
    expect(await keyed("https://zbx.bank.local/")).toBe("ok");
    expect(await keyed("https://idrac.bank.local/")).toBe("ok");
    expect(await keyed("https://10.60.1.7/")).toBe("ok");
    expect(refused).toContain("app.corp.bank|discovery:exact");
    expect(calls.every((u) => !u.includes("other.bank.local"))).toBe(true);
    // the rule judged in isolation
    expect(namedExactly(["a.bank", "*.corp", "10.0.0.0/8", "10.9.9.9/32"], "a.bank")).toBe(true);
    expect(namedExactly(["a.bank", "*.corp", "10.0.0.0/8", "10.9.9.9/32"], "x.corp")).toBe(false);
    expect(namedExactly(["a.bank", "*.corp", "10.0.0.0/8", "10.9.9.9/32"], "b.bank", ["10.9.9.9"])).toBe(true);
    expect(namedExactly(["a.bank", "*.corp", "10.0.0.0/8", "10.9.9.9/32"], "b.bank", ["10.9.9.9", "10.1.1.1"])).toBe(false);
    // a server that is not air-gapped still sends keys to named hosts only
    const open = server([], false);
    expect(await outcome(connectorFetcher(open.cfg, view({ base_url: "https://zbx.bank.local/" }), []).fetchJson("api"))).toBe("ok");
    expect(await outcome(connectorFetcher(open.cfg, view({ base_url: "https://zbx.bank.local/" }), [], { credentialed: true }).fetchJson("api"))).toBe(CONNECTOR_MESSAGES.exactName);
  });

  it("loopback, link-local, the server's own addresses and the database host are refused on every edition, even when allowed", async () => {
    const own = Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === "IPv4" && !a.internal)?.address;
    const selfBefore = discoveryNet.selfAddresses;
    if (!own) discoveryNet.selfAddresses = () => ["192.0.2.55"];
    const me = own ?? "192.0.2.55";
    resetDiscoveryNet();
    try {
      const { cfg, refused } = server(["loop.bank.local", "me.bank.local", "pg.bank.local", "db2.bank.local", "127.0.0.1", me, "169.254.169.254", "kariz.bank.local"]);
      cfg.publicUrl = "https://kariz.bank.local/";
      setDatabaseHosts(undefined, { names: ["pg.bank.local"], addresses: ["10.70.0.5"] });
      mount({ "loop.bank.local": ["127.0.0.1"], "me.bank.local": [me], "pg.bank.local": ["10.70.0.5"], "db2.bank.local": ["10.70.0.5"], "kariz.bank.local": ["10.80.0.1"] });
      for (const base of ["https://127.0.0.1/", "https://localhost/", "https://169.254.169.254/", "https://[::1]/", "https://loop.bank.local/", `https://${me}/`, "https://me.bank.local/", "https://pg.bank.local/", "https://db2.bank.local/", "https://kariz.bank.local/"]) {
        expect([base, await outcome(connectorFetcher(cfg, view({ base_url: base }), []).fetchJson("api"))]).toEqual([base, CONNECTOR_MESSAGES.self]);
      }
      expect(CONNECTOR_MESSAGES.self).toBe("این نشانی به خود سرور کاریز یا پایگاه داده‌اش می‌رسد و پذیرفته نمی‌شود");
      expect(refused.some((r) => r.endsWith("|discovery:self"))).toBe(true);
      // the web version too
      setDatabaseHosts(undefined, { names: [], addresses: ["203.0.113.99"] });
      unmount!();
      mount({ "dbproxy.example.com": ["203.0.113.99"] });
      expect(await outcome(connectorFetcher(web, view({ base_url: "https://dbproxy.example.com/" }), []).fetchJson("api"))).toBe(CONNECTOR_MESSAGES.self);
      expect(calls).toEqual([]);
    } finally {
      discoveryNet.selfAddresses = selfBefore;
      resetDiscoveryNet();
    }
  });

  it("redirects: the server edition follows the same host three times at most and never another host", async () => {
    const { cfg } = server(["zbx.bank.local", "web.bank.local"]);
    let hops = 0;
    mount({ "zbx.bank.local": ["10.40.0.2"], "web.bank.local": ["10.40.0.4"] }, {
      "zbx.bank.local": (req) => {
        const u = new URL(req.url);
        if (u.pathname === "/loop") return new Response(null, { status: 302, headers: { location: "/loop" } });
        if (u.pathname === "/away") return new Response(null, { status: 301, headers: { location: "https://web.bank.local/api" } });
        if (u.pathname === "/hop" && hops++ < 2) return new Response(null, { status: 307, headers: { location: "/hop" } });
        return json({ at: u.pathname });
      },
    });
    const v = view({ base_url: "https://zbx.bank.local/", hosts: ["web.bank.local"] });
    expect((await connectorFetcher(cfg, v, []).fetchJson<{ at: string }>("hop")).body).toEqual({ at: "/hop" });
    expect(await outcome(connectorFetcher(cfg, v, []).fetchJson("loop"))).toBe(CONNECTOR_MESSAGES.redirect);
    // even to one of its own extra hosts: a redirect never changes host (credentials would follow it)
    expect(await outcome(connectorFetcher(cfg, v, []).fetchJson("away"))).toBe(CONNECTOR_MESSAGES.redirect);
    expect(CONNECTOR_MESSAGES.redirect).toBe("پاسخ به نشانی دیگری هدایت شد؛ نشانی منبع را اصلاح کنید");
  });

  it("plain http only with the server edition's tick; forbidden headers and credentials in the address are refused before anything is sent", async () => {
    const { cfg } = server(["zbx.bank.local"]);
    mount({ "zbx.bank.local": ["10.40.0.2"] });
    expect(await outcome(connectorFetcher(cfg, view({ base_url: "http://zbx.bank.local/" }), []).fetchJson("api"))).toBe(CONNECTOR_MESSAGES.plainHttp);
    expect(await outcome(connectorFetcher(cfg, view({ base_url: "http://zbx.bank.local/", plain_http: true }), []).fetchJson("api"))).toBe("ok");
    for (const h of ["Host", "Cookie", "Forwarded", "X-Forwarded-For", "X-Real-IP", "X-Remote-User"]) {
      // declared or not, these never go out
      expect(await outcome(connectorFetcher(cfg, view({ base_url: "https://zbx.bank.local/" }), [h]).fetchJson("api", { headers: { [h]: "x" } }))).toBe(CONNECTOR_MESSAGES.header(h));
    }
    expect(await outcome(connectorFetcher(cfg, view({ base_url: "https://zbx.bank.local/" }), ["X-API-Key"]).fetchJson("api", { headers: { "X-Auth-Token": "x" } }))).toBe(CONNECTOR_MESSAGES.header("X-Auth-Token"));
    for (const base of ["https://admin:pw@zbx.bank.local/", "https://zbx.bank.local/?apikey=k", "https://zbx.bank.local/api?token=k", "https://zbx.bank.local/?passhash=1"]) {
      expect(await outcome(connectorFetcher(cfg, view({ base_url: base }), []).fetchJson("api"))).toBe(CONNECTOR_MESSAGES.credentialsInUrl);
    }
    expect(await outcome(connectorFetcher(cfg, view({ base_url: "https://zbx.bank.local/" }), []).fetchJson("api", { query: { password: "p" } }))).toBe(CONNECTOR_MESSAGES.credentialsInUrl);
    expect(calls).toEqual(["http://zbx.bank.local/api"]);
    // «آزمودن اتصال» asks the same questions first
    expect(await reachProblem(cfg, { base_url: "https://other.bank.local/", hosts: [], plain_http: false }, { credentialed: false })).toBe(CONNECTOR_MESSAGES.notAllowed("other.bank.local"));
    expect(await reachProblem(cfg, { base_url: "https://zbx.bank.local/", hosts: [], plain_http: false }, { credentialed: true })).toBeNull();
    expect(await reachProblem({ mode: "desktop" }, { base_url: "https://zbx.bank.local/", hosts: [], plain_http: false }, { credentialed: true })).toBe(CONNECTOR_MESSAGES.desktop);
  });

  it("demo work never reaches the network: inside the demo scope a fetcher refuses before anything is sent (§14.4)", async () => {
    const { cfg } = server(["zbx.bank.local"]);
    mount({ "zbx.bank.local": ["10.40.0.2"], "tool.example.com": ["203.0.113.20"] });
    const demoOrg = uuidv7();
    for (const [c, base] of [[cfg, "https://zbx.bank.local/"], [web, "https://tool.example.com/"]] as const) {
      expect(await outcome(inDemoScope(demoOrg, () => connectorFetcher(c, view({ base_url: base }), [], { credentialed: true }).fetchJson("api")))).toBe(CONNECTOR_MESSAGES.demo);
      expect(await outcome(inDemoScope(demoOrg, () => connectorFetcher(c, view({ base_url: base }), []).fetchText("api")))).toBe(CONNECTOR_MESSAGES.demo);
    }
    expect(calls).toEqual([]);
    // the same calls outside the scope reach the tools
    expect(await outcome(connectorFetcher(cfg, view({ base_url: "https://zbx.bank.local/" }), []).fetchJson("api"))).toBe("ok");
    expect(await outcome(connectorFetcher(web, view({ base_url: "https://tool.example.com/" }), []).fetchJson("api"))).toBe("ok");
    expect(calls).toEqual(["https://zbx.bank.local/api", "https://tool.example.com/api"]);
  });
});

describe("TLS with the connector's own root (design A §14.2)", () => {
  const ca = fixtureCa();
  let lookup: typeof discoveryNet.lookup;
  let dial: typeof discoveryNet.dial;
  beforeAll(() => {
    lookup = discoveryNet.lookup;
    dial = discoveryNet.dial;
    setDiscoveryTransport(null);
    setDatabaseHosts(undefined, { names: [], addresses: [] });
  });
  afterAll(() => {
    discoveryNet.lookup = lookup;
    discoveryNet.dial = dial;
    setDatabaseHosts(undefined, null);
    resetDiscoveryNet();
  });
  /** A real TLS server with `cert`, reached as tool.bank.test (resolved to a public documentation address, dialled on 127.0.0.1). */
  async function tool(cert = ca.tool) {
    const s = await serveTls((req) => json({ path: new URL(req.url).pathname, key: req.headers.get("x-api-key") }), { cert: cert.pem, key: cert.key });
    discoveryNet.lookup = async (h) => (h === TOOL_HOST ? ["203.0.113.30"] : lookup(h));
    discoveryNet.dial = (_h, _p, _a) => ({ addresses: ["127.0.0.1"], port: s.port });
    resetDiscoveryNet();
    return s;
  }

  it("trusts the connector's root, refuses an unknown one, an expired certificate and another name — and nothing turns verification off", async () => {
    const s = await tool();
    try {
      const keyed = (over: Partial<ConnectorView>) => connectorFetcher(web, view(over), ["X-API-Key"], { credentialed: true }).fetchJson<{ path: string; key: string }>("api/devices", { headers: { "X-API-Key": "k-1" } });
      expect(await outcome(keyed({ options: { rejectUnauthorized: false, insecure: true, verify: false } }))).toBe(`گواهی ابزار (${TOOL_HOST}) را مرجع معتبری امضا نکرده است؛ گواهی ریشهٔ سازمان (PEM) را در «گواهی ریشهٔ ابزار» وارد کنید`);
      expect(await outcome(keyed({ ca_cert: ca.otherCa.pem }))).toContain("مرجع معتبری امضا نکرده است");
      // nothing was sent before the handshake failed
      expect(s.requests).toEqual([]);
      const r = await keyed({ ca_cert: ca.ca.pem });
      expect(r.body).toEqual({ path: "/api/devices", key: "k-1" });
      expect(s.requests).toEqual([{ host: TOOL_HOST, authorization: undefined }]);
      expect(await outcome(keyed({ ca_cert: "-----BEGIN CERTIFICATE-----\nnot a certificate\n-----END CERTIFICATE-----" }))).toContain("خوانده نشد");
    } finally {
      await s.close();
    }
    const expired = await tool(ca.expired);
    try {
      expect(await outcome(connectorFetcher(web, view({ ca_cert: ca.ca.pem }), []).fetchJson("api"))).toBe(`گواهی ابزار (${TOOL_HOST}) منقضی شده است`);
    } finally {
      await expired.close();
    }
    const other = await tool(ca.wrongName);
    try {
      expect(await outcome(connectorFetcher(web, view({ ca_cert: ca.ca.pem }), []).fetchJson("api"))).toContain("با نام‌های گواهی ابزار هم‌خوان نیست");
    } finally {
      await other.close();
    }
  });

  it("the server edition's workers start with the system certificate store, so the bank's own root needs no file", () => {
    expect(workerExecArgv(["--max-old-space-size=4096"], "v22.23.4")).toEqual(["--max-old-space-size=4096", "--use-system-ca"]);
    expect(workerExecArgv(["--use-system-ca"], "v22.23.4")).toEqual(["--use-system-ca"]);
    expect(workerExecArgv([], "v20.18.0")).toEqual([]);
  });

  it("reaches a plain-http tool on the server edition only with the tick, over a real socket pinned to the checked address", async () => {
    const s = await serve((req) => json({ path: new URL(req.url).pathname }));
    try {
      discoveryNet.lookup = async (h) => (h === "zbx.bank.local" ? ["10.40.0.2"] : lookup(h));
      discoveryNet.dial = () => ({ addresses: ["127.0.0.1"], port: s.port });
      const { cfg } = server(["zbx.bank.local"]);
      expect((await connectorFetcher(cfg, view({ base_url: "http://zbx.bank.local/", plain_http: true }), []).fetchJson("api/hosts")).body).toEqual({ path: "/api/hosts" });
      expect(await outcome(connectorFetcher(web, view({ base_url: "http://zbx.bank.local/", plain_http: true }), []).fetchJson("api"))).toBe(CONNECTOR_MESSAGES.plainHttp);
    } finally {
      await s.close();
    }
  });
});

describe("secrets of connectors (design A §14.3, §5.1)", () => {
  let w: DiscoveryWorld;
  const hosts: Record<string, Handler> = {};
  let unmount: () => void;
  beforeAll(async () => {
    w = await discoveryWorld();
    unmount = mountMocks(hosts);
  }, 180_000);
  afterAll(() => unmount?.());
  const journal = (id: string) => w.q<{ body: string; kind: string }>(`select body, kind from sm_journal where table_key = 'discovery_connector' and record_id = $1 order by created_at`, [id]);
  const stored = (id: string) => w.one<{ secret: string | null; secret2: string | null }>(`select secret, secret2 from sm_discovery_connectors where id = $1`, [id]);

  it("a change of the address's host or of the extra hosts clears both secrets unless new ones come with it", async () => {
    const P = w.P;
    const made = (await w.e.owner.post(`${P}/r/discovery_connector`, { ...REST_CONNECTOR, name: "منبع کلیددار", base_url: "https://keys.mock.test/", secret: "token-one", secret2: "token-two" })).row;
    expect(made.secret).toEqual({ secret: true, hint: "…" });
    expect(await stored(made.id)).toMatchObject({ secret: expect.any(String), secret2: expect.any(String) });
    // the same host on another path keeps them
    await w.e.owner.patch(`${P}/r/discovery_connector/${made.id}`, { base_url: "https://keys.mock.test/v2/" });
    expect((await stored(made.id)).secret).not.toBeNull();
    // another host clears both, with a journal line
    const moved = (await w.e.owner.patch(`${P}/r/discovery_connector/${made.id}`, { base_url: "https://elsewhere.mock.test/" })).row;
    expect(moved.secret).toBeNull();
    expect(await stored(made.id)).toEqual({ secret: null, secret2: null });
    expect((await journal(made.id)).map((j) => j.body)).toContain(SECRETS_CLEARED);
    // a key entered with the move stays; the other is still cleared
    await w.e.owner.patch(`${P}/r/discovery_connector/${made.id}`, { secret: "token-three", secret2: "token-four" });
    await w.e.owner.patch(`${P}/r/discovery_connector/${made.id}`, { base_url: "https://keys.mock.test/", secret: "token-five" });
    const after = await stored(made.id);
    expect(after.secret).not.toBeNull();
    expect(after.secret2).toBeNull();
    // extra hosts too
    await w.e.owner.patch(`${P}/r/discovery_connector/${made.id}`, { secret2: "token-six" });
    await w.e.owner.patch(`${P}/r/discovery_connector/${made.id}`, { hosts: ["ui.mock.test"] });
    expect(await stored(made.id)).toEqual({ secret: null, secret2: null });
    // no read of any kind returns a secret
    const read = (await w.e.owner.get(`${P}/r/discovery_connector/${made.id}`)).row;
    expect(JSON.stringify(read)).not.toMatch(/token-/);
  }, 120_000);

  it("secrets never reach run errors, item data or a preview's raw rows; a keyed connector without its key does not run", async () => {
    const devices = makeDevices(3, { from: 7000 });
    const mock = new RestMock(devices);
    hosts["leak.mock.test"] = async (req) => {
      const u = new URL(req.url);
      if (u.searchParams.get("offset") === "500") return json({ detail: `bad key ${req.headers.get("x-api-key")}` }, 500);
      const r = await mock.handler(req);
      const body = (await r.json()) as { results: Record<string, unknown>[] };
      body.results = body.results.map((d) => ({ ...d, password: REST_CONNECTOR.secret, api_token: REST_CONNECTOR.secret, note: `Bearer ${REST_CONNECTOR.secret}` }));
      return json(body, r.status);
    };
    const c = await w.connector({
      ...REST_CONNECTOR, name: "منبع نشتی", base_url: "https://leak.mock.test/",
      mapping: { ...REST_CONNECTOR.mapping, "attrs.password": "$.password", "attrs.note": "$.note", "attrs.api_token": "$.api_token" },
    });
    const pass = await w.pass(c.id);
    expect(pass.run.state).toBe("completed");
    const items = await w.q<{ data: unknown }>(`select data from sm_discovery_items where connector_id = $1`, [c.id]);
    expect(items.length).toBe(3);
    expect(JSON.stringify(items)).not.toContain(REST_CONNECTOR.secret);
    const preview = await previewConnector(w.sys, c.id, {}, 3);
    expect(preview.rows.length).toBe(3);
    expect(JSON.stringify(preview.rows)).not.toContain(REST_CONNECTOR.secret);
    // a tool that answers with the key in its error: the run's error is the documented message only
    mock.devices = makeDevices(600, { from: 8000 });
    await w.q(`update sm_discovery_runs set state = 'canceled' where connector_id = $1 and state = 'running'`, [c.id]);
    const failing = await w.pass(c.id);
    expect(failing.run.state).toBe("failed");
    expect(failing.run.error).toBe(`«منبع نشتی» پاسخ نداد`);
    expect(JSON.stringify(failing.run)).not.toContain(REST_CONNECTOR.secret);
    // a backup restore drops secrets: the connector says what to do and calls nothing
    const keyless = await w.connector({ ...REST_CONNECTOR, name: "منبع بی‌کلید", base_url: "https://leak.mock.test/", secret: null });
    const before = mock.requests.length;
    const refused = await w.pass(keyless.id);
    expect(refused.run).toMatchObject({ state: "failed", error: CONNECTOR_MESSAGES.reenterKey });
    expect(mock.requests.length).toBe(before);
    // the database host of this runtime is known (PGlite has no network address: nothing to refuse there)
    expect(await databaseHosts(w.e.db)).toMatchObject({ names: expect.any(Set), addresses: expect.any(Set) });
  }, 300_000);
});

describe("the fixed-script PowerShell runner (design A §6.4, §6.5)", () => {
  const seam = { ...psrunSeam };
  afterEach(() => Object.assign(psrunSeam, seam));

  it("runs only on the server edition on Windows, binds values to the script's own parameters and refuses anything else", async () => {
    const { cfg } = server(["mecm.bank.local"]);
    const run = { script: "web_request", host: "mecm.bank.local", credentialed: true, args: { Uri: "https://mecm.bank.local/AdminService/v1.0/Device" } };
    // Linux, or the web version: refused with what to do
    expect(await outcome(runPs(cfg, run))).toBe(PS_MESSAGES.windowsOnly);
    psrunSeam.platform = () => "win32";
    expect(await outcome(runPs(web, run))).toBe(PS_MESSAGES.windowsOnly);
    // the command line: fixed flags, the fixed script, each value bound to a declared parameter (never parsed as code)
    expect(psArgs(PS_SCRIPTS.web_request, "C:\\kariz\\web.ps1", { Uri: "https://h/x?a=1&b=2", TimeoutSec: 30 })).toEqual([
      "-NoProfile", "-NonInteractive", "-File", "C:\\kariz\\web.ps1", "-Uri:https://h/x?a=1&b=2", "-TimeoutSec:30",
    ]);
    const refused: Record<string, string>[] = [{ Command: "x" }, { Uri: "https://h/\nGet-Process" }, { Uri: 'https://h/"; Remove-Item' }, { Uri: "x".repeat(4001) }];
    for (const bad of refused) {
      expect(() => psArgs(PS_SCRIPTS.web_request, "f.ps1", bad)).toThrow(/پذیرفته نیست/);
    }
    // the host is judged before anything starts: off the allowlist, or credentials to a host not named exactly
    const calls: { file: string; args: string[]; stdin?: string }[] = [];
    psrunSeam.exec = async (file, args, o) => {
      calls.push({ file, args, stdin: o.stdin });
      return { code: 3, stdout: "", stderr: "KARIZ:redirect", timedOut: false };
    };
    discoveryNet.lookup = async () => ["10.30.0.4"];
    try {
      expect(await outcome(runPs(cfg, { ...run, host: "other.bank.local" }))).toBe(CONNECTOR_MESSAGES.notAllowed("other.bank.local"));
      expect(await outcome(runPs(server(["*.bank.local"]).cfg, run))).toBe(CONNECTOR_MESSAGES.exactName);
      expect(await outcome(runPs(cfg, { ...run, script: "Invoke-Expression" }))).toBe(PS_MESSAGES.unknownScript);
      // the script's address names the judged host and no other: https, or http only with the tick; no key in it
      expect(await outcome(runPs(cfg, { ...run, args: { Uri: "https://other.bank.local/AdminService/v1.0/Device" } }))).toBe(CONNECTOR_MESSAGES.otherHost);
      expect(await outcome(runPs(cfg, { ...run, args: { Uri: "http://mecm.bank.local/AdminService/v1.0/Device" } }))).toBe(CONNECTOR_MESSAGES.plainHttp);
      expect(await outcome(runPs(cfg, { ...run, args: { Uri: "https://mecm.bank.local/x?apikey=abc" } }))).toBe(CONNECTOR_MESSAGES.credentialsInUrl);
      // demo work never starts it (§14.4): nothing of the demo pack leaves the system
      expect(await outcome(inDemoScope(uuidv7(), () => runPs(cfg, run)))).toBe(CONNECTOR_MESSAGES.demo);
      expect(calls).toEqual([]);
      expect(await outcome(runPs(cfg, { ...run, plainHttp: true, args: { Uri: "http://mecm.bank.local/AdminService/v1.0/Device" } }))).toBe(CONNECTOR_MESSAGES.redirect);
      expect(calls).toHaveLength(1);
      calls.length = 0;
      // a redirect is refused (credentials never follow one); a password goes on stdin, never on the command line
      expect(await outcome(runPs(cfg, { ...run, stdin: "p@ss" }))).toBe(CONNECTOR_MESSAGES.redirect);
      expect(calls).toHaveLength(1);
      expect(calls[0].file).toMatch(/powershell\.exe$/i);
      expect(calls[0].args.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-File"]);
      expect(calls[0].args.join(" ")).not.toContain("p@ss");
      expect(calls[0].stdin).toBe("p@ss");
      psrunSeam.exec = async () => ({ code: 4, stdout: "", stderr: "KARIZ:status:401", timedOut: false });
      expect(await outcome(runPs(cfg, run))).toBe(CONNECTOR_MESSAGES.auth);
      psrunSeam.exec = async () => ({ code: 0, stdout: '{"value":[]}', stderr: "", timedOut: false });
      expect(await runPs(cfg, run)).toBe('{"value":[]}');
    } finally {
      discoveryNet.lookup = seamLookup;
      resetDiscoveryNet();
    }
  });
});
