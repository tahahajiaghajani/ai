// Writes of one organisation side by side, on a real PostgreSQL (docs/spec/ENGINE.md «Writes run side by side»): with
// no organisation-wide lock, every place that decides a write from rows other than the one it holds locked must take
// turns with the writer of those rows. Each test forces the interleaving that broke before the fix — usually by holding
// a row lock (or a whole write) in a third transaction so that both racers read before either writes — and checks the
// state that a serial order gives. Skipped unless ITSM_PG_URL or ITSM_PG_BIN (tests/pg-real.ts). Locally as root:
//   ITSM_PG_BIN=/usr/lib/postgresql/16/bin ITSM_PG_RUNAS=nobody npx vitest run tests/races-pg.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import "./fixtures/module";
import { registerTable } from "@shared/tables";
import type { TableDef } from "@shared/model/types";
import { SYNC_PROTOCOL } from "@shared/constants";
import { uuidv7 } from "@shared/id";
import { createPostgresDb } from "@server/db/postgres";
import type { Db, Tx } from "@server/db";
import { archiveBatch, archiveTableOf, createIn, purgeArchived, systemCtx, transitionIn, updateIn } from "@server/engine";
import { fireTimer } from "@server/modules/sla";
import { securitySweep } from "@server/modules/security/jobs";
import { tableDef } from "@shared/tables";
import { Client, useServerDb } from "./helpers";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { secWorld, type SecWorld } from "./security-helpers";
import { adWorld, AGENTS, type AdWorld } from "./auth-ad-helpers";
import { extraDatabase, realPg, realPgAvailable, type RealPg } from "./pg-real";

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

/** Gates holding transactions open; a failed test releases its own (afterEach) so none outlives it. */
const open: (() => void)[] = [];
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  open.push(resolve);
  return { promise, resolve };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** How long a racer is given to reach (and wait at) its lock before the holder lets go. */
const SETTLE = 700;

/**
 * Hold a transaction open: `work` runs, then the transaction waits (holding every lock it took) until `release()`.
 * `ready` resolves once `work` is done.
 */
function hold(db: Db, work: (tx: Tx) => Promise<unknown>) {
  const inside = deferred();
  const gate = deferred();
  const done = db.tx(async (tx) => {
    await work(tx);
    inside.resolve();
    await gate.promise;
  });
  done.catch(() => inside.resolve());
  return { ready: inside.promise, release: () => gate.resolve(), done };
}

/** Run `race` while `holder` holds its locks; release after the racers had time to read and queue. */
async function whileHeld<T>(holder: ReturnType<typeof hold>, race: () => Promise<T>): Promise<PromiseSettledResult<Awaited<T>>> {
  await holder.ready;
  const racing = race();
  racing.catch(() => undefined);
  await sleep(SETTLE);
  holder.release();
  await holder.done;
  const [out] = await Promise.allSettled([racing]);
  return out as PromiseSettledResult<Awaited<T>>;
}

/** An HTTP call whose outcome is part of the test: { status, data } instead of throwing. */
async function call(c: Client, method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  try {
    return { status: 200, data: await c.req(method, path, body, 200) };
  } catch (e) {
    const m = /→ (\d+): ([\s\S]*)$/.exec(String((e as Error).message));
    return { status: m ? Number(m[1]) : 0, data: m ? safeJson(m[2]) : String(e) };
  }
}
const safeJson = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};
const message = (r: PromiseSettledResult<unknown>) => (r.status === "rejected" ? String((r.reason as Error)?.message ?? r.reason) : "");

let pg: RealPg;
let seq = 0;
const pools: Db[] = [];

describe.skipIf(!realPgAvailable())("writes side by side (real PostgreSQL)", () => {
  beforeAll(async () => {
    pg = await realPg("races");
    // every world (server) of this suite gets its own database on the one PostgreSQL
    useServerDb(async () => {
      const url = await extraDatabase(pg, `races_${process.pid}_${++seq}`);
      const db = createPostgresDb({ url, ssl: false, max: 8 });
      pools.push(db);
      return db;
    });
  }, 120_000);

  afterEach(() => {
    for (const release of open.splice(0)) release();
  });

  afterAll(async () => {
    useServerDb(null);
    for (const db of pools.splice(0)) await db.close().catch(() => undefined);
    await pg?.stop();
  });

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
      const fired = await whileHeld(holder, () => Promise.all(timers.map((t) => fireTimer(sys, t.id))));
      expect(fired.status, message(fired)).toBe("fulfilled");
      const after = await e.db.one<{ escalation: number }>(`select escalation from sm_race_cases where id = $1`, [row.id]);
      expect(Number(after!.escalation)).toBe(2);
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
      const two = await whileHeld(holder, () =>
        Promise.allSettled([0, 1].map(() => w.sys.write((tx) => createIn(tx, w.sys, "sec_reg_clock", { sec_incident_id: d.id, regime_id: regime, aware_at: new Date().toISOString() })))),
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
      await sleep(SETTLE);
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
      const both = await whileHeld(holder, () =>
        Promise.allSettled([securitySweep(w.sys), w.p.soc.client.post(`${w.P}/security/clocks/${clock.id}/submit`, { stage: "early_warning", reference: "CERT-9" })]),
      );
      expect(both.status).toBe("fulfilled");
      const outcomes = (both as PromiseFulfilledResult<PromiseSettledResult<unknown>[]>).value;
      expect(outcomes.map((o) => o.status)).toEqual(["fulfilled", "fulfilled"]);
      const c = (await w.e.db.one<{ deadlines: { stage: string; submitted_at?: string | null; warned?: string | null }[] }>(`select deadlines from sm_sec_reg_clocks where id = $1`, [clock.id]))!;
      expect(c.deadlines.find((d) => d.stage === "early_warning")?.submitted_at).toBeTruthy();
      expect(c.deadlines.find((d) => d.stage === "notification")?.warned).toBeTruthy();
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
