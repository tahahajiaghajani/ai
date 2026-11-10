// Server edition, pure parts: the PostgreSQL tuner and pool plan, the configuration file, the outbound network policy
// (allowlist, CIDR, fetch wrapper, socket guard), metrics and logs, the zip writer and karizctl's argument parser.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { inflateRawSync } from "node:zlib";
import { connectionsFor, memUnit, planPools, renderTuning, tunePostgres, withIncludes, CONF_INCLUDES } from "../src/server-edition/pgtune";
import { databaseUrl, defaultConfig, ensureSecrets, envOverrides, loadServerConfig, newPassword, normalize, patchServerConfig, poolFor, redacted, saveServerConfig, workerCount } from "../src/server-edition/config";
import { allowEntryProblem, checkOutboundHost, hostAllowed, ipInCidr, isLoopbackHost, lanAllowed, networkFetch, OutboundBlockedError, policyNet, type NetworkPolicy } from "@server/net";
import { installSocketGuard, uninstallSocketGuard } from "../src/server-edition/airgap";
import { prometheus, routeOf, WorkerMetrics } from "../src/server-edition/metrics";
import { createLogger, RotatingFile, scrub } from "../src/server-edition/log";
import { crc32, zip } from "../src/server-edition/zip";
import { parseArgs } from "../src/server-edition/ctl";
import { EDITION, DIRECTORY_SETTINGS_PATH } from "../src/server-edition/names";
import { presetBlocked } from "@server/modules/ai/connections";
import { presetById } from "@shared/ai/presets";
import { checkMailHost } from "@server/modules/notify/mail";
import type { ServerConfig } from "@server/context";

const temps: string[] = [];
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), "itsm-srv-"));
  temps.push(d);
  return d;
};
afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

describe("names", () => {
  it("keeps the Windows-facing names in one packaging file", () => {
    const raw = JSON.parse(readFileSync(join(__dirname, "../packaging/server/edition.json"), "utf8"));
    expect(EDITION.product).toBe("Kariz Server");
    expect(raw.services.db.name).toBe("KarizDB");
    expect(raw.services.app.name).toBe("KarizApp");
    expect(raw.installDir).toBe("C:\\Program Files\\Kariz");
    expect(raw.dataDir).toBe("C:\\ProgramData\\Kariz");
    expect(raw.upgradeCode).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/);
    expect(DIRECTORY_SETTINGS_PATH).toBe("/integrations/directory");
  });
});

