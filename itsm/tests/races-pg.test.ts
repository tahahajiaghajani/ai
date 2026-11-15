// Writes of one organisation side by side, on a real PostgreSQL (docs/spec/ENGINE.md «Writes run side by side»): with
// no organisation-wide lock, every place that decides a write from rows other than the one it holds locked must take
// turns with the writer of those rows. Each test forces the interleaving that broke before the fix — usually by holding
// a row lock (or a whole write) in a third transaction so that both racers read before either writes — and checks the
// state that a serial order gives. Skipped unless ITSM_PG_URL or ITSM_PG_BIN (tests/pg-real.ts). Locally as root:
//   ITSM_PG_BIN=/usr/lib/postgresql/16/bin ITSM_PG_RUNAS=nobody npx vitest run tests/races-pg.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./fixtures/module";
import { registerTable } from "@shared/tables";
import type { TableDef } from "@shared/model/types";
import { SYNC_PROTOCOL } from "@shared/constants";
import { uuidv7 } from "@shared/id";
import MailComposer from "nodemailer/lib/mail-composer";
import type { Queryable } from "@server/db";
import { archiveBatch, archiveTableOf, createIn, purgeArchived, registerHooks, systemCtx, transitionIn, updateIn } from "@server/engine";
import { fireTimer } from "@server/modules/sla";
import { securitySweep } from "@server/modules/security/jobs";
import { autoPromote } from "@server/modules/security/ops";
import { ingestMessage } from "@server/modules/notify";
import { emailChannels } from "@server/modules/notify/mail";
import { checkXidRegression } from "@server/sync/snapshot";
import { tableDef } from "@shared/tables";
import { Client } from "./helpers";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { secWorld, type SecWorld } from "./security-helpers";
import { adWorld, AGENTS, type AdWorld } from "./auth-ad-helpers";
import { realPgAvailable } from "./pg-real";
import { call, hold, meeting, message, queued, raceDatabases, whileHeld } from "./race-helpers";

// a task-like table of this suite with two SLA timers per record (breach actions escalate)
const CASE: TableDef = {
  key: "race_case",
  table: "sm_race_cases",
  label: "پروندهٔ آزمون",
  plural: "پرونده‌های آزمون",
  icon: "folder",
  module: "test",
  area: "work",
  extends: "task",
  numbered: { prefix: "RACE", pad: 5 },
  display: "short_description",
  fields: [],
  scope: {},
};
registerTable(CASE);

