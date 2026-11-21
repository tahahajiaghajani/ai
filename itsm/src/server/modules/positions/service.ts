// The positions API's services (design F §3.4, §8.4, package F3):
//   · previewResolve  «پیش‌نمایش» of a step's people for a sample requester — the very resolver a step runs when it
//     opens (resolve.ts), with names and one line per person («علی احمدی — رئیس شعبه (شعبهٔ ونک)»); a requester of the
//     organisation's own starts real work, which never goes to the demo pack's people (a person of the pack starts the
//     pack's work);
//   · estimateStep    the static count behind the designer's explanation and pool warnings («۴۸ نفر در ۴۸ شعبه؛ برای
//     هر پرونده رئیس شعبه همان شعبه»; warnings from 30, the limits 100 and 50);
//   · positionsOverview  the positions with their current holders, units, vacancies and sources («نقش‌های سازمانی»);
//   · demoPeopleOf    the organisation's demo pack people (1.1.5): the pickers and the positions page mark them
//     «نمایشی», and the preview and the estimate count them apart — they take only the pack's own cases (FINAL-1).
// Previews and estimates are for the people who design workflows (`process_design` write) or keep the organisation's
// structure (`org` write beyond their own groups): they show who holds which post and who stands in for whom.
import type { Ctx } from "../../context";
import type { DemoPeople } from "@shared/process/waiting";
import { pgArray } from "../../db";
import { demoPeople } from "../../db/scope";
import { bad, forbidden, notFound } from "../../http/errors";
import { defFor, orgTz } from "../../engine";
import { access } from "../../access/provider";
import { prepareSubject } from "../../access/subject";
import { grantIn } from "@shared/access";
import { BUILTIN_KEYS } from "@shared/access/builtins";
import { PROCESS_DESIGN_AREA } from "@shared/tables/fields";
import { UNIT_KINDS } from "@shared/tables/access";
import { faDigits } from "@shared/format";
import { localDate } from "@shared/model/jalali-buckets";
import { addDays } from "@shared/jalali";
import {
  ASSIGNEE_KIND_LABELS, assigneeProblems, assigneeWarnings, cleanStepAssignees, isUuid, poolLimit, poolWarnings, ruleEstimate,
  type AssigneeFacts, type AssigneeRule, type PoolCounts, type Quorum, type StepAction, type StepAssignees,
} from "@shared/process/assignees";
import { Resolution, resolveAssignees, type ResolveResult } from "./resolve";

export const PREVIEW_REFUSAL = "پیش‌نمایش انجام‌دهنده‌ها با طراحان گردش‌کار و نگه‌دارندگان ساختار سازمانی است";

/** May the caller preview resolutions: `process_design` write, or `org` write in a unit, a domain or all of it? */
export async function canPreview(ctx: Ctx): Promise<boolean> {
  if (ctx.actor === "system") return true;
  const s = (await prepareSubject(ctx)).subject;
  const design = grantIn(s.eff, PROCESS_DESIGN_AREA);
  if (design.write !== "none" || design.create) return true;
  const org = grantIn(s.eff, "org");
  return ["unit", "unit_tree", "domain", "all"].includes(org.write);
}

async function needPreview(ctx: Ctx): Promise<void> {
  if (!(await canPreview(ctx))) throw forbidden(PREVIEW_REFUSAL);
}

const kindLabel = (k: unknown) => UNIT_KINDS.find((o) => o.value === k)?.label ?? "واحد";
const rulesOf = (step: StepAssignees): AssigneeRule[] => [...step.assignees, ...(step.fallback ?? [])];

/**
 * What the database knows about the rules' references (positions, groups, units, roles, people; the forms' fields when
 * given): `assigneeProblems(step, facts)` checks a step with it — the preview, the estimate and a version's publish.
 */
