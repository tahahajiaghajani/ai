// Server edition review fixes: forged forwarding headers never reach the API (the raw header list @hono/node-server
// reads), client addresses from the socket for rate limits and the first-run setup, bodies never buffered before
// authentication, SMTP to an allowlisted name through the socket guard (nodemailer connects to the address), backups
// that a content-less attachment row cannot fail and that a failing disk cannot retry back to back, and karizctl that
// takes neither programs nor folders to delete from the application-writable kariz.json.
import { describe, it, expect, afterEach, afterAll, beforeEach } from "vitest";
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import net from "node:net";
import dns from "node:dns";
import os from "node:os";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import nodemailer from "nodemailer";
import { createFront, byteLimit, PayloadTooLarge } from "../src/server-edition/front";
import { createStaticSite } from "../src/server-edition/static";
import { WorkerMetrics } from "../src/server-edition/metrics";
import { nodeHandler } from "../src/server-edition/worker";
import { defaultConfig, ensureSecrets, loadServerConfig, saveServerConfig, type ServerEditionConfig } from "../src/server-edition/config";
import { issueSetupToken, setupRoutes } from "../src/server-edition/setup";
import { backupDue, backupNow, lastBackup, mirrorAudit, mirrorBlobs, nextBackupRetry, retryPauseMs } from "../src/server-edition/backup";
import { guardDns, installSocketGuard, uninstallSocketGuard } from "../src/server-edition/airgap";
import { main as ctl, parseArgs, trustedPgBin } from "../src/server-edition/ctl";
import { clientIp, resetRateLimits } from "@server/http/ratelimit";
import type { Db } from "@server/db";
import { quietLog } from "./helpers";

const temps: string[] = [];
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), "itsm-srv-fix-"));
  temps.push(d);
  return d;
};
afterAll(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});
const log = { ...quietLog, debug() {}, setLevel() {} };

/** The front over `api`, served by Node like the worker (nodeHandler); «x-test-peer» stands in for the TCP peer. */
async function serveFront(api: Hono, config: () => ServerEditionConfig, setup: Hono = new Hono()) {
  const front = createFront({
    api,
    config,
    site: createStaticSite(temp(), () => "<!doctype html>"),
    metrics: new WorkerMetrics(0, 5, 1500),
    log,
    ready: async () => ({ ok: true, checks: {} }),
    cluster: async () => ({ workers: [], expected_workers: 1, restarts: 0, started_at: "" }),
    queue: async () => null,
    setup,
    setupRequired: async () => false,
    https: true,
  });
  const handler = nodeHandler(front.fetch, () => config().trusted_proxies);
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const peer = req.headers["x-test-peer"];
    if (typeof peer === "string") Object.defineProperty(req.socket, "remoteAddress", { value: peer, configurable: true });
    handler(req, res);
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as net.AddressInfo).port;
  /** A request; `chunks` are written one by one (chunked) and the request is ended only when `end` is true. */
  const call = (method: string, path: string, headers: Record<string, string>, body?: string | Buffer[], end = true) =>
    new Promise<{ status: number; json: any }>((ok, fail) => {
      const r = httpRequest({ host: "127.0.0.1", port, method, path, headers, agent: false }, (res) => {
        const parts: Buffer[] = [];
        res.on("data", (c) => parts.push(c));
        res.on("end", () => {
          const text = Buffer.concat(parts).toString("utf8");
          let json: unknown = null;
          try {
            json = JSON.parse(text);
          } catch {
            json = text;
          }
          ok({ status: res.statusCode ?? 0, json });
          r.destroy();
        });
      });
      r.on("error", (e) => (r.destroyed ? undefined : fail(e)));
      if (Array.isArray(body)) {
        for (const b of body) r.write(b);
        if (end) r.end();
      } else r.end(body);
    });
  return {
    call,
    close: () =>
      new Promise<void>((ok) => {
        server.close(() => ok());
        server.closeAllConnections();
      }),
  };
}

