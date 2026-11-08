// Pure logic of change enablement, shared by the server (hooks, services, jobs) and the screens (lifecycle bar,
// questionnaire, calendar, scheduling assistant): change models and their lifecycles, what each state requires and
// locks, the risk engine (questionnaire + profile factors → score, band and a Persian explanation), maintenance /
// blackout / freeze windows on the Jalali calendar, conflict detection, free slots, PIR and CAB requirements, the
// readiness check and team success scores. No server or React imports.
import type { Cond } from "../model/conditions";
import { addDays, monthLength, toJalali, weekday } from "../jalali";
import { localInstant, shiftsOf, type BusinessCalendar } from "../sla/calendar";
import {
  CHANGE_STATES, CONFLICT_KINDS, FAILED_CODES, RISK_LEVELS, RISK_ORDER, STATE_OPTIONS, WINDOW_KINDS,
  type ChangeState, type RiskLevel,
} from "../tables/change";

export type Row = Record<string, any>;

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

// ---------------------------------------------------------------------------------------------------------------
// Lifecycles

/** The forward order of the states (canceled is outside the order). */
export const STATE_ORDER: ChangeState[] = ["new", "assess", "authorize", "scheduled", "implement", "review", "closed"];
/** States every lifecycle has. */
export const FIXED_STATES: ChangeState[] = ["new", "closed", "canceled"];

/** The reference lifecycles of the built-in types (ITIL 4): used when a change has no model. */
export const DEFAULT_LIFECYCLES: Record<string, ChangeState[]> = {
  standard: ["new", "scheduled", "implement", "review", "closed", "canceled"],
  normal: ["new", "assess", "authorize", "scheduled", "implement", "review", "closed", "canceled"],
  emergency: ["new", "authorize", "implement", "review", "closed", "canceled"],
  latent: ["new", "review", "closed", "canceled"],
};

export const stateLabel = (s: unknown): string => CHANGE_STATES.states.find((x) => x.value === s)?.label ?? String(s ?? "—");
const orderOf = (s: string) => STATE_ORDER.indexOf(s as ChangeState);

/** The states a change uses: its model's (or snapshot's) states in lifecycle order, else its type's reference lifecycle. */
export function lifecycleOf(states: readonly string[] | null | undefined, type?: unknown): ChangeState[] {
  const known = new Set(STATE_OPTIONS.map((o) => o.value));
  const picked = (states ?? []).filter((s) => known.has(s));
  const base = picked.length ? picked : (DEFAULT_LIFECYCLES[String(type ?? "")] ?? DEFAULT_LIFECYCLES.normal);
  const set = new Set<string>([...base, ...FIXED_STATES]);
  return [...STATE_ORDER.filter((s) => set.has(s)), "canceled"];
}

/** The next state after `from` going forward in `lifecycle` (null at the end). */
export function nextState(lifecycle: readonly string[], from: string): ChangeState | null {
  const i = orderOf(from);
  if (i < 0) return null;
  for (const s of STATE_ORDER.slice(i + 1)) if (lifecycle.includes(s)) return s;
  return null;
}

/** Why the move `from` → `to` is not allowed by the lifecycle (Persian), or null. */
export function lifecycleProblem(lifecycle: readonly string[], from: string, to: string): string | null {
  if (to === "canceled") {
    if (from === "review" || from === "closed" || from === "canceled") return "تغییری که اجرا شده است لغو نمی‌شود";
    return null;
  }
  if (!lifecycle.includes(to)) return `مرحلهٔ «${stateLabel(to)}» در مدل این تغییر نیست`;
  if (!lifecycle.includes(from)) return null;
  if (orderOf(to) > orderOf(from)) {
    const next = nextState(lifecycle, from);
    if (next !== to) return `این تغییر پیش از «${stateLabel(to)}» باید مرحلهٔ «${stateLabel(next)}» را بگذراند`;
  }
  return null;
}