describe("PostgreSQL tuner", () => {
  const base = { ramMb: 32768, cpus: 8, disk: "ssd" as const, os: "windows" as const, connections: 120 };

  it("gives PostgreSQL a share of the memory and sizes its settings from it", () => {
    const r = tunePostgres(base);
    expect(r.dbMemMb).toBe(Math.floor(32768 * 0.6));
    expect(r.settings.shared_buffers).toBe(memUnit(Math.floor(r.dbMemMb / 4)));
    expect(r.settings.effective_cache_size).toBe(memUnit(Math.floor((r.dbMemMb * 3) / 4)));
    expect(r.settings.max_connections).toBe("120");
    expect(r.settings.random_page_cost).toBe("1.1");
    expect(r.settings.listen_addresses).toBe("'127.0.0.1'");
    expect(r.settings.shared_preload_libraries).toBe("'pg_stat_statements'");
    expect(r.settings.log_min_duration_statement).toBe("1000");
    expect(r.settings.log_parameter_max_length).toBe("0");
    expect(r.settings.password_encryption).toBe("'scram-sha-256'");
  });

  it("never sets io concurrency on Windows (PostgreSQL refuses to start) and uses HDD costs on spinning disks", () => {
    expect(tunePostgres(base).settings.effective_io_concurrency).toBe("0");
    expect(tunePostgres({ ...base, os: "linux" }).settings.effective_io_concurrency).toBe("200");
    const hdd = tunePostgres({ ...base, disk: "hdd" });
    expect(hdd.settings.random_page_cost).toBe("4.0");
    expect(hdd.notes.some((n) => n.includes("HDD"))).toBe(true);
  });

  it("keeps values inside sane bounds on tiny and huge machines", () => {
    const tiny = tunePostgres({ ...base, ramMb: 2048, cpus: 2, connections: 300 });
    expect(tiny.settings.shared_buffers).toBe("307MB");
    expect(tiny.settings.work_mem).toBe("4MB");
    expect(tiny.notes.length).toBeGreaterThan(0);
    const huge = tunePostgres({ ...base, ramMb: 512 * 1024, cpus: 64 });
    expect(huge.settings.shared_buffers).toBe("8GB"); // the Windows cap
    expect(huge.settings.maintenance_work_mem).toBe("2GB");
    expect(huge.settings.work_mem).toBe("64MB");
    expect(Number(huge.settings.max_parallel_workers_per_gather)).toBe(4);
  });

  it("plans pools so that workers × (pool + 1) + 1 fits max_connections minus the reserve", () => {
    for (const workers of [1, 2, 4, 8, 16]) {
      for (const max of [50, 100, 200, 500]) {
        const p = planPools({ workers, maxConnections: max, reserve: 10 });
        expect(p.total).toBe(workers * (p.perWorker + 1) + 1);
        if (max - 10 >= workers * 2 + 1) expect(p.total).toBeLessThanOrEqual(max - 10);
        expect(p.perWorker).toBeGreaterThanOrEqual(1);
      }
    }
    const asked = planPools({ workers: 8, maxConnections: 100, reserve: 10, requested: 50 });
    expect(asked.reduced).toBe(true);
    expect(asked.total).toBeLessThanOrEqual(90);
    expect(planPools({ workers: 2, maxConnections: 200, requested: 8 })).toMatchObject({ perWorker: 8, reduced: false });
    expect(connectionsFor(4, 10)).toBeGreaterThanOrEqual(4 * 11 + 1 + 10);
  });

  it("writes an include file and includes it once at the end of postgresql.conf", () => {
    const input = { ...base };
    const text = renderTuning(tunePostgres(input), input, new Date("2026-01-01T00:00:00Z"));
    expect(text).toMatch(/^# Generated by karizctl pg-conf/);
    expect(text).toMatch(/\nshared_buffers\s+= \d+(MB|GB)\n/);
    const once = withIncludes("max_connections = 100\n# end\n");
    expect(withIncludes(once)).toBe(once);
    expect(once.trim().split("\n").slice(-2)).toEqual(CONF_INCLUDES);
  });
});

describe("configuration", () => {
  it("normalises a hand-edited file: bad values fall back with a warning, URLs are trimmed to their origin", () => {
    const warnings: string[] = [];
    const c = normalize({ public_url: "https://kariz.bank.local/path/", listen: { https_port: "8443", http_port: "abc" }, workers: 99, backup: { time: "25:00" }, network: { allow: "Ollama.Bank.Local, 10.0.0.0/8" }, dirs: { data: "/srv/kariz" } }, warnings);
    expect(c.public_url).toBe("https://kariz.bank.local");
    expect(c.listen.https_port).toBe(8443);
    expect(c.listen.http_port).toBe(80);
    expect(c.workers).toBe(0);
    expect(c.backup.time).toBe("01:30");
    expect(c.network.allow).toEqual(["ollama.bank.local", "10.0.0.0/8"]);
    expect(c.network.air_gapped).toBe(true);
    expect(c.dirs.blobs).toBe(join("/srv/kariz", "blobs"));
    expect(warnings.length).toBe(3);
  });

  it("applies ITSM_* environment overrides over the file", () => {
    const o = envOverrides({ ITSM_HTTPS_PORT: "9443", ITSM_AIR_GAPPED: "false", ITSM_ALLOW_HOSTS: "a.local,b.local", ITSM_DB_PASSWORD: "x" } as NodeJS.ProcessEnv);
    const c = normalize(o);
    expect(c.listen.https_port).toBe(9443);
    expect(c.network.air_gapped).toBe(false);
    expect(c.network.allow).toEqual(["a.local", "b.local"]);
    expect(c.db.password).toBe("x");
  });

  it("generates secrets once, keeps them across loads, and never shows them", () => {
    const dir = temp();
    const file = join(dir, "kariz.json");
    const c = defaultConfig(dir);
    expect(ensureSecrets(c)).toBe(true);
    expect(ensureSecrets(c)).toBe(false);
    saveServerConfig(file, c);
    const back = loadServerConfig(file, {}).config;
    expect(back.secret).toBe(c.secret);
    expect(back.db.password).toBe(c.db.password);
    expect(back.db.admin_password).toBe(c.db.admin_password);
    const shown = JSON.stringify(redacted(back));
    for (const s of [c.secret, c.db.password, c.db.admin_password, c.metrics_token]) expect(shown).not.toContain(s);
    // the superuser's password lives apart (administrators only); the application, which cannot read it, never erases it
    expect(readFileSync(file, "utf8")).not.toContain(c.db.admin_password);
    expect(JSON.parse(readFileSync(join(dir, "kariz-admin.json"), "utf8")).admin_password).toBe(c.db.admin_password);
    const asAdmin = loadServerConfig(file, {}).config;
    rmSync(join(dir, "kariz-admin.json"));
    const withoutAdmin = loadServerConfig(file, {}).config;
    expect(withoutAdmin.db.admin_password).toBe("");
    saveServerConfig(file, withoutAdmin);
    expect(existsSync(join(dir, "kariz-admin.json"))).toBe(false);
    saveServerConfig(file, asAdmin);
    patchServerConfig(file, (x) => x.network.allow.push("smtp.bank.local"));
    expect(loadServerConfig(file, {}).config.db.admin_password).toBe(c.db.admin_password);
    expect(loadServerConfig(file, {}).config.network.allow).toEqual(["smtp.bank.local"]);
    expect(newPassword(40)).toMatch(/^[A-Za-z0-9]{40}$/);
  });

  it("refuses a broken file instead of guessing", () => {
    const dir = temp();
    writeFileSync(join(dir, "kariz.json"), "{ not json");
    expect(() => loadServerConfig(join(dir, "kariz.json"), {})).toThrow(/JSON/);
  });

  it("encodes the database URL and sizes workers and pools from the machine", () => {
    const c = defaultConfig("/x");
    c.db.password = "p@ss/word";
    expect(databaseUrl(c)).toBe(`postgres://kariz_app:p%40ss%2Fword@127.0.0.1:${EDITION.database.port}/kariz`);
    expect(workerCount(c, 1)).toBe(2);
    expect(workerCount(c, 64)).toBe(16);
    c.workers = 3;
    expect(workerCount(c, 64)).toBe(3);
    expect(poolFor(c, 8).total).toBeLessThanOrEqual(c.db.max_connections - c.db.reserve);
  });
});

describe("outbound network policy", () => {
  const policy = (allow: string[], airGapped = true): NetworkPolicy => ({ lan: true, airGapped, allow });

  it("matches names, wildcards, IP addresses and CIDR ranges; loopback is always reachable", () => {
    const p = policy(["ollama.bank.local", "*.svc.bank.local", ".mail.bank.local", "10.20.0.0/16", "fd00::/8", "192.168.1.5"]);
    expect(hostAllowed(p, "OLLAMA.bank.local.")).toBe(true);
    expect(hostAllowed(p, "llm.svc.bank.local")).toBe(true);
    expect(hostAllowed(p, "svc.bank.local")).toBe(false);
    expect(hostAllowed(p, "x.mail.bank.local")).toBe(true);
    expect(hostAllowed(p, "10.20.3.4")).toBe(true);
    expect(hostAllowed(p, "10.21.0.1")).toBe(false);
    expect(hostAllowed(p, "[fd12::1]")).toBe(true);
    expect(hostAllowed(p, "192.168.1.5")).toBe(true);
    expect(hostAllowed(p, "api.openai.com")).toBe(false);
    expect(hostAllowed(p, "intranet.bank.local", ["10.20.9.9"])).toBe(true);
    expect(hostAllowed(p, "intranet.bank.local", ["10.20.9.9", "8.8.8.8"])).toBe(false);
    for (const h of ["localhost", "127.0.0.1", "127.9.9.9", "::1", "[::1]", "::ffff:127.0.0.1"]) expect(isLoopbackHost(h)).toBe(true);
    expect(hostAllowed(p, "127.0.0.1")).toBe(true);
    expect(hostAllowed(policy([], false), "api.openai.com")).toBe(true);
    expect(ipInCidr("172.16.5.1", "172.16.0.0/12")).toBe(true);
    expect(ipInCidr("172.32.0.1", "172.16.0.0/12")).toBe(false);
    expect(ipInCidr("1.2.3.4", "0.0.0.0/0")).toBe(true);
  });

  it("checks allowlist entries", () => {
    for (const ok of ["ollama.bank.local", "*.bank.local", "10.0.0.0/8", "fd00::/8", "10.1.2.3", "host_1.local"]) expect(allowEntryProblem(ok)).toBeNull();
    for (const bad of ["", "10.0.0.0/33", "bad host", "-x.local/8", "a..b"]) expect(allowEntryProblem(bad)).not.toBeNull();
  });

  it("knows which runtimes reach the internal network", () => {
    expect(lanAllowed({ mode: "desktop" })).toBe(true);
    expect(lanAllowed({ mode: "cloud" })).toBe(false);
    expect(lanAllowed({ mode: "cloud", network: policy([]) })).toBe(true);
  });

  it("refuses fetches outside the allowlist with a Persian message, logs them and checks every redirect hop", async () => {
    const refused: string[] = [];
    const p: NetworkPolicy = { ...policy(["ollama.bank.local", "mirror.bank.local"]), onRefused: (h) => refused.push(h) };
    const calls: string[] = [];
    const inner = (async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push(url);
      const path = new URL(url).pathname;
      if (path === "/moved") return new Response(null, { status: 302, headers: { location: "https://evil.example.com/x" } });
      if (path === "/mirror") return new Response(null, { status: 301, headers: { location: "http://mirror.bank.local/ok" } });
      return new Response("ok");
    }) as typeof fetch;
    const f = networkFetch(p, inner);
    await expect(f("https://api.openai.com/v1/models")).rejects.toBeInstanceOf(OutboundBlockedError);
    await expect(f("https://api.openai.com/v1/models")).rejects.toThrow(/شبکهٔ بسته/);
    expect(await (await f("http://ollama.bank.local:11434/mirror")).text()).toBe("ok");
    await expect(f("http://ollama.bank.local:11434/moved")).rejects.toBeInstanceOf(OutboundBlockedError);
    expect(calls.some((u) => u.includes("evil"))).toBe(false);
    expect(refused).toEqual(["api.openai.com", "api.openai.com", "evil.example.com"]);
    // a caller that handles redirects itself gets the 30x untouched
    expect((await f("http://ollama.bank.local/moved", { redirect: "manual" })).status).toBe(302);
  });

  it("judges names through their addresses when only IP ranges are allowed (SMTP, IMAP, LDAP clients)", async () => {
    const saved = policyNet.lookup;
    policyNet.lookup = async (h) => (h === "dc1.bank.local" ? ["10.20.1.1"] : ["93.184.216.34"]);
    try {
      const p = policy(["10.20.0.0/16"]);
      await expect(checkOutboundHost(p, "dc1.bank.local", "سرور LDAP")).resolves.toBeUndefined();
      await expect(checkOutboundHost(p, "example.com", "سرور ایمیل")).rejects.toThrow(/سرور ایمیل: دسترسی به «example.com»/);
      await expect(checkOutboundHost(policy([], false), "example.com")).resolves.toBeUndefined();
    } finally {
      policyNet.lookup = saved;
    }
  });

  it("lets the server edition use its own mail server and refuses others", async () => {
    const cfg = { mode: "cloud" as const, network: policy(["mail.bank.local"]) };
    await expect(checkMailHost(cfg, "mail.bank.local")).resolves.toBeUndefined();
    await expect(checkMailHost(cfg, "smtp.gmail.com")).rejects.toThrow(/شبکهٔ بسته/);
    // the web version still refuses internal mail servers
    await expect(checkMailHost({ mode: "cloud" }, "10.0.0.5")).rejects.toThrow();
  });

  it("shows cloud AI services as unavailable on an air-gapped server, local servers stay", () => {
    const cfg = { mode: "cloud", network: policy(["ollama.bank.local"]) } as unknown as ServerConfig;
    expect(presetBlocked(cfg, presetById("anthropic")!)).toMatch(/شبکهٔ بسته/);
    expect(presetBlocked(cfg, presetById("openai")!)).toMatch(/اینترنتی/);
    expect(presetBlocked(cfg, presetById("ollama")!)).toBeNull();
    expect(presetBlocked(cfg, presetById("custom-openai")!)).toBeNull();
    expect(presetBlocked({ mode: "cloud" } as ServerConfig, presetById("anthropic")!)).toBeNull();
    const allowed = { mode: "cloud", network: policy(["api.anthropic.com"]) } as unknown as ServerConfig;
    expect(presetBlocked(allowed, presetById("anthropic")!)).toBeNull();
  });
});

