// The rest of the demo bank (docs/DEMO_FA.md): every module beyond the core ITSM and bank ITAM steps of load.ts —
// IT finance (cost centres, budgets, allocation and chargeback), experience (an XLA policy; scores come from the SLM
// module's own job, never inserted), workforce (skills, rosters, time off, on-call), customer service for the bank's
// merchants and corporate clients, the departments' services (facilities, finance, legal, procurement), field service
// for the ATM fleet, monitoring events through the event pipeline (alerts and an incident raised from one), continuity
// and GRC, releases, DevOps and projects, the requester portal (links, topics, surveys answered by the pack's people),
// smart documents in the AI library and the bank's dashboards and KPIs.
//
// Everything is written the way load.ts writes: through the engine as the system inside the demo scope, or through the
// modules' own services as the pack's people (memberCtx) — allocation runs, survey answers, document uploads, event
// processing and maintenance generation are the modules' code, so what they derive is the pack's too. A part a module
// refuses is recorded with the pack's status (`refused`) and the load goes on. Only fictional names: every company is
// «… نمونهٔ …», every address `.example`.
import { tableDef } from "@shared/tables";
import { periodKeyOf } from "@shared/financial/logic";
import { fingerprintOf, normalize, type SourceSpec } from "@shared/event/logic";
import type { Cond } from "@shared/model/conditions";
import type { Ctx } from "../../context";
import type { Row, Tx } from "../../db";
import { createIn, savepoint, transition, updateIn } from "../../engine";
import { memberCtx } from "../../access/service";
import { calculateRun, ensureFiscalYear, postRun } from "../financial/service";
import { inviteIn, submitSurvey } from "../portal/surveys";
import { uploadDocument } from "../ai/rag/docs";
import { processEvent } from "../event/pipeline";
import { generateMaintenanceIn } from "../field_service/service";
import { BANK_DOMAIN, BANK_NAME, DEMO_SIZES, FIRST_NAMES, LAST_NAMES, REGIONS, Rng, SERVICES } from "./bank";
import { DAY, bump, choose, dateOnly, iso, keepRng, pastMoment, personOf, put, putOpen, refuse, stepRng, tryPut, type LoadMemo, type StepArgs } from "./load";

// ----- shared -------------------------------------------------------------------------------------------------------

/** How much of each module the size makes (small 1, medium 3, large 8). */
const scaleOf = (memo: LoadMemo) => (memo.size === "small" ? 1 : memo.size === "medium" ? 3 : 8);

/** A list the later steps share (memo.lists). */
function listOf(memo: LoadMemo, key: string): string[] {
  memo.lists ??= {};
  return (memo.lists[key] ??= []);
}

/**
 * Run a step's phases from `memo.cursor` until the deadline: each phase once (a long one returns false to be called
 * again in the next invocation, from where it saved itself), a phase a module refuses is recorded (`<step>.<phase>`)
 * and the load goes on. The step's random source (`stepRng(memo, step, …)`) is kept after each phase, so phases run in
 * later invocations continue its sequence. True when the last phase is done.
 */
async function phased(a: StepArgs, step: string, phases: readonly string[], run: (phase: string) => Promise<void | boolean>, rng?: Rng): Promise<boolean> {
  const { orgId, memo } = a;
  while (memo.cursor < phases.length && Date.now() < a.deadline) {
    const phase = phases[memo.cursor];
    try {
      if ((await run(phase)) === false) return false;
    } catch (e) {
      refuse(orgId, `${step}.${phase}`, e);
    }
    memo.cursor++;
    if (rng) keepRng(memo, step, rng);
  }
  if (memo.cursor < phases.length) return false;
  memo.cursor = 0;
  if (rng) keepRng(memo, step, null);
  return true;
}

/** The pack's people of a group (the agents load.ts made), at most `n`. */
const agentsOf = (memo: LoadMemo, key: string, n = 50) => (memo.people.agents[key] ?? []).slice(0, n);

/** A demo row of a table by a column (the module seeds' rows are looked up the same way). */
async function idBy(q: Tx | Ctx["db"], orgId: string, table: string, col: string, value: unknown): Promise<string | null> {
  const def = tableDef(table);
  if (!def) return null;
  const r = await q.one<{ id: string }>(`select id from ${def.table} where org_id = $1 and ${col} = $2 and deleted_at is null order by created_at limit 1`, [orgId, value]);
  return r?.id ?? null;
}

const pad = (n: number, w = 3) => String(n).padStart(w, "0");

// ----- experience (XLA) ---------------------------------------------------------------------------------------------

/**
 * The bank's experience policy for ATM incidents, before the incidents are written: the SLM module's job scores every
 * incident by the first policy it matches (this one for the ATM service, the seeded one for the rest) and rescores it
 * when its survey answer arrives (stepPortal) — the scores are the platform's, never written here.
 */
export async function stepExperience({ memo }: StepArgs, sys: Ctx): Promise<boolean> {
  await sys.write(async (tx) => {
    const p = await tryPut(tx, sys, "slm_xla_policy", {
      name: "تجربهٔ شعب و مشتریان از خرابی خودپرداز",
      table_key: "incident", active: true, sort_order: 5, threshold: 60,
      condition: memo.services.atm ? { f: "service_id", op: "eq", v: memo.services.atm } : null,
      w_reliability: 50, w_quality: 30, w_effort: 20, p_breach: 35, p_reopen: 25, p_reassign: 10, p_late_response: 20, response_hours: "2", p_chase: 10, use_survey: true,
      description: "خودپرداز از کار افتاده صف مشتریان شعبه را می‌سازد: پاسخ دیرتر از دو ساعت و نقض زمان رفع بیش از هر چیز از تجربه می‌کاهد (سیاست نمایشی).",
    });
    if (p) bump(memo, "slm_xla_policy");
    const r = await tryPut(tx, sys, "slm_xla_policy", {
      name: "تجربهٔ کارکنان شعب از درخواست‌های خدمت",
      table_key: "request_item", active: true, sort_order: 5, threshold: 55, response_hours: "8", use_survey: true,
      description: "درخواست‌های کارکنان شعب (لپ‌تاپ، دسترسی کربنکینگ، VPN): پیگیری‌های پیاپی درخواست‌کننده زحمت او را نشان می‌دهد (سیاست نمایشی).",
    });
    if (r) bump(memo, "slm_xla_policy");
  });
  return true;
}

// ----- IT finance ---------------------------------------------------------------------------------------------------

/** The bank's cost centres (codes under AFT-CC-…), made with the suppliers so contracts post their accruals to them. */
export const COST_CENTRES: [key: string, code: string, name: string][] = [
  ["itb", "AFT-CC-ITB", "مرکز هزینهٔ تجهیزات شعب و خودپردازها"],
  ["dc", "AFT-CC-DC", "مرکز هزینهٔ زیرساخت و مرکز داده"],
  ["ch", "AFT-CC-CH", "مرکز هزینهٔ کانال‌های الکترونیک"],
  ["sec", "AFT-CC-SEC", "مرکز هزینهٔ امنیت اطلاعات"],
];

/** Make the cost centres (inside the suppliers step's write); their ids go to memo.units `cc:<key>`. */
export async function costCentresIn(tx: Tx, sys: Ctx, memo: LoadMemo): Promise<void> {
  for (const [key, code, name] of COST_CENTRES) {
    if (memo.units[`cc:${key}`]) continue;
    const cc = await put(tx, sys, "org_unit", { name, code, kind: "cost_center", parent_id: memo.units.IT ?? memo.hq });
    memo.units[`cc:${key}`] = String(cc.id);
    bump(memo, "org_unit");
  }
  // the fleet's purchases and depreciation post to the branch equipment centre (seedItamFleet)
  memo.units.cost_center = memo.units["cc:itb"];
}

/** Budgets per cost centre: [cost centre, name, state, lines (cost type code, share of the year's actual, floor in billions of rials)]. */
const BUDGETS: [cc: string, name: string, state: string, monthly: boolean, lines: [string, number, number][]][] = [
  ["itb", "بودجهٔ تجهیزات شعب و خودپردازها", "approved", true, [["HW", 1.15, 40], ["DEP", 0.95, 12], ["SVC", 1.1, 8], ["MAINT", 1.25, 3]]],
  ["dc", "بودجهٔ زیرساخت و مرکز داده", "approved", true, [["HW", 1.2, 30], ["SVC", 0.9, 25], ["TEL", 1.05, 18], ["DEP", 1.0, 6]]],
  ["ch", "بودجهٔ کانال‌های الکترونیک", "approved", false, [["SW", 1.1, 22], ["CLOUD", 1.3, 5], ["SVC", 1.0, 30]]],
  ["sec", "بودجهٔ امنیت اطلاعات", "submitted", false, [["SVC", 1.2, 14], ["SW", 1.1, 9], ["HW", 1.0, 6]]],
];

/** Allocation rules of the pack: [name, source centre, method, targets (service key, percent)]. */
const ALLOCATION_RULES: [string, string, string, [string, number][]][] = [
  ["تسهیم هزینهٔ زیرساخت و مرکز داده به خدمت‌های بانکی", "dc", "percent", [["core", 35], ["switch", 20], ["ibank", 15], ["mbank", 15], ["rtgs", 5], ["ach", 5], ["cheque", 5]]],
  ["تسهیم هزینهٔ تجهیزات شعب و خودپردازها", "itb", "percent", [["atm", 60], ["teller", 25], ["pos", 15]]],
  ["تسهیم هزینهٔ کانال‌های الکترونیک", "ch", "equal", [["ibank", 0], ["mbank", 0], ["pos", 0]]],
];

/**
 * IT finance of the demo bank: annual budgets of its cost centres sized from the year's actual so far (some lines
 * over, some under — the variance view has something to say), one awaiting the finance committee's approval and a
 * draft (next year's proposal once the platform opened next year, else a mid-year revision); allocation rules from the data-centre, branch-equipment and channel centres to the bank's services;
 * a showback of the last months and a chargeback of the first half posted to the consuming departments — calculated
 * and posted by the finance persona through the module's own services.
 */
export async function stepFinance(a: StepArgs, sys: Ctx): Promise<boolean> {
  const { cfg, orgId, memo } = a;
  const now = Date.now();
  const key = periodKeyOf(dateOnly(now));
  const jy = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  return phased(a, "finance", ["budgets", "rules", "runs"], async (phase) => {
    const types = new Map((await sys.db.query<{ id: string; code: string }>(`select id, code from sm_cost_types where org_id = $1 and deleted_at is null`, [orgId])).map((t) => [t.code, t.id]));
    if (phase === "budgets") {
      const year = await ensureFiscalYear(sys, jy);
      // next year's calendar only when the platform has opened it already (its daily sweep does near the year's end):
      // the pack never makes a fiscal year that real budgets could then be planned in
      const next = await sys.db.one<Row>(`select * from sm_fiscal_years where org_id = $1 and year = $2 and deleted_at is null limit 1`, [orgId, jy + 1]);
      const periods = await sys.db.query<{ id: string; month: number }>(`select id, month from sm_fiscal_periods where org_id = $1 and fiscal_year_id = $2 and deleted_at is null order by month`, [orgId, year.id]);
      // the year's actual so far per centre and type (asset purchases, depreciation and contract accruals of the ledger)
      const actual = new Map<string, number>();
      const rows = await sys.db.query<{ cc: string; code: string; total: string }>(
        `select e.cost_center_id::text as cc, t.code, sum(e.amount)::text as total from sm_cost_entries e join sm_cost_types t on t.id = e.cost_type_id
          where e.org_id = $1 and e.deleted_at is null and e.entry_date between $2 and $3 group by 1, 2`,
        [orgId, year.start_date, year.end_date],
      );
      for (const r of rows) actual.set(`${r.cc}:${r.code}`, Number(r.total));
      const owner = memo.people.personas.finance ?? null;
      const make = async (tx: Tx, fy: Row, cc: string, name: string, state: string, monthly: boolean, lines: [string, number, number][]) => {
        const b = await put(tx, sys, "budget", { name, fiscal_year_id: fy.id, cost_center_id: cc, owner_id: owner, alert_percent: 90, state: "draft", notes: "بودجهٔ نمایشی بانک نمونهٔ آفتاب" });
        for (const [code, share, floor] of lines) {
          const type = types.get(code);
          if (!type) continue;
          // the annual amount: the actual so far projected to the year, times the line's share, at least its floor
          const projected = ((actual.get(`${cc}:${code}`) ?? 0) * 12) / Math.max(1, month);
          const annual = Math.round(Math.max(projected * share, floor * 1_000_000_000) / 1_000_000) * 1_000_000;
          if (monthly && fy.id === year.id && periods.length === 12) {
            for (const p of periods) await put(tx, sys, "budget_line", { budget_id: b.id, cost_type_id: type, period_id: p.id, amount: String(Math.round(annual / 12 / 1_000_000) * 1_000_000), note: "سهم ماهانه" });
          } else await put(tx, sys, "budget_line", { budget_id: b.id, cost_type_id: type, amount: String(annual), note: "کل سال" });
        }
        if (state !== "draft") await updateIn(tx, sys, "budget", String(b.id), { state }, { trusted: true });
        bump(memo, "budget");
      };
      for (const [cc, name, state, monthly, lines] of BUDGETS) {
        const unit = memo.units[`cc:${cc}`];
        if (!unit) continue;
        await sys.write((tx) => make(tx, year, unit, `${name} ${jy}`, state, monthly, lines));
      }
      // a draft of the branch equipment centre: next year's proposal, or this year's revision before next year opens
      if (memo.units["cc:itb"]) {
        const name = next ? `بودجهٔ پیشنهادی تجهیزات شعب و خودپردازها ${jy + 1}` : `بازنگری میان‌سال بودجهٔ تجهیزات شعب و خودپردازها ${jy}`;
        await sys.write((tx) => make(tx, next ?? year, memo.units["cc:itb"], name, "draft", false, BUDGETS[0][4]));
      }
    } else if (phase === "rules") {
      await sys.write(async (tx) => {
        for (const [name, cc, method, targets] of ALLOCATION_RULES) {
          if (!memo.units[`cc:${cc}`]) continue;
          const rule = await put(tx, sys, "allocation_rule", { name, source_cost_center_id: memo.units[`cc:${cc}`], method, active: true, sort_order: 50, description: "قاعدهٔ نمایشی تسهیم هزینه" });
          for (const [svc, pct] of targets) if (memo.services[svc]) await put(tx, sys, "allocation_target", { rule_id: rule.id, service_id: memo.services[svc], percent: method === "percent" ? String(pct) : undefined });
          bump(memo, "allocation_rule");
        }
      });
    } else if (phase === "runs") {
      const finance = memo.people.personas.finance;
      if (!finance) return;
      const fx = await memberCtx(cfg, orgId, finance);
      const year = await ensureFiscalYear(sys, jy);
      const periodOf = async (m: number) => (await sys.db.one<{ id: string }>(`select id from sm_fiscal_periods where org_id = $1 and fiscal_year_id = $2 and month = $3 and deleted_at is null`, [orgId, year.id, m]))?.id;
      const last = Math.max(1, month - 1);
      // a showback of the last three closed months
      const from = await periodOf(Math.max(1, last - 2));
      const to = await periodOf(last);
      if (from && to) {
        const show = (await createRecord(fx, "allocation_run", { name: "نمایش هزینهٔ خدمت‌های بانکی — سه ماه گذشته", mode: "showback", fiscal_year_id: year.id, period_from_id: from, period_to_id: to, notes: "نمایش هزینه به ادارات مصرف‌کننده (بدون ثبت در دفتر)" }));
        await calculateRun(fx, String(show.id));
        bump(memo, "allocation_run");
      }
      // a chargeback of the first half (or the months closed so far), approved and posted to the departments
      if (month >= 3) {
        const cfrom = await periodOf(1);
        const cto = await periodOf(Math.min(6, last));
        if (cfrom && cto) {
          const charge = await createRecord(fx, "allocation_run", { name: "بازپرداخت هزینه‌های فناوری به ادارات — نیمهٔ نخست", mode: "chargeback", fiscal_year_id: year.id, period_from_id: cfrom, period_to_id: cto, notes: "بازپرداخت بر پایهٔ قاعده‌های تسهیم؛ تأیید کمیتهٔ مالی" });
          await calculateRun(fx, String(charge.id));
          await transition(fx, "allocation_run", String(charge.id), "approved");
          await postRun(fx, String(charge.id));
          bump(memo, "allocation_run");
        }
      }
    }
  });
}

/** Create a record as a member (the engine's access applies), returning the row. */
async function createRecord(ctx: Ctx, table: string, values: Record<string, unknown>): Promise<Row> {
  return ctx.write((tx) => createIn(tx, ctx, table, values));
}

// ----- workforce ----------------------------------------------------------------------------------------------------

/** The bank's own skills (the seeded IT skills are used as they are). */
const BANK_SKILLS: [string, string, string[]][] = [
  ["خودپرداز و دستگاه‌های خودکار بانکی", "domain", ["خودپرداز", "کاست", "دیسپنسر", "کارت‌خوان", "اسکناس"]],
  ["سوئیچ کارت و تراکنش‌های کارتی", "domain", ["سوئیچ", "تراکنش", "کارت", "پذیرنده", "پایانه"]],
  ["کربنکینگ و سامانهٔ باجه", "application", ["کربنکینگ", "باجه", "سپرده", "حساب", "دفترچه"]],
  ["HSM و رمزنگاری کارت", "security", ["HSM", "کلید", "پین", "رمزنگاری"]],
  ["پایاپای، تسویهٔ آنی و تبادل چک", "domain", ["پایاپای", "تسویه", "چک", "انتقال وجه"]],
  ["بانکداری اینترنتی و همراه", "application", ["بانکداری اینترنتی", "همراه", "رمز یکبار مصرف", "اپلیکیشن"]],
];