export async function assigneeFactsFor(ctx: Ctx, step: StepAssignees, fields?: Record<string, { type: string; ref?: string | null; label?: string | null }>): Promise<AssigneeFacts> {
  const org = ctx.org.id;
  const rules = rulesOf(step);
  const refs = rules.flatMap((r) => (r.kind === "position" ? [r.position] : []));
  const positions = refs.length
    ? await ctx.db.query<{ id: string; key: string; name: string; unit_kind: string | null; active: boolean }>(
        `select id, key, name, unit_kind, active from sm_positions where org_id = $1 and deleted_at is null and (key = any($2::text[]) or id::text = any($2::text[]))`,
        [org, pgArray(refs)],
      )
    : [];
  const groupIds = rules.flatMap((r) => (r.kind === "group" && isUuid(r.group) ? [r.group] : []));
  const groups = groupIds.length ? await ctx.db.query<{ id: string; name: string; active: boolean | null }>(`select id, name, active from sm_groups where org_id = $1 and id = any($2::uuid[]) and deleted_at is null`, [org, pgArray(groupIds)]) : [];
  const unitIds = rules.flatMap((r) => (r.kind === "position" && r.where === "unit" && isUuid(r.unit) ? [r.unit] : []));
  const units = unitIds.length ? await ctx.db.query<{ id: string; name: string; kind: string | null; active: boolean | null }>(`select id, name, kind, active from sm_org_units where org_id = $1 and id = any($2::uuid[]) and deleted_at is null`, [org, pgArray(unitIds)]) : [];
  // (a members entry that is no id stays in a draft for the validator; it never reaches the database)
  const people = rules.flatMap((r) => (r.kind === "users" ? r.users : "members" in r && r.members ? r.members : [])).filter((u) => isUuid(u));
  const active = people.length ? new Set((await ctx.db.query<{ user_id: string }>(`select user_id from sm_org_members where org_id = $1 and user_id = any($2::uuid[]) and is_active and deleted_at is null`, [org, pgArray(people)])).map((r) => r.user_id.toLowerCase())) : new Set<string>();
  const roleKeys = new Set([...BUILTIN_KEYS, ...(await ctx.db.query<{ key: string }>(`select key from sm_roles where org_id = $1 and deleted_at is null`, [org])).map((r) => r.key)]);
  const byRef = (ref: string) => positions.find((p) => p.key === ref || p.id.toLowerCase() === ref.toLowerCase());
  return {
    position: (ref) => {
      const p = byRef(ref);
      return p ? { name: p.name, active: p.active !== false, unitKind: p.unit_kind } : null;
    },
    group: (id) => {
      const g = groups.find((x) => x.id.toLowerCase() === id.toLowerCase());
      return g ? { name: g.name, active: g.active !== false } : null;
    },
    unit: (id) => {
      const u = units.find((x) => x.id.toLowerCase() === id.toLowerCase());
      return u ? { name: u.name, kind: u.kind, active: u.active !== false } : null;
    },
    role: (key) => (roleKeys.has(key) ? { name: key } : null),
    member: (id) => active.has(id.toLowerCase()),
    unitKinds: UNIT_KINDS.map((o) => o.value),
    ...(fields ? { field: (name: string) => (fields[name] ? { label: fields[name].label || name, type: fields[name].type, ref: fields[name].ref ?? null } : null) } : {}),
  };
}

function needValid(step: StepAssignees, facts: AssigneeFacts): void {
  const problems = assigneeProblems(step, facts);
  if (problems.length) throw bad(problems[0].message, { problems });
}

// ---------------------------------------------------------------------------------------------------------------
// The preview

export interface PreviewInput {
  step: unknown;
  action: StepAction;
  quorum?: Quorum | null;
  label?: string | null;
  /** the sample requester */
  requester: string;
  requested_for?: string | null;
  values?: Record<string, unknown>;
  /** the forms' fields the rules read: storage type (user, users, group, ref) and target */
  fields?: Record<string, { type: string; ref?: string | null; label?: string | null }>;
  step_actors?: Record<string, string[]>;
  previous_actor?: string | null;
  managers?: string[];
  manager_groups?: string[];
  at?: string | null;
}

export interface PreviewResult extends ResolveResult {
  warnings: string[];
  /** one line per person, as the designer's canvas shows them */
  lines: string[];
  /** `demo`: lower-case ids of the demo pack's people among `users` */
  display: { users: Record<string, string>; positions: Record<string, string>; units: Record<string, string>; groups: Record<string, string>; demo: string[] };
}