describe("socket-level air-gap guard", () => {
  afterEach(() => uninstallSocketGuard());

  const tryConnect = (host: string, port: number) =>
    new Promise<string>((resolve) => {
      const s = net.connect({ host, port });
      s.setTimeout(3000);
      s.on("connect", () => {
        s.destroy();
        resolve("connected");
      });
      s.on("error", (e: NodeJS.ErrnoException) => resolve(e.code ?? e.message));
      s.on("timeout", () => {
        s.destroy();
        resolve("timeout");
      });
    });

  it("refuses connections to hosts outside the allowlist before any packet leaves, loopback stays open", async () => {
    const server = net.createServer((c) => c.end()).listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const port = (server.address() as net.AddressInfo).port;
    const refused: string[] = [];
    try {
      installSocketGuard({ lan: true, airGapped: true, allow: ["10.99.0.0/16"] }, { extraHosts: ["db.bank.local"], onRefused: (h) => refused.push(h) });
      expect(await tryConnect("203.0.113.7", 443)).toBe("EAIRGAP");
      expect(await tryConnect("127.0.0.1", port)).toBe("connected");
      expect(refused).toEqual(["203.0.113.7"]);
      // fetch (undici) goes through the same sockets
      const err = await fetch("http://203.0.113.8:81/").catch((e: Error & { cause?: { code?: string } }) => e.cause?.code ?? e.message);
      expect(err).toBe("EAIRGAP");
      // the policy can be relaxed in place (karizctl allow add → reload)
      installSocketGuard({ lan: true, airGapped: false, allow: [] });
      expect(await tryConnect("127.0.0.1", port)).toBe("connected");
    } finally {
      server.close();
    }
  });
});

