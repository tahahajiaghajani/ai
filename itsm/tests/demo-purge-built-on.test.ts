// «حذف داده‌های نمایشی» when the owner built on top of the pack (docs/DEMO_FA.md «حذف کامل», release 1.1.5; the owner's
// report: «nothing must break, even if we built workflows or other things on top of the demo data»). The small bank is
// loaded; the owner builds real things that name the pack's people, groups, units, CIs and forms — library fields with a
// pack person as default, forms, positions held by pack and real people, two published workflows naming pack groups,
// positions, units and people, real records filed for and assigned to the pack, a group, a notification rule, a saved
// view, an approval rule, a flow, an SLA definition, a dashboard, a portal link and a business rule; the pack's people
// and real people work on it; the purge is previewed and run as the console runs it. Then:
//   · it ends, nothing names a removed row anywhere outside the trail and the published snapshots (`danglingRefs`)
//   · nothing widens: a definition whose condition, audience or approvers only named the pack stops instead of
//     applying to everyone; a workflow whose starters were only the pack is closed to everyone, not opened
//   · every API works after it: the hub, the designer, preview of a step's people, publish, new and open cases, a new
//     incident (its flow, rule and SLA), a new change (its approvals), and a second load and purge
// Runs on PGlite (CI) and, with ITSM_PG_URL or ITSM_PG_BIN (tests/pg-real.ts), on a real PostgreSQL with the server's
// pool and with the web version's pool and limits (statement 30 s, lock 10 s, idle in transaction 15 s, no pipelining).
// The scenario is the probe of 1.1.5 (purge-onbuild) made into assertions.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPgliteDb } from "@server/db/pglite";
import { createPostgresDb } from "@server/db/postgres";
import { migrate } from "@server/db/migrate";
import { webPoolOptions } from "@server/cloud";
import { createApp } from "@server/app";
import type { ServerConfig } from "@server/context";
import type { Db } from "@server/db";
import { tick } from "@server/jobs";
import { danglingRefs, runToEnd } from "@server/modules/demo";
import { Client, quietLog, signupWithOrg } from "./helpers";
import { PNG, upload } from "./engine-helpers";
import { realPg, realPgAvailable } from "./pg-real";

