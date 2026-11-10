// The purge's safety rules (docs/DEMO_FA.md): it never deletes, reverts or erases the history of REAL data.
// · only what demo work wrote (and what derives from it through a reference) goes — never «made by the system since the
//   load»; a pack already tombstoned is only finalised;
// · only real rows demo work changed are put back (column by column, as the table now is), and only when nothing
//   outside the demo scope changed them since; the platform's own changes and their history stay;
// · the trail (history, journal, audit) demo people wrote on real records stays;
// · demo people sign in only while an administrator allows it; what they push from a Windows app is demo work;
// · nothing about demo records leaves the system (email, SMS, webhooks), and real people get no bells about them;
// · the load and the purge change the pack's state with compare-and-set.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import nodemailer from "nodemailer";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { Client } from "./helpers";
import { createIn, updateIn, systemCtx } from "@server/engine";
import { inDemoScope, DemoOutboundError } from "@server/db/scope";
import { failLoad, finishLoad, runToEnd } from "@server/modules/demo";
import { tick } from "@server/jobs";
import { hashPassword } from "@server/auth/password";
import { setTransportFactory } from "@server/modules/notify";
import { sendMail } from "@server/modules/notify/mail";
import { majorAction } from "@server/modules/incident";
import { SYNC_PROTOCOL } from "@shared/constants";
import { uuidv7 } from "@shared/id";
import type { Tx } from "@server/db";
import type { Ctx } from "@server/context";

const PASSWORD = "demo-persona-pass-1405";

async function drain(e: EngineOrg, budgetMs = 120_000) {
  const until = Date.now() + budgetMs;
  while (Date.now() < until) {
    await e.db.query(`update sm_jobs set run_at = now() where status = 'queued' and run_at > now() and (kind like '%seed%' or kind like '%install%' or kind like 'notify.%')`);
    const r = await tick(e.cfg, { budgetMs: 10_000 });
    if (!r.ran && !r.more) break;
  }
}

/** A demo pack as the loader leaves it (loaded, saved before), without the bank. */
async function packOf(e: EngineOrg) {
  await e.db.query(
    `insert into sm_demo_packs (org_id, state, size, progress, counters, started_by) values ($1, 'loaded', 'small', jsonb_build_object('saved_at', now(), 'computed', '[]'::jsonb, 'seeds_done', true, 'saved', true), '{}'::jsonb, $2)`,
    [e.org, e.ownerId],
  );
}

/** One of the pack's people (as the loader adds them): recorded, marked, a member with ordinary roles. */
async function persona(e: EngineOrg, local: string, roles: string[] = ["agent"]): Promise<{ id: string; email: string }> {
  const id = uuidv7();
  const email = `${local}.${e.org.slice(0, 6)}@aftab-bank.example`;
  await e.db.query(`insert into sm_users (id, email, full_name, password_hash, prefs) values ($1, $2, $3, $4, $5::jsonb)`, [id, email, `نمایشی ${local}`, await hashPassword(PASSWORD), JSON.stringify({ demo_org: e.org })]);
  await e.db.query(`insert into sm_demo_rows (org_id, row_id, tbl) values ($1, $2, 'sm_users')`, [e.org, id]);
  await e.db.query(`insert into sm_org_members (id, org_id, user_id, role, title, origin) values ($1, $2, $3, 'member', 'نمایشی', 'cloud')`, [uuidv7(), e.org, id]);
  await e.owner.put(`/o/${e.org}/access/members/${id}`, { roles, persona: "agent" });
  return { id, email };
}

const demoWrite = <T,>(e: EngineOrg, sys: Ctx, fn: (tx: Tx) => Promise<T>) => inDemoScope(e.org, () => sys.write(fn));
const todo = (e: EngineOrg, id: string) => e.db.one<Record<string, any>>(`select * from sm_todos where id = $1`, [id]);