const withTimeout = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), ms))]);

describe("forwarding headers and client addresses", () => {
  it("never lets a non-proxy client's X-Forwarded-*, X-Real-IP or Forwarded reach the API, whatever reads the body", async () => {
    const c = defaultConfig(temp());
    c.trusted_proxies = ["10.9.0.5"];
    const api = new Hono();
    api.use("*", async (cc, next) => {
      cc.set("cfg" as never, { auth: { trustedProxies: ["10.9.0.5"] } } as never);
      await next();
    });
    api.all("/api/echo", async (cc) => {
      if (cc.req.method !== "GET") await cc.req.text();
      // iterating the headers builds the Request's headers from the raw list, as Hono does on many paths
      const names = [...cc.req.raw.headers.keys()];
      return cc.json({ names, xff: cc.req.header("x-forwarded-for") ?? null, xri: cc.req.header("x-real-ip") ?? null, xfh: cc.req.header("x-forwarded-host") ?? null, fwd: cc.req.header("forwarded") ?? null, ip: clientIp(cc) });
    });
    const front = await serveFront(api, () => c);
    try {
      const forged = { "x-test-peer": "203.0.113.9", "x-forwarded-for": "10.0.0.1", "x-real-ip": "10.0.0.2", "x-forwarded-host": "evil.example", forwarded: "for=10.0.0.3" };
      const expected = { xff: null, xri: "203.0.113.9", xfh: null, fwd: null, ip: "203.0.113.9" };
      expect((await front.call("GET", "/api/echo", forged)).json).toMatchObject(expected);
      expect((await front.call("POST", "/api/echo", { ...forged, "content-type": "text/plain", "content-length": "5" }, "hello")).json).toMatchObject(expected);
      // a chunked body (the size limit wraps it)
      expect((await front.call("POST", "/api/echo", { ...forged, "content-type": "text/plain", "transfer-encoding": "chunked" }, [Buffer.from("he"), Buffer.from("llo")])).json).toMatchObject(expected);
      // the installation's own reverse proxy still names the client
      const viaProxy = await front.call("POST", "/api/echo", { "x-test-peer": "10.9.0.5", "x-forwarded-for": "198.51.100.7", "content-length": "2" }, "hi");
      expect(viaProxy.json).toMatchObject({ xff: "198.51.100.7", ip: "198.51.100.7" });
      // …as the nearest hop the proxy saw, not a first hop the client wrote itself (rate limits, IP allowlists)
      const chained = await front.call("GET", "/api/echo", { "x-test-peer": "10.9.0.5", "x-forwarded-for": "10.0.0.1, 198.51.100.8" });
      expect(chained.json).toMatchObject({ ip: "198.51.100.8" });
    } finally {
      await front.close();
    }
  });

  it("limits the first-run setup per client address: no shared «local» bucket, no escape with a new X-Real-IP", async () => {
    resetRateLimits();
    const dir = temp();
    const file = join(dir, "kariz.json");
    const c0 = defaultConfig(dir);
    ensureSecrets(c0);
    saveServerConfig(file, c0);
    issueSetupToken(file);
    const current = loadServerConfig(file, {}).config;
    const setup = setupRoutes({ file, config: () => current, reload: () => undefined, restart: () => undefined, api: new Hono(), db: {} as Db, log }, async () => false);
    const front = await serveFront(new Hono(), () => current, setup);
    try {
      const attempt = (peer: string, spoof?: string) =>
        front.call("POST", "/api/setup/complete", { "x-test-peer": peer, "content-type": "application/json", "content-length": "2", ...(spoof ? { "x-real-ip": spoof } : {}) }, "{}");
      for (let i = 0; i < 30; i++) expect((await attempt("198.51.100.20", `10.66.${i}.1`)).status).not.toBe(429);
      // a new forged address each time does not reset the count
      expect((await attempt("198.51.100.20", "10.66.200.1")).status).toBe(429);
      // somebody else on the LAN (sending no X-Real-IP at all) is not locked out
      expect((await attempt("198.51.100.21")).status).not.toBe(429);
    } finally {
      await front.close();
      resetRateLimits();
    }
  });
});

