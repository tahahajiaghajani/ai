// The bank's own workflows in the demo pack (src/server/modules/demo/workflows.ts, ./workflow-samples.ts; docs/DEMO_FA.md
// «گردش‌کارهای نمونه»): library fields of every useful type, tabbed forms with sections and «نمایش وقتی…», organisational
// roles held by the pack's people across branches and departments (one acting, one ending soon, one vacant), six
// workflows published by the publish service — the owner's two-form-step case, conditions and choices, parallel
// reviews with their join, approvals with quorums, a review returned for correction, a deadline with «پایان مهلت» and
// its escalation, values set and notices sent, a position by the nearest branch up — and sample cases in every state,
// played through the workflows' services as the pack's people while the job queue runs their steps between the load's
// invocations. Every row is the pack's; a re-run makes no second copy; a real field, form, position or process of the
// same name or key is refused part by part, with what needs it; a regular member starts none of them; and over HTTP a
// pack persona finds a step in «کارتابل» and sends it, another approves, and the project's manager gives the case
// waiting on version 1 to the holders with «دوباره پیدا کردن انجام‌دهنده».
import { describe, it, expect, beforeAll } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { Client, signupWithOrg } from "./helpers";
import { systemCtx } from "@server/engine";
import { tick } from "@server/jobs";
import { inDemoScope } from "@server/db/scope";
import { inbox, myProcesses } from "@server/modules/process/api";
import { DEMO_PROCESS_START } from "@server/modules/process/engine";
import { checkDraft, cleanDraft, draftRules } from "@server/modules/process/publish";
import { setDemoSignIn } from "@server/modules/demo/signin";
import { demoStatus } from "@server/modules/demo";
import { loadRefusals, newMemo, STEPS, type LoadMemo } from "@server/modules/demo/load";
import { formFields, WF_FIELDS, WF_FORMS, WF_POSITIONS, WF_PROCESSES, wfScripts, type WfScript } from "@server/modules/demo/workflow-samples";
import { refsOf } from "@server/modules/demo/workflows";
import { builtinFieldType } from "@shared/forms/fieldtypes";
import { isIban } from "@shared/validate";
import { uuidv7 } from "@shared/id";
import { demoTag } from "@server/modules/demo/bank";
import type { Ctx } from "@server/context";

let e: EngineOrg;
let sys: Ctx;
let memo: LoadMemo;
let scripts: WfScript[];
const P = () => `/o/${e.org}`;
const F = Object.fromEntries(Object.entries(WF_FIELDS).map(([k, f]) => [k, f.name])) as Record<keyof typeof WF_FIELDS, string>;

async function drain(rounds = 60) {
  for (let i = 0; i < rounds; i++) {
    const r = await tick(e.cfg, { budgetMs: 30_000 });
    if (!r.ran && !r.more) break;
  }
}

/** Run one step of the pack inside its demo scope as the job `demo.load` does, the job queue running between its invocations. */
async function step(key: string, m: LoadMemo = memo, org = e.org, s0: Ctx = sys): Promise<number> {
  const s = STEPS.find((x) => x.key === key)!;
  for (let i = 1; i <= 200; i++) {
    const done = await inDemoScope(org, () => s.run({ cfg: e.cfg, orgId: org, memo: m, deadline: Date.now() + 600_000 }, s0));
    if (done) {
      m.cursor = 0;
      return i;
    }
    await drain();
  }
  throw new Error(`step ${key} never ended`);
}

async function seeds(org: string) {
  for (let i = 0; i < 30; i++) {
    await e.db.query(`update sm_jobs set run_at = now() where org_id = $1 and status in ('queued', 'running') and (kind like '%seed%' or kind like '%install%')`, [org]);
    const r = await tick(e.cfg, { budgetMs: 60_000 });
    if (!r.ran && !r.more) break;
  }
}

const caseOf = (key: string) => memo.wf!.cases!.rows[key].id;
const kase = (id: string) => e.db.one<{ state: string; outcome: string | null; version_no: number; data: Record<string, unknown>; title: string; requested_by: string }>(`select * from sm_process_cases where id = $1`, [id]);
const tasks = (id: string) =>
  e.db.query<{ id: string; step_key: string; round: number; assigned_to: string; status: string; acted_by: string | null; outcome: string | null }>(`select * from sm_process_tasks where case_id = $1 order by opened_at, round, id`, [id]);
