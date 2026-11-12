// Assignee rules of a workflow step (design F §3.4, package F3): who a step goes to. A step unites its rules — an
// organisational role («نقش سازمانی») held anywhere, in the requester's unit, in the nearest unit (of a kind) up the
// tree from it, in a fixed unit or in the unit a form field names; a group; an access role; named people; the
// requester's (or the previous actor's) manager to depth 3; the head of a unit; a person field of the form; whoever
// did an earlier step; the requester — then removes the excluded people (the requester on approve steps: separation
// of duties), falls back to other rules when nobody is left, and says what happens when even they find nobody.
// A pool is capped: at most 100 people per step round, 50 for an approve step whose quorum counts everyone.
// Pure and shared: the designer checks rules, warns about pools and tells whether a future step may come to the
// person, with the same rules the server resolves (src/server/modules/positions/resolve.ts).
// Imported by the UI: keep it free of server imports.
import { faDigits } from "../format";

export const ASSIGNEE_KINDS = ["position", "group", "role", "users", "manager", "unit_head", "field", "step_actor", "requester"] as const;
export type AssigneeKind = (typeof ASSIGNEE_KINDS)[number];

/** Where the holders of a position are taken from. */
export const POSITION_WHERE = ["anywhere", "requester_unit", "requester_unit_up", "unit", "unit_field"] as const;
export type PositionWhere = (typeof POSITION_WHERE)[number];

export type AssigneeRule =
  | {
      kind: "position";
      /** the position's key (its id is accepted too) */
      position: string;
      where: PositionWhere;
      /** `where: "unit"`: the unit */
      unit?: string;
      /** `where: "unit_field"`: the form field holding the unit */
      unitField?: string;
      /** `where: "requester_unit_up"`: the nearest unit of this kind (with a holder) */
      unitKind?: string;
      /** only these people among the holders (with a dynamic `where`: «فقط این افراد، اگر در آن واحد باشند») */
      members?: string[];
    }
  | { kind: "group"; group: string; leadsOnly?: boolean; members?: string[] }
  /** an access role's key (IT-style processes) */
  | { kind: "role"; role: string; members?: string[] }
  | { kind: "users"; users: string[] }
  | { kind: "manager"; of: "requester" | "previous_actor"; depth?: 1 | 2 | 3 }
  | { kind: "unit_head"; of: "requester" | "unit_field"; unitKind?: string; unitField?: string }
  /** a person / people (or group) field of the case */
  | { kind: "field"; field: string }
  /** whoever did an earlier step */
  | { kind: "step_actor"; step: string }
  | { kind: "requester" };

export const STEP_ACTIONS = ["fill", "review", "approve"] as const;
export type StepAction = (typeof STEP_ACTIONS)[number];

export const QUORUMS = ["any", "all", "count", "percent", "first"] as const;
export type Quorum = (typeof QUORUMS)[number];

/** What happens when nobody is found: the case waits (the process managers are told), the step is skipped, or it goes to the process managers. */
export const IF_NOBODY = ["wait", "skip", "managers"] as const;
export type IfNobody = (typeof IF_NOBODY)[number];

/** People a step never goes to: the requester (filer and beneficiary), whoever acted in earlier steps, or in one step. */
export type Exclusion = "requester" | "earlier_actors" | `step:${string}`;

/** The people side of a step (F4a's `form_step` carries it with its action and quorum). */
export interface StepAssignees {
  /** united; at least one */
  assignees: AssigneeRule[];
  /** default: `["requester"]` on approve steps, none otherwise */
  exclude?: Exclusion[];
  /** rules asked when the step's rules leave nobody */
  fallback?: AssigneeRule[];
  /** default "wait" */
  ifNobody?: IfNobody;
}

// ---------------------------------------------------------------------------------------------------------------
// Labels (the designer and the server's messages)

export const ASSIGNEE_KIND_LABELS: Record<AssigneeKind, string> = {
  position: "نقش سازمانی",
  group: "گروه",
  role: "نقش دسترسی",
  users: "افراد مشخص",
  manager: "مدیر مستقیم",
  unit_head: "رئیس واحد",
  field: "فیلد فرم",
  step_actor: "انجام‌دهندهٔ مرحلهٔ قبل",
  requester: "درخواست‌دهنده",
};

