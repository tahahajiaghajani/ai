// The Windows app's start with its database maintenance (src/desktop/server.ts → src/desktop/maintenance.ts), end to end
// through startLocal on a data folder made from the build's template: a bloated job queue compacted before ready (asked
// for in Settings), the splash told, every step logged, the data intact, the next start through the gate in
// milliseconds; a backup taken by the app restored at the next start by the streaming reader; and a restore cut short
// never leaves the person a new, empty database.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startLocal, type StartPhase } from "@local/server";
import { buildDbTemplate, DB_TEMPLATE_FILE } from "@local/db-template";
import { createPgliteDb } from "@server/db/pglite";
import { scheduleRestore, takePendingRestore } from "@local/backup";
import { capture, MB } from "./desktop-maint-helpers";

const root = mkdtempSync(join(tmpdir(), "itsm-maint-start-"));
const staticDir = join(root, "renderer");
const templateFile = join(root, DB_TEMPLATE_FILE);

beforeAll(async () => {
  mkdirSync(staticDir, { recursive: true });
  writeFileSync(join(staticDir, "index.html"), `<!doctype html><html><body><div id="root"></div></body></html>`);
  await buildDbTemplate(templateFile);
}, 600_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

/** The closed database of a data folder, opened as the next start opens it. */
async function inside<T>(dir: string, fn: (db: Awaited<ReturnType<typeof createPgliteDb>>) => Promise<T>): Promise<T> {
  const db = await createPgliteDb({ dataDir: join(dir, "db"), wal: false });
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}

describe("the start's database maintenance", () => {
  it("compacts a bloated job queue before ready when Settings asked for it, then skips in milliseconds", async () => {
    const dir = join(root, "data");
    const first = capture();
    const s1 = await startLocal({ dataDir: dir, staticDir, port: 0, log: first, template: templateFile });
    await s1.close();
    // a new installation: its state recorded, nothing looked at
    expect(first.lines.some((l) => /^database maintenance: nothing to do \(\d+ ms; \d+ MB of log since the last look\)$/.test(l))).toBe(true);
    // what 1.1.0-beta's health loop left: tens of thousands of finished jobs, ten days old
    const before = await inside(dir, async (db) => {
      await db.exec(`insert into sm_jobs (id, kind, payload, status, done_at) select gen_random_uuid(), 'cmdb.health_ci', jsonb_build_object('pad', repeat('j', 400)), 'done', now() - interval '10 days' from generate_series(1, 60000)`);
      await db.exec(`insert into sm_jobs (id, kind, status, run_at) values (gen_random_uuid(), 'still.queued', 'queued', now() + interval '1 hour')`);
      await db.exec(`insert into sm_kv (key, value) values ('test.keep', '"kept"')`);
      return Number((await db.one<{ b: number }>(`select pg_total_relation_size('sm_jobs')::float8 as b`))!.b);
    });
    expect(before).toBeGreaterThan(20 * MB);
    // Settings' «فشرده‌سازی پایگاه داده» (before any account: the setup's trust of this computer)
    const s2 = await startLocal({ dataDir: dir, staticDir, port: 0, log: capture() });
    try {
      const r = await fetch(`${s2.url}/api/local/maintenance/compact`, { method: "POST" });
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ ok: true, restart: true });
      const info = await (await fetch(`${s2.url}/api/local/info`)).json();
      expect(info.database).toMatchObject({ requested: true });
    } finally {
      await s2.close();
    }
    expect(existsSync(join(dir, "compact.pending"))).toBe(true);
    // the next start compacts before it listens
    const phases: StartPhase[] = [];
    const log = capture();
    const s3 = await startLocal({ dataDir: dir, staticDir, port: 0, log, onPhase: (p) => phases.push(p) });
    try {
      expect(phases).toEqual([{ phase: "database", walMb: expect.any(Number), recovery: false }, { phase: "migrations" }, { phase: "migrations", maintenance: true }]);
      expect(log.lines.some((l) => /^maintenance step jobs:sm_jobs:\d+ applied \(.*, 60000 finished jobs deleted so far, \d+ ms\)$/.test(l))).toBe(true);
      expect(log.lines.some((l) => /^maintenance step compact:sm_jobs applied/.test(l))).toBe(true);
      expect(log.lines.filter((l) => /^maintenance step \S+ applied/.test(l)).length).toBeGreaterThanOrEqual(3);
      // the compaction is over before the server's line, which still parses for desktop-e2e
      const at = (re: RegExp) => log.lines.findIndex((l) => re.test(l));
      expect(at(/^database maintenance: done in /)).toBeLessThan(at(/^local server on /));
      expect(log.lines.find((l) => l.startsWith("local server on"))).toMatch(/\(database \d+ ms, migrations \d+ ms, ready \d+ ms, process \d+ ms\)$/);
      expect((await (await fetch(`${s3.url}/api/health`)).json()).ok).toBe(true);
      const info = await (await fetch(`${s3.url}/api/local/info`)).json();
      expect(info.database).toMatchObject({ requested: false, pending: [] });
      expect(info.database.compacted_at).toBeTruthy();
    } finally {
      await s3.close();
    }
    expect(existsSync(join(dir, "compact.pending"))).toBe(false);
    await inside(dir, async (db) => {
      expect(Number((await db.one<{ b: number }>(`select pg_total_relation_size('sm_jobs')::float8 as b`))!.b)).toBeLessThan(before / 10);
      expect(await db.query(`select kind from sm_jobs where kind = 'still.queued'`)).toHaveLength(1);
      expect(await db.one(`select count(*)::int as n from sm_jobs where kind = 'cmdb.health_ci'`)).toEqual({ n: 0 });
      expect(await db.one(`select value from sm_kv where key = 'test.keep'`)).toEqual({ value: "kept" });
    });
    // and the start after: the gate alone
    const later = capture();
    const s4 = await startLocal({ dataDir: dir, staticDir, port: 0, log: later });
    await s4.close();
    const line = later.lines.find((l) => l.startsWith("database maintenance: nothing to do"));
    expect(Number(/\((\d+) ms;/.exec(line ?? "")?.[1])).toBeLessThan(50);
    expect(later.lines.some((l) => /^maintenance step /.test(l))).toBe(false);
  }, 300_000);

  it("restores a backup the app took, at the next start, with the streaming reader", async () => {
    const dir = join(root, "data-restore");
    const s1 = await startLocal({ dataDir: dir, staticDir, port: 0, log: capture(), template: templateFile });
    let file = "";
    try {
      const b = await (await fetch(`${s1.url}/api/local/backups`, { method: "POST" })).json();
      file = b.file;
      expect(file).toMatch(/itsm-manual-\d{8}-\d{6}\.tar\.gz$/);
    } finally {
      await s1.close();
    }
    // a change after the backup: gone after the restore
    await inside(dir, (db) => db.exec(`insert into sm_kv (key, value) values ('test.after', '"after"')`));
    const s2 = await startLocal({ dataDir: dir, staticDir, port: 0, log: capture() });
    try {
      const r = await fetch(`${s2.url}/api/local/backups/restore`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file }) });
      expect(r.status).toBe(200);
    } finally {
      await s2.close();
    }
    const log = capture();
    const s3 = await startLocal({ dataDir: dir, staticDir, port: 0, log });
    try {
      expect(log.lines.some((l) => /^restoring database from backup: \d+ files \(\d+(\.\d)? MB\) extracted in \d+\.\d s$/.test(l))).toBe(true);
      expect(log.lines.some((l) => l.startsWith("restore failed"))).toBe(false);
      expect((await (await fetch(`${s3.url}/api/health`)).json()).ok).toBe(true);
    } finally {
      await s3.close();
    }
    await inside(dir, async (db) => {
      expect(await db.one(`select value from sm_kv where key = 'test.after'`)).toBeNull();
    });
  }, 300_000);

  it("brings the person's database back at the start after a restore that was cut short, never a new empty one", async () => {
    const dir = join(root, "data-cut");
    const s1 = await startLocal({ dataDir: dir, staticDir, port: 0, log: capture(), template: templateFile });
    let file = "";
    try {
      file = (await (await fetch(`${s1.url}/api/local/backups`, { method: "POST" })).json()).file;
    } finally {
      await s1.close();
    }
    await inside(dir, (db) => db.exec(`insert into sm_kv (key, value) values ('test.mine', '"mine"')`));
    // Settings asked for the restore; its start set the database aside, and the app was killed while the backup was
    // being extracted: some files, no PG_VERSION (written last)
    scheduleRestore(dir, file);
    takePendingRestore(dir);
    mkdirSync(join(dir, "db", "base", "5"), { recursive: true });
    writeFileSync(join(dir, "db", "base", "5", "1259"), Buffer.alloc(8192));
    // the next start (the app hands every start the build's template, for a first one)
    const log = capture();
    const s2 = await startLocal({ dataDir: dir, staticDir, port: 0, log, template: templateFile });
    await s2.close();
    expect(log.lines.some((l) => l.startsWith("restoring a backup was cut short at an earlier start"))).toBe(true);
    // the database that was there before the restore, not the template's new one
    expect(log.lines.some((l) => l.startsWith("database template:"))).toBe(false);
    expect(log.lines.find((l) => l.startsWith("local server on"))).not.toMatch(/from the template/);
    await inside(dir, async (db) => {
      expect(await db.one(`select value from sm_kv where key = 'test.mine'`)).toEqual({ value: "mine" });
    });
  }, 300_000);
});
