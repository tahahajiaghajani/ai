// Server edition runtime parts without a PostgreSQL server: TLS (self-signed certificate, TLS 1.2 minimum, PFX), the
// disk blob store with its antivirus hook, the static app and the HTTP front (headers, CSP, compression, limits, gates),
// the scheduler's leader election (a fake lock), and the first-run setup through its API (on PGlite in cloud mode).
import { describe, it, expect, afterEach, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash, X509Certificate, createPublicKey } from "node:crypto";
import { brotliCompressSync, brotliDecompressSync, gzipSync } from "node:zlib";
import tls from "node:tls";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { Hono } from "hono";
import { generateSelfSigned, inspectCredentials, serverTlsOptions, certCovers, loadCredentials } from "../src/server-edition/tls";
import { createDiskBlobStore, scanFile } from "../src/server-edition/blobs-disk";
import { createStaticSite, inlineScriptHashes, cacheControl } from "../src/server-edition/static";
import { createFront, cspFor, isUploadPath } from "../src/server-edition/front";
import { Scheduler, nextDaily, type LeaderLock } from "../src/server-edition/scheduler";
import { WorkerMetrics } from "../src/server-edition/metrics";
import { defaultConfig, loadServerConfig, saveServerConfig, ensureSecrets, type ServerEditionConfig } from "../src/server-edition/config";
import { createUsersProbe, issueSetupToken, setupRoutes, tokenValid } from "../src/server-edition/setup";
import { backupDue, listBackups, pruneBackups } from "../src/server-edition/backup";
import { createPgliteDb } from "@server/db/pglite";
import { migrate } from "@server/db/migrate";
import { createApp } from "@server/app";
import { networkFetch, type NetworkPolicy } from "@server/net";
import { quietLog } from "./helpers";