/** Skills of each group's agents: [group, skills (bank or seeded names)]. */
const GROUP_SKILLS: [string, string[]][] = [
  ["card", ["خودپرداز و دستگاه‌های خودکار بانکی", "سوئیچ کارت و تراکنش‌های کارتی", "HSM و رمزنگاری کارت"]],
  ["core", ["کربنکینگ و سامانهٔ باجه", "پایگاه داده", "لینوکس"]],
  ["network", ["شبکه", "VPN و دسترسی از راه دور"]],
  ["ebank", ["بانکداری اینترنتی و همراه", "سرورهای ویندوز"]],
  ["dc", ["مجازی‌سازی", "پشتیبان‌گیری و بازیابی", "سرورهای ویندوز"]],
  ["desk", ["پشتیبانی کاربران نهایی", "اکتیو دایرکتوری و هویت", "ارتباط با مشتری"]],
  ["soc", ["امنیت اطلاعات", "HSM و رمزنگاری کارت"]],
  ["apps", ["پایاپای، تسویهٔ آنی و تبادل چک", "پایگاه داده"]],
];

const COVERAGE: [group: string, skill: string, level: number, people: number, critical: boolean][] = [
  ["card", "خودپرداز و دستگاه‌های خودکار بانکی", 3, 2, true],
  ["card", "سوئیچ کارت و تراکنش‌های کارتی", 4, 2, true],
  ["core", "کربنکینگ و سامانهٔ باجه", 4, 2, true],
  ["network", "شبکه", 3, 2, true],
  ["ebank", "بانکداری اینترنتی و همراه", 3, 2, false],
  ["soc", "امنیت اطلاعات", 4, 2, true],
];

const CERTS: [string, string][] = [
  ["گواهی مبانی ITIL 4", "مرکز آموزش بانک نمونهٔ آفتاب"],
  ["دورهٔ امنیت داده‌های کارت (PCI DSS)", "مرکز آموزش بانک نمونهٔ آفتاب"],
  ["گواهی نگهداری خودپرداز سطح ۲", "شرکت نمونهٔ خدمات خودپرداز پارس"],
  ["دورهٔ پیشرفتهٔ شبکه‌های بانکی", "مؤسسهٔ آموزشی نمونهٔ دانش‌افزار"],
];

/**
 * Workforce: the bank's skills and people's proficiency (some verified by the desk manager, some suggested), their
 * certificates (a few expiring), the critical skill needs of the teams, this month's rosters on the seeded shift
 * patterns (the desk by day and evening, the card team with a night shift), team capacity, time off in every state
 * (taken, on leave now with a delegate, awaiting approval, refused), kudos between colleagues, and the on-call
 * schedules of the bank's teams with an override and the card team's escalation policy.
 */
export async function stepWorkforce(a: StepArgs, sys: Ctx): Promise<boolean> {
  const { orgId, memo } = a;
  const rng = stepRng(memo, "workforce", memo.seed + 53);
  const now = Date.now();
  const s = scaleOf(memo);
  return phased(a, "workforce", ["skills", "people", "rosters", "absences", "oncall"], async (phase) => {
    const skillIds = async (tx: Tx) => new Map((await tx.query<{ id: string; name: string }>(`select id, name from sm_wfm_skills where org_id = $1 and deleted_at is null`, [orgId])).map((r) => [r.name, r.id]));
    if (phase === "skills") {
      await sys.write(async (tx) => {
        for (const [name, category, keywords] of BANK_SKILLS) {
          if (await idBy(tx, orgId, "wfm_skill", "name", name)) continue;
          await put(tx, sys, "wfm_skill", { name, category, keywords, routing: true, active: true, description: "مهارت نمایشی بانک" });
          bump(memo, "wfm_skill");
        }
        const skills = await skillIds(tx);
        for (const [group, skill, level, people, critical] of COVERAGE) {
          if (!memo.groups[group] || !skills.get(skill)) continue;
          if (await tryPut(tx, sys, "wfm_coverage", { group_id: memo.groups[group], skill_id: skills.get(skill), min_level: level, min_people: people, critical, note: "نیاز مهارتی نمایشی" })) bump(memo, "wfm_coverage");
        }
      });
    } else if (phase === "people") {
      const verifier = memo.people.personas.manager ?? null;
      await sys.write(async (tx) => {
        const skills = await skillIds(tx);
        for (const [group, names] of GROUP_SKILLS) {
          for (const [i, user] of agentsOf(memo, group, 6 * s).entries()) {
            for (const [k, name] of names.entries()) {
              const skill = skills.get(name);
              if (!skill || (k > 0 && rng.chance(0.3))) continue;
              const inferred = rng.chance(0.15);
              const verified = !inferred && rng.chance(0.55);
              const row = await tryPut(tx, sys, "wfm_person_skill", {
                user_id: user, skill_id: skill, level: k === 0 ? rng.int(3, 5) : rng.int(2, 4),
                source: inferred ? "inferred" : verified ? "manager" : "self", status: inferred ? "suggested" : "active",
                evidence: inferred ? "از رخدادهای حل‌شدهٔ اخیر استنتاج شد" : "سابقهٔ کار در گروه",
                verified, verified_by: verified ? verifier : undefined, verified_at: verified ? iso(now - rng.int(10, 200) * DAY) : undefined,
              });
              if (row) bump(memo, "wfm_person_skill");
            }
            if (i % 2 === 0) {
              const [cert, issuer] = CERTS[(i + group.length) % CERTS.length];
              const expiring = i % 4 === 0;
              if (await tryPut(tx, sys, "wfm_certification", { user_id: user, name: cert, issuer, cert_number: `AFT-${group.toUpperCase()}-${pad(i + 1, 4)}`, issued_at: dateOnly(now - rng.int(300, 900) * DAY), expires_at: dateOnly(now + (expiring ? rng.int(5, 25) : rng.int(120, 700)) * DAY) })) bump(memo, "wfm_certification");
            }
          }
        }
        // kudos between colleagues, about real work of the pack
        const incidents = memo.incidents.slice(0, 20);
        for (let k = 0; k < 4 * s; k++) {
          const team = (["card", "desk", "network", "core"] as const)[k % 4];
          const people = agentsOf(memo, team, 10);
          if (people.length < 2) continue;
          const from = people[k % people.length];
          const to = people[(k + 1) % people.length];
          const inc = incidents[k % Math.max(1, incidents.length)];
          const no = inc ? (await tx.one<{ number: string | null }>(`select number from sm_incidents where id = $1`, [inc]))?.number ?? null : null;
          const message = ["سپاس بابت رفع سریع گیر کردن اسکناس خودپرداز در ساعت اوج", "ممنون از همراهی در شب جابه‌جایی به گره دوم سوئیچ", "راهنمایی دقیقت برای بازنشانی دسترسی کارمند شعبه کار را جلو برد", "پیگیری خط پشتیبان شعبه تا آخر وقت؛ دستت درد نکند"][k % 4];
          if (await tryPut(tx, sys, "wfm_kudos", { from_id: from, to_id: to, message, table_key: inc ? "incident" : undefined, record_id: inc, record_number: no ?? undefined })) bump(memo, "wfm_kudos");
        }
      });
    } else if (phase === "rosters") {
      const patterns = new Map((await sys.db.query<{ id: string; code: string }>(`select id, code from sm_wfm_shift_patterns where org_id = $1 and deleted_at is null`, [orgId])).map((r) => [r.code, r.id]));
      const day = patterns.get("ص");
      const evening = patterns.get("ع");
      const night = patterns.get("ش");
      if (!day) return;
      await sys.write(async (tx) => {
        const from = dateOnly(now - 20 * DAY);
        const to = dateOnly(now + 40 * DAY);
        const plan: [string, string[], (i: number) => string | undefined, (i: number) => string][] = [
          ["desk", agentsOf(memo, "desk", 8 * s), (i) => (i % 3 === 2 ? evening : day), (i) => (i % 3 === 2 ? "backup" : "primary")],
          ["card", agentsOf(memo, "card", 8 * s), (i) => (i % 3 === 1 ? night : day), (i) => (i % 3 === 1 ? "backup" : "primary")],
          ["network", agentsOf(memo, "network", 6 * s), () => day, () => "primary"],
        ];
        for (const [group, people, pattern, role] of plan) {
          for (const [i, user] of people.entries()) {
            const p = pattern(i) ?? day;
            if (memo.groups[group] && (await tryPut(tx, sys, "wfm_roster", { group_id: memo.groups[group], user_id: user, pattern_id: p, role: role(i), valid_from: from, valid_to: to, note: "برنامهٔ نمایشی این ماه" }))) bump(memo, "wfm_roster");
          }
        }
        if (memo.people.personas.agent && memo.groups.desk) await tryPut(tx, sys, "wfm_roster", { group_id: memo.groups.desk, user_id: memo.people.personas.agent, pattern_id: day, role: "primary", valid_from: from, valid_to: to });
        for (const [group, max, through, aht, min] of [["desk", 10, "14", "0.6", 2], ["card", 8, "9", "1.5", 2], ["network", 6, "5", "2.5", 1]] as const) {
          if (memo.groups[group] && (await tryPut(tx, sys, "wfm_capacity", { group_id: memo.groups[group], max_open: max, daily_throughput: through, aht_hours: aht, occupancy: "80", shrinkage: "30", min_staff: min, note: "ظرفیت نمایشی تیم" }))) bump(memo, "wfm_capacity");
        }
      });
    } else if (phase === "absences") {
      // one person each (no overlapping leave): taken, on leave now with a delegate, awaiting approval, refused, sick
      const desk = agentsOf(memo, "desk", 6);
      const card = agentsOf(memo, "card", 6);
      const net = agentsOf(memo, "network", 6);
      const items: { user?: string; group: string; type: string; from: number; to: number; state: string; delegate?: string; note: string; reason?: string }[] = [
        { user: desk[0], group: "desk", type: "annual", from: now - 32 * DAY, to: now - 28 * DAY, state: "ended", delegate: desk[1], note: "سفر خانوادگی" },
        { user: card[0], group: "card", type: "annual", from: now - DAY, to: now + 3 * DAY, state: "approved", delegate: card[1], note: "مرخصی استحقاقی؛ کشیک به جانشین سپرده شد" },
        { user: net[0], group: "network", type: "training", from: now + 7 * DAY, to: now + 9 * DAY, state: "requested", note: "دورهٔ پیشرفتهٔ شبکه‌های بانکی" },
        { user: desk[2], group: "desk", type: "annual", from: now + 12 * DAY, to: now + 16 * DAY, state: "rejected", note: "مرخصی پایان ماه", reason: "هم‌زمان با بستن حساب‌های پایان ماه؛ لطفاً هفتهٔ بعد را برگزینید" },
        { user: card[2], group: "card", type: "sick", from: now - 10 * DAY, to: now - 9 * DAY, state: "ended", note: "استعلاجی" },
        { user: desk[3], group: "desk", type: "mission", from: now + 2 * DAY, to: now + 3 * DAY, state: "approved", delegate: desk[4], note: "مأموریت راه‌اندازی میز خدمت منطقهٔ شرق" },
      ];
      for (const it of items) {
        if (!it.user || !memo.groups[it.group]) continue;
        await sys.write(async (tx) => {
          if (await tryPut(tx, sys, "wfm_absence", { user_id: it.user, group_id: memo.groups[it.group], type: it.type, start_at: iso(it.from), end_at: iso(it.to), delegate_id: it.delegate, note: it.note, reject_reason: it.reason, state: it.state, requested_by: it.user })) bump(memo, "wfm_absence");
        });
      }
    } else if (phase === "oncall") {
      await sys.write(async (tx) => {
        const start = iso(now - 21 * DAY);
        for (const [group, name] of [["network", "کشیک شبکه و ارتباطات بانک"], ["core", "کشیک سامانهٔ کربنکینگ"], ["dc", "کشیک مرکز داده"], ["ebank", "کشیک بانکداری اینترنتی و همراه"], ["soc", "کشیک مرکز عملیات امنیت"]] as const) {
          const members = agentsOf(memo, group, 4);
          if (!memo.groups[group] || members.length < 2) continue;
          const sched = await tryPut(tx, sys, "oncall_schedule", { name, group_id: memo.groups[group], timezone: "Asia/Tehran", active: true, description: "کشیک هفتگی شبانه‌روزی (نمایشی)" });
          if (!sched) continue;
          await tryPut(tx, sys, "oncall_rotation", { schedule_id: sched.id, name: "چرخش هفتگی", layer: 1, rotation_type: "weekly", length_hours: 168, active: true, start_at: start, members, restriction: "none" });
          if (members.length > 2) await tryPut(tx, sys, "oncall_rotation", { schedule_id: sched.id, name: "شب‌ها و تعطیلات", layer: 2, rotation_type: "daily", length_hours: 24, active: true, start_at: start, members: [...members.slice(1), members[0]], restriction: "off_hours" });
          bump(memo, "oncall_schedule");
        }
        // the card team's schedule (stepExtras): an override while its on-call is on leave, and its escalation policy
        const card = memo.units.oncall_card;
        const people = agentsOf(memo, "card", 4);
        if (card && people.length > 1) {
          if (await tryPut(tx, sys, "oncall_override", { schedule_id: card, user_id: people[1], replaces_id: people[0], start_at: iso(now - DAY), end_at: iso(now + 3 * DAY), reason: "مرخصی کشیک اصلی" })) bump(memo, "oncall_override");
        }
        if (memo.groups.card) {
          const policy = await tryPut(tx, sys, "escalation_policy", { name: "ارتقای هشدارهای کارت و خودپرداز", group_id: memo.groups.card, active: true, repeat_times: 1, description: "کشیک ← مدیر گروه پس از ۱۰ دقیقه ← همهٔ گروه پس از ۲۰ دقیقه (نمایشی)" });
          if (policy) {
            await tryPut(tx, sys, "escalation_level", { policy_id: policy.id, level: 1, delay_minutes: 0, target: "oncall", schedule_id: card, channels: ["in_app", "email", "sms"], description: "کشیک برنامه" });
            await tryPut(tx, sys, "escalation_level", { policy_id: policy.id, level: 2, delay_minutes: 10, target: "manager", target_group_id: memo.groups.card, channels: ["in_app", "email"], description: "مدیر گروه" });
            await tryPut(tx, sys, "escalation_level", { policy_id: policy.id, level: 3, delay_minutes: 20, target: "group", target_group_id: memo.groups.card, channels: ["in_app"], description: "همهٔ گروه" });
            bump(memo, "escalation_policy");
          }
        }
      });
    }
  }, rng);
}

// ----- customer service (merchants and corporate clients) ------------------------------------------------------------

/** The bank's customers: merchants with POS terminals and corporate clients — all fictional. */
const ACCOUNTS: { name: string; code: string; domain: string; segment: string; tier: string; city: string; merchant: boolean; products: string[] }[] = [
  { name: "فروشگاه‌های زنجیره‌ای نمونهٔ ستاره", code: "CUS-001", domain: "setareh-stores.example", segment: "enterprise", tier: "strategic", city: "تهران", merchant: true, products: ["pos", "ipg"] },
  { name: "شرکت نمونهٔ پخش دارویی سلامت", code: "CUS-002", domain: "salamat-pharma.example", segment: "enterprise", tier: "gold", city: "تهران", merchant: false, products: ["cib", "payroll"] },
  { name: "دانشگاه نمونهٔ علوم پایه", code: "CUS-003", domain: "olum-university.example", segment: "government", tier: "gold", city: "اصفهان", merchant: true, products: ["ipg", "payroll"] },
  { name: "شهرداری نمونهٔ منطقهٔ سه", code: "CUS-004", domain: "shahrdari-3.example", segment: "government", tier: "silver", city: "مشهد", merchant: true, products: ["pos", "ipg"] },
  { name: "هتل نمونهٔ کوهستان", code: "CUS-005", domain: "kouhestan-hotel.example", segment: "smb", tier: "silver", city: "شیراز", merchant: true, products: ["pos"] },
  { name: "رستوران‌های زنجیره‌ای نمونهٔ سفرهٔ ایرانی", code: "CUS-006", domain: "sofreh.example", segment: "smb", tier: "bronze", city: "تبریز", merchant: true, products: ["pos"] },
  { name: "شرکت نمونهٔ حمل‌ونقل باربری راه", code: "CUS-007", domain: "rah-cargo.example", segment: "smb", tier: "bronze", city: "اهواز", merchant: false, products: ["cib", "gift"] },
  { name: "بیمارستان نمونهٔ مهرگان", code: "CUS-008", domain: "mehregan-hospital.example", segment: "enterprise", tier: "gold", city: "تهران", merchant: true, products: ["pos", "payroll"] },
];

const PRODUCTS: [key: string, name: string, family: string, desc: string][] = [
  ["pos", "پایانهٔ فروش (POS)", "پذیرندگی", "پایانه‌های رومیزی و سیار پذیرندگان با تسویهٔ روزانه"],
  ["ipg", "درگاه پرداخت اینترنتی", "پذیرندگی", "درگاه پرداخت فروشگاه‌های اینترنتی و سامانه‌های سازمانی"],
  ["cib", "بانکداری اینترنتی شرکتی", "بانکداری الکترونیک", "انتقال وجه گروهی، صورت‌حساب و امضای چندنفره برای مشتریان حقوقی"],
  ["payroll", "سامانهٔ پرداخت گروهی حقوق", "بانکداری الکترونیک", "بارگذاری فایل حقوق و واریز گروهی به حساب کارکنان مشتری"],
  ["gift", "کارت هدیهٔ سازمانی", "کارت", "صدور گروهی کارت هدیه برای کارکنان و مشتریان شرکت‌ها"],
];

const LEVEL_OF: Record<string, string> = { strategic: "enterprise", gold: "premium", silver: "standard", bronze: "basic" };

