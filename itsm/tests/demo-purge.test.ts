// The proof of «no trace» (docs/DEMO_FA.md): snapshot the whole database (row counts and a checksum of every row of
// every table), load the small pack, exercise it — the job queue (notifications, SLA timers, RAG indexing), a demo
// person signing in, commenting and attaching a file, the real owner commenting on a demo record, KPI collection, model
// training, archiving — purge it, snapshot again: identical, except the two content-free audit lines and the platform's
// bookkeeping counters (sync revisions, the access version, scope epochs, the job queue's own scheduling state).
// Runs on PGlite (CI) and, when ITSM_PG_BIN names a PostgreSQL bin folder, again on a real PostgreSQL cluster that
// karizctl sets up (as tests/server-edition-pg.test.ts does).
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { engineOrg, upload, type EngineOrg } from "./engine-helpers";
import { Client, quietLog, signupWithOrg } from "./helpers";
import { main as ctl } from "../src/server-edition/ctl";
import { databaseUrl, loadServerConfig } from "../src/server-edition/config";
import { createPostgresDb } from "@server/db/postgres";
import { createApp } from "@server/app";
import type { ServerConfig } from "@server/context";
import type { Db } from "@server/db";
import { tick, enqueue } from "@server/jobs";
import { runToEnd } from "@server/modules/demo";
import { systemCtx, archiveBatch } from "@server/engine";
import { TABLES } from "@shared/tables";
import { collectAll } from "@server/modules/analytics/indicators";

/**
 * Columns that are bookkeeping, not content: counters that only move forward (sync revisions, the access version,
 * scope epochs) and the time a row was last written (rows the purge put back carry the time it did).
 */
const BOOKKEEPING: Record<string, string[]> = {
  "*": ["rev", "updated_at"],
  sm_sessions: ["last_seen_at", "reauth_at", "expires_at"],
  sm_access_state: ["version", "updated_at"],
  sm_scope_epochs: ["epoch", "updated_at"],
  sm_users: ["last_login_at", "updated_at"],
};
/** Checked on their own below: the job queue (scheduling state) and the audit log (the allowed lines). */
const SPECIAL = new Set(["sm_jobs", "sm_audit", "sm_org_sync", "sm_migrations"]);

type Snapshot = Map<string, Map<string, string>>;

async function snapshot(db: Db): Promise<Snapshot> {
  const tables = await db.query<{ t: string; has_id: boolean }>(
    `select t.table_name as t, exists (select 1 from information_schema.columns c where c.table_schema = t.table_schema and c.table_name = t.table_name and c.column_name = 'id') as has_id
       from information_schema.tables t where t.table_schema = current_schema() and t.table_type = 'BASE TABLE' and t.table_name like 'sm\\_%' order by 1`,
  );
  const out: Snapshot = new Map();
  for (const { t, has_id } of tables) {
    if (SPECIAL.has(t)) continue;
    const drop = [...BOOKKEEPING["*"], ...(BOOKKEEPING[t] ?? [])].map((c) => ` - '${c}'`).join("");
    const rows = await db.query<{ k: string; h: string }>(`select ${has_id ? "x.id::text" : "md5((to_jsonb(x)" + drop + ")::text)"} as k, md5((to_jsonb(x)${drop})::text) as h from ${t} x`);
    const m = new Map<string, string>();
    for (const r of rows) m.set(r.k, r.h);
    out.set(t, m);
  }
  return out;
}

function diff(a: Snapshot, b: Snapshot): string[] {
  const out: string[] = [];
  for (const [t, before] of a) {
    const after = b.get(t) ?? new Map();
    let added = 0;
    let removed = 0;
    let changed = 0;
    const samples: string[] = [];
    for (const [k, h] of before) {
      if (!after.has(k)) {
        removed++;
        if (samples.length < 3) samples.push(`-${k}`);
      } else if (after.get(k) !== h) {
        changed++;
        if (samples.length < 3) samples.push(`~${k}`);
      }
    }
    for (const k of after.keys()) {
      if (!before.has(k)) {
        added++;
        if (samples.length < 3) samples.push(`+${k}`);
      }
    }
    if (added || removed || changed) out.push(`${t}: +${added} -${removed} ~${changed} ${samples.join(" ")}`);
  }
  for (const t of b.keys()) if (!a.has(t)) out.push(`${t}: new table`);
  return out;
}