/** The steps of the lifecycle bar: every state of the lifecycle (not canceled) with where the change is. */
export function lifecycleSteps(lifecycle: readonly string[], current: string): { value: string; label: string; status: "done" | "current" | "todo" }[] {
  const steps = lifecycle.filter((s) => s !== "canceled");
  const at = orderOf(current);
  return steps.map((s) => ({
    value: s,
    label: stateLabel(s),
    status: s === current ? "current" : current === "canceled" ? "todo" : orderOf(s) < at ? "done" : "todo",
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// What a state requires and locks

/** Fields a change needs to enter each state (a model's `requirements` replaces a state's list). */
export const DEFAULT_REQUIREMENTS: Record<string, string[]> = {
  assess: ["short_description", "description", "justification", "assignment_group_id", "planned_start", "planned_end"],
  authorize: ["short_description", "description", "justification", "assignment_group_id", "planned_start", "planned_end", "implementation_plan", "backout_plan", "test_plan"],
  scheduled: ["assignment_group_id", "planned_start", "planned_end", "implementation_plan", "backout_plan"],
  implement: ["assignment_group_id", "planned_start", "planned_end", "implementation_plan", "backout_plan"],
  review: ["close_code", "actual_start", "actual_end"],
  closed: ["close_code", "close_notes"],
  canceled: ["close_notes"],
};
/** Documentation an emergency change («مستندسازی پس از اجرا») may complete after implementation, before closing. */
export const DEFERRED_DOCS = ["description", "implementation_plan", "backout_plan", "test_plan", "planned_start", "planned_end"];

/** Fields locked from a state on (cumulative along the lifecycle); a model's `locks` replaces a state's list. */
export const DEFAULT_LOCKS: Record<string, string[]> = {
  scheduled: ["type", "model_id", "template_id"],
  implement: ["planned_start", "planned_end", "implementation_plan", "backout_plan", "test_plan", "affected_cis", "affected_services", "ci_id", "service_id", "risk_answers", "maintenance_window_id"],
  review: ["assignment_group_id", "outage_expected", "outage_minutes", "cab_id"],
};

/** Edits that, once a change is authorized, need its authorization again. */
export const REAUTH_FIELDS = ["planned_start", "planned_end", "implementation_plan", "backout_plan", "test_plan", "affected_cis", "affected_services", "ci_id", "service_id", "risk"];

export interface ModelLike {
  states?: string[] | null;
  docs_deferred?: boolean | null;
  requirements?: Record<string, unknown> | null;
  locks?: Record<string, unknown> | null;
  lead_time_exempt?: boolean | null;
  cab_policy?: string | null;
  pir_policy?: string | null;
}

const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^[a-z][a-z0-9_]*$/.test(x)) : []);

/** The fields a change must have to enter `state` under its model (deferred documentation moves to review/closed). */
export function requiredFor(state: string, model: ModelLike | null | undefined, type?: unknown): string[] {
  const custom = model?.requirements && typeof model.requirements === "object" ? model.requirements[state] : undefined;
  let list = Array.isArray(custom) ? strList(custom) : [...(DEFAULT_REQUIREMENTS[state] ?? [])];
  const deferred = model ? !!model.docs_deferred : type === "emergency";
  if (deferred) {
    if (state === "review" || state === "closed") list = [...list, ...DEFERRED_DOCS];
    else list = list.filter((f) => !DEFERRED_DOCS.includes(f));
  }
  if (type === "latent" && state === "review") list = [...list, "justification"];
  return [...new Set(list)];
}

/** The fields locked in `state` (cumulative: a state's locks hold in every later state). */
export function lockedIn(state: string, model: ModelLike | null | undefined): string[] {
  const at = orderOf(state);
  if (at < 0) return [];
  const out = new Set<string>();
  for (const s of STATE_ORDER.slice(0, at + 1)) {
    const custom = model?.locks && typeof model.locks === "object" ? model.locks[s] : undefined;
    for (const f of Array.isArray(custom) ? strList(custom) : (DEFAULT_LOCKS[s] ?? [])) out.add(f);
  }
  return [...out];
}

const empty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v as object).length);

/** The required fields of `state` the row leaves empty. */
export function missingFor(state: string, row: Row, model: ModelLike | null | undefined): string[] {
  return requiredFor(state, model, row.type).filter((f) => empty(row[f]));
}

// ---------------------------------------------------------------------------------------------------------------
// Risk

export interface RiskOption {
  value: string;
  label: string;
  /** 0 (no risk) … 10 */
  score: number;
  /** number questions: the highest answer this option covers (the last option covers the rest) */
  max?: number | null;
}

export interface RiskQuestion {
  id: string;
  question: string;
  kind: "choice" | "yes_no" | "number";
  options: RiskOption[];
  weight: number;
  mandatory?: boolean;
  change_types?: string[] | null;
  condition?: Cond | null;
  active?: boolean;
  sort_order?: number;
  help?: string | null;
}

export interface RiskBands {
  risk_moderate_from: number;
  risk_high_from: number;
  risk_very_high_from: number;
  questionnaire_weight: number;
}

export interface RiskFactor {
  key: string;
  label: string;
  /** 0 … 100 */
  score: number;
  weight: number;
  detail: string;
}

export interface RiskResult {
  score: number;
  level: RiskLevel;
  questionnaire: { score: number | null; answered: number; total: number; missing: string[] };
  profile: number;
  factors: RiskFactor[];
  answers: { id: string; question: string; answer: string; score: number; weight: number }[];
}

export const riskLabel = (v: unknown): string => RISK_LEVELS.find((o) => o.value === v)?.label ?? "—";
export const riskRank = (v: unknown): number => Math.max(0, RISK_ORDER.indexOf(v as RiskLevel));

/** The level of a 0–100 score under the organisation's bands. */
export function bandOf(score: number, b: RiskBands): RiskLevel {
  if (score >= b.risk_very_high_from) return "very_high";
  if (score >= b.risk_high_from) return "high";
  if (score >= b.risk_moderate_from) return "moderate";
  return "low";
}