/** Cases: [title, description, case type, product, complaint severity]. */
const CASES: [string, string, string, string, string | null][] = [
  ["عدم اتصال پایانهٔ فروش شعبهٔ مرکزی فروشگاه", "سه پایانهٔ فروش از صبح پیام «عدم ارتباط با میزبان» می‌دهند؛ مشتریان با کارت پرداخت نمی‌توانند.", "problem", "pos", null],
  ["تأخیر در واریز تسویهٔ روزانهٔ پایانه‌ها", "تسویهٔ تراکنش‌های دیروز تا ساعت ۱۴ امروز به حساب پذیرنده نرسیده است.", "complaint", "pos", "high"],
  ["درخواست پایانهٔ فروش سیار برای غرفهٔ نمایشگاه", "برای نمایشگاه هفتهٔ آینده دو پایانهٔ سیار با اتصال سیم‌کارت لازم است.", "request", "pos", null],
  ["خطای «تراکنش نامعتبر» در درگاه پرداخت اینترنتی", "پرداخت شهریه با کارت‌های برخی بانک‌ها با خطای «تراکنش نامعتبر» برمی‌گردد.", "problem", "ipg", null],
  ["کسر مبلغ از حساب مشتری بدون صدور رسید", "مشتری می‌گوید مبلغ از حسابش کسر شده ولی پایانه رسید نداده و کالا تحویل نشده است.", "complaint", "pos", "medium"],
  ["پرسش دربارهٔ گزارش تسویهٔ ماهانه", "ستون «کارمزد» در گزارش تسویهٔ ماهانه با محاسبهٔ ما یکی نیست.", "question", "pos", null],
  ["فعال‌سازی کاربر تازه در بانکداری اینترنتی شرکتی", "برای مدیر مالی تازه، کاربر با سطح امضای دوم تعریف شود.", "request", "cib", null],
  ["خطای بارگذاری فایل پرداخت گروهی حقوق", "فایل حقوق این ماه با خطای «شمارهٔ حساب نامعتبر در سطر ۱۲۰» رد شد.", "problem", "payroll", null],
  ["پیشنهاد گزارش تفکیکی تسویه به تفکیک شعبهٔ پذیرنده", "برای فروشگاه‌های زنجیره‌ای گزارش تسویه به تفکیک هر شعبه کار تطبیق را آسان می‌کند.", "suggestion", "pos", null],
  ["شکایت از پاسخ دیرهنگام پشتیبانی تلفنی پذیرندگان", "دو بار تماس گرفتیم و بیش از بیست دقیقه پشت خط ماندیم.", "complaint", "pos", "low"],
  ["سفارش گروهی کارت هدیه برای کارکنان", "صد کارت هدیه با مبلغ یکسان برای مناسبت پایان سال لازم است.", "request", "gift", null],
  ["قطع پرداخت با کارت‌های بی‌تماس در پایانه‌های تازه", "پایانه‌های تازه‌نصب پرداخت بی‌تماس را نمی‌پذیرند.", "problem", "pos", null],
];

/**
 * Customer service for the bank's merchants and corporate clients: accounts (each gets its company unit from the
 * module), contacts, products, support contracts and entitlements by tier, the installed base of POS terminals (the
 * pack's own POS assets), cases of every kind with complaints among them — the entitlement resolved at intake by the
 * module — an escalation on the strategic merchant's complaint and a notice about the card switch outage.
 */
export async function stepCsm(a: StepArgs, sys: Ctx): Promise<boolean> {
  const { orgId, memo } = a;
  const rng = stepRng(memo, "csm", memo.seed + 59);
  const now = Date.now();
  const size = DEMO_SIZES[memo.size];
  const group = memo.groups.csm ?? memo.groups.card;
  const owner = memo.people.personas.csm ?? memo.people.personas.manager;
  return phased(a, "csm", ["accounts", "cases", "escalation"], async (phase) => {
    const accounts = listOf(memo, "csm_accounts");
    const contacts = listOf(memo, "csm_contacts");
    if (phase === "accounts") {
      await sys.write(async (tx) => {
        const products: Record<string, string> = {};
        for (const [key, name, family, desc] of PRODUCTS) {
          const p = await put(tx, sys, "customer_product", { name, code: `PRD-${key.toUpperCase()}`, family, support_group_id: group, owner_id: owner, description: desc });
          products[key] = String(p.id);
        }
        memo.units["csm:products"] = JSON.stringify(products);
        bump(memo, "customer_product", PRODUCTS.length);
        const pos = await tx.query<{ id: string; asset_tag: string; serial_number: string | null; location_id: string | null }>(
          `select a.id, a.asset_tag, a.serial_number, a.location_id from sm_assets a where a.org_id = $1 and a.category = 'pos' and a.deleted_at is null
             and exists (select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id = a.id) order by a.asset_tag limit 40`,
          [orgId],
        );
        let posAt = 0;
        for (const [i, acc] of ACCOUNTS.entries()) {
          const row = await put(tx, sys, "customer_account", {
            name: acc.name, code: acc.code, kind: "customer", segment: acc.segment, tier: acc.tier, relationship_type: acc.tier === "strategic" ? "partnership" : acc.tier === "gold" ? "cooperative" : "basic",
            email_domain: acc.domain, city: acc.city, website: `https://www.${acc.domain}`, relationship_manager_id: owner, support_group_id: group,
            notes: acc.merchant ? "پذیرندهٔ نمایشی بانک: پایانه‌های فروش و تسویهٔ روزانه" : "مشتری حقوقی نمایشی بانک",
          });
          accounts.push(String(row.id));
          // contacts: the primary, a finance contact and (for large accounts) a technical one
          const n = acc.segment === "enterprise" ? 3 : 2;
          let primary: string | null = null;
          for (let c = 0; c < n; c++) {
            const name = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
            const roles = c === 0 ? ["customer", "user", "admin"] : c === 1 ? ["billing", "user"] : ["technical", "user"];
            const contact = await put(tx, sys, "customer_contact", { name, account_id: row.id, email: `contact${c + 1}@${acc.domain}`, job_title: c === 0 ? "مدیر مالی" : c === 1 ? "کارشناس حسابداری" : "مسئول فناوری اطلاعات", roles, is_primary: c === 0, preferred_channel: c === 2 ? "portal" : "email" });
            if (c === 0) {
              primary = String(contact.id);
              contacts.push(primary);
            }
            bump(memo, "customer_contact");
          }
          const contract = await put(tx, sys, "customer_contract", {
            name: `قرارداد پشتیبانی ${acc.merchant ? "پذیرندگی" : "خدمات الکترونیک"} — ${acc.name}`, account_id: row.id, status: "active",
            starts_on: dateOnly(now - (150 + i * 10) * DAY), ends_on: dateOnly(now + (215 - i * 10) * DAY),
            products: acc.products.map((p) => products[p]).filter(Boolean), value: String((acc.tier === "strategic" ? 4_800 : acc.tier === "gold" ? 2_400 : 900) * 1_000_000), owner_id: owner,
            terms: "پاسخ‌گویی در ساعات کاری بانک؛ پشتیبانی تلفنی و درگاه؛ بازدید محل برای پایانه‌های فروش.",
          });
          const level = LEVEL_OF[acc.tier] ?? "standard";
          await put(tx, sys, "entitlement", {
            name: `پشتیبانی ${level === "enterprise" ? "سازمانی" : level === "premium" ? "ویژه" : level === "standard" ? "استاندارد" : "پایه"} — ${acc.name}`, account_id: row.id, contract_id: contract.id,
            support_level: level, channels: ["portal", "email", "phone", ...(acc.merchant ? ["onsite"] : [])], response_hours: level === "enterprise" ? 1 : level === "premium" ? 2 : 8, resolution_hours: level === "enterprise" ? 8 : level === "premium" ? 24 : 72,
            starts_on: dateOnly(now - (150 + i * 10) * DAY), ends_on: dateOnly(now + (215 - i * 10) * DAY), unit_type: acc.tier === "bronze" ? "cases" : "none", units_total: acc.tier === "bronze" ? "20" : undefined, warn_percent: 80, state: "active",
          });
          // the installed base: the merchant's POS terminals (the pack's own POS assets)
          if (acc.merchant) {
            for (let k = 0; k < (acc.tier === "strategic" ? 6 : 3) && posAt < pos.length; k++, posAt++) {
              const asset = pos[posAt];
              await put(tx, sys, "install_base_item", { name: `پایانهٔ فروش ${asset.asset_tag}`, account_id: row.id, product_id: products.pos, serial_no: asset.serial_number, asset_ref: asset.asset_tag, location_id: asset.location_id, contact_id: primary, installed_on: dateOnly(now - rng.int(60, 600) * DAY), warranty_end: dateOnly(now + rng.int(30, 400) * DAY), quantity: 1, status: "active" });
              bump(memo, "install_base_item");
            }
          }
        }
        bump(memo, "customer_account", ACCOUNTS.length);
        bump(memo, "customer_contract", ACCOUNTS.length);
        bump(memo, "entitlement", ACCOUNTS.length);
      });
    } else if (phase === "cases") {
      const products = JSON.parse(memo.units["csm:products"] ?? "{}") as Record<string, string>;
      const agents = [...agentsOf(memo, "csm", 10), ...(owner ? [owner] : [])];
      const closeCode = choose("customer_case", "close_code", ["solved"]);
      for (let at = Number(memo.units["csm:at"] ?? 0); at < size.cases; at += 20) {
        if (Date.now() > a.deadline) {
          memo.units["csm:at"] = String(at);
          return false;
        }
        await sys.write(async (tx) => {
        for (let i = at; i < Math.min(size.cases, at + 20); i++) {
          const [title, detail, type, product, severity] = CASES[i % CASES.length];
          // a case of the product's customers
          const fits = ACCOUNTS.map((acc, k) => ({ acc, k })).filter((x) => x.acc.products.includes(product));
          const pick = fits.length ? fits[i % fits.length] : { acc: ACCOUNTS[0], k: 0 };
          const account = accounts[pick.k];
          if (!account) continue;
          const opened = pastMoment(rng, now, 120);
          const age = (now - opened) / DAY;
          const state = age > 30 ? (rng.chance(0.85) ? "closed" : "resolved") : age > 7 ? rng.pick(["resolved", "open", "awaiting_customer"]) : rng.pick(["new", "open", "open", "awaiting_internal"]);
          const done = state === "resolved" || state === "closed";
          const resolved = done ? Math.min(now - 60_000, opened + rng.int(2, 72) * 3600_000) : null;
          const ibi = product === "pos" ? (await tx.one<{ id: string }>(`select id from sm_install_base_items where org_id = $1 and account_id = $2 and deleted_at is null order by created_at limit 1`, [orgId, account]))?.id : undefined;
          const row = await putOpen(tx, sys, "customer_case", {
            short_description: i < CASES.length ? title : `${title} (${i + 1})`, description: detail, case_type: type, complaint: !!severity, complaint_severity: severity ?? undefined,
            account_id: account, contact_id: contacts[pick.k], product_id: products[product], ibi_id: ibi, channel: choose("customer_case", "channel", [rng.pick(["phone", "email", "portal"])]),
            priority: severity === "high" ? "2" : type === "problem" ? "3" : "4", impact: severity === "high" ? "2" : "3", urgency: severity === "high" ? "1" : "3",
            assignment_group_id: group, assigned_to: state === "new" ? undefined : rng.pick(agents), opened_at: iso(opened), state,
            resolved_at: resolved ? iso(resolved) : undefined, closed_at: state === "closed" && resolved ? iso(Math.min(now - 30_000, resolved + 3 * DAY)) : undefined,
            close_code: done ? closeCode : undefined, close_notes: done ? rng.pick(["پایانه با پیکربندی دوباره به میزبان وصل شد.", "مبلغ پس از تطبیق تراکنش‌ها به حساب مشتری برگشت.", "تسویه با تأیید ادارهٔ کارت و پرداخت انجام شد.", "راهنمایی لازم به مشتری داده شد."]) : undefined,
            root_cause: done && type !== "question" ? "پیکربندی نادرست پایانه پس از به‌روزرسانی نرم‌افزار" : undefined, satisfaction: done ? rng.pick([3, 4, 5, 5]) : undefined,
          }, { state: "open" });
          if (row) bump(memo, "customer_case");
        }
        });
        keepRng(memo, "csm", rng);
      }
      delete memo.units["csm:at"];
    } else if (phase === "escalation") {
      await sys.write(async (tx) => {
        // the strategic merchant's open complaint escalated with an executive sponsor
        const complaint = await tx.one<{ id: string }>(
          `select c.id from sm_customer_cases c where c.org_id = $1 and c.account_id = $2 and c.complaint and c.state not in ('resolved', 'closed', 'cancelled') and c.deleted_at is null order by c.opened_at limit 1`,
          [orgId, accounts[0]],
        );
        if (accounts[0] && (await tryPut(tx, sys, "case_escalation", {
          short_description: "تشدید: تأخیر تسویهٔ پایانه‌های فروشگاه‌های زنجیره‌ای", reason: "customer_request", case_id: complaint?.id, account_id: accounts[0], severity: "high",
          owner_id: owner, executive_sponsor_id: memo.people.personas.manager, cadence: "daily", next_update_at: iso(now + DAY), requested_by: owner, state: "active",
          plan: "۱. تطبیق تراکنش‌های سه روز گذشته با ادارهٔ کارت و پرداخت\n۲. واریز دستی مانده‌ها تا پایان امروز\n۳. گزارش روزانه به مدیر مالی پذیرنده تا پایداری کامل",
        }))) bump(memo, "case_escalation");
        // a notice to the merchants about the card switch outage (a draft awaiting approval)
        const major = memo.incidents[memo.incidents.length - 1];
        const merchants = ACCOUNTS.map((x, k) => (x.merchant ? accounts[k] : null)).filter((x): x is string => !!x);
        if (merchants.length && (await tryPut(tx, sys, "customer_notice", {
          title: "اختلال تراکنش‌های کارتی و اثر آن بر تسویهٔ پذیرندگان", regulation: "major_incident", incident_id: major, accounts: merchants, channels: ["in_app", "email"], owner_id: owner, state: "draft",
          body: "پذیرندهٔ گرامی، امروز از ساعت ۱۰:۱۲ تراکنش‌های کارتی با اختلال روبه‌رو شد. تراکنش‌های ناموفق از حساب مشتریان کسر نشده است و تسویهٔ تراکنش‌های موفق طبق روال انجام می‌شود. (اطلاع‌رسانی نمایشی)",
        }))) bump(memo, "customer_notice");
      });
    }
  }, rng);
}

// ----- the departments' services (ESM) ---------------------------------------------------------------------------------

/** Requests of the departments: [table, service code, title, description, extra values]. */
const ESM_CASES: [string, string, string, string, Record<string, unknown>][] = [
  ["facility_request", "fac_maintenance", "تعمیر کولر گازی سالن مشتریان", "کولر سالن انتظار شعبه از دیروز آب می‌چکاند و خنک نمی‌کند.", { request_type: "maintenance" }],
  ["facility_request", "fac_maintenance", "خرابی درب کرکره‌ای ورودی خودپرداز", "کرکرهٔ اتاقک خودپرداز بیرونی نیمه‌باز گیر کرده است.", { request_type: "maintenance" }],
  ["facility_request", "fac_cleaning", "نظافت پس از بازسازی باجهٔ شمارهٔ ۲", "گرد و غبار کار بنایی روی میزها و دستگاه شمارش اسکناس مانده است.", { request_type: "cleaning" }],
  ["facility_request", "fac_access_card", "کارت تردد کارمند تازهٔ شعبه", "کارمند تازه از شنبه در شعبه کار می‌کند و کارت تردد ندارد.", { request_type: "access_card" }],
  ["facility_request", "fac_desk", "جابه‌جایی میز کارشناس اعتبارات", "میز کارشناس اعتبارات برای دسترسی بهتر مشتریان به طبقهٔ همکف منتقل شود.", { request_type: "move" }],
  ["finance_case", "fin_payment", "پیگیری پرداخت صورتحساب نگهداری خودپردازها — فصل دوم", "صورتحساب فصل دوم پیمانکار نگهداری هنوز پرداخت نشده است.", { case_kind: "invoice", amount: "4625000000", currency: "IRR", invoice_no: "INV-1405-0218", vendor_name: "شرکت نمونهٔ خدمات خودپرداز پارس" }],
  ["finance_case", "fin_expense", "بازپرداخت هزینهٔ مأموریت بازرسی شعب استان فارس", "هزینهٔ اقامت و ایاب‌وذهاب سه روز مأموریت بازرسی شعب.", { case_kind: "expense_claim", amount: "86000000", currency: "IRR" }],
  ["finance_case", "fin_vendor", "تعریف تأمین‌کنندهٔ تازه: شرکت نمونهٔ تجهیزات امنیتی", "برای خرید دوربین‌های شعب، تأمین‌کنندهٔ تازه تعریف شود.", { case_kind: "vendor_setup", vendor_name: "شرکت نمونهٔ تجهیزات امنیتی" }],
  ["legal_request", "legal_contract", "بررسی قرارداد نگهداری خودپردازها با شرکت نمونهٔ خدمات خودپرداز پارس", "پیش‌نویس تمدید قرارداد با بند جریمهٔ تازه برای زمان بازگرداندن.", { matter_type: "contract_review", counterparty: "شرکت نمونهٔ خدمات خودپرداز پارس", contract_value: "18500000000", privileged: true }],
  ["legal_request", "legal_advice", "مشاوره دربارهٔ مسئولیت بانک در کسر وجه بدون رسید", "پذیرنده‌ای مدعی است مشتریانش بدون رسید از حساب کسر شده‌اند؛ مسئولیت بانک چیست؟", { matter_type: "advice", privileged: true }],
  ["purchase_request", "proc_purchase", "خرید ۴۰ دستگاه چاپگر دفترچهٔ شعب", "جایگزینی چاپگرهای دفترچهٔ فرسودهٔ شعب منطقهٔ تهران بزرگ.", { items: "- ۴۰ دستگاه چاپگر دفترچه با رابط USB\n- ۴۰ نوار چاپ یدکی", amount: "6400000000", currency: "IRR", supplier: "شرکت نمونهٔ تجهیزات پایانهٔ فروش" }],
  ["purchase_request", "proc_purchase", "خرید قطعات یدکی خودپرداز (کارت‌خوان و تسمهٔ مخزن)", "موجودی قطعات یدکی انبار منطقه‌ای به نقطهٔ سفارش رسیده است.", { items: "- ۱۰ کارت‌خوان موتوری\n- ۲۰ تسمهٔ مخزن اسکناس", amount: "1250000000", currency: "IRR", supplier: "شرکت نمونهٔ خدمات خودپرداز پارس" }],
];

/**
 * The departments' services on the seeded departments: facilities requests from branches, the HSE log, meeting rooms
 * and their bookings, visitors, finance cases, privileged legal requests (in the secure legal workspace) and purchase
 * requests with separate requester and receiver — each filed under the department's own service, so the module stamps
 * its department, workspace and group.
 */