const t0 = Date.now();
const log = (m: string) => console.log(`[built-on ${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);

interface World {
  app: { fetch: (r: Request) => Response | Promise<Response> };
  db: Db;
  cfg: ServerConfig;
  owner: Client;
  org: string;
  ownerId: string;
  P: string;
  alice: { id: string; c: Client };
  bob: { id: string; c: Client };
  close(): Promise<void>;
}

async function world(db: Db, close: () => Promise<void>): Promise<World> {
  await migrate(db);
  const cfg: ServerConfig = { mode: "cloud", db, secret: "test-secret", allowSignup: true, platformAdmins: [], origin: "cloud", log: quietLog, fetch: globalThis.fetch.bind(globalThis) };
  const app = createApp(cfg);
  const owner = new Client(app);
  const org = await signupWithOrg(owner, { name: "بانک آفتاب", timezone: "Asia/Tehran" });
  const me = await owner.get("/auth/me");
  const P = `/o/${org}`;
  const member = async (email: string, name: string) => {
    const added = await owner.post(`${P}/members`, { email, full_name: name, role: "member" });
    const c = new Client(app);
    await c.post("/auth/login", { email, password: added.temp_password });
    return { id: String((await c.get("/auth/me")).user.id), c };
  };
  const alice = await member(`alice.${org.slice(0, 8)}@example.com`, "آلیس واقعی");
  const bob = await member(`bob.${org.slice(0, 8)}@example.com`, "باب واقعی");
  return { app, db, cfg, owner, org, ownerId: String(me.user.id), P, alice, bob, close };
}

/** Run jobs of these kinds (their delay skipped) until none waits. */
async function drain(w: World, kinds: string[], budgetMs = 120_000) {
  const until = Date.now() + budgetMs;
  while (Date.now() < until) {
    await w.db.query(`update sm_jobs set run_at = now() where status = 'queued' and run_at > now() and kind = any($1::text[])`, [`{${kinds.join(",")}}`]);
    const r = await tick(w.cfg, { budgetMs: 10_000 });
    if (r.ran || r.more) continue;
    if (!(await w.db.one(`select 1 as x from sm_jobs where status = 'queued' and kind = any($1::text[]) and run_at <= now() + interval '1 second' limit 1`, [`{${kinds.join(",")}}`]))) return;
  }
}
const PROCESS_JOBS = ["flows.run", "flows.resume", "process.timer", "process.apply"];

/** Run what is due (the queue goes on after a purge: notifications, timers, the organisation's passes). */
async function settle(w: World, budgetMs = 60_000) {
  const until = Date.now() + budgetMs;
  while (Date.now() < until) {
    const r = await tick(w.cfg, { budgetMs: 10_000 });
    if (!r.ran && !r.more) break;
  }
}

const reauth = (w: World) => w.db.query(`update sm_sessions set reauth_at = now() where user_id = $1`, [w.ownerId]);

/** The ids of every row of the organisation and its pack's accounts (what the purge removed is the difference). */
async function allIds(w: World): Promise<Set<string>> {
  const out = new Set<string>();
  const tables = await w.db.query<{ t: string }>(
    `select c.table_name as t from information_schema.columns c join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
      where c.table_schema = current_schema() and c.table_name like 'sm\\_%' and c.column_name = 'org_id' and c.table_name not like 'sm\\_demo\\_%'
        and exists (select 1 from information_schema.columns i where i.table_schema = c.table_schema and i.table_name = c.table_name and i.column_name = 'id' and i.data_type = 'uuid')`,
  );
  for (const { t } of tables) for (const r of await w.db.query<{ id: string }>(`select id::text as id from ${t} where org_id = $1`, [w.org])) out.add(r.id);
  for (const r of await w.db.query<{ id: string }>(`select id::text as id from sm_users where prefs ->> 'demo_org' = $1`, [w.org])) out.add(r.id);
  return out;
}

builtOn("on PGlite", async () => world(await createPgliteDb({}), async () => {}));
builtOn(
  "on PostgreSQL with the server's pool",
  async () => {
    const pg = await realPg("builton_srv");
    const db = createPostgresDb({ url: pg.url, max: 4, ssl: false, prepare: true });
    return world(db, async () => {
      await db.close().catch(() => undefined);
      await pg.stop();
    });
  },
  !realPgAvailable(),
);
builtOn(
  "on PostgreSQL with the web version's pool and limits",
  async () => {
    const pg = await realPg("builton_web");
    const db = createPostgresDb({ ...webPoolOptions(pg.url, { DATABASE_SSL: "disable" }), prepare: false });
    return world(db, async () => {
      await db.close().catch(() => undefined);
      await pg.stop();
    });
  },
  !realPgAvailable(),
);

function builtOn(title: string, make: () => Promise<World>, skip = false) {
  describe.skipIf(skip)(`the owner built on top of the demo pack, then purged it (${title})`, () => {
    let w: World;
    let P = "";
    // the pack's ids
    let pp: Record<string, string> = {};
    let G: Record<string, string> = {};
    let U: Record<string, string> = {};
    let branch = "";
    let ci = "";
    let ci2 = "";
    let service = "";
    let packForm = "";
    let packProcess = "";
    const persona: Record<string, Client> = {};
    // what the owner built
    const built: Record<string, string> = {};
    const cases: Record<string, string> = {};
    let removed = new Set<string>();
    let report: Record<string, any> | null = null;

    beforeAll(async () => {
      w = await make();
      P = w.P;
    }, 600_000);
    afterAll(async () => {
      await w?.close();
    });

    it("loads the small bank and signs in its people", async () => {
      await w.owner.post(`${P}/demo/load`, { size: "small" });
      await runToEnd(w.cfg, w.org, "load", { budgetMs: 2_400_000 });
      const status = await w.owner.get(`${P}/demo`);
      expect(status.state).toBe("loaded");
      log(`${title}: loaded`);
      const memo = (await w.db.one<{ memo: any }>(`select progress->'memo' as memo from sm_demo_packs where org_id = $1`, [w.org]))!.memo;
      pp = memo.people.personas;
      G = memo.groups;
      U = memo.units ?? {};
      const demoOf = (t: string, extra = "") => `select x.id::text as id from ${t} x where x.org_id = $1 and exists (select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id = x.id) ${extra}`;
      branch = (await w.db.one<{ id: string }>(`${demoOf("sm_org_units", "and x.kind = 'branch'")} order by x.name limit 1`, [w.org]))!.id;
      const cis = await w.db.query<{ id: string }>(`${demoOf("sm_cis")} order by x.name limit 2`, [w.org]);
      [ci, ci2] = [cis[0].id, cis[1].id];
      service = (await w.db.one<{ id: string }>(`${demoOf("sm_services")} order by x.name limit 1`, [w.org]))!.id;
      packProcess = (await w.db.one<{ id: string }>(`select id::text as id from sm_processes where org_id = $1 and key = 'aftab_access_request'`, [w.org]))?.id ?? "";
      packForm = (await w.db.one<{ id: string }>(`select id::text as id from sm_forms where org_id = $1 and name = 'فرم درخواست دسترسی به سامانه (نمونه)'`, [w.org]))?.id ?? "";
      await reauth(w);
      await w.owner.post(`${P}/demo/signin`, { on: true });
      const st = await w.owner.get(`${P}/demo`);
      for (const k of ["requester", "agent", "manager", "soc"]) {
        const email = st.accounts.find((a: { persona: string }) => a.persona === k).email;
        const c = new Client(w.app);
        await c.post("/auth/login", { email, password: st.password });
        persona[k] = c;
      }
    }, 3_000_000);

    it("the owner builds on top of the pack", async () => {
      const o = w.owner;
      const A = w.alice.id;
      const B = w.bob.id;
      // real members in a pack branch, with a pack manager and a pack delegate
      for (const [u, extra] of [[A, { org_unit_id: branch, manager_id: pp.manager, delegate_id: pp.agent }], [B, { org_unit_id: branch }]] as const) {
        const prof = await w.db.one<{ id: string; version: number }>(`select id::text as id, version from sm_member_profiles where org_id = $1 and user_id = $2`, [w.org, u]);
        if (prof) await o.patch(`${P}/r/member_profile/${prof.id}`, { ...extra, version: prof.version });
        else await o.post(`${P}/r/member_profile`, { user_id: u, persona: "requester", ...extra });
      }
      // library fields; the person field's default is a pack person
      const lib: [string, string, string, Record<string, unknown>][] = [
        ["u_prj_title", "عنوان پروژه", "string", {}],
        ["u_prj_lead", "مالک پروژه", "user", { default_value: pp.agent }],
        ["u_prj_team", "اعضای تیم", "users", {}],
        ["u_prj_grp", "گروه اجرا", "group", {}],
        ["u_prj_unit", "واحد اجرا", "unit", {}],
        ["u_prj_ci", "پیکربندی", "record", { validation: { ref: "ci" } }],
        ["u_prj_note", "یادداشت کارشناس", "text", {}],
      ];
      for (const [name, label, type, more] of lib) built[name] = (await o.post(`${P}/fields/library`, { name, label, type, ...more }, 201)).row.id;
      built.F1 = (await o.post(`${P}/forms`, {
        name: "فرم پروژه",
        layout: { tabs: [{ label: "مشخصات", sections: [{ label: "اصلی", items: [{ field: "u_prj_title", required: true }, { field: "u_prj_lead" }, { field: "u_prj_team" }, { field: "u_prj_grp" }, { field: "u_prj_unit" }, { field: "u_prj_ci" }, { field: "u_prj_note" }] }] }] },
      }, 201)).form.id;
      // a second form with one of the pack's own library fields
      built.F2 = (await o.post(`${P}/forms`, { name: "فرم دسترسی پروژه", layout: { tabs: [{ label: "درخواست", sections: [{ label: null, items: [{ field: "u_prj_title", required: true }, { field: "u_aftab_system" }, { field: "u_prj_lead" }] }] }] } }, 201)).form.id;
      await o.post(`${P}/fields/attach`, { table: "incident", field: "u_prj_lead" }, 201);
      await o.post(`${P}/fields/attach`, { table: "incident", field: "u_prj_team" }, 201);
      await o.post(`${P}/fields/attach`, { table: "incident", field: "u_aftab_system" }, 201);
      // positions held by the pack's people only, by pack and real people in a pack branch
      for (const [key, name, more] of [["project_manager", "مدیر پروژه", {}], ["senior_expert", "کارشناس ارشد", { unit_kind: "branch" }]] as const) built[key] = (await o.post(`${P}/r/position`, { key, name, ...more })).row.id;
      for (const [key, user, unit] of [["project_manager", pp.agent, U.hq ?? null], ["project_manager", pp.manager, U.hq ?? null], ["senior_expert", pp.requester, branch], ["senior_expert", B, branch]] as const)
        await o.post(`${P}/r/position_holder`, { position_id: built[key], user_id: user, org_unit_id: unit, kind: "primary" });

      // W1 «گردش کار پروژه»: a position held by the pack only, a pack group, named pack and real people, a position in a
      // pack unit, a person field, the requester's manager (a pack person), a notify step to the pack
      const n = (id: string, type: string, config: Record<string, unknown> = {}, label?: string) => ({ id, type, config, ...(label ? { label } : {}) });
      const e = (s: string, t: string, port?: string) => ({ id: `${s}.${port ?? "out"}.${t}`, source: s, target: t, ...(port ? { port } : {}) });
      const F = built.F1;
      const w1 = {
        graph: {
          nodes: [
            n("t", "trigger"),
            n("s", "form_step", { action: "fill", start: true, form: F, rights: { default: "edit", fields: { u_prj_note: "hidden" } } }, "ثبت درخواست"),
            n("a1", "form_step", { action: "approve", form: F, quorum: "any", rights: { default: "read", fields: {} }, assignees: [{ kind: "position", position: "project_manager", where: "anywhere" }] }, "تأیید مدیر پروژه"),
            n("n1", "notify", { to: [{ kind: "users", users: [pp.soc] }, { kind: "group", group: G.desk }], subject: "پروژه تأیید شد", body: "پروژه تأیید شد" }, "اعلان"),
            n("a2", "form_step", { action: "review", form: F, rights: { default: "read", fields: {} }, assignees: [{ kind: "group", group: G.soc }], ifNobody: "skip" }, "بررسی امنیت"),
            n("a3", "form_step", { action: "fill", form: F, rights: { default: "read", fields: { u_prj_note: "edit" } }, assignees: [{ kind: "users", users: [pp.agent, A] }] }, "اقدام کارشناسان"),
            n("a4", "form_step", { action: "approve", form: F, quorum: "any", rights: { default: "read", fields: {} }, assignees: [{ kind: "position", position: "senior_expert", where: "unit", unit: branch }], fallback: [{ kind: "users", users: [w.ownerId] }] }, "تأیید کارشناس ارشد شعبه"),
            n("a5", "form_step", { action: "fill", form: F, rights: { default: "read", fields: { u_prj_note: "edit" } }, assignees: [{ kind: "field", field: "u_prj_lead" }] }, "اقدام مالک پروژه"),
            n("ok", "end", { outcome: "completed" }, "پایان"),
            n("no", "end", { outcome: "rejected" }, "رد"),
          ],
          edges: [
            e("t", "s"), e("s", "a1"), e("a1", "n1", "approved"), e("a1", "no", "rejected"), e("a1", "s", "returned"), e("n1", "a2"), e("a2", "a3"), e("a2", "s", "returned"),
            e("a3", "a4"), e("a4", "a5", "approved"), e("a4", "no", "rejected"), e("a4", "s", "returned"), e("a5", "ok"),
          ],
        },
        starters: [],
        title_template: "پروژهٔ {{case.u_prj_title}}",
        requester_view: ["u_prj_note"],
        managers: [pp.manager, w.ownerId],
        manager_groups: [G.desk],
        confidential: false,
      };
      // W2: the pack's own form on a step, starters a pack group and real people; W3: only the pack may start it
      const w2 = (starters: unknown[]) => ({
        graph: {
          nodes: [
            n("t", "trigger"),
            n("s", "form_step", { action: "fill", start: true, form: built.F2, rights: { default: "edit", fields: {} } }, "ثبت درخواست"),
            n("g", "form_step", { action: "fill", form: packForm, rights: { default: "read", fields: { u_aftab_note: "required" } }, assignees: [{ kind: "group", group: G.desk, members: [pp.agent] }, { kind: "users", users: [w.ownerId] }] }, "اعطای دسترسی پروژه"),
            n("ok", "end", { outcome: "completed" }, "پایان"),
          ],
          edges: [e("t", "s"), e("s", "g"), e("g", "ok")],
        },
        starters, title_template: null, requester_view: [], managers: [w.ownerId], manager_groups: [], confidential: false,
      });
      const make = async (key: string, name: string, draft: unknown) => {
        const made = await o.post(`${P}/process/defs`, { name, key, category: "پروژه‌ها" }, 201);
        built[key] = made.process.id;
        const saved = await o.put(`${P}/process/defs/${made.process.id}/draft`, { draft });
        expect((saved.problems ?? []).filter((p: { level: string }) => p.level === "error")).toEqual([]);
        await reauth(w);
        await o.post(`${P}/process/defs/${made.process.id}/publish`, { note: "نسخهٔ نخست" });
      };
      await make("project_flow", "گردش کار پروژه", w1);
      await make("project_access", "دسترسی پروژه", w2([{ kind: "group", group: G.desk }, { kind: "users", users: [w.ownerId, A] }]));
      await make("project_pack_only", "فقط برای میز خدمت", w2([{ kind: "group", group: G.desk }]));
      // the owner's own version of the pack's workflow (a real version of a demo process)
      if (packProcess) {
        const d = await o.get(`${P}/process/defs/${packProcess}`);
        await o.put(`${P}/process/defs/${packProcess}/draft`, { draft: { ...d.draft, title_template: "دسترسی (ویرایش مالک) {{case.u_aftab_system}}" } });
        await reauth(w);
        await o.post(`${P}/process/defs/${packProcess}/publish`, { note: "نسخهٔ مالک" });
      }

      // other real things that name the pack
      built.I1 = (await o.post(`${P}/r/incident`, { short_description: "کندی سامانهٔ پروژه (واقعی، برای فرد نمایشی)", caller_id: pp.requester, assigned_to: pp.agent, assignment_group_id: G.desk, ci_id: ci, impact: "2", urgency: "2" })).row.id;
      built.I2 = (await o.post(`${P}/r/incident`, { short_description: "قطعی واقعی", caller_id: A, assigned_to: pp.agent, assignment_group_id: G.desk, ci_id: ci, affected_cis: [ci, ci2], watch_list: [pp.manager, w.ownerId], u_prj_lead: pp.agent, u_prj_team: [pp.agent, A], u_aftab_system: "سامانهٔ مالی", impact: "3", urgency: "3" })).row.id;
      await o.post(`${P}/r/incident/${built.I2}/links`, { table: "ci", id: ci, kind: "affects" });
      built.G1 = (await o.post(`${P}/r/group`, { name: "تیم پروژه (واقعی)", types: ["assignment"], manager_id: pp.manager, parent_id: G.desk })).row.id;
      await o.post(`${P}/r/group_member`, { group_id: built.G1, user_id: pp.agent, kind: "member" });
      await o.post(`${P}/r/group_member`, { group_id: built.G1, user_id: A, kind: "member" });
      built.N1 = (await o.post(`${P}/r/notification_rule`, { name: "خبر رخداد پروژه", table_key: "incident", event: "created", recipients: { users: [pp.agent, A], groups: [G.desk] }, channels: ["in_app"], condition: { f: "assignment_group_id", op: "eq", v: G.desk } })).row.id;
      built.N2 = (await o.post(`${P}/r/notification_rule`, { name: "خبر همه‌جز میز خدمت", table_key: "incident", event: "created", recipients: { users: [A] }, channels: ["in_app"], condition: { f: "assignment_group_id", op: "ne", v: G.desk } })).row.id;
      built.V1 = (await o.post(`${P}/r/view`, { table_key: "incident", name: "رخدادهای کارشناس نمایشی", shared: true, filter: { and: [{ f: "assigned_to", op: "eq", v: pp.agent }] } })).row.id;
      built.AR1 = (await o.post(`${P}/r/approval_rule`, { name: "تأیید تغییرهای پروژه", table_key: "change_request", condition: { f: "short_description", op: "contains", v: "پروژه" }, levels: [{ name: "کمیته", sources: [{ kind: "users", users: [pp.manager] }, { kind: "groups", groups: [G.cab] }], rule: "any" }] })).row.id;
      const flow = await o.post(`${P}/r/flow`, {
        name: "ارجاع رخدادهای پروژه", trigger: "record", trigger_table: "incident", trigger_events: ["created"], run_as: "trigger_user",
        trigger_condition: { f: "short_description", op: "contains", v: "پروژه" },
        graph: { nodes: [{ id: "trigger", type: "trigger", config: {} }, { id: "u", type: "update_record", config: { values: { assignment_group_id: G.desk } } }], edges: [{ id: "trigger-out-u", source: "trigger", target: "u" }] },
      });
      built.FL1 = flow.row.id;
      await o.post(`${P}/flows/${built.FL1}/publish`, {});
      await o.patch(`${P}/r/flow/${built.FL1}`, { active: true, version: (await o.get(`${P}/r/flow/${built.FL1}`)).row.version });
      built.SLA1 = (await o.post(`${P}/r/sla_definition`, { name: "پاسخ رخدادهای سرویس نمایشی", table_key: "incident", type: "sla", target: "response", duration: 3600, start_condition: { f: "priority", op: "in", v: ["1", "2", "3", "4"] }, service_id: service })).row.id;
      built.PL1 = (await o.post(`${P}/r/portal_link`, { name: "سامانهٔ میز خدمت", url: "https://desk.example.com", aud_groups: [G.desk] })).row.id;
      built.BR1 = (await o.post(`${P}/r/business_rule`, { name: "خودپردازها به میز خدمت", table_key: "incident", timing: "before", events: ["insert"], condition: { f: "short_description", op: "contains", v: "خودپرداز" }, actions: [{ type: "set", field: "assignment_group_id", value: G.desk }] })).row.id;
      built.CHG = (await o.post(`${P}/r/change_request`, { short_description: "ارتقای سرور (واقعی)", ci_id: ci, assignment_group_id: G.cab, assigned_to: pp.manager })).row.id;
      built.CHG2 = (await o.post(`${P}/r/change_request`, { short_description: "تغییر پروژه پیش از حذف" })).row.id;
      await settle(w);
      log(`${title}: built ${Object.keys(built).length} things`);
    }, 600_000);

    it("the pack's people and real people work on it", async () => {
      const values = (title: string) => ({ u_prj_title: title, u_prj_lead: pp.agent, u_prj_team: [pp.agent, w.alice.id], u_prj_grp: G.desk, u_prj_unit: branch, u_prj_ci: ci });
      // a pack person's case on the owner's workflow (a demo case)
      cases.C1 = (await persona.requester.post(`${P}/process/start`, { process: "project_flow", values: values("شبکهٔ شعبه") }, 201)).case;
      await drain(w, PROCESS_JOBS);
      const box = await persona.manager.get(`${P}/process/inbox`);
      const t1 = box.rows.find((r: { case_id: string; kind: string }) => r.case_id === cases.C1 && r.kind === "process_step");
      expect(t1).toBeTruthy();
      await persona.manager.post(`${P}/process/tasks/${t1.id}/submit`, { outcome: "approved", comment: "تأیید شد" });
      await drain(w, PROCESS_JOBS);
      // a real member's case: the owner hands «تأیید مدیر پروژه» to bob (only the pack holds the position)
      cases.C2 = (await w.alice.c.post(`${P}/process/start`, { process: "project_flow", values: values("سرور پروژه") }, 201)).case;
      await drain(w, PROCESS_JOBS);
      await w.owner.post(`${P}/process/cases/${cases.C2}/reassign`, { step: "a1", to: [w.bob.id], comment: "ارجاع به باب" });
      await drain(w, PROCESS_JOBS);
      const bb = await w.bob.c.get(`${P}/process/inbox`);
      const t2 = bb.rows.find((r: { case_id: string; kind: string }) => r.case_id === cases.C2 && r.kind === "process_step");
      expect(t2).toBeTruthy();
      await w.bob.c.post(`${P}/process/tasks/${t2.id}/submit`, { outcome: "approved" });
      await drain(w, PROCESS_JOBS);
      // the owner's case for a pack person («درخواست برای»): recorded on demo data
      cases.C3 = (await w.owner.post(`${P}/process/start`, { process: "project_flow", values: values("انبار داده"), requested_for: pp.requester }, 201)).case;
      // alice's case on the workflow with the pack's form on a step
      cases.C5 = (await w.alice.c.post(`${P}/process/start`, { process: "project_access", values: { u_prj_title: "دسترسی آلیس", u_aftab_system: "سامانهٔ مالی", u_prj_lead: w.alice.id } }, 201)).case;
      await drain(w, PROCESS_JOBS);
      // the pack's agent on the owner's real incident: a comment, a file, a change
      const ag = persona.agent;
      await ag.post(`${P}/r/incident/${built.I2}/journal`, { kind: "comment", body: "بررسی شد" });
      const up = await upload(w.app, ag, `${P}/r/incident/${built.I2}/attachments`, "log.png", PNG, "image/png");
      expect(up.status).toBeLessThan(300);
      // the owner on a demo incident: a note and a real problem it points to
      const demoInc = (await w.db.one<{ id: string }>(`select x.id::text as id from sm_incidents x where x.org_id = $1 and x.deleted_at is null and exists (select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id = x.id) order by x.opened_at desc limit 1`, [w.org]))!.id;
      await w.owner.post(`${P}/r/incident/${demoInc}/journal`, { kind: "work_note", body: "یادداشت مالک" });
      built.PRB = (await w.owner.post(`${P}/r/problem`, { short_description: "مشکل واقعی از رخداد نمایشی", assignment_group_id: G.desk })).row.id;
      await w.owner.patch(`${P}/r/incident/${demoInc}`, { problem_id: built.PRB, version: (await w.owner.get(`${P}/r/incident/${demoInc}`)).row.version });
      await settle(w);
    }, 600_000);

    it("the preview says what goes, what is cleaned and what is routed again", async () => {
      const before = await w.db.one<{ n: number }>(`select count(*)::int as n from sm_demo_rows where org_id = $1`, [w.org]);
      report = await w.owner.get(`${P}/demo/report`);
      log(`${title}: preview ${JSON.stringify({ rows: report!.rows, partial: report!.partial ?? false, deleted: report!.deleted?.length, cleaned: report!.cleaned?.length, rerouted: report!.rerouted?.length })}`);
      expect(report!.rows).toBeGreaterThan(0);
      // a dry run: nothing changed
      expect((await w.db.one<{ n: number }>(`select count(*)::int as n from sm_demo_rows where org_id = $1`, [w.org]))!.n).toBe(before!.n);
      expect((await w.db.one<{ active: boolean }>(`select active from sm_notification_rules where id = $1`, [built.N1]))!.active).toBe(true);
      // the preview runs within a web request's time: a large pack may give only its first part (and says so)
      if (report!.partial) return;
      // recorded on demo data (whoever made it): the real incident filed for a pack caller, the cases of pack people
      const deleted = new Map<string, { rows: number }>((report!.deleted as { table: string; rows: number }[]).map((d) => [d.table, d]));
      expect(deleted.get("incident")?.rows ?? 0).toBeGreaterThan(0);
      expect(deleted.get("process_case")?.rows ?? 0).toBeGreaterThan(0);
      // definitions cleaned by name, deactivated when they no longer mean anything
      const cleaned = report!.cleaned as { table: string; name: string; deactivated: boolean }[];
      expect(cleaned.find((c) => c.table === "notification_rule" && c.name === "خبر رخداد پروژه")).toMatchObject({ deactivated: true });
      expect(cleaned.find((c) => c.table === "process" && c.name === "گردش کار پروژه")).toBeTruthy();
      expect(cleaned.filter((c) => c.table === "process_case" || c.table === "process_submission")).toEqual([]);
      // kept records routed again
      expect((report!.rerouted as { table: string }[]).some((r) => r.table === "incident")).toBe(true);
    }, 300_000);

    it("purges as the console does, to the end", async () => {
      const ids = await allIds(w);
      await reauth(w);
      await w.owner.post(`${P}/demo/purge`, { confirm: "حذف کامل" });
      const t = Date.now();
      await runToEnd(w.cfg, w.org, "purge", { budgetMs: 1_800_000 });
      log(`${title}: purged in ${((Date.now() - t) / 1000).toFixed(0)} s`);
      expect(await w.db.one(`select state from sm_demo_packs where org_id = $1 and state <> 'tombstoned'`, [w.org])).toBeNull();
      await settle(w, 120_000);
      const after = await allIds(w);
      removed = new Set([...ids].filter((id) => !after.has(id)));
      const failed = await w.db.query<{ kind: string; last_error: string }>(`select kind, left(last_error, 300) as last_error from sm_jobs where org_id = $1 and status = 'failed'`, [w.org]);
      expect(failed).toEqual([]);
      const audit = await w.db.one<{ data: Record<string, any> }>(`select data from sm_audit where org_id = $1 and action = 'demo_purge' order by at desc limit 1`, [w.org]);
      log(`${title}: audit ${JSON.stringify(audit?.data)}`);
      expect(audit?.data.deleted).toBeGreaterThan(0);
    }, 2_400_000);

    it("nothing names a removed row", async () => {
      expect(await danglingRefs(w.db, w.org, removed)).toEqual([]);
    }, 300_000);

    it("recorded on demo data went with it; what was built on it stayed and lost only the pack", async () => {
      const one = (sql: string, p: unknown[]) => w.db.one<Record<string, any>>(sql, p);
      // went: a real incident filed for a pack caller, the cases of pack people and for one
      expect(await one(`select 1 as x from sm_incidents where id = $1`, [built.I1])).toBeNull();
      for (const k of ["C1", "C3"]) expect(await one(`select 1 as x from sm_process_cases where id = $1`, [cases[k]])).toBeNull();
      // stayed: alice's cases, the real incident, the group, the problem
      for (const k of ["C2", "C5"]) expect(await one(`select 1 as x from sm_process_cases where id = $1`, [cases[k]])).toBeTruthy();
      const i2 = (await one(`select assigned_to::text as a, assignment_group_id::text as g, ci_id::text as ci, watch_list as wl, affected_cis as ac, custom from sm_incidents where id = $1`, [built.I2]))!;
      expect([i2.a, i2.ci]).toEqual([null, null]);
      expect(removed.has(String(i2.g))).toBe(false);
      expect(i2.wl).toEqual([w.ownerId]);
      expect(i2.ac ?? []).toEqual([]);
      expect(i2.custom?.u_prj_lead ?? null).toBeNull();
      expect(i2.custom?.u_prj_team).toEqual([w.alice.id]);
      // the pack's library field attached to a real table left it, with its values
      expect(i2.custom?.u_aftab_system).toBeUndefined();
      const g1 = (await one(`select manager_id, parent_id from sm_groups where id = $1`, [built.G1]))!;
      expect([g1.manager_id, g1.parent_id]).toEqual([null, null]);
      const members = await w.db.query<{ u: string }>(`select user_id::text as u from sm_group_members where group_id = $1 and deleted_at is null`, [built.G1]);
      expect(members.map((m) => m.u)).toEqual([w.alice.id]);
      // the real members' profiles lost their pack manager, delegate and unit
      const prof = (await one(`select manager_id, delegate_id, org_unit_id from sm_member_profiles where org_id = $1 and user_id = $2`, [w.org, w.alice.id]))!;
      expect([prof.manager_id, prof.delegate_id, prof.org_unit_id]).toEqual([null, null, null]);
      // the library field's default (a pack person) is cleared; the form dropped the pack's field
      expect((await one(`select default_value from sm_field_defs where id = $1`, [built.u_prj_lead]))!.default_value ?? null).toBeNull();
      const f2 = (await one(`select layout from sm_forms where id = $1`, [built.F2]))!;
      expect(JSON.stringify(f2.layout)).not.toContain("u_aftab_system");
      // every cleaned definition has a line its owner reviews — definitions only: a kept record whose own values lost a
      // removed id (a case's data, a step's submission) is counted with the records routed again
      const reviewed = await w.db.query<{ entity: string }>(`select distinct entity from sm_audit where org_id = $1 and action = 'demo_purge_review'`, [w.org]);
      expect(reviewed.map((r) => r.entity)).toEqual(expect.arrayContaining(["notification_rule", "process", "business_rule"]));
      expect(reviewed.map((r) => r.entity).filter((t) => ["process_case", "process_submission", "process_task", "process_draft", "incident"].includes(t))).toEqual([]);
    }, 300_000);

    it("nothing widens: definitions that only named the pack stop instead of applying to everyone", async () => {
      const one = (sql: string, p: unknown[]) => w.db.one<Record<string, any>>(sql, p);
      // a rule whose condition only held for a pack group can no longer hold: it is off (never «always»)
      expect((await one(`select active from sm_notification_rules where id = $1`, [built.N1]))!.active).toBe(false);
      // the negation holds for every record left: the rule goes on, as it did for those records
      expect((await one(`select active from sm_notification_rules where id = $1`, [built.N2]))!.active).toBe(true);
      // a saved view of a pack person's records shows nothing (off or gone), never every record
      const v1 = await one(`select filter, deleted_at from sm_views where id = $1`, [built.V1]);
      expect(v1 === null || v1.deleted_at !== null || JSON.stringify(v1.filter) === JSON.stringify({ or: [] })).toBe(true);
      // an approval rule whose level only named the pack is off; an SLA on a pack service ends; a portal link for a
      // pack group is off (an empty audience would mean everyone); the business rule and the flow stop
      expect((await one(`select active from sm_approval_rules where id = $1`, [built.AR1]))!.active).toBe(false);
      expect((await one(`select active from sm_sla_definitions where id = $1`, [built.SLA1]))!.active).toBe(false);
      const pl = (await one(`select active, aud_groups from sm_portal_links where id = $1`, [built.PL1]))!;
      expect(pl.active).toBe(false);
      expect((await one(`select active, actions from sm_business_rules where id = $1`, [built.BR1]))).toMatchObject({ active: false, actions: [] });
      expect((await one(`select active from sm_flows where id = $1`, [built.FL1]))!.active).toBe(false);
      // a workflow only the pack could start: its draft names nobody (the designer asks for someone) and its published
      // version still lets nobody start it — never everyone
      const only = (await w.owner.get(`${P}/process/defs/${built.project_pack_only}`)).draft;
      expect(only.starters).toEqual([{ kind: "users", users: [] }]);
      const view = await w.alice.c.get(`${P}/process/defs/project_pack_only/view`).catch(() => null);
      expect(view?.start?.can_start ?? false).toBe(false);
      // starters that named real people too keep them
      expect((await w.owner.get(`${P}/process/defs/${built.project_access}`)).draft.starters).toEqual([{ kind: "users", users: [w.ownerId, w.alice.id] }]);
    }, 300_000);

    it("every page and API works after it", async () => {
      const o = w.owner;
      await o.get(`${P}/process/hub`);
      for (const key of ["project_flow", "project_access"]) {
        const d = await o.get(`${P}/process/defs/${built[key]}`);
        await o.get(`${P}/process/defs/${built[key]}/versions`);
        await o.get(`${P}/process/defs/${key}/view`);
        // the designer's preview of each step's people (a step the purge left without rules waits for the owner)
        for (const node of d.draft.graph.nodes.filter((x: { type: string; config: any }) => x.type === "form_step" && !x.config.start && x.config.assignees?.length))
          await o.post(`${P}/positions/resolve`, { step: node.config, action: node.config.action ?? "fill", quorum: node.config.quorum ?? null, label: node.label, requester: w.alice.id, values: {} });
      }
      for (const path of ["/positions/overview", "/r/position?limit=200", "/r/position_holder?limit=500", "/forms", `/forms/${built.F1}`, `/forms/${built.F2}/preview`, "/fields/library", "/process/inbox", "/process/cases", "/r/incident?limit=50", `/r/incident/${built.I2}`, `/r/incident/${built.I2}/journal`, `/r/group/${built.G1}`, "/members", "/r/approval", "/demo/banner", "/r/notification_rule?limit=200"])
        await o.get(`${P}${path}`);
      await w.alice.c.get(`${P}/process/inbox`);
      // the owner fixes what the designer shows and publishes again; a new case runs
      const d = await o.get(`${P}/process/defs/${built.project_flow}`);
      const draft = structuredClone(d.draft);
      for (const node of draft.graph.nodes) {
        if (node.type !== "form_step" || node.config.start) continue;
        // steps the purge left without rules, and the position only the pack held, go to bob
        if (!node.config.assignees?.length || node.id === "a1") node.config.assignees = [{ kind: "users", users: [w.bob.id] }];
      }
      for (const node of draft.graph.nodes) if (node.type === "notify" && !node.config.to?.length) node.config.to = [{ kind: "users", users: [w.alice.id] }];
      const saved = await o.put(`${P}/process/defs/${built.project_flow}/draft`, { draft });
      log(`${title}: draft problems after the purge ${JSON.stringify((saved.problems ?? []).map((p: { message: string }) => p.message))}`);
      await reauth(w);
      await o.post(`${P}/process/defs/${built.project_flow}/publish`, { note: "پس از حذف داده‌های نمایشی" });
      const c = (await w.alice.c.post(`${P}/process/start`, { process: "project_flow", values: { u_prj_title: "پس از حذف", u_prj_lead: w.bob.id } }, 201)).case;
      await drain(w, PROCESS_JOBS);
      const kase = await o.get(`${P}/process/cases/${c}`);
      expect(kase.case.state).toBe("active");
      // an open real case goes on: its step that waited for a pack person is handed to a real one
      const c2 = await o.get(`${P}/process/cases/${cases.C2}`);
      log(`${title}: C2 after the purge ${c2.case.state} ${JSON.stringify(c2.case.current_steps)}`);
      expect(["active", "attention", "waiting"]).toContain(c2.case.state);
      // a new incident: the stopped flow, the rule and the SLA leave it alone; the field's default no longer applies
      const inc = (await o.post(`${P}/r/incident`, { short_description: "رخداد پروژه پس از حذف", caller_id: w.alice.id, impact: "3", urgency: "3" })).row;
      const atm = (await o.post(`${P}/r/incident`, { short_description: "خودپرداز شعبه پس از حذف", caller_id: w.alice.id, impact: "3", urgency: "3" })).row;
      await settle(w);
      for (const id of [inc.id, atm.id]) {
        const r = (await w.db.one<{ g: string | null; lead: string | null }>(`select assignment_group_id::text as g, custom ->> 'u_prj_lead' as lead from sm_incidents where id = $1`, [id]))!;
        expect(removed.has(String(r.g))).toBe(false);
        expect(r.lead).toBeNull();
      }
      // a new change: the approval rule that only named the pack is off; nobody approves it silently
      const chg = (await o.post(`${P}/r/change_request`, { short_description: "تغییر پروژه پس از حذف" })).row;
      await settle(w);
      const apv = await w.db.query<{ approver_id: string | null; state: string }>(`select approver_id::text as approver_id, state from sm_approvals where record_id = $1`, [chg.id]);
      expect(apv.filter((a) => a.approver_id && removed.has(a.approver_id))).toEqual([]);
      // the change approved before the purge: its rounds were planned again, nobody removed is asked
      const old = await w.db.query<{ approver_id: string | null; state: string }>(`select approver_id::text as approver_id, state from sm_approvals where record_id = $1 and deleted_at is null`, [built.CHG2]);
      expect(old.filter((a) => a.approver_id && removed.has(a.approver_id))).toEqual([]);
      const failed = await w.db.query<{ kind: string; e: string }>(`select kind, left(last_error, 300) as e from sm_jobs where org_id = $1 and status = 'failed'`, [w.org]);
      expect(failed).toEqual([]);
    }, 900_000);

    it("the pack loads again and purges again, cleanly", async () => {
      await reauth(w);
      await w.owner.post(`${P}/demo/load`, { size: "small", force: true });
      await runToEnd(w.cfg, w.org, "load", { budgetMs: 2_400_000 });
      const st = await w.owner.get(`${P}/demo`);
      expect(st.state).toBe("loaded");
      expect(st.refused ?? {}).toEqual({});
      const ids = await allIds(w);
      await reauth(w);
      await w.owner.post(`${P}/demo/purge`, { confirm: "حذف کامل" });
      await runToEnd(w.cfg, w.org, "purge", { budgetMs: 1_800_000 });
      expect(await w.db.one(`select state from sm_demo_packs where org_id = $1 and state <> 'tombstoned'`, [w.org])).toBeNull();
      const after = await allIds(w);
      const gone = new Set([...ids].filter((id) => !after.has(id)));
      expect(await danglingRefs(w.db, w.org, gone)).toEqual([]);
      // what the owner made stays
      for (const k of ["I2", "G1", "PRB", "project_flow"]) expect(after.has(built[k])).toBe(true);
    }, 3_600_000);
  });
}