/** Names of the people, positions, units and groups a result names. */
async function displayOf(ctx: Ctx, result: ResolveResult): Promise<PreviewResult["display"]> {
  const org = ctx.org.id;
  const users = [...new Set(result.people.flatMap((p) => [p.user, ...(p.delegatedFrom ? [p.delegatedFrom] : [])]))];
  const names = users.length
    ? await ctx.db.query<{ id: string; name: string }>(
        `select u.id, coalesce(nullif(p.name, ''), nullif(u.full_name, ''), u.email) as name from sm_users u
         left join sm_member_profiles p on p.user_id = u.id and p.org_id = $1 and p.deleted_at is null where u.id = any($2::uuid[])`,
        [org, pgArray(users)],
      )
    : [];
  const keys = [...new Set(result.people.flatMap((p) => (p.via.position ? [p.via.position] : [])))];
  const positions = keys.length ? await ctx.db.query<{ key: string; name: string }>(`select key, name from sm_positions where org_id = $1 and key = any($2::text[]) and deleted_at is null`, [org, pgArray(keys)]) : [];
  const unitIds = [...new Set(result.people.flatMap((p) => (p.via.unit ? [p.via.unit] : [])))];
  const units = unitIds.length ? await ctx.db.query<{ id: string; name: string }>(`select id, name from sm_org_units where org_id = $1 and id = any($2::uuid[])`, [org, pgArray(unitIds)]) : [];
  const groupIds = [...new Set(result.people.flatMap((p) => (p.via.group ? [p.via.group] : [])))];
  const groups = groupIds.length ? await ctx.db.query<{ id: string; name: string }>(`select id, name from sm_groups where org_id = $1 and id = any($2::uuid[])`, [org, pgArray(groupIds)]) : [];
  return {
    users: Object.fromEntries(names.map((r) => [r.id.toLowerCase(), r.name])),
    positions: Object.fromEntries(positions.map((r) => [r.key, r.name])),
    units: Object.fromEntries(units.map((r) => [r.id.toLowerCase(), r.name])),
    groups: Object.fromEntries(groups.map((r) => [r.id.toLowerCase(), r.name])),
    demo: [...(await demoPeople(ctx.db, org, users))].sort(),
  };
}

function linesOf(result: ResolveResult, d: PreviewResult["display"]): string[] {
  return result.people.map((p) => {
    const who = d.users[p.user] ?? p.user;
    let what: string;
    if (p.via.kind === "managers") what = "مسئول گردش‌کار";
    else if (p.via.position) what = `${d.positions[p.via.position] ?? p.via.position}${p.via.unit && d.units[p.via.unit.toLowerCase()] ? ` (${d.units[p.via.unit.toLowerCase()]})` : ""}`;
    else if (p.via.group) what = `گروه «${d.groups[p.via.group.toLowerCase()] ?? ""}»`;
    else what = ASSIGNEE_KIND_LABELS[p.via.kind];
    const stand = p.delegatedFrom ? `، به جانشینی از ${d.users[p.delegatedFrom] ?? p.delegatedFrom}` : "";
    return `${who} — ${what}${stand}`;
  });
}

/** «پیش‌نمایش»: the people of a step for a sample requester, exactly as the step would find them when it opens. */
export async function previewResolve(ctx: Ctx, input: PreviewInput): Promise<PreviewResult> {
  await needPreview(ctx);
  const step = cleanStepAssignees(input.step);
  needValid(step, await assigneeFactsFor(ctx, step, input.fields));
  const requester = String(input.requester ?? "").toLowerCase();
  const member = isUuid(requester) && (await ctx.db.one(`select 1 from sm_org_members where org_id = $1 and user_id = $2 and deleted_at is null`, [ctx.org.id, requester]));
  if (!member) throw notFound("درخواست‌دهندهٔ نمونه عضو این سازمان نیست");
  const at = input.at ? Date.parse(input.at) : NaN;
  const result = await resolveAssignees(ctx.db, ctx, {
    step,
    action: input.action,
    quorum: input.quorum ?? null,
    label: input.label ?? null,
    requestedBy: requester,
    requestedFor: input.requested_for ?? null,
    values: input.values ?? {},
    fieldTypes: input.fields ? Object.fromEntries(Object.entries(input.fields).map(([k, v]) => [k, v.type])) : undefined,
    stepActors: input.step_actors ?? {},
    previousActor: input.previous_actor ?? null,
    managers: input.managers ?? [],
    managerGroups: input.manager_groups ?? [],
    at: Number.isFinite(at) ? at : undefined,
    // as the step of the case this requester would start: the pack's people start the pack's work (demo scope)
    real: !(await demoPeople(ctx.db, ctx.org.id, [requester])).size,
  });
  const display = await displayOf(ctx, result);
  return { ...result, warnings: assigneeWarnings(step, input.action), lines: linesOf(result, display), display };
}