export async function stepEsm(a: StepArgs, sys: Ctx): Promise<boolean> {
  const { orgId, memo } = a;
  const rng = stepRng(memo, "esm", memo.seed + 61);
  const now = Date.now();
  const s = scaleOf(memo);
  return phased(a, "esm", ["cases", "facilities"], async (phase) => {
    if (phase === "cases") {
      const services = new Map((await sys.db.query<{ id: string; code: string }>(`select id, code from sm_esm_services where org_id = $1 and deleted_at is null`, [orgId])).map((r) => [r.code, r.id]));
      await sys.write(async (tx) => {
        for (let round = 0; round < s; round++) {
          for (const [i, [table, code, title, detail, extra]] of ESM_CASES.entries()) {
            if (!tableDef(table)) continue;
            const service = services.get(code);
            const n = round * ESM_CASES.length + i;
            const who = memo.people.employees[(n * 7) % Math.max(1, memo.people.employees.length)] ?? memo.people.personas.requester;
            const branch = memo.branches[(n * 3) % Math.max(1, memo.branches.length)];
            const opened = pastMoment(rng, now, 90);
            const age = (now - opened) / DAY;
            const state = age > 20 ? "closed_complete" : age > 5 ? rng.pick(["resolved", "in_progress", "closed_complete"]) : rng.pick(["new", "in_progress", "awaiting_info"]);
            const done = state === "resolved" || state === "closed_complete";
            const values: Record<string, unknown> = {
              short_description: round ? `${title} (${round + 1})` : title, description: detail, dept_service_id: service ?? undefined, caller_id: who, requested_for: who,
              location_id: table === "facility_request" ? branch?.location : undefined, opened_at: iso(opened), state,
              resolved_at: done ? iso(Math.min(now - 60_000, opened + rng.int(4, 96) * 3600_000)) : undefined,
              closed_at: state === "closed_complete" ? iso(Math.min(now - 30_000, opened + 5 * DAY)) : undefined,
              close_code: done ? "solved" : undefined, close_notes: done ? "انجام شد و به درخواست‌کننده اعلام شد." : undefined, ...extra,
            };
            // separation of duties: the receiver of a purchase is the branch's asset officer, never its requester
            if (table === "purchase_request") values.receiver_id = memo.itam?.officers[memo.branches[0]?.unit ?? ""] ?? memo.people.personas.branch;
            if (table === "finance_case") values.cost_center_id = memo.units["cc:itb"];
            if (table === "purchase_request") values.cost_center_id = memo.units["cc:itb"];
            if (await putOpen(tx, sys, table, values, { state: "in_progress" })) bump(memo, table);
          }
        }
        // the HSE log: a near miss and an unsafe condition in branches
        for (const [title, type, detail] of [["لغزندگی کف ورودی شعبه پس از باران", "near_miss", "یکی از مشتریان روی سرامیک خیس ورودی لیز خورد ولی آسیبی ندید."], ["قفسهٔ بایگانی بدون مهار به دیوار", "unsafe_condition", "قفسهٔ فلزی بلند بایگانی اسناد شعبه به دیوار مهار نشده است."]] as const) {
          const who = memo.people.employees[rng.int(0, Math.max(0, memo.people.employees.length - 1))];
          if (!tableDef("hse_event")) break;
          if (await putOpen(tx, sys, "hse_event", { short_description: title, description: detail, event_type: type, occurred_at: iso(now - rng.int(2, 30) * DAY), caller_id: who, requested_for: who, location_id: memo.branches[rng.int(0, Math.max(0, memo.branches.length - 1))]?.location, immediate_action: "محل با تابلوی هشدار جدا شد.", state: "in_progress" }, { state: "new" })) bump(memo, "hse_event");
        }
      });
    } else if (phase === "facilities") {
      if (!tableDef("space")) return;
      const hq = memo.units.hq_location;
      if (!hq) return;
      await sys.write(async (tx) => {
        const spaces: string[] = [];
        for (const [name, kind, cap, attrs] of [["اتاق جلسات کمیتهٔ تغییرات (طبقهٔ چهارم ستاد)", "meeting_room", 14, ["ویدئوپروژکتور", "ویدئوکنفرانس"]], ["سالن همایش ستاد مرکزی", "hall", 120, ["سامانهٔ صوتی", "ویدئوپروژکتور"]], ["اتاق آموزش کارکنان شعب (طبقهٔ دوم)", "meeting_room", 24, ["رایانه", "تخته"]], ["خودروی پشتیبانی میدانی تهران", "vehicle", 4, []]] as const) {
          const sp = await tryPut(tx, sys, "space", { name, code: `SP-${pad(spaces.length + 1)}`, kind, location_id: hq, capacity: cap, attributes: [...attrs], bookable: true, requires_approval: kind === "hall", max_hours: kind === "vehicle" ? 10 : 8, description: "فضای نمایشی ستاد" });
          if (sp) spaces.push(String(sp.id));
        }
        bump(memo, "space", spaces.length);
        const at = (days: number, hour: number) => {
          const d = new Date(now + days * DAY);
          d.setUTCHours(hour - 3, 30, 0, 0);
          return d.getTime();
        };
        const bookings: [number, string, number, number, number, string, string[]][] = [
          [0, "جلسهٔ هفتگی کمیتهٔ تغییرات", 1, 10, 2, "confirmed", ["av"]],
          [2, "آموزش سامانهٔ تبادل تصویر چک برای کارکنان شعب", 3, 9, 3, "confirmed", ["catering", "av"]],
          [1, "همایش سالانهٔ رؤسای شعب منطقهٔ تهران بزرگ", 9, 9, 6, "requested", ["catering", "av", "setup"]],
          [0, "بازبینی پس از رخداد عمدهٔ سوئیچ کارت", -6, 11, 2, "completed", []],
          [3, "بازدید فنی خودپردازهای شعب غرب تهران", 1, 8, 8, "confirmed", []],
        ];
        for (const [sp, title, day, hour, hours, state, svc] of bookings) {
          if (!spaces[sp]) continue;
          const from = at(day, hour);
          if (await tryPut(tx, sys, "reservation", { title, space_id: spaces[sp], start_at: iso(from), end_at: iso(from + hours * 3600_000), attendees: sp === 1 ? 90 : 10, booked_for: memo.people.personas.change ?? memo.people.personas.manager, services: svc.length ? svc : undefined, state })) bump(memo, "reservation");
        }
        for (const [k, [name, company, purpose, state]] of ([
          ["نمایندهٔ فنی پیمانکار نگهداری", "شرکت نمونهٔ خدمات خودپرداز پارس", "جلسهٔ بازبینی تعهد نگهداری خودپردازها", "expected"],
          ["کارشناس ممیزی امنیت", "مؤسسهٔ نمونهٔ ممیزی امنیت داده", "ممیزی سالانهٔ امنیت داده‌های کارت", "checked_out"],
          ["مدیر فروش", "شرکت نمونهٔ تجهیزات پایانهٔ فروش", "معرفی پایانه‌های فروش تازه", "expected"],
        ] as const).entries()) {
          if (!tableDef("visit")) break;
          const when = now + (state === "checked_out" ? -3 : k + 1) * DAY;
          if (await tryPut(tx, sys, "visit", { visitor_name: name, visitor_company: company, host_id: k === 1 ? memo.people.personas.soc ?? memo.people.personas.manager : memo.people.personas.assets ?? memo.people.personas.manager, site_id: hq, expected_at: iso(when), expected_until: iso(when + 2 * 3600_000), purpose, requires_nda: k === 1, nda_ack: state === "checked_out", safety_ack: state === "checked_out", checked_in_at: state === "checked_out" ? iso(when) : undefined, checked_out_at: state === "checked_out" ? iso(when + 90 * 60_000) : undefined, badge_no: state === "checked_out" ? `V-${pad(k + 101)}` : undefined, state })) bump(memo, "visit");
        }
      });
    }
  }, rng);
}

// ----- field service ------------------------------------------------------------------------------------------------

/** Rough centres of the regions (their main city), for territories and technicians' home points. */
const REGION_CENTRES: Record<string, [number, number]> = {
  "تهران بزرگ": [35.6892, 51.389],
  "شمال و شمال‌غرب": [38.0962, 46.2738],
  شرق: [36.2972, 59.6067],
  مرکز: [32.6539, 51.666],
  "جنوب و جنوب‌غرب": [29.5918, 52.5837],
  غرب: [34.3142, 47.065],
};

const FIELD_TEMPLATES: { key: string; name: string; work_type: string; minutes: number; checklist: Row[]; parts: Row[]; safety: string }[] = [
  {
    key: "jam", name: "رفع گیر کردن اسکناس در خودپرداز", work_type: "repair", minutes: 60,
    checklist: [
      { key: "cash_secured", label: "وجه نقد کاست‌ها با حضور مسئول شعبه شمارش و صورت‌جلسه شد", type: "bool", required: true },
      { key: "path_clean", label: "مسیر عبور اسکناس تمیز و تسمه بازبینی شد", type: "bool", required: true },
      { key: "test_tx", label: "سه تراکنش آزمایشی موفق انجام شد", type: "bool", required: true },
    ],
    parts: [{ name: "تسمهٔ مخزن اسکناس", code: "ATM-BELT-500", quantity: 1 }],
    safety: "دستگاه را پیش از باز کردن از سرویس خارج کنید؛ کاست‌ها فقط با حضور مسئول شعبه جابه‌جا می‌شوند.",
  },
  {
    key: "pm", name: "سرویس دوره‌ای فصلی خودپرداز", work_type: "maintenance", minutes: 90,
    checklist: [
      { key: "clean", label: "تمیزکاری کارت‌خوان، دیسپنسر و چاپگر رسید", type: "bool", required: true },
      { key: "firmware", label: "نسخهٔ نرم‌افزار کنترل‌کننده بررسی شد", type: "bool", required: true },
      { key: "antiskim", label: "قطعهٔ ضد کپی کارت سالم است", type: "bool", required: true },
    ],
    parts: [],
    safety: "کار در اتاقک پشت دستگاه با چراغ و تهویهٔ روشن؛ کلید گاوصندوق نزد مسئول شعبه می‌ماند.",
  },
];

const WO_TEXTS = ["تعویض تسمهٔ مخزن اسکناس", "تعمیر کارت‌خوان", "سرویس دوره‌ای و تمیزکاری", "تعویض چاپگر رسید", "رفع گیر کردن اسکناس"];

/**
 * Field service for the ATM fleet: a territory per region with its dispatch group, technician profiles of the field
 * agents (skills, home point), the visit templates with their checklists, work orders over the last months with
 * their visits (done, scheduled, waiting for dispatch) and the parts they used or reserved, and quarterly preventive
 * maintenance plans whose first work orders the module's own generation makes.
 */
export async function stepField(a: StepArgs, sys: Ctx): Promise<boolean> {
  const { orgId, memo } = a;
  const size = DEMO_SIZES[memo.size];
  const rng = stepRng(memo, "field", memo.seed + 41);
  const now = Date.now();
  return phased(a, "field", ["setup", "orders", "plans"], async (phase) => {
    if (phase === "setup") {
      await sys.write(async (tx) => {
        for (const [i, r] of REGIONS.entries()) {
          const [lat, lng] = REGION_CENTRES[r] ?? [35.7, 51.4];
          const locations = memo.branches.filter((b) => b.region === r).map((b) => b.location).slice(0, 200);
          const t = await tryPut(tx, sys, "territory", { name: `قلمرو خدمات میدانی ${r}`, code: `TR-${i + 1}`, locations, dispatch_group_id: memo.regionGroups[r], center_lat: lat, center_lng: lng, radius_km: r === "تهران بزرگ" ? 60 : 250, description: "قلمرو نمایشی پشتیبانی خودپردازها" });
          if (!t) continue;
          memo.units[`territory:${r}`] = String(t.id);
          bump(memo, "territory");
          for (const [k, user] of agentsOf(memo, `field:${r}`, 10).entries()) {
            if (await tryPut(tx, sys, "technician", {
              user_id: user, territories: [t.id], dispatch_group_id: memo.regionGroups[r], max_tasks_per_day: 5, vehicle: "خودروی پشتیبانی میدانی", available: true,
              skills: [{ skill: "خودپرداز", level: 3 + (k % 2), expires_on: dateOnly(now + 300 * DAY) }, { skill: "چاپگر دفترچه", level: 2 }],
              certifications: [{ name: "گواهی نگهداری خودپرداز سطح ۲", expires_on: dateOnly(now + 300 * DAY) }],
              home_lat: Number((lat + (rng.next() - 0.5) / 10).toFixed(5)), home_lng: Number((lng + (rng.next() - 0.5) / 10).toFixed(5)),
            })) bump(memo, "technician");
          }
        }
        for (const tpl of FIELD_TEMPLATES) {
          const row = await tryPut(tx, sys, "wo_task_template", { name: tpl.name, work_type: tpl.work_type, required_skills: ["خودپرداز"], est_work_minutes: tpl.minutes, checklist: tpl.checklist, parts: tpl.parts, safety: tpl.safety, instructions: "گزارش کار و امضای مسئول شعبه پیش از ترک محل الزامی است." });
          if (row) memo.units[`wo_tpl:${tpl.key}`] = String(row.id);
        }
      });
    } else if (phase === "orders") {
      const atms = await sys.db.query<{ asset_tag: string; branch_id: string; location_id: string | null }>(
        `select a.asset_tag, a.branch_id, a.location_id from sm_assets a where a.org_id = $1 and a.category in ('atm', 'crs') and a.deleted_at is null and a.branch_id is not null
           and exists (select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id = a.id) order by a.asset_tag limit 400`,
        [orgId],
      );
      let made = 0;
      for (let i = Number(memo.units["field:at"] ?? 0); i < size.visits; i += 8) {
        if (Date.now() > a.deadline) {
          memo.units["field:at"] = String(i);
          bump(memo, "work_order", made);
          return false;
        }
        await sys.write(async (tx) => {
          for (let j = i; j < Math.min(size.visits, i + 8); j++) {
            const atm = atms.length ? atms[j % atms.length] : null;
            const b = (atm && memo.branches.find((x) => x.unit === atm.branch_id)) ?? rng.pick(memo.branches);
            const opened = pastMoment(rng, now, 240);
            const done = (now - opened) / DAY > 7;
            const pending = !done && j % 3 === 0;
            const techs = agentsOf(memo, `field:${b.region}`, 10);
            const tech = techs.length ? techs[j % techs.length] : undefined;
            const text = WO_TEXTS[j % WO_TEXTS.length];
            const jam = text.includes("گیر") || text.includes("تسمه");
            const wo = await putOpen(tx, sys, "work_order", {
              short_description: `${text} — ${b.name}`, description: `دستگاه ${atm?.asset_tag ?? ""} ${b.name}`, symptoms: jam ? "پیام خطای مخزن و توقف پرداخت" : "خطای دستگاه در گزارش پایش",
              location_id: atm?.location_id ?? b.location, assignment_group_id: memo.regionGroups[b.region], territory_id: memo.units[`territory:${b.region}`], asset_ref: atm?.asset_tag,
              // a finished order's visit is written as it ended (below); an open one gets the template's first visit
              template_id: done ? undefined : memo.units[`wo_tpl:${jam ? "jam" : "pm"}`], opened_at: iso(opened), priority: jam ? "2" : "3",
              work_type: choose("work_order", "work_type", [jam ? "repair" : "maintenance"]),
              state: done ? "closed_complete" : pending ? "qualification" : "scheduled",
              closed_at: done ? iso(Math.min(now - 30_000, opened + 2 * DAY)) : undefined, close_code: done ? "solved" : undefined, close_notes: done ? "دستگاه آزمایش و به سرویس برگشت." : undefined,
            }, { state: "scheduled" });
            if (!wo) continue;
            made++;
            const start = done ? opened + rng.int(2, 20) * 3600_000 : now + rng.int(1, 5) * DAY;
            const travel = rng.int(15, 70);
            const work = rng.int(35, 110);
            let task: { id: string } | null = null;
            if (done && tech) {
              // the visit as it ended: dispatched, travelled, worked, checklist answered and signed by the branch
              task = await tryPut(tx, sys, "wo_task", {
                short_description: text, work_order_id: wo.id, template_id: memo.units[`wo_tpl:${jam ? "jam" : "pm"}`], technician_id: tech, assignment_group_id: memo.regionGroups[b.region],
                scheduled_start: iso(start), scheduled_end: iso(start + 2 * 3600_000), dispatched_at: iso(start - 3600_000), accepted_at: iso(start - 3000_000), en_route_at: iso(start - travel * 60_000),
                arrived_at: iso(start), completed_at: iso(start + work * 60_000), travel_minutes: travel, work_minutes: work,
                checklist_answers: { cash_secured: true, path_clean: true, test_tx: true, clean: true, firmware: true, antiskim: true }, resolution: "قطعه تعویض و سه تراکنش آزمایشی موفق انجام شد.",
                signer_name: "رئیس شعبه", signed_at: iso(start + (work + 5) * 60_000), state: "closed",
              }) as { id: string } | null;
            } else {
              // the template's first visit, as far as it went: waiting for dispatch, or assigned (and accepted)
              task = await tx.one<{ id: string }>(`select id from sm_wo_tasks where org_id = $1 and work_order_id = $2 and deleted_at is null order by created_at limit 1`, [orgId, wo.id]);
              if (task && pending) await savepoint(tx, () => updateIn(tx, sys, "wo_task", task!.id, { window_start: iso(start), window_end: iso(start + 8 * 3600_000) }, { trusted: true })).catch((e: unknown) => refuse(orgId, "field.task", e));
              else if (task && tech) {
                await savepoint(tx, async () => {
                  await updateIn(tx, sys, "wo_task", task!.id, { technician_id: tech, scheduled_start: iso(start), scheduled_end: iso(start + 2 * 3600_000), state: "assigned" }, { trusted: true });
                  if (j % 2) await updateIn(tx, sys, "wo_task", task!.id, { state: "accepted" }, { trusted: true });
                }).catch((e: unknown) => refuse(orgId, "field.task", e));
              }
            }
            if (!task) continue;
            if (jam) {
              if (await tryPut(tx, sys, "parts_requirement", { part_name: "تسمهٔ مخزن اسکناس", part_code: "ATM-BELT-500", quantity: "1", wo_task_id: task.id, stockroom: "انبار منطقه‌ای", state: done ? "consumed" : "reserved", defective_returned: done })) bump(memo, "parts_requirement");
            }
          }
        });
        keepRng(memo, "field", rng);
      }
      delete memo.units["field:at"];
      bump(memo, "work_order", made);
    } else if (phase === "plans") {
      // quarterly preventive maintenance of each region's ATMs; the module generates the occurrences due now
      if (!memo.units["wo_tpl:pm"]) return;
      await sys.write(async (tx) => {
        for (const [i, r] of REGIONS.entries()) {
          const branch = memo.branches.find((b) => b.region === r);
          if (!branch) continue;
          if (await tryPut(tx, sys, "maintenance_plan", {
            name: `سرویس فصلی خودپردازهای منطقهٔ ${r}`, status: "active", generates: "work_order", location_id: branch.location, template_id: memo.units["wo_tpl:pm"], group_id: memo.regionGroups[r], territory_id: memo.units[`territory:${r}`],
            every_n: 3, interval_unit: "month", lead_days: 7, horizon: 1, next_due: dateOnly(now + (2 + i) * DAY), priority: "4",
            description: "سرویس دوره‌ای کارت‌خوان، دیسپنسر و چاپگر رسید خودپردازهای منطقه (برنامهٔ نمایشی)",
          })) bump(memo, "maintenance_plan");
        }
        const n = await generateMaintenanceIn(tx, sys);
        bump(memo, "work_order", n);
      });
    }
  }, rng);
}

