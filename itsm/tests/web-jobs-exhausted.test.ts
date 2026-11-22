// Every stateful job kind has its exhausted hook (Kariz 1.1.5; the 27 entries of the 1.1.4 review's list). A job whose
// worker stopped during its last allowed attempt is failed by the queue without its handler (failExhausted), and one
// whose handler threw at its last attempt never reaches the rest of its handler — so without the kind's own last word
// its row would stay in its working state for good (a backup «running» refuses every later backup, a demo pack
// «loading», an agent run «queued» blocks the agent's next run on its record…) and a self-rescheduling chain would
// stop silently (the inbound mailbox, a directory synchronisation, a scheduled export, the nightly archival…).
// Each case here leaves what a worker that died at the job's last attempt leaves — the kind's row in its working state,
// the job `running` with its attempts used up and its lock expired — runs one tick, and checks the kind's decision:
// a final state for the row (with EXHAUSTED_ERROR), or the chain's next round queued at its normal interval.
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { EXHAUSTED_ERROR, enqueue, hasExhaustedHook, tick } from "@server/jobs";
import { createIn, systemCtx, updateIn } from "@server/engine";
import { createPostgresDb } from "@server/db/postgres";
import { createBackup } from "@server/modules/admin/backup";
import { requestExport } from "@server/modules/admin/exports";
import { memberCtx } from "@server/access";
import { startRun } from "@server/modules/ai/rag/indexer";
import { logDelivery } from "@server/modules/notify/log";
import { demoStatus } from "@server/modules/demo";
import type { AuthUser, Ctx, ServerConfig } from "@server/context";
import type { Db } from "@server/db";
import { makeServer, Client, signupWithOrg, quietLog, useServerDb } from "./helpers";
import { extraDatabase, realPg, realPgAvailable, type RealPg } from "./pg-real";

/**
 * The stateful kinds: each needs its decision when a job of it ends exhausted (the 1.1.4 review's list, with the
 * timers that sleep until their next time — SLA timers, approval reminders and expiry, the workflows' timer — and the
 * demo pack's tombstone removal).
 */
const STATEFUL_KINDS = [
  "admin.backup",
  "admin.export.run",
  "admin.import.run",
  "demo.load",
  "demo.purge",
  "ai.agent.run",
  "docs.ingest",
  "rag.backfill",
  "rag.reconcile",
  "notify.flush",
  "notify.send",
  "notify.hook",
  "notify.imap",
  "integration.webhook.deliver",
  "integration.directory.sync",
  "integration.export.run",
  "flows.run",
  "flows.resume",
  "flows.timer",
  "flows.recheck",
  "process.cancel_run",
  "portal.channel.message",
  "esm.order",
  "event.escalate",
  "itam.reconcile",
  "itam.sw_sync",
  "itam.sweep",
  "discovery.push_batch",
  "discovery.sweep",
  "admin.sweep",
  "engine.archive",
  "ai.agents.schedule",
  "ai.skills.schedule",
  "sla.timer",
  "approval.timer",
  "process.timer",
  "demo.finalize",
];

const editions = realPgAvailable() ? ["PGlite", "PostgreSQL"] : ["PGlite"];

