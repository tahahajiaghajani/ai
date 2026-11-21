// The owner's path of release 1.1.5's reports (the repro matrix «کسی پیدا نشد»), shared by the PGlite suite
// (tests/process-owner-path.test.ts) and the PostgreSQL one (tests/process-owner-path-pg.test.ts). An organisation with
// the bank demo pack's people — the pack's org, groups and people steps run inside its demo scope as `demo.load` runs
// them — and «ورود حساب‌های نمایشی» on; the owner's own fields, a form of two tabs and three sections, positions held by
// the pack's people and the organisation's own, and workflows «ثبت درخواست» → «مرحلهٔ فرم» → end, made through the
// routes the UI calls:
//   · «همه‌جا» + «همهٔ دارندگان» of «مدیر گروه», held by two of the pack's people: a pack person's case reaches both;
//     the owner's own case and a real member's find nobody — and say why, in the journal, in the owner's notice and on
//     the case page («waiting», «دوباره پیدا کردن انجام‌دهنده»); the pack's case is marked so (case page, inbox);
//   · the designer: the pack's people, the estimate's count of them with its warning, the preview's;
//   · the designer's default «واحد درخواست‌دهنده» on a pack person's case: nobody, the reason journaled, and the real
//     managers are not told (a pack's case's notices reach the pack's people only) — the journal says so; the managers'
//     «دوباره پیدا کردن انجام‌دهنده» with the current version's rules gives it the pack's people, as the pack's rows;
//   · a holder added later reaches a pack's case that waits, inside its demo scope — never the organisation's own case;
//   · «نزدیک‌ترین واحد بالادست» on a real case passes a unit whose holder is the pack's;
//   · the organisation's timer (escalation, «پایان مهلت») and a real member's delegation write a pack's case's rows as
//     the pack's;
//   · a pack person's start pushed from a linked Windows app is the pack's case whichever job applies it — its own
//     event job or the organisation's timer that was due first; the purge then leaves nothing of the pack's cases.
// Each suite file runs it once.
import { describe, it, expect, beforeAll } from "vitest";
import { SYNC_PROTOCOL } from "@shared/constants";
import { faDigits } from "@shared/format";
import { uuidv7 } from "@shared/id";
import type { Ctx } from "@server/context";
import { createIn, systemCtx, updateIn } from "@server/engine";
import { inDemoScope } from "@server/db/scope";
import { tick } from "@server/jobs";
import { runToEnd } from "@server/modules/demo";
import { newMemo, STEPS } from "@server/modules/demo/load";
import { applyPending } from "@server/modules/process/sync";
import { RERESOLVE_JOB } from "@server/modules/process/reresolve";
import { timerPass } from "@server/modules/process/timers";
import { Client } from "./helpers";
import { engineOrg, type EngineOrg } from "./engine-helpers";

/** The resolver's note on the pack's people left out of the organisation's own work. */
const DEMO_NOTE = (position: string, n: number) =>
  n === 1
    ? `۱ نفر از دارندگان «${position}» حساب نمایشی است و کار پرونده‌های واقعی سازمان را بر عهده نمی‌گیرد؛ برای آزمودن، پرونده را با یک حساب نمایشی آغاز کنید`
    : `${faDigits(n)} نفر از دارندگان «${position}» حساب نمایشی‌اند و کار پرونده‌های واقعی سازمان را بر عهده نمی‌گیرند؛ برای آزمودن، پرونده را با یک حساب نمایشی آغاز کنید`;
const TOLD = (label: string) => `برای «${label}» کسی پیدا نشد؛ مسئولان گردش‌کار باخبر شدند.`;
const PACK_CASE = (label: string) => `برای «${label}» کسی پیدا نشد؛ مرحله منتظر مسئولان گردش‌کار می‌ماند (پروندهٔ نمایشی است و اعلانی برای مسئولان واقعی فرستاده نمی‌شود).`;

