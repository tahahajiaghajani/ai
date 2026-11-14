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
import { itamSweep } from "@server/modules/itam/jobs";
import { fleet, openAttestations, verifyCustody } from "@server/modules/itam/bank";
import { financialSweep } from "@server/modules/financial";
import { applyPolicies } from "@server/modules/cmdb/jobs";
import { csmSweep } from "@server/modules/csm";
import { esmSweep } from "@server/modules/esm";
import { fsmSweep } from "@server/modules/field_service";
import { generateMaintenanceIn } from "@server/modules/field_service/service";
import { workforceSweep } from "@server/modules/workforce";
import { slmSweep } from "@server/modules/slm/jobs";
import { releaseSweep } from "@server/modules/release/jobs";
import { sweep as eventSweep } from "@server/modules/event/jobs";
import { continuitySweep } from "@server/modules/continuity/jobs";
import { securitySweep } from "@server/modules/security/jobs";
import { portalSweep } from "@server/modules/portal";
import { periodKeyOf } from "@shared/financial/logic";
import { faDigits } from "@shared/format";

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
/**
 * The organisation's own work outside the demo scope while demo data was there: organisation-wide jobs (the CAB
 * schedule opening its next meeting, automated control monitoring raising issues, rule and knowledge statistics).
 * Their rows and changes cannot be attributed to demo work with certainty, so the purge leaves them (docs/DEMO_FA.md,
 * «the purge never deletes, reverts or erases real data») — tests/demo-safety.test.ts proves that rule. Allowed here,
 * with their own history and numbering counters; nothing in them may name a demo row.
 */
// sm_analytics_configs / sm_analytics_dashboards: the organisation's own analytics seed (SEED_DELAY_MS + 2 min after it is
// created) and daily snapshot (analytics/jobs.ts: last_snapshot_on, collected_at) run on their own clock, outside the demo
// scope, and can land between the two snapshots on a loaded machine; the purge rightly keeps that work. The check below
// still proves these tables name no demo row.
const REAL_WORK = new Set(["sm_cab_meetings", "sm_grc_issues", "sm_grc_controls", "sm_cmdb_rules", "sm_ci_rel_rules", "sm_kb_articles", "sm_kb_bases", "sm_itam_configs", "sm_analytics_configs", "sm_analytics_dashboards", "sm_numbers"]);

/**
 * The retrieval index (RAG) follows its records: rows that index the organisation's own work left in place (REAL_WORK,
 * e.g. the controls the security sweep's measureIndicators updated and the GRC issue it raised) are re-indexed by the
 * same organisation-wide jobs and may land between the two snapshots on a slow machine. Allowed only for those records.
 */
const RAG_INDEX = new Set(["sm_ai_rag_docs", "sm_ai_chunks"]);

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

/**
 * Run due jobs until none is left (or the time is up: periodic jobs may keep coming). `soonMs`: jobs due within that
 * much time run now too.
 */
async function settle(e: EngineOrg, budgetMs = 90_000, soonMs = 0) {
  const until = Date.now() + budgetMs;
  while (Date.now() < until) {
    await e.db.query(
      `update sm_jobs set run_at = now() where status = 'queued' and run_at > now()
         and (kind like '%seed%' or kind like '%install%' or run_at <= now() + $1::int * interval '1 millisecond')`,
      [soonMs],
    );
    const r = await tick(e.cfg, { budgetMs: 10_000 });
    if (!r.ran && !r.more) break;
  }
}

/**
 * Run the queue until nothing is due and no job of these kinds waits either — their delay (an XLA rescore waits 20 s
 * after the record's last event) skipped, as if that time had passed — within the budget. `settle` stops once nothing
 * is due, or when its budget ends with a backlog on a loaded machine; what the platform computes from the pack (XLA
 * scores, the library's ingestion) is asserted only once its jobs ran.
 */