for (const edition of editions) {
  describe(`the stateful kinds' exhausted hooks (${edition})`, () => {
    let pg: RealPg | null = null;
    let db: Db;
    let cfg: ServerConfig;
    let org = "";
    let user: AuthUser;
    let sys: Ctx;
    const warnings: string[] = [];

    beforeAll(async () => {
      if (edition === "PostgreSQL") {
        pg = await realPg("exhausted");
        const url = await extraDatabase(pg, `exhausted_${process.pid}`);
        useServerDb(async () => createPostgresDb({ url, ssl: false, max: 6 }));
      }
      const s = await makeServer();
      useServerDb(null);
      db = s.db;
      org = await signupWithOrg(new Client(s.app));
      const u = await db.one<{ id: string; email: string }>(`select id, email from sm_users limit 1`);
      user = { id: u!.id, email: u!.email } as AuthUser;
      cfg = { mode: "cloud", db, secret: "t", allowSignup: true, platformAdmins: [u!.email], origin: "cloud", log: { ...quietLog, warn: (m: string) => void warnings.push(m) }, fetch };
      sys = await systemCtx(cfg, org);
      // nothing but each case's own job runs: the new organisation's seeds and record events are not due
      await db.query(`update sm_jobs set status = 'done', done_at = now() where status = 'queued'`);
    }, 240_000);
    afterAll(async () => {
      await db?.close().catch(() => undefined);
      await pg?.stop();
    }, 120_000);
    afterEach(async () => {
      warnings.length = 0;
      await db.query(`delete from sm_jobs where status in ('queued', 'running') or kind like 'test.%'`);
    });

    /** Nothing but the case's own job runs: the record events of the case's setup are left out. */
    const quiet = () => db.query(`update sm_jobs set status = 'done', done_at = now() where status = 'queued'`);
    /** What a worker that died during the job's last allowed attempt leaves. Returns the job's id. */
    async function diedAtLastAttempt(kind: string, payload: Record<string, unknown>, opts: { maxAttempts?: number; dedupeKey?: string; orgId?: string | null } = {}): Promise<string> {
      await quiet();
      const id = await enqueue(db, { kind, orgId: opts.orgId === undefined ? org : opts.orgId, payload, maxAttempts: opts.maxAttempts ?? 3, dedupeKey: opts.dedupeKey });
      await db.query(`update sm_jobs set status = 'running', attempts = max_attempts, locked_by = 'w-dead', locked_until = now() - interval '1 minute' where id = $1`, [id]);
      return id;
    }
    const run = () => tick(cfg, { budgetMs: 15_000, cleanup: false });
    const jobRow = (id: string) => db.one<{ status: string; last_error: string | null }>(`select status, last_error from sm_jobs where id = $1`, [id]);
    /** The kind's queued next round: its delay from now (minutes), or null. */
    async function nextRound(kind: string, dedupeKey: string): Promise<number | null> {
      const r = await db.one<{ minutes: number }>(
        `select round(extract(epoch from run_at - now()) / 60)::int as minutes from sm_jobs where org_id = $1 and kind = $2 and dedupe_key = $3 and status = 'queued'`,
        [org, kind, dedupeKey],
      );
      return r ? Number(r.minutes) : null;
    }
    async function expectFailed(id: string) {
      expect(await jobRow(id)).toMatchObject({ status: "failed", last_error: EXHAUSTED_ERROR });
      expect(warnings.filter((w) => w.includes("exhausted hook failed"))).toEqual([]);
    }

    it("every stateful kind has its exhausted hook", () => {
      expect(STATEFUL_KINDS.filter((k) => !hasExhaustedHook(k))).toEqual([]);
    });

    // ----- rows put in a final state

    it("admin.backup: the backup ends «failed» with the reason, and the next backup of the organisation can be made", async () => {
      const b = await createBackup(cfg, user, org, "شبانه");
      await db.query(`update sm_backups set status = 'running' where id = $1`, [b.id]);
      const job = await db.one<{ id: string }>(`select id from sm_jobs where kind = 'admin.backup' and payload->>'id' = $1`, [b.id]);
      await db.query(`update sm_jobs set status = 'done', done_at = now() where status = 'queued' and id <> $1`, [job!.id]);
      await db.query(`update sm_jobs set status = 'running', attempts = max_attempts, locked_by = 'w-dead', locked_until = now() - interval '1 minute' where id = $1`, [job!.id]);
      await run();
      await expectFailed(job!.id);
      const row = await db.one<{ status: string; error: string | null; finished_at: string | null }>(`select status, error, finished_at from sm_backups where id = $1`, [b.id]);
      expect(row).toMatchObject({ status: "failed", error: EXHAUSTED_ERROR });
      expect(row!.finished_at).not.toBeNull();
      await expect(createBackup(cfg, user, org, "دوباره")).resolves.toMatchObject({ status: "queued" });
      await db.query(`delete from sm_backups where org_id = $1`, [org]);
    });

    it("admin.export.run: the export ends «failed» with the reason (no «ready» notice)", async () => {
      const ctx = await memberCtx(cfg, org, user.id);
      const row = await requestExport(ctx, { tables: ["todo"], format: "csv" });
      const job = await db.one<{ id: string }>(`select id from sm_jobs where kind = 'admin.export.run' and payload->>'id' = $1`, [row.id]);
      await db.query(`update sm_jobs set status = 'done', done_at = now() where status = 'queued' and id <> $1`, [job!.id]);
      await db.query(`update sm_jobs set status = 'running', attempts = max_attempts, locked_by = 'w-dead', locked_until = now() - interval '1 minute' where id = $1`, [job!.id]);
      await run();
      await expectFailed(job!.id);
      expect(await db.one(`select status, error from sm_data_exports where id = $1`, [row.id])).toEqual({ status: "failed", error: EXHAUSTED_ERROR });
      expect(await db.one(`select 1 from sm_jobs where kind = 'record.export_ready'`)).toBeNull();
    });

    it("admin.import.run: the scheduled import ends «failed» and its next run is queued at its interval", async () => {
      const set = await sys.write((tx) => createIn(tx, sys, "import_set", { name: "واردات شبانه", target_table: "todo", source: "url", schedule_hours: 24, status: "running", created_by: user.id }, { trusted: true }));
      const id = await diedAtLastAttempt("admin.import.run", { id: set.id }, { dedupeKey: `import:${set.id}` });
      await run();
      await expectFailed(id);
      expect(await db.one(`select status, last_error from sm_import_sets where id = $1`, [set.id])).toEqual({ status: "failed", last_error: EXHAUSTED_ERROR });
      expect(await nextRound("admin.import.run", `import:${set.id}`)).toBe(24 * 60);
    });

    it("demo.load: the pack's load ends «failed» with the reason (the console then offers its purge)", async () => {
      await db.query(`insert into sm_demo_packs (org_id, state, size) values ($1, 'loading', 'small') on conflict (org_id) do update set state = 'loading', error = null, progress = '{}'::jsonb`, [org]);
      const id = await diedAtLastAttempt("demo.load", { __demo: true }, { dedupeKey: "demo.load" });
      await db.query(`insert into sm_demo_rows (org_id, row_id, tbl) values ($1, $2, 'sm_jobs')`, [org, id]);
      await run();
      await expectFailed(id);
      expect(await db.one(`select state, error from sm_demo_packs where org_id = $1`, [org])).toEqual({ state: "failed", error: EXHAUSTED_ERROR });
      await db.query(`delete from sm_demo_rows where org_id = $1`, [org]);
      await db.query(`delete from sm_demo_packs where org_id = $1`, [org]);
    });

    it("demo.purge: the purge goes on from its phase an hour later, and the console says it stopped", async () => {
      await db.query(
        `insert into sm_demo_packs (org_id, state, size, progress) values ($1, 'purging', 'small', '{"purge":"clear"}'::jsonb)
         on conflict (org_id) do update set state = 'purging', progress = '{"purge":"clear"}'::jsonb`,
        [org],
      );
      const id = await diedAtLastAttempt("demo.purge", { by: null }, { maxAttempts: 20, dedupeKey: "demo.purge" });
      await run();
      await expectFailed(id);
      expect(await nextRound("demo.purge", "demo.purge")).toBe(60);
      const pack = await db.one<{ state: string; progress: Record<string, unknown> }>(`select state, progress from sm_demo_packs where org_id = $1`, [org]);
      expect(pack).toMatchObject({ state: "purging", progress: { purge: "clear", stopped: EXHAUSTED_ERROR } });
      expect((await demoStatus(db, org)).progress?.label).toContain("یک ساعت");
      await db.query(`delete from sm_demo_packs where org_id = $1`, [org]);
    });

    it("ai.agent.run: the run ends «failed» (a queued twin no longer blocks the agent's next run on its record)", async () => {
      const r = await sys.write((tx) => createIn(tx, sys, "ai_agent_run", { agent_key: "test", agent_name: "آزمون", trigger: "event", status: "running", steps: [], proposals: [], state: { messages: [] } }, { trusted: true }));
      const id = await diedAtLastAttempt("ai.agent.run", { run: r.id }, { dedupeKey: `agent.run:${r.id}` });
      await run();
      await expectFailed(id);
      const row = await db.one<{ status: string; error: string | null; ended_at: string | null }>(`select status, error, ended_at from sm_ai_agent_runs where id = $1`, [r.id]);
      expect(row).toMatchObject({ status: "failed", error: EXHAUSTED_ERROR });
      expect(row!.ended_at).not.toBeNull();
    });

    it("docs.ingest: a document still «ingesting» ends «failed» with the reason", async () => {
      const c = await sys.write((tx) => createIn(tx, sys, "doc_collection", { name: "اسناد آزمون", classification: "internal", owner_id: user.id, sharing: "private" }, { trusted: true }));
      const d = await sys.write((tx) => createIn(tx, sys, "doc_document", { title: "راهنما", collection_id: c.id, status: "ingesting" }, { trusted: true }));
      const id = await diedAtLastAttempt("docs.ingest", { id: d.id }, { maxAttempts: 5, dedupeKey: `docs.ingest:${d.id}` });
      await run();
      await expectFailed(id);
      expect(await db.one(`select status, error from sm_doc_documents where id = $1`, [d.id])).toEqual({ status: "failed", error: EXHAUSTED_ERROR });
    });

    it("rag.backfill and rag.reconcile: the index run ends with the reason; the nightly reconciliation is queued again", async () => {
      const backfill = await startRun(db, org, "backfill");
      const a = await diedAtLastAttempt("rag.backfill", { run: backfill }, { maxAttempts: 5, dedupeKey: "rag.backfill:*" });
      const nightly = await startRun(db, org, "reconcile");
      const b = await diedAtLastAttempt("rag.reconcile", { run: nightly }, { maxAttempts: 5, dedupeKey: "rag.reconcile" });
      await run();
      await expectFailed(a);
      await expectFailed(b);
      for (const r of [backfill, nightly]) {
        const row = await db.one<{ finished_at: string | null; error: string | null }>(`select finished_at, error from sm_ai_rag_runs where id = $1`, [r]);
        expect(row!.finished_at).not.toBeNull();
        expect(row!.error).toBe(EXHAUSTED_ERROR.slice(0, 500));
      }
      expect(await nextRound("rag.reconcile", "rag.reconcile")).toBeGreaterThan(0);
    });

    it("notify.flush: the rows it held end «failed»; a later digest's rows are kept", async () => {
      const base = { org, event: "record.updated", channel: "email" as const, recipient_id: user.id, status: "held" as const };
      const claimed = await logDelivery(db, { ...base, reason: "digest", due_at: new Date(Date.now() - 60_000) });
      const later = await logDelivery(db, { ...base, reason: "digest", due_at: new Date(Date.now() + 86_400_000) });
      const id = await diedAtLastAttempt("notify.flush", { org, user: user.id, channel: "email", claimed: [claimed] });
      await run();
      await expectFailed(id);
      expect(await db.one(`select status, error from sm_notification_log where id = $1`, [claimed])).toEqual({ status: "failed", error: EXHAUSTED_ERROR });
      expect(await db.one(`select status from sm_notification_log where id = $1`, [later])).toEqual({ status: "held" });
    });

    it("notify.send and notify.hook: every channel not delivered gets its «failed» outcome with the reason", async () => {
      const rule = { key: "test.rule", name: "قاعدهٔ آزمون", event: "record.updated", channels: ["in_app", "email", "sms"], targets: [] };
      const ev = { table: "todo", id: "0190f0e0-0000-7000-8000-000000000001", number: "TD-1", at: new Date().toISOString() };
      const smsFailed = await logDelivery(db, { org, event: rule.event, channel: "sms", recipient_id: user.id, status: "failed", error: "درگاه پاسخ نداد", rule_key: rule.key, record_id: ev.id });
      const send = await diedAtLastAttempt("notify.send", { org, rule, ev, user: user.id, reasons: [], done: ["in_app"], logs: { sms: smsFailed } }, { maxAttempts: 8 });
      const hookLog = await logDelivery(db, { org, event: rule.event, channel: "webhook", status: "failed", error: "پیام‌رسان پاسخ نداد", rule_key: rule.key, record_id: ev.id });
      const hook = await diedAtLastAttempt("notify.hook", { org, rule, ev, channel: "0190f0e0-0000-7000-8000-000000000002", log: hookLog }, { maxAttempts: 8 });
      await run();
      await expectFailed(send);
      await expectFailed(hook);
      const rows = await db.query<{ channel: string; status: string; error: string | null }>(
        `select channel, status, error from sm_notification_log where org_id = $1 and rule_key = 'test.rule' order by channel`,
        [org],
      );
      expect(rows).toEqual([
        { channel: "email", status: "failed", error: EXHAUSTED_ERROR },
        { channel: "sms", status: "failed", error: EXHAUSTED_ERROR },
        { channel: "webhook", status: "failed", error: EXHAUSTED_ERROR },
      ]);
    });

    it("integration.webhook.deliver: the delivery goes to the dead-letter list («dead»), from where it can be replayed", async () => {
      const d = "0190f0e0-0000-7000-8000-0000000000d1";
      await db.query(`insert into sm_webhook_deliveries (id, org_id, subscription_id, event, table_key, status) values ($1, $2, gen_random_uuid(), 'created', 'todo', 'pending')`, [d, org]);
      const id = await diedAtLastAttempt("integration.webhook.deliver", { id: d }, { maxAttempts: 6 });
      await run();
      await expectFailed(id);
      expect(await db.one(`select status, error, next_retry_at from sm_webhook_deliveries where id = $1`, [d])).toEqual({ status: "dead", error: EXHAUSTED_ERROR, next_retry_at: null });
    });

    it("flows.run (and resume, timer, recheck): the run ends «failed» with the reason, its lease free", async () => {
      for (const kind of ["flows.run", "flows.resume", "flows.timer", "flows.recheck"]) {
        const r = await db.one<{ id: string }>(
          `insert into sm_flow_runs (id, org_id, flow_id, flow_name, state, trigger_kind, lease_by, lease_until) values (gen_random_uuid(), $1, gen_random_uuid(), 'گردش آزمون', 'waiting', 'manual', 'w-dead', now() - interval '1 minute') returning id`,
          [org],
        );
        const id = await diedAtLastAttempt(kind, { run: r!.id, wait: "0190f0e0-0000-7000-8000-0000000000f1" }, { maxAttempts: 20 });
        await run();
        await expectFailed(id);
        const row = await db.one<{ state: string; error: string | null; ended_at: string | null; lease_by: string | null }>(`select state, error, ended_at, lease_by from sm_flow_runs where id = $1`, [r!.id]);
        expect(row, kind).toMatchObject({ state: "failed", error: EXHAUSTED_ERROR, lease_by: null });
        expect(row!.ended_at).not.toBeNull();
      }
    });

    it("flows: a run another worker still steps (its lease live) is left alone", async () => {
      const r = await db.one<{ id: string }>(
        `insert into sm_flow_runs (id, org_id, flow_id, flow_name, state, trigger_kind, lease_by, lease_until) values (gen_random_uuid(), $1, gen_random_uuid(), 'گردش زنده', 'running', 'manual', 'w-live', now() + interval '2 minutes') returning id`,
        [org],
      );
      const id = await diedAtLastAttempt("flows.run", { run: r!.id }, { maxAttempts: 20 });
      await run();
      await expectFailed(id);
      expect(await db.one(`select state from sm_flow_runs where id = $1`, [r!.id])).toEqual({ state: "running" });
    });

    it("process.cancel_run: the canceled case's run is canceled", async () => {
      const r = await db.one<{ id: string }>(
        `insert into sm_flow_runs (id, org_id, flow_id, flow_name, state, trigger_kind) values (gen_random_uuid(), $1, gen_random_uuid(), 'پرونده', 'waiting', 'process') returning id`,
        [org],
      );
      const id = await diedAtLastAttempt("process.cancel_run", { run: r!.id }, { maxAttempts: 10 });
      await run();
      await expectFailed(id);
      expect(await db.one(`select state from sm_flow_runs where id = $1`, [r!.id])).toEqual({ state: "canceled" });
    });

    it("portal.channel.message: the message ends «failed» and the chat is told to send it again, once", async () => {
      const ch = await sys.write((tx) => createIn(tx, sys, "portal_channel", { name: "پیام‌رسان آزمون", kind: "webhook", auth_mode: "header", outbound_url: "http://127.0.0.1:9/send" }, { trusted: true }));
      const log = "0190f0e0-0000-7000-8000-0000000000c1";
      await db.query(`insert into sm_portal_channel_log (id, org_id, channel_id, direction, status, message_key, external_id, text) values ($1, $2, $3, 'in', 'received', 'k1', 'u1', 'سلام')`, [log, org, ch.id]);
      const id = await diedAtLastAttempt("portal.channel.message", { channel: ch.id, log, chat: "c1", from: "u1", name: "" });
      await run();
      await expectFailed(id);
      expect(await db.one(`select status, error from sm_portal_channel_log where id = $1`, [log])).toEqual({ status: "failed", error: EXHAUSTED_ERROR });
      // the reply was tried (the receiver here refuses the connection: logged as a failed send), once
      const out = await db.query<{ status: string }>(`select status from sm_portal_channel_log where org_id = $1 and channel_id = $2 and direction = 'out'`, [org, ch.id]);
      expect(out).toHaveLength(1);
    });

    it("event.escalate: the alert's escalation stops (no longer «running» with a due level nobody will run), with a note", async () => {
      const a = await sys.write((tx) => createIn(tx, sys, "alert", { short_description: "سرور پاسخ نمی‌دهد", severity: "major" }, { trusted: true }));
      await sys.write((tx) => updateIn(tx, sys, "alert", String(a.id), { escalation_state: "running", escalation_round: 1, next_escalation_at: new Date(Date.now() - 60_000).toISOString() }, { trusted: true, keepVersion: true }));
      const id = await diedAtLastAttempt("event.escalate", { alert: a.id, round: 1, rep: 0, index: 0 }, { maxAttempts: 6, dedupeKey: `event.esc:${a.id}:1` });
      await run();
      await expectFailed(id);
      expect(await db.one(`select escalation_state, next_escalation_at from sm_alerts where id = $1`, [a.id])).toEqual({ escalation_state: "stopped", next_escalation_at: null });
    });

    it("itam.reconcile, itam.sw_sync and itam.sweep: the reconciliation run they left «running» ends «failed»", async () => {
      for (const kind of ["itam.reconcile", "itam.sw_sync", "itam.sweep"]) {
        const r = await sys.write((tx) => createIn(tx, sys, "license_reconcile_run", { status: "running", trigger: "change", started_at: new Date().toISOString() }, { trusted: true }));
        const id = await diedAtLastAttempt(kind, { trigger: "change", reconcile_run: r.id });
        await run();
        await expectFailed(id);
        expect(await db.one(`select status, error from sm_license_reconcile_runs where id = $1`, [r.id]), kind).toEqual({ status: "failed", error: EXHAUSTED_ERROR.slice(0, 500) });
      }
    });

    it("discovery.push_batch: the pushed batch ends «failed» with the reason, and the snapshot it belongs to is abandoned", async () => {
      const conn = await sys.write((tx) => createIn(tx, sys, "discovery_connector", { name: "ابزار پایش", kind: "zabbix" }, { trusted: true }));
      const b = await sys.write((tx) => createIn(tx, sys, "discovery_batch", { connector_id: conn.id, batch_id: "b-1", state: "reconciling" }, { trusted: true }));
      const id = await diedAtLastAttempt("discovery.push_batch", { connector: conn.id, batch: b.id, new: [], changed: [] }, { maxAttempts: 8 });
      await run();
      await expectFailed(id);
      const row = await db.one<{ state: string; result: Record<string, any> | null }>(`select state, result from sm_discovery_batches where id = $1`, [b.id]);
      // what the sender's status address shows (batchView): «failed» with the reason among the errors
      expect(row!.state).toBe("failed");
      expect(row!.result?.errors).toEqual([{ index: -1, message: EXHAUSTED_ERROR }]);
      // part 2 of a snapshot of two: part 1 done, waiting for this part's records to be reconciled — without its end the
      // snapshot would never be finalised nor abandoned (part 1's job looks again every 15 seconds for good)
      const p1 = await sys.write((tx) => createIn(tx, sys, "discovery_batch", { connector_id: conn.id, batch_id: "s-1", state: "done", snapshot_id: "snap-1", part: 1, parts: 2 }, { trusted: true }));
      const p2 = await sys.write((tx) => createIn(tx, sys, "discovery_batch", { connector_id: conn.id, batch_id: "s-2", state: "reconciling", snapshot_id: "snap-1", part: 2, parts: 2 }, { trusted: true }));
      const id2 = await diedAtLastAttempt("discovery.push_batch", { connector: conn.id, batch: p2.id, new: [], changed: [] }, { maxAttempts: 8 });
      await run();
      await expectFailed(id2);
      const parts = await db.query<{ id: string; state: string; snap: string | null }>(`select id, state, result->>'snapshot_state' as snap from sm_discovery_batches where snapshot_id = 'snap-1' order by part`);
      expect(parts).toEqual([
        { id: p1.id, state: "done", snap: "abandoned" },
        { id: p2.id, state: "failed", snap: "abandoned" },
      ]);
    });

    // ----- chains queued again at their normal interval

    it("notify.imap: the mailbox's poller is queued again after a back-off and owns the channel; the error is on the channel", async () => {
      const ch = await sys.write((tx) => createIn(tx, sys, "email_channel", { name: "صندوق پشتیبانی", from_address: "help@example.test", inbound: true, imap_host: "imap.example.test", imap_user: "help" }, { trusted: true }));
      const id = await diedAtLastAttempt("notify.imap", { org, channel: ch.id }, { dedupeKey: `notify.imap:${ch.id}` });
      await db.query(
        `insert into sm_notify_state (org_id, key, data) values ($1, $2, jsonb_build_object('poller', $3::text)) on conflict (org_id, key) do update set data = jsonb_build_object('poller', $3::text)`,
        [org, `imap:${ch.id}`, id],
      );
      await run();
      await expectFailed(id);
      expect(await nextRound("notify.imap", `notify.imap:${ch.id}`)).toBe(30);
      const state = await db.one<{ data: Record<string, unknown> }>(`select data from sm_notify_state where org_id = $1 and key = $2`, [org, `imap:${ch.id}`]);
      const next = await db.one<{ id: string }>(`select id from sm_jobs where kind = 'notify.imap' and status = 'queued' and dedupe_key = $1`, [`notify.imap:${ch.id}`]);
      expect(state!.data).toMatchObject({ poller: next!.id, last_error: EXHAUSTED_ERROR });
    });

    it("integration.directory.sync: the run is recorded «failed», the source «failing», and the next sync queued at its interval", async () => {
      const src = await sys.write((tx) => createIn(tx, sys, "directory_source", { name: "دامنهٔ بانک", kind: "ldap", mode: "apply", schedule_hours: 6 }, { trusted: true }));
      const id = await diedAtLastAttempt("integration.directory.sync", { id: src.id }, { maxAttempts: 2, dedupeKey: `directory:${src.id}` });
      await run();
      await expectFailed(id);
      expect(await db.one(`select status, error from sm_directory_runs where source_id = $1`, [src.id])).toEqual({ status: "failed", error: EXHAUSTED_ERROR });
      expect(await db.one(`select health from sm_directory_sources where id = $1`, [src.id])).toEqual({ health: "failing" });
      expect(await nextRound("integration.directory.sync", `directory:${src.id}`)).toBe(6 * 60);
    });

    it("integration.export.run: the schedule shows the failure and its next run is queued at its interval", async () => {
      const principal = await sys.write((tx) => createIn(tx, sys, "integration_user", { name: "انبار داده" }, { trusted: true }));
      const s = await sys.write((tx) => createIn(tx, sys, "export_schedule", { name: "خروجی انبار داده", tables: ["todo"], principal_id: principal.id, every_hours: 12 }, { trusted: true }));
      const id = await diedAtLastAttempt("integration.export.run", { id: s.id }, { maxAttempts: 2, dedupeKey: `export:${s.id}` });
      await run();
      await expectFailed(id);
      expect(await db.one(`select health, last_status from sm_export_schedules where id = $1`, [s.id])).toEqual({ health: "failing", last_status: EXHAUSTED_ERROR.slice(0, 300) });
      expect(await nextRound("integration.export.run", `export:${s.id}`)).toBe(12 * 60);
    });

    it("discovery.sweep, admin.sweep, ai.agents.schedule, ai.skills.schedule: the chain is queued again at its interval", async () => {
      const chains: [string, number, number][] = [
        ["discovery.sweep", 5, 15],
        ["admin.sweep", 3, 24 * 60],
        ["ai.agents.schedule", 8, 15],
        ["ai.skills.schedule", 8, 15],
      ];
      for (const [kind, maxAttempts, minutes] of chains) {
        const id = await diedAtLastAttempt(kind, {}, { maxAttempts, dedupeKey: kind });
        await run();
        await expectFailed(id);
        expect(await nextRound(kind, kind), kind).toBe(minutes);
      }
    });

    it("sla.timer, approval.timer, process.timer, demo.finalize: the timer is looked at again after its back-off", async () => {
      const id = "0195f0c4-6f2a-7c3e-9d41-2b7a5e8c1f03";
      const timers: [string, Record<string, unknown>, string, number, number][] = [
        ["sla.timer", { id }, `sla.timer:${id}`, 10, 15],
        ["approval.timer", { table: "incident", id }, `approval.timer:incident:${id}`, 10, 15],
        ["process.timer", {}, "process.timer", 50, 60],
        ["demo.finalize", {}, "demo.finalize", 8, 60],
      ];
      for (const [kind, payload, dedupeKey, maxAttempts, minutes] of timers) {
        const job = await diedAtLastAttempt(kind, payload, { maxAttempts, dedupeKey });
        await run();
        await expectFailed(job);
        expect(await nextRound(kind, dedupeKey), kind).toBe(minutes);
      }
    });

    it("engine.archive: the nightly archival is queued for the next night while it is switched on, and not when it is off", async () => {
      const off = await diedAtLastAttempt("engine.archive", {}, { maxAttempts: 5, dedupeKey: "engine.archive" });
      await run();
      await expectFailed(off);
      expect(await nextRound("engine.archive", "engine.archive")).toBeNull();
      await db.query(`update sm_orgs set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{archive}', '{"enabled": true, "years": 3}'::jsonb) where id = $1`, [org]);
      const on = await diedAtLastAttempt("engine.archive", {}, { maxAttempts: 5, dedupeKey: "engine.archive" });
      await run();
      await expectFailed(on);
      const minutes = await nextRound("engine.archive", "engine.archive");
      expect(minutes).toBeGreaterThan(0);
      expect(minutes).toBeLessThanOrEqual(24 * 60);
      await db.query(`update sm_orgs set settings = settings - 'archive' where id = $1`, [org]);
    });

    // ----- a read that failed once does not end a chain (its only clock): only the organisation gone does

    /**
     * The database, with the organisation's read failing once — a connection reset, a pooler that did not answer (or
     * never, `fail: false`). A database object of its own: the mailbox's cached system context (per database, 5 s) is
     * not reused.
     */
    function orgReadFailsOnce(fail = true): Db {
      let failed = !fail;
      return new Proxy(db, {
        get(target, prop) {
          const v = Reflect.get(target, prop);
          if ((prop === "one" || prop === "query") && typeof v === "function") {
            return (text: string, params?: unknown[]) => {
              if (!failed && /from sm_orgs where id = \$1 and deleted_at is null/.test(text)) {
                failed = true;
                return Promise.reject(new Error("Connection terminated unexpectedly"));
              }
              return v.call(target, text, params);
            };
          }
          return typeof v === "function" ? v.bind(target) : v;
        },
      }) as Db;
    }
    const jobOf = (id: string) => db.one<{ status: string; attempts: number; last_error: string | null }>(`select status, attempts, last_error from sm_jobs where id = $1`, [id]);

    for (const [kind, payload] of [
      ["notify.imap", (ch: string) => ({ org, channel: ch })],
      ["engine.archive", () => ({})],
    ] as const) {
      it(`${kind}: a failed read of the organisation is tried again (the chain goes on); the organisation gone ends it`, async () => {
        const ch = await sys.write((tx) => createIn(tx, sys, "email_channel", { name: `صندوق ${kind}`, from_address: "desk@example.test", inbound: true, imap_host: "imap.example.test", imap_user: "desk" }, { trusted: true }));
        await quiet();
        const dedupeKey = kind === "notify.imap" ? `notify.imap:${ch.id}` : kind;
        const id = await enqueue(db, { kind, orgId: org, payload: payload(String(ch.id)), dedupeKey, maxAttempts: 3 });
        if (kind === "notify.imap") {
          await db.query(
            `insert into sm_notify_state (org_id, key, data) values ($1, $2, jsonb_build_object('poller', $3::text)) on conflict (org_id, key) do update set data = jsonb_build_object('poller', $3::text)`,
            [org, `imap:${ch.id}`, id],
          );
        }
        await tick({ ...cfg, db: orgReadFailsOnce() }, { budgetMs: 15_000, cleanup: false });
        expect(await jobOf(id)).toMatchObject({ status: "queued", attempts: 1, last_error: "Connection terminated unexpectedly" });
        // the organisation gone (deleted): the chain ends there
        await db.query(`update sm_jobs set run_at = now() - interval '1 second' where id = $1`, [id]);
        await db.query(`update sm_orgs set deleted_at = now() where id = $1`, [org]);
        try {
          await tick({ ...cfg, db: orgReadFailsOnce(false) }, { budgetMs: 15_000, cleanup: false });
        } finally {
          await db.query(`update sm_orgs set deleted_at = null where id = $1`, [org]);
        }
        expect(await jobOf(id)).toMatchObject({ status: "done" });
        expect(await db.one(`select count(*)::int as n from sm_jobs where kind = $1 and status = 'queued'`, [kind])).toEqual({ n: 0 });
      });
    }

    it("esm.order: the journey's order activity left «in progress» without its order ends «failed»", async () => {
      // the activity as the journey's planning left it (inserted directly: no journey template is needed for its end)
      const a = (await db.one<{ id: string }>(
        `insert into sm_journey_activities (id, org_id, journey_id, name, kind, state) values (gen_random_uuid(), $1, gen_random_uuid(), 'سفارش لپ‌تاپ', 'order', 'in_progress') returning id`,
        [org],
      ))!;
      const id = await diedAtLastAttempt("esm.order", { id: a.id }, { maxAttempts: 5, dedupeKey: `esm.order:${a.id}` });
      await run();
      await expectFailed(id);
      const row = await db.one<{ state: string; outcome: string | null }>(`select state, outcome from sm_journey_activities where id = $1`, [a.id]);
      expect(row!.state).toBe("failed");
      expect(row!.outcome).toContain(EXHAUSTED_ERROR);
    });
  });
}