describe("the purge never deletes, reverts or erases real data", () => {
  let e: EngineOrg;
  let sys: Ctx;
  const ids: Record<string, string> = {};
  let agent: { id: string; email: string };
  let agentClient: Client;
  let report: any;

  beforeAll(async () => {
    e = await engineOrg();
    await drain(e, 240_000);
    sys = await systemCtx(e.cfg, e.org);
    await packOf(e);
    agent = await persona(e, "manager", ["service_desk_manager", "incident_manager", "problem_manager"]);
    // real records before and during the demo period
    ids.ownerInc = (await e.owner.post(`/o/${e.org}/r/incident`, { short_description: "رخداد واقعی مالک" })).row.id;
    ids.demo = await demoWrite(e, sys, async (tx) => String((await createIn(tx, sys, "todo", { short_description: "کار نمایشی بانک" }, { trusted: true })).id));
    const real = async (text: string) => sys.write(async (tx) => String((await createIn(tx, sys, "todo", { short_description: text }, { trusted: true })).id));
    // the platform's own work outside the demo scope (a collector, a monitoring integration): no actor, made after the load
    ids.systemMade = await real("ساخته‌شده به دست سامانه پس از بارگذاری");
    ids.systemChanged = await real("نسخهٔ ۱");
    ids.demoChanged = await real("پیش از کار نمایشی");
    ids.bothChanged = await real("پیش از هر دو");
    ids.upgraded = await real("پیش از ارتقا");
  }, 600_000);

  it("demo sign-in is off by default and an administrator turns it on", async () => {
    agentClient = new Client(e.app);
    await agentClient.post("/auth/login", { email: agent.email, password: PASSWORD }, 403);
    expect((await e.owner.get(`/o/${e.org}/demo/banner`)).signin).toBe(false);
    expect((await e.owner.get(`/o/${e.org}/demo`)).password ?? null).toBeNull();
    const on = await e.owner.post(`/o/${e.org}/demo/signin`, { on: true });
    expect((await e.owner.get(`/o/${e.org}/demo/banner`)).signin).toBe(true);
    // a fresh shared password while sign-in is on
    expect(on.password).toBeTruthy();
    await agentClient.post("/auth/login", { email: agent.email, password: PASSWORD }, 401);
    await agentClient.post("/auth/login", { email: agent.email, password: on.password });
    expect((await agentClient.get(`/o/${e.org}/r/incident/${ids.ownerInc}`)).row.id).toBe(ids.ownerInc);
    // the personas never hold an administrator's role
    const m = await e.db.one<{ role: string }>(`select role from sm_org_members where org_id = $1 and user_id = $2`, [e.org, agent.id]);
    expect(["member", "viewer"]).toContain(m!.role);
  });

  it("a demo person's work on a real record and a push from a Windows app are demo work", async () => {
    await agentClient.patch(`/o/${e.org}/r/incident/${ids.ownerInc}`, { short_description: "تغییر حساب نمایشی" });
    await agentClient.post(`/o/${e.org}/r/incident/${ids.ownerInc}/journal`, { kind: "comment", body: "یادداشت حساب نمایشی روی رکورد واقعی" });
    // a persona pushes a new record from a Windows app
    ids.pushed = uuidv7();
    const now = new Date().toISOString();
    const pushed = await agentClient.post(`/sync/push`, {
      org_id: e.org,
      device_id: uuidv7(),
      protocol: SYNC_PROTOCOL,
      aggregates: [{ entity: "todo", id: ids.pushed, base_rev: 0, row: { id: ids.pushed, org_id: e.org, short_description: "کار آفلاین حساب نمایشی", created_at: now, updated_at: now } }],
    });
    expect(pushed.results[0].status).toBe("ok");
    expect(await e.db.one(`select 1 from sm_demo_rows where org_id = $1 and row_id = $2`, [e.org, ids.pushed])).toBeTruthy();
  });

  it("a demo account makes no organisation of its own, and sign-in off retires the shared password", async () => {
    const before = await e.db.one<{ n: number }>(`select count(*)::int as n from sm_orgs`);
    await agentClient.post("/orgs", { name: "سازمان حساب نمایشی", timezone: "Asia/Tehran" }, 403);
    expect((await e.db.one<{ n: number }>(`select count(*)::int as n from sm_orgs`))!.n).toBe(before!.n);
    const shown = (await e.owner.get(`/o/${e.org}/demo`)).password;
    expect(shown).toBeTruthy();
    await e.owner.post(`/o/${e.org}/demo/signin`, { on: false });
    // the password once on the projector no longer signs anyone in, even should the account outlive the pack
    await e.db.query(`update sm_users set prefs = prefs - 'demo_org' where id = $1`, [agent.id]);
    const late = new Client(e.app);
    await late.post("/auth/login", { email: agent.email, password: shown }, 401);
    await e.db.query(`update sm_users set prefs = jsonb_set(prefs, '{demo_org}', to_jsonb($2::text)) where id = $1`, [agent.id, e.org]);
    // back on for the rest: a fresh password
    const on = await e.owner.post(`/o/${e.org}/demo/signin`, { on: true });
    agentClient = new Client(e.app);
    await agentClient.post("/auth/login", { email: agent.email, password: on.password });
  });

  it("purges only demo work: real system rows, system changes and their history, the real trail stay", async () => {
    // the platform changes a real row outside the demo scope (no actor)
    await sys.write((tx) => updateIn(tx, sys, "todo", ids.systemChanged, { short_description: "نسخهٔ ۲" }, { trusted: true }));
    const historyOfSystem = (await e.db.one<{ n: number }>(`select count(*)::int as n from sm_history where record_id = $1`, [ids.systemChanged]))!.n;
    expect(historyOfSystem).toBeGreaterThan(0);
    // demo work changes real rows
    await demoWrite(e, sys, (tx) => updateIn(tx, sys, "todo", ids.demoChanged, { short_description: "تغییر کار نمایشی" }, { trusted: true }));
    await demoWrite(e, sys, (tx) => updateIn(tx, sys, "todo", ids.bothChanged, { short_description: "تغییر کار نمایشی" }, { trusted: true }));
    // … and then the platform changes one of them again, outside the demo scope
    await sys.write((tx) => updateIn(tx, sys, "todo", ids.bothChanged, { short_description: "تغییر بعدی سامانه" }, { trusted: true }));
    // an upgrade adds a column to a table demo work changed rows of (as engine/ddl.ts does for a bool field)
    await demoWrite(e, sys, (tx) => updateIn(tx, sys, "todo", ids.upgraded, { short_description: "تغییر نمایشی پیش از ارتقا" }, { trusted: true }));
    await e.db.query(`alter table sm_todos add column if not exists zz_flag boolean not null default false`);
    await e.db.query(`update sm_todos set zz_flag = true where id = $1`, [ids.upgraded]);

    await e.owner.post(`/o/${e.org}/demo/purge`, { confirm: "حذف کامل" });
    // the job's report, kept as the purge goes
    await runToEnd(e.cfg, e.org, "purge", { budgetMs: 300_000 });
    const pack = await e.db.one(`select 1 from sm_demo_packs where org_id = $1`, [e.org]);
    expect(pack).toBeNull();
    const line = await e.db.one<{ data: any }>(`select data from sm_audit where org_id = $1 and action = 'demo_purge' order by at desc limit 1`, [e.org]);
    report = line?.data;
    expect(report).toBeTruthy();

    // demo rows went
    expect(await todo(e, ids.demo)).toBeNull();
    expect(await todo(e, ids.pushed)).toBeNull();
    // a real row the system made after the load stays
    expect((await todo(e, ids.systemMade))?.short_description).toBe("ساخته‌شده به دست سامانه پس از بارگذاری");
    // the system's change stays, with its history
    expect((await todo(e, ids.systemChanged))?.short_description).toBe("نسخهٔ ۲");
    expect((await e.db.one<{ n: number }>(`select count(*)::int as n from sm_history where record_id = $1`, [ids.systemChanged]))!.n).toBe(historyOfSystem);
    // what demo work changed goes back; its history line too
    expect((await todo(e, ids.demoChanged))?.short_description).toBe("پیش از کار نمایشی");
    expect(await e.db.one(`select 1 from sm_history where record_id = $1 and new::text like '%تغییر کار نمایشی%'`, [ids.demoChanged])).toBeNull();
    // changed by demo work and then by the platform: left as it is (reported)
    expect((await todo(e, ids.bothChanged))?.short_description).toBe("تغییر بعدی سامانه");
    // after an upgrade: put back without error, the new column keeps its value
    const up = await todo(e, ids.upgraded);
    expect(up?.short_description).toBe("پیش از ارتقا");
    expect(up?.zz_flag).toBe(true);
    // the demo person's trail on the real record stays (the change itself is undone)
    expect((await e.db.one<{ short_description: string }>(`select short_description from sm_incidents where id = $1`, [ids.ownerInc]))?.short_description).toBe("رخداد واقعی مالک");
    expect(await e.db.one(`select 1 from sm_journal where record_id = $1 and author = $2`, [ids.ownerInc, agent.id])).toBeTruthy();
    expect(await e.db.one(`select 1 from sm_history where record_id = $1 and actor = $2`, [ids.ownerInc, agent.id])).toBeTruthy();
    // sign-in records of the demo account stay; the account goes
    expect(await e.db.one(`select 1 from sm_security_events where user_id = $1`, [agent.id])).toBeTruthy();
    expect(await e.db.one(`select 1 from sm_users where id = $1`, [agent.id])).toBeNull();
  }, 600_000);

  afterAll(async () => {
    await e?.db.query(`alter table sm_todos drop column if exists zz_flag`).catch(() => undefined);
  });
});