const journal = async (id: string) => (await e.db.query<{ body: string }>(`select body from sm_journal where table_key = 'process_case' and record_id = $1 order by created_at, id`, [id])).map((j) => j.body);
const who = (persona: keyof LoadMemo["people"]["personas"]) => memo.people.personas[persona]!;
const asPersona = <T,>(id: string, fn: (ctx: Ctx) => Promise<T>) => inDemoScope(e.org, async () => fn(await e.ctxOf(id)));

beforeAll(async () => {
  e = await engineOrg();
  sys = await systemCtx(e.cfg, e.org);
  // the modules' seeds first (the bank's roles, the workflows' notices among them), brought forward as the pack's load does
  await seeds(e.org);
  memo = newMemo("small");
  for (const key of ["org", "groups", "people", "branch_staff", "workflows", "workflow_defs", "workflow_cases"]) await step(key);
  await drain();
  scripts = wfScripts({ ...refsOf(memo), today: "2026-01-01", now: 0 }, "small", memo.seed);
}, 1_800_000);

describe("the demo pack's own workflows", () => {
  it("fields of every useful type, tabbed forms with sections and «نمایش وقتی…», roles held across the bank, six published workflows", async () => {
    expect(loadRefusals(e.org)).toEqual({});
    // fields: at least 14, of every useful type (text and the bank's numbers, numbers, money, dates, choices, a check box and
    // a switch, people, groups, units, roles, files)
    const fields = await e.db.query<{ name: string; type: string; status: string }>(`select name, type, status from sm_field_defs where org_id = $1 and name = any($2::text[])`, [e.org, `{${Object.values(F).join(",")}}`]);
    expect(fields.length).toBe(Object.keys(WF_FIELDS).length);
    expect(fields.length).toBeGreaterThanOrEqual(14);
    const types = new Set(fields.map((f) => f.type));
    for (const t of [
      "string", "text", "email", "url", "phone", "ip", "mobile", "iban", "national_id", "int", "decimal", "percent", "rating", "duration", "money",
      "date", "datetime", "select", "radio", "multiselect", "checklist", "tags", "checkbox", "switch", "user", "users", "group", "unit", "position", "attachment",
    ]) expect(types, t).toContain(t);
    for (const f of fields) expect(builtinFieldType(f.type), f.type).toBeTruthy();
    // forms: at least 3, each with at least two tabs, sections (some in two columns), notes and «نمایش وقتی…»
    const forms = await e.db.query<{ name: string; status: string; layout: { tabs: { label: string; sections: { columns?: number; items: Record<string, unknown>[] }[] }[] } }>(
      `select name, status, layout from sm_forms where org_id = $1 and name = any($2::text[])`, [e.org, `{${WF_FORMS.map((f) => `"${f.name}"`).join(",")}}`]);
    expect(forms.length).toBe(WF_FORMS.length);
    expect(forms.length).toBeGreaterThanOrEqual(3);
    for (const f of forms) {
      expect(f.status, f.name).toBe("published");
      expect(f.layout.tabs.length, f.name).toBeGreaterThanOrEqual(2);
    }
    const items = forms.flatMap((f) => f.layout.tabs.flatMap((t) => t.sections.flatMap((s) => s.items)));
    expect(forms.filter((f) => f.layout.tabs.some((t) => t.sections.some((s) => s.items.some((i) => i.showIf)))).length).toBeGreaterThanOrEqual(3);
    expect(items.some((i) => typeof i.text === "string")).toBe(true);
    expect(forms.some((f) => f.layout.tabs.some((t) => t.sections.some((s) => s.columns === 2)))).toBe(true);
    // positions: at least 5, in units of their kind, held by the pack's people across branches and departments
    const positions = await e.db.query<{ id: string; key: string; name: string; unit_kind: string | null; reports_to: string | null }>(`select id, key, name, unit_kind, reports_to from sm_positions where org_id = $1 and key like 'aftab\\_%' order by key`, [e.org]);
    expect(positions.map((p) => p.key).sort()).toEqual(WF_POSITIONS.map((p) => p.key).sort());
    expect(positions.every((p) => p.name.endsWith("(نمونه)"))).toBe(true);
    expect(positions.find((p) => p.key === "aftab_branch_head")!.reports_to).toBe(positions.find((p) => p.key === "aftab_region_head")!.id);
    const holders = await e.db.query<{ key: string; user_id: string; kind: string; valid_to: string | null; unit_kind: string | null; demo_user: boolean }>(
      `select p.key, h.user_id, h.kind, h.valid_to::text as valid_to, u.kind as unit_kind, (us.prefs ->> 'demo_org') = $2 as demo_user
         from sm_position_holders h join sm_positions p on p.id = h.position_id left join sm_org_units u on u.id = h.org_unit_id join sm_users us on us.id = h.user_id
        where h.org_id = $1 and h.deleted_at is null`, [e.org, e.org]);
    expect(holders.length).toBeGreaterThanOrEqual(8);
    expect(holders.every((h) => h.demo_user)).toBe(true);
    expect(new Set(holders.map((h) => h.unit_kind))).toEqual(new Set(["branch", "department", "division"]));
    for (const h of holders) {
      const kind = positions.find((p) => p.key === h.key)!.unit_kind;
      if (kind) expect(h.unit_kind, h.key).toBe(kind);
    }
    expect(holders.filter((h) => h.key === "aftab_inspector")).toEqual([]);
    expect(holders.some((h) => h.kind === "acting")).toBe(true);
    const ending = holders.filter((h) => h.valid_to);
    expect(ending.length).toBe(1);
    expect(Date.parse(ending[0].valid_to!) - Date.now()).toBeLessThan(11 * 86_400_000);
    expect(new Set(holders.filter((h) => h.key === "aftab_branch_head").map((h) => h.user_id)).size).toBeGreaterThan(2);
    // workflows: six, published by the publish service with no problem, naming only the pack's people, groups and roles
    const procs = await e.db.query<{ id: string; key: string; name: string; status: string; version_no: number; draft: unknown; current_version_id: string }>(
      `select id, key, name, status, version_no, draft, current_version_id from sm_processes where org_id = $1 and key = any($2::text[])`, [e.org, `{${WF_PROCESSES.map((p) => p.key).join(",")}}`]);
    expect(procs.length).toBe(WF_PROCESSES.length);
    expect(procs.length).toBeGreaterThanOrEqual(6);
    const people = new Set((await e.db.query<{ id: string }>(`select id::text as id from sm_users where prefs ->> 'demo_org' = $1`, [e.org])).map((r) => r.id));
    const groups = new Set(Object.values(memo.groups));
    for (const p of procs) {
      expect(p.status, p.key).toBe("published");
      expect(p.version_no, p.key).toBe(p.key === "aftab_project" ? 2 : 1);
      expect(p.name.endsWith("(نمونه)")).toBe(true);
      const draft = cleanDraft(p.draft);
      expect((await checkDraft(sys, draft)).problems.filter((x) => x.level === "error"), p.key).toEqual([]);
      expect(draft.managers.length, p.key).toBeGreaterThan(0);
      for (const m of draft.managers) expect(people.has(m), `${p.key} manager`).toBe(true);
      for (const g of draft.manager_groups) expect(groups.has(g), `${p.key} manager group`).toBe(true);
      for (const r of draftRules(draft)) {
        expect(r.kind, `${p.key}: no access role and no real group`).not.toBe("role");
        if (r.kind === "users") for (const u of r.users) expect(people.has(u), `${p.key} person`).toBe(true);
        if (r.kind === "group") expect(groups.has(r.group), `${p.key} group`).toBe(true);
        if (r.kind === "position") expect(r.position.startsWith("aftab_"), `${p.key} position`).toBe(true);
      }
    }
    // what they show, together: a two-form-step case, conditions and choices, parallel with join, approvals and
    // quorums, a review with «بازگشت», a deadline with «پایان مهلت» and its escalation, values set, notices, the nearest
    // branch up
    const nodes = procs.flatMap((p) => cleanDraft(p.draft).graph.nodes);
    for (const t of ["branch", "choice", "parallel", "join", "set_values", "notify"]) expect(nodes.some((x) => x.type === t), t).toBe(true);
    const steps = nodes.filter((x) => x.type === "form_step").map((x) => x.config as Record<string, any>);
    for (const q of ["any", "count", "first"]) expect(steps.some((s) => s.action === "approve" && s.quorum === q), q).toBe(true);
    expect(steps.some((s) => s.action === "review")).toBe(true);
    expect(steps.some((s) => s.due && s.escalate?.length)).toBe(true);
    expect(steps.some((s) => s.assignees?.some((r: any) => r.kind === "position" && r.where === "requester_unit_up"))).toBe(true);
    expect(steps.some((s) => s.assignees?.some((r: any) => r.kind === "position" && r.where === "unit_field"))).toBe(true);
    for (const kind of ["manager", "unit_head", "field", "group", "users"]) expect(steps.some((s) => s.assignees?.some((r: any) => r.kind === kind)), kind).toBe(true);
    const project = procs.find((p) => p.key === "aftab_project")!;
    const projectForm = WF_FORMS.find((f) => f.key === "project")!;
    const projectNodes = cleanDraft(project.draft).graph.nodes.filter((x) => x.type === "form_step");
    expect(projectNodes.map((x) => (x.config as { form: string }).form)).toEqual([memo.wf!.forms!.project, memo.wf!.forms!.project]);
    expect(formFields(projectForm)).toContain(F.prjDelay);
    expect(cleanDraft(project.draft).graph.edges.some((x) => x.port === "timeout")).toBe(false);
    expect(procs.some((p) => cleanDraft(p.draft).graph.edges.some((x) => x.port === "timeout"))).toBe(true);
  });

  it("every row the two steps and the cases wrote is the pack's", async () => {
    const outside = async (table: string, where = "true") =>
      (await e.db.one<{ n: number }>(
        `select count(*)::int as n from ${table} x where x.org_id = $1 and ${where} and not exists (select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id = x.id)`, [e.org]))!.n;
    const inside = async (table: string, where = "true") =>
      (await e.db.one<{ n: number }>(`select count(*)::int as n from ${table} x where x.org_id = $1 and ${where} and exists (select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id = x.id)`, [e.org]))!.n;
    for (const [table, where] of [
      ["sm_field_defs", "x.name like 'u\\_aftab\\_%'"], ["sm_forms", "true"], ["sm_positions", "true"], ["sm_position_holders", "true"], ["sm_processes", "true"], ["sm_process_versions", "true"],
      ["sm_process_cases", "true"], ["sm_process_tasks", "true"], ["sm_process_submissions", "true"], ["sm_flow_runs", "true"], ["sm_flow_waits", "true"],
      ["sm_journal", "x.table_key = 'process_case'"], ["sm_notifications", "x.table_key = 'process_case'"],
    ] as const) {
      expect(await outside(table, where), table).toBe(0);
      expect(await inside(table, where), table).toBeGreaterThan(0);
    }
    expect((await e.db.one<{ n: number }>(`select count(*)::int as n from sm_process_cases where org_id = $1`, [e.org]))!.n).toBe(scripts.length);
    expect(memo.counts).toMatchObject({ position: WF_POSITIONS.length, process_case: scripts.length, process_version: WF_PROCESSES.length + 1 });
  });

  it("each sample case stands where its script says", async () => {
    for (const s of scripts) {
      const c = (await kase(caseOf(s.key)))!;
      expect(c.state, s.key).toBe(s.expect.state);
      for (const open of s.expect.open ?? []) expect((await tasks(caseOf(s.key))).some((t) => t.step_key === open && t.status === "open"), `${s.key} ${open}`).toBe(true);
    }
    // the owner's case: version 1's «واحد درخواست‌دهنده» finds no «مدیر گروه (نمونه)» in the finance department, and the
    // journal says why
    const v1 = caseOf("project-v1");
    expect((await kase(v1))!.version_no).toBe(1);
    expect(await tasks(v1)).toHaveLength(1);
    const v1j = (await journal(v1)).join("\n");
    expect(v1j).toContain("برای «مرحلهٔ فرم» کسی پیدا نشد");
    expect(v1j).toContain("«مدیر گروه (نمونه)»");
    expect(v1j).toContain("ادارهٔ کل امور مالی");
    // version 2 («همه‌جا»): both holders, the requester among them
    const open = caseOf("project-open");
    expect((await kase(open))!.version_no).toBe(2);
    expect((await tasks(open)).filter((t) => t.step_key === "form" && t.status === "open").map((t) => t.assigned_to).sort()).toEqual([who("manager"), who("agent")].sort());
    const done = caseOf("project-done");
    expect((await kase(done))!).toMatchObject({ state: "completed", outcome: "completed" });
    expect((await tasks(done)).find((t) => t.step_key === "form" && t.acted_by === who("manager"))?.status).toBe("done");
    expect((await tasks(done)).find((t) => t.step_key === "form" && t.assigned_to === who("agent"))?.status).toBe("not_needed");
    expect((await tasks(caseOf("project-canceled"))).filter((t) => t.step_key === "form").map((t) => t.status)).toEqual(["canceled", "canceled"]);
    // petty cash: branch head by the nearest branch up, the finance deputy above 50 million, paid with its note and number
    const paid = (await kase(caseOf("petty-paid")))!;
    expect(paid.data[F.pcPaidRef]).toMatch(/^SND-\d+$/);
    expect((await tasks(caseOf("petty-paid"))).filter((t) => t.status === "done").map((t) => [t.step_key, t.acted_by])).toEqual([
      ["request", who("branch")], ["head", who("requester")], ["deputy", who("finance")], ["pay", who("finance")],
    ]);
    expect(((await kase(caseOf("petty-rejected")))!).outcome).toBe("rejected");
    // the values of the other types, as their fields store them: a checked IBAN and mobile number, choices, a duration
    // in seconds, tags, a group, an IP address
    expect(isIban(String(paid.data[F.pcIban]))).toBe(true);
    expect(String((await kase(caseOf("leave-done")))!.data[F.lvMobile])).toMatch(/^0912\d{7}$/);
    const bought = (await kase(caseOf("procurement-done")))!.data;
    expect(bought[F.prItems]).toEqual(["storage", "server"]);
    expect(bought[F.prRenewal]).toBe(true);
    expect(String(bought[F.prVendorEmail])).toMatch(/@vendors\.example$/);
    const need = (await kase(caseOf("training-dropped")))!.data;
    expect(Number(need[F.tnDuration])).toBeGreaterThanOrEqual(8 * 3600);
    expect(need[F.tnAudience]).toBe(memo.groups.apps);
    expect((need[F.tnSkills] as string[]).length).toBeGreaterThan(0);
    expect((await kase(caseOf("security-open")))!.data[F.siIp]).toMatch(/^203\.0\.113\.\d+$/);
    // returned for correction: «ثبت درخواست» round 2 is the requester's again
    expect((await tasks(caseOf("petty-returned"))).filter((t) => t.step_key === "request").map((t) => [t.round, t.assigned_to, t.status])).toEqual([[1, who("branch"), "done"], [2, who("branch"), "open"]]);
    // «پایان مهلت»: the organisation's timer told the region head and ended the case, inside the pack's scope
    const expired = caseOf("petty-expired");
    expect(((await kase(expired))!)).toMatchObject({ state: "canceled", outcome: "canceled" });
    const ej = (await journal(expired)).join("\n");
    expect(ej).toContain("مهلت گذشت؛ «تأیید رئیس شعبه» به حمید میدانی اطلاع داده شد");
    expect(ej).toContain("مهلت «تأیید رئیس شعبه» به پایان رسید؛ پرونده از مسیر «پایان مهلت» ادامه یافت");
    expect((await tasks(expired)).find((t) => t.step_key === "head")?.status).toBe("not_needed");
    // leave: the substitute agrees, the manager approves, the status is set and both are told
    const leave = (await kase(caseOf("leave-done")))!;
    expect(String(leave.data[F.lvStatus])).toMatch(/^تأییدشده: /);
    const told = await e.db.query<{ user_id: string }>(`select user_id from sm_notifications where table_key = 'process_case' and record_id = $1 and title like 'مرخصی تأیید شد%'`, [caseOf("leave-done")]);
    expect(told.map((x) => x.user_id).sort()).toEqual([who("agent"), who("release")].sort());
    // no substitute: «موافقت جانشین» is passed by, the manager's approval waits
    expect((await journal(caseOf("leave-waiting"))).join("\n")).toContain("برای «موافقت جانشین» کسی پیدا نشد؛ از این مرحله گذشت.");
    expect((await tasks(caseOf("leave-waiting"))).filter((t) => t.status === "open").map((t) => [t.step_key, t.assigned_to])).toEqual([["manager", who("manager")]]);
    // parallel reviews in progress: «نظر فنی» in, the security and finance branches open
    const par = await tasks(caseOf("procurement-parallel"));
    expect(par.filter((t) => t.step_key === "tech").some((t) => t.status === "done")).toBe(true);
    expect(par.filter((t) => t.step_key === "finance" && t.status === "open").map((t) => t.assigned_to)).toEqual([who("finance")]);
    expect(par.some((t) => t.step_key === "security" && t.status === "open" && t.assigned_to === who("soc"))).toBe(true);
    // the committee: two approvals, nobody of the earlier steps among it (the finance deputy reviewed)
    const committee = (await tasks(caseOf("procurement-done"))).filter((t) => t.step_key === "committee");
    expect(committee.map((t) => t.assigned_to).sort()).toEqual([who("change"), who("pm")].sort());
    expect(committee.every((t) => t.outcome === "approved")).toBe(true);
    // a security report goes to the head of the branch the form names (a branch manager who never signs in)
    expect((await tasks(caseOf("security-done"))).find((t) => t.step_key === "officer")?.acted_by).toBe(memo.itam!.managers[memo.branches[1].unit]);
    expect((await tasks(caseOf("security-open"))).filter((t) => t.status === "open").map((t) => [t.step_key, t.assigned_to])).toEqual([["officer", who("requester")]]);
    // training: the department's head approved, the vacant post was passed by, the need was dropped
    const tj = (await journal(caseOf("training-dropped"))).join("\n");
    expect(tj).toContain("برای «بازبینی بازرس داخلی» کسی پیدا نشد؛ از این مرحله گذشت.");
    expect(((await kase(caseOf("training-dropped")))!).outcome).toBe("canceled");
  });

  it("the personas find their steps in «کارتابل», marked as the pack's", async () => {
    const box = async (persona: keyof LoadMemo["people"]["personas"]) => (await asPersona(who(persona), inbox)).rows.filter((r) => r.kind === "process_step");
    const steps = async (persona: keyof LoadMemo["people"]["personas"]) => (await box(persona)).map((r) => r.step).sort();
    expect(await steps("manager")).toEqual(["تأیید مدیر مستقیم", "مرحلهٔ فرم"].sort());
    expect(await steps("agent")).toEqual(["مرحلهٔ فرم"]);
    expect(await steps("branch")).toEqual(["ثبت درخواست"]);
    expect(await steps("requester")).toEqual(["بررسی رئیس شعبه"]);
    expect(await steps("soc")).toEqual(["نظر امنیت اطلاعات"]);
    expect(await steps("finance")).toEqual(["نظر مالی"]);
    for (const p of ["manager", "agent", "branch", "requester", "soc", "finance"] as const) for (const r of await box(p)) expect(r).toMatchObject({ demo: true, can_act: true });
  });

  it("only the pack's people start its workflows: a regular member is neither offered one nor let start it", async () => {
    const m = await e.member("member");
    await e.owner.post(`${P()}/access/members/${m.userId}/preset`, { preset: "agent" });
    const mine = (await m.client.get(`${P()}/process/mine`)).processes as { key: string; can_start: boolean }[];
    for (const p of WF_PROCESSES) expect(mine.find((x) => x.key === p.key)?.can_start ?? false, p.key).toBe(false);
    const refused = await m.client.post(`${P()}/process/start`, { process: "aftab_leave", values: { [F.lvType]: "annual", [F.lvDays]: 2 } }, 409);
    expect(refused.error.message).toBe(DEMO_PROCESS_START);
    // the pack's people are offered theirs (the project's by its starters: its roles and the finance persona)
    const agent = (await asPersona(who("agent"), myProcesses)).processes;
    for (const p of WF_PROCESSES) expect(agent.find((x) => x.key === p.key)?.can_start, p.key).toBe(true);
    const soc = (await asPersona(who("soc"), myProcesses)).processes;
    expect(soc.find((x) => x.key === "aftab_project")?.can_start ?? false).toBe(false);
  }, 300_000);

  it("runs again without a second copy", async () => {
    const count = async () =>
      (await e.db.query<{ t: string; n: number }>(
        `select 'f' as t, count(*)::int as n from sm_field_defs where org_id = $1 union all select 'fo', count(*)::int from sm_forms where org_id = $1
         union all select 'p', count(*)::int from sm_positions where org_id = $1 union all select 'h', count(*)::int from sm_position_holders where org_id = $1
         union all select 'pr', count(*)::int from sm_processes where org_id = $1 union all select 'v', count(*)::int from sm_process_versions where org_id = $1
         union all select 'c', count(*)::int from sm_process_cases where org_id = $1`, [e.org])).map((r) => `${r.t}:${r.n}`).join(" ");
    const before = await count();
    const again: LoadMemo = { ...memo, counts: {}, cursor: 0, wf: { ...memo.wf, published: [], cases: memo.wf!.cases } };
    await step("workflow_defs", again);
    await step("workflow_cases", again);
    expect(loadRefusals(e.org)).toEqual({});
    expect(await count()).toBe(before);
    expect(again.counts.field_def ?? 0).toBe(0);
  }, 300_000);

  it("a real field, form, position or process of the pack's name or key: only that part is refused, and what needs it", async () => {
    const owner2 = new Client(e.app);
    const org2 = await signupWithOrg(owner2, { email: "own-definitions@example.com", timezone: "Asia/Tehran" });
    const sys2 = await systemCtx(e.cfg, org2);
    await seeds(org2);
    // the organisation's own: a field with the project form's name, a position with the branch head's key
    await owner2.post(`/o/${org2}/fields/library`, { name: F.prjName, label: "نام پروژهٔ سازمان", type: "string" }, 201);
    await owner2.post(`/o/${org2}/r/position`, { key: "aftab_branch_head", name: "رئیس شعبهٔ خود سازمان" });
    const realField = await e.db.one<{ id: string; label: string; rev: unknown }>(`select id, label from sm_field_defs where org_id = $1 and name = $2`, [org2, F.prjName]);
    const memo2 = newMemo("small");
    for (const key of ["org", "groups", "people", "branch_staff", "workflow_defs", "workflow_cases"]) await step(key, memo2, org2, sys2);
    expect(Object.keys(loadRefusals(org2)).sort()).toEqual([
      `workflow_defs.field:${F.prjName}`, "workflow_defs.form:project", "workflow_defs.position:aftab_branch_head",
      "workflow_defs.process:aftab_petty_cash", "workflow_defs.process:aftab_project", "workflow_defs.process:aftab_security_report",
    ].sort());
    // nothing real changed
    expect(await e.db.one(`select id, label from sm_field_defs where org_id = $1 and name = $2`, [org2, F.prjName])).toEqual({ id: realField!.id, label: "نام پروژهٔ سازمان" });
    expect((await e.db.query<{ name: string }>(`select name from sm_positions where org_id = $1 and key = 'aftab_branch_head'`, [org2])).map((r) => r.name)).toEqual(["رئیس شعبهٔ خود سازمان"]);
    expect(await e.db.query(`select 1 from sm_position_holders h join sm_positions p on p.id = h.position_id where h.org_id = $1 and p.key = 'aftab_branch_head'`, [org2])).toEqual([]);
    // the rest is there, with its samples
    const made = (await e.db.query<{ key: string }>(`select key from sm_processes where org_id = $1 and key like 'aftab\\_%' order by key`, [org2])).map((r) => r.key);
    expect(made).toEqual(["aftab_leave", "aftab_procurement", "aftab_training"]);
    const states = await e.db.query<{ key: string; n: number }>(`select p.key, count(*)::int as n from sm_process_cases c join sm_processes p on p.id = c.process_id where c.org_id = $1 group by p.key order by p.key`, [org2]);
    expect(states.map((s) => s.key)).toEqual(["aftab_leave", "aftab_procurement", "aftab_training"]);
    // two organisations of one server, made minutes apart, each with its own pack's addresses (their ids' first digits
    // are their creation time: the pack once took the addresses from them, and the second load failed on the first's)
    const mails = async (org: string) => (await e.db.query<{ email: string }>(`select email from sm_users where prefs ->> 'demo_org' = $1 and email like 'agent.%'`, [org])).map((r) => r.email);
    expect((await mails(org2)).length).toBe(1);
    expect(await mails(org2)).not.toEqual(await mails(e.org));
  }, 900_000);

  it("the pack's addresses are the organisation's own, whenever it was made", () => {
    // ids made in the same millisecond share their first digits (uuidv7: the time); the pack's mark does not
    const a = uuidv7();
    const b = uuidv7();
    expect(a.replace(/-/g, "").slice(0, 6)).toBe(b.replace(/-/g, "").slice(0, 6));
    expect(demoTag(a)).not.toBe(demoTag(b));
    expect(demoTag(a)).toMatch(/^[0-9a-f]{8}$/);
  });

  it("over HTTP: a pack persona sends a step from «کارتابل», another approves, and the project's manager finds people for the case on version 1", async () => {
    await e.db.query(
      `insert into sm_demo_packs (org_id, state, size, progress, counters, started_by, loaded_at)
       values ($1, 'loaded', 'small', jsonb_build_object('memo', $2::jsonb, 'seeds_done', true, 'saved', true, 'saved_at', now(), 'computed', '[]'::jsonb), '{}'::jsonb, $3, now())
       on conflict (org_id) do nothing`,
      [e.org, JSON.stringify(memo), e.ownerId],
    );
    expect(await setDemoSignIn(e.db, e.org, true)).toBe(true);
    // the console lists the personas with the addresses the load gave them (an earlier version's pack keeps its own)
    await e.db.query(`update sm_users set email = $2 where id = $1`, [who("wfm"), `wfm.${e.org.replace(/-/g, "").slice(0, 6)}@aftab-bank.example`]);
    const status = await demoStatus(e.db, e.org, { secrets: true });
    const accounts = new Map((status.accounts ?? []).map((a) => [a.persona, a.email]));
    for (const persona of ["agent", "manager", "wfm"] as const) expect(accounts.get(persona)).toBe((await e.db.one<{ email: string }>(`select email from sm_users where id = $1`, [who(persona)]))!.email);
    const password = status.password!;
    const signIn = async (persona: keyof LoadMemo["people"]["personas"]) => {
      const c = new Client(e.app);
      await c.post("/auth/login", { email: accounts.get(persona), password });
      return c;
    };
    // the agent finds the project's «مرحلهٔ فرم» in «کارتابل» and sends it with the delay of its second tab
    const agent = await signIn("agent");
    const row = (await agent.get(`${P()}/process/inbox`)).rows.find((r: { case_id: string; step: string }) => r.case_id === caseOf("project-open") && r.step === "مرحلهٔ فرم");
    expect(row).toMatchObject({ can_act: true, demo: true });
    await agent.post(`${P()}/process/tasks/${row.id}/submit`, { values: { [F.prjDelay]: "" } }, 400);
    await agent.post(`${P()}/process/tasks/${row.id}/submit`, { values: { [F.prjDelay]: 4, [F.prjDelayReason]: "انتظار برای مجوز امنیتی", [F.prjReview]: "با برنامهٔ اصلاح‌شده موافقم" } });
    await drain();
    expect(await kase(caseOf("project-open"))).toMatchObject({ state: "completed", outcome: "completed" });
    expect((await tasks(caseOf("project-open"))).find((t) => t.assigned_to === who("manager"))?.status).toBe("not_needed");
    // the branch's officer asks for petty cash; the branch head approves it from «کارتابل»; above 50 million the finance
    // deputy approves and pays
    const branch = await signIn("branch");
    const started = await branch.post(`${P()}/process/start`, { process: "aftab_petty_cash", values: { [F.pcAmount]: "70000000", [F.pcPurpose]: "تعویض صندلی‌های سالن انتظار" } }, 201);
    await drain();
    const head = await signIn("requester");
    const approval = (await head.get(`${P()}/process/inbox`)).rows.find((r: { case_id: string }) => r.case_id === started.case);
    expect(approval).toMatchObject({ step: "تأیید رئیس شعبه", can_act: true, demo: true });
    await head.post(`${P()}/process/tasks/${approval.id}/submit`, { outcome: "approved", comment: "لازم است" });
    await drain();
    const finance = await signIn("finance");
    const deputy = (await finance.get(`${P()}/process/inbox`)).rows.find((r: { case_id: string }) => r.case_id === started.case);
    expect(deputy).toMatchObject({ step: "تأیید معاون مالی" });
    await finance.post(`${P()}/process/tasks/${deputy.id}/submit`, { outcome: "approved" });
    await drain();
    const pay = (await finance.get(`${P()}/process/inbox`)).rows.find((r: { case_id: string }) => r.case_id === started.case);
    expect(pay).toMatchObject({ step: "بررسی و پرداخت" });
    await finance.post(`${P()}/process/tasks/${pay.id}/submit`, { values: { [F.pcFinanceNote]: "پرداخت شد", [F.pcPaidRef]: "SND-777" } });
    await drain();
    expect(await kase(started.case)).toMatchObject({ state: "completed", outcome: "completed" });
    expect(await e.db.one(`select 1 as x from sm_demo_rows where org_id = $1 and row_id = $2`, [e.org, started.case])).toBeTruthy();
    // the owner's case on version 1: its manager reads why nobody was found and finds people with version 2's rules
    const manager = await signIn("manager");
    const detail = await manager.get(`${P()}/process/cases/${caseOf("project-v1")}`);
    expect(detail.demo).toBe(true);
    expect(detail.can.reresolve).toBe(true);
    expect(detail.waiting.form.reason).toBe("nobody");
    expect(detail.waiting.form.notes.join(" ")).toContain("ادارهٔ کل امور مالی");
    const again = await manager.post(`${P()}/process/cases/${caseOf("project-v1")}/reresolve`, { step: "form", rules: "current" });
    expect(again.status).toBe("ok");
    expect(again.people.map((p: { id: string }) => p.id).sort()).toEqual([who("manager"), who("agent")].sort());
    await drain();
    expect((await tasks(caseOf("project-v1"))).filter((t) => t.step_key === "form" && t.status === "open").map((t) => t.assigned_to).sort()).toEqual([who("manager"), who("agent")].sort());
    expect(await kase(caseOf("project-v1"))).toMatchObject({ state: "active", version_no: 1 });
    // everything they did is the pack's
    expect((await e.db.one<{ n: number }>(`select count(*)::int as n from sm_process_tasks t where t.org_id = $1 and not exists (select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id = t.id)`, [e.org]))!.n).toBe(0);
    expect((await e.db.one<{ n: number }>(`select count(*)::int as n from sm_process_submissions t where t.org_id = $1 and not exists (select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id = t.id)`, [e.org]))!.n).toBe(0);
  }, 600_000);
});