// ----- monitoring events -------------------------------------------------------------------------------------------

/**
 * Monitoring of the card switch and the branch network through the event module's own pipeline: a Zabbix source of the
 * pack, its deliveries normalised as the endpoint does and each event processed by the pipeline inside the demo scope
 * — CI binding by host name, alerts and their repeats, correlation on the service map, a cleared alert, and the
 * critical one turned into an incident by the seeded rule «هشدار بحرانی ← رخداد».
 */
export async function stepEvents({ orgId, memo }: StepArgs, sys: Ctx): Promise<boolean> {
  if (!tableDef("event_source")) return true;
  const now = Date.now();
  const sevMap = { disaster: "critical", high: "major", average: "minor", warning: "warning", information: "info", "not classified": "info" };
  const src = await sys.write((tx) => tryPut(tx, sys, "event_source", {
    name: "پایش خودپردازها و سوئیچ کارت (Zabbix نمایشی)", kind: "zabbix", active: true, assignment_group_id: memo.groups.card, service_id: memo.services.switch,
    default_severity: "minor", severity_map: sevMap, heartbeat_minutes: 0, rate_limit: 600, description: "رسانهٔ وب‌هوک Zabbix سرورهای سوئیچ کارت، HSM و مسیریاب‌های شعب (منبع نمایشی؛ بدون کلید دریافت)",
  }));
  if (!src) return true;
  bump(memo, "event_source");
  const router = memo.branches.length > 2 ? `aft-br-${1002}` : null;
  // [minutes ago, host, trigger id, trigger name, severity, status, value]
  const deliveries: [number, string | null, string, string, string, string, number | null][] = [
    [95, "aft-switch-01", "7101", "Card switch response time above 2s", "high", "PROBLEM", 2.4],
    [90, "aft-switch-02", "7102", "Card switch response time above 2s", "high", "PROBLEM", 2.1],
    [80, "aft-hsm-01", "7201", "HSM command latency above 300ms", "average", "PROBLEM", 340],
    [70, "aft-switch-01", "7101", "Card switch response time above 2s", "high", "PROBLEM", 3.2],
    [60, "aft-switch-01", "7103", "Card switch transaction failure rate above 30%", "disaster", "PROBLEM", 41],
    [40, "aft-hsm-01", "7201", "HSM command latency above 300ms", "average", "OK", 120],
    [30, router, "7301", `Router ${router ?? ""} is unreachable`, "high", "PROBLEM", null],
    [12, "aft-dc-01", "7401", "Core switch port utilisation above 85%", "warning", "PROBLEM", 88],
  ];
  const spec: SourceSpec = { kind: "zabbix", severity_map: sevMap, default_severity: "minor", mapping: {} };
  let n = 0;
  for (const [k, [ago, host, trigger, name, severity, status, value]] of deliveries.entries()) {
    if (!host) continue;
    const at = now - ago * 60_000;
    const events = normalize(spec, { event_id: String(900_000 + k), trigger_id: trigger, host, trigger_name: name, severity, status, item_value: value, timestamp: Math.floor(at / 1000), tags: ["بانک", "نمایشی"] }).events;
    for (const e of events) {
      try {
        await sys.write(async (tx) => {
          const row = await createIn(tx, sys, "event", {
            message: e.message, description: e.description, source_id: src.id, status: e.status, severity: e.severity, node: e.node, resource: e.resource, metric: e.metric,
            value: e.value === null ? null : String(e.value), tags: e.tags, occurred_at: e.occurred_at, received_at: iso(at + 2000),
            fingerprint: fingerprintOf(String(src.id), e), dedupe_key: e.dedupe_hint ?? null, assignment_group_id: memo.groups.card ?? null, outcome: "pending",
            decision: { hints: { ci: e.ci_hint, service: e.service_hint } }, payload: e.payload,
          }, { trusted: true });
          await processEvent(tx, sys, row, undefined, at + 3000);
        });
        n++;
      } catch (err) {
        refuse(orgId, "events.process", err);
      }
    }
  }
  bump(memo, "event", n);
  const alerts = await sys.db.one<{ n: number }>(`select count(*)::int as n from sm_alerts where org_id = $1 and source_id = $2 and deleted_at is null`, [orgId, src.id]);
  bump(memo, "alert", alerts?.n ?? 0);
  return true;
}

// ----- continuity and GRC -------------------------------------------------------------------------------------------

const H = 3600;

/** The bank's own control framework (its requirements and controls are the pack's; the seeded frameworks stay as they are). */
const BANK_REQUIREMENTS: [code: string, title: string][] = [
  ["ATM-01", "به‌روزرسانی امنیتی سیستم‌عامل و نرم‌افزار خودپردازها"],
  ["ATM-02", "پاک‌سازی امن دیسک دستگاه‌های اسقاطی"],
  ["CARD-01", "جداسازی شبکهٔ خودپردازها و سوئیچ کارت"],
  ["CARD-02", "تفکیک وظایف در تولید و بارگذاری کلیدهای HSM"],
  ["OPS-01", "پشتیبان‌گیری روزانه و آزمون بازیابی کربنکینگ"],
  ["OPS-02", "آزمون سالانهٔ جابه‌جایی به سایت پشتیبان"],
  ["IAM-01", "بازبینی فصلی دسترسی‌های ممتاز کربنکینگ"],
];

const CONTROLS: { code: string; name: string; type: string; nature: string; frequency: string; cia: string[]; reqs: string[]; status: string; objective: string }[] = [
  { code: "AFT-C01", name: "بازبینی فصلی دسترسی ممتاز به کربنکینگ", type: "detective", nature: "manual", frequency: "quarterly", cia: ["confidentiality", "integrity"], reqs: ["IAM-01"], status: "implemented", objective: "هر فصل فهرست کاربران ممتاز کربنکینگ با مالکان واحدها تطبیق و دسترسی‌های زائد برداشته می‌شود." },
  { code: "AFT-C02", name: "پشتیبان‌گیری روزانه و آزمون ماهانهٔ بازیابی پایگاه دادهٔ کربنکینگ", type: "corrective", nature: "automated", frequency: "monthly", cia: ["availability", "integrity"], reqs: ["OPS-01"], status: "implemented", objective: "پشتیبان کامل شبانه و بازیابی آزمایشی ماهانه در محیط جداگانه." },
  { code: "AFT-C03", name: "به‌روزرسانی امنیتی ماهانهٔ خودپردازها", type: "preventive", nature: "hybrid", frequency: "monthly", cia: ["confidentiality", "integrity", "availability"], reqs: ["ATM-01"], status: "partial", objective: "وصله‌های امنیتی در پنجرهٔ نگهداری پنجشنبه‌شب روی همهٔ خودپردازها نصب می‌شود؛ دستگاه‌های ویندوز ۷ تا اسقاط استثنا ثبت دارند." },
  { code: "AFT-C04", name: "پاک‌سازی امن دیسک با شاهد پیش از اسقاط", type: "preventive", nature: "manual", frequency: "continuous", cia: ["confidentiality"], reqs: ["ATM-02"], status: "implemented", objective: "پاک‌سازی به روش Purge با گواهی، انجام‌دهنده، شاهد و بازبین جدا." },
  { code: "AFT-C05", name: "جداسازی شبکهٔ خودپردازها با دیوارهٔ آتش", type: "preventive", nature: "automated", frequency: "continuous", cia: ["confidentiality", "integrity"], reqs: ["CARD-01"], status: "implemented", objective: "خودپردازها فقط به سوئیچ کارت و سرور پایش دسترسی دارند." },
  { code: "AFT-C06", name: "حضور دو امین کلید در تولید کلیدهای HSM", type: "preventive", nature: "manual", frequency: "semiannual", cia: ["confidentiality", "integrity"], reqs: ["CARD-02"], status: "implemented", objective: "تولید و بارگذاری کلید فقط با دو امین کلید و صورت‌جلسهٔ امضاشده." },
  { code: "AFT-C07", name: "آزمون جابه‌جایی کربنکینگ به سایت پشتیبان", type: "corrective", nature: "manual", frequency: "annual", cia: ["availability"], reqs: ["OPS-02"], status: "implemented", objective: "جابه‌جایی کامل در پنجرهٔ آخر هفته و بازگشت، با سنجش زمان بازیابی در برابر هدف." },
];

const RISKS: { title: string; category: string; cause: string; event: string; consequence: string; li: string; ii: string; lr: string; ir: string; controls: string[]; treatment: string; state: string; services: string[] }[] = [
  { title: "توقف طولانی سوئیچ کارت در ساعات اوج", category: "availability", cause: "تک‌نقطهٔ خرابی در صف پیام سوئیچ", event: "قطع تراکنش‌های کارتی همهٔ شعب و پایانه‌ها", consequence: "زیان مالی، شکایت پذیرندگان و جریمهٔ نظارتی", li: "3", ii: "5", lr: "2", ir: "5", controls: ["AFT-C05"], treatment: "reduce", state: "treating", services: ["switch", "atm", "pos"] },
  { title: "نشت داده‌های کارت از خودپردازهای ویندوز ۷", category: "security", cause: "پایان پشتیبانی سیستم‌عامل و نبود وصله", event: "سوءاستفاده از آسیب‌پذیری شناخته‌شده", consequence: "افشای اطلاعات کارت و جریمهٔ انطباق", li: "3", ii: "4", lr: "2", ir: "4", controls: ["AFT-C03", "AFT-C04"], treatment: "reduce", state: "treatment_planned", services: ["atm"] },
  { title: "وابستگی به یک پیمانکار نگهداری خودپرداز", category: "supplier", cause: "قرارداد انحصاری نگهداری", event: "توقف خدمات پیمانکار", consequence: "افزایش زمان از کارافتادگی خودپردازها", li: "2", ii: "4", lr: "2", ir: "3", controls: [], treatment: "share", state: "assessed", services: ["atm"] },
  { title: "باج‌افزار در شبکهٔ شعب", category: "security", cause: "ایمیل فیشینگ و دسترسی گستردهٔ شبکه", event: "رمزگذاری رایانه‌های باجه", consequence: "توقف خدمات شعب", li: "3", ii: "4", lr: "2", ir: "3", controls: ["AFT-C02"], treatment: "reduce", state: "monitoring", services: ["teller", "wan"] },
  { title: "خطای انسانی در تغییرهای اضطراری کربنکینگ", category: "operational", cause: "فشار زمانی و آزمون ناکافی", event: "اجرای تغییر نادرست در ساعات کاری", consequence: "کندی یا توقف خدمات باجه", li: "3", ii: "3", lr: "2", ir: "3", controls: ["AFT-C01"], treatment: "reduce", state: "treating", services: ["core", "teller"] },
];

/**
 * Continuity and GRC: business impact analyses and recovery plans of the core banking system and the card switch with
 * their steps, a failover exercise with results and a planned tabletop, the year's outages and capacity records; the
 * bank's own control framework with its controls and their tests, the risk register with treatment actions and a key
 * risk indicator, and a published ATM security policy.
 */