describe("pack states", () => {
  let e: EngineOrg;
  beforeAll(async () => {
    e = await engineOrg();
  }, 300_000);

  it("a load chunk ending after the purge started keeps 'purging' (compare-and-set)", async () => {
    await e.db.query(`insert into sm_demo_packs (org_id, state, size, progress, started_by) values ($1, 'loading', 'small', '{"seeds_done": true}'::jsonb, $2)`, [e.org, e.ownerId]);
    await e.owner.post(`/o/${e.org}/demo/purge`, { confirm: "حذف کامل" });
    expect((await e.db.one<{ state: string }>(`select state from sm_demo_packs where org_id = $1`, [e.org]))!.state).toBe("purging");
    expect(await finishLoad(e.db, e.org, { started_by: e.ownerId, size: "small" }, {})).toBe(false);
    expect(await failLoad(e.db, e.org, "boom")).toBe(false);
    expect((await e.db.one<{ state: string }>(`select state from sm_demo_packs where org_id = $1`, [e.org]))!.state).toBe("purging");
    expect(await e.db.one(`select 1 from sm_audit where org_id = $1 and action = 'demo_load'`, [e.org])).toBeNull();
    // a purge whose job stopped is queued again from the console
    await e.db.query(`update sm_jobs set status = 'failed' where org_id = $1 and kind = 'demo.purge'`, [e.org]);
    await e.owner.post(`/o/${e.org}/demo/purge`, { confirm: "حذف کامل" });
    expect(await e.db.one(`select 1 from sm_jobs where org_id = $1 and kind = 'demo.purge' and status = 'queued'`, [e.org])).toBeTruthy();
    await runToEnd(e.cfg, e.org, "purge", { budgetMs: 300_000 });
    expect(await e.db.one(`select 1 from sm_demo_packs where org_id = $1`, [e.org])).toBeNull();
  }, 600_000);

  it("a tombstoned pack is only finalised: the purge never looks for demo rows again", async () => {
    await e.db.query(`insert into sm_demo_packs (org_id, state, size, progress, purge_mark) values ($1, 'tombstoned', 'small', '{"purge": "finish", "saved_at": "2000-01-01T00:00:00Z"}'::jsonb, 0)`, [e.org]);
    await e.db.query(`insert into sm_demo_rows (org_id, row_id, tbl) values ($1, $2, 'sm_todos')`, [e.org, uuidv7()]);
    await e.owner.post(`/o/${e.org}/demo/purge`, { confirm: "حذف کامل" });
    expect((await e.db.one<{ state: string }>(`select state from sm_demo_packs where org_id = $1`, [e.org]))!.state).toBe("tombstoned");
    expect(await e.db.one(`select 1 from sm_jobs where org_id = $1 and kind = 'demo.purge' and status = 'queued'`, [e.org])).toBeNull();
    expect(await e.db.one(`select 1 from sm_jobs where org_id = $1 and kind = 'demo.finalize' and status = 'queued'`, [e.org])).toBeTruthy();
  });
});