export const POSITION_WHERE_LABELS: Record<PositionWhere, string> = {
  anywhere: "همه‌جا",
  requester_unit: "واحد درخواست‌دهنده",
  requester_unit_up: "نزدیک‌ترین واحد بالادست درخواست‌دهنده",
  unit: "واحد مشخص",
  unit_field: "واحدی که فیلد فرم می‌گوید",
};

export const IF_NOBODY_LABELS: Record<IfNobody, string> = {
  wait: "منتظر بماند و مسئولان گردش‌کار باخبر شوند",
  skip: "از این مرحله بگذرد",
  managers: "به مسئولان گردش‌کار برسد",
};

export const STEP_ACTION_LABELS: Record<StepAction, string> = { fill: "تکمیل فرم", review: "بررسی", approve: "تأیید" };

// ---------------------------------------------------------------------------------------------------------------
// Limits

/** At most this many people in one step round (more: the step waits and the process managers choose). */
export const POOL_LIMIT = 100;
/** An approve step whose quorum counts everyone (all, count, percent) asks at most this many approvers. */
export const APPROVER_LIMIT = 50;
/** The designer warns about pools from this size. */
export const POOL_WARNING = 30;
/** Rules of a step (and of its fallback), named people and members filters. */
export const MAX_RULES = 10;
export const MAX_PEOPLE = 100;
/** Steps up the unit tree a resolution walks (the tree's own limit is 60 levels). */
export const MAX_UNIT_DEPTH = 60;

/** The pool limit of a step: 50 for an approve step with quorum all, count or percent; 100 otherwise. */
export function poolLimit(action: StepAction, quorum?: Quorum | null): number {
  return action === "approve" && (quorum === "all" || quorum === "count" || quorum === "percent") ? APPROVER_LIMIT : POOL_LIMIT;
}

/** The delegation scope an action reads (design F §3.4): approvals for approve, assignments for fill and review. */
export function delegationScope(action: StepAction): "approvals" | "assignments" {
  return action === "approve" ? "approvals" : "assignments";
}

/** The exclusions a step applies: its own, else the requester on approve steps (separation of duties). */
export function exclusionsOf(step: Pick<StepAssignees, "exclude">, action: StepAction): Exclusion[] {
  return step.exclude ?? (action === "approve" ? ["requester"] : []);
}

export const ifNobodyOf = (step: Pick<StepAssignees, "ifNobody">): IfNobody => step.ifNobody ?? "wait";

/** «بیش از ۱۰۰ نفر پیدا شد؛ مسئولان گردش‌کار انتخاب می‌کنند» (or 50 approvers). */
export function tooManyMessage(limit: number): string {
  return limit === APPROVER_LIMIT
    ? `بیش از ${faDigits(limit)} تأییدکننده پیدا شد؛ مسئولان گردش‌کار انتخاب می‌کنند`
    : `بیش از ${faDigits(limit)} نفر پیدا شد؛ مسئولان گردش‌کار انتخاب می‌کنند`;
}

