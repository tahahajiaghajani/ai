// Server edition against a real PostgreSQL (skipped unless ITSM_PG_BIN names a PostgreSQL bin folder; the Windows CI
// job covers the packaged installation). What it runs, end to end:
//   karizctl init / db-init / pg-start / db-bootstrap / migrate → two server instances on one database over HTTPS with
//   a generated certificate → exactly one scheduler leader runs the job queue → first-run setup through its API →
//   sign-in, an incident with an attachment on disk → air-gap refusal → the Windows app links to the server and
//   downloads the organisation (its sync API) → backup (pg_dump, verified) → restore (pg_restore into a new database) →
//   PostgreSQL stopped and every file removed.
// Locally as root: ITSM_PG_BIN=/usr/lib/postgresql/16/bin ITSM_PG_RUNAS=nobody npx vitest run tests/server-edition-pg.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { request as httpsRequest } from "node:https";
import { randomBytes } from "node:crypto";
import { main as ctl } from "../src/server-edition/ctl";
import { loadServerConfig, patchServerConfig, saveServerConfig } from "../src/server-edition/config";
import { startServerEdition, type RunningServer } from "../src/server-edition/worker";
import { issueSetupToken } from "../src/server-edition/setup";
import { uninstallSocketGuard } from "../src/server-edition/airgap";
import { startLocal, type LocalServer } from "@local/server";
import { Client } from "./helpers";

const BIN = process.env.ITSM_PG_BIN;
const PORT = Number(process.env.ITSM_PG_TEST_PORT ?? 55433 + Math.floor(Math.random() * 40) + 10);
const DIR = join(__dirname, "..", ".local-data", `pg-it-${randomBytes(4).toString("hex")}`);
const FILE = join(DIR, "kariz.json");
const quiet = { info() {}, warn() {}, error: (m: string, d?: unknown) => console.error(m, d), debug() {}, setLevel() {} };

/** HTTPS JSON client that trusts the server's own (self-signed) certificate and keeps the session cookie. */
function client(base: string, ca: string, host: string) {
  let cookie = "";
  return async (method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> =>
    new Promise((resolve, reject) => {
      const u = new URL(`/api${path}`, base);
      const req = httpsRequest(
        { host: "127.0.0.1", port: u.port, path: u.pathname + u.search, method, ca, servername: host, headers: { host: `${host}:${u.port}`, "content-type": "application/json", ...(cookie ? { cookie } : {}) } },
        (res) => {
          const set = res.headers["set-cookie"];
          if (set?.length) cookie = set[0].split(";")[0];
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (d: string) => (text += d));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, json: text ? JSON.parse(text) : null }));
        },
      );
      req.on("error", reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
}

const run = async (...args: string[]) => {
  const code = await ctl([...args, "--config", FILE]);
  if (code !== 0) throw new Error(`karizctl ${args[0]} exited ${code}`);
};