async function drain(e: EngineOrg, kinds: string[], budgetMs = 300_000) {
  const list = kinds.map((k) => `'${k}'`).join(", ");
  const until = Date.now() + budgetMs;
  while (Date.now() < until) {
    await e.db.query(`update sm_jobs set run_at = now() where status = 'queued' and run_at > now() and kind in (${list})`);
    const r = await tick(e.cfg, { budgetMs: 10_000 });
    if (r.ran || r.more) continue;
    if (!(await e.db.one(`select 1 from sm_jobs where status = 'queued' and kind in (${list}) limit 1`))) return;
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
  /** the record each retrieval-index row indexed before the load (rows re-indexed meanwhile are gone from the database) */
  const ragBefore = new Map<string, string>();

  beforeAll(async () => {
    ({ e, close } = await make());
    // the snapshot is the organisation at rest: what its seeding queued to run a moment later runs first (the licence
    // reconcile 60 s after the seeded licences, the first CAB, knowledge and retrieval sweeps). A snapshot taken just
    // before that reconcile ran left its run and positions out, while the load's copy of the computed tables had them
    // and the purge rightly put them back: a difference no purge can avoid.
    await settle(e, 240_000, 120_000);
    log("seeded");
    before = await snapshot(e.db);
    for (const t of RAG_INDEX) for (const r of await e.db.query<{ id: string; record_id: string }>(`select id::text as id, record_id::text as record_id from ${t}`)) ragBefore.set(r.id, r.record_id);
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
    // no clear-text password until demo sign-in is turned on
    expect(status.password ?? null).toBeNull();
    expect((await e.owner.get(`/o/${e.org}/demo/banner`)).active).toBe(true);
    // demo sign-in is off by default: the presenter's administrator turns it on
    expect(status.signin).toBe(false);
    // turning it on asks for a recent sign-in too (sensitive administration, POST /auth/reauth): on a busy machine this
    // test's sign-up is older than the re-authentication window by now. Only its effect here (a fresh `reauth_at`,
    // bookkeeping above), as before the purge below
    await e.db.query(`update sm_sessions set reauth_at = now() where user_id = $1`, [e.ownerId]);
    await e.owner.post(`/o/${e.org}/demo/signin`, { on: true });
    status = await e.owner.get(`/o/${e.org}/demo`);
    expect(status.signin).toBe(true);
    expect(status.password).toBeTruthy();
    incidents = await e.db.query<{ id: string }>(`select id from sm_incidents where org_id = $1 and deleted_at is null order by opened_at desc limit 5`, [e.org]);
    expect(incidents.length).toBe(5);
    // bank ITAM: no workflow of the pack was refused, and each is there
    expect(Object.keys(status.refused ?? {}).filter((k) => k.startsWith("itam."))).toEqual([]);
    // the smaller modules: the portal's announcement, the on-call schedule, monitoring alerts
    expect(Object.keys(status.refused ?? {}).filter((k) => ["announcement", "oncall_schedule", "oncall_rotation", "alert"].includes(k))).toEqual([]);
    expect(status.counts.announcement).toBe(1);
    expect(status.counts.oncall_schedule).toBeGreaterThan(1);
    expect(status.counts.alert).toBeGreaterThan(3);
    // the rest of the bank: no module refused any part of the pack, and every module has its records
    expect(status.refused ?? {}).toEqual({});
    for (const k of ["budget", "allocation_rule", "allocation_run", "slm_xla_policy", "wfm_person_skill", "wfm_roster", "wfm_absence", "customer_account", "customer_case", "case_escalation", "install_base_item",
      "facility_request", "finance_case", "legal_request", "purchase_request", "reservation", "territory", "technician", "work_order", "parts_requirement", "maintenance_plan", "event", "bia", "continuity_plan", "exercise", "outage",
      "grc_control", "grc_risk", "release", "deployment", "dev_repository", "project", "project_task", "portal_link", "portal_topic", "survey", "survey_response", "doc_document", "analytics_dashboard", "analytics_indicator"]) {
      expect(status.counts[k] ?? 0, k).toBeGreaterThan(0);
    }
    const n = async (sql: string) => (await e.db.one<{ n: number }>(sql.replace("$org", "$1"), [e.org]))!.n;
    // the personas of the rest of the bank are there, none an administrator (membership role member, no tenant_admin)
    for (const key of ["finance", "csm", "field", "ops", "release", "pm", "grc", "wfm"]) expect(status.accounts.map((a: { persona: string }) => a.persona)).toContain(key);
    expect(await n(`select count(*)::int as n from sm_org_members m join sm_users u on u.id = m.user_id where m.org_id = $org and u.email like '%aftab-bank.example' and m.role not in ('member', 'viewer')`)).toBe(0);
    expect(await n(`select count(*)::int as n from sm_member_profiles p join sm_users u on u.id = p.user_id where p.org_id = $org and u.email like '%aftab-bank.example' and p.roles ? 'tenant_admin'`)).toBe(0);
    // finance: the chargeback was calculated and posted by the module's own services (the debits of the departments)
    // (a chargeback needs two closed months of the fiscal year: none in its first two months)
    const month = Number(periodKeyOf(new Date().toISOString().slice(0, 10)).slice(5, 7));
    expect(await n(`select count(*)::int as n from sm_allocation_runs where org_id = $org and mode = 'chargeback' and state = 'posted'`)).toBe(month >= 3 ? 1 : 0);
    if (month >= 3) expect(await n(`select count(*)::int as n from sm_cost_entries where org_id = $org and source = 'allocation'`)).toBeGreaterThan(0);
    // … the bank's budgets go to its own finance committee: the security budget awaits the IT finance manager (its owner
    // is the head of risk and security); the organisation's own committee, which approves real budgets, has nobody of the pack
    expect(await n(`select count(*)::int as n from sm_approvals a join sm_budgets b on b.id::text = a.record_id join sm_users u on u.id = a.approver_id
      where a.org_id = $org and a.table_key = 'budget' and a.state = 'requested' and b.state = 'submitted' and u.email like 'finance.%'`)).toBe(1);
    expect(await n(`select count(*)::int as n from sm_group_members m join sm_groups g on g.id = m.group_id join sm_users u on u.id = m.user_id
      where m.org_id = $org and g.name = 'کمیتهٔ مالی فناوری اطلاعات' and u.email like '%aftab-bank.example'`)).toBe(0);
    // customer service: the strategic merchant's escalation is about its open complaint
    expect(await n(`select count(*)::int as n from sm_case_escalations x join sm_customer_cases c on c.id = x.case_id join sm_customer_accounts a on a.id = c.account_id
      where x.org_id = $org and x.account_id = a.id and a.code = 'CUS-001' and c.complaint and c.state not in ('resolved', 'closed', 'cancelled')`)).toBe(1);
    // records named after a year carry the load's Jalali year (the pack's dates are all relative to it)
    const jy = periodKeyOf(new Date().toISOString().slice(0, 10)).slice(0, 4);
    expect((await e.db.one<{ name: string }>(`select name from sm_portfolios where org_id = $1 and code = 'PF-DT'`, [e.org]))?.name).toBe(`تحول دیجیتال بانک ${faDigits(jy)}`);
    expect((await e.db.one<{ edition: string }>(`select edition from sm_grc_frameworks where org_id = $1 and key = 'aftab_bank_controls'`, [e.org]))?.edition).toBe(jy);
    expect(await e.db.one(`select 1 from sm_finance_cases where org_id = $1 and invoice_no = $2`, [e.org, `INV-${jy}-0218`])).toBeTruthy();
    // events: the pipeline raised an incident from the critical alert of the card switch
    expect(await n(`select count(*)::int as n from sm_alerts where org_id = $org and incident_id is not null and severity = 'critical'`)).toBeGreaterThan(0);
    // field service: the module generated the first occurrence of each region's plan
    expect(await n(`select count(*)::int as n from sm_work_orders where org_id = $org and maintenance_plan_id is not null`)).toBeGreaterThan(0);
    expect(await n(`select count(distinct category)::int as n from sm_assets where org_id = $org and deleted_at is null and category in ('atm', 'crs', 'pos', 'desktop', 'passbook_printer', 'network', 'server')`)).toBe(7);
    expect(await n(`select count(*)::int as n from sm_assets where org_id = $org and category = 'pos' and terminal_id is not null and psp is not null and merchant_id is not null`)).toBeGreaterThan(0);
    expect(await n(`select count(distinct os_eos_date)::int as n from sm_assets where org_id = $org and category = 'atm' and os_eos_date is not null`)).toBeGreaterThan(1);
    expect(await n(`select count(*)::int as n from sm_assets where org_id = $org and category = 'atm' and branch_id is not null and support_contract_id is not null and site_type is not null`)).toBeGreaterThan(0);
    expect(await n(`select count(*)::int as n from sm_maintenance_slas where org_id = $org`)).toBe(1);
    expect(await n(`select count(*)::int as n from sm_device_status_events where org_id = $org and to_at is not null and minutes > 0`)).toBeGreaterThan(0);
    expect(await n(`select count(*)::int as n from sm_device_status_events where org_id = $org and to_at is null and status <> 'in_service' and incident_id is not null`)).toBeGreaterThan(0);
    const states = (await e.db.query<{ state: string }>(`select distinct state from sm_asset_transfers where org_id = $1`, [e.org])).map((r) => r.state).sort();
    expect(states).toEqual(["approved", "draft", "in_transit", "pending_approval", "received", "received_partial", "rejected"]);
    // separation of duties: who asked, who approved and who received are three people
    const done = await e.db.query<{ requested_by: string; created_by: string; dispatched_by: string; received_by: string }>(`select requested_by, created_by, dispatched_by, received_by from sm_asset_transfers where org_id = $1 and state in ('received', 'received_partial')`, [e.org]);
    expect(done.length).toBeGreaterThan(0);
    for (const t of done) {
      expect(t.received_by).toBeTruthy();
      expect([t.requested_by, t.created_by, t.dispatched_by]).not.toContain(t.received_by);
    }
    const attestations = (await e.db.query<{ state: string; overdue: boolean }>(`select state, overdue from sm_branch_attestations where org_id = $1`, [e.org]));
    expect(attestations.some((x) => x.state === "attested")).toBe(true);
    expect(attestations.some((x) => x.state === "attested_exceptions")).toBe(true);
    expect(attestations.some((x) => x.state === "open" && x.overdue)).toBe(true);
    expect(await n(`select count(*)::int as n from sm_inventory_audits where org_id = $org and state = 'completed' and discrepancy_open > 0`)).toBe(1);
    const wiped = await e.db.query<{ asset_id: string; sanitized_by: string; witness_id: string; certificate_hash: string | null; verified: boolean }>(`select asset_id, sanitized_by, witness_id, certificate_hash, verified from sm_disposal_items where org_id = $1`, [e.org]);
    expect(wiped.length).toBeGreaterThan(0);
    for (const w of wiped) {
      expect(w.certificate_hash).toBeTruthy();
      expect(w.witness_id).toBeTruthy();
      expect(w.sanitized_by).not.toBe(w.witness_id);
      expect(w.verified).toBe(true);
    }
    // the custody chain is keyed (written only by the module's services with this runtime's secret)
    expect(await n(`select count(*)::int as n from sm_asset_custody where org_id = $org and hash not like 'k1:%'`)).toBe(0);
    expect(await n(`select count(*)::int as n from sm_assets where org_id = $org and state = 'disposed'`)).toBe(wiped.length);
    // every custody chain the workflows wrote is intact
    const sys = await systemCtx(e.cfg, e.org);
    const moved = await e.db.query<{ asset_id: string }>(`select distinct asset_id from sm_asset_custody where org_id = $1 and event in ('dispatched', 'received', 'transfer_missing', 'attested', 'wiped', 'audited')`, [e.org]);
    expect(moved.length).toBeGreaterThan(0);
    for (const m of moved.slice(0, 30)) expect((await verifyCustody(e.db, sys, m.asset_id)).ok).toBe(true);
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
    // bank ITAM: the branch's asset officer reads their branch's assets only; a requester no transfers or attestations
    const branch = await persona("branch");
    const unit = (await e.db.one<{ org_unit_id: string }>(`select org_unit_id from sm_member_profiles where org_id = $1 and user_id = $2`, [e.org, branch.id]))!.org_unit_id;
    const theirs = await rowsOf(branch.c, "asset");
    const assets = (await e.db.one<{ n: number }>(`select count(*)::int as n from sm_assets where org_id = $1 and deleted_at is null`, [e.org]))!.n;
    expect(theirs.length).toBeGreaterThan(0);
    expect(theirs.length).toBeLessThan(assets);
    for (const r of theirs) expect(r.branch_id).toBe(unit);
    for (const t of await rowsOf(branch.c, "asset_transfer")) expect([t.from_branch_id, t.to_branch_id]).toContain(unit);
    expect(await rowsOf(requester.c, "asset_transfer")).toEqual([]);
    expect(await rowsOf(requester.c, "branch_attestation")).toEqual([]);
    expect(await rowsOf(requester.c, "maintenance_sla")).toEqual([]);
    await branch.c.get(`/o/${e.org}/demo`, 403);
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
    // the ITAM jobs over the demo fleet: the daily sweep (reminders, attestation periods and overdue flags),
    // depreciation into the cost ledger, the fleet's maintenance-SLA availability and penalties
    await itamSweep(sys);
    await openAttestations(sys);
    await financialSweep(sys);
    await fleet(sys, { days: 30 });
    // the CMDB's own scheduled health check over every CI, outside the demo scope (on a fast machine it also runs by
    // itself while the pack is loaded): the findings it raises about demo CIs, the predictions and history about those
    // findings, are about demo data and go with it
    await enqueue(e.db, { kind: "cmdb.health_all", orgId: e.org, payload: {}, dedupeKey: "cmdb.health_all:demo-proof" });
    await applyPolicies(sys);
    const models = await e.db.query<{ key: string }>(`select key from sm_ai_models where org_id = $1 and table_key = 'incident' order by key limit 2`, [e.org]);
    for (const m of models) await enqueue(e.db, { kind: "ai.ml.train", orgId: e.org, payload: { key: m.key }, dedupeKey: `ai.ml.train:${m.key}` });
    await archiveBatch(sys, TABLES.get("incident")!, 0, 20);
    // the rest of the bank: each module's own scheduled work over the demo data, outside the demo scope — customer
    // service (auto-close, account health), the departments, field service (maintenance generation, positions),
    // workforce (absences, certificates, profiles), service levels (measures, reviews), releases, monitoring,
    // continuity, security and GRC (control monitoring, KRIs, planned tests) and the portal (survey expiry)
    await csmSweep(e.cfg, e.org);
    await esmSweep(e.cfg, e.org);
    await fsmSweep(e.cfg, e.org);
    // a quarter later, with the pack still loaded: the field service's schedule generates the next visit of each demo
    // maintenance plan, outside the demo scope — what a demo definition generates is demo data and goes with it
    const nextVisits = await sys.write((tx) => generateMaintenanceIn(tx, sys, new Date(Date.now() + 92 * 86_400_000).toISOString().slice(0, 10)));
    expect(nextVisits, "the demo maintenance plans' next visits").toBeGreaterThan(0);
    await workforceSweep(sys);
    await slmSweep(sys);
    await releaseSweep(sys);
    await eventSweep(sys);
    await continuitySweep(sys);
    await securitySweep(sys);
    await portalSweep(sys);
    // demo people at work in the new modules (requests of the pack's people: demo work): a customer-service note, a
    // monitoring engineer acknowledging an alert of their team, the IT finance manager reversing a ledger entry
    const csm = await persona("csm");
    const kase = await e.db.one<{ id: string }>(`select id from sm_customer_cases where org_id = $1 and state not in ('closed', 'cancelled') and deleted_at is null order by opened_at desc limit 1`, [e.org]);
    await csm.c.post(`/o/${e.org}/r/customer_case/${kase!.id}/journal`, { kind: "comment", body: "با مدیر مالی پذیرنده تماس گرفته شد" });
    const ops = await persona("ops");
    const alert = await e.db.one<{ id: string }>(
      `select a.id from sm_alerts a join sm_event_sources s on s.id = a.source_id where a.org_id = $1 and a.state = 'open' and a.deleted_at is null and s.name like 'پایش خودپردازها%' and a.node like 'aft-switch-%' order by a.opened_at limit 1`, [e.org]);
    expect(alert, "an open card switch alert of the pack's monitoring").toBeTruthy();
    await ops.c.post(`/o/${e.org}/event/alerts/${alert!.id}/ack`, {});
    const finance = await persona("finance");
    const entry = await e.db.one<{ id: string }>(`select id from sm_cost_entries where org_id = $1 and source = 'contract' and not reversed and reversal_of is null and deleted_at is null order by entry_date limit 1`, [e.org]);
    await finance.c.post(`/o/${e.org}/financial/entries/${entry!.id}/reverse`, { reason: "ثبت تکراری قرارداد (نمایشی)" });
    // the real owner's note on a demo customer case (a side row of demo data, removed with it)
    await e.owner.post(`/o/${e.org}/r/customer_case/${kase!.id}/journal`, { kind: "work_note", body: "یادداشت مالک روی پروندهٔ نمایشی" });
    await settle(e, 180_000);
    // the platform's own computations over the pack: every XLA rescore and document ingestion ran
    await drain(e, ["slm.xla", "docs.ingest"]);
    log("exercised");
    const count = async (sql: string) => (await e.db.one<{ n: number }>(sql, [e.org]))!.n;
    // experience scores are the platform's (the SLM module's job), from the demo records: the bank's ATM policy scored the
    // ATM incidents, and survey answers of the pack's people rescored theirs
    expect(await count(`select count(*)::int as n from sm_slm_xla_scores s join sm_slm_xla_policies p on p.id = s.policy_id where s.org_id = $1 and p.name = 'تجربهٔ شعب و مشتریان از خرابی خودپرداز'`)).toBeGreaterThan(0);
    expect(await count(`select count(*)::int as n from sm_slm_xla_scores where org_id = $1 and survey`)).toBeGreaterThan(0);
    // the AI library read and indexed the bank's documents
    expect(await count(`select count(*)::int as n from sm_doc_documents where org_id = $1 and status = 'ready'`)).toBe(4);
    expect(await count(`select count(*)::int as n from sm_ai_chunks where org_id = $1 and table_key = 'doc_document'`)).toBeGreaterThan(0);
    // nothing about the pack left the system (every module's notifications included: customer notices, on-call paging,
    // survey invitations, case updates…): no e-mail, SMS or other delivery about a demo record or to a demo person was
    // sent, held for later or attempted, and no real person got a bell about a demo record
    const demoRow = (col: string) => `exists (select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id = l.${col})`;
    const leaks = await e.db.query<{ channel: string; status: string; reason: string | null; table_key: string | null }>(
      `select l.channel, l.status, l.reason, l.table_key from sm_notification_log l
        where l.org_id = $1 and l.status <> 'skipped'
          and ((l.channel <> 'in_app' and (${demoRow("record_id")} or ${demoRow("recipient_id")}))
            or (l.channel = 'in_app' and ${demoRow("record_id")} and l.recipient_id is not null and not ${demoRow("recipient_id")}))
        limit 20`,
      [e.org],
    );
    expect(leaks).toEqual([]);
    expect(await count(`select count(*)::int as n from sm_notification_log l where l.org_id = $1 and l.channel <> 'in_app' and l.reason = 'demo'`), "deliveries held back as demo").toBeGreaterThan(0);
    const rows = await e.db.one<{ n: number }>(`select count(*)::int as n from sm_demo_rows where org_id = $1`, [e.org]);
    expect(rows!.n).toBeGreaterThan(1000);
    // the platform raised findings about demo CIs by itself (outside the demo scope): the purge must take them too
    const raised = await e.db.one<{ n: number }>(
      `select count(*)::int as n from sm_cmdb_findings f where f.org_id = $1 and f.created_by is null
         and exists (select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id = f.ci_id)
         and not exists (select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id = f.id)`, [e.org]);
    log(`findings the platform raised about demo CIs outside the demo scope: ${raised!.n}`);

    // ----- purge
    const demoRowIds = new Set((await e.db.query<{ id: string }>(`select row_id::text as id from sm_demo_rows where org_id = $1`, [e.org])).map((r) => r.id));
    const report = await e.owner.get(`/o/${e.org}/demo/report`);
    expect(report.rows).toBeGreaterThan(1000);
    // the console confirms the administrator's password right before the purge (sensitive administration, POST
    // /auth/reauth): on a busy machine this test's sign-up is older than the re-authentication window by now. Only its
    // effect here (a fresh `reauth_at`, bookkeeping above), so the security log keeps what the comparison below allows
    await e.db.query(`update sm_sessions set reauth_at = now() where user_id = $1`, [e.ownerId]);
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
    // the organisation's control monitoring (the security sweep above, outside the demo scope) raised no issue about the
    // pack's risk register: its risks were reviewed in the last months. (Issues other seeded controls raise over the
    // organisation's own data are its own work, REAL_WORK below.)
    const issues = [...(after.get("sm_grc_issues")?.keys() ?? [])].filter((k) => !before.get("sm_grc_issues")?.has(k));
    expect(await e.db.query(`select i.id from sm_grc_issues i join sm_grc_controls c on c.id = i.control_id where c.code = 'SEC-RM-01' and i.id::text = any($1::text[])`, [`{${issues.join(",")}}`])).toEqual([]);
    // the organisation's own work outside the demo scope stays (see REAL_WORK); the demo accounts' sign-in records stay
    const demoIds = new Set((await e.db.query<{ id: string }>(`select id::text as id from sm_users where email like '%aftab-bank.example'`)).map((r) => r.id));
    expect(demoIds.size).toBe(0);
    const kept = new Set<string>();
    // rows of the organisation's own work, made or changed meanwhile (their history stays with them)
    for (const t of REAL_WORK) for (const [k, h] of after.get(t) ?? []) if (before.get(t)?.get(k) !== h) kept.add(k);
    const allowed = async (line: string): Promise<boolean> => {
      const t = line.split(":")[0];
      if (REAL_WORK.has(t)) return true;
      const added = [...(after.get(t)?.keys() ?? [])].filter((k) => !before.get(t)?.has(k));
      const changed = [...(before.get(t)?.keys() ?? [])].filter((k) => !after.get(t)?.has(k) || after.get(t)!.get(k) !== before.get(t)!.get(k));
      if (RAG_INDEX.has(t)) {
        const ids = [...added, ...changed];
        const now = await e.db.query<{ id: string; record_id: string }>(`select id::text as id, record_id::text as record_id from ${t} where id::text = any($1::text[])`, [`{${ids.join(",")}}`]);
        const recordOf = new Map(now.map((r) => [r.id, r.record_id]));
        return ids.every((id) => kept.has(recordOf.get(id) ?? ragBefore.get(id) ?? ""));
      }
      if (changed.length) return false;
      if (t === "sm_history") {
        const recs = await e.db.query<{ record_id: string }>(`select record_id::text as record_id from sm_history where id::text = any($1::text[])`, [`{${added.join(",")}}`]);
        return recs.every((r) => kept.has(r.record_id));
      }
      if (t === "sm_security_events") {
        const rows = await e.db.query<{ email: string | null; kind: string }>(`select email, kind from sm_security_events where id::text = any($1::text[])`, [`{${added.join(",")}}`]);
        return rows.every((r) => !!r.email?.endsWith("aftab-bank.example") && r.kind === "sign_in");
      }
      return false;
    };
    // what the organisation's own work left names no demo row
    for (const t of REAL_WORK) {
      if (t === "sm_numbers") continue;
      const rows = await e.db.query<{ j: string }>(`select to_jsonb(x)::text as j from ${t} x where x.org_id = $1`, [e.org]);
      const named = rows.flatMap((r) => r.j.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []).filter((id) => demoRowIds.has(id));
      expect(named, `${t} names demo rows`).toEqual([]);
    }
    const all = diff(before, after);
    const differences: string[] = [];
    for (const d of all) if (!(await allowed(d))) differences.push(d);
    log(`left as the organisation's own work: ${all.filter((d) => !differences.includes(d)).join(" | ")}`);
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
    // (ids of rows that exist now: the organisation's own work left in place has its own record events)
    const known = new Set([...before.values(), ...after.values()].flatMap((m) => [...m.keys()]));
    const strays = newJobs.filter((j) => !jobsBefore.has(j.id)).filter((j) => (JSON.stringify(j.payload).match(uuid) ?? []).some((id) => !known.has(id) && id !== e.org && id !== e.ownerId));
    // what they are about, for the one who fixes it (a computed record made while the purge ran: tests/demo-computed.test.ts)
    for (const j of strays.slice(0, 5)) log(`stray job ${j.kind}: ${JSON.stringify(j.payload).slice(0, 300)}`);
    expect(strays.map((j) => j.kind)).toEqual([]);
    expect(newJobs.filter((j) => j.kind === "demo.load").length).toBe(0);
    // nothing names the pack any more
    expect((await e.db.query(`select 1 from sm_users where email like '%aftab-bank.example'`)).length).toBe(0);
    expect((await e.db.query(`select 1 from sm_demo_rows`)).length).toBe(0);
  }, 1_800_000);
});
}