export async function stepContinuityGrc(a: StepArgs, sys: Ctx): Promise<boolean> {
  const { orgId, memo } = a;
  const now = Date.now();
  const owner = memo.people.personas.grc ?? memo.people.personas.manager;
  return phased(a, "continuity", ["continuity", "outages", "controls", "risks"], async (phase) => {
    if (phase === "continuity") {
      if (!tableDef("bia")) return;
      await sys.write(async (tx) => {
        const impacts = (worst: number) => ({
          financial: { h1: Math.min(4, worst - 1), h4: worst, d1: 4, d3: 4, w1: 4 },
          operational: { h1: worst - 1, h4: worst, d1: 4, d3: 4, w1: 4 },
          regulatory: { h1: 1, h4: 2, d1: 3, d3: 4, w1: 4 },
          reputational: { h1: 2, h4: 3, d1: 4, d3: 4, w1: 4 },
          customer: { h1: worst - 1, h4: worst, d1: 4, d3: 4, w1: 4 },
          safety: { h1: 0, h4: 0, d1: 0, d3: 1, w1: 1 },
        });
        const plans: string[] = [];
        for (const [svc, title, rto, rpo, worst, plan, steps] of [
          ["core", "سامانهٔ کربنکینگ (متمرکز)", 4 * H, 15 * 60, 3, "طرح بازیابی کربنکینگ در سایت پشتیبان", [["اعلام وضعیت و فعال‌سازی تیم بحران", "مدیر بحران", 15], ["توقف ورود تراکنش در شعب و اطلاع‌رسانی", "مدیر عملیات شعب", 30], ["جابه‌جایی پایگاه داده به رونوشت سایت پشتیبان", "سرپرست پایگاه داده", 90], ["راه‌اندازی سرورهای برنامه و آزمون دود", "سرپرست کربنکینگ", 150], ["بازگشایی باجه‌ها و پایش", "مدیر عملیات شعب", 210], ["گزارش به مدیریت و نهاد ناظر", "مدیر ریسک", 240]]],
          ["switch", "سوئیچ کارت و شبکهٔ خودپردازها", 2 * H, 5 * 60, 4, "طرح بازیابی سوئیچ کارت", [["فعال‌سازی گره دوم سوئیچ", "کشیک کارت و خودپرداز", 10], ["تخلیهٔ صف پیام‌ها و تطبیق تراکنش‌های معلق", "سرپرست سوئیچ", 40], ["حالت «فقط برداشت» خودپردازها", "مدیر کارت و پرداخت", 60], ["بازگشت به حالت عادی و گزارش", "مدیر کارت و پرداخت", 120]]],
        ] as const) {
          if (!memo.services[svc]) continue;
          const bia = await tryPut(tx, sys, "bia", { title: `تحلیل اثر توقف ${title}`, service_id: memo.services[svc], owner_id: owner, respondent_id: memo.people.personas.manager, assignment_group_id: memo.groups[svc === "core" ? "core" : "card"], vital: true, impacts: impacts(worst), tolerance: 3, mtpd: rto * 2, rto, rpo, mbco: "پرداخت نقدی شعب و انتقال وجه فوری مشتریان حقوقی", depends_services: [memo.services.dc, memo.services.wan].filter(Boolean), review_due: dateOnly(now + 200 * DAY), state: "approved", approved_at: iso(now - 40 * DAY), approved_by: owner });
          if (!bia) continue;
          bump(memo, "bia");
          const p = await tryPut(tx, sys, "continuity_plan", {
            title: plan, plan_type: "drp", service_id: memo.services[svc], bia_id: bia.id, sites: [memo.units.hq_location].filter(Boolean), owner_id: owner, assignment_group_id: memo.groups.dc, rto, rpo, version_label: "2.1",
            invocation_criteria: "- توقف بیش از ۳۰ دقیقه بدون برآورد بازگشت\n- خرابی هم‌زمان هر دو گره خوشه\n- دستور مدیر بحران", return_to_normal: "بازگشت در نخستین پنجرهٔ آخر هفته با تأیید کمیتهٔ تغییرات و تطبیق کامل داده‌ها.",
            review_months: 12, last_reviewed_at: dateOnly(now - 90 * DAY), state: "approved", approved_at: iso(now - 80 * DAY),
          });
          if (!p) continue;
          plans.push(String(p.id));
          bump(memo, "continuity_plan");
          for (const [seq, [stepTitle, role, offset]] of steps.entries()) await tryPut(tx, sys, "plan_step", { plan_id: p.id, seq: seq + 1, title: stepTitle, role, rto_offset_minutes: offset, owner_id: seq === 0 ? owner : undefined });
        }
        if (plans[0]) {
          const participants = [owner, memo.people.personas.manager, ...agentsOf(memo, "dc", 2), ...agentsOf(memo, "core", 2)].filter((x): x is string => !!x);
          if (await tryPut(tx, sys, "exercise", { title: "مانور جابه‌جایی کربنکینگ به سایت پشتیبان — نیمهٔ نخست سال", plan_id: plans[0], exercise_type: "failover", scheduled_at: iso(now - 45 * DAY), started_at: iso(now - 45 * DAY), ended_at: iso(now - 45 * DAY + 5 * 3600_000), owner_id: owner, assignment_group_id: memo.groups.dc, participants, scenario: "خرابی کامل تالار سرور مرکز داده در پنجرهٔ آخر هفته", objectives: "بازیابی کربنکینگ در کمتر از چهار ساعت با از دست رفتن دادهٔ کمتر از پانزده دقیقه", rto_target: 4 * H, rpo_target: 15 * 60, actual_recovery: 3 * H + 40 * 60, actual_data_loss: 6 * 60, result: "passed", findings: "زمان راه‌اندازی سرورهای برنامه بیش از برآورد بود.", lessons: "اسکریپت راه‌اندازی خودکار سرورهای برنامه نوشته شود.", state: "closed" })) bump(memo, "exercise");
          if (await tryPut(tx, sys, "exercise", { title: "مانور میزگرد قطعی سوئیچ کارت", plan_id: plans[1] ?? plans[0], exercise_type: "tabletop", scheduled_at: iso(now + 20 * DAY), owner_id: owner, assignment_group_id: memo.groups.card, participants, scenario: "خرابی گره اصلی سوئیچ کارت در ساعت اوج پایان ماه", objectives: "آزمودن تصمیم‌گیری و اطلاع‌رسانی به پذیرندگان", state: "planned" })) bump(memo, "exercise");
        }
        for (const [name, svc, metric, unit, capacity, used] of [["فضای ذخیره‌ساز مرکزی", "dc", "storage_used", "ترابایت", "480", "391"], ["ظرفیت تراکنش سوئیچ کارت", "switch", "tps", "تراکنش در ثانیه", "1200", "860"], ["پهنای باند خط اصلی مرکز داده", "wan", "bandwidth", "مگابیت بر ثانیه", "2000", "1420"]] as const) {
          if (memo.services[svc] && (await tryPut(tx, sys, "capacity_record", { name, kind: "technical", service_id: memo.services[svc], metric, unit, capacity, utilisation: used, warning_pct: "80", critical_pct: "90", lead_time_days: 45, owner_id: owner, assignment_group_id: memo.groups.dc, notes: "رکورد ظرفیت نمایشی" }))) bump(memo, "capacity_record");
        }
      });
    } else if (phase === "outages") {
      if (!tableDef("outage")) return;
      await sys.write(async (tx) => {
        for (const [svc, title, type, daysAgo, minutes, impact, cause] of [
          ["core", "کندی کربنکینگ در پایان ماه", "degradation", 25, 95, "40", "capacity"],
          ["ibank", "نگهداری برنامه‌ریزی‌شدهٔ بانکداری اینترنتی", "planned", 18, 120, "100", "change"],
          ["atm", "قطع ارتباط خودپردازهای استان خوزستان", "outage", 40, 70, "15", "network"],
          ["mbank", "خطای ورود بانکداری همراه پس از به‌روزرسانی", "degradation", 9, 150, "30", "software"],
          ["switch", "توقف کوتاه سوئیچ کارت", "outage", 60, 22, "100", "hardware"],
        ] as const) {
          if (!memo.services[svc]) continue;
          const begin = now - daysAgo * DAY;
          if (await tryPut(tx, sys, "outage", { title, outage_type: type, service_id: memo.services[svc], owner_id: memo.people.personas.manager, assignment_group_id: memo.groups[SERVICES.find((x) => x.key === svc)?.group ?? "dc"], begin_at: iso(begin), end_at: iso(begin + minutes * 60_000), impact_pct: impact, affected_users: type === "planned" ? 0 : 1200, cause, cause_detail: "شرح نمایشی علت قطعی", state: "validated" })) bump(memo, "outage");
        }
      });
    } else if (phase === "controls") {
      if (!tableDef("grc_control")) return;
      await sys.write(async (tx) => {
        const fw = await tryPut(tx, sys, "grc_framework", { name: "الزامات امنیتی کارت، خودپرداز و تداوم بانک (نمونه)", key: "aftab_bank_controls", kind: "internal", edition: "1405", publisher: BANK_NAME, description: "بستهٔ الزامات داخلی نمایشی بانک برای کارت، خودپرداز، دسترسی و تداوم" });
        if (!fw) return;
        bump(memo, "grc_framework");
        const reqs: Record<string, string> = {};
        for (const [i, [code, title]] of BANK_REQUIREMENTS.entries()) {
          const r = await tryPut(tx, sys, "grc_requirement", { framework_id: fw.id, code, title, level: 1, sort_order: (i + 1) * 10, applicable: true, owner_id: owner });
          if (r) reqs[code] = String(r.id);
        }
        const controls: Record<string, string> = {};
        for (const c of CONTROLS) {
          const row = await tryPut(tx, sys, "grc_control", { name: c.name, code: c.code, objective: c.objective, owner_id: owner, assignment_group_id: memo.groups.soc, type: c.type, nature: c.nature, frequency: c.frequency, cia: c.cia, requirements: c.reqs.map((r) => reqs[r]).filter(Boolean), implementation_status: c.status, indicator: "none", test_procedure: "نمونه‌گیری از سوابق دوره و بررسی شواهد" });
          if (row) controls[c.code] = String(row.id);
        }
        bump(memo, "grc_control", Object.keys(controls).length);
        memo.units["grc:controls"] = JSON.stringify(controls);
        for (const [code, kind, conclusion, exceptions, state] of [["AFT-C01", "operating", "effective", 0, "completed"], ["AFT-C02", "operating", "effective", 0, "completed"], ["AFT-C03", "operating", "partially_effective", 3, "completed"], ["AFT-C06", "design", null, 0, "planned"], ["AFT-C07", "operating", "effective", 0, "completed"]] as const) {
          if (!controls[code]) continue;
          if (await tryPut(tx, sys, "grc_control_test", { control_id: controls[code], kind, tester_id: owner, assignment_group_id: memo.groups.soc, planned_for: dateOnly(now + (state === "planned" ? 15 : -30) * DAY), period_start: dateOnly(now - 120 * DAY), period_end: dateOnly(now - 30 * DAY), population: 120, sample_size: 25, exceptions, procedure: "بررسی نمونه‌ای سوابق دوره", result_notes: exceptions ? "سه خودپرداز ویندوز ۷ بدون وصلهٔ ماه گذشته" : "همهٔ نمونه‌ها مطابق بود", conclusion: conclusion ?? undefined, state })) bump(memo, "grc_control_test");
        }
        if (await tryPut(tx, sys, "grc_policy", { title: "خط‌مشی امنیت خودپردازها و پایانه‌های فروش", kind: "policy", version_label: "1.2", classification: "internal", owner_id: owner, approver_id: memo.people.personas.manager, effective_at: dateOnly(now - 60 * DAY), next_review_at: dateOnly(now + 300 * DAY), summary: "قواعد وصله، پاک‌سازی، جداسازی شبکه و نگهداری کلید دستگاه‌های پرداخت", body: "## دامنه\nهمهٔ خودپردازها، دستگاه‌های بازیافت پول و پایانه‌های فروش بانک.\n\n## قواعد\n1. وصله‌های امنیتی هر ماه در پنجرهٔ نگهداری نصب می‌شود.\n2. دیسک دستگاه پیش از اسقاط با روش Purge و در حضور شاهد پاک می‌شود.\n3. خودپردازها فقط به سوئیچ کارت و سرور پایش راه دارند.\n4. کلیدهای HSM فقط با حضور دو امین کلید تولید و بارگذاری می‌شوند.", requirements: Object.values(reqs).slice(0, 4), state: "published" })) bump(memo, "grc_policy");
      });
    } else if (phase === "risks") {
      if (!tableDef("grc_risk")) return;
      const controls = JSON.parse(memo.units["grc:controls"] ?? "{}") as Record<string, string>;
      await sys.write(async (tx) => {
        const risks: string[] = [];
        for (const r of RISKS) {
          const row = await tryPut(tx, sys, "grc_risk", {
            title: r.title, category: r.category, cause: r.cause, event: r.event, consequence: r.consequence, owner_id: owner, reporter_id: owner, assignment_group_id: memo.groups.soc,
            services: r.services.map((s) => memo.services[s]).filter(Boolean), inherent_likelihood: r.li, inherent_impact: r.ii, controls: r.controls.map((c) => controls[c]).filter(Boolean),
            control_effectiveness: r.controls.length ? "moderate" : "none", residual_likelihood: r.lr, residual_impact: r.ir, target_likelihood: "1", target_impact: r.ir,
            treatment: r.treatment, review_due: dateOnly(now + 60 * DAY), treatment_plan: "برنامهٔ درمان نمایشی با مالک و موعد", state: r.state,
          });
          if (row) risks.push(String(row.id));
        }
        bump(memo, "grc_risk", risks.length);
        for (const [k, [title, state, days]] of ([["افزودن گره سوم و صف پیام دوگانه به سوئیچ کارت", "in_progress", 45], ["اسقاط خودپردازهای ویندوز ۷ باقی‌مانده", "open", 90], ["عقد قرارداد نگهداری با پیمانکار دوم", "open", 120], ["آموزش شناسایی فیشینگ برای کارکنان شعب", "done", -10]] as const).entries()) {
          if (!risks[k]) continue;
          if (await tryPut(tx, sys, "grc_risk_action", { title, risk_id: risks[k], owner_id: owner, assignment_group_id: memo.groups.soc, notes: `موعد: ${days > 0 ? `${days} روز دیگر` : "انجام شد"}`, state })) bump(memo, "grc_risk_action");
        }
        if (risks[4] && (await tryPut(tx, sys, "grc_kri", { name: "سهم تغییرهای تأییدشده پیش از اجرا", risk_id: risks[4], indicator: "change_approved", direction: "lower_worse", warn_at: "95", breach_at: "90", owner_id: owner, assignment_group_id: memo.groups.soc }))) bump(memo, "grc_kri");
      });
    }
  });
}

// ----- release, DevOps and projects ---------------------------------------------------------------------------------

/**
 * Delivery: the bank's releases in different phases (a mobile banking major release in readiness, a core banking
 * security patch deployed and in early life support, an ATM software rollout being deployed) with their tasks,
 * deployments across the environments, defects, release notes and a feature flag; a self-hosted Git connection with
 * repositories, pipelines, builds, commits and merge requests naming the releases, and technical debt; the digital
 * transformation portfolio with demands, projects, their plans (phases, tasks, milestones), RAID items, resource
 * allocations, time entries and a published status report.
 */