export function ownerPathScenario(label: string): void {
  describe(label, () => {
    let e: EngineOrg;
    let sys: Ctx;
    let P = "";
    let password = "";
    const accounts: Record<string, string> = {};
    let FORM = "";
    const U: Record<string, string> = {};
    const N: Record<string, string> = {};
    const who: Record<string, string> = {};
    const C: Record<string, { client: Client; userId: string }> = {};
    const POS: Record<string, string> = {};
    const kept: string[] = []; // the organisation's own cases, which the purge leaves
    let OWNER_WF: { id: string; key: string } = { id: "", key: "" };
    let ownStuck = "";

    const drain = async (rounds = 80) => {
      for (let i = 0; i < rounds; i++) {
        const r = await tick(e.cfg, { budgetMs: 30_000 });
        if (!r.ran && !r.more && !r.failed) break;
      }
    };
    const fresh = () => e.db.query(`update sm_sessions set reauth_at = now() where user_id = $1`, [e.ownerId]);
    const layout = () => ({
      tabs: [
        {
          label: "جزئیات",
          sections: [
            { label: null, items: [{ field: "u_project_name", required: true }, { field: "u_due" }] },
            { label: "بخش تازه", columns: 2, items: [{ field: "u_pm_name" }, { field: "u_owner" }, { field: "u_team" }] },
          ],
        },
        { label: "تاخیرات", sections: [{ label: null, items: [{ field: "u_delay_days" }] }] },
      ],
    });
    /** «ثبت درخواست» → «مرحلهٔ فرم» (the step's people) → end; `late`: «پایان مهلت» to an end of its own. */
    const draft = (step: Record<string, unknown>, late = false) => ({
      graph: {
        nodes: [
          { id: "start", type: "trigger", config: {} },
          { id: "request", type: "form_step", config: { action: "fill", start: true, form: FORM, rights: { default: "edit", fields: {} }, assignees: [{ kind: "requester" }] }, label: "ثبت درخواست" },
          { id: "form2", type: "form_step", config: { action: "fill", form: FORM, rights: { default: "edit", fields: { u_project_name: "read" } }, ...step }, label: "مرحلهٔ فرم" },
          { id: "end", type: "end", config: { outcome: "completed" }, label: "پایان (انجام‌شده)" },
          ...(late ? [{ id: "late", type: "end", config: { outcome: "rejected" }, label: "پایان (دیرکرد)" }] : []),
        ],
        edges: [
          { id: "start.out.request", source: "start", target: "request" },
          { id: "request.out.form2", source: "request", target: "form2" },
          { id: "form2.out.end", source: "form2", target: "end" },
          ...(late ? [{ id: "form2.timeout.late", source: "form2", target: "late", port: "timeout" }] : []),
        ],
      },
      starters: [],
      title_template: null,
      requester_view: [],
      managers: [e.ownerId],
      manager_groups: [],
      confidential: true,
    });
    let seq = 0;
    async function publish(id: string, step: Record<string, unknown>, late = false) {
      const saved = await e.owner.put(`${P}/process/defs/${id}/draft`, { draft: draft(step, late) });
      const errors = saved.problems.filter((p: { level: string }) => p.level === "error");
      if (errors.length) throw new Error(`draft problems: ${JSON.stringify(errors)}`);
      await fresh();
      await e.owner.post(`${P}/process/defs/${id}/publish`, { note: "انتشار" });
    }
    async function workflow(name: string, step: Record<string, unknown>, late = false) {
      const key = `wf_${++seq}_${String(Date.now()).slice(-5)}`;
      const id = (await e.owner.post(`${P}/process/defs`, { name, key }, 201)).process.id as string;
      await publish(id, step, late);
      return { id, key };
    }
    const anywhere = (key: string) => ({ assignees: [{ kind: "position", position: key, where: "anywhere" }] });
    const values = { u_project_name: "پروژهٔ آزمایشی", u_pm_name: "مدیر نمونه", u_delay_days: 3 };

    const isDemo = async (id: string) => !!(await e.db.one(`select 1 as x from sm_demo_rows where org_id = $1 and row_id = $2`, [e.org, id]));
    const people = async (caseId: string) =>
      (await e.db.query<{ assigned_to: string }>(`select assigned_to::text from sm_process_tasks where case_id = $1 and step_key = 'form2' and status = 'open'`, [caseId])).map((t) => N[t.assigned_to] ?? t.assigned_to).sort();
    const journal = async (caseId: string) => (await e.db.query<{ body: string }>(`select body from sm_journal where table_key = 'process_case' and record_id = $1 order by created_at, id`, [caseId])).map((j) => j.body);
    const bells = async (user: string, caseId: string) =>
      e.db.query<{ title: string; body: string }>(`select title, body from sm_notifications where org_id = $1 and user_id = $2 and record_id = $3 order by created_at`, [e.org, user, caseId]);
    /** Rows of a case's tasks and journal that are not the pack's. */
    const notPack = async (caseId: string) =>
      (
        await e.db.query<{ n: number }>(
          `select (select count(*) from sm_process_tasks t where t.case_id = $2 and not exists (select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id = t.id))
                + (select count(*) from sm_journal j where j.table_key = 'process_case' and j.record_id = $2 and not exists (select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id = j.id)) as n`,
          [e.org, caseId],
        )
      )[0].n;
    async function startAs(starter: string, key: string): Promise<string> {
      const client = starter === "owner" ? e.owner : C[starter].client;
      const r = await client.post(`${P}/process/start`, { process: key, values }, 201);
      await drain();
      return r.case as string;
    }

    beforeAll(async () => {
      e = await engineOrg();
      sys = await systemCtx(e.cfg, e.org);
      P = `/o/${e.org}`;
      // the modules' seeds first (the bank's roles, the workflows' notices), brought forward as the pack's load does
      for (let i = 0; i < 40; i++) {
        await e.db.query(`update sm_jobs set run_at = now() where org_id = $1 and status in ('queued', 'running') and (kind like '%seed%' or kind like '%install%')`, [e.org]);
        const r = await tick(e.cfg, { budgetMs: 60_000 });
        if (!r.ran && !r.more) break;
      }
      // the pack's org, groups and people, inside its demo scope; the pack's row as a finished load leaves it
      const memo = newMemo("small");
      for (const key of ["org", "groups", "people"]) {
        const s = STEPS.find((x) => x.key === key)!;
        for (let i = 0; i < 50 && !(await inDemoScope(e.org, () => s.run({ cfg: e.cfg, orgId: e.org, memo, deadline: Date.now() + 600_000 }, sys))); i++);
      }
      await e.db.query(
        `insert into sm_demo_packs (org_id, state, size, progress, counters, started_by, loaded_at)
         values ($1, 'loaded', 'small', jsonb_build_object('memo', $2::jsonb, 'seeds_done', true, 'saved', true, 'saved_at', now(), 'computed', '[]'::jsonb), '{}'::jsonb, $3, now())`,
        [e.org, JSON.stringify(memo), e.ownerId],
      );
      await fresh();
      const st = await e.owner.post(`${P}/demo/signin`, { on: true });
      password = st.password;
      for (const a of st.accounts ?? []) accounts[a.persona] = a.email;
      // the owner's fields and form
      for (const [name, label, type] of [
        ["u_project_name", "نام پروژه", "string"], ["u_pm_name", "نام مدیر پروژه", "string"], ["u_delay_days", "تعداد روز تاخیر", "int"],
        ["u_due", "تاریخ تحویل", "date"], ["u_owner", "مسئول پروژه", "user"], ["u_team", "اعضای تیم", "users"],
      ]) await e.owner.post(`${P}/fields/library`, { name, label, type }, 201);
      FORM = (await e.owner.post(`${P}/forms`, { name: "فرم پروژه", layout: layout() }, 201)).form.id;
      // units of the pack's bank, and people: the pack's (two personas who sign in, a generated one) and real members
      const units = await e.db.query<{ id: string; name: string; parent_id: string }>(`select id::text, name, parent_id::text from sm_org_units where org_id = $1 and name like 'امور شعب استان %' order by name limit 2`, [e.org]);
      U.u0 = units[0].id;
      U.u1 = units[1].id;
      U.parent0 = units[0].parent_id;
      U.branch0 = (await e.db.one<{ id: string }>(`select id::text from sm_org_units where org_id = $1 and parent_id = $2 order by name limit 1`, [e.org, U.u0]))!.id;
      for (const u of await e.db.query<{ id: string; name: string }>(`select id::text, name from sm_org_units where id = any($1::uuid[])`, [`{${Object.values(U).join(",")}}`])) N[u.id] = u.name;
      const id = async (email: string) => (await e.db.one<{ id: string }>(`select id::text from sm_users where email = $1`, [email]))!.id;
      who.agent = await id(accounts.agent);
      who.req = await id(accounts.requester);
      who.babak = (await e.db.one<{ id: string }>(`select id::text from sm_users where prefs ->> 'demo_org' = $1 and password_hash is null order by email limit 1`, [e.org]))!.id;
      for (const [k, persona] of [["agent", "agent"], ["req", "requester"]]) {
        const client = new Client(e.app);
        await client.post("/auth/login", { email: accounts[persona], password });
        C[k] = { client, userId: who[k] };
      }
      for (const k of ["realA", "realC"]) {
        C[k] = await e.member("member", `${k.toLowerCase()}-${Date.now()}@example.com`);
        who[k] = C[k].userId;
      }
      who.owner = e.ownerId;
      for (const [k, v] of Object.entries(who)) N[v] = k;
      const setUnit = async (user: string, unit: string) => {
        const prof = await e.db.one<{ id: string }>(`select id from sm_member_profiles where org_id = $1 and user_id = $2 and deleted_at is null`, [e.org, user]);
        await sys.write((tx) => (prof ? updateIn(tx, sys, "member_profile", prof.id, { org_unit_id: unit }, { trusted: true }) : createIn(tx, sys, "member_profile", { user_id: user, org_unit_id: unit, roles: [], persona: "requester" }, { trusted: true })));
      };
      await setUnit(who.realA, U.u0);
      await setUnit(who.realC, U.branch0);
      // the owner's positions and holders, through the routes «نقش‌های سازمانی» calls
      const position = async (k: string, name: string, key: string) => (POS[k] = (await e.owner.post(`${P}/r/position`, { name, key, active: true })).row.id);
      const holder = (pos: string, user: string, unit: string) => e.owner.post(`${P}/r/position_holder`, { position_id: POS[pos], user_id: user, org_unit_id: unit, kind: "primary" });
      await position("head", "مدیر گروه", "group_head");
      await holder("head", who.babak, U.u0);
      await holder("head", who.agent, U.u1);
      await position("mixed", "مدیر ترکیبی", "mixed_head");
      await holder("mixed", who.babak, U.u0);
      await holder("mixed", who.realA, U.u1);
      await position("chain", "مدیر زنجیره", "chain_head");
      await holder("chain", who.babak, U.u0);
      await holder("chain", who.realA, U.parent0);
      await position("later", "مدیر آینده", "later_head");
      await drain();
    }, 1_800_000);

    it("the owner's exact workflow: a pack person's case reaches the pack's holders; the owner's and a member's say why they found nobody", async () => {
      OWNER_WF = await workflow("گردش کار پروژه", anywhere("group_head"));
      const pack = await startAs("agent", OWNER_WF.key);
      const packOther = await startAs("req", OWNER_WF.key);
      const own = await startAs("owner", OWNER_WF.key);
      const member = await startAs("realC", OWNER_WF.key);
      kept.push(own, member);
      ownStuck = own;
      expect([await people(pack), await isDemo(pack)]).toEqual([["agent", "babak"], true]);
      expect(await people(packOther)).toEqual(["agent", "babak"]);
      expect([await people(own), await isDemo(own)]).toEqual([[], false]);
      expect(await people(member)).toEqual([]);
      const why = DEMO_NOTE("مدیر گروه", 2);
      for (const c of [own, member]) expect(await journal(c)).toContain(`${TOLD("مرحلهٔ فرم")} ${why}.`);
      // the owner (the cases' manager) is told, with the reason
      const told = await bells(e.ownerId, own);
      expect(told.map((b) => b.title)).toEqual(["برای «مرحلهٔ فرم» کسی پیدا نشد"]);
      expect(told[0].body).toContain(`(${why})`);
      // the owner's case page: why, and «دوباره پیدا کردن انجام‌دهنده»
      const view = await e.owner.get(`${P}/process/cases/${own}`);
      expect(view.waiting).toEqual({ form2: { reason: "nobody", message: TOLD("مرحلهٔ فرم"), notes: [why] } });
      expect([view.can.reresolve, view.demo]).toEqual([true, false]);
      // the pack's case is marked so, and nothing waits there
      const packView = await e.owner.get(`${P}/process/cases/${pack}`);
      expect([packView.demo, packView.waiting, packView.can.reresolve]).toEqual([true, {}, false]);
      // the member reads their own case's line, not the reasons
      expect((await C.realC.client.get(`${P}/process/cases/${member}`)).waiting).toEqual({ form2: { reason: "nobody", message: TOLD("مرحلهٔ فرم"), notes: [] } });
      // the pack person's inbox marks the pack's case
      const inbox = await C.agent.client.get(`${P}/process/inbox`);
      expect(inbox.rows.find((r: { case_id: string }) => r.case_id === pack)?.demo).toBe(true);
      expect((await C.agent.client.get(`${P}/process/mine`)).processes.find((p: { key: string }) => p.key === OWNER_WF.key)?.can_start).toBe(true);
      // «دوباره پیدا کردن انجام‌دهنده» on the owner's case finds nobody still, and says why
      const again = await e.owner.post(`${P}/process/cases/${own}/reresolve`, { step: "form2" });
      expect(again).toEqual({ status: "nobody", people: [], message: TOLD("مرحلهٔ فرم"), notes: [why] });
    });

    it("the designer: the pack's people, the estimate's count of them and its warning, the preview", async () => {
      const dp = await e.owner.get(`${P}/positions/demo-people`);
      expect(dp.users).toEqual(expect.arrayContaining([who.agent, who.req, who.babak]));
      expect(dp.users).not.toContain(who.realA);
      const all = await e.owner.post(`${P}/positions/estimate`, { step: anywhere("group_head"), action: "fill" });
      expect([all.demo, all.rules[0].demo]).toEqual([2, 2]);
      expect(all.warnings).toContain("همهٔ این افراد حساب نمایشی‌اند؛ فقط پرونده‌هایی که حساب‌های نمایشی آغاز کنند به آن‌ها می‌رسد و پرونده‌های واقعی سازمان به کسی نمی‌رسد");
      const mixed = await e.owner.post(`${P}/positions/estimate`, { step: anywhere("mixed_head"), action: "fill" });
      expect(mixed.demo).toBe(1);
      expect(mixed.warnings).toContain("۱ نفر از این افراد حساب نمایشی‌اند؛ فقط پرونده‌هایی که حساب‌های نمایشی آغاز کنند به آن‌ها می‌رسد");
      const preview = (requester: string, step = anywhere("group_head")) => e.owner.post(`${P}/positions/resolve`, { step, action: "fill", label: "مرحلهٔ فرم", requester });
      const asOwner = await preview(e.ownerId);
      expect([asOwner.status, asOwner.notes]).toEqual(["nobody", [DEMO_NOTE("مدیر گروه", 2)]]);
      const asPack = await preview(who.agent);
      expect(asPack.people.map((p: { user: string }) => N[p.user]).sort()).toEqual(["agent", "babak"]);
      expect(asPack.display.demo).toEqual([who.agent, who.babak].sort());
      const asMixed = await preview(e.ownerId, anywhere("mixed_head"));
      // the pack's people are noted even when the rule keeps someone (the designer counts them)
      expect([asMixed.people.map((p: { user: string }) => N[p.user]), asMixed.display.demo, asMixed.notes]).toEqual([["realA"], [], [DEMO_NOTE("مدیر ترکیبی", 1)]]);
    });

    it("the designer's default «واحد درخواست‌دهنده» on a pack person's case: the reason journaled, the real managers not told; the current version's rules then give it the pack's people", async () => {
      const wf = await workflow("گردش کار پیش‌فرض", { assignees: [{ kind: "position", position: "group_head", where: "requester_unit" }] });
      const pack = await startAs("agent", wf.key);
      expect([await people(pack), await isDemo(pack)]).toEqual([[], true]);
      const view = await e.owner.get(`${P}/process/cases/${pack}`);
      const waiting = view.waiting.form2;
      expect(waiting.message).toBe(PACK_CASE("مرحلهٔ فرم"));
      expect(waiting.notes).toHaveLength(1);
      expect(await journal(pack)).toContain(`${waiting.message} ${waiting.notes[0]}.`);
      expect(await bells(e.ownerId, pack)).toEqual([]);
      // version 2: «همه‌جا»; the managers run the current version's rules on the pack's case
      await publish(wf.id, anywhere("group_head"));
      const r = await e.owner.post(`${P}/process/cases/${pack}/reresolve`, { step: "form2", rules: "current" });
      expect(r.status).toBe("ok");
      expect(r.people.map((p: { id: string; demo: boolean }) => [N[p.id], p.demo]).sort()).toEqual([["agent", true], ["babak", true]]);
      expect(await people(pack)).toEqual(["agent", "babak"]);
      expect((await e.db.one<{ version_no: number }>(`select version_no from sm_process_cases where id = $1`, [pack]))!.version_no).toBe(1);
      // what it wrote is the pack's
      expect(await notPack(pack)).toBe(0);
    });

    it("a holder added later reaches a pack's case that waits, as the pack's work; the organisation's own case still not", async () => {
      const wf = await workflow("گردش کار آینده", anywhere("later_head"));
      const pack = await startAs("agent", wf.key);
      const own = await startAs("owner", wf.key);
      kept.push(own);
      expect([await people(pack), await people(own)]).toEqual([[], []]);
      await e.owner.post(`${P}/r/position_holder`, { position_id: POS.later, user_id: who.babak, org_unit_id: U.u0, kind: "primary" });
      await drain();
      await e.db.query(`update sm_jobs set run_at = now() where org_id = $1 and kind = $2 and status = 'queued'`, [e.org, RERESOLVE_JOB]);
      await drain();
      expect(await people(pack)).toEqual(["babak"]);
      const last = (await journal(pack)).at(-1) ?? "";
      expect(last.startsWith("با تغییر دارندگان نقش‌ها، گروه‌ها یا نقش‌های دسترسی، انجام‌دهندهٔ «مرحلهٔ فرم» دوباره جسته شد؛ مرحله به ")).toBe(true);
      expect(last.endsWith(" سپرده شد.")).toBe(true);
      expect(await notPack(pack)).toBe(0);
      expect(await people(own)).toEqual([]);
    });

    it("«نزدیک‌ترین واحد بالادست» on a real case passes a unit whose holder is the pack's", async () => {
      const step = { assignees: [{ kind: "position", position: "chain_head", where: "requester_unit_up" }] };
      const wf = await workflow("گردش کار زنجیره", step);
      const member = await startAs("realC", wf.key);
      kept.push(member);
      expect(await people(member)).toEqual(["realA"]);
      const pv = await e.owner.post(`${P}/positions/resolve`, { step, action: "fill", label: "مرحلهٔ فرم", requester: who.realC });
      expect(pv.notes).toEqual([`«مدیر زنجیره» در «${N[U.u0]}» حساب نمایشی است و کار پرونده‌های واقعی سازمان را بر عهده نمی‌گیرد؛ مرحله به «${N[U.parent0]}» رسید`]);
    });

    it("the organisation's timer writes a pack's case's escalation and «پایان مهلت» as the pack's rows", async () => {
      const wf = await workflow(
        "گردش کار مهلت‌دار",
        { ...anywhere("group_head"), due: { amount: 2, unit: "hour" }, business: false, escalate: [{ after: { amount: 1, unit: "hour" }, action: "notify", to: "managers" }] },
        true,
      );
      const pack = await startAs("agent", wf.key);
      expect(await people(pack)).toEqual(["agent", "babak"]);
      await e.db.query(`update sm_process_tasks set opened_at = now() - interval '3 hours', due_at = now() - interval '1 hour' where case_id = $1 and step_key = 'form2'`, [pack]);
      // the organisation's own job (never demo work), as `process.timer` runs it
      await timerPass(e.cfg, e.org, (id) => applyPending(e.cfg, e.org, id, null));
      await drain();
      const j = await journal(pack);
      // the managers (real people) hear nothing of the pack's case: the journal does not say they were told
      expect(j).toContain("مهلت «مرحلهٔ فرم» گذشت؛ پروندهٔ نمایشی است و اعلانی برای کسانی که باید باخبر شوند فرستاده نشد");
      expect(j).toContain("مهلت «مرحلهٔ فرم» به پایان رسید؛ پرونده از مسیر «پایان مهلت» ادامه یافت");
      expect((await e.db.one<{ state: string }>(`select state from sm_process_cases where id = $1`, [pack]))!.state).toBe("rejected");
      expect(await notPack(pack)).toBe(0);
    });

    it("a real member's delegation moves their task in a pack's case as the pack's work", async () => {
      // the organisation's own holder gets the pack's cases (only the reverse is refused)
      const wf = await workflow("گردش کار ترکیبی", anywhere("mixed_head"));
      const pack = await startAs("agent", wf.key);
      expect(await people(pack)).toEqual(["babak", "realA"]);
      // realA hands their work to realC: the organisation's own delegation, its job outside any demo scope
      await sys.write((tx) =>
        createIn(tx, sys, "delegation", { from_user: who.realA, to_user: who.realC, starts_at: new Date(Date.now() - 60_000).toISOString(), scopes: ["assignments"], active: true }, { trusted: true }),
      );
      await drain();
      expect(await people(pack)).toEqual(["babak", "realC"]);
      expect((await journal(pack)).some((b) => b.includes("به جانشینی از"))).toBe(true);
      expect(await notPack(pack)).toBe(0);
    });

    describe("a pack person's start pushed from a linked Windows app", () => {
      let app: Client;
      const pushed: string[] = [];
      const push = async (caseId: string) => {
        const now = new Date().toISOString();
        const row = {
          id: uuidv7(), org_id: e.org, kind: "start", process_id: OWNER_WF.id, case_id: caseId, values: { u_project_name: "از برنامهٔ ویندوز" },
          submitted_by: who.agent, submitted_at: now, result: "pending", created_at: now, updated_at: now,
        };
        await app.post(`/sync/push`, { org_id: e.org, device_id: uuidv7(), protocol: SYNC_PROTOCOL, aggregates: [{ entity: "process_submission", id: row.id, base_rev: 0, row }] });
        pushed.push(caseId);
        return row.id;
      };

      beforeAll(async () => {
        // the pack person's Windows app signs in as the sync client does (a bearer token for a device)
        app = new Client(e.app);
        const login = await app.post(`/auth/login`, { email: accounts.agent, password, device: { name: "کاریز ویندوز — آزمون", platform: "windows" } });
        app.token = login.token;
        app.cookie = "";
      }, 120_000);

      it("applied by its own event job: the pack's case", async () => {
        const caseId = uuidv7();
        const sub = await push(caseId);
        await drain();
        expect([await isDemo(sub), await isDemo(caseId), await people(caseId)]).toEqual([true, true, ["agent", "babak"]]);
      });

      it("applied by the organisation's timer that ran first: the pack's case all the same", async () => {
        const caseId = uuidv7();
        const sub = await push(caseId);
        // before the submission's own event job: the timer's re-check of pending submissions applies it
        await timerPass(e.cfg, e.org, (id) => applyPending(e.cfg, e.org, id, null));
        expect((await e.db.one<{ result: string }>(`select result from sm_process_submissions where id = $1`, [sub]))!.result).toBe("applied");
        await drain();
        expect([await isDemo(caseId), await people(caseId)]).toEqual([true, ["agent", "babak"]]);
        expect(await notPack(caseId)).toBe(0);
      });

      it("the purge leaves nothing of the pack's cases, and the organisation's own cases stay", async () => {
        const pack = await e.db.query<{ id: string }>(`select c.id::text from sm_process_cases c join sm_demo_rows d on d.org_id = c.org_id and d.row_id = c.id where c.org_id = $1`, [e.org]);
        expect(pack.map((c) => c.id)).toEqual(expect.arrayContaining(pushed));
        await fresh();
        await e.owner.post(`${P}/demo/purge`, { confirm: "حذف کامل" });
        await runToEnd(e.cfg, e.org, "purge", { budgetMs: 900_000 });
        const left = (await e.db.query<{ id: string }>(`select id::text from sm_process_cases where org_id = $1`, [e.org])).map((c) => c.id);
        expect(left.filter((id) => pack.some((c) => c.id === id))).toEqual([]);
        expect(left).toEqual(expect.arrayContaining(kept));
        const orphans = await e.db.one<{ tasks: number; journal: number; waits: number; submissions: number }>(
          `select (select count(*)::int from sm_process_tasks t where t.org_id = $1 and not exists (select 1 from sm_process_cases c where c.id = t.case_id)) as tasks,
                  (select count(*)::int from sm_journal j where j.org_id = $1 and j.table_key = 'process_case' and not exists (select 1 from sm_process_cases c where c.id = j.record_id)) as journal,
                  (select count(*)::int from sm_flow_waits w where w.org_id = $1 and w.key like 'pstep:%' and not exists (select 1 from sm_process_cases c where w.key like 'pstep:' || c.id::text || ':%')) as waits,
                  (select count(*)::int from sm_process_submissions s where s.org_id = $1 and s.case_id is not null and not exists (select 1 from sm_process_cases c where c.id::text = s.case_id)) as submissions`,
          [e.org],
        );
        expect(orphans).toEqual({ tasks: 0, journal: 0, waits: 0, submissions: 0 });
        // the owner's own stuck case still waits, with its reason
        expect((await e.owner.get(`${P}/process/cases/${ownStuck}`)).waiting.form2.reason).toBe("nobody");
      });
    });
  });
}