/** Run due jobs until none is left (or the time is up: periodic jobs may keep coming). */
async function settle(e: EngineOrg, budgetMs = 90_000) {
  const until = Date.now() + budgetMs;
  while (Date.now() < until) {
    await e.db.query(`update sm_jobs set run_at = now() where status = 'queued' and run_at > now() and (kind like '%seed%' or kind like '%install%')`);
    const r = await tick(e.cfg, { budgetMs: 10_000 });
    if (!r.ran && !r.more) break;
  }
}

const t0 = Date.now();
const log = (m: string) => console.log(`[demo-purge ${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);

/** An organisation on a real PostgreSQL cluster that karizctl initialises (ITSM_PG_BIN), as the server edition runs. */
async function pgOrg(): Promise<{ e: EngineOrg; close(): Promise<void> }> {
  const dir = join(__dirname, "..", ".local-data", `pg-demo-${randomBytes(4).toString("hex")}`);
  const file = join(dir, "kariz.json");
  const port = 55600 + Math.floor(Math.random() * 300);
  const run = async (...args: string[]) => {
    const code = await ctl([...args, "--config", file]);
    if (code !== 0) throw new Error(`karizctl ${args[0]} exited ${code}`);
  };
  mkdirSync(dir, { recursive: true });
  await run("init", "--data-dir", dir, "--public-url", "https://kariz.test.local", "--https-port", "0", "--http-port", "0", "--pg-port", String(port), "--pg-bin", process.env.ITSM_PG_BIN!, "--workers", "1");
  await run("db-init");
  await run("pg-start");
  let db: ReturnType<typeof createPostgresDb> | null = null;
  const close = async () => {
    await db?.close().catch(() => undefined);
    await run("pg-stop").catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    await run("db-bootstrap");
    await run("migrate");
    const c = loadServerConfig(file).config;
    db = createPostgresDb({ url: databaseUrl(c), max: 4, ssl: c.db.ssl, prepare: true });
    const cfg: ServerConfig = { mode: "cloud", db, secret: "test-secret", allowSignup: true, platformAdmins: [], origin: "cloud", log: quietLog, fetch: globalThis.fetch.bind(globalThis) };
    const app = createApp(cfg);
    const owner = new Client(app);
    const org = await signupWithOrg(owner, { timezone: "Asia/Tehran" });
    const me = await owner.get("/auth/me");
    return { e: { app, db, owner, org, ownerId: me.user.id, cfg } as unknown as EngineOrg, close };
  } catch (err) {
    // a cluster that started is never left running
    await close();
    throw err;
  }
}

proof("demo pack on PGlite: load, exercise, purge — no trace", async () => ({ e: await engineOrg(), close: async () => {} }));
proof("demo pack on PostgreSQL: load, exercise, purge — no trace", pgOrg, !process.env.ITSM_PG_BIN);

function proof(title: string, make: () => Promise<{ e: EngineOrg; close(): Promise<void> }>, skip = false) {
describe.skipIf(skip)(title, () => {
  let e: EngineOrg;
  let close: () => Promise<void> = async () => {};
  let before: Snapshot;
  let auditBefore: number;
  let jobsBefore: Set<string>;

  beforeAll(async () => {
    ({ e, close } = await make());
    await settle(e, 240_000);
    log("seeded");
    before = await snapshot(e.db);
    log("snapshot before");
    auditBefore = (await e.db.one<{ n: number }>(`select count(*)::int as n from sm_audit`))!.n;
    jobsBefore = new Set((await e.db.query<{ id: string }>(`select id from sm_jobs`)).map((r) => r.id));
  }, 900_000);
  afterAll(() => close());

  let status: any;
  let incidents: { id: string }[] = [];
  const persona = async (key: string) => {
    const email = status.accounts.find((a: { persona: string }) => a.persona === key).email;
    const c = new Client(e.app);
    await c.post("/auth/login", { email, password: status.password });
    const id = (await e.db.one<{ id: string }>(`select id from sm_users where email = $1`, [email]))!.id;
    return { c, id };
  };
  /** rows of a list the caller may read (a 403 is no rows) */
  const rowsOf = async (c: Client, table: string): Promise<Record<string, any>[]> => {
    try {
      return (await c.get(`/o/${e.org}/r/${table}?limit=500`)).rows;
    } catch (err) {
      if (/→ 403/.test(String((err as Error).message))) return [];
      throw err;
    }
  };

  it("loads the small bank", async () => {
    const started = await e.owner.post(`/o/${e.org}/demo/load`, { size: "small" });
    expect(started.state).toBe("loading");
    await e.owner.post(`/o/${e.org}/demo/load`, { size: "small" }, 409);
    await runToEnd(e.cfg, e.org, "load", { budgetMs: 1_200_000 });
    log("loaded");
    status = await e.owner.get(`/o/${e.org}/demo`);
    log(`counts ${JSON.stringify(status.counts)} refused ${JSON.stringify(status.refused ?? {})}`);
    status = await e.owner.get(`/o/${e.org}/demo`);
    expect(status.error ?? null).toBeNull();
    expect(status.state).toBe("loaded");
    expect(status.counts.incident).toBeGreaterThan(100);
    expect(status.counts.branch).toBe(60);
    expect(status.counts.request).toBeGreaterThan(10);
    expect(status.counts.major_incident).toBe(1);
    expect(status.password).toBeTruthy();
    expect((await e.owner.get(`/o/${e.org}/demo/banner`)).active).toBe(true);
    // demo sign-in is off by default: the presenter's administrator turns it on
    expect(status.signin).toBe(false);
    await e.owner.post(`/o/${e.org}/demo/signin`, { on: true });
    status = await e.owner.get(`/o/${e.org}/demo`);
    expect(status.signin).toBe(true);
    incidents = await e.db.query<{ id: string }>(`select id from sm_incidents where org_id = $1 and deleted_at is null order by opened_at desc limit 5`, [e.org]);
    expect(incidents.length).toBe(5);
  }, 1_500_000);

  it("demo people follow the same access rules (secure HR workspace, security area, own records)", async () => {
    const requester = await persona("requester");
    const agent = await persona("agent");
    const hr = await persona("hr");
    const soc = await persona("soc");
    expect((await e.db.one<{ n: number }>(`select count(*)::int as n from sm_hr_cases where org_id = $1`, [e.org]))!.n).toBeGreaterThan(0);
    expect((await e.db.one<{ n: number }>(`select count(*)::int as n from sm_sec_incidents where org_id = $1`, [e.org]))!.n).toBeGreaterThan(0);
    // HR cases: only HR people; security incidents: only security people
    expect(await rowsOf(requester.c, "hr_case")).toEqual([]);
    expect(await rowsOf(agent.c, "hr_case")).toEqual([]);
    expect((await rowsOf(hr.c, "hr_case")).length).toBeGreaterThan(0);
    expect(await rowsOf(requester.c, "sec_incident")).toEqual([]);
    expect(await rowsOf(agent.c, "sec_incident")).toEqual([]);
    expect((await rowsOf(soc.c, "sec_incident")).length).toBeGreaterThan(0);
    // a requester reads their own incidents only; an agent reads the desk's
    const own = await rowsOf(requester.c, "incident");
    const all = (await e.db.one<{ n: number }>(`select count(*)::int as n from sm_incidents where org_id = $1 and deleted_at is null`, [e.org]))!.n;
    expect(own.length).toBeLessThan(all);
    for (const r of own) expect([r.caller_id, r.requested_for, r.opened_by].includes(requester.id) || (Array.isArray(r.watch_list) && r.watch_list.includes(requester.id))).toBe(true);
    expect((await rowsOf(agent.c, "incident")).length).toBeGreaterThan(own.length);
    // the console is the administrators': no persona reaches it
    await requester.c.get(`/o/${e.org}/demo`, 403);
    await agent.c.get(`/o/${e.org}/demo`, 403);
    log("access checked");
  }, 600_000);

  it("is exercised and purged, and leaves the database as it was", async () => {
    // a demo person signs in, reads, comments and attaches a file
    const { c: agent } = await persona("agent");
    await agent.get(`/o/${e.org}/r/incident/${incidents[0].id}`);
    await agent.post(`/o/${e.org}/r/incident/${incidents[0].id}/journal`, { kind: "comment", body: "پیگیری از شعبه انجام شد" });
    const up = await upload(e.app, agent, `/o/${e.org}/r/incident/${incidents[0].id}/attachments`, "atm-log.txt", new TextEncoder().encode("ATM-500 cassette jam log (demo)"), "text/plain");
    expect(up.status).toBeLessThan(300);
    // the real owner comments on a demo record (a side row of demo data, removed with it)
    await e.owner.post(`/o/${e.org}/r/incident/${incidents[1].id}/journal`, { kind: "work_note", body: "یادداشت مالک روی رکورد نمایشی" });
    // KPIs, models, archiving: the organisation's own computations over demo data
    const sys = await systemCtx(e.cfg, e.org);
    await collectAll(sys).catch(() => null);
    const models = await e.db.query<{ key: string }>(`select key from sm_ai_models where org_id = $1 and table_key = 'incident' order by key limit 2`, [e.org]);
    for (const m of models) await enqueue(e.db, { kind: "ai.ml.train", orgId: e.org, payload: { key: m.key }, dedupeKey: `ai.ml.train:${m.key}` });
    await archiveBatch(sys, TABLES.get("incident")!, 0, 20);
    await settle(e, 180_000);
    log("exercised");
    const rows = await e.db.one<{ n: number }>(`select count(*)::int as n from sm_demo_rows where org_id = $1`, [e.org]);
    expect(rows!.n).toBeGreaterThan(1000);

    // ----- purge
    const report = await e.owner.get(`/o/${e.org}/demo/report`);
    expect(report.rows).toBeGreaterThan(1000);
    await e.owner.post(`/o/${e.org}/demo/purge`, { confirm: "اشتباه" }, 400);
    await e.owner.post(`/o/${e.org}/demo/purge`, { confirm: "حذف کامل" });
    await runToEnd(e.cfg, e.org, "purge", { budgetMs: 900_000 });
    log("purged");
    const gone = await e.owner.get(`/o/${e.org}/demo`);
    expect(gone.state).toBe("none");
    expect(gone.last.action).toBe("demo_purge");
    expect((await e.owner.get(`/o/${e.org}/demo/banner`)).active).toBe(false);
    // the demo person's session is gone with the account
    await agent.get(`/o/${e.org}/r/incident`, 401);

    // ----- no trace
    const after = await snapshot(e.db);
    log("snapshot after");
    const differences = diff(before, after);
    if (differences.length) {
      // what is left, for the one who fixes it
      for (const [t, m] of after) {
        const added = [...m.keys()].filter((k) => !before.get(t)?.has(k)).slice(0, 3);
        for (const k of added) log(`left in ${t}: ${JSON.stringify(await e.db.one(`select * from ${t} where id::text = $1`, [k]).catch(() => null)).slice(0, 400)}`);
      }
    }
    expect(differences).toEqual([]);
    // the audit log: exactly the two content-free lines more
    const audit = await e.db.query<{ action: string; summary: string; entity_id: string | null }>(`select action, summary, entity_id from sm_audit order by at`);
    expect(audit.length).toBe(auditBefore + 2);
    expect(audit.slice(-2).map((a) => a.action).sort()).toEqual(["demo_load", "demo_purge"]);
    // the job queue: nothing about demo data, no demo job left
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
    const newJobs = await e.db.query<{ id: string; kind: string; payload: unknown }>(`select id, kind, payload from sm_jobs`);
    const known = new Set([...before.values()].flatMap((m) => [...m.keys()]));
    const strays = newJobs.filter((j) => !jobsBefore.has(j.id)).filter((j) => (JSON.stringify(j.payload).match(uuid) ?? []).some((id) => !known.has(id) && id !== e.org && id !== e.ownerId));
    expect(strays.map((j) => j.kind)).toEqual([]);
    expect(newJobs.filter((j) => j.kind === "demo.load").length).toBe(0);
    // nothing names the pack any more
    expect((await e.db.query(`select 1 from sm_users where email like '%aftab-bank.example'`)).length).toBe(0);
    expect((await e.db.query(`select 1 from sm_demo_rows`)).length).toBe(0);
  }, 1_800_000);
});
}