// ---------------------------------------------------------------------------------------------------------------
// The static estimate

export interface EstimateInput {
  step: unknown;
  action: StepAction;
  quorum?: Quorum | null;
}

export interface EstimateResult {
  /** `demo`: how many of the people the rule names (its holders, members, role holders, named people) are the demo pack's */
  rules: { index: number; kind: AssigneeRule["kind"]; estimate: number | null; line: string; demo?: number }[];
  /** the most people the step's rules can bring (null: depends on each case) */
  total: number | null;
  /** the demo pack's people within `total` (they take only the pack's own cases) */
  demo: number;
  limit: number;
  warnings: string[];
}

/** The designer's explanation line and pool warnings of a step: static counts of holders, groups and roles. */
export async function estimateStep(ctx: Ctx, input: EstimateInput): Promise<EstimateResult> {
  await needPreview(ctx);
  const step = cleanStepAssignees(input.step);
  needValid(step, await assigneeFactsFor(ctx, step));
  const reader = new Resolution(ctx.db, ctx, { step, action: input.action, requestedBy: null });
  const holderCounts = new Map<string, { people: number; units: number; name: string; kind: string | null }>();
  const groupCounts = new Map<string, number>();
  const roleCounts = new Map<string, number>();
  // the people each rule names (its holders, members, role holders, named people), for the demo pack's count
  const named = new Map<number, Set<string>>();
  const narrow = (users: Iterable<string>, members?: string[]) => new Set([...users].map((u) => u.toLowerCase()).filter((u) => !members?.length || members.includes(u)));
  for (const [i, r] of step.assignees.entries()) {
    if (r.kind === "position") {
      const pos = await reader.position(r.position);
      if (!pos) continue;
      const unit = r.where === "unit" ? (r.unit ?? null) : null;
      const rows = await reader.holders(pos.id, unit ? [unit] : null);
      holderCounts.set(`${r.position}|${unit ?? ""}`, { people: new Set(rows.map((h) => h.user_id)).size, units: new Set(rows.map((h) => h.org_unit_id ?? "")).size, name: pos.name, kind: pos.unit_kind });
      named.set(i, narrow(rows.map((h) => h.user_id), r.members));
    } else if (r.kind === "group") {
      const people = await reader.groupPeople([r.group], r.leadsOnly);
      groupCounts.set(`${r.group}|${r.leadsOnly ? 1 : 0}`, new Set(people.map((f) => f.user)).size);
      named.set(i, narrow(people.map((f) => f.user), r.members));
    } else if (r.kind === "role") {
      const people = await reader.rolePeople(r.role);
      roleCounts.set(r.role, people.length);
      named.set(i, narrow(people, r.members));
    } else if (r.kind === "users") {
      named.set(i, narrow(r.users));
    }
  }
  const pack = await demoPeople(ctx.db, ctx.org.id, [...new Set([...named.values()].flatMap((x) => [...x]))]);
  const demoOf = (i: number) => (named.has(i) ? [...named.get(i)!].filter((u) => pack.has(u)).length : undefined);
  const counts: PoolCounts = {
    holders: (p, unit) => holderCounts.get(`${p}|${unit ?? ""}`)?.people ?? null,
    group: (g, leads) => groupCounts.get(`${g}|${leads ? 1 : 0}`) ?? null,
    role: (k) => roleCounts.get(k) ?? null,
  };
  const groupNames = new Map(
    (await ctx.db.query<{ id: string; name: string }>(`select id, name from sm_groups where org_id = $1 and id = any($2::uuid[])`, [ctx.org.id, pgArray(step.assignees.flatMap((r) => (r.kind === "group" && isUuid(r.group) ? [r.group] : [])))])).map((g) => [g.id.toLowerCase(), g.name]),
  );
  const rules = step.assignees.map((r, index) => {
    const estimate = ruleEstimate(r, counts);
    let line: string;
    switch (r.kind) {
      case "position": {
        const c = holderCounts.get(`${r.position}|${r.where === "unit" ? (r.unit ?? "") : ""}`);
        const name = c?.name ?? r.position;
        if (!c) line = `نقش سازمانی «${r.position}» پیدا نشد`;
        else if (r.where === "anywhere") line = `${faDigits(c.people)} نفر «${name}» در همهٔ سازمان`;
        else if (r.where === "unit") line = `${faDigits(c.people)} نفر «${name}» در واحد برگزیده`;
        else {
          const kind = (r.where === "requester_unit_up" ? r.unitKind : null) ?? c.kind;
          line = `${faDigits(c.people)} نفر در ${faDigits(c.units)} ${kindLabel(kind)}؛ برای هر پرونده «${name}» همان ${kindLabel(kind)}`;
        }
        break;
      }
      case "group":
        line = `${faDigits(estimate ?? 0)} ${r.leadsOnly ? "سرپرست" : "نفر"} در گروه «${groupNames.get(r.group.toLowerCase()) ?? ""}»`;
        break;
      case "role":
        line = `${faDigits(estimate ?? 0)} نفر با نقش دسترسی «${r.role}»`;
        break;
      case "users":
        line = `${faDigits(r.users.length)} نفر مشخص`;
        break;
      case "manager":
        line = `${r.of === "previous_actor" ? "مدیر انجام‌دهندهٔ قبلی" : "مدیر درخواست‌دهنده"}${r.depth && r.depth > 1 ? ` (${faDigits(r.depth)} سطح بالاتر)` : ""}`;
        break;
      case "unit_head":
        line = r.of === "unit_field" ? "رئیس واحدی که فیلد فرم می‌گوید" : r.unitKind ? `رئیس نزدیک‌ترین واحد نوع «${kindLabel(r.unitKind)}» درخواست‌دهنده` : "رئیس واحد درخواست‌دهنده";
        break;
      case "field":
        line = "کسی که فیلد فرم می‌گوید";
        break;
      case "step_actor":
        line = "انجام‌دهندهٔ مرحلهٔ پیشین";
        break;
      default:
        line = "درخواست‌دهنده";
    }
    if ("members" in r && r.members?.length) line += `؛ فقط ${faDigits(r.members.length)} نفر برگزیده`;
    const demo = demoOf(index);
    return { index, kind: r.kind, estimate, line, ...(demo !== undefined ? { demo } : {}) };
  });
  const known = rules.map((r) => r.estimate);
  const total = known.some((n) => n === null) ? null : known.reduce<number>((s, n) => s + (n ?? 0), 0);
  // the demo pack's people take only the pack's own cases (FINAL-1): said apart, never counted as the organisation's
  const demo = rules.reduce((sum, r) => sum + (r.estimate !== null ? r.demo ?? 0 : 0), 0);
  const anyDemo = rules.reduce((sum, r) => sum + (r.demo ?? 0), 0);
  const warnings = [...poolWarnings(step, input.action, input.quorum, counts), ...assigneeWarnings(step, input.action)];
  if (anyDemo) warnings.push(demoWarning(total !== null && total > 0 && demo >= total ? null : total !== null ? demo : anyDemo));
  return { rules, total, demo, limit: poolLimit(input.action, input.quorum), warnings };
}