/** Options of a question (yes/no questions get «بله» 10 / «خیر» 0 when they name none). */
export function optionsOf(q: Pick<RiskQuestion, "kind" | "options">): RiskOption[] {
  const raw = Array.isArray(q.options) ? q.options : [];
  const clean = raw
    .filter((o) => o && typeof o === "object" && (typeof o.value === "string" || typeof o.value === "number"))
    .map((o) => {
      const max = (o as { max?: unknown }).max;
      return { value: String(o.value), label: String(o.label ?? o.value), score: clamp(Number(o.score) || 0, 0, 10), max: max === null || max === undefined || max === "" ? null : Number(max) };
    });
  if (q.kind === "yes_no" && !clean.length) return [{ value: "yes", label: "بله", score: 10 }, { value: "no", label: "خیر", score: 0 }];
  return clean;
}

/** The option an answer picks (number questions: the first option whose `max` covers the number). */
export function answerOption(q: Pick<RiskQuestion, "kind" | "options">, answer: unknown): RiskOption | null {
  if (answer === null || answer === undefined || answer === "") return null;
  const opts = optionsOf(q);
  if (q.kind === "number") {
    const n = Number(String(answer).replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))));
    if (!Number.isFinite(n)) return null;
    return opts.find((o) => o.max === null || o.max === undefined || n <= Number(o.max)) ?? opts[opts.length - 1] ?? null;
  }
  return opts.find((o) => o.value === String(answer)) ?? null;
}

/** Questions that apply to a change (active, its type, their condition when an evaluator is given). */
export function applicableQuestions(questions: readonly RiskQuestion[], change: Row, holds?: (c: Cond) => boolean): RiskQuestion[] {
  return questions
    .filter((q) => q.active !== false)
    .filter((q) => !q.change_types?.length || q.change_types.includes(String(change.type ?? "")))
    .filter((q) => !q.condition || !holds || holds(q.condition))
    .sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100) || a.question.localeCompare(b.question, "fa"));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

const IMPACT_SCORE: Record<string, number> = { "1": 100, "2": 55, "3": 15 };

/**
 * The risk of a change: the questionnaire (weighted answer scores) and the risk profile (automatic factors, each
 * 0–100 with a weight), combined by the organisation's share of the questionnaire, mapped to its bands.
 */
export function computeRisk(input: { change: Row; questions: readonly RiskQuestion[]; answers: Record<string, unknown> | null | undefined; teamScore?: number | null; bands: RiskBands }): RiskResult {
  const c = input.change;
  const answers = input.answers && typeof input.answers === "object" ? input.answers : {};
  let got = 0;
  let max = 0;
  const missing: string[] = [];
  const picked: RiskResult["answers"] = [];
  for (const q of input.questions) {
    const w = clamp(Number(q.weight) || 0, 0, 10);
    const o = answerOption(q, answers[q.id]);
    if (!o) {
      if (q.mandatory !== false) missing.push(q.question);
      continue;
    }
    got += o.score * w;
    max += 10 * w;
    picked.push({ id: q.id, question: q.question, answer: q.kind === "number" ? String(answers[q.id]) : o.label, score: o.score, weight: w });
  }
  const qScore = max > 0 ? Math.round((100 * got) / max) : null;

  const cis = new Set<string>([...(Array.isArray(c.affected_cis) ? c.affected_cis : []), ...(c.ci_id ? [c.ci_id] : [])]);
  const services = new Set<string>([...(Array.isArray(c.affected_services) ? c.affected_services : []), ...(Array.isArray(c.impacted_services) ? c.impacted_services : []), ...(c.service_id ? [c.service_id] : [])]);
  const breadth = cis.size + services.size;
  const plans = ["implementation_plan", "backout_plan", "test_plan"].filter((f) => empty(c[f]));
  const conflicts = Number(c.conflict_count) || 0;
  const factors: RiskFactor[] = [
    { key: "impact", label: "اثر تغییر", weight: 20, score: IMPACT_SCORE[String(c.impact ?? "3")] ?? 15, detail: `اثر «${String(c.impact ?? "3") === "1" ? "زیاد" : String(c.impact) === "2" ? "متوسط" : "کم"}»` },
    {
      key: "breadth", label: "گستردگی (پیکربندی و خدمت)", weight: 15,
      score: breadth === 0 ? 20 : breadth === 1 ? 20 : breadth <= 3 ? 40 : breadth <= 9 ? 70 : 100,
      detail: breadth ? `${breadth} پیکربندی و خدمت متأثر` : "پیکربندی یا خدمتی مشخص نشده است",
    },
    { key: "documentation", label: "کامل بودن برنامه‌ها", weight: 15, score: Math.round((plans.length / 3) * 100), detail: plans.length ? `${plans.length} برنامه از سه برنامهٔ اجرا، بازگشت و آزمون خالی است` : "برنامه‌های اجرا، بازگشت و آزمون نوشته شده‌اند" },
    {
      key: "backout", label: "آمادگی بازگشت", weight: 10,
      score: empty(c.backout_plan) ? 100 : c.backout_tested ? 0 : 60,
      detail: empty(c.backout_plan) ? "برنامهٔ بازگشت ندارد" : c.backout_tested ? "برنامهٔ بازگشت آزموده شده است" : "برنامهٔ بازگشت آزموده نشده است",
    },
    {
      key: "outage", label: "قطعی خدمت", weight: 10,
      score: c.outage_expected ? (Number(c.outage_minutes) > 60 ? 100 : 70) : 0,
      detail: c.outage_expected ? `قطعی پیش‌بینی‌شده${Number(c.outage_minutes) ? ` (${Number(c.outage_minutes)} دقیقه)` : ""}` : "قطعی پیش‌بینی نمی‌شود",
    },
    {
      key: "schedule", label: "زمان‌بندی", weight: 15,
      score: c.in_blackout ? 100 : c.outside_window ? 60 : c.is_late ? 50 : 0,
      detail: c.in_blackout ? "در دورهٔ ممنوعیت یا انجماد" : c.outside_window ? "بیرون از پنجرهٔ نگهداری" : c.is_late ? "کمتر از مهلت اعلام" : "در زمان مناسب",
    },
    { key: "conflicts", label: "تداخل با تغییرهای دیگر", weight: 5, score: conflicts ? Math.min(100, 40 + 20 * conflicts) : 0, detail: conflicts ? `${conflicts} تداخل باز` : "بدون تداخل باز" },
    {
      key: "team", label: "سابقهٔ موفقیت تیم مجری", weight: 10,
      score: input.teamScore === null || input.teamScore === undefined ? 30 : clamp(100 - Number(input.teamScore), 0, 100),
      detail: input.teamScore === null || input.teamScore === undefined ? "سابقه‌ای ثبت نشده است" : `امتیاز موفقیت تیم ${Math.round(Number(input.teamScore))}`,
    },
    { key: "type", label: "نوع تغییر", weight: 10, score: c.type === "emergency" ? 80 : c.type === "standard" ? 0 : 20, detail: c.type === "emergency" ? "اضطراری (آزمون و آماده‌سازی کمتر)" : c.type === "standard" ? "استاندارد" : "عادی" },
  ];
  const wsum = factors.reduce((n, f) => n + f.weight, 0);
  const profile = Math.round(factors.reduce((n, f) => n + f.score * f.weight, 0) / wsum);
  const share = clamp(Number(input.bands.questionnaire_weight) || 0, 0, 100) / 100;
  const score = clamp(Math.round(qScore === null ? profile : share * qScore + (1 - share) * profile), 0, 100);
  return {
    score,
    level: bandOf(score, input.bands),
    questionnaire: { score: qScore, answered: picked.length, total: input.questions.length, missing },
    profile,
    factors,
    answers: picked,
  };
}

