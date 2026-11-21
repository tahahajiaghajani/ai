// The Windows app's start (docs/PERFORMANCE_FA.md §17): a first start loads the database made at build time
// (src/desktop/db-template.ts) instead of running initdb and every migration, and ends with the same database; a
// template that does not load falls back to the old way; the local server keeps the build's hashed files in the window's
// cache and revalidates the rest; the start's parts are logged on one line for desktop-e2e; and before the database opens
// the server tells the Electron main process what the open faces (§22: the main process then waits for it as long as it
// takes), and app.log says what pg_control says about the last close — or why that cannot be told.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { brotliDecompressSync } from "node:zlib";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import "./fixtures/module";
import { makeServer, Client } from "./helpers";
import { startLocal, desktopCacheControl, type LocalServer, type StartPhase } from "@local/server";
import { buildDbTemplate, DB_TEMPLATE_FILE, templateEntries } from "@local/db-template";
import { controlState, inspectDatabase, needsRecovery, readControl } from "@local/db-open";
import { backupNow, scheduleRestore } from "@local/backup";
import { MIGRATIONS } from "@server/db/migrations";
import type { Logger } from "@server/context";

const root = mkdtempSync(join(tmpdir(), "itsm-start-"));
const staticDir = join(root, "renderer");
const templateFile = join(root, DB_TEMPLATE_FILE);
let built: Awaited<ReturnType<typeof buildDbTemplate>>;

function capture(): Logger & { lines: string[] } {
  const lines: string[] = [];
  const put = (m: string, d?: unknown) => lines.push(`${m}${d === undefined ? "" : ` ${typeof d === "string" ? d : JSON.stringify(d)}`}`);
  return { lines, info: put, warn: put, error: put };
}

/** Every table, column, index, trigger and function of a database: two databases with the same schema give the same text. */
async function catalog(q: (sql: string) => Promise<{ x: string }[]>): Promise<string> {
  const parts = await Promise.all([
    q(`select string_agg(table_name || '.' || column_name || ':' || data_type || ':' || coalesce(column_default, ''), '|' order by table_name, ordinal_position) as x from information_schema.columns where table_schema = 'public'`),
    q(`select string_agg(indexname || ':' || indexdef, '|' order by indexname) as x from pg_indexes where schemaname = 'public'`),
    q(`select string_agg(event_object_table || '.' || trigger_name || ':' || event_manipulation, '|' order by event_object_table, trigger_name, event_manipulation) as x from information_schema.triggers`),
    q(`select string_agg(p.proname || ':' || md5(p.prosrc), '|' order by p.proname, md5(p.prosrc)) as x from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`),
    q(`select string_agg(id, ',' order by id) as x from sm_migrations`),
    q(`select string_agg(key || '=' || value, ',' order by key) as x from sm_meta where key like 'engine.ddl%'`),
  ]);
  return parts.map((r) => r[0]?.x ?? "").join("\n");
}