/** «۲ نفر از این افراد حساب نمایشی‌اند…»; null: every one of them. */
export function demoWarning(n: number | null): string {
  return n === null
    ? "همهٔ این افراد حساب نمایشی‌اند؛ فقط پرونده‌هایی که حساب‌های نمایشی آغاز کنند به آن‌ها می‌رسد و پرونده‌های واقعی سازمان به کسی نمی‌رسد"
    : `${faDigits(n)} نفر از این افراد حساب نمایشی‌اند؛ فقط پرونده‌هایی که حساب‌های نمایشی آغاز کنند به آن‌ها می‌رسد`;
}

// ---------------------------------------------------------------------------------------------------------------
// The demo pack's people

/** May the caller open the workflow designer (`process_design` read) or the positions page (`org` read of positions)? */
async function readsDesignOrPositions(ctx: Ctx): Promise<boolean> {
  if (ctx.actor === "system") return true;
  const design = (await defFor(ctx, "process")).def;
  if (access().canReadTable(ctx, design)) return true;
  return access().canReadTable(ctx, (await defFor(ctx, "position")).def);
}

/** The organisation's demo pack people (lower-case ids; none without a pack): the pickers mark them «نمایشی». */
export async function demoPeopleOf(ctx: Ctx): Promise<DemoPeople> {
  if (!(await readsDesignOrPositions(ctx))) throw forbidden("فهرست حساب‌های نمایشی با طراحان گردش‌کار و نگه‌دارندگان نقش‌های سازمانی است");
  const rows = await ctx.db.query<{ id: string }>(`select id::text as id from sm_users where prefs ->> 'demo_org' = $1 order by id limit 20000`, [ctx.org.id]);
  return { users: rows.map((r) => r.id.toLowerCase()) };
}