describe("request bodies before authentication", () => {
  const config = () => {
    const c = defaultConfig(temp());
    c.uploads.request_max_mb = 1;
    return c;
  };

  it("answers an unauthenticated upload without first reading its (chunked) body into memory", async () => {
    const c = config();
    const api = new Hono();
    api.post("/api/o/x/attachments", (cc) => cc.json({ error: { code: "unauthorized" } }, 401));
    const front = await serveFront(api, () => c);
    try {
      // the body never ends: an answer can only come from a front that did not wait for it
      const r = await withTimeout(front.call("POST", "/api/o/x/attachments", { "x-test-peer": "203.0.113.50", "transfer-encoding": "chunked" }, [Buffer.alloc(64 * 1024, 1)], false), 3000);
      expect(r).not.toBe("timeout");
      expect((r as { status: number }).status).toBe(401);
    } finally {
      await front.close();
    }
  });

  it("checks the setup token of a certificate upload before reading the upload", async () => {
    resetRateLimits();
    const dir = temp();
    const file = join(dir, "kariz.json");
    const c0 = defaultConfig(dir);
    ensureSecrets(c0);
    saveServerConfig(file, c0);
    issueSetupToken(file);
    const current = loadServerConfig(file, {}).config;
    let users = false;
    const setup = setupRoutes({ file, config: () => current, reload: () => undefined, restart: () => undefined, api: new Hono(), db: {} as Db, log }, async () => users);
    const front = await serveFront(new Hono(), () => current, setup);
    try {
      const upload = (headers: Record<string, string>) =>
        withTimeout(front.call("POST", "/api/setup/certificate", { "x-test-peer": "203.0.113.51", "content-type": "multipart/form-data; boundary=x", "transfer-encoding": "chunked", ...headers }, [Buffer.from("--x\r\n")], false), 3000);
      const noToken = await upload({});
      expect(noToken).not.toBe("timeout");
      expect((noToken as { status: number }).status).toBe(403);
      const wrong = await upload({ "x-setup-token": "not-the-token-123" });
      expect((wrong as { status: number }).status).toBe(403);
      users = true;
      const after = await upload({ "x-setup-token": "anything" });
      expect((after as { status: number }).status).toBe(403);
    } finally {
      await front.close();
      resetRateLimits();
    }
  });

  it("still refuses a body over the limit, declared or chunked, with 413", async () => {
    const c = config();
    const api = new Hono();
    api.post("/api/echo", async (cc) => cc.json({ n: (await cc.req.arrayBuffer()).byteLength }));
    const front = await serveFront(api, () => c);
    try {
      expect((await front.call("POST", "/api/echo", { "content-length": String(2 * 1048576) }, Buffer.alloc(0) as unknown as string)).status).toBe(413);
      const chunks = Array.from({ length: 4 }, () => Buffer.alloc(512 * 1024, 7));
      expect((await front.call("POST", "/api/echo", { "transfer-encoding": "chunked" }, chunks)).status).toBe(413);
      expect((await front.call("POST", "/api/echo", { "transfer-encoding": "chunked" }, [Buffer.alloc(1000, 1)])).json).toEqual({ n: 1000 });
    } finally {
      await front.close();
    }
    const tooLong = new Request("http://x/", { method: "POST", body: new Blob([new Uint8Array(20)]).stream().pipeThrough(byteLimit(10, "بزرگ")), duplex: "half" } as RequestInit);
    await expect(tooLong.arrayBuffer()).rejects.toBeInstanceOf(PayloadTooLarge);
  });
});

// ------------------------------------------------------------------------------------------------------------------