describe.skipIf(!realPgAvailable())("writes side by side (real PostgreSQL)", () => {
  raceDatabases("races");

  // ---------------------------------------------------------------------------------------------------- platform

  describe("platform", () => {
    let e: EngineOrg;
    const P = () => `/o/${e.org}`;
    beforeAll(async () => {
      e = await engineOrg();
    }, 120_000);

    it("A1-1: a push of a row a web write is changing answers «conflict» with the web's copy instead of overwriting it", async () => {
      const id = uuidv7();
      await e.db.query(`insert into sm_test_items (id, org_id, name, code) values ($1, $2, 'آغاز', $3)`, [id, e.org, `R${Date.now()}`]);
      const old = (await e.db.one<Record<string, unknown>>(`select * from sm_test_items where id = $1`, [id]))!;
      // the web write is in flight (row locked, not committed) when the Windows app's push reads the row
      const web = hold(e.db, (tx) => tx.query(`update sm_test_items set name = 'وب' where id = $1`, [id]));
      const pushed = await whileHeld(web, () =>
        e.owner.post(`/sync/push`, {
          org_id: e.org, device_id: uuidv7(), protocol: SYNC_PROTOCOL,
          aggregates: [{ entity: "test_item", id, base_rev: Number(old.rev), row: { ...old, name: "آفلاین", updated_at: "2020-01-01T00:00:00.000Z" }, children: {} }],
        }),
      );
      expect(pushed.status).toBe("fulfilled");
      const res = (pushed as PromiseFulfilledResult<any>).value;
      expect(res.results[0]).toMatchObject({ status: "conflict" });
      expect(res.results[0].aggregate.row.name).toBe("وب");
      expect((await e.db.one<{ name: string }>(`select name from sm_test_items where id = $1`, [id]))!.name).toBe("وب");
    });

    it("A1-2: two owners demoting each other never leave the organisation without an active owner (page and push)", async () => {
      const added = await e.owner.post(`${P()}/members`, { email: `owner-b-${process.pid}@example.com`, full_name: "مالک دوم", role: "admin", password: "s3cret-pass-B" });
      const b = new Client(e.app);
      await b.post("/auth/login", { email: `owner-b-${process.pid}@example.com`, password: added.temp_password ?? "s3cret-pass-B" });
      const members = async () => (await e.db.query<{ id: string; user_id: string; role: string; rev: number }>(`select id, user_id, role, rev from sm_org_members where org_id = $1 and deleted_at is null`, [e.org]));
      const idOf = async (userId: string) => (await members()).find((m) => m.user_id === userId)!.id;
      const bUser = (await b.get("/auth/me")).user.id as string;
      const aId = await idOf(e.ownerId);
      const bId = await idOf(bUser);
      await e.owner.patch(`${P()}/members/${bId}`, { role: "owner" });
      const owners = async () => (await members()).filter((m) => m.role === "owner").length;
      expect(await owners()).toBe(2);

      // A demotes B (counted two owners, B's row written, not committed); meanwhile B demotes A on the members page
      let a2b = hold(e.db, (tx) => tx.query(`update sm_org_members set role = 'admin' where id = $1`, [bId]));
      const page = await whileHeld(a2b, () => call(b, "PATCH", `${P()}/members/${aId}`, { role: "admin" }));
      expect((page as PromiseFulfilledResult<any>).value.status).toBe(400);
      expect(JSON.stringify((page as PromiseFulfilledResult<any>).value.data)).toContain("سازمان باید دست‌کم یک مالک فعال داشته باشد");
      expect(await owners()).toBe(1);

      // the same through a Windows app's push of A's membership
      await e.db.query(`update sm_org_members set role = 'owner' where id = $1`, [bId]);
      expect(await owners()).toBe(2);
      const row = (await e.db.one<Record<string, unknown>>(`select * from sm_org_members where id = $1`, [aId]))!;
      a2b = hold(e.db, (tx) => tx.query(`update sm_org_members set role = 'admin' where id = $1`, [bId]));
      const push = await whileHeld(a2b, () =>
        b.post(`/sync/push`, { org_id: e.org, device_id: uuidv7(), protocol: SYNC_PROTOCOL, aggregates: [{ entity: "member", id: aId, base_rev: Number(row.rev), row: { ...row, role: "admin", updated_at: new Date().toISOString() }, children: {} }] }),
      );
      const res = (push as PromiseFulfilledResult<any>).value;
      expect(res.results[0]).toMatchObject({ status: "error" });
      expect(await owners()).toBe(1);
    });

    it("A1-6: saving one settings group keeps another group a concurrent write saved (the sign-in policy)", async () => {
      const policy = { local_login: "all", breakglass: [], session: { idle_minutes: 17 } };
      // the policy save is in flight when the print settings are saved (that request already loaded the organisation)
      const auth = hold(e.db, (tx) => tx.query(`update sm_orgs set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('auth', $2::jsonb) where id = $1`, [e.org, JSON.stringify(policy)]));
      const saved = await whileHeld(auth, () => e.owner.patch(P(), { settings: { print: { footer: "پانویس آزمون" } } }));
      expect(saved.status, message(saved)).toBe("fulfilled");
      const s = (await e.db.one<{ settings: Record<string, any> }>(`select settings from sm_orgs where id = $1`, [e.org]))!.settings;
      expect(s.auth?.session?.idle_minutes).toBe(17);
      expect(s.print?.footer).toBe("پانویس آزمون");
    });

    it("A1-9: the nightly purge never removes a tombstone a push is bringing back to life", async () => {
      const def = tableDef("todo")!;
      const sys = await systemCtx(e.cfg, e.org);
      await e.owner.put(`${P()}/archive`, { enabled: true, years: 3 });
      const r = await e.owner.post(`${P()}/r/todo`, { short_description: "بازگردانده‌شدنی" });
      const id = String(r.row.id);
      await e.db.tx(async (tx) => {
        await tx.query(`select set_config('itsm.applying', 'on', true)`);
        await tx.query(`update sm_todos set state = 'closed', active = false, updated_at = now() - interval '5 years' where id = $1`, [id]);
      });
      expect(await archiveBatch(sys, def, 3)).toBeGreaterThanOrEqual(1);
      await e.db.query(`update ${archiveTableOf(def)} set archived_at = now() - interval '40 days' where id = $1`, [id]);
      // a Windows app's push restores the record (live again, its archive copy removed) and has not committed
      const restore = hold(e.db, async (tx) => {
        await tx.query(`update sm_todos set deleted_at = null where id = $1`, [id]);
        await tx.query(`delete from ${archiveTableOf(def)} where id = $1`, [id]);
      });
      const purged = await whileHeld(restore, () => purgeArchived(sys, def));
      expect(purged.status, message(purged)).toBe("fulfilled");
      const live = await e.db.one<{ deleted_at: string | null }>(`select deleted_at from sm_todos where id = $1`, [id]);
      expect(live).not.toBeNull();
      expect(live!.deleted_at).toBeNull();
    });

    it("A1-5: two timers of one record breaching at once escalate it twice", async () => {
      const def = async (name: string, target: string) =>
        e.owner.post(`${P()}/r/sla_definition`, {
          name, table_key: "race_case", type: "sla", target, duration_mode: "priority",
          durations: { "1": 3600, "2": 7200, "3": 14400, "4": 28800, "5": 57600 },
          stop_condition: { f: "state", op: "in", v: ["resolved", "closed"] }, breach_actions: [{ type: "escalate" }],
        });
      await def("پاسخ آزمون", "response");
      await def("حل آزمون", "resolution");
      const row = (await e.owner.post(`${P()}/r/race_case`, { short_description: "دو زمان‌سنج", priority: "1" })).row;
      const timers = await e.db.query<{ id: string }>(`select id from sm_task_slas where record_id = $1 and deleted_at is null order by created_at`, [row.id]);
      expect(timers.length).toBe(2);
      await e.db.query(
        `update sm_task_slas set start_at = start_at - interval '3 hours', planned_end_at = planned_end_at - interval '3 hours' where record_id = $1`,
        [row.id],
      );
      const sys = await systemCtx(e.cfg, e.org);
      // the record is held by a write of its own while both timers' jobs fire
      const holder = hold(e.db, (tx) => tx.query(`select 1 from sm_race_cases where id = $1 for update`, [row.id]));
      const fired = await whileHeld(holder, () => Promise.all(timers.map((t) => fireTimer(sys, t.id))), 2);
      expect(fired.status, message(fired)).toBe("fulfilled");
      const after = await e.db.one<{ escalation: number }>(`select escalation from sm_race_cases where id = $1`, [row.id]);
      expect(Number(after!.escalation)).toBe(2);
    });

    /** Hold the record counter of `table` (every create of the table waits there, after its hooks decided). */
    const holdNumbers = async (table: string) => {
      const row = await e.db.one(`select 1 from sm_numbers where org_id = $1 and table_key = $2`, [e.org, table]);
      if (!row) await e.owner.post(`${P()}/r/${table}`, { short_description: "شمارنده" });
      return hold(e.db, (tx) => tx.query(`select 1 from sm_numbers where org_id = $1 and table_key = $2 for update`, [e.org, table]));
    };

    it("A1-13: two records created for a round-robin group at once go to two different members", async () => {
      const m1 = await e.member("member", `rr1-${process.pid}@example.com`);
      const m2 = await e.member("member", `rr2-${process.pid}@example.com`);
      const group = (await e.owner.post(`${P()}/r/group`, { name: "نوبتی هم‌زمان" })).row.id as string;
      await e.owner.post(`${P()}/access/groups/${group}/members`, { user_ids: [m1.userId, m2.userId] });
      const title = "نوبتی هم‌زمان آزمون";
      await e.owner.post(`${P()}/r/assignment_rule`, { name: "ارجاع نوبتی هم‌زمان", table_key: "race_case", condition: { f: "short_description", op: "eq", v: title }, group_id: group, method: "round_robin" });
      const numbers = await holdNumbers("race_case");
      const both = await whileHeld(numbers, () => Promise.all([0, 1].map(() => e.owner.post(`${P()}/r/race_case`, { short_description: title }))), 2);
      expect(both.status, message(both)).toBe("fulfilled");
      const rows = await e.db.query<{ assigned_to: string }>(`select assigned_to from sm_race_cases where org_id = $1 and short_description = $2 and deleted_at is null`, [e.org, title]);
      expect(rows.length).toBe(2);
      expect(new Set(rows.map((r) => r.assigned_to))).toEqual(new Set([m1.userId, m2.userId]));
    });

    it("A1-15: two additions that each counted one below the plan's ceiling leave the organisation at it", async () => {
      const used = async () => (await e.db.one<{ n: number }>(`select count(*)::int as n from sm_custom_fields where org_id = $1 and deleted_at is null and active and name like 'u\\_%'`, [e.org]))!.n;
      const before = await used();
      await e.db.query(`insert into sm_org_admin (org_id, limits) values ($1, $2::jsonb) on conflict (org_id) do update set limits = excluded.limits`, [e.org, JSON.stringify({ custom_fields: before + 1 })]);
      // both additions counted and inserted, neither committed
      const meet = meeting(2);
      const unhook = registerHooks("custom_field", { afterWrite: async (w) => void (String(w.row.name).startsWith("u_race_") && (await meet())) });
      try {
        const made = await Promise.all(["u_race_a", "u_race_b"].map((name) => call(e.owner, "POST", `${P()}/r/custom_field`, { table_key: "race_case", name, label: `فیلد ${name}`, type: "string" })));
        expect(made.map((m) => m.status).sort()).toEqual([200, 403]);
        expect(await used()).toBe(before + 1);
      } finally {
        unhook();
        await e.db.query(`update sm_org_admin set limits = '{}'::jsonb where org_id = $1`, [e.org]);
      }
    });

    it("A1-16: one e-mail fetched by two processes at once becomes one record", async () => {
      const sender = await e.member("member", `mail-${process.pid}@example.com`);
      expect(sender.userId).toBeTruthy();
      const ch = (
        await e.owner.post(`${P()}/r/email_channel`, {
          name: "صندوق هم‌زمان", from_name: "میز خدمت", from_address: "race-desk@itsm.example", smtp_host: "smtp.itsm.example", smtp_user: "desk", smtp_password: "smtp-secret",
          inbound: true, imap_host: "imap.itsm.example", imap_user: "desk", imap_password: "imap-secret",
        })
      ).row;
      const sys = await systemCtx(e.cfg, e.org);
      const channel = (await emailChannels(sys)).find((c) => c.id === ch.id)!;
      const subject = `چاپگر طبقهٔ سوم ${process.pid}`;
      const source = await new MailComposer({ from: `mail-${process.pid}@example.com`, to: "race-desk@itsm.example", subject, text: "چاپ نمی‌کند", messageId: `<${uuidv7()}@mail.example>` }).compile().build();
      const numbers = await holdNumbers("todo");
      const both = await whileHeld(numbers, () => Promise.all([0, 1].map(() => ingestMessage(e.cfg, sys, channel, source))), 2);
      expect(both.status, message(both)).toBe("fulfilled");
      const outcomes = (both as PromiseFulfilledResult<{ status: string }[]>).value.map((o) => o.status).sort();
      expect(outcomes).toEqual(["created", "duplicate"]);
      const made = await e.db.query(`select id from sm_todos where org_id = $1 and short_description = $2 and deleted_at is null`, [e.org, subject]);
      expect(made.length).toBe(1);
    });

    it("A1-17: two inbound deliveries about one external object at once make one record and update it", async () => {
      const iu = (await e.owner.post(`${P()}/r/integration_user`, { name: "پایش هم‌زمان" })).row;
      await e.owner.put(`${P()}/integration/users/${iu.id}/roles`, { roles: ["agent"] });
      const ep = (
        await e.owner.post(`${P()}/r/inbound_endpoint`, {
          name: "هشدار هم‌زمان", principal_id: iu.id, target_table: "todo", action: "upsert", match_field: "short_description", match_path: "$.alert.title",
          mapping: [{ path: "$.alert.title", field: "short_description" }, { path: "$.alert.details", field: "description" }],
        })
      ).row;
      const { secret, path } = await e.owner.post(`${P()}/integration/secret`, { table: "inbound_endpoint", id: ep.id });
      const title = `دیسک پر شد ${process.pid}`;
      const deliver = async (key: string, details: string) =>
        (await e.app.fetch(new Request(`http://local.test${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${secret}`, "idempotency-key": key }, body: JSON.stringify({ alert: { title, details } }) }))).json();
      const numbers = await holdNumbers("todo");
      const both = await whileHeld(numbers, () => Promise.all([deliver(`race-${uuidv7()}`, "۹۸٪"), deliver(`race-${uuidv7()}`, "۹۹٪")]), 2);
      expect(both.status, message(both)).toBe("fulfilled");
      const answers = (both as PromiseFulfilledResult<{ ok: boolean; action: string }[]>).value;
      expect(answers.map((a) => a.ok)).toEqual([true, true]);
      expect(answers.map((a) => a.action).sort()).toEqual(["created", "updated"]);
      const made = await e.db.query(`select id from sm_todos where org_id = $1 and short_description = $2 and deleted_at is null`, [e.org, title]);
      expect(made.length).toBe(1);
    });

    it("A1-20: two approvers of one «any» level deciding at once: one decides, the other is told it is closed (no deadlock)", async () => {
      const a1 = await e.member("member", `apv1-${process.pid}@example.com`);
      const a2 = await e.member("member", `apv2-${process.pid}@example.com`);
      const title = "تأیید هم‌زمان آزمون";
      await e.owner.post(`${P()}/r/approval_rule`, { name: "تأیید هم‌زمان", table_key: "race_case", condition: { f: "short_description", op: "eq", v: title }, levels: [{ sources: [{ kind: "users", users: [a1.userId, a2.userId] }], rule: "any" }] });
      const rec = (await e.owner.post(`${P()}/r/race_case`, { short_description: title })).row;
      const rows = await e.db.query<{ id: string; approver_id: string }>(`select id, approver_id from sm_approvals where org_id = $1 and record_id = $2 and state = 'requested'`, [e.org, rec.id]);
      expect(rows.length).toBe(2);
      const idOf = (u: string) => rows.find((r) => r.approver_id === u)!.id;
      // the record is held by a write of its own while both approvers decide
      const holder = hold(e.db, (tx) => tx.query(`select 1 from sm_race_cases where id = $1 for update`, [rec.id]));
      const both = await whileHeld(
        holder,
        () => Promise.all([call(a1.client, "POST", `${P()}/approvals/${idOf(a1.userId)}/decide`, { decision: "approved" }), call(a2.client, "POST", `${P()}/approvals/${idOf(a2.userId)}/decide`, { decision: "approved" })]),
        2,
      );
      expect(both.status, message(both)).toBe("fulfilled");
      const statuses = (both as PromiseFulfilledResult<{ status: number }[]>).value.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 409]);
      expect((await e.db.one<{ approval: string }>(`select approval from sm_race_cases where id = $1`, [rec.id]))!.approval).toBe("approved");
    });

    it("A1-14: a mark another process raised meanwhile is never taken for a transaction-id regression", async () => {
      const epochs = async () => (await e.db.query<{ org_id: string; epoch: string }>(`select org_id, epoch::text as epoch from sm_org_sync order by org_id`)).map((r) => `${r.org_id}:${r.epoch}`);
      await checkXidRegression(e.db, { force: true });
      const before = await epochs();
      // after this process's first statement, other transactions run and another process raises the mark
      let first = true;
      const meanwhile = async () => {
        if (!first) return;
        first = false;
        for (let i = 0; i < 3; i++) await e.db.tx((tx) => tx.query(`select pg_current_xact_id()`));
        await checkXidRegression(e.db, { force: true });
      };
      const q: Queryable = {
        query: async (text, params) => {
          const r = await e.db.query(text, params);
          await meanwhile();
          return r as never;
        },
        one: async (text, params) => {
          const r = await e.db.one(text, params);
          await meanwhile();
          return r as never;
        },
        exec: (text) => e.db.exec(text),
      };
      expect(await checkXidRegression(q, { force: true })).toBe(false);
      expect(await epochs()).toEqual(before);
    });
  });

  // ---------------------------------------------------------------------------------------------------- security

  describe("security", () => {
    let w: SecWorld;
    beforeAll(async () => {
      w = await secWorld();
    }, 180_000);

    it("A1-3: a mandatory task is not added to an incident being moved to review, nor a clock to one being canceled", async () => {
      const r = await w.sir({ category: "other", severity: "3" });
      await w.p.soc.client.post(`${w.P}/r/sec_incident/${r.id}/transition`, { to: "analysis", version: r.version });
      // the review is in flight (its guard found no open analysis task) when a mandatory analysis task is added
      const review = hold(w.e.db, (tx) => transitionIn(tx, w.sys, "sec_incident", r.id, "review", { close_code: "false_positive" }));
      const task = await whileHeld(review, () => w.sys.write((tx) => createIn(tx, w.sys, "sec_task", { sec_incident_id: r.id, short_description: "کار دیرآمده", phase: "analysis", mandatory: true }, { trusted: true })));
      expect(task.status).toBe("rejected");
      expect(message(task)).toContain("به رخداد امنیتی بسته کار تازه افزوده نمی‌شود");
      const tasks = await w.e.db.query(`select id from sm_sec_tasks where sec_incident_id = $1 and deleted_at is null and short_description = 'کار دیرآمده'`, [r.id]);
      expect(tasks).toEqual([]);

      // a regulatory clock started while the incident is being canceled
      const c = await w.sir({ category: "other", severity: "3" });
      const regime = (await w.e.db.one<{ id: string }>(`select id from sm_sec_reg_regimes where org_id = $1 and deleted_at is null and active order by name limit 1`, [w.e.org]))!.id;
      const cancel = hold(w.e.db, (tx) => transitionIn(tx, w.sys, "sec_incident", c.id, "canceled", { close_code: "false_positive", close_notes: "مثبت کاذب" }));
      const clock = await whileHeld(cancel, () => w.sys.write((tx) => createIn(tx, w.sys, "sec_reg_clock", { sec_incident_id: c.id, regime_id: regime, aware_at: new Date().toISOString() })));
      expect(clock.status).toBe("rejected");
      const clocks = await w.e.db.query(`select id from sm_sec_reg_clocks where sec_incident_id = $1 and deleted_at is null`, [c.id]);
      expect(clocks).toEqual([]);

      // two starts of one regime at once give one clock
      const d = await w.sir({ category: "other", severity: "3" });
      const holder = hold(w.e.db, (tx) => tx.query(`select 1 from sm_sec_incidents where id = $1 for update`, [d.id]));
      const two = await whileHeld(
        holder,
        () => Promise.allSettled([0, 1].map(() => w.sys.write((tx) => createIn(tx, w.sys, "sec_reg_clock", { sec_incident_id: d.id, regime_id: regime, aware_at: new Date().toISOString() })))),
        2,
      );
      expect(two.status).toBe("fulfilled");
      const made = await w.e.db.query(`select id from sm_sec_reg_clocks where sec_incident_id = $1 and deleted_at is null`, [d.id]);
      expect(made.length).toBe(1);
    });

    it("A1-4: an item deferred under an exception that is being revoked goes back to the queue", async () => {
      const vul = await w.sys.write((tx) => createIn(tx, w.sys, "sec_vulnerability", { cve_id: `CVE-2099-${process.pid % 10000}`, title: "آسیب‌پذیری آزمون", cvss_score: "7.5" }, { trusted: true }));
      const exp = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
      const exc = await w.sys.write((tx) =>
        createIn(tx, w.sys, "sec_vuln_exception", { title: "تعویق آزمون", kind: "deferral", vulnerability_id: vul.id, justification: "پنجرهٔ نگهداری", expires_at: exp, state: "approved" }, { trusted: true }),
      );
      const item = await w.sys.write((tx) => createIn(tx, w.sys, "sec_vuln_item", { title: "مورد آزمون", vulnerability_id: vul.id, host: "srv-race-01" }, { trusted: true }));
      // the deferral passed its guard (the exception approved) and has not committed when the exception is revoked (the
      // item is deferred as an approval defers it: the exception named by the system, then the transition)
      const defer = hold(w.e.db, async (tx) => {
        await updateIn(tx, w.sys, "sec_vuln_item", item.id, { exception_id: exc.id }, { trusted: true, keepVersion: true });
        await transitionIn(tx, w.sys, "sec_vuln_item", item.id, "deferred");
      });
      await defer.ready;
      const revoke = w.sys.write((tx) => transitionIn(tx, w.sys, "sec_vuln_exception", exc.id, "revoked", { notes: "ابطال" }));
      revoke.catch(() => undefined);
      await queued(w.e.db, 1, revoke);
      defer.release();
      await defer.done;
      await revoke;
      const after = await w.e.db.one<{ state: string }>(`select state from sm_sec_vuln_items where id = $1`, [item.id]);
      expect(after!.state).toBe("open");
    });

    it("A1-7: a stage's submission and the sweep's warning marks are both kept", async () => {
      const r = await w.sir({ category: "data_breach", personal_data_breach: true, affected_data: "فهرست", records_affected: 10 });
      const regimes = (await w.p.soc.client.get(`${w.P}/security/incidents/${r.id}/regimes`)).regimes as any[];
      const nis2 = regimes.find((x) => x.name === "NIS2");
      // aware 70 hours ago: the 24-hour stage is overdue and the 72-hour one due within 6 hours (both get a warning)
      const aware = new Date(Date.now() - 70 * 3600_000).toISOString();
      const clock = (await w.p.soc.client.post(`${w.P}/security/incidents/${r.id}/clocks`, { regime_id: nis2.id, aware_at: aware })).row;
      const holder = hold(w.e.db, (tx) => tx.query(`select 1 from sm_sec_reg_clocks where id = $1 for update`, [clock.id]));
      const both = await whileHeld(
        holder,
        () => Promise.allSettled([securitySweep(w.sys), w.p.soc.client.post(`${w.P}/security/clocks/${clock.id}/submit`, { stage: "early_warning", reference: "CERT-9" })]),
        2,
      );
      expect(both.status).toBe("fulfilled");
      const outcomes = (both as PromiseFulfilledResult<PromiseSettledResult<unknown>[]>).value;
      expect(outcomes.map((o) => o.status)).toEqual(["fulfilled", "fulfilled"]);
      const c = (await w.e.db.one<{ deadlines: { stage: string; submitted_at?: string | null; warned?: string | null }[] }>(`select deadlines from sm_sec_reg_clocks where id = $1`, [clock.id]))!;
      expect(c.deadlines.find((d) => d.stage === "early_warning")?.submitted_at).toBeTruthy();
      expect(c.deadlines.find((d) => d.stage === "notification")?.warned).toBeTruthy();
    });

    it("A1-10: an indicator added to two incidents at once stays on both", async () => {
      const [s0, s1, s2] = [await w.sir(), await w.sir(), await w.sir()];
      const value = `198.51.100.${(process.pid % 200) + 1}`;
      const first = await w.p.soc.client.post(`${w.P}/security/incidents/${s0.id}/observables`, { values: [value] });
      const oid = first.observables[0].id as string;
      // the indicator is held by a write of its own while two analysts add it to their incidents
      const holder = hold(w.e.db, (tx) => tx.query(`select 1 from sm_sec_observables where id = $1 for update`, [oid]));
      const both = await whileHeld(holder, () => Promise.all([s1, s2].map((s) => w.p.soc.client.post(`${w.P}/security/incidents/${s.id}/observables`, { values: [value] }))), 2);
      expect(both.status, message(both)).toBe("fulfilled");
      const o = await w.e.db.one<{ incidents: string[] }>(`select incidents from sm_sec_observables where id = $1`, [oid]);
      expect([...o!.incidents].sort()).toEqual([s0.id, s1.id, s2.id].sort());
    });

    it("A1-11: an IT incident promoted by hand and automatically at once gets one security incident", async () => {
      const inc = (await w.p.agent.client.post(`${w.P}/r/incident`, { short_description: "باج‌افزار هم‌زمان", category: "software" })).row;
      // flagged for the subscriber's automatic promotion (as stored, without the flag's confidentiality: the analyst reads it)
      await w.e.db.query(`update sm_incidents set security_incident = true where id = $1`, [inc.id]);
      // the IT incident is held by a write of its own while the subscriber and an analyst promote it
      const holder = hold(w.e.db, (tx) => tx.query(`select 1 from sm_incidents where id = $1 for update`, [inc.id]));
      const both = await whileHeld(holder, () => Promise.all([autoPromote(w.sys, inc.id), w.p.soc.client.post(`${w.P}/security/promote/${inc.id}`, {})]), 2);
      expect(both.status, message(both)).toBe("fulfilled");
      const sirs = await w.e.db.query(`select id from sm_sec_incidents where org_id = $1 and it_incident_id = $2 and deleted_at is null`, [w.e.org, inc.id]);
      expect(sirs.length).toBe(1);
    });

    it("A1-12: a playbook applied again twice at once adds each missing step once", async () => {
      const s = await w.sir({ category: "malware" });
      const pbId = (await w.e.db.one<{ playbook_id: string }>(`select playbook_id from sm_sec_incidents where id = $1`, [s.id]))!.playbook_id;
      expect(pbId).toBeTruthy();
      const steps = (await w.e.db.one<{ steps: unknown[] }>(`select steps from sm_sec_playbooks where id = $1`, [pbId]))!.steps;
      const step = `گام تازهٔ آزمون ${process.pid}`;
      // the playbook gained a step after it was applied; two analysts apply it again at once
      await w.e.db.query(`update sm_sec_playbooks set steps = $2::jsonb where id = $1`, [pbId, JSON.stringify([...steps, { title: step, phase: "analysis", mandatory: false }])]);
      try {
        const holder = hold(w.e.db, (tx) => tx.query(`select 1 from sm_sec_incidents where id = $1 for update`, [s.id]));
        const both = await whileHeld(holder, () => Promise.all([w.p.soc.client, w.p.soc2.client].map((c) => c.post(`${w.P}/security/incidents/${s.id}/playbook`, { playbook_id: pbId }))), 2);
        expect(both.status, message(both)).toBe("fulfilled");
        const tasks = await w.e.db.query(`select id from sm_sec_tasks where sec_incident_id = $1 and deleted_at is null and short_description = $2`, [s.id, step]);
        expect(tasks.length).toBe(1);
      } finally {
        await w.e.db.query(`update sm_sec_playbooks set steps = $2::jsonb where id = $1`, [pbId, JSON.stringify(steps)]);
      }
    });

    it("A1-19: two members acknowledging a policy at once are both counted", async () => {
      let pol = (await w.p.grc.client.post(`${w.P}/r/grc_policy`, { title: "خط‌مشی هم‌زمانی", kind: "policy", body: "متن خط‌مشی", approver_id: w.p.ciso.userId })).row;
      pol = (await w.p.grc.client.post(`${w.P}/r/grc_policy/${pol.id}/transition`, { to: "review", version: pol.version })).row;
      await w.drain();
      const ap = ((await w.p.ciso.client.get(`${w.P}/approvals/mine`)).approvals as any[]).find((a) => a.record_id === pol.id);
      await w.p.ciso.client.post(`${w.P}/approvals/${ap.id}/decide`, { decision: "approved" });
      let camp = (await w.p.grc.client.post(`${w.P}/r/grc_policy_campaign`, { title: "پذیرش هم‌زمان", policy_id: pol.id, due_at: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10), target_users: [w.p.req.userId, w.p.agent.userId] })).row;
      camp = (await w.p.grc.client.post(`${w.P}/r/grc_policy_campaign/${camp.id}/transition`, { to: "active", version: camp.version })).row;
      // the campaign is held by a write of its own while both members acknowledge
      const holder = hold(w.e.db, (tx) => tx.query(`select 1 from sm_grc_policy_campaigns where id = $1 for update`, [camp.id]));
      const both = await whileHeld(holder, () => Promise.all([w.p.req.client, w.p.agent.client].map((c) => c.post(`${w.P}/security/policies/campaigns/${camp.id}/ack`, {}))), 2);
      expect(both.status, message(both)).toBe("fulfilled");
      expect(Number((await w.e.db.one<{ ack_count: number }>(`select ack_count from sm_grc_policy_campaigns where id = $1`, [camp.id]))!.ack_count)).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------------------------------- directory

  describe("directory sign-in", () => {
    let w: AdWorld;
    beforeAll(async () => {
      w = await adWorld();
    }, 180_000);
    afterAll(() => w?.close());

    it("A1-8: a role an administrator takes back while the sign-in maps a new one stays taken back", async () => {
      const first = await w.signIn("ali", "Passw0rd!");
      const uid = first.r.user_id as string;
      await w.owner.put(`${w.P}/access/members/${uid}`, { roles: ["agent", "requester", "auditor"] });
      // the mapping now also grants «team_lead» to the agents' group (approved)
      await w.owner.patch(`${w.P}/r/directory_source/${w.source.id}`, { group_map: [{ source: AGENTS, role: "agent", group_id: w.team }, { source: AGENTS, role: "team_lead" }] });
      await w.owner.post(`${w.P}/integration/directory/${w.source.id}/approve`);
      // the administrator's removal of «auditor» is in flight when ali signs in
      const revoke = hold(w.db, (tx) =>
        tx.query(`update sm_member_profiles set roles = '["agent","requester"]'::jsonb, version = version + 1 where org_id = $1 and user_id = $2 and deleted_at is null`, [w.org, uid]),
      );
      const signed = await whileHeld(revoke, () => w.signIn("ali", "Passw0rd!"));
      expect(signed.status, message(signed)).toBe("fulfilled");
      const p = await w.db.one<{ roles: string[] }>(`select roles from sm_member_profiles where org_id = $1 and user_id = $2 and deleted_at is null`, [w.org, uid]);
      expect([...p!.roles].sort()).toEqual(["agent", "requester", "team_lead"]);
    });
  });
});
