// The Windows app's start (docs/PERFORMANCE_FA.md §17): a first start loads the database made at build time
// (src/desktop/db-template.ts) instead of running initdb and every migration, and ends with the same database; a
// template that does not load falls back to the old way; the local server keeps the build's hashed files in the window's
// cache and revalidates the rest; the start's parts are logged on one line for desktop-e2e.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { brotliDecompressSync } from "node:zlib";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startLocal, desktopCacheControl, type LocalServer } from "@local/server";
import { buildDbTemplate, DB_TEMPLATE_FILE } from "@local/db-template";
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