/** A Persian explanation of a risk result: what weighed most (deterministic; the AI layer may narrate further). */
export function explainRisk(r: RiskResult, opts: { manual?: { level: string; reason?: string | null } | null } = {}): string {
  const lines: string[] = [];
  lines.push(`ریسک محاسبه‌شده «${riskLabel(r.level)}» است (امتیاز ${r.score} از ۱۰۰).`);
  if (opts.manual && opts.manual.level !== r.level) lines.push(`ریسک به‌دست کارشناس «${riskLabel(opts.manual.level)}» تعیین شده است${opts.manual.reason ? `: ${opts.manual.reason}` : ""}.`);
  const top = [...r.factors].map((f) => ({ f, c: f.score * f.weight })).filter((x) => x.f.score >= 40).sort((a, b) => b.c - a.c).slice(0, 3);
  if (top.length) {
    lines.push("", "**عامل‌های اثرگذار:**");
    for (const { f } of top) lines.push(`- ${f.label}: ${f.detail}`);
  }
  if (r.questionnaire.score !== null) {
    lines.push("", `**پرسش‌نامه:** امتیاز ${r.questionnaire.score} از ۱۰۰ با ${r.questionnaire.answered} پاسخ از ${r.questionnaire.total} پرسش.`);
    const heavy = [...r.answers].filter((a) => a.score >= 6).sort((a, b) => b.score * b.weight - a.score * a.weight).slice(0, 3);
    for (const a of heavy) lines.push(`- ${a.question} ← ${a.answer}`);
  } else if (r.questionnaire.total) {
    lines.push("", "پرسش‌نامهٔ ارزیابی ریسک هنوز پر نشده است؛ ریسک فقط از عامل‌های خودکار حساب شده است.");
  }
  if (r.questionnaire.missing.length) lines.push("", `${r.questionnaire.missing.length} پرسش لازم بی‌پاسخ مانده است.`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Windows on the Jalali calendar

export interface WindowLike {
  id: string;
  name?: string;
  kind: string;
  active?: boolean;
  start_at: string;
  end_at: string;
  recurrence?: string | null;
  weekdays?: string[] | null;
  until?: string | null;
  enforcement?: string | null;
  exempt_emergency?: boolean | null;
  change_types?: string[] | null;
  services?: string[] | null;
  cis?: string[] | null;
  scope_condition?: Cond | null;
}

export interface Occurrence {
  window_id: string;
  name: string;
  kind: string;
  enforcement: string;
  start: number;
  end: number;
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
/** Local calendar date (ISO) and minutes after midnight of an instant in `tz`. */
export function localParts(ms: number, tz: string): { date: string; minutes: number } {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    partsCache.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

const msOf = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const t = typeof v === "number" ? v : Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
};

/** Does local date `d` start an occurrence of a recurring window first starting on `first`? */
function recurs(w: WindowLike, first: string, d: string): boolean {
  if (d < first) return false;
  if (w.until && d > String(w.until).slice(0, 10)) return false;
  switch (w.recurrence) {
    case "daily":
      return true;
    case "weekly": {
      const days = (w.weekdays ?? []).map(Number).filter((n) => n >= 0 && n <= 6);
      return (days.length ? days : [weekday(first)]).includes(weekday(d));
    }
    case "monthly":
      return toJalali(d).jd === toJalali(first).jd;
    case "monthly_last": {
      const j = toJalali(d);
      return j.jd === monthLength(j.jy, j.jm);
    }
    case "yearly": {
      const a = toJalali(d);
      const b = toJalali(first);
      return a.jm === b.jm && a.jd === b.jd;
    }
    default:
      return d === first;
  }
}

/** The occurrences of a window that intersect [from, to) (at most `limit`), in the window's organisation zone. */
export function occurrences(w: WindowLike, from: number, to: number, tz: string, limit = 500): Occurrence[] {
  if (w.active === false) return [];
  const s0 = msOf(w.start_at);
  const e0 = msOf(w.end_at);
  if (s0 === null || e0 === null || e0 <= s0 || to <= from) return [];
  const length = e0 - s0;
  const base = { window_id: w.id, name: String(w.name ?? ""), kind: w.kind, enforcement: w.enforcement === "warn" ? "warn" : "block" };
  if (!w.recurrence || w.recurrence === "none") return s0 < to && e0 > from ? [{ ...base, start: s0, end: e0 }] : [];
  const { date: first, minutes } = localParts(s0, tz);
  const out: Occurrence[] = [];
  // occurrences starting up to `length` before `from` still reach into the range
  let d = localParts(Math.max(s0, from - length), tz).date;
  const last = localParts(to, tz).date;
  for (let guard = 0; d <= last && guard < 4000 && out.length < limit; guard++, d = addDays(d, 1)) {
    if (!recurs(w, first, d)) continue;
    const s = localInstant(d, minutes, tz);
    const e = s + length;
    if (s < to && e > from) out.push({ ...base, start: s, end: e });
  }
  return out;
}

/** The CIs and services a change touches (primary + affected + computed). */
export function scopeOf(c: Row): { cis: string[]; services: string[] } {
  const cis = new Set<string>([...(Array.isArray(c.affected_cis) ? c.affected_cis : []), ...(c.ci_id ? [String(c.ci_id)] : [])]);
  const services = new Set<string>([
    ...(Array.isArray(c.affected_services) ? c.affected_services : []),
    ...(Array.isArray(c.impacted_services) ? c.impacted_services : []),
    ...(c.service_id ? [String(c.service_id)] : []),
  ]);
  return { cis: [...cis], services: [...services] };
}

/** Is a window scoped to particular CIs, services or a condition (rather than to every change)? */
export const scopedWindow = (w: WindowLike): boolean => !!(w.services?.length || w.cis?.length || w.scope_condition);

/** Does a window apply to a change (its types, emergency exemption, its CIs, services or condition)? */
export function windowApplies(w: WindowLike, c: Row, holds?: (cond: Cond) => boolean): boolean {
  if (w.active === false) return false;
  if (w.change_types?.length && !w.change_types.includes(String(c.type ?? ""))) return false;
  if ((w.kind === "blackout" || w.kind === "freeze") && w.exempt_emergency !== false && c.type === "emergency") return false;
  if (!scopedWindow(w)) return true;
  const s = scopeOf(c);
  if (w.cis?.some((x) => s.cis.includes(x))) return true;
  if (w.services?.some((x) => s.services.includes(x))) return true;
  return !!w.scope_condition && !!holds && holds(w.scope_condition);
}

export const windowKindLabel = (k: unknown): string => WINDOW_KINDS.find((o) => o.value === k)?.label ?? String(k ?? "");

// ---------------------------------------------------------------------------------------------------------------
// Conflicts

export interface ConflictFound {
  key: string;
  kind: string;
  summary: string;
  other_change_id?: string | null;
  window_id?: string | null;
  lockdown_id?: string | null;
  ci_id?: string | null;
  service_id?: string | null;
  overlap_start: number;
  overlap_end: number;
}

export interface LockdownLike {
  id: string;
  title?: string;
  number?: string | null;
  starts_at: string;
  ends_at?: string | null;
  services?: string[] | null;
  cis?: string[] | null;
  scope_condition?: Cond | null;
}

/** States of other changes that can collide (drafts and finished changes do not). */
export const CONFLICTING_STATES = ["assess", "authorize", "scheduled", "implement"];

export const conflictLabel = (k: unknown): string => CONFLICT_KINDS.find((o) => o.value === k)?.label ?? String(k ?? "");

/** Does a lockdown hold a change (its scope, or every non-emergency change when unscoped)? */
export function lockdownApplies(l: LockdownLike, c: Row, holds?: (cond: Cond) => boolean): boolean {
  if (c.type === "emergency") return false;
  const scoped = !!(l.services?.length || l.cis?.length || l.scope_condition);
  if (!scoped) return true;
  const s = scopeOf(c);
  if (l.cis?.some((x) => s.cis.includes(x))) return true;
  if (l.services?.some((x) => s.services.includes(x))) return true;
  return !!l.scope_condition && !!holds && holds(l.scope_condition);
}

/**
 * The conflicts of change `c` in its planned window: other changes on the same CIs, services, dependent CIs
 * (`related`: CI → its neighbours from the CMDB) or implementer; blackout and freeze occurrences; maintenance windows
 * of its CIs/services (or the one it chose) that do not contain it; active lockdowns. Keys are stable, so a person's
 * review of a conflict survives the next run.
 */
export function detectConflicts(input: {
  change: Row;
  others: readonly Row[];
  occurrences: readonly (Occurrence & { scoped: boolean; applies: boolean })[];
  lockdowns?: readonly (LockdownLike & { applies: boolean })[];
  related?: ReadonlyMap<string, readonly string[]>;
  tzDate?: (ms: number) => string;
}): ConflictFound[] {
  const c = input.change;
  const s = msOf(c.planned_start);
  const e = msOf(c.planned_end);
  if (s === null || e === null || e <= s || c.exclude_conflicts) return [];
  const out: ConflictFound[] = [];
  const mine = scopeOf(c);
  const no = (r: Row) => String(r.number ?? "").trim() || "تغییر دیگر";
  for (const o of input.others) {
    if (o.id === c.id || o.exclude_conflicts || !CONFLICTING_STATES.includes(String(o.state))) continue;
    const os = msOf(o.planned_start);
    const oe = msOf(o.planned_end);
    if (os === null || oe === null || os >= e || oe <= s) continue;
    const from = Math.max(s, os);
    const to = Math.min(e, oe);
    const theirs = scopeOf(o);
    const sharedCis = mine.cis.filter((x) => theirs.cis.includes(x));
    for (const ci of sharedCis) out.push({ key: `same_ci:${o.id}:${ci}`, kind: "same_ci", summary: `همان پیکربندی با ${no(o)}`, other_change_id: o.id, ci_id: ci, overlap_start: from, overlap_end: to });
    if (!sharedCis.length) {
      const sharedServices = mine.services.filter((x) => theirs.services.includes(x));
      for (const sv of sharedServices) out.push({ key: `same_service:${o.id}:${sv}`, kind: "same_service", summary: `همان خدمت با ${no(o)}`, other_change_id: o.id, service_id: sv, overlap_start: from, overlap_end: to });
      if (!sharedServices.length && input.related) {
        const hit = mine.cis.find((ci) => (input.related!.get(ci) ?? []).some((n) => theirs.cis.includes(n)));
        if (hit) out.push({ key: `related_ci:${o.id}:${hit}`, kind: "related_ci", summary: `پیکربندی وابسته در ${no(o)}`, other_change_id: o.id, ci_id: hit, overlap_start: from, overlap_end: to });
      }
    }
    if (c.assigned_to && o.assigned_to === c.assigned_to) out.push({ key: `assignee_busy:${o.id}`, kind: "assignee_busy", summary: `مجری هم‌زمان در ${no(o)}`, other_change_id: o.id, overlap_start: from, overlap_end: to });
  }
  const day = input.tzDate ?? ((ms: number) => new Date(ms).toISOString().slice(0, 10));
  const maintenance: (Occurrence & { scoped: boolean; applies: boolean })[] = [];
  const chosen = c.maintenance_window_id ? String(c.maintenance_window_id) : null;
  let hasMaintenance = false;
  for (const occ of input.occurrences) {
    if (occ.kind === "maintenance") {
      if (occ.window_id === chosen || (occ.scoped && occ.applies)) {
        hasMaintenance = true;
        maintenance.push(occ);
      }
      continue;
    }
    if ((occ.kind !== "blackout" && occ.kind !== "freeze") || !occ.applies) continue;
    if (occ.start >= e || occ.end <= s) continue;
    out.push({
      key: `${occ.kind}:${occ.window_id}:${day(occ.start)}`, kind: occ.kind, summary: `${occ.kind === "freeze" ? "انجماد" : "ممنوعیت"}: ${occ.name}`,
      window_id: occ.window_id, overlap_start: Math.max(s, occ.start), overlap_end: Math.min(e, occ.end),
    });
  }
  if (hasMaintenance && !maintenance.some((m) => m.start <= s && m.end >= e)) {
    const w = maintenance.find((m) => m.window_id === chosen) ?? maintenance[0];
    out.push({ key: `outside_window:${w.window_id}`, kind: "outside_window", summary: `بیرون از پنجرهٔ نگهداری «${w.name}»`, window_id: w.window_id, overlap_start: s, overlap_end: e });
  }
  for (const l of input.lockdowns ?? []) {
    if (!l.applies) continue;
    const ls = msOf(l.starts_at) ?? 0;
    const le = msOf(l.ends_at) ?? Number.MAX_SAFE_INTEGER;
    if (ls >= e || le <= s) continue;
    out.push({ key: `lockdown:${l.id}`, kind: "lockdown", summary: `قرنطینه: ${l.title ?? l.number ?? ""}`.trim(), lockdown_id: l.id, overlap_start: Math.max(s, ls), overlap_end: Math.min(e, le === Number.MAX_SAFE_INTEGER ? e : le) });
  }
  return out;
}

/** The change's conflict state from its conflict rows (active ones; reviewed = ignored or resolved). */
export function conflictState(rows: readonly { active?: boolean; status?: string }[]): { status: "none" | "conflict" | "acknowledged"; open: number } {
  const live = rows.filter((r) => r.active !== false);
  const open = live.filter((r) => r.status !== "ignored" && r.status !== "resolved").length;
  return { status: !live.length ? "none" : open ? "conflict" : "acknowledged", open };
}

// ---------------------------------------------------------------------------------------------------------------
// Free slots (the scheduling assistant)

type Interval = [number, number];

function mergeIntervals(list: Interval[]): Interval[] {
  const xs = list.filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const [a, b] of xs) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** `allowed` minus `blocked`. */
export function subtract(allowed: Interval[], blocked: Interval[]): Interval[] {
  const bl = mergeIntervals(blocked);
  const out: Interval[] = [];
  for (const [a, b] of mergeIntervals(allowed)) {
    let cur = a;
    for (const [x, y] of bl) {
      if (y <= cur || x >= b) continue;
      if (x > cur) out.push([cur, x]);
      cur = Math.max(cur, y);
      if (cur >= b) break;
    }
    if (cur < b) out.push([cur, b]);
  }
  return out;
}

/**
 * Candidate slots of `duration` ms: inside `allowed` (maintenance occurrences, working time; null = any time) from
 * `earliest`, avoiding `blocked` (blackouts, freezes, busy CIs and implementers), at most `limit`, earliest first.
 */
export function findSlots(o: { duration: number; earliest: number; until: number; allowed: Interval[] | null; blocked: Interval[]; limit?: number }): Interval[] {
  if (o.duration <= 0 || o.until <= o.earliest) return [];
  const allowed = (o.allowed ?? [[o.earliest, o.until]]).map(([a, b]) => [Math.max(a, o.earliest), Math.min(b, o.until)] as Interval);
  const free = subtract(allowed, o.blocked);
  const out: Interval[] = [];
  for (const [a, b] of free) {
    if (b - a < o.duration) continue;
    out.push([a, a + o.duration]);
    if (out.length >= (o.limit ?? 5)) break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Lead time

/** Working days (days with working time on the calendar) strictly after `from`'s local day up to `to`'s local day. */
export function businessDaysBetween(cal: BusinessCalendar, from: number, to: number): number {
  if (to <= from) return 0;
  let d = localParts(from, cal.tz).date;
  const last = localParts(to, cal.tz).date;
  let n = 0;
  for (let guard = 0; guard < 800; guard++) {
    d = addDays(d, 1);
    if (d > last) break;
    if (shiftsOf(cal, d).length) n++;
  }
  return n;
}

/** The notice a change of `risk` needs (working days) under the settings. */
export function leadDaysFor(risk: unknown, cfg: { lead_days_low: number; lead_days_moderate: number; lead_days_high: number; lead_days_very_high: number }): number {
  switch (risk) {
    case "very_high":
      return Number(cfg.lead_days_very_high) || 0;
    case "high":
      return Number(cfg.lead_days_high) || 0;
    case "moderate":
      return Number(cfg.lead_days_moderate) || 0;
    default:
      return Number(cfg.lead_days_low) || 0;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// CAB and PIR requirements, readiness, success scores

/** Does a change need the CAB (or the ECAB for emergencies)? */
export function cabRequired(c: Row, model: ModelLike | null | undefined, cabRisks: readonly string[]): boolean {
  if (model?.cab_policy === "never") return false;
  if (model?.cab_policy === "always") return true;
  if (c.type === "emergency") return true;
  if (c.type === "standard" || c.type === "latent") return false;
  return cabRisks.includes(String(c.risk ?? ""));
}

/** Why a change needs a post-implementation review (empty: it does not). */
export function pirReasons(c: Row, model: ModelLike | null | undefined, wanted: readonly string[]): string[] {
  if (model?.pir_policy === "never") return [];
  const out: string[] = [];
  if (model?.pir_policy === "always") out.push("policy");
  if (wanted.includes("emergency") && c.type === "emergency") out.push("emergency");
  if (wanted.includes("failed") && FAILED_CODES.includes(String(c.close_code ?? ""))) out.push("failed");
  if (wanted.includes("high_risk") && (c.risk === "high" || c.risk === "very_high")) out.push("high_risk");
  return out;
}

export interface ReadinessCheck {
  key: string;
  label: string;
  ok: boolean;
  kind: "change" | "docs";
}

/** Deterministic readiness of a change for authorization (catalogue CHG-070; the AI layer adds a quality rubric). */
export function readiness(c: Row, opts: { unansweredQuestions?: number } = {}): { checks: ReadinessCheck[]; score: number; status: "complete" | "incomplete_change" | "incomplete_docs" | "incomplete" } {
  const s = scopeOf(c);
  const checks: ReadinessCheck[] = [
    { key: "scope", label: "خدمت یا پیکربندی متأثر مشخص است", ok: s.cis.length + s.services.length > 0, kind: "change" },
    { key: "window", label: "زمان شروع و پایان برنامه‌ریزی شده است", ok: !!msOf(c.planned_start) && !!msOf(c.planned_end) && msOf(c.planned_end)! > msOf(c.planned_start)!, kind: "change" },
    { key: "group", label: "گروه مجری تعیین شده است", ok: !empty(c.assignment_group_id), kind: "change" },
    { key: "justification", label: "توجیه کسب‌وکاری نوشته شده است", ok: String(c.justification ?? "").trim().length >= 20, kind: "change" },
    { key: "outcome", label: "نتیجه و منافع مورد انتظار روشن است", ok: !empty(c.expected_outcome), kind: "change" },
    { key: "risk", label: "پرسش‌نامهٔ ریسک کامل است", ok: !opts.unansweredQuestions, kind: "change" },
    { key: "implementation", label: "برنامهٔ اجرا به‌قدر کافی روشن است", ok: String(c.implementation_plan ?? "").trim().length >= 40, kind: "docs" },
    { key: "backout", label: "برنامهٔ بازگشت نوشته شده است", ok: String(c.backout_plan ?? "").trim().length >= 20, kind: "docs" },
    { key: "backout_tested", label: "برنامهٔ بازگشت آزموده شده است", ok: !!c.backout_tested, kind: "docs" },
    { key: "test", label: "برنامهٔ آزمون نوشته شده است", ok: String(c.test_plan ?? "").trim().length >= 20, kind: "docs" },
  ];
  const score = Math.round((100 * checks.filter((x) => x.ok).length) / checks.length);
  const badChange = checks.some((x) => !x.ok && x.kind === "change");
  const badDocs = checks.some((x) => !x.ok && x.kind === "docs");
  return { checks, score, status: badChange && badDocs ? "incomplete" : badChange ? "incomplete_change" : badDocs ? "incomplete_docs" : "complete" };
}

export interface ScoreInput {
  implemented: number;
  successful: number;
  with_issues: number;
  failed: number;
  caused_incidents: number;
  emergency: number;
}

/** A team's change success score (0–100) and band: success counts, issues half, caused incidents and a high emergency share cost. */
export function successScore(c: ScoreInput): { score: number | null; band: "excellent" | "good" | "fair" | "poor" | null } {
  if (!c.implemented) return { score: null, band: null };
  const base = ((c.successful + 0.6 * c.with_issues) / c.implemented) * 100;
  const incidents = Math.min(30, (c.caused_incidents / c.implemented) * 50);
  const emergency = Math.max(0, c.emergency / c.implemented - 0.1) * 50;
  const score = clamp(Math.round(base - incidents - emergency), 0, 100);
  return { score, band: score >= 90 ? "excellent" : score >= 75 ? "good" : score >= 60 ? "fair" : "poor" };
}

/** Progress of a Markdown checklist («- [ ] …» / «- [x] …»). */
export function checklistProgress(md: unknown): { done: number; total: number } {
  const lines = String(md ?? "").split(/\r?\n/);
  let done = 0;
  let total = 0;
  for (const l of lines) {
    const m = /^\s*[-*]\s+\[( |x|X)\]/.exec(l);
    if (!m) continue;
    total++;
    if (m[1] !== " ") done++;
  }
  return { done, total };
}

/** Ordering of a CAB agenda: highest risk first, then the earliest planned start. */
export function agendaOrder(a: Row, b: Row): number {
  return riskRank(b.risk) - riskRank(a.risk) || (msOf(a.planned_start) ?? Infinity) - (msOf(b.planned_start) ?? Infinity) || String(a.number ?? "").localeCompare(String(b.number ?? ""));
}

/** The next meeting of a CAB that meets every week on `weekday` (0 = Saturday) at `time`, from `after` (instants). */
export function nextMeeting(weekdayNo: number, time: string, minutes: number, after: number, tz: string): { start: number; end: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time ?? "").trim());
  if (!m || !(weekdayNo >= 0 && weekdayNo <= 6)) return null;
  const at = Number(m[1]) * 60 + Number(m[2]);
  let d = localParts(after, tz).date;
  for (let i = 0; i < 15; i++, d = addDays(d, 1)) {
    if (weekday(d) !== weekdayNo) continue;
    const start = localInstant(d, at, tz);
    if (start > after) return { start, end: start + Math.max(15, minutes || 60) * MINUTE };
  }
  return null;
}

/** «۲ ساعت و ۳۰ دقیقه» */
export function humanSpan(ms: number): string {
  const total = Math.max(0, Math.round(ms / MINUTE));
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d} روز`);
  if (h) parts.push(`${h} ساعت`);
  if (m || !parts.length) parts.push(`${m} دقیقه`);
  return parts.join(" و ");
}

export { MINUTE, HOUR, DAY };