const temps: string[] = [];
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), "itsm-srv-rt-"));
  temps.push(d);
  return d;
};
afterAll(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

const log = { ...quietLog, debug() {}, setLevel() {} };

describe("TLS", () => {
  it("generates a self-signed certificate that names the host, verifies, and serves TLS 1.2+ only", async () => {
    const ss = generateSelfSigned(["kariz.bank.local", "localhost", "127.0.0.1"]);
    const x = new X509Certificate(ss.cert);
    expect(x.verify(createPublicKey(ss.key))).toBe(true);
    expect(x.checkHost("kariz.bank.local")).toBe("kariz.bank.local");
    expect(x.checkIP("127.0.0.1")).toBe("127.0.0.1");
    const creds = inspectCredentials(ss);
    expect(creds.info.self_signed).toBe(true);
    expect(creds.info.days_left).toBeGreaterThan(800);
    expect(certCovers(creds.info, "kariz.bank.local")).toBe(true);
    expect(certCovers({ ...creds.info, names: ["*.bank.local"] }, "kariz.bank.local")).toBe(true);
    expect(certCovers({ ...creds.info, names: ["*.bank.local"] }, "a.b.bank.local")).toBe(false);

    const server = createHttpsServer(serverTlsOptions(creds), (_req, res) => res.end("ok"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as AddressInfo).port;
    try {
      const modern = await new Promise<string>((resolve, reject) => {
        const s = tls.connect({ host: "127.0.0.1", port, servername: "localhost", ca: ss.cert }, () => {
          resolve(String(s.getProtocol()));
          s.end();
        });
        s.on("error", reject);
      });
      expect(["TLSv1.2", "TLSv1.3"]).toContain(modern);
      const old = await new Promise<string>((resolve) => {
        const s = tls.connect({ host: "127.0.0.1", port, servername: "localhost", ca: ss.cert, maxVersion: "TLSv1.1", minVersion: "TLSv1" }, () => {
          resolve("connected");
          s.end();
        });
        s.on("error", (e) => resolve(String((e as NodeJS.ErrnoException).code ?? e.message)));
      });
      expect(old).not.toBe("connected");
    } finally {
      server.close();
    }
  });

  it("refuses a key that does not match and an expired or missing certificate with Persian messages", () => {
    const a = generateSelfSigned(["a.local"]);
    const b = generateSelfSigned(["b.local"]);
    expect(() => inspectCredentials({ cert: a.cert, key: b.key })).toThrow(/جور نیست/);
    expect(() => inspectCredentials({})).toThrow(/گواهی/);
    const past = generateSelfSigned(["old.local"], { days: 1, now: new Date(Date.now() - 10 * 86400_000) });
    expect(() => inspectCredentials(past)).toThrow(/منقضی/);
  });

  it("reads the bank's PFX bundle and reports a wrong password", () => {
    const dir = temp();
    const ss = generateSelfSigned(["kariz.bank.local"]);
    writeFileSync(join(dir, "c.pem"), ss.cert);
    writeFileSync(join(dir, "k.pem"), ss.key);
    const r = spawnSync("openssl", ["pkcs12", "-export", "-inkey", join(dir, "k.pem"), "-in", join(dir, "c.pem"), "-out", join(dir, "s.pfx"), "-passout", "pass:Bank-Pass-1"], { encoding: "utf8" });
    if (r.status !== 0) return; // no openssl on this machine: the PFX path is covered on Windows CI
    const pfx = readFileSync(join(dir, "s.pfx"));
    const creds = inspectCredentials({ pfx, passphrase: "Bank-Pass-1" });
    expect(creds.info.source).toBe("pfx");
    expect(creds.info.names).toContain("kariz.bank.local");
    expect(() => inspectCredentials({ pfx, passphrase: "wrong" })).toThrow(/گذرواژه/);
  });

  it("makes a self-signed certificate once and replaces it when the host name changes", () => {
    const c = defaultConfig(temp());
    c.public_url = "https://one.bank.local";
    const first = loadCredentials(c);
    expect(first.info.source).toBe("self-signed");
    expect(first.info.names).toContain("one.bank.local");
    expect(loadCredentials(c).info.fingerprint256).toBe(first.info.fingerprint256);
    c.public_url = "https://two.bank.local";
    expect(loadCredentials(c).info.names).toContain("two.bank.local");
  });
});

describe("disk blob store and antivirus hook", () => {
  const ORG = "01a1c3cf-7bfa-7008-9b89-91bc66266c8d";
  const sha = (d: Uint8Array) => createHash("sha256").update(d).digest("hex");
  let dir: string;
  let scanner: string;
  beforeAll(() => {
    dir = temp();
    scanner = join(dir, "fake-scan.cjs");
    // like MpCmdRun: «-File <path>», exit 2 when a threat is found; «SCANFAIL» makes the scanner itself fail
    writeFileSync(
      scanner,
      `const f = process.argv[process.argv.indexOf("-File") + 1]; const t = require("fs").readFileSync(f, "utf8");
       if (t.includes("SCANFAIL")) process.exit(5); if (t.includes("EICAR")) { console.log("Threat: EICAR"); process.exit(2); } process.exit(0);`,
    );
  });
  const store = (onError: "reject" | "allow" = "reject", events: string[] = []) =>
    createDiskBlobStore({
      root: join(dir, "blobs"),
      quarantine: join(dir, "quarantine"),
      maxBytes: 1024,
      antivirus: { command: process.execPath, args: [scanner, "-File", "{file}"], timeout_s: 30, infected_codes: [2], on_error: onError },
      onEvent: (e) => events.push(e.kind),
    });

  it("stores contents by hash, streams them, and lists what is missing", async () => {
    const events: string[] = [];
    const s = store("reject", events);
    const data = new TextEncoder().encode("گزارش رخداد");
    const h = sha(data);
    await s.prepare!(ORG, h, data);
    await s.put({} as never, ORG, h, data); // already stored: instant
    expect(events).toEqual(["scanned", "stored"]);
    expect(Buffer.from((await s.get({} as never, ORG, h))!).toString("utf8")).toBe("گزارش رخداد");
    const opened = await s.open!(ORG, h);
    expect(opened!.size).toBe(data.byteLength);
    expect(Buffer.from(await new Response(opened!.stream).arrayBuffer()).toString("utf8")).toBe("گزارش رخداد");
    expect(await s.has({} as never, ORG, h)).toBe(true);
    const other = "0".repeat(64);
    expect(await s.missing({} as never, ORG, [h, other])).toEqual([other]);
    expect(await s.get({} as never, ORG, other)).toBeNull();
    expect(existsSync(join(dir, "blobs", ORG, h.slice(0, 2), h))).toBe(true);
    expect(readdirSync(join(dir, "blobs", ".incoming"))).toEqual([]);
  });

  it("refuses a wrong hash, a path-like id and a file over the limit", async () => {
    const s = store();
    const data = new TextEncoder().encode("x");
    await expect(s.prepare!(ORG, "a".repeat(64), data)).rejects.toThrow(/جور نیست/);
    await expect(s.get({} as never, "../../etc", sha(data))).rejects.toThrow(/معتبر نیست/);
    const big = new Uint8Array(2048);
    await expect(s.prepare!(ORG, sha(big), big)).rejects.toMatchObject({ status: 413 });
  });

  it("quarantines an infected file and refuses it", async () => {
    const events: string[] = [];
    const s = store("reject", events);
    const data = new TextEncoder().encode("X5O!P%@AP EICAR-STANDARD-ANTIVIRUS-TEST-FILE");
    await expect(s.prepare!(ORG, sha(data), data)).rejects.toMatchObject({ status: 422, code: "infected" });
    expect(events).toEqual(["infected"]);
    expect(await s.has({} as never, ORG, sha(data))).toBe(false);
    const q = readdirSync(join(dir, "quarantine"));
    expect(q.some((f) => f.endsWith(".bin"))).toBe(true);
    const note = JSON.parse(readFileSync(join(dir, "quarantine", q.find((f) => f.endsWith(".json"))!), "utf8"));
    expect(note).toMatchObject({ org: ORG, sha256: sha(data) });
    expect(note.scanner).toContain("Threat");
  });

  it("refuses (or accepts, when configured) a file the scanner could not check", async () => {
    const data = new TextEncoder().encode("SCANFAIL please");
    await expect(store("reject").prepare!(ORG, sha(data), data)).rejects.toMatchObject({ status: 503 });
    await expect(store("allow").prepare!(ORG, sha(data), data)).resolves.toBeUndefined();
    expect((await scanFile({ command: join(dir, "no-such-scanner"), args: [], timeout_s: 5, infected_codes: [2], on_error: "reject" }, scanner)).verdict).toBe("error");
  });
});

describe("static app and the HTTP front", () => {
  let site: string;
  const html = `<!doctype html><html><head><script>var theme=1;</script><script type="module" src="/assets/app-x1.js"></script></head><body></body></html>`;
  const js = "console.log('app');".repeat(200);
  beforeAll(() => {
    site = temp();
    mkdirSync(join(site, "assets"), { recursive: true });
    mkdirSync(join(site, "fonts"), { recursive: true });
    writeFileSync(join(site, "index.html"), html);
    writeFileSync(join(site, "assets/app-x1.js"), js);
    writeFileSync(join(site, "assets/app-x1.js.br"), brotliCompressSync(Buffer.from(js)));
    writeFileSync(join(site, "assets/app-x1.js.gz"), gzipSync(Buffer.from(js)));
    writeFileSync(join(site, "fonts/f.woff2"), Buffer.alloc(100));
  });

  it("hashes inline scripts for the CSP and caches by kind of file", () => {
    const hashes = inlineScriptHashes(html);
    expect(hashes).toEqual([`'sha256-${createHash("sha256").update("var theme=1;").digest("base64")}'`]);
    expect(cspFor(hashes)).toContain(`script-src 'self' ${hashes[0]}`);
    expect(cspFor(hashes)).not.toMatch(/https?:/);
    expect(cacheControl("/assets/app-x1.js")).toContain("immutable");
    expect(cacheControl("/index.html")).toBe("no-cache");
    expect(isUploadPath("/api/o/x/r/incident/y/attachments")).toBe(true);
    expect(isUploadPath("/api/o/x/r/incident/y")).toBe(false);
  });

  it("serves pre-compressed files, the SPA fallback, ETags, and never leaves the folder", async () => {
    const s = createStaticSite(site, () => "fallback");
    const get = (path: string, headers: Record<string, string> = {}) => s.serve(new Request(`https://k.local${path}`, { headers }))!;
    const br = get("/assets/app-x1.js", { "accept-encoding": "gzip, br" });
    expect(br.headers.get("content-encoding")).toBe("br");
    expect(br.headers.get("cache-control")).toContain("immutable");
    expect(brotliDecompressSync(Buffer.from(await br.arrayBuffer())).toString()).toBe(js);
    expect(get("/assets/app-x1.js", { "accept-encoding": "gzip" }).headers.get("content-encoding")).toBe("gzip");
    expect(get("/assets/app-x1.js").headers.get("content-encoding")).toBeNull();
    const etag = get("/assets/app-x1.js").headers.get("etag")!;
    expect(get("/assets/app-x1.js", { "if-none-match": etag }).status).toBe(304);
    const spa = get("/o/123/incidents");
    expect(spa.headers.get("cache-control")).toBe("no-cache");
    expect(await spa.text()).toBe(html);
    expect(get("/assets/missing-old-chunk.js").status).toBe(404);
    expect((await get("/..%2f..%2fetc%2fpasswd").text())).toBe(html);
    expect(get("/assets/app-x1.js.br").status).toBe(404);
    expect(s.serve(new Request("https://k.local/api/x"))).toBeNull();
  });

  const makeFront = (over: Partial<Parameters<typeof createFront>[0]> = {}, setupRequired = false) => {
    const api = new Hono().basePath("/api");
    api.get("/health", (c) => c.json({ ok: true }));
    api.get("/big", (c) => c.json({ rows: Array.from({ length: 400 }, (_, i) => ({ i, name: "رکورد" })) }));
    api.get("/sse", () => new Response("data: x\n\n".repeat(400), { headers: { "content-type": "text/event-stream" } }));
    api.post("/echo", async (c) => c.json({ n: (await c.req.arrayBuffer()).byteLength }));
    api.get("/cron/tick", (c) => c.json({ ran: true }));
    api.get("/attachment", () => new Response("x", { headers: { "content-security-policy": "default-src 'none'; sandbox" } }));
    const c: ServerEditionConfig = defaultConfig(temp());
    c.uploads.request_max_mb = 1;
    c.metrics_token = "metrics-token-123";
    const metrics = new WorkerMetrics(1, 10, 1500);
    return createFront({
      api,
      config: () => c,
      site: createStaticSite(site, () => ""),
      metrics,
      log,
      ready: async () => ({ ok: true, checks: { database: true } }),
      cluster: async () => ({ workers: [metrics.snapshot()], expected_workers: 1, restarts: 0, started_at: "" }),
      queue: async () => ({ due: 2, running: 0, failed_24h: 0 }),
      setup: new Hono().get("/state", (cc) => cc.json({ required: setupRequired })),
      setupRequired: async () => setupRequired,
      https: true,
      ...over,
    });
  };

  it("adds security headers, keeps a route's own CSP, and makes the web cron inert", async () => {
    const f = makeFront();
    const r = await f.request("https://k.local/api/health");
    expect(r.headers.get("strict-transport-security")).toBe("max-age=31536000");
    expect(r.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(r.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(r.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect((await f.request("https://k.local/api/attachment")).headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect((await f.request("https://k.local/api/cron/tick")).status).toBe(404);
    const page = await f.request("https://k.local/login");
    expect(page.headers.get("content-security-policy")).toContain("'sha256-");
  });

  it("compresses API answers (never event streams) and limits request sizes", async () => {
    const f = makeFront();
    const big = await f.request("https://k.local/api/big", { headers: { "accept-encoding": "br, gzip" } });
    expect(big.headers.get("content-encoding")).toBe("br");
    expect(JSON.parse(brotliDecompressSync(Buffer.from(await big.arrayBuffer())).toString()).rows).toHaveLength(400);
    const sse = await f.request("https://k.local/api/sse", { headers: { "accept-encoding": "br" } });
    expect(sse.headers.get("content-encoding")).toBeNull();
    const ok = await f.request("https://k.local/api/echo", { method: "POST", body: new Uint8Array(1000) });
    expect(await ok.json()).toEqual({ n: 1000 });
    const tooBig = await f.request("https://k.local/api/echo", { method: "POST", body: new Uint8Array(2 * 1048576) });
    expect(tooBig.status).toBe(413);
  });

  it("serves metrics only with the token and keeps every API closed until the setup is done", async () => {
    const f = makeFront();
    expect((await f.request("https://k.local/api/server/metrics")).status).toBe(401);
    const m = await f.request("https://k.local/api/server/metrics", { headers: { authorization: "Bearer metrics-token-123" } });
    expect(await m.text()).toContain("itsm_jobs_due 2");
    expect((await f.request("https://k.local/api/ready")).status).toBe(200);
    const gated = makeFront({}, true);
    const r = await gated.request("https://k.local/api/big");
    expect(r.status).toBe(503);
    expect((await r.json()).error.code).toBe("setup_required");
    expect((await gated.request("https://k.local/api/health")).status).toBe(200);
    expect((await gated.request("https://k.local/api/setup/state")).status).toBe(200);
  });
});

describe("scheduler leader election", () => {
  class Hub {
    holder: string | null = null;
    listeners = new Set<() => void>();
  }
  const lockOf = (hub: Hub, id: string): LeaderLock => ({
    tryAcquire: async () => {
      if (!hub.holder || hub.holder === id) {
        hub.holder = id;
        return true;
      }
      return false;
    },
    check: async () => hub.holder === id,
    release: async () => {
      if (hub.holder === id) hub.holder = null;
    },
    listen: async (fn) => {
      hub.listeners.add(fn);
      return async () => void hub.listeners.delete(fn);
    },
    notify: async () => {
      for (const l of hub.listeners) l();
    },
    close: async () => {
      if (hub.holder === id) hub.holder = null;
    },
  });
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("lets exactly one worker tick, hands over when the leader stops, and wakes the leader from a follower", async () => {
    const hub = new Hub();
    const ticks = { a: 0, b: 0 };
    // a long interval: after the first tick only a wake-up makes the leader tick again
    const make = (id: "a" | "b") =>
      new Scheduler({ lock: lockOf(hub, id), log, intervalMs: 60_000, retryMs: 60, tick: async () => (ticks[id]++, { ran: 0, failed: 0, more: false }) });
    const until = async (cond: () => boolean, ms = 15_000) => {
      const end = Date.now() + ms;
      while (!cond()) {
        if (Date.now() > end) throw new Error("condition not reached in time");
        await wait(20);
      }
    };
    const a = make("a");
    const b = make("b");
    a.start();
    b.start();
    await until(() => (a.isLeader || b.isLeader) && ticks.a + ticks.b >= 1);
    await wait(300);
    expect([a.isLeader, b.isLeader].filter(Boolean)).toHaveLength(1);
    const [leader, follower, lk, fk] = a.isLeader ? ([a, b, "a", "b"] as const) : ([b, a, "b", "a"] as const);
    expect(ticks[fk]).toBe(0);
    // a write on the follower wakes the leader (NOTIFY) — the interval alone would not tick for a minute
    const before = ticks[lk];
    follower.wake();
    await until(() => ticks[lk] > before);
    expect(ticks[fk]).toBe(0);
    // the leader stops: the follower takes over and ticks
    await leader.stop();
    await until(() => follower.isLeader && ticks[fk] >= 1);
    expect(hub.holder).toBe(fk);
    await follower.stop();
    expect(hub.holder).toBeNull();
  });

  it("computes the next daily run", () => {
    const from = new Date(2026, 10, 10, 2, 0, 0);
    expect(nextDaily("01:30", from).getDate()).toBe(11);
    expect(nextDaily("03:15", from).getHours()).toBe(3);
  });
});

describe("backups (listing, pruning, due)", () => {
  it("lists backup folders, prunes old automatic ones and knows when the daily one is due", async () => {
    const root = temp();
    for (const n of ["itsm-auto-20261101-013000", "itsm-auto-20261102-013000", "itsm-auto-20261103-013000", "itsm-manual-20261102-100000", "not-a-backup"]) {
      mkdirSync(join(root, n), { recursive: true });
      writeFileSync(join(root, n, "db.dump"), "x");
    }
    expect(listBackups(root).map((b) => b.name)).toEqual(["itsm-auto-20261103-013000", "itsm-manual-20261102-100000", "itsm-auto-20261102-013000", "itsm-auto-20261101-013000"]);
    expect(await pruneBackups(root, 2)).toBe(1);
    expect(existsSync(join(root, "itsm-auto-20261101-013000"))).toBe(false);
    expect(existsSync(join(root, "itsm-manual-20261102-100000"))).toBe(true);
    const c = defaultConfig(temp());
    c.backup.dir = root;
    writeFileSync(join(root, "itsm-auto-20261103-013000", "manifest.json"), JSON.stringify({ created_at: new Date(2026, 10, 3, 1, 30).toISOString() }));
    expect(backupDue(c, new Date(2026, 10, 3, 9, 0))).toBe(false);
    expect(backupDue(c, new Date(2026, 10, 4, 1, 0))).toBe(false);
    expect(backupDue(c, new Date(2026, 10, 4, 1, 31))).toBe(true);
    c.backup.enabled = false;
    expect(backupDue(c, new Date(2026, 10, 4, 1, 31))).toBe(false);
  });
});

describe("first-run setup through its API", () => {
  it("creates the organisation and its owner once, with the bank's mail server and local AI on the allowlist", async () => {
    const dir = temp();
    const file = join(dir, "kariz.json");
    const c0 = defaultConfig(dir);
    ensureSecrets(c0);
    c0.public_url = "https://kariz.bank.local";
    saveServerConfig(file, c0);
    let current = loadServerConfig(file, {}).config;
    const network: NetworkPolicy = { lan: true, airGapped: true, allow: [...current.network.allow] };
    const platformAdmins: string[] = [];
    const db = await createPgliteDb({});
    await migrate(db);
    const api = createApp({ mode: "cloud", db, secret: current.secret, secretSource: "installation", allowSignup: false, platformAdmins, origin: "cloud", log: quietLog, fetch: networkFetch(network, globalThis.fetch.bind(globalThis)), network });
    const reload = () => {
      current = loadServerConfig(file, {}).config;
      network.allow = [...current.network.allow];
      platformAdmins.splice(0, platformAdmins.length, ...current.platform_admins);
    };
    const restarts: string[] = [];
    const hasUsers = createUsersProbe(db);
    const metrics = new WorkerMetrics(0, 5, 1500);
    const front = createFront({
      api,
      config: () => current,
      site: createStaticSite(temp(), () => "<!doctype html>"),
      metrics,
      log,
      ready: async () => ({ ok: true, checks: {} }),
      cluster: async () => ({ workers: [], expected_workers: 1, restarts: 0, started_at: "" }),
      queue: async () => null,
      setup: setupRoutes({ file, config: () => current, reload, restart: (r) => restarts.push(r), api, db, log }, hasUsers),
      setupRequired: async () => !(await hasUsers()),
      https: true,
    });
    const call = async (method: string, path: string, body?: unknown, cookie?: string) => {
      const r = await front.request(`https://kariz.bank.local/api${path}`, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, json: (await r.json().catch(() => null)) as any, cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "" };
    };
    try {
      // nobody can sign up before the setup: every API but health/meta/setup is closed
      expect((await call("POST", "/auth/signup", { email: "x@bank.local", password: "Kariz-Pass-9876", full_name: "مهاجم" })).status).toBe(503);
      expect((await call("GET", "/meta")).json.edition).toBe("web"); // cfg.server is absent in this test
      const { token, url } = issueSetupToken(file);
      expect(url).toBe(`https://kariz.bank.local/setup?token=${token}`);
      expect(existsSync(join(dir, "setup-url.txt"))).toBe(true);
      expect(tokenValid(loadServerConfig(file, {}).config, token)).toBe(true);
      expect(tokenValid(loadServerConfig(file, {}).config, `${token}x`)).toBe(false);
      const state = await call("GET", `/setup/state?token=${token}`);
      expect(state.json).toMatchObject({ required: true, valid: true, self_signed: true });
      expect((await call("GET", "/setup/state?token=wrong-token-123")).json).toMatchObject({ required: true, valid: false });
      expect((await call("GET", "/setup/state?token=wrong-token-123")).json.allow).toBeUndefined();

      const input = {
        token,
        org: { name: "بانک نمونه" },
        admin: { full_name: "مدیر فناوری بانک", email: "Admin@Bank.local", password: "Kariz-Strong-Pass-1405" },
        public_url: "https://kariz.bank.local",
        smtp: { host: "mail.bank.local", port: 25, security: "none", from_address: "itsm@bank.local" },
        ai: [{ base_url: "http://ollama.bank.local:11434/v1", kind: "ollama" }],
        allow: ["10.20.0.0/16"],
      };
      expect((await call("POST", "/setup/complete", { ...input, token: "not-the-token-1" })).status).toBe(403);
      expect((await call("POST", "/setup/complete", { ...input, admin: { ...input.admin, email: "bad" } })).status).toBe(400);
      const done = await call("POST", "/setup/complete", input);
      expect(done.status).toBe(200);
      expect(done.json.warnings).toEqual([]);
      expect(done.json.recovery_code).toMatch(/^[A-Z0-9-]{10,}$/);
      expect(done.json.directory_path).toBe(`/${done.json.org_id}/integrations/directory`);
      expect(done.cookie).toMatch(/=/);
      expect(restarts).toEqual([]);

      const saved = loadServerConfig(file, {}).config;
      expect(saved.platform_admins).toEqual(["admin@bank.local"]);
      expect(saved.network.allow).toEqual(["10.20.0.0/16", "ollama.bank.local", "mail.bank.local"]);
      expect(saved.setup).toMatchObject({ token_hash: null, expires_at: null });
      expect(saved.setup.completed_at).toBeTruthy();
      expect(existsSync(join(dir, "setup-url.txt"))).toBe(false);

      // the gate is open, the owner is signed in and administers the platform; the token is spent
      const me = await call("GET", "/auth/me", undefined, done.cookie);
      expect(me.status).toBe(200);
      expect(JSON.stringify(me.json)).toContain("admin@bank.local");
      const user = await db.one<{ is_platform_admin: boolean }>(`select is_platform_admin from sm_users where email = 'admin@bank.local'`);
      expect(user?.is_platform_admin).toBe(true);
      const plan = await db.one<{ key: string }>(`select key from sm_plans where is_default`);
      expect(plan?.key).toBe("enterprise");
      const channels = await call("GET", `/o/${done.json.org_id}/r/email_channel`, undefined, done.cookie);
      expect(channels.json.rows.map((r: { smtp_host: string }) => r.smtp_host)).toEqual(["mail.bank.local"]);
      const conns = await call("GET", `/o/${done.json.org_id}/ai/connections`, undefined, done.cookie);
      expect(JSON.stringify(conns.json)).toContain("ollama.bank.local");
      expect((await call("POST", "/setup/complete", input)).status).toBe(409);
      expect((await call("GET", `/setup/state?token=${token}`)).json).toMatchObject({ required: false, valid: false });
      // a self-sign-up is still refused afterwards (accounts come from the owner and the directory)
      expect((await call("POST", "/auth/signup", { email: "y@bank.local", password: "Kariz-Pass-9876", full_name: "کاربر" })).status).toBe(403);
    } finally {
      await db.close();
    }
  });
});