describe("nothing about demo records leaves the system", () => {
  let e: EngineOrg;
  const sent: Buffer[] = [];
  const calls: string[] = [];

  beforeAll(async () => {
    setTransportFactory(() => {
      const t = nodemailer.createTransport({ streamTransport: true, buffer: true });
      return {
        async sendMail(m: Record<string, unknown>) {
          const info = await t.sendMail(m as never);
          sent.push(info.message as Buffer);
          return info as { messageId?: string; response?: string };
        },
      };
    });
    e = await engineOrg();
    e.cfg.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    await drain(e, 240_000);
    await e.owner.post(`/o/${e.org}/r/email_channel`, { name: "میز خدمت", from_address: "support@itsm.example", is_default: true, smtp_host: "smtp.itsm.example", smtp_user: "support", smtp_password: "smtp-secret" });
  }, 600_000);

  afterAll(() => setTransportFactory(null));

  it("a demo major incident sends no email, SMS or webhook; real people get no bell", async () => {
    const mgr = await e.member("member", "mgr@bank.example");
    await e.owner.put(`/o/${e.org}/access/members/${mgr.userId}`, { roles: ["incident_manager", "service_desk_manager"], persona: "agent" });
    await packOf(e);
    const demoMgr = await persona(e, "manager", ["incident_manager", "service_desk_manager"]);
    const sys = await systemCtx(e.cfg, e.org);
    // control: a real P1 incident reaches the real incident manager by email
    await sys.write((tx) => createIn(tx, sys, "incident", { short_description: "قطعی واقعی", impact: "1", urgency: "1", priority: "1" }, { trusted: true }));
    await drain(e);
    expect(sent.length).toBeGreaterThan(0);
    sent.length = 0;
    calls.length = 0;

    // the demo pack's major incident
    const inc = await inDemoScope(e.org, async () => {
      const row = await sys.write((tx) => createIn(tx, sys, "incident", { short_description: "قطعی سوئیچ کارت (نمایشی)", impact: "1", urgency: "1", priority: "1" }, { trusted: true }));
      await majorAction(sys, String(row.id), "declare", { reason: "اختلال سراسری نمایشی", mi_manager_id: demoMgr.id, mi_comms_id: demoMgr.id }).catch(() => null);
      return String(row.id);
    });
    await drain(e);
    expect(sent.length).toBe(0);
    expect(calls.filter((u) => !u.includes("127.0.0.1") && !u.includes("localhost"))).toEqual([]);
    const logs = await e.db.query<{ channel: string; status: string; reason: string | null; recipient_id: string | null }>(`select channel, status, reason, recipient_id from sm_notification_log where org_id = $1 and record_id = $2`, [e.org, inc]);
    expect(logs.filter((l) => l.channel !== "in_app" && l.status === "sent")).toEqual([]);
    // no bell for a real person about the demo record
    expect(await e.db.one(`select 1 from sm_notifications where org_id = $1 and record_id = $2 and user_id = $3`, [e.org, inc, mgr.userId])).toBeNull();
    // a message that would leave the system inside the demo scope is refused at the sender
    await expect(inDemoScope(e.org, () => sendMail(e.cfg, e.org, { id: uuidv7(), smtp_host: "smtp.itsm.example" } as never, { to: "x@example.com", subject: "x", text: "x" } as never))).rejects.toBeInstanceOf(DemoOutboundError);
    // a scheduled export to an outside address leaves the demo records out (an export kept inside the system keeps them)
    const { buildExport } = await import("@server/modules/admin/exports");
    const text = async (withoutDemo: boolean) => new TextDecoder().decode((await buildExport(sys, ["incident"], "json", { base: "x", withoutDemo })).files[0].data);
    expect(await text(false)).toContain("قطعی سوئیچ کارت (نمایشی)");
    const out = await text(true);
    expect(out).not.toContain("قطعی سوئیچ کارت (نمایشی)");
    expect(out).toContain("قطعی واقعی");
  }, 600_000);
});