describe("metrics and logs", () => {
  it("removes identifiers from request paths", () => {
    expect(routeOf("/api/o/01a1c3cf-7bfa-7008-9b89-91bc66266c8d/r/incident/01a1c3cf-ae77-702f-8ec4-1373aa758f57?x=1")).toBe("/api/o/:id/r/incident/:id");
    expect(routeOf("/api/o/x/blobs/8810cf0b59917f4703a6d4879effb52f2f5bb391087991950fd22174da06b134")).toBe("/api/o/x/blobs/:hash");
  });

  it("measures requests and database use and exposes Prometheus text", async () => {
    const m = new WorkerMetrics(3, 10, 100);
    m.requestStarted();
    m.requestDone("GET", "/api/x/123", 200, 20);
    m.requestStarted();
    m.requestDone("POST", "/api/y", 503, 250);
    m.refused("api.openai.com", "fetch");
    const db = m.wrapDb({ kind: "postgres", query: async () => [], one: async () => null, exec: async () => {}, tx: async (fn: (tx: never) => unknown) => fn({} as never), close: async () => {} } as never);
    await db.query("select 1");
    const s = m.snapshot();
    expect(s.requests).toMatchObject({ total: 2, errors: 1, in_flight: 0 });
    expect(s.slow).toHaveLength(1);
    expect(s.slow[0].path).toBe("/api/y");
    expect(s.db.queries).toBe(1);
    const text = prometheus({ workers: [s], expected_workers: 2, restarts: 1, started_at: "" }, { queue: { due: 4, running: 1, failed_24h: 0 } });
    expect(text).toContain('itsm_http_requests_total{worker="3"} 2');
    expect(text).toContain("itsm_workers_expected 2");
    expect(text).toContain("itsm_jobs_due 4");
    expect(text).toContain('itsm_outbound_refused_total{worker="3"} 1');
  });

  it("never logs secrets and rotates by size", () => {
    expect(scrub({ email: "a@b", password: "x", nested: { api_key: "k", token: "t", ok: 1 } })).toEqual({ email: "a@b", password: "(hidden)", nested: { api_key: "(hidden)", token: "(hidden)", ok: 1 } });
    const dir = temp();
    const f = new RotatingFile(dir, "kariz-app.log", 400, 2);
    const log = createLogger((line) => f.write(line), { level: "info", worker: 1 });
    for (let i = 0; i < 30; i++) log.info(`line ${i}`, { i });
    log.debug("hidden at info level");
    f.close();
    const files = readdirSync(dir).sort();
    expect(files).toEqual(["kariz-app.1.log", "kariz-app.2.log", "kariz-app.log"]);
    const last = readFileSync(join(dir, "kariz-app.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(last.at(-1)).toMatchObject({ level: "info", w: 1, msg: "line 29", data: { i: 29 } });
    expect(readFileSync(join(dir, "kariz-app.log"), "utf8")).not.toContain("hidden at info level");
  });
});

describe("zip and karizctl arguments", () => {
  it("writes a ZIP whose entries read back", () => {
    const buf = zip([{ name: "a.txt", data: "سلام ".repeat(100) }, { name: "logs/b.json", data: new Uint8Array([1, 2, 3]) }]);
    expect(buf.readUInt32LE(0)).toBe(0x04034b50);
    const end = buf.length - 22;
    expect(buf.readUInt32LE(end)).toBe(0x06054b50);
    expect(buf.readUInt16LE(end + 10)).toBe(2);
    // first entry: deflated, CRC matches
    const method = buf.readUInt16LE(8);
    const size = buf.readUInt32LE(18);
    const nameLen = buf.readUInt16LE(26);
    const body = buf.subarray(30 + nameLen, 30 + nameLen + size);
    const raw = method === 8 ? inflateRawSync(body) : body;
    expect(raw.toString("utf8")).toBe("سلام ".repeat(100));
    expect(crc32(raw)).toBe(buf.readUInt32LE(14));
  });

  it("parses commands, positionals and flags", () => {
    expect(parseArgs(["restore", "C:\\backups\\x", "--yes", "--config", "c.json", "--disk=hdd"])).toEqual({ cmd: "restore", positional: ["C:\\backups\\x"], flags: { yes: true, config: "c.json", disk: "hdd" } });
    expect(parseArgs([]).cmd).toBe("help");
    expect(parseArgs(["--config", "c.json", "status"])).toEqual({ cmd: "status", positional: [], flags: { config: "c.json" } });
    expect(parseArgs(["--yes", "purge"])).toEqual({ cmd: "purge", positional: [], flags: { yes: true } });
  });

  it("ships no generated file it should not (the bundle folder is ignored by git)", () => {
    expect(readFileSync(join(__dirname, "../.gitignore"), "utf8")).toContain("server-dist/");
    expect(existsSync(join(__dirname, "../packaging/server/externals.json"))).toBe(true);
  });
});