/** A non-loopback IPv4 address of this machine (the guard admits loopback without a look). */
const lanAddress = Object.values(os.networkInterfaces())
  .flat()
  .find((a) => a && a.family === "IPv4" && !a.internal)?.address;

describe("socket guard and SMTP by name", () => {
  const saved = { resolve4: dns.Resolver.prototype.resolve4, resolve6: dns.Resolver.prototype.resolve6, addresses: guardDns.addresses };
  afterEach(() => {
    dns.Resolver.prototype.resolve4 = saved.resolve4;
    dns.Resolver.prototype.resolve6 = saved.resolve6;
    guardDns.addresses = saved.addresses;
    uninstallSocketGuard();
  });

  it.skipIf(!lanAddress)("sends through nodemailer to a mail server allowlisted by name that has a single address", async () => {
    const ip = lanAddress!;
    // a minimal SMTP server on this machine's LAN address
    const smtp = net.createServer((sock) => {
      sock.write("220 mail.bank.test ESMTP\r\n");
      let buf = "";
      sock.on("data", (d) => {
        buf += d.toString("utf8");
        let i: number;
        while ((i = buf.indexOf("\r\n")) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (/^(EHLO|HELO)/i.test(line)) sock.write("250-mail.bank.test\r\n250 OK\r\n");
          else if (/^QUIT/i.test(line)) sock.end("221 bye\r\n");
          else sock.write("250 OK\r\n");
        }
      });
      sock.on("error", () => undefined);
    });
    await new Promise<void>((ok) => smtp.listen(0, ip, ok));
    const port = (smtp.address() as net.AddressInfo).port;
    // the DNS answers mail.bank.test with that one address (nodemailer asks the DNS servers itself)
    const answer = (addr: string | null) =>
      function (this: dns.Resolver, host: string, ...rest: unknown[]) {
        const cb = rest[rest.length - 1] as (err: NodeJS.ErrnoException | null, list: string[]) => void;
        if (host === "mail.bank.test" && addr) return void process.nextTick(() => cb(null, [addr]));
        const e = Object.assign(new Error("not found"), { code: dns.NOTFOUND }) as NodeJS.ErrnoException;
        process.nextTick(() => cb(e, []));
      };
    dns.Resolver.prototype.resolve4 = answer(ip) as never;
    dns.Resolver.prototype.resolve6 = answer(null) as never;
    const refused: string[] = [];
    installSocketGuard({ lan: true, airGapped: true, allow: ["mail.bank.test"] }, { onRefused: (h, p) => refused.push(`${h}:${p}`) });
    try {
      const t = nodemailer.createTransport({ host: "mail.bank.test", port, secure: false, ignoreTLS: true, connectionTimeout: 5000, greetingTimeout: 5000, tls: { servername: "mail.bank.test" } });
      await expect(t.verify()).resolves.toBe(true);
      t.close();
      expect(refused).toEqual([]);
      // the same address under a name it does not belong to stays refused (the guard asks the DNS itself)
      guardDns.addresses = async () => ["10.255.255.9"];
      const t2 = nodemailer.createTransport({ host: "mail.bank.test", port, secure: false, ignoreTLS: true, connectionTimeout: 5000, greetingTimeout: 5000 });
      await expect(t2.verify()).rejects.toThrow(/air-gapped/);
      t2.close();
      expect(refused).toEqual([`${ip}:${port}`]);
    } finally {
      smtp.close();
    }
  });

  it("refuses an address presented with an allowed server name that does not resolve to it", async () => {
    guardDns.addresses = async (name) => (name === "mail.bank.test" ? ["10.20.0.25"] : []);
    const refused: string[] = [];
    installSocketGuard({ lan: true, airGapped: true, allow: ["mail.bank.test"] }, { onRefused: (h) => refused.push(h) });
    const code = await new Promise<string>((resolve) => {
      const s = net.connect({ host: "203.0.113.77", port: 25, servername: "mail.bank.test" } as net.NetConnectOpts);
      s.on("error", (e: NodeJS.ErrnoException) => resolve(e.code ?? e.message));
      s.on("connect", () => {
        s.destroy();
        resolve("connected");
      });
    });
    expect(code).toBe("EAIRGAP");
    expect(refused).toEqual(["203.0.113.77"]);
  });
});