describe.skipIf(!BIN)("server edition on PostgreSQL", () => {
  const servers: RunningServer[] = [];
  let desktop: LocalServer | null = null;
  let pgStarted = false;

  beforeAll(async () => {
    mkdirSync(DIR, { recursive: true });
    await run("init", "--data-dir", DIR, "--public-url", "https://kariz.test.local", "--https-port", "0", "--http-port", "0", "--pg-port", String(PORT), "--pg-bin", BIN!, "--workers", "2");
    await run("db-init");
    // a small footprint on a shared test machine
    writeFileSync(join(DIR, "db", "kariz-local.conf"), "shared_buffers = 64MB\nmax_connections = 80\nmax_worker_processes = 8\n");
    patchServerConfig(FILE, (c) => {
      c.db.max_connections = 80;
      c.pool_per_worker = 5;
      c.network.allow = [];
    });
    await run("pg-start");
    pgStarted = true;
    await run("db-bootstrap");
    await run("migrate");
  }, 240_000);

  afterAll(async () => {
    await desktop?.close().catch(() => undefined);
    for (const s of servers) await s.close().catch(() => undefined);
    uninstallSocketGuard();
    if (pgStarted) await run("pg-stop").catch((e) => console.error(e));
    rmSync(DIR, { recursive: true, force: true });
  }, 120_000);

  it("runs two instances on one database: exactly one scheduler leader runs the queue; setup, sign-in, records, air gap, sync, backup and restore work", async () => {
    const a = await startServerEdition({ file: FILE, workerId: 1, log: quiet, ports: { https: 0, http: 0 } });
    const b = await startServerEdition({ file: FILE, workerId: 2, log: quiet, ports: { https: 0, http: 0 } });
    servers.push(a, b);
    const until = Date.now() + 20_000;
    while (Date.now() < until && !(a.scheduler!.isLeader || b.scheduler!.isLeader)) await new Promise((r) => setTimeout(r, 200));
    await new Promise((r) => setTimeout(r, 1500));
    expect([a.scheduler!.isLeader, b.scheduler!.isLeader].filter(Boolean)).toHaveLength(1);
    const [leader, follower] = a.scheduler!.isLeader ? [a, b] : [b, a];

    const c = loadServerConfig(FILE).config;
    const ca = readFileSync(join(c.dirs.tls, "self-signed.crt"), "utf8");
    const api = client(follower.https!, ca, "kariz.test.local");
    expect((await api("GET", "/ready")).json.ok).toBe(true);
    expect((await api("GET", "/meta")).json).toMatchObject({ edition: "server", server: { air_gapped: true } });
    expect((await api("GET", "/orgs")).status).toBe(503);

    // first-run setup through its API (on the follower: the token is read from the file)
    const { token } = issueSetupToken(FILE);
    const setup = await api("POST", "/setup/complete", {
      token,
      org: { name: "بانک آزمایشی" },
      admin: { full_name: "مدیر فناوری", email: "admin@bank.local", password: "Kariz-Strong-Pass-1405" },
      public_url: "https://kariz.test.local",
      ai: [{ base_url: "http://ollama.bank.local:11434/v1", kind: "ollama" }],
    });
    expect(setup.status).toBe(200);
    const org = setup.json.org_id as string;
    leader.reload();
    follower.reload();

    // sign in on the other instance (same sessions table), create an incident with an attachment, read it back
    const api2 = client(leader.https!, ca, "kariz.test.local");
    expect((await api2("POST", "/auth/login", { email: "admin@bank.local", password: "Kariz-Strong-Pass-1405" })).status).toBe(200);
    const inc = await api2("POST", `/o/${org}/r/incident`, { short_description: "سرور ایمیل شعبه پاسخ نمی‌دهد" });
    expect(inc.status).toBe(200);
    expect((await api2("GET", `/o/${org}/r/incident/${inc.json.row.id}`)).json.row.short_description).toBe("سرور ایمیل شعبه پاسخ نمی‌دهد");
    // the record's events are processed by the leader only. The first-run setup runs the new organisation's seed jobs
    // at once (a backlog of 1,000–1,900 jobs queued before the incident, and the queue takes the oldest first), so the
    // test waits for the incident's own jobs (due now; a timer due later stays queued) rather than for an empty queue
    const incId = inc.json.row.id as string;
    const ownJobs = () =>
      leader.cfg.db.query<{ kind: string; status: string; due: boolean }>(`select kind, status, run_at <= now() as due from sm_jobs where position($1 in payload::text) > 0`, [incId]);
    const backlog = (await leader.cfg.db.one<{ n: number }>(`select count(*)::int as n from sm_jobs where status in ('queued', 'running') and run_at <= now()`))!.n;
    const started = Date.now();
    let own = await ownJobs();
    while (Date.now() - started < 240_000 && (!own.some((j) => j.status === "done") || own.some((j) => j.status === "running" || (j.status === "queued" && j.due)))) {
      await new Promise((r2) => setTimeout(r2, 500));
      own = await ownJobs();
    }
    console.log(`the incident's ${own.length} job(s) ran after a backlog of ${backlog} in ${Math.round((Date.now() - started) / 100) / 10} s`);
    expect(own.filter((j) => j.status === "done").length).toBeGreaterThan(0);
    expect(own.filter((j) => j.status === "running" || (j.status === "queued" && j.due) || j.status === "failed")).toEqual([]);
    expect(leader.metrics.snapshot().last_tick).not.toBeNull();
    expect(follower.metrics.snapshot().last_tick).toBeNull();

    // the air gap: an internet AI service is refused with a Persian message
    const refused = await api2("POST", `/o/${org}/ai/connections`, { preset: "custom-openai", base_url: "https://api.example.com/v1", key: "sk-test-1234567890", protocol: "openai-chat" });
    expect(refused.status).toBe(400);
    expect(refused.json.error.message).toContain("شبکهٔ بسته");

    // the Windows app links to the server edition (same API) and downloads the organisation
    const httpFile = join(DIR, "kariz-http.json");
    const httpCfg = loadServerConfig(FILE).config;
    httpCfg.tls.enabled = false;
    saveServerConfig(httpFile, httpCfg);
    const plain = await startServerEdition({ file: httpFile, workerId: 3, log: quiet, ports: { http: 0 }, scheduler: false });
    servers.push(plain);
    const base = plain.http!.replace("kariz.test.local", "127.0.0.1");
    desktop = await startLocal({ dataDir: join(DIR, "desktop"), staticDir: join(__dirname, "..", "public"), port: 0, memory: true, log: quiet });
    const desk = new Client({ fetch: (r: Request) => fetch(r) }, desktop.url);
    const orgs = await desk.post("/local/cloud/orgs", { url: base, email: "admin@bank.local", password: "Kariz-Strong-Pass-1405" });
    expect(orgs.orgs.map((o: { id: string }) => o.id)).toContain(org);
    const linked = await desk.post("/local/cloud/link", { url: base, email: "admin@bank.local", password: "Kariz-Strong-Pass-1405", org_id: org, direction: "download" });
    expect(linked.ok).toBe(true);
    await desk.post("/auth/login", { email: "admin@bank.local", password: "Kariz-Strong-Pass-1405" });
    const onDesktop = await desk.get(`/o/${org}/r/incident`);
    expect(onDesktop.rows.map((r: { short_description: string }) => r.short_description)).toContain("سرور ایمیل شعبه پاسخ نمی‌دهد");
    await desktop.close();
    desktop = null;

    // backup (verified), then restore after a later change: the later change is gone, the previous database kept
    await run("backup");
    const after = await api2("POST", `/o/${org}/r/incident`, { short_description: "پس از پشتیبان" });
    expect(after.status).toBe(200);
    for (const s of servers.splice(0)) await s.close();
    const root = join(DIR, "backups");
    const folder = (await import("../src/server-edition/backup")).listBackups(root).find((x) => x.label === "manual")!.folder;
    expect(JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8")).verified).toBe(true);
    await run("restore", folder, "--yes", "--no-safety-backup");
    const again = await startServerEdition({ file: FILE, workerId: 1, log: quiet, ports: { https: 0, http: 0 }, scheduler: false });
    servers.push(again);
    const rows = await again.cfg.db.query<{ short_description: string }>(`select short_description from sm_incidents order by created_at`);
    expect(rows.map((r) => r.short_description)).toEqual(["سرور ایمیل شعبه پاسخ نمی‌دهد"]);
    const dbs = await again.cfg.db.query<{ datname: string }>(`select datname from pg_database where datname like 'kariz_before_restore_%'`);
    expect(dbs).toHaveLength(1);
    expect(existsSync(join(DIR, "last-backup.json"))).toBe(true);
  }, 600_000);
});