beforeAll(async () => {
  mkdirSync(join(staticDir, "assets"), { recursive: true });
  writeFileSync(join(staticDir, "index.html"), `<!doctype html><html><head><script type="module" src="/assets/index-abc123.js"></script></head><body><div id="root"></div></body></html>`);
  writeFileSync(join(staticDir, "assets", "index-abc123.js"), "console.log('kariz')");
  mkdirSync(join(staticDir, "fonts"), { recursive: true });
  writeFileSync(join(staticDir, "fonts", "font.woff2"), "font");
  built = await buildDbTemplate(templateFile);
}, 600_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("the first start's database made at build time", () => {
  it("is small: the data folder without the log's recycled segments, PG_VERSION last", () => {
    expect(built.steps).toBeGreaterThan(20);
    expect(built.bytes).toBeLessThan(9 * 1024 * 1024);
    expect(built.segments_dropped).toBeGreaterThan(0);
    // the tar's entries: one log segment (the shutdown checkpoint's), and PG_VERSION as the last file unpacked
    const tar = brotliDecompressSync(readFileSync(templateFile));
    const names: string[] = [];
    for (let off = 0; off + 512 <= tar.length; ) {
      const name = tar.subarray(off, off + 100).toString("ascii").replace(/\0.*$/s, "");
      if (!name) break;
      const size = parseInt(tar.subarray(off + 124, off + 136).toString("ascii").replace(/\0.*$/s, "").trim() || "0", 8);
      names.push(name);
      off += 512 + Math.ceil(size / 512) * 512;
    }
    expect(names.filter((n) => /^pg_wal\/[0-9A-F]{24}$/.test(n))).toHaveLength(1);
    expect(names.at(-1)).toBe("PG_VERSION");
    expect(names).toContain("postgresql.auto.conf");
    expect(names.some((n) => n.startsWith("base/"))).toBe(true);
  });

  it("a first start loads it, runs no migration, and ends with the database the migrations make", async () => {
    const fromTemplate = join(root, "data-template");
    const fromScratch = join(root, "data-scratch");
    const logT = capture();
    const a = await startLocal({ dataDir: fromTemplate, staticDir, port: 0, log: logT, template: templateFile });
    try {
      const line = logT.lines.find((l) => l.startsWith("local server on"))!;
      expect(line).toMatch(/\(database \d+ ms from the template, migrations \d+ ms, ready \d+ ms, process \d+ ms\)$/);
      expect(logT.lines.filter((l) => /migration \S+ applied|schema step \S+ applied/.test(l))).toEqual([]);
      // the first start says how many files it wrote and how long it took (app.log)
      const files = templateEntries(readFileSync(templateFile)).filter((e) => !e.dir).length;
      expect(files).toBeGreaterThan(500);
      expect(logT.lines.find((l) => l.startsWith("database template:"))).toMatch(new RegExp(`^database template: ${files} files \\(\\d+\\.\\d MB\\) written in \\d+ ms$`));
      const health = await (await fetch(`${a.url}/api/health`)).json();
      expect(health.ok).toBe(true);
      expect(health.schema.complete).toBe(true);
    } finally {
      await a.close();
    }
    // a first start without a template: initdb and every migration
    const logS = capture();
    const b = await startLocal({ dataDir: fromScratch, staticDir, port: 0, log: logS });
    try {
      expect(logS.lines.find((l) => l.startsWith("local server on"))).not.toMatch(/from the template/);
      expect(logS.lines.some((l) => /migration \S+ applied/.test(l))).toBe(true);
    } finally {
      await b.close();
    }
    // the same schema: every table, column, index, trigger and function, the migrations and the engine's DDL version
    const { createPgliteDb } = await import("@server/db/pglite");
    const digest = async (dir: string) => {
      const db = await createPgliteDb({ dataDir: join(dir, "db"), wal: false });
      try {
        return await catalog((q) => db.query<{ x: string }>(q));
      } finally {
        await db.close();
      }
    };
    const t = await digest(fromTemplate);
    expect(t.length).toBeGreaterThan(100_000);
    expect(t).toBe(await digest(fromScratch));
  });

  it("a later start never loads it again, and a start cut short while unpacking it starts over", async () => {
    const dir = join(root, "data-later");
    const first = capture();
    const s1 = await startLocal({ dataDir: dir, staticDir, port: 0, log: first, template: templateFile });
    const org = await (await fetch(`${s1.url}/api/health`)).json();
    expect(org.ok).toBe(true);
    await s1.close();
    const later = capture();
    const s2 = await startLocal({ dataDir: dir, staticDir, port: 0, log: later, template: templateFile });
    await s2.close();
    expect(later.lines.find((l) => l.startsWith("local server on"))).not.toMatch(/from the template/);
    // a folder an interrupted first start left: files, but no PG_VERSION (it is unpacked last)
    const cut = join(root, "data-cut");
    mkdirSync(join(cut, "db", "base", "5"), { recursive: true });
    writeFileSync(join(cut, "db", "base", "5", "1249"), "half");
    const log = capture();
    const s3 = await startLocal({ dataDir: cut, staticDir, port: 0, log, template: templateFile });
    try {
      expect(log.lines.find((l) => l.startsWith("local server on"))).toMatch(/from the template/);
      expect((await (await fetch(`${s3.url}/api/health`)).json()).ok).toBe(true);
    } finally {
      await s3.close();
    }
  });

  it("refuses a template that would write outside its folder or leave PG_VERSION before the rest", async () => {
    const { packEntries, templateEntries } = await import("@local/db-template");
    const v = { name: "PG_VERSION", data: Buffer.from("17\n") };
    expect(templateEntries(packEntries([{ name: "base", dir: true }, { name: "base/1", data: Buffer.from("x") }, v])).map((e) => e.name)).toEqual(["base", "base/1", "PG_VERSION"]);
    for (const name of ["../escape", "base/../../escape", "/etc/escape", "C:/escape", "base\\escape", "./x"]) {
      expect(() => templateEntries(packEntries([{ name, data: Buffer.from("x") }, v])), name).toThrow(/unexpected path/);
    }
    expect(() => templateEntries(packEntries([v, { name: "base/1", data: Buffer.from("x") }]))).toThrow(/incomplete/);
    expect(() => templateEntries(Buffer.from("not brotli"))).toThrow();
  });

  it("a template that does not load leaves the old way: initdb and every migration", async () => {
    const broken = join(root, "broken.tar.br");
    writeFileSync(broken, Buffer.from("not a tarball at all"));
    const dir = join(root, "data-broken");
    const log = capture();
    const s = await startLocal({ dataDir: dir, staticDir, port: 0, log, template: broken });
    try {
      expect(log.lines.some((l) => l.startsWith("the database template did not load"))).toBe(true);
      expect(log.lines.find((l) => l.startsWith("local server on"))).not.toMatch(/from the template/);
      expect(log.lines.some((l) => /migration \S+ applied/.test(l))).toBe(true);
      expect((await (await fetch(`${s.url}/api/health`)).json()).ok).toBe(true);
      expect(existsSync(join(dir, "db", "PG_VERSION"))).toBe(true);
    } finally {
      await s.close();
    }
  });
});

describe("a first start from the template links to the web version like any first start", () => {
  const EMAIL = "template-owner@example.com";
  const PASSWORD = "template-pass-1405";
  const http = (base: string) => new Client({ fetch: (r: Request) => fetch(r) }, base);
  /** What a closed local database holds (PGlite opened on its folder, as the next start opens it). */
  async function inside<T>(dir: string, read: (q: <R>(sql: string, params?: unknown[]) => Promise<R[]>) => Promise<T>): Promise<T> {
    const { createPgliteDb } = await import("@server/db/pglite");
    const db = await createPgliteDb({ dataDir: join(dir, "db"), wal: false });
    try {
      return await read((sql, params) => db.query(sql, params));
    } finally {
      await db.close();
    }
  }

  it("holds every migration (0100 in desktop mode) and no cursor or upload; its first pull reads everything, then follows the server's snapshot", async () => {
    // the web version, with an organisation and a record from before this computer was set up
    const web = await makeServer({ mode: "cloud" });
    let url = "";
    let srv: ReturnType<typeof serve> | null = null;
    await new Promise<void>((ok) => {
      srv = serve({ fetch: web.app.fetch, port: 0, hostname: "127.0.0.1" }, (info: AddressInfo) => {
        url = `http://127.0.0.1:${info.port}`;
        ok();
      });
    });
    const dir = join(root, "data-linked");
    let s: LocalServer | null = null;
    try {
      const cloud = http(url);
      await cloud.post("/auth/signup", { email: EMAIL, password: PASSWORD, full_name: "مالک ابری" });
      const org = (await cloud.post<{ id: string }>("/orgs", { name: "سازمان قالب", timezone: "Asia/Tehran" })).id;
      await cloud.post(`/o/${org}/data/test_item`, { name: "قلم پیش از نصب" });
      // the first start: from the database made at build time
      const log = capture();
      s = await startLocal({ dataDir: dir, staticDir, port: 0, log, template: templateFile });
      expect(log.lines.find((l) => l.startsWith("local server on"))).toMatch(/from the template/);
      await s.close();
      s = null;
      // every migration of this build, 0100_xid_revisions in desktop mode (its trigger records local writes in the
      // outbox, nothing was restamped), and nothing of a sync: no cursor, nothing to upload, no pull session under way
      await inside(dir, async (q) => {
        expect((await q<{ id: string }>(`select id from sm_migrations`)).map((r) => r.id)).toEqual(expect.arrayContaining(MIGRATIONS.map((m) => m.id)));
        expect(await q(`select key from sm_kv where key like 'sync.%'`)).toEqual([]);
        expect(await q(`select 1 from sm_outbox`)).toEqual([]);
        expect(await q(`select 1 from sm_sync_seen`)).toEqual([]);
        expect(await q(`select 1 from sm_org_sync`)).toEqual([]);
      });
      // linked: the first pull is a session from nothing and brings the organisation
      s = await startLocal({ dataDir: dir, staticDir, port: 0, log: capture(), template: templateFile });
      const desk = http(s.url);
      expect((await desk.post("/local/cloud/link", { url, email: EMAIL, password: PASSWORD, org_id: org, direction: "download" })).ok).toBe(true);
      await desk.post("/auth/login", { email: EMAIL, password: PASSWORD });
      expect((await desk.get(`/o/${org}/data/test_item?q=پیش از نصب`)).total).toBe(1);
      // then both ways from the cursor: a write here goes up through the outbox, a change on the web comes down
      await desk.post(`/o/${org}/data/test_item`, { name: "قلم ویندوز از قالب" });
      await desk.post("/local/sync");
      expect((await cloud.get(`/o/${org}/data/test_item?q=ویندوز از قالب`)).total).toBe(1);
      await cloud.post(`/o/${org}/data/test_item`, { name: "قلم وب پس از پیوند" });
      await desk.post("/local/sync");
      expect((await desk.get(`/o/${org}/data/test_item?q=پس از پیوند`)).total).toBe(1);
      await s.close();
      s = null;
      // the cursor kept is the server's snapshot of the last complete pull (protocol 16), the outbox is empty, and the
      // server's record of this computer follows it
      await inside(dir, async (q) => {
        const [since] = await q<{ value: unknown }>(`select value from sm_kv where key = 'sync.since'`);
        expect(String(since?.value)).toMatch(/^\d+:\d+:[\d,]*$/);
        expect(await q(`select 1 from sm_outbox`)).toEqual([]);
      });
      const device = await web.db.one<{ cursor: string }>(`select cursor::text as cursor from sm_devices where org_id = $1`, [org]);
      expect(Number(device?.cursor)).toBeGreaterThan(0);
    } finally {
      await s?.close();
      await new Promise<void>((r) => (srv ? srv.close(() => r()) : r()));
      await web.db.close();
    }
  }, 600_000);
});

describe("the app's files in the window's cache", () => {
  it("keeps the build's hashed files for good and revalidates the rest", async () => {
    expect(desktopCacheControl("/assets/index-abc123.js")).toBe("public, max-age=31536000, immutable");
    expect(desktopCacheControl("/")).toBe("no-cache");
    expect(desktopCacheControl("/index.html")).toBe("no-cache");
    expect(desktopCacheControl("/fonts/ds/AradVF.woff2")).toBe("no-cache");
    const s = await startLocal({ dataDir: join(root, "data-static"), staticDir, port: 0, memory: true, log: capture() });
    try {
      const asset = await fetch(`${s.url}/assets/index-abc123.js`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(asset.headers.get("content-type")).toMatch(/javascript/);
      expect(await asset.text()).toBe("console.log('kariz')");
      // the app's page: revalidated by its tag (an update of the app replaces it under the same name)
      const page = await fetch(`${s.url}/incidents/123`);
      expect(page.status).toBe(200);
      expect(page.headers.get("cache-control")).toBe("no-cache");
      const tag = page.headers.get("etag");
      expect(tag).toBeTruthy();
      expect(await page.text()).toContain('<div id="root">');
      expect((await fetch(`${s.url}/`, { headers: { "if-none-match": tag! } })).status).toBe(304);
      const font = await fetch(`${s.url}/fonts/font.woff2`);
      expect(font.headers.get("cache-control")).toBe("no-cache");
      // a file the build does not have is a 404, never the page in its place; the API keeps its own 404
      const missing = await fetch(`${s.url}/assets/index-old.js`);
      expect(missing.status).toBe(404);
      expect(missing.headers.get("content-type")).not.toMatch(/html/);
      const api = await fetch(`${s.url}/api/nothing-here`);
      expect(api.status).toBe(404);
      expect((await api.json()).error.code).toBe("not_found");
      // never outside the folder
      expect((await fetch(`${s.url}/assets/..%2f..%2fdata-static%2fconfig.json`)).status).not.toBe(200);
    } finally {
      await s.close();
    }
  });
});

describe("the window's cache filled once per version (desktop/src/main.ts)", () => {
  it("asks for every hashed file of the build once, two at a time, at low priority, reading each to the end", async () => {
    const { warmable, warmScript } = await import("../desktop/src/warm");
    expect(warmable(["index-abc.js", "style-1.css", "font.woff2", "x.js.map", "../evil.js", "a/b.js"])).toEqual(["index-abc.js", "style-1.css"]);
    const files = Array.from({ length: 9 }, (_, i) => `chunk-${i}.js`);
    const asked: { url: string; priority: string | undefined }[] = [];
    let inFlight = 0;
    let most = 0;
    let bodies = 0;
    const fetch = async (url: string, init: { priority?: string }) => {
      asked.push({ url, priority: init?.priority });
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      const ok = url !== "/assets/chunk-4.js";
      return { ok, arrayBuffer: async () => (bodies++, new ArrayBuffer(1)) };
    };
    const { runInNewContext } = await import("node:vm");
    const read = await runInNewContext(warmScript(files), { fetch, Promise, Array, JSON });
    expect(asked.map((a) => a.url).sort()).toEqual(files.map((f) => `/assets/${f}`).sort());
    expect(asked.every((a) => a.priority === "low")).toBe(true);
    expect(most).toBe(2);
    // a file that is not there is not counted: the version is remembered only when every file was read
    expect(read).toBe(8);
    expect(bodies).toBe(8);
  });
});

// The database's open is the one part of the start the server cannot report on while it runs: PGlite opens it
// synchronously on the server's only thread, and a database that was not closed cleanly first replays its write-ahead log
// (minutes for gigabytes). So the server says before it begins what the open faces, and the Electron main process waits
// for it as long as it takes (src/shared/desktop/ready-watch.ts, tests/desktop-ready-watch.test.ts).
describe("the server tells the Windows app before its database opens (§22)", () => {
  /** pg_wal's size in MB as the test measures it: the sum of its files. */
  const walOnDisk = (db: string) => Math.round(readdirSync(join(db, "pg_wal"), { withFileTypes: true }).filter((e) => e.isFile()).reduce((n, e) => n + statSync(join(db, "pg_wal", e.name)).size, 0) / (1024 * 1024));
  /** Another process runs `sql` on the folder's database and is killed: it exits without closing it (no shutdown checkpoint). */
  const leaveOpen = (db: string, sql: string) => {
    const pglite = createRequire(import.meta.url).resolve("@electric-sql/pglite");
    const writer = `const { PGlite } = require(process.argv[1]);
      (async () => {
        const pg = new PGlite(process.argv[2]);
        await pg.waitReady;
        await pg.exec(process.argv[3]);
        process.exit(0);
      })().catch((e) => { console.error(e); process.exit(2); });`;
    execFileSync(process.execPath, ["-e", writer, pglite, db, sql], { stdio: "pipe", timeout: 120_000 });
  };
  /** A data folder with a database a first start made (from the template) and closed cleanly. */
  const closedCleanly = async (name: string) => {
    const dir = join(root, name);
    const s = await startLocal({ dataDir: dir, staticDir, port: 0, log: capture(), template: templateFile });
    await s.close();
    return { dir, db: join(dir, "db") };
  };

  it("reports the database phase with the size of its write-ahead log before PGlite touches the folder, then the migrations", async () => {
    const dir = join(root, "data-phases");
    // a first start: a new database, nothing to replay
    const phases1: StartPhase[] = [];
    const first = capture();
    const s1 = await startLocal({ dataDir: dir, staticDir, port: 0, log: first, template: templateFile, onPhase: (p) => phases1.push(p) });
    await s1.close();
    expect(phases1).toEqual([{ phase: "database", walMb: 0, recovery: null }, { phase: "migrations" }]);
    expect(first.lines).toContain("opening the database: write-ahead log 0 MB; no database yet");
    // a later start: the log measured with fs, the database closed cleanly
    const db = join(dir, "db");
    const wal = walOnDisk(db);
    expect(wal).toBeGreaterThan(0);
    const control = readFileSync(join(db, "global", "pg_control"));
    const later = capture();
    const seen: { phase: StartPhase; untouched: boolean; lines: string[] }[] = [];
    const s2 = await startLocal({
      dataDir: dir,
      staticDir,
      port: 0,
      log: later,
      // PGlite rewrites the control file as it opens: the same bytes mean the open has not begun
      onPhase: (phase) => seen.push({ phase, untouched: readFileSync(join(db, "global", "pg_control")).equals(control), lines: [...later.lines] }),
    });
    await s2.close();
    expect(seen.map((s) => s.phase)).toEqual([{ phase: "database", walMb: wal, recovery: false }, { phase: "migrations" }]);
    expect(seen[0].untouched).toBe(true);
    expect(seen[1].untouched).toBe(false);
    // app.log: the open's line before the phase is told, its end before the migrations, then the start's own line
    expect(seen[0].lines.at(-1)).toBe(`opening the database: write-ahead log ${wal} MB; closed cleanly (state 1)`);
    expect(seen[1].lines.at(-1)).toMatch(/^database opened in \d+ ms$/);
    const at = (re: RegExp) => later.lines.findIndex((l) => re.test(l));
    expect(at(/^opening the database: /)).toBeLessThan(at(/^database opened in /));
    expect(at(/^database opened in /)).toBeLessThan(at(/^local server on /));
  });

  it("tells a database left open by a killed app (its log is replayed first), and opens it with everything written", async () => {
    const { dir, db } = await closedCleanly("data-killed");
    expect(inspectDatabase(db).recovery).toBe(false);
    // another process writes and is killed: it exits without closing the database (no shutdown checkpoint)
    leaveOpen(db, "create table kill_probe (id int primary key, note text); insert into kill_probe select g, repeat('k', 200) from generate_series(1, 20000) g");
    const left = inspectDatabase(db);
    expect(left.recovery).toBe(true);
    expect(left.walMb).toBe(walOnDisk(db));
    const log = capture();
    const phases: StartPhase[] = [];
    const s2 = await startLocal({ dataDir: dir, staticDir, port: 0, log, onPhase: (p) => phases.push(p) });
    try {
      expect(phases).toEqual([{ phase: "database", walMb: left.walMb, recovery: true }, { phase: "migrations" }]);
      expect(log.lines).toContain(`opening the database: write-ahead log ${left.walMb} MB; not closed cleanly (state 6), so its log is replayed first`);
      expect(left).toMatchObject({ state: 6, unknown: null });
      expect((await (await fetch(`${s2.url}/api/health`)).json()).ok).toBe(true);
    } finally {
      await s2.close();
    }
    // the replay brought back what the killed process wrote, and this close was clean
    expect(inspectDatabase(db)).toMatchObject({ recovery: false, state: 1, unknown: null });
    const { createPgliteDb } = await import("@server/db/pglite");
    const check = await createPgliteDb({ dataDir: db, wal: false });
    try {
      expect(await check.one<{ n: number }>(`select count(*)::int as n from kill_probe`)).toEqual({ n: 20000 });
    } finally {
      await check.close();
    }
  });

  it("says why it cannot tell how the database was closed (a control file cut to nothing), and tells the phase as unknown", async () => {
    const { dir, db } = await closedCleanly("data-control");
    writeFileSync(join(db, "global", "pg_control"), Buffer.alloc(0));
    const wal = walOnDisk(db);
    const log = capture();
    const phases: StartPhase[] = [];
    // PGlite cannot open a database without its control file: the start fails, after the line and the phase
    await expect(startLocal({ dataDir: dir, staticDir, port: 0, log, onPhase: (p) => phases.push(p) })).rejects.toThrow();
    expect(phases).toEqual([{ phase: "database", walMb: wal, recovery: null }]);
    // 1.1.3 wrote the line of a clean close here, the splash meanwhile treating a large log as a recovery
    expect(log.lines).toContain(`opening the database: write-ahead log ${wal} MB; state unknown (pg_control is 0 bytes), so a replay may come first`);
  });

  it("opens and inspects the current database when a scheduled restore's backup is missing, and tells its recovery", async () => {
    const { dir, db } = await closedCleanly("data-lost-backup");
    leaveOpen(db, "create table restore_probe (id int primary key, note text); insert into restore_probe select g, repeat('r', 200) from generate_series(1, 20000) g");
    const left = inspectDatabase(db);
    expect(left.recovery).toBe(true);
    expect(left.walMb).toBeGreaterThan(0);
    // a restore chosen from a USB drive that is gone by the next start
    writeFileSync(join(dir, "restore.pending"), join(root, "unplugged", "itsm-manual-20261121-101010.tar.gz"), "utf8");
    const log = capture();
    const phases: StartPhase[] = [];
    const s = await startLocal({ dataDir: dir, staticDir, port: 0, log, onPhase: (p) => phases.push(p) });
    try {
      // 1.1.3 skipped the inspection for any scheduled restore: { walMb: 0, recovery: null } and «restoring a backup»
      expect(phases).toEqual([{ phase: "database", walMb: left.walMb, recovery: true }, { phase: "migrations" }]);
      expect(phases[0]).not.toHaveProperty("restore");
      expect(log.lines).toContain("a restore was scheduled but its backup file is missing; the current database is opened");
      expect(log.lines).toContain(`opening the database: write-ahead log ${left.walMb} MB; not closed cleanly (state 6), so its log is replayed first`);
      expect(log.lines.filter((l) => l.includes("restoring a backup"))).toEqual([]);
      expect(existsSync(join(dir, "restore.pending"))).toBe(false);
      expect((await (await fetch(`${s.url}/api/health`)).json()).ok).toBe(true);
    } finally {
      await s.close();
    }
  });

  it("tells a scheduled restore as one, names its backup with its size, and takes the backup only once that is told", async () => {
    const { dir, db } = await closedCleanly("data-restore");
    const { createPgliteDb } = await import("@server/db/pglite");
    const open = await createPgliteDb({ dataDir: db, wal: false });
    mkdirSync(join(dir, "backups"), { recursive: true });
    const backup = await backupNow(open, join(dir, "backups"), "manual").finally(() => open.close());
    scheduleRestore(dir, backup.file);
    const log = capture();
    const phases: StartPhase[] = [];
    const atPhase: { marker: boolean; folder: boolean }[] = [];
    const onPhase = (p: StartPhase) => {
      phases.push(p);
      if (p.phase === "database") atPhase.push({ marker: existsSync(join(dir, "restore.pending")), folder: existsSync(join(db, "PG_VERSION")) });
    };
    const s = await startLocal({ dataDir: dir, staticDir, port: 0, log, onPhase });
    try {
      // the splash asks in a restore's own words before it closes (a restore cut short is not done again)
      expect(phases).toEqual([{ phase: "database", walMb: 0, recovery: null, restore: true }, { phase: "migrations" }]);
      // the backup is read and this folder set aside within the open, which the main process waits for as long as it
      // takes — not in the 90 s before it, where a large backup on a slow disk brought up «سرور داخلی برنامه هنوز پاسخ
      // نداده است» and an answer to it dropped the restore (its marker already gone)
      expect(atPhase).toEqual([{ marker: true, folder: true }]);
      expect(existsSync(join(dir, "restore.pending"))).toBe(false);
      expect(readdirSync(dir).filter((f) => f.startsWith("db-before-restore-"))).toHaveLength(1);
      expect(log.lines).toContain(`opening the database: restoring a backup (${basename(backup.file)}, ${Math.round(backup.size / (1024 * 1024))} MB)`);
      expect(log.lines.some((l) => l.startsWith("a restore was scheduled"))).toBe(false);
      expect((await (await fetch(`${s.url}/api/health`)).json()).ok).toBe(true);
    } finally {
      await s.close();
    }
  });
});

describe("pg_control read before the open (src/desktop/db-open.ts)", () => {
  /** A control file of `size` bytes with PG_CONTROL_VERSION `version` and DBState `state` where PostgreSQL keeps them. */
  const control = (version: number, state: number, size = 8192) => {
    const b = Buffer.alloc(size);
    if (size >= 12) b.writeUInt32LE(version, 8);
    if (size >= 20) b.writeUInt32LE(state, 16);
    return b;
  };

  it("counts only DB_SHUTDOWNED (1) as a clean close: PostgreSQL replays the log for every other state, 2 included", () => {
    const dir = join(root, "control-unit");
    mkdirSync(join(dir, "global"), { recursive: true });
    const file = join(dir, "global", "pg_control");
    // DB_SHUTDOWNED_IN_RECOVERY: 1.1.3 took it for a clean close, PostgreSQL 18 recovers (xlogrecovery.c)
    writeFileSync(file, control(1800, 2));
    expect(needsRecovery(dir)).toBe(true);
    expect(readControl(dir)).toEqual({ recovery: true, state: 2, unknown: null });
    expect(controlState(control(1800, 2))).toEqual({ recovery: true, state: 2, unknown: null });
    writeFileSync(file, control(1800, 1));
    expect(readControl(dir)).toEqual({ recovery: false, state: 1, unknown: null });
    for (const state of [0, 3, 4, 5, 6]) expect(controlState(control(1800, state))).toEqual({ recovery: true, state, unknown: null });
  });

  it("says why it cannot tell, for app.log", () => {
    const dir = join(root, "control-reasons");
    mkdirSync(join(dir, "global"), { recursive: true });
    const file = join(dir, "global", "pg_control");
    expect(readControl(dir)).toEqual({ recovery: null, state: null, unknown: "no pg_control" });
    writeFileSync(file, Buffer.alloc(19));
    expect(readControl(dir)).toEqual({ recovery: null, state: null, unknown: "pg_control is 19 bytes" });
    writeFileSync(file, control(0, 1));
    expect(readControl(dir)).toEqual({ recovery: null, state: null, unknown: "pg_control version 0" });
    writeFileSync(file, control(1800, 7));
    expect(readControl(dir)).toEqual({ recovery: null, state: 7, unknown: "state 7" });
    rmSync(file);
    mkdirSync(file);
    expect(readControl(dir)).toEqual({ recovery: null, state: null, unknown: "unreadable: EISDIR" });
    // a folder without a database yet (a first start): nothing is read at all
    expect(inspectDatabase(join(root, "control-none"))).toEqual({ walMb: 0, recovery: null, state: null, unknown: "no database yet" });
  });
});