// ------------------------------------------------------------------------------------------------------------------

const ORG = "6f0a3c2e-1d4b-4e5f-8a9b-0c1d2e3f4a5b";
const sha = (ch: string) => ch.repeat(64);
const putBlob = (root: string, org: string, s: string, data = "x") => {
  mkdirSync(join(root, org, s.slice(0, 2)), { recursive: true });
  writeFileSync(join(root, org, s.slice(0, 2), s), data);
};

describe("backups: verification and retries", () => {
  it("counts an attachment row without content anywhere as orphaned, never as a verification failure", async () => {
    const live = temp();
    const mirror = temp();
    putBlob(live, ORG, sha("a"));
    putBlob(live, ORG, sha("b"));
    await mirrorBlobs(live, mirror);
    // a: mirrored; c: never uploaded (refused, quarantined); b removed from the mirror afterwards: a real gap
    rmSync(join(mirror, ORG, "bb", sha("b")));
    const audit = mirrorAudit([{ org_id: ORG, sha256: sha("a") }, { org_id: ORG, sha256: sha("b") }, { org_id: ORG, sha256: sha("c") }], live, mirror);
    expect(audit).toEqual({ missing: 1, orphaned: 1 });
    expect(mirrorAudit([{ org_id: ORG, sha256: sha("a") }, { org_id: ORG, sha256: sha("c") }], live, mirror)).toEqual({ missing: 0, orphaned: 1 });
  });

  it("mirrors only the store's own layout (no other file is read or planted, as SYSTEM or administrator)", async () => {
    const live = temp();
    const mirror = temp();
    putBlob(live, ORG, sha("d"));
    writeFileSync(join(live, "evil.dll"), "MZ");
    mkdirSync(join(live, "System32"), { recursive: true });
    writeFileSync(join(live, "System32", "version.dll"), "MZ");
    mkdirSync(join(live, ORG, "dd"), { recursive: true });
    writeFileSync(join(live, ORG, "dd", "notes.txt"), "x");
    const r = await mirrorBlobs(live, mirror);
    expect(r.copied).toBe(1);
    expect(existsSync(join(mirror, ORG, "dd", sha("d")))).toBe(true);
    expect(existsSync(join(mirror, "evil.dll"))).toBe(false);
    expect(existsSync(join(mirror, "System32"))).toBe(false);
    expect(existsSync(join(mirror, ORG, "dd", "notes.txt"))).toBe(false);
  });

  it("holds a failed automatic backup back by a growing pause instead of retrying every minute", async () => {
    const c = defaultConfig(temp());
    c.backup.dir = join(c.dirs.data, "backups");
    c.backup.time = "01:30";
    const day = (h: number, m = 0) => new Date(2026, 10, 4, h, m);
    expect(backupDue(c, day(1, 31))).toBe(true);
    // two failures in a row (no PostgreSQL programs here): recorded with their count
    await expect(backupNow({ config: c, label: "auto", bin: join(temp(), "missing-bin") })).rejects.toThrow();
    expect(lastBackup(c)).toMatchObject({ ok: false, label: "auto", failures: 1 });
    await expect(backupNow({ config: c, label: "auto", bin: join(temp(), "missing-bin") })).rejects.toThrow();
    const st = lastBackup(c)!;
    expect(st).toMatchObject({ ok: false, failures: 2 });
    const failedAt = new Date(st.at);
    expect(nextBackupRetry(c)).toBe(new Date(failedAt.getTime() + retryPauseMs(2)).toISOString());
    // pretend the failures happened today at 02:00: two failures → a two-hour pause
    writeFileSync(join(c.dirs.data, "last-backup.json"), JSON.stringify({ ...st, at: day(2).toISOString() }));
    expect(backupDue(c, day(2, 1))).toBe(false);
    expect(backupDue(c, day(3, 59))).toBe(false);
    expect(backupDue(c, day(4, 1))).toBe(true);
    // a failure before today's time never holds back the daily try
    writeFileSync(join(c.dirs.data, "last-backup.json"), JSON.stringify({ ...st, at: new Date(2026, 10, 3, 23, 0).toISOString(), failures: 5 }));
    expect(backupDue(c, day(1, 31))).toBe(true);
    expect(retryPauseMs(1)).toBe(3600_000);
    expect(retryPauseMs(9)).toBe(16 * 3600_000);
  });
});