export async function stepDelivery(a: StepArgs, sys: Ctx): Promise<boolean> {
  const { orgId, memo } = a;
  const rng = stepRng(memo, "delivery", memo.seed + 67);
  const now = Date.now();
  const rm = memo.people.personas.release ?? memo.people.personas.change;
  const pm = memo.people.personas.pm ?? memo.people.personas.manager;
  return phased(a, "delivery", ["releases", "devops", "projects"], async (phase) => {
    const envs = new Map((await sys.db.query<{ id: string; key: string; kind: string }>(`select id, key, kind from sm_release_environments where org_id = $1 and deleted_at is null`, [orgId])).map((r) => [r.kind, r.id]));
    if (phase === "releases") {
      if (!tableDef("release")) return;
      const rels = listOf(memo, "releases");
      for (const r of [
        { text: "بانکداری همراه نسخهٔ ۵.۲ — ورود با چهره و انتقال کارت به کارت تازه", version: "5.2.0", type: "major", svc: "mbank", group: "ebank", state: "readiness", start: 6, end: 9 },
        { text: "وصلهٔ امنیتی کربنکینگ ۱۲.۴.۱", version: "12.4.1", type: "patch", svc: "core", group: "core", state: "els", start: -9, end: -8 },
        { text: "نرم‌افزار خودپردازها نسخهٔ ۳.۸ — پشتیبانی پرداخت بی‌تماس", version: "3.8.0", type: "minor", svc: "atm", group: "card", state: "deploying", start: -2, end: 12 },
        { text: "بانکداری اینترنتی نسخهٔ ۷.۱ — صورت‌حساب تازه", version: "7.1.0", type: "minor", svc: "ibank", group: "ebank", state: "closed", start: -60, end: -58 },
      ]) {
        if (!memo.services[r.svc]) continue;
        const row = await sys.write((tx) => putOpen(tx, sys, "release", {
          short_description: r.text, version_name: r.version, type: r.type, service_id: memo.services[r.svc], affected_services: [memo.services[r.svc]], assignment_group_id: memo.groups[r.group], assigned_to: personOf(memo, r.group, rng), release_manager_id: rm,
          planned_start: iso(now + r.start * DAY), planned_end: iso(now + r.end * DAY), opened_at: iso(now + (r.start - 30) * DAY), actual_start: r.start < 0 ? iso(now + r.start * DAY) : undefined, actual_end: r.state === "closed" || r.state === "els" ? iso(now + r.end * DAY) : undefined,
          els_days: r.state === "els" ? 14 : undefined, build_plan: "ساخت در خط لولهٔ نسخه با آزمون واحد و پوشش ۸۰ درصد", test_plan: "آزمون یکپارچه در محیط آزمون و پذیرش کاربر با نمایندگان شعب", deployment_plan: r.svc === "atm" ? "استقرار مرحله‌ای ۲۰ دستگاه در هر شب" : "استقرار آبی‌سبز در پنجرهٔ پنجشنبه‌شب", rollback_plan: "بازگشت به نسخهٔ پیشین با اسکریپت آزموده‌شده در کمتر از ۳۰ دقیقه",
          communication_plan: "اطلاعیهٔ درگاه برای کارکنان و پیامک به مشتریان پیش از استقرار", release_notes: r.state === "closed" ? "صورت‌حساب تازه با پالایهٔ تاریخ و خروجی اکسل." : undefined, state: r.state,
          close_code: r.state === "closed" ? "successful" : undefined, closed_at: r.state === "closed" ? iso(now + (r.end + 14) * DAY) : undefined, close_notes: r.state === "closed" ? "بدون رخداد در دورهٔ پشتیبانی آغازین" : undefined,
        }, { state: "planning" }));
        if (!row) continue;
        rels.push(String(row.id));
        bump(memo, "release");
        await sys.write(async (tx) => {
          const done = ["els", "closed", "deploying"].includes(r.state);
          // (a closed release takes no new tasks: its history is its deployments and notes)
          for (const [k, [title, ph]] of (r.state === "closed" ? [] :  ([["ساخت نسخه و امضای بسته", "build"], ["آزمون یکپارچه و پذیرش کاربر", "test"], ["یادداشت انتشار و آموزش میز خدمت", "communication"], ["آماده‌سازی استقرار و برنامهٔ بازگشت", "deploy"]] as const)).entries()) {
            const st = done || (r.state === "readiness" && k < 2) ? "done" : k === 2 ? "in_progress" : "open";
            if (await tryPut(tx, sys, "release_task", { short_description: title, release_id: row.id, phase: ph, mandatory: true, sort_order: (k + 1) * 10, assignment_group_id: memo.groups[r.group], assigned_to: personOf(memo, r.group, rng), planned_hours: String(rng.int(4, 24)), state: st })) bump(memo, "release_task");
          }
          // deployments up the pipeline (test, UAT, production as far as the release went)
          const stages: [string, string][] = r.state === "readiness" ? [["test", "succeeded"], ["uat", "succeeded"]] : r.state === "deploying" ? [["test", "succeeded"], ["uat", "succeeded"], ["production", "in_progress"]] : [["test", "succeeded"], ["uat", "succeeded"], ["production", "succeeded"]];
          for (const [kind, st] of stages) {
            const env = envs.get(kind) ?? envs.get(kind === "uat" ? "staging" : kind);
            if (!env) continue;
            const at = now + (r.start - (kind === "test" ? 6 : kind === "uat" ? 3 : 0)) * DAY;
            const dep = await tryPut(tx, sys, "deployment", { short_description: `استقرار ${r.version} در ${kind === "test" ? "آزمون" : kind === "uat" ? "پذیرش کاربر" : "عملیاتی"}`, release_id: row.id, environment_id: env, service_id: memo.services[r.svc], approach: r.svc === "atm" ? "phased" : kind === "production" ? "blue_green" : "big_bang", artifact_version: r.version, assignment_group_id: memo.groups[r.group], release_manager_id: rm, planned_start: iso(at), planned_end: iso(at + 3 * 3600_000), actual_start: iso(at), actual_end: st === "succeeded" ? iso(at + 2 * 3600_000) : undefined, verification: st === "succeeded" ? "passed" : "not_run", rollout_pct: r.svc === "atm" && st === "in_progress" ? "35" : undefined, state: st });
            if (dep) bump(memo, "deployment");
          }
          if (r.state === "readiness" || r.state === "deploying") {
            for (const [title, sev, st] of [["نمایش نادرست مانده پس از انتقال کارت به کارت", "high", "fixed"], ["کندی ورود با چهره روی گوشی‌های قدیمی", "medium", "in_progress"], ["برچسب انگلیسی در صفحهٔ رسید", "low", "deferred"]] as const) {
              if (await tryPut(tx, sys, "defect", { short_description: title, release_id: row.id, severity: sev, service_id: memo.services[r.svc], found_in_env: envs.get("uat") ?? envs.get("test"), assignment_group_id: memo.groups[r.group], steps: "۱. ورود به برنامه\n۲. انجام تراکنش\n۳. مشاهدهٔ خطا", fix_version: r.version, state: st })) bump(memo, "defect");
            }
          }
          if (await tryPut(tx, sys, "release_note", { release_id: row.id, title: `یادداشت انتشار ${r.version} برای کارکنان شعب`, audience: "end_users", language: "fa", state: r.state === "closed" || r.state === "els" ? "published" : "draft", body: `## تازه‌های ${r.version}\n- ${r.text.split("—")[1]?.trim() ?? r.text}\n- رفع چند خطای گزارش‌شده از شعب\n\nپرسش‌ها را از میز خدمت بپرسید.` })) bump(memo, "release_note");
        });
      }
      await sys.write(async (tx) => {
        if (memo.services.mbank && (await tryPut(tx, sys, "feature_flag", { key: "mbank.face_login", name: "ورود با چهره در بانکداری همراه", service_id: memo.services.mbank, release_id: rels[0], owner_id: rm, state: "partial", rollout_pct: "10", segments: ["کارکنان بانک", "مشتریان آزمایشی"], description: "عرضهٔ تدریجی ورود با چهره (پرچم نمایشی)" }))) bump(memo, "feature_flag");
      });
    } else if (phase === "devops") {
      if (!tableDef("devops_connection")) return;
      await sys.write(async (tx) => {
        const conn = await tryPut(tx, sys, "devops_connection", { name: "GitLab درون‌سازمانی بانک (نمایشی)", kind: "gitlab", base_url: `https://git.${BANK_DOMAIN}`, principal: "کاربر سرویس خط لوله", service_id: memo.services.mbank, assignment_group_id: memo.groups.ebank, auto_change: false, close_changes: true, gate_timeout_minutes: 60, description: "اتصال نمایشی؛ بدون راز و بدون وب‌هوک فعال" });
        if (!conn) return;
        bump(memo, "devops_connection");
        const rels = listOf(memo, "releases");
        for (const [k, [name, svc, group, branch]] of ([["mobile-banking-app", "mbank", "ebank", "main"], ["core-banking-adapter", "core", "core", "release/12.4"], ["atm-agent", "atm", "card", "main"]] as const).entries()) {
          if (!memo.services[svc]) continue;
          const repo = await tryPut(tx, sys, "dev_repository", { name, connection_id: conn.id, url: `https://git.${BANK_DOMAIN}/bank/${name}`, default_branch: branch, visibility: "private", service_id: memo.services[svc], owner_group_id: memo.groups[group], external_id: `bank/${name}` });
          if (!repo) continue;
          bump(memo, "dev_repository");
          const pipeline = await tryPut(tx, sys, "dev_pipeline", { name: `${name} — ساخت و استقرار`, connection_id: conn.id, repository_id: repo.id, service_id: memo.services[svc], environments: [envs.get("test"), envs.get("uat"), envs.get("production")].filter(Boolean), external_id: `bank/${name}:ci` });
          const relNo = rels[k] ? (await tx.one<{ number: string | null }>(`select number from sm_releases where id = $1`, [rels[k]]))?.number ?? null : null;
          for (let c = 0; c < 4; c++) {
            const sha = `${(0xa1b2c3 + k * 977 + c * 131).toString(16)}${pad(c, 2)}${"0f4e9d2c7b6a5f8e1d3c".slice(0, 30)}`.slice(0, 40);
            const at = now - (4 - c) * 2 * DAY;
            await tryPut(tx, sys, "dev_commit", { sha, repository_id: repo.id, message: `${relNo ? `${relNo}: ` : ""}${["رفع خطای نمایش مانده", "افزودن آزمون یکپارچه", "به‌روزرسانی کتابخانهٔ رمزنگاری", "بهینه‌سازی پرس‌وجوی گزارش"][c]}`, author_name: `${FIRST_NAMES[(k * 4 + c) % FIRST_NAMES.length]} ${LAST_NAMES[(k * 3 + c) % LAST_NAMES.length]}`, author_email: `dev${k}${c}@${BANK_DOMAIN}`, committed_at: iso(at), branch, keys: relNo ? [relNo] : [] });
            if (pipeline) await tryPut(tx, sys, "dev_build", { run_number: String(1200 + k * 40 + c), pipeline_id: pipeline.id, connection_id: conn.id, repository_id: repo.id, status: c === 1 && k === 2 ? "failed" : "succeeded", branch, commit_sha: sha, started_at: iso(at + 600_000), finished_at: iso(at + 600_000 + (8 + c) * 60_000), duration: (8 + c) * 60, tests_total: 420 + c * 12, tests_failed: c === 1 && k === 2 ? 3 : 0, coverage: String(78 + c), url: `https://git.${BANK_DOMAIN}/bank/${name}/-/pipelines/${1200 + k * 40 + c}`, keys: relNo ? [relNo] : [] });
          }
          bump(memo, "dev_commit", 4);
          bump(memo, "dev_build", pipeline ? 4 : 0);
          if (await tryPut(tx, sys, "dev_pull_request", { title: `${relNo ? `${relNo}: ` : ""}ادغام شاخهٔ ویژگی ${name}`, pr_number: 300 + k, repository_id: repo.id, state: k === 0 ? "open" : "merged", author: `${FIRST_NAMES[k + 3]} ${LAST_NAMES[k + 5]}`, source_branch: `feature/${name}-${k + 1}`, target_branch: branch, merged_at: k === 0 ? undefined : iso(now - 3 * DAY), url: `https://git.${BANK_DOMAIN}/bank/${name}/-/merge_requests/${300 + k}`, keys: relNo ? [relNo] : [] })) bump(memo, "dev_pull_request");
          if (await tryPut(tx, sys, "tech_debt", { title: ["کتابخانهٔ قدیمی رمزنگاری در برنامهٔ همراه", "پرس‌وجوهای بدون نمایه در گزارش پایان ماه کربنکینگ", "وابستگی عامل خودپرداز به XFS نسخهٔ ۳.۲۰"][k], service_id: memo.services[svc], repository_id: repo.id, cause: (["dependency", "architecture", "bit_rot"] as const)[k], interest: (["high", "medium", "medium"] as const)[k], principal_hours: String([60, 120, 80][k]), owner_group_id: memo.groups[group], due_date: dateOnly(now + (60 + k * 30) * DAY), description: "بدهی فنی نمایشی با برنامهٔ پرداخت در دو نسخهٔ آینده", state: (["planned", "accepted", "identified"] as const)[k] })) bump(memo, "tech_debt");
        }
      });
    } else if (phase === "projects") {
      if (!tableDef("project")) return;
      await sys.write(async (tx) => {
        const pf = await tryPut(tx, sys, "portfolio", { name: "تحول دیجیتال بانک ۱۴۰۵", code: "PF-DT", owner_id: memo.people.personas.manager, manager_id: pm, budget: "250000000000", goals: "- کاهش ۳۰ درصدی خرابی خودپردازها\n- نوسازی کانال‌های الکترونیک\n- آمادگی سایت پشتیبان دوم" });
        if (pf) bump(memo, "portfolio");
        for (const [title, type, state, score] of [["پرداخت با کد QR در پایانه‌های فروش", "new_service", "submitted", 8], ["داشبورد لحظه‌ای وضعیت خودپردازها برای رؤسای شعب", "enhancement", "qualified", 6], ["خودکارسازی تطبیق تسویهٔ پذیرندگان", "project", "approved", 7], ["گفتگوی هوشمند پشتیبانی مشتریان", "idea", "screening", 5]] as const) {
          if (await tryPut(tx, sys, "demand", { title, type, submitted_by: memo.people.personas.requester, business_owner_id: memo.people.personas.manager, portfolio_id: pf?.id, org_unit_id: memo.units.CARD ?? memo.units.IT, problem: "شرح نیاز کسب‌وکار (نمایشی)", objectives: "کاهش زمان و هزینهٔ رسیدگی", risk: "medium", est_hours: String(score * 120), est_capex: String(score * 3_000_000_000), business_value: score, time_criticality: Math.max(1, score - 2), risk_reduction: 3, job_size: 5, state })) bump(memo, "demand");
        }
        const team = [...agentsOf(memo, "apps", 3), ...agentsOf(memo, "card", 2), ...agentsOf(memo, "dc", 2)];
        const projects: { name: string; code: string; type: string; state: string; start: number; end: number; budget: string; phases: [string, number, string][] }[] = [
          { name: "نوسازی ناوگان خودپرداز (ویندوز ۱۰ و پرداخت بی‌تماس)", code: "PRJ-ATM", type: "infrastructure", state: "executing", start: -120, end: 90, budget: "95000000000", phases: [["طراحی و انتخاب تأمین‌کننده", 30, "done"], ["آزمون آزمایشی در ۱۰ شعبه", 45, "done"], ["استقرار مرحله‌ای در مناطق", 100, "in_progress"], ["اسقاط دستگاه‌های قدیمی", 40, "open"]] },
          { name: "راه‌اندازی سایت پشتیبان دوم", code: "PRJ-DR2", type: "infrastructure", state: "planning", start: 20, end: 260, budget: "120000000000", phases: [["مطالعهٔ مکان و برآورد", 40, "in_progress"], ["تجهیز تالار سرور", 90, "open"], ["رونوشت هم‌زمان کربنکینگ", 60, "open"], ["مانور جابه‌جایی", 20, "open"]] },
          { name: "یکپارچه‌سازی درگاه پرداخت اینترنتی با سامانهٔ تطبیق", code: "PRJ-IPG", type: "application", state: "closing", start: -200, end: -10, budget: "18000000000", phases: [["تحلیل نیازها", 30, "done"], ["توسعه و آزمون", 100, "done"], ["استقرار و آموزش", 40, "done"]] },
        ];
        for (const [k, p] of projects.entries()) {
          const prj = await tryPut(tx, sys, "project", {
            name: p.name, code: p.code, type: p.type, methodology: "predictive", project_manager_id: pm, sponsor_id: memo.people.personas.manager, portfolio_id: pf?.id, team, org_unit_id: memo.units.IT,
            description: "پروژهٔ نمایشی سبد تحول دیجیتال", planned_start: dateOnly(now + p.start * DAY), planned_end: dateOnly(now + p.end * DAY), est_hours: String(4000 + k * 1500), budget: p.budget, actual_cost: p.state === "executing" ? String(Math.round(Number(p.budget) * 0.48)) : p.state === "closing" ? String(Math.round(Number(p.budget) * 0.97)) : "0",
            objectives: "تحویل به‌موقع در بودجه با کمترین اثر بر خدمات شعب", scope_in: "شعب و ستاد", scope_out: "شعب خارج از کشور", state: p.state,
          });
          if (!prj) continue;
          bump(memo, "project");
          let at = now + p.start * DAY;
          let prev: string | null = null;
          const taskIds: string[] = [];
          for (const [i, [title, days, st]] of p.phases.entries()) {
            const t = await tryPut(tx, sys, "project_task", { short_description: title, project_id: prj.id, kind: "task", sort_order: (i + 1) * 10, planned_start: dateOnly(at), planned_end: dateOnly(at + days * DAY), duration_days: days, depends_on: prev ? [prev] : [], est_hours: String(days * 12), pct_complete: st === "done" ? "100" : st === "in_progress" ? "45" : "0", assigned_to: team[i % Math.max(1, team.length)], state: st });
            if (!t) continue;
            taskIds.push(String(t.id));
            prev = String(t.id);
            at += days * DAY;
          }
          if (prev) await tryPut(tx, sys, "project_task", { short_description: "پایان پروژه و تحویل", project_id: prj.id, kind: "milestone", sort_order: 999, planned_start: dateOnly(at), planned_end: dateOnly(at), duration_days: 0, depends_on: [prev], state: p.state === "closing" ? "done" : "open" });
          bump(memo, "project_task", taskIds.length + 1);
          for (const [title, kind, prob, st] of [["تأخیر گمرک در ترخیص دستگاه‌ها", "risk", 3, "open"], ["هم‌زمانی استقرار با پایان سال مالی", "issue", 4, "active"], ["همهٔ شعب خط پشتیبان دارند", "assumption", 2, "monitoring"], ["استقرار شبانه با حضور مسئول شعبه", "decision", 1, "closed"]] as const) {
            if (await tryPut(tx, sys, "raid_item", { title, kind, project_id: prj.id, owner_id: pm, probability: prob, due_date: dateOnly(now + rng.int(5, 60) * DAY), description: "مورد RAID نمایشی", response: kind === "risk" ? "سفارش زودتر و انبار موقت منطقه‌ای" : undefined, state: st })) bump(memo, "raid_item");
          }
          for (const [i, user] of team.slice(0, 4).entries()) {
            if (await tryPut(tx, sys, "resource_allocation", { user_id: user, project_id: prj.id, role: i === 0 ? "تحلیل‌گر" : "کارشناس فنی", state: "confirmed", start_date: dateOnly(now + p.start * DAY), end_date: dateOnly(now + p.end * DAY), hours_per_week: String(8 + ((i + k) % 3) * 8) })) bump(memo, "resource_allocation");
          }
          if (p.state === "executing" && taskIds[2]) {
            for (let d = 1; d <= 5; d++) {
              if (await tryPut(tx, sys, "time_entry", { user_id: team[d % Math.max(1, team.length)], entry_date: dateOnly(now - d * DAY), hours: String(rng.int(2, 7)), task_id: taskIds[2], note: "استقرار خودپردازهای منطقه", state: d > 2 ? "approved" : "submitted" })) bump(memo, "time_entry");
            }
            if (await tryPut(tx, sys, "status_report", { title: `گزارش وضعیت ${p.name} — هفتهٔ گذشته`, project_id: prj.id, period_start: dateOnly(now - 7 * DAY), period_end: dateOnly(now - DAY), overall: "amber", schedule_rag: "amber", cost_rag: "green", scope_rag: "green", summary: "استقرار در منطقهٔ تهران بزرگ کامل شد؛ تأخیر ترخیص دستگاه‌های منطقهٔ شرق برنامه را دو هفته عقب انداخته است.", achievements: "- ۱۲۰ دستگاه تازه در سرویس\n- آموزش مسئولان اموال شعب", next_steps: "- استقرار منطقهٔ مرکز\n- آغاز اسقاط دستگاه‌های قدیمی", risks_issues: "تأخیر گمرک", state: "draft" })) bump(memo, "status_report");
          }
        }
      });
    }
  }, rng);
}

// ----- the requester portal -----------------------------------------------------------------------------------------

const PORTAL_LINKS: [name: string, path: string, desc: string, icon: string, section: string][] = [
  ["سامانهٔ کربنکینگ (نسخهٔ وب)", "core", "ورود به سامانهٔ متمرکز با حساب سازمانی", "landmark", "سامانه‌های بانکی"],
  ["پست الکترونیک سازمانی", "mail", "صندوق پست و تقویم کارکنان", "mail", "همکاری"],
  ["حضور و غیاب و مرخصی", "hr", "ثبت ورود و خروج و درخواست مرخصی", "clock", "کارکنان"],
  ["آموزش مجازی کارکنان", "lms", "دوره‌های الزامی و آزمون‌ها", "graduation-cap", "کارکنان"],
  ["گزارش‌های تسویهٔ پذیرندگان", "settlement", "گزارش روزانهٔ تسویهٔ پایانه‌های فروش", "file-spreadsheet", "سامانه‌های بانکی"],
  ["فهرست تلفن داخلی ستاد و شعب", "phonebook", "شمارهٔ داخلی واحدها و شعب", "phone", "همکاری"],
];

const SURVEY_ANSWERS: [rating: number, solved: string, comment: string | null][] = [
  [5, "yes", "کارشناس خیلی سریع آمد و دستگاه را راه انداخت."],
  [5, "yes", null],
  [4, "yes", "خوب بود ولی کمی دیر پاسخ دادند."],
  [4, "yes", null],
  [3, "yes", "مشکل حل شد اما دو بار پیگیری کردم."],
  [2, "no", "دستگاه دوباره همان خطا را داد."],
  [5, "yes", "سپاس از پیگیری میز خدمت."],
  [1, "no", "سه روز خودپرداز شعبه خاموش بود و کسی خبر نداد."],
];

/**
 * The requester portal: quick links to the bank's applications, topics with the catalogue items and articles of each
 * (the home page's featured items are the catalogue's own) — and the surveys: the branches' satisfaction survey and an
 * experience micro-survey of ATM repairs, sent to the callers of resolved incidents (the portal's own invitation, with
 * its in-app bell) and answered by them in the portal; each answer makes the SLM module rescore its incident's XLA.
 */