// ---------------------------------------------------------------------------------------------------------------
// The overview

export interface PositionOverview {
  id: string;
  key: string;
  name: string;
  unit_kind: string | null;
  active: boolean;
  reports_to: string | null;
  /** holders valid today, the units they hold it in, their sources */
  holders: number;
  units: number;
  sources: { manual: number; directory: number; import: number };
  /** units of the position's kind with no holder today (positions held in a kind of unit) */
  vacancies: number | null;
  /** holders whose period ends within 30 days */
  ending: number;
}

/** «نقش‌های سازمانی»: every position with its current holders, units, sources, vacancies and periods ending soon. */
export async function positionsOverview(ctx: Ctx): Promise<{ positions: PositionOverview[]; today: string }> {
  const { def } = await defFor(ctx, "position");
  if (!access().canReadTable(ctx, def)) throw forbidden("به نقش‌های سازمانی دسترسی ندارید");
  const today = localDate(Date.now(), orgTz(ctx));
  const soon = addDays(today, 30);
  const valid = `h.deleted_at is null and (h.valid_from is null or h.valid_from <= $2::date) and (h.valid_to is null or h.valid_to >= $2::date)`;
  const rows = await ctx.db.query<{ id: string; key: string; name: string; unit_kind: string | null; active: boolean; reports_to: string | null; holders: number; units: number; manual: number; directory: number; import: number; ending: number }>(
    `select p.id, p.key, p.name, p.unit_kind, p.active, p.reports_to,
            count(h.id) filter (where ${valid})::int as holders,
            count(distinct h.org_unit_id) filter (where ${valid})::int as units,
            count(h.id) filter (where ${valid} and h.source = 'manual')::int as manual,
            count(h.id) filter (where ${valid} and h.source = 'directory')::int as directory,
            count(h.id) filter (where ${valid} and h.source = 'import')::int as import,
            count(h.id) filter (where ${valid} and h.valid_to is not null and h.valid_to <= $3::date)::int as ending
     from sm_positions p left join sm_position_holders h on h.position_id = p.id and h.org_id = p.org_id
     where p.org_id = $1 and p.deleted_at is null
     group by p.id order by p.name`,
    [ctx.org.id, today, soon],
  );
  const out: PositionOverview[] = [];
  for (const r of rows) {
    let vacancies: number | null = null;
    if (r.unit_kind) {
      const v = await ctx.db.one<{ n: number }>(
        `select count(*)::int as n from sm_org_units u where u.org_id = $1 and u.deleted_at is null and u.active is not false and u.kind = $3
           and not exists (select 1 from sm_position_holders h where h.org_id = u.org_id and h.position_id = $4 and h.org_unit_id = u.id and ${valid})`,
        [ctx.org.id, today, r.unit_kind, r.id],
      );
      vacancies = v?.n ?? 0;
    }
    out.push({ id: r.id, key: r.key, name: r.name, unit_kind: r.unit_kind, active: r.active !== false, reports_to: r.reports_to, holders: r.holders, units: r.units, sources: { manual: r.manual, directory: r.directory, import: r.import }, vacancies, ending: r.ending });
  }
  return { positions: out, today };
}