// ------------------------------------------------------------------------------------------------------------------

describe("karizctl takes no program or folder to delete from kariz.json", () => {
  const env = { ITSM_PG_BIN: process.env.ITSM_PG_BIN, ITSM_INSTALL_DIR: process.env.ITSM_INSTALL_DIR };
  beforeEach(() => {
    delete process.env.ITSM_PG_BIN;
    delete process.env.ITSM_INSTALL_DIR;
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("finds PostgreSQL's programs in the installation folder, never in kariz.json's pg_bin", async () => {
    expect(trustedPgBin(parseArgs(["backup"]), {}, join("/opt", "kariz", "app", "karizctl.cjs"))).toBe(join("/opt", "kariz", "pgsql", "bin"));
    expect(trustedPgBin(parseArgs(["backup"]), { ITSM_INSTALL_DIR: "/srv/kariz" }, "/x/app/karizctl.cjs")).toBe(join("/srv/kariz", "pgsql", "bin"));
    expect(trustedPgBin(parseArgs(["backup", "--pg-bin", "/usr/lib/postgresql/16/bin"]), {}, "/x")).toBe("/usr/lib/postgresql/16/bin");

    // the application's account wrote pg_bin into kariz.json and planted a pg_dump there
    const dir = temp();
    const file = join(dir, "kariz.json");
    const evil = join(dir, "blobs", "x");
    mkdirSync(evil, { recursive: true });
    const marker = join(dir, "ran-as-admin");
    for (const name of ["pg_dump", "pg_dump.exe", "pg_restore", "pg_restore.exe"]) {
      writeFileSync(join(evil, name), `#!/bin/sh\necho owned > "${marker}"\n`);
      chmodSync(join(evil, name), 0o755);
    }
    const c = defaultConfig(dir);
    ensureSecrets(c);
    c.pg_bin = evil;
    saveServerConfig(file, c);
    process.env.ITSM_INSTALL_DIR = temp(); // the real installation: no pg_dump in this test
    const err = process.stderr.write;
    const out = process.stdout.write;
    process.stderr.write = (() => true) as never;
    process.stdout.write = (() => true) as never;
    try {
      expect(await ctl(["backup", "--config", file])).toBe(1);
    } finally {
      process.stderr.write = err;
      process.stdout.write = out;
    }
    expect(existsSync(marker)).toBe(false);
  });

  it("purges only the configuration file's own folder", async () => {
    const dir = temp();
    const victim = temp();
    writeFileSync(join(victim, "keep.txt"), "x");
    const file = join(dir, "kariz.json");
    const c = defaultConfig(dir);
    ensureSecrets(c);
    saveServerConfig(file, c);
    // the application's account points dirs.data elsewhere
    const raw = JSON.parse(readFileSync(file, "utf8"));
    raw.dirs.data = victim;
    writeFileSync(file, JSON.stringify(raw));
    const err = process.stderr.write;
    process.stderr.write = (() => true) as never;
    try {
      expect(await ctl(["purge", "--yes", "--config", file])).toBe(2);
    } finally {
      process.stderr.write = err;
    }
    expect(existsSync(join(victim, "keep.txt"))).toBe(true);
    expect(existsSync(file)).toBe(true);
  });
});