export async function stepPortal(a: StepArgs, sys: Ctx): Promise<boolean> {
  const { cfg, orgId, memo } = a;
  const s = scaleOf(memo);
  return phased(a, "portal", ["links", "surveys", "answers"], async (phase) => {
    if (phase === "links") {
      await sys.write(async (tx) => {
        const links: string[] = [];
        for (const [i, [name, path, desc, icon, section]] of PORTAL_LINKS.entries()) {
          const row = await tryPut(tx, sys, "portal_link", { name, url: `https://${path}.${BANK_DOMAIN}`, description: desc, icon, section_name: section, sort_order: (i + 1) * 10, new_tab: true, active: true });
          if (row) links.push(String(row.id));
        }
        bump(memo, "portal_link", links.length);
        const items = new Map((await tx.query<{ id: string; name: string }>(`select id, name from sm_catalog_items where org_id = $1 and deleted_at is null and state = 'published'`, [orgId])).map((r) => [r.name, r.id]));
        const articles = new Map((await tx.query<{ id: string; title: string }>(`select id, title from sm_kb_articles where org_id = $1 and deleted_at is null and state = 'published' and exists (select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id = sm_kb_articles.id)`, [orgId])).map((r) => [r.title, r.id]));
        const ids = (map: Map<string, string>, names: string[]) => names.map((n) => map.get(n)).filter((x): x is string => !!x);
        for (const [i, [name, icon, desc, its, arts, lnk]] of ([
          ["خودپرداز و پایانهٔ فروش", "credit-card", "خرابی خودپرداز، پایانهٔ فروش و کارت‌خوان شعبه", ["گزارش مشکل"], ["رفع گیر کردن اسکناس در خودپرداز"], [4]],
          ["حساب کاربری و دسترسی", "key-round", "گذرواژه، دسترسی کربنکینگ و VPN", ["بازنشانی گذرواژه", "درخواست دسترسی", "دسترسی VPN"], ["بازنشانی گذرواژهٔ کاربران شعبه", "اتصال به VPN سازمانی"], [0]],
          ["رایانه و چاپگر شعبه", "printer", "رایانه، چاپگر دفترچه و نرم‌افزار باجه", ["لپ‌تاپ جدید", "نصب نرم‌افزار"], ["رفع خطای چاپگر دفترچه"], []],
          ["امنیت و ایمیل مشکوک", "shield-alert", "گزارش فیشینگ و نکته‌های امنیتی", ["گزارش مشکل"], ["شناسایی ایمیل فیشینگ"], [1]],
          ["کارکنان تازه", "user-plus", "ورود کارمند تازه به شعبه", ["ورود کارمند جدید"], [], [2, 3]],
        ] as const).entries()) {
          if (await tryPut(tx, sys, "portal_topic", { name, icon, description: desc, sort_order: (i + 1) * 10, active: true, items: ids(items, [...its]), articles: ids(articles, [...arts]), links: lnk.map((k) => links[k]).filter(Boolean) })) bump(memo, "portal_topic");
        }
      });
    } else if (phase === "surveys") {
      await sys.write(async (tx) => {
        const csat = await tryPut(tx, sys, "survey", { name: "رضایت شعب از رسیدگی به گزارش‌ها", kind: "csat", active: true, anonymous: false, expires_days: 14, satisfied_from: 4, owner_group_id: memo.groups.desk, intro: "گزارش شعبهٔ شما رسیدگی شد؛ پاسخ به این سه پرسش کمتر از یک دقیقه وقت می‌گیرد.", thanks: "از نظرتان سپاسگزاریم؛ آن را به گروه رسیدگی‌کننده می‌رسانیم." });
        if (csat) {
          for (const [i, q] of [{ label: "چقدر از رسیدگی به گزارش شعبه راضی بودید؟", kind: "rating", metric: "csat", required: true }, { label: "مشکل کاملاً برطرف شد؟", kind: "yes_no", metric: "none", required: false }, { label: "چه چیزی را بهتر کنیم؟", kind: "text", metric: "none", required: false }].entries()) await tryPut(tx, sys, "survey_question", { survey_id: csat.id, sort_order: (i + 1) * 10, ...q });
          memo.units["survey:csat"] = String(csat.id);
          bump(memo, "survey");
        }
        const xla = await tryPut(tx, sys, "survey", { name: "تجربهٔ شعبه از رفع خرابی خودپرداز", kind: "xla", active: true, anonymous: false, expires_days: 7, satisfied_from: 4, owner_group_id: memo.groups.card, intro: "خودپرداز شعبهٔ شما دوباره در سرویس است؛ تجربه‌تان را در دو پرسش بگویید.", thanks: "سپاسگزاریم؛ پاسخ شما در شاخص تجربهٔ خدمت خودپرداز حساب می‌شود." });
        if (xla) {
          for (const [i, q] of [{ label: "از رفع این خرابی چقدر خوشحال بودید؟ (۰ تا ۱۰)", kind: "scale10", metric: "happiness", required: true }, { label: "به خاطر این خرابی حدوداً چند دقیقه کار شعبه ماند؟", kind: "minutes", metric: "lost_time", required: false }, { label: "نکتهٔ دیگری دارید؟", kind: "text", metric: "none", required: false }].entries()) await tryPut(tx, sys, "survey_question", { survey_id: xla.id, sort_order: (i + 1) * 10, ...q });
          memo.units["survey:xla"] = String(xla.id);
          bump(memo, "survey");
        }
      });
    } else if (phase === "answers") {
      const csat = memo.units["survey:csat"];
      const xla = memo.units["survey:xla"];
      if (!csat) return;
      // resolved incidents of the pack whose callers are the pack's employees (never service accounts)
      const done = await sys.db.query<{ id: string; number: string | null; short_description: string; caller_id: string; assignment_group_id: string | null; service_id: string | null }>(
        `select i.id, i.number, i.short_description, i.caller_id, i.assignment_group_id, i.service_id from sm_incidents i
          where i.org_id = $1 and i.deleted_at is null and i.state in ('resolved', 'closed') and i.caller_id is not null and i.resolved_at > now() - interval '45 days'
            and exists (select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id = i.id)
          order by i.resolved_at desc limit $2`,
        [orgId, 12 * s],
      );
      const seen = new Set<string>();
      let answered = 0;
      for (const [k, inc] of done.entries()) {
        if (seen.has(inc.caller_id)) continue;
        seen.add(inc.caller_id);
        const atm = !!xla && inc.service_id === memo.services.atm;
        const survey = atm ? xla : csat;
        try {
          const inv = await sys.write(async (tx) => {
            const row = await tx.one<Row>(`select * from sm_surveys where id = $1`, [survey]);
            return row ? inviteIn(tx, sys, row, inc.caller_id, { table: "incident", id: inc.id, number: inc.number, title: inc.short_description, group: inc.assignment_group_id, trigger: null, channels: ["in_app"] }) : null;
          });
          if (!inv) continue;
          bump(memo, "survey_invitation");
          // most answer in the portal; a few leave it for later (their invitation waits on the portal home)
          if (k % 4 === 3) continue;
          const person = await memberCtx(cfg, orgId, inc.caller_id);
          const [rating, solved, comment] = SURVEY_ANSWERS[k % SURVEY_ANSWERS.length];
          const questions = await sys.db.query<{ id: string; kind: string }>(`select id, kind from sm_survey_questions where org_id = $1 and survey_id = $2 and deleted_at is null order by sort_order`, [orgId, survey]);
          const answers: Record<string, unknown> = {};
          for (const q of questions) {
            if (q.kind === "rating") answers[q.id] = rating;
            else if (q.kind === "scale10") answers[q.id] = Math.min(10, rating * 2);
            else if (q.kind === "yes_no") answers[q.id] = solved;
            else if (q.kind === "minutes") answers[q.id] = rating >= 4 ? 20 : 120;
            else if (q.kind === "text" && comment) answers[q.id] = comment;
          }
          await submitSurvey(person, String(inv.id), answers);
          answered++;
        } catch (e) {
          refuse(orgId, "portal.answers", e);
        }
      }
      bump(memo, "survey_response", answered);
    }
  });
}

// ----- smart documents ----------------------------------------------------------------------------------------------

/** Short policy texts of the bank (Markdown), uploaded into the AI library and read by its own ingestion. */
const DOCUMENTS: [title: string, file: string, body: string][] = [
  ["دستورالعمل نگهداری و رفع خرابی خودپردازها", "atm-maintenance.md", `# دستورالعمل نگهداری و رفع خرابی خودپردازها\n\n## دامنه\nهمهٔ خودپردازها و دستگاه‌های بازیافت پول ${BANK_NAME}.\n\n## زمان‌های پاسخ\n- شعب شهری: حضور تکنسین تا ۴ ساعت کاری\n- شعب دیگر: تا ۸ ساعت کاری\n- بازگرداندن دستگاه به سرویس: حداکثر ۸ ساعت پس از اعلام\n\n## گیر کردن اسکناس\n1. دستگاه را از سرویس خارج کنید.\n2. کاست‌ها فقط با حضور مسئول شعبه بیرون آورده و صورت‌جلسه می‌شوند.\n3. مسیر اسکناس تمیز و تسمه بازبینی می‌شود.\n4. سه تراکنش آزمایشی پیش از بازگرداندن به سرویس.\n\n## جریمهٔ پیمانکار\nبه ازای هر ساعت از کارافتادگی بیش از زمان بازگرداندن، پنج میلیون ریال تا سقف پانصد میلیون ریال در ماه.`],
  ["خط‌مشی طبقه‌بندی و نگهداری اطلاعات مشتریان", "data-classification.md", `# خط‌مشی طبقه‌بندی و نگهداری اطلاعات مشتریان\n\n## سطح‌ها\n- **عمومی**: اطلاعیه‌ها و نرخ‌های اعلام‌شده\n- **داخلی**: دستورالعمل‌ها و گزارش‌های عملیاتی\n- **محرمانه**: اطلاعات حساب و تراکنش مشتریان\n- **سری**: کلیدهای رمزنگاری و اطلاعات کارت\n\n## نگهداری\nاسناد تراکنش‌ها ده سال و سوابق تماس مشتری پنج سال نگهداری می‌شود. اطلاعات کارت هرگز در سامانه‌های عمومی ذخیره نمی‌شود.\n\n## افشا\nافشای اطلاعات محرمانه فقط با دستور مرجع قانونی و تأیید ادارهٔ حقوقی.`],
  ["روال اطلاع‌رسانی رخدادهای عمده", "major-incident-comms.md", `# روال اطلاع‌رسانی رخدادهای عمده\n\n## چه زمانی رخداد عمده است\n- اختلال سراسری در خدمت کارت، کربنکینگ یا کانال‌های الکترونیک\n- اثر بر بیش از ده درصد شعب\n\n## گام‌ها\n1. مدیر رخداد ظرف ۱۵ دقیقه پل ارتباطی را باز می‌کند.\n2. اطلاعیهٔ نخست به ذی‌نفعان ظرف ۳۰ دقیقه.\n3. به‌روزرسانی هر ۳۰ دقیقه تا پایداری.\n4. اطلاعیهٔ درگاه برای کارکنان شعب و پیام به پذیرندگان متأثر.\n5. بازبینی پس از رخداد ظرف پنج روز کاری.`],
  ["دستورالعمل پاک‌سازی امن و اسقاط تجهیزات", "secure-disposal.md", `# دستورالعمل پاک‌سازی امن و اسقاط تجهیزات\n\n## اصل\nهیچ دستگاه حامل داده پیش از پاک‌سازی امن از بانک خارج نمی‌شود.\n\n## روش\n- پاک‌سازی به روش Purge مطابق NIST 800-88\n- انجام‌دهنده، شاهد و بازبین سه نفر جدا هستند\n- گواهی پاک‌سازی با شمارهٔ دستگاه و هش گواهی ثبت می‌شود\n\n## اسقاط\nپس از تأیید مدیر دارایی، دستگاه با دستور اسقاط به بازیافت سپرده می‌شود.`],
];

/**
 * Smart documents: the bank's policy library — a collection shared with everyone — with short Persian policy texts
 * uploaded by the risk and compliance persona; the AI library's own ingestion reads and indexes them (docs.ingest, a
 * job about the document: the pack's work), so «پرسش از اسناد» answers from them with citations.
 */
export async function stepDocs({ cfg, orgId, memo }: StepArgs, sys: Ctx): Promise<boolean> {
  if (!tableDef("doc_collection")) return true;
  const owner = memo.people.personas.grc ?? memo.people.personas.manager;
  if (!owner) return true;
  try {
    const coll = await sys.write((tx) => tryPut(tx, sys, "doc_collection", { name: "خط‌مشی‌ها و دستورالعمل‌های بانک", classification: "internal", description: "اسناد نمایشی کتابخانهٔ هوشمند: نگهداری خودپرداز، طبقه‌بندی اطلاعات، اطلاع‌رسانی رخداد عمده و اسقاط امن", owner_id: owner, sharing: "everyone", ai_enabled: true, open_contrib: false }));
    if (!coll) return true;
    bump(memo, "doc_collection");
    const person = await memberCtx(cfg, orgId, owner);
    for (const [title, file, body] of DOCUMENTS) {
      await uploadDocument(person, { collection_id: String(coll.id), title, file: { name: file, type: "text/markdown", data: new TextEncoder().encode(body) } });
      bump(memo, "doc_document");
    }
  } catch (e) {
    refuse(orgId, "docs.upload", e);
  }
  return true;
}

// ----- analytics ----------------------------------------------------------------------------------------------------

const OPEN: Cond = { f: "active", op: "eq", v: true };

/** The bank's indicators (the module's daily snapshot stores their scores; live values run as each viewer). */
const INDICATORS = (memo: LoadMemo) => [
  {
    key: "bank.atm_open_incidents", name: "رخدادهای باز خودپرداز", practice: "incident", unit: "count", direction: "down", grain: "day",
    formula: "open", parts: [{ name: "open", table: "incident", fn: "count", filter: { and: [OPEN, { f: "service_id", op: "eq", v: memo.services.atm }] } }], target: 5, warn: 10, crit: 20,
    description: "رخدادهای باز خدمت شبکهٔ خودپردازها (شاخص نمایشی بانک).",
  },
  {
    key: "bank.atm_resolved_share", name: "سهم رخدادهای خودپرداز حل‌شده در ماه", practice: "incident", unit: "percent", direction: "up", grain: "month",
    formula: "resolved / total * 100",
    parts: [
      { name: "resolved", table: "incident", fn: "count", date_field: "opened_at", filter: { and: [{ f: "service_id", op: "eq", v: memo.services.atm }, { f: "state", op: "in", v: ["resolved", "closed"] }] } },
      { name: "total", table: "incident", fn: "count", date_field: "opened_at", filter: { f: "service_id", op: "eq", v: memo.services.atm } },
    ],
    target: 90, warn: 80, crit: 70, description: "از رخدادهای خودپرداز ثبت‌شده در ماه چند درصد حل شده‌اند (شاخص نمایشی بانک).",
  },
  {
    key: "bank.merchant_complaints", name: "شکایت‌های باز پذیرندگان", practice: "other", unit: "count", direction: "down", grain: "week",
    formula: "open", parts: [{ name: "open", table: "customer_case", fn: "count", filter: { and: [OPEN, { f: "complaint", op: "eq", v: true }] } }], target: 2, warn: 4, crit: 8,
    description: "شکایت‌های بازِ پذیرندگان و مشتریان حقوقی (شاخص نمایشی بانک).",
  },
];

const tile = (id: string, x: number, y: number, key: string) => ({ id, kind: "indicator", x, y, w: 3, h: 3, indicator_key: key });
const report = (id: string, x: number, y: number, w: number, h: number, title: string, spec: Record<string, unknown>) => ({ id, kind: "report", x, y, w, h, title, spec: { v: 1, ...spec } });

/**
 * Analytics: the bank's indicators and two dashboards — branches and the ATM fleet for the desk and asset managers,
 * customer service and continuity for management — shared by role, so each viewer sees only the records they may read.
 */
export async function stepAnalytics({ memo }: StepArgs, sys: Ctx): Promise<boolean> {
  if (!tableDef("analytics_dashboard")) return true;
  const roles = (keys: string[]) => keys.map((id) => ({ kind: "role", id, right: "view" }));
  await sys.write(async (tx) => {
    for (const ind of INDICATORS(memo)) {
      if (await tryPut(tx, sys, "analytics_indicator", { ...ind, active: true, collect: true, owner_id: null, score_shares: roles(["service_desk_manager", "incident_manager", "asset_manager"]) })) bump(memo, "analytics_indicator");
    }
    const atm = memo.services.atm;
    const fleet = await tryPut(tx, sys, "analytics_dashboard", {
      name: "داشبورد شعب و ناوگان خودپرداز", status: "published", folder: "داشبوردهای بانک", is_home: false, refresh_minutes: 5, tv_cycle: 20,
      description: "رخدادهای خودپرداز و شعب، وضعیت ناوگان، هشدارهای پایش و بازدیدهای میدانی (داشبورد نمایشی).",
      shares: roles(["service_desk_manager", "incident_manager", "asset_manager", "agent", "dispatcher", "ops_engineer"]),
      filters: [{ key: "time", kind: "time", label: "بازهٔ زمانی" }, { key: "group", kind: "field", field: "assignment_group_id", label: "گروه" }],
      layout: {
        widgets: [
          tile("k1", 0, 0, "bank.atm_open_incidents"),
          tile("k2", 3, 0, "bank.atm_resolved_share"),
          tile("k3", 6, 0, "incident.mttr"),
          tile("k4", 9, 0, "incident.sla_compliance"),
          report("atm_trend", 0, 3, 8, 6, "رخدادهای خودپرداز در ۹۰ روز گذشته", { table: "incident", time: { field: "opened_at", window: { unit: "day", from: -89, to: 0 } }, filter: atm ? { f: "service_id", op: "eq", v: atm } : null, measures: [{ fn: "count", label: "ثبت‌شده" }], dims: [{ field: "opened_at", bucket: "week" }], viz: "line" }),
          report("by_service", 8, 3, 4, 6, "رخدادهای باز به تفکیک خدمت", { table: "incident", filter: OPEN, measures: [{ fn: "count" }], dims: [{ field: "service_id" }], viz: "donut", limit: 8, other: true }),
          report("fleet", 0, 9, 6, 6, "وضعیت خودپردازها و CRS", { table: "asset", filter: { f: "category", op: "in", v: ["atm", "crs"] }, measures: [{ fn: "count" }], dims: [{ field: "device_status" }], viz: "column" }),
          report("alerts", 6, 9, 6, 6, "هشدارهای پایش به تفکیک شدت", { table: "alert", measures: [{ fn: "count" }], dims: [{ field: "severity" }], viz: "bar" }),
          report("visits", 0, 15, 12, 6, "دستورهای کار میدانی به تفکیک وضعیت", { table: "work_order", measures: [{ fn: "count" }], dims: [{ field: "state" }], viz: "column" }),
        ],
      },
    });
    if (fleet) bump(memo, "analytics_dashboard");
    const mgmt = await tryPut(tx, sys, "analytics_dashboard", {
      name: "داشبورد مدیریت خدمات بانک", status: "published", folder: "داشبوردهای بانک", is_home: false, refresh_minutes: 15, tv_cycle: 30,
      description: "شکایت‌ها و پرونده‌های پذیرندگان، قطعی‌ها، تغییرها و ریسک‌ها برای مدیران (داشبورد نمایشی).",
      shares: roles(["service_desk_manager", "change_manager", "csm_agent", "continuity_manager", "grc_manager"]),
      filters: [{ key: "time", kind: "time", label: "بازهٔ زمانی" }],
      layout: {
        widgets: [
          tile("k1", 0, 0, "bank.merchant_complaints"),
          tile("k2", 3, 0, "change.success_rate"),
          tile("k3", 6, 0, "incident.backlog"),
          tile("k4", 9, 0, "incident.mtta"),
          report("cases", 0, 3, 6, 6, "پرونده‌های پذیرندگان به تفکیک نوع", { table: "customer_case", measures: [{ fn: "count" }], dims: [{ field: "case_type" }], viz: "donut" }),
          report("accounts", 6, 3, 6, 6, "پرونده‌های باز به تفکیک حساب", { table: "customer_case", filter: OPEN, measures: [{ fn: "count" }], dims: [{ field: "account_id" }], viz: "bar", limit: 8 }),
          report("outages", 0, 9, 6, 6, "قطعی‌ها به تفکیک خدمت", { table: "outage", measures: [{ fn: "count" }], dims: [{ field: "service_id" }], viz: "column" }),
          report("changes", 6, 9, 6, 6, "تغییرهای هر ماه به تفکیک نوع", { table: "change_request", time: { field: "opened_at", window: { unit: "month", from: -5, to: 0 } }, measures: [{ fn: "count" }], dims: [{ field: "opened_at", bucket: "month" }, { field: "type" }], viz: "column", options: { stacked: true } }),
        ],
      },
    });
    if (mgmt) bump(memo, "analytics_dashboard");
    if (await tryPut(tx, sys, "analytics_report", { name: "رخدادهای باز به تفکیک گروه پشتیبانی بانک", status: "published", folder: "گزارش‌های بانک", description: "گزارش نمایشی", table_key: "incident", spec: { v: 1, table: "incident", filter: OPEN, measures: [{ fn: "count" }], dims: [{ field: "assignment_group_id" }], viz: "bar", limit: 12 }, shares: roles(["service_desk_manager", "agent"]) })) bump(memo, "analytics_report");
  });
  return true;
}