/** «برای "تأیید رئیس شعبه" کسی پیدا نشد؛ مسئولان گردش‌کار باخبر شدند.» */
export function nobodyMessage(stepLabel: string | null | undefined, ifNobody: IfNobody = "wait"): string {
  const step = stepLabel ? `برای «${stepLabel}»` : "برای این مرحله";
  if (ifNobody === "skip") return `${step} کسی پیدا نشد؛ از این مرحله گذشت.`;
  return `${step} کسی پیدا نشد؛ مسئولان گردش‌کار باخبر شدند.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Cleaning what a draft stored (unknown keys dropped, lists deduplicated and capped)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const IDENT = /^[a-z][a-z0-9_]{0,62}$/;
const text = (v: unknown, max = 120): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const ids = (v: unknown, max = MAX_PEOPLE): string[] | undefined =>
  Array.isArray(v) ? [...new Set(v.filter(isUuid).map((x) => x.toLowerCase()))].slice(0, max) : undefined;
const one = <T extends string>(v: unknown, list: readonly T[]): T | undefined => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : undefined);

/** A rule as stored, or null when its kind is unknown. Members and people lists are deduplicated and capped. */
export function cleanRule(raw: unknown): AssigneeRule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const members = ids(r.members);
  switch (r.kind) {
    case "position": {
      const where = one(r.where, POSITION_WHERE) ?? "anywhere";
      return {
        kind: "position",
        position: text(r.position, 64) ?? "",
        where,
        ...(where === "unit" && text(r.unit, 64) ? { unit: text(r.unit, 64)!.toLowerCase() } : {}),
        ...(where === "unit_field" && text(r.unitField, 64) ? { unitField: text(r.unitField, 64) } : {}),
        ...(where === "requester_unit_up" && text(r.unitKind, 40) ? { unitKind: text(r.unitKind, 40) } : {}),
        ...(members?.length ? { members } : {}),
      };
    }
    case "group":
      return { kind: "group", group: (text(r.group, 64) ?? "").toLowerCase(), ...(r.leadsOnly === true ? { leadsOnly: true } : {}), ...(members?.length ? { members } : {}) };
    case "role":
      return { kind: "role", role: text(r.role, 41) ?? "", ...(members?.length ? { members } : {}) };
    case "users":
      return { kind: "users", users: ids(r.users) ?? [] };
    case "manager": {
      const depth = Number(r.depth);
      return { kind: "manager", of: one(r.of, ["requester", "previous_actor"] as const) ?? "requester", ...(depth === 2 || depth === 3 ? { depth } : {}) };
    }
    case "unit_head": {
      const of = one(r.of, ["requester", "unit_field"] as const) ?? "requester";
      return {
        kind: "unit_head",
        of,
        ...(text(r.unitKind, 40) ? { unitKind: text(r.unitKind, 40) } : {}),
        ...(of === "unit_field" && text(r.unitField, 64) ? { unitField: text(r.unitField, 64) } : {}),
      };
    }
    case "field":
      return { kind: "field", field: text(r.field, 64) ?? "" };
    case "step_actor":
      return { kind: "step_actor", step: text(r.step, 64) ?? "" };
    case "requester":
      return { kind: "requester" };
    default:
      return null;
  }
}

function cleanExclusion(v: unknown): Exclusion | null {
  if (v === "requester" || v === "earlier_actors") return v;
  if (typeof v === "string" && /^step:[A-Za-z0-9_.-]{1,64}$/.test(v)) return v as Exclusion;
  return null;
}

/** A step's people settings as stored: rules cleaned, unknown kinds dropped, lists capped. */
export function cleanStepAssignees(raw: unknown): StepAssignees {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rules = (v: unknown) => (Array.isArray(v) ? v.map(cleanRule).filter((x): x is AssigneeRule => !!x).slice(0, MAX_RULES) : []);
  const out: StepAssignees = { assignees: rules(r.assignees) };
  if (Array.isArray(r.exclude)) out.exclude = [...new Set(r.exclude.map(cleanExclusion).filter((x): x is Exclusion => !!x))];
  const fallback = rules(r.fallback);
  if (fallback.length) out.fallback = fallback;
  const ifNobody = one(r.ifNobody ?? r.if_nobody, IF_NOBODY);
  if (ifNobody) out.ifNobody = ifNobody;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Validation

/** What the caller knows to check references (the designer from loaded rows, the server from the database). */
export interface AssigneeFacts {
  position?(key: string): { name: string; active: boolean; unitKind: string | null } | null | undefined;
  group?(id: string): { name: string; active: boolean } | null | undefined;
  role?(key: string): { name: string } | null | undefined;
  unit?(id: string): { name: string; kind: string | null; active: boolean } | null | undefined;
  /** is the person an active member? */
  member?(id: string): boolean;
  /** a field of the process forms (case values): its label and storage type (user, users, group, ref + target) */
  field?(name: string): { label: string; type: string; ref?: string | null } | null | undefined;
  /** an earlier step on the path to this one */
  step?(key: string): { label: string } | null | undefined;
  /** the unit kinds the organisation knows */
  unitKinds?: readonly string[];
}

export interface AssigneeProblem {
  /** where in the step: «assignees.0», «fallback.1», «exclude», «ifNobody» */
  path: string;
  message: string;
}

const PERSON_FIELD_TYPES = ["user", "users", "group"];

function ruleProblems(rule: AssigneeRule, facts: AssigneeFacts, path: string): AssigneeProblem[] {
  const out: AssigneeProblem[] = [];
  const add = (message: string) => out.push({ path, message });
  const membersOk = (m: string[] | undefined) => {
    if (m && m.length > MAX_PEOPLE) add(`حداکثر ${faDigits(MAX_PEOPLE)} نفر را می‌توان برگزید`);
    if (m && facts.member) for (const u of m) if (!facts.member(u)) add("یکی از افراد برگزیده دیگر عضو فعال سازمان نیست");
  };
  const unitFieldOk = (name: string | undefined) => {
    if (!name) return add("فیلد واحد را انتخاب کنید");
    const f = facts.field?.(name);
    if (facts.field && !f) return add(`فیلد «${name}» در فرم‌های این گردش‌کار نیست`);
    if (f && !(f.type === "ref" && f.ref === "org_unit")) add(`«${f.label}» فیلد واحد سازمانی نیست`);
  };
  const kindOk = (k: string | undefined) => {
    if (k && facts.unitKinds && !facts.unitKinds.includes(k)) add(`نوع واحد «${k}» شناخته نیست`);
  };
  switch (rule.kind) {
    case "position": {
      if (!rule.position) {
        add("نقش سازمانی را انتخاب کنید");
        break;
      }
      if (!(POSITION_WHERE as readonly string[]).includes(rule.where)) add("محدودهٔ نقش سازمانی معتبر نیست");
      const pos = facts.position?.(rule.position);
      if (facts.position && !pos) add(`نقش سازمانی «${rule.position}» پیدا نشد`);
      else if (pos && !pos.active) add(`نقش سازمانی «${pos.name}» غیرفعال است`);
      if (rule.where === "unit") {
        if (!isUuid(rule.unit)) add("واحد را انتخاب کنید");
        else if (facts.unit) {
          const u = facts.unit(rule.unit);
          if (!u) add("واحد برگزیده پیدا نشد");
          else if (pos?.unitKind && u.kind !== pos.unitKind) add(`«${u.name}» از نوع واحدهای «${pos.name}» نیست`);
        }
      }
      if (rule.where === "unit_field") unitFieldOk(rule.unitField);
      if (rule.where === "requester_unit_up") {
        kindOk(rule.unitKind);
        if (rule.unitKind && pos?.unitKind && rule.unitKind !== pos.unitKind) add(`«${pos.name}» در واحدهایی از نوع دیگری است؛ نوع واحد را همان بگذارید`);
      }
      membersOk(rule.members);
      break;
    }
    case "group": {
      if (!isUuid(rule.group)) {
        add("گروه را انتخاب کنید");
        break;
      }
      const g = facts.group?.(rule.group);
      if (facts.group && !g) add("گروه برگزیده پیدا نشد");
      else if (g && !g.active) add(`گروه «${g.name}» غیرفعال است`);
      membersOk(rule.members);
      break;
    }
    case "role": {
      if (!rule.role || !IDENT.test(rule.role)) {
        add("نقش دسترسی را انتخاب کنید");
        break;
      }
      if (facts.role && !facts.role(rule.role)) add(`نقش دسترسی «${rule.role}» پیدا نشد`);
      membersOk(rule.members);
      break;
    }
    case "users":
      if (!rule.users.length) add("دست‌کم یک نفر را برگزینید");
      membersOk(rule.users);
      break;
    case "manager":
      if (rule.of !== "requester" && rule.of !== "previous_actor") add("مدیر چه کسی؟ درخواست‌دهنده یا انجام‌دهندهٔ قبلی را برگزینید");
      if (rule.depth !== undefined && ![1, 2, 3].includes(rule.depth)) add("سطح مدیر از ۱ تا ۳ است");
      break;
    case "unit_head":
      if (rule.of !== "requester" && rule.of !== "unit_field") add("رئیس کدام واحد؟ واحد درخواست‌دهنده یا فیلد فرم را برگزینید");
      if (rule.of === "unit_field") unitFieldOk(rule.unitField);
      kindOk(rule.unitKind);
      break;
    case "field": {
      if (!rule.field) {
        add("فیلد فرم را انتخاب کنید");
        break;
      }
      const f = facts.field?.(rule.field);
      if (facts.field && !f) add(`فیلد «${rule.field}» در فرم‌های این گردش‌کار نیست`);
      else if (f && !PERSON_FIELD_TYPES.includes(f.type)) add(`«${f.label}» فیلد شخص، چند شخص یا گروه نیست`);
      break;
    }
    case "step_actor":
      if (!rule.step) add("مرحلهٔ پیشین را انتخاب کنید");
      else if (facts.step && !facts.step(rule.step)) add("مرحلهٔ برگزیده پیش از این مرحله نیست");
      break;
    case "requester":
      break;
    default:
      add("نوع قاعدهٔ انجام‌دهنده شناخته نیست");
  }
  return out;
}

/**
 * Why a step's people settings cannot be published (Persian), each with where it is: no rule («این مرحله انجام‌دهنده
 * ندارد»), a rule missing what it needs or naming what does not exist (when `facts` can tell), an unknown exclusion.
 */
export function assigneeProblems(step: StepAssignees, facts: AssigneeFacts = {}): AssigneeProblem[] {
  const out: AssigneeProblem[] = [];
  if (!step.assignees?.length) out.push({ path: "assignees", message: "این مرحله انجام‌دهنده ندارد" });
  if ((step.assignees?.length ?? 0) > MAX_RULES) out.push({ path: "assignees", message: `حداکثر ${faDigits(MAX_RULES)} قاعده برای هر مرحله` });
  if ((step.fallback?.length ?? 0) > MAX_RULES) out.push({ path: "fallback", message: `حداکثر ${faDigits(MAX_RULES)} قاعدهٔ جایگزین` });
  (step.assignees ?? []).forEach((r, i) => out.push(...ruleProblems(r, facts, `assignees.${i}`)));
  (step.fallback ?? []).forEach((r, i) => out.push(...ruleProblems(r, facts, `fallback.${i}`)));
  for (const x of step.exclude ?? []) {
    if (cleanExclusion(x) === null) out.push({ path: "exclude", message: "یکی از کنارگذاشته‌ها شناخته نیست" });
    else if (x.startsWith("step:") && facts.step && !facts.step(x.slice(5))) out.push({ path: "exclude", message: "مرحلهٔ کنارگذاشته پیش از این مرحله نیست" });
  }
  if (step.ifNobody !== undefined && !(IF_NOBODY as readonly string[]).includes(step.ifNobody)) out.push({ path: "ifNobody", message: "«اگر کسی نبود» معتبر نیست" });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Pools: a static estimate for the designer's warnings

/** Static counts the designer knows (holders of a position everywhere, a group's people, a role's people). */
export interface PoolCounts {
  /** current holders of a position (`unit`: in that unit only) */
  holders?(position: string, unit?: string | null): number | null | undefined;
  /** members and leads (leads only) of a group */
  group?(id: string, leadsOnly?: boolean): number | null | undefined;
  /** holders of an access role */
  role?(key: string): number | null | undefined;
}

/**
 * The most people a rule can bring, statically: positions held «همه‌جا» or in a fixed unit, groups, roles and named
 * people are counted; a rule that depends on the case (a unit of the requester, a manager, a field, an earlier
 * actor) counts as the holders of one unit — unknown (null) for positions, one person for the rest.
 */
export function ruleEstimate(rule: AssigneeRule, counts: PoolCounts = {}): number | null {
  const cap = (n: number | null | undefined, members?: string[]) => (n === null || n === undefined ? (members?.length ?? null) : members?.length ? Math.min(n, members.length) : n);
  switch (rule.kind) {
    case "position":
      if (rule.where === "anywhere") return cap(counts.holders?.(rule.position, null), rule.members);
      if (rule.where === "unit") return cap(counts.holders?.(rule.position, rule.unit ?? null), rule.members);
      return rule.members?.length ?? null;
    case "group":
      return cap(counts.group?.(rule.group, rule.leadsOnly), rule.members);
    case "role":
      return cap(counts.role?.(rule.role), rule.members);
    case "users":
      return rule.users.length;
    default:
      return 1;
  }
}

/** The designer's pool warnings (from 30), and the limit a step would pass. */
export function poolWarnings(step: StepAssignees, action: StepAction, quorum: Quorum | null | undefined, counts: PoolCounts = {}): string[] {
  const known = step.assignees.map((r) => ruleEstimate(r, counts)).filter((n): n is number => n !== null);
  if (!known.length) return [];
  const total = known.reduce((s, n) => s + n, 0);
  const limit = poolLimit(action, quorum);
  if (total > limit) return [`تا ${faDigits(total)} نفر انجام‌دهندهٔ این مرحله می‌شوند؛ بیش از ${faDigits(limit)} نفر که باشند مرحله منتظر می‌ماند تا مسئولان گردش‌کار برگزینند`];
  if (total >= POOL_WARNING) return [`تا ${faDigits(total)} نفر انجام‌دهندهٔ این مرحله می‌شوند؛ برای هر نفر یک کار ساخته می‌شود`];
  return [];
}

/** Warnings about rules that can never find anyone (the requester rule on a step that excludes the requester). */
export function assigneeWarnings(step: StepAssignees, action: StepAction): string[] {
  const out: string[] = [];
  const excluded = exclusionsOf(step, action);
  if (excluded.includes("requester") && step.assignees.some((r) => r.kind === "requester")) out.push("درخواست‌دهنده از این مرحله کنار گذاشته شده است؛ قاعدهٔ «درخواست‌دهنده» کسی را نمی‌یابد");
  for (const r of step.assignees) {
    if (r.kind === "position" && r.members?.length && r.where !== "anywhere" && r.where !== "unit") out.push("«فقط این افراد» با محدودهٔ پویا یعنی «اگر در آن واحد باشند»؛ ممکن است برای پرونده‌ای کسی نماند");
  }
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------------------------------------------
// May a future step come to me? (a static check: my positions, groups, roles and named membership)

export interface PersonFacts {
  user: string;
  /** positions I hold now (key, unit) */
  positions: { position: string; unit: string | null }[];
  groups: string[];
  /** groups I lead */
  leadGroups?: string[];
  /** access roles I hold */
  roles: string[];
}

function ruleMayInclude(rule: AssigneeRule, me: PersonFacts): boolean {
  const listed = (m?: string[]) => !m?.length || m.includes(me.user);
  switch (rule.kind) {
    case "position":
      return listed(rule.members) && me.positions.some((p) => p.position === rule.position && (rule.where !== "unit" || p.unit === rule.unit));
    case "group":
      return listed(rule.members) && (rule.leadsOnly ? (me.leadGroups ?? []) : me.groups).includes(rule.group);
    case "role":
      return listed(rule.members) && me.roles.includes(rule.role);
    case "users":
      return rule.users.includes(me.user);
    default:
      // depends on the case (its requester, values, earlier actors): the server's dry run answers those
      return false;
  }
}

/**
 * Might the step come to the person, by a static check of their positions, groups, roles and named membership
 * (`mine_expected`)? Rules that depend on the case answer false here; the server asks the resolver instead.
 */
export function mayInclude(step: StepAssignees, action: StepAction, me: PersonFacts, requester?: string | null): boolean {
  const excluded = exclusionsOf(step, action);
  if (requester && excluded.includes("requester") && requester === me.user) return false;
  return step.assignees.some((r) => ruleMayInclude(r, me));
}
