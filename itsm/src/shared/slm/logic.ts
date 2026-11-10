// Pure logic of service level management (shared by the server and the screens): lifecycle ↔ the portfolio's status,
// compliance and its status against the goal and the warning level, Jalali review periods, availability from daily
// figures, service credits, experience measures (CSAT, NPS, CES, happiness) with small-group suppression, XLA scores,
// the watermelon gap, target recommendations and what-if replays from finished timers, the empirical breach
// probability of a running timer, the rule-based narrative and improvement suggestions of a review pack, and the
// Persian agreement document. No I/O here.
import { addUnits, bucketKey, bucketLabel, unitStart, type DateUnit } from "../model/jalali-buckets";
import { formatJalali } from "../jalali";
import { faDigits } from "../format";
import { AGREEMENT_IN_FORCE, AGREEMENT_STATES, METRIC_CATEGORIES, TARGET_KINDS, XLA_CLAUSES } from "../tables/slm";

type Row = Record<string, any>;

// ---------------------------------------------------------------------------------------------------------------
// Lifecycle

export const stateCategoryOf = (state: unknown): string | null => AGREEMENT_STATES.states.find((s) => s.value === state)?.category ?? null;
export const inForce = (state: unknown): boolean => AGREEMENT_IN_FORCE.includes(String(state));

/** The portfolio's status of an agreement in a lifecycle state: in force → active, ended → expired, else draft. */
export function statusFromState(state: unknown): "active" | "expired" | "draft" {
  const cat = stateCategoryOf(state);
  if (cat === "active") return "active";
  if (cat === "closed") return "expired";
  return "draft";
}

/** The lifecycle state an agreement created (or imported) with a portfolio status starts in. */
export function stateFromStatus(status: unknown): string | null {
  if (status === "active") return "active";
  if (status === "expired") return "expired";
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Numbers

export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[٬,]/g, ""));
  return Number.isFinite(n) ? n : null;
};
export const round = (n: number, dp = 1): number => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/** Met ÷ (met + breached) × 100, or null without finished records. */
export function compliancePct(met: number, breached: number): number | null {
  const all = met + breached;
  return all > 0 ? round((met / all) * 100, 2) : null;
}

export type ComplianceStatus = "met" | "at_risk" | "missed" | "no_data";

/**
 * Status of a measured value against the goal (below → missed) and the warning level (below it but at or above the
 * goal → at risk). Higher is better for every target kind of the module (percentages and scores).
 */
export function complianceStatus(value: number | null, goal: number | null, atRisk: number | null): ComplianceStatus {
  if (value === null || !Number.isFinite(value)) return "no_data";
  if (goal === null) return "met";
  if (value < goal) return "missed";
  if (atRisk !== null && atRisk > goal && value < atRisk) return "at_risk";
  return "met";
}

/** Worst status of several (missed > at risk > met > no data) — an agreement's status from its targets. */
export function worstStatus(statuses: ComplianceStatus[]): ComplianceStatus {
  for (const s of ["missed", "at_risk", "met"] as const) if (statuses.includes(s)) return s;
  return "no_data";
}

/** Weighted mean of target values (an agreement's overall compliance), null without values. */
export function weightedMean(items: { value: number | null; weight?: number | null }[]): number | null {
  let sw = 0;
  let s = 0;
  for (const i of items) {
    if (i.value === null) continue;
    const w = i.weight === null || i.weight === undefined ? 1 : Math.max(0, Number(i.weight));
    s += i.value * w;
    sw += w;
  }
  return sw > 0 ? round(s / sw, 2) : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Periods (Jalali months, quarters and years in the organisation's local dates)

export interface Period {
  key: string;
  label: string;
  /** ISO dates [start, end) */
  start: string;
  end: string;
  unit: DateUnit;
}

export function periodOf(isoDate: string, unit: DateUnit = "month"): Period {
  const start = unitStart(isoDate, unit);
  return { key: bucketKey(start, unit), label: bucketLabel(start, unit), start, end: addUnits(start, unit, 1), unit };
}

/** The `n` periods ending with the one holding `isoDate` (oldest first). */
export function lastPeriods(isoDate: string, unit: DateUnit, n: number): Period[] {
  const cur = periodOf(isoDate, unit);
  const out: Period[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(periodOf(addUnits(cur.start, unit, -i), unit));
  return out;
}

/** The date `months` Jalali months after `isoDate` (same day of month, clamped to the month's length). */
export function addJalaliMonths(isoDate: string, months: number): string {
  const start = unitStart(isoDate, "month");
  const day = Math.round((Date.parse(`${isoDate}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
  const target = addUnits(start, "month", months);
  const next = addUnits(target, "month", 1);
  const len = Math.round((Date.parse(`${next}T00:00:00Z`) - Date.parse(`${target}T00:00:00Z`)) / 86_400_000);
  const d = new Date(Date.parse(`${target}T00:00:00Z`) + Math.min(day, len - 1) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------------------------------------------
// Availability (SLM-006): the mean of the service's daily availability over the days of the period that have one

export function periodAvailability(days: { day: string; availability: number | null }[]): { value: number | null; days: number } {
  const known = days.map((d) => d.availability).filter((v): v is number => v !== null && Number.isFinite(v));
  if (!known.length) return { value: null, days: 0 };
  return { value: round(known.reduce((a, b) => a + b, 0) / known.length, 3), days: known.length };
}

// ---------------------------------------------------------------------------------------------------------------
// Service credits (SLM-035)

export interface CreditTier {
  below: number;
  pct: number;
}

export function parseTiers(raw: unknown): CreditTier[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => ({ below: num((t as Row)?.below), pct: num((t as Row)?.pct) }))
    .filter((t): t is CreditTier => t.below !== null && t.pct !== null && t.pct >= 0)
    .sort((a, b) => a.below - b.below);
}

/** The credit percentage of the lowest tier the value falls under, capped (0 when no tier applies). */
export function creditPct(value: number | null, tiers: CreditTier[], cap: number | null = null): number {
  if (value === null) return 0;
  const hit = tiers.find((t) => value < t.below);
  const pct = hit ? hit.pct : 0;
  return cap !== null && cap >= 0 ? Math.min(pct, cap) : pct;
}

// ---------------------------------------------------------------------------------------------------------------
// Experience measures (SLM-040/044): from survey responses, suppressed below `kMin` answers

export interface ExperienceInput {
  csat?: number | null;
  nps?: number | null;
  ces?: number | null;
  happiness?: number | null;
  lost_minutes?: number | null;
}

export interface Experience {
  responses: number;
  suppressed: boolean;
  /** % of 4–5 answers */
  csat: number | null;
  /** % promoters (9–10) − % detractors (0–6) */
  nps: number | null;
  /** mean 1–7 */
  ces: number | null;
  /** % 9–10 − % 0–6 of the happiness answers (−100…100) */
  happiness: number | null;
  /** median perceived lost time (minutes) */
  lost_minutes: number | null;
  /** one 0–100 experience figure: happiness normalised ((H + 100) ÷ 2), else CSAT % */
  experience_pct: number | null;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function experienceOf(responses: ExperienceInput[], kMin = 5): Experience {
  const pick = (k: keyof ExperienceInput) => responses.map((r) => num(r[k])).filter((v): v is number => v !== null);
  const csat = pick("csat");
  const nps = pick("nps");
  const ces = pick("ces");
  const happy = pick("happiness");
  const lost = pick("lost_minutes");
  const n = responses.length;
  const out: Experience = { responses: n, suppressed: n < kMin, csat: null, nps: null, ces: null, happiness: null, lost_minutes: null, experience_pct: null };
  if (out.suppressed) return out;
  if (csat.length >= kMin) out.csat = round((csat.filter((v) => v >= 4).length / csat.length) * 100, 1);
  if (nps.length >= kMin) out.nps = round(((nps.filter((v) => v >= 9).length - nps.filter((v) => v <= 6).length) / nps.length) * 100, 1);
  if (ces.length >= kMin) out.ces = round(ces.reduce((a, b) => a + b, 0) / ces.length, 2);
  if (happy.length >= kMin) out.happiness = round(((happy.filter((v) => v >= 9).length - happy.filter((v) => v <= 6).length) / happy.length) * 100, 1);
  if (lost.length >= kMin) out.lost_minutes = median(lost);
  out.experience_pct = out.happiness !== null ? round((out.happiness + 100) / 2, 1) : out.csat;
  return out;
}

/** Watermelon (SLM-043): green on the agreement, red on experience — the gap and whether it crosses `threshold`. */
export function watermelon(slaPct: number | null, experiencePct: number | null, threshold: number, goal: number | null): { gap: number | null; flagged: boolean } {
  if (slaPct === null || experiencePct === null) return { gap: null, flagged: false };
  const gap = round(slaPct - experiencePct, 1);
  return { gap, flagged: gap >= threshold && (goal === null || slaPct >= goal) };
}

// ---------------------------------------------------------------------------------------------------------------
// XLA scores (SLM-039)

export interface XlaPolicyLike {
  w_reliability?: number | null;
  w_quality?: number | null;
  w_effort?: number | null;
  p_breach?: number | null;
  p_reopen?: number | null;
  p_reassign?: number | null;
  p_late_response?: number | null;
  response_hours?: number | string | null;
  p_chase?: number | null;
  use_survey?: boolean | null;
}

export interface XlaFacts {
  breaches: number;
  reopens: number;
  reassignments: number;
  /** hours from opening to the first response; null when there is none yet */
  first_response_hours: number | null;
  /** hours the record has been open without a response (when there is none) */
  open_hours: number;
  /** public comments of the requester */
  customer_comments: number;
  /** a survey answer for the record: happiness 0–10 or CSAT 1–5 */
  survey_happiness?: number | null;
  survey_csat?: number | null;
}

export interface XlaDriver {
  rule: "breach" | "reopen" | "reassign" | "late_response" | "chase" | "survey";
  theme: "reliability" | "quality" | "effort";
  label: string;
  count: number;
  points: number;
}

export interface XlaResult {
  score: number;
  band: "excellent" | "good" | "fair" | "poor";
  reliability: number;
  quality: number;
  effort: number;
  survey: boolean;
  drivers: XlaDriver[];
}

export const bandOf = (score: number): XlaResult["band"] => (score >= 85 ? "excellent" : score >= 70 ? "good" : score >= 50 ? "fair" : "poor");

/** Weights that add up to 100 (a policy problem in Persian, or null). */
export function weightsProblem(p: XlaPolicyLike): string | null {
  const w = [p.w_reliability, p.w_quality, p.w_effort].map((x) => Number(x ?? 0));
  if (w.some((x) => !Number.isFinite(x) || x < 0)) return "وزن‌ها باید عددهای نامنفی باشند";
  return w.reduce((a, b) => a + b, 0) === 100 ? null : "جمع وزن‌های سه محور باید ۱۰۰ باشد";
}

export function xlaScore(p: XlaPolicyLike, f: XlaFacts): XlaResult {
  const val = (v: unknown, d: number) => (v === null || v === undefined || v === "" ? d : Number(v));
  const drivers: XlaDriver[] = [];
  const add = (rule: XlaDriver["rule"], theme: XlaDriver["theme"], label: string, count: number, per: number) => {
    if (count > 0 && per > 0) drivers.push({ rule, theme, label, count, points: count * per });
  };
  add("breach", "reliability", "نقض توافق", f.breaches, val(p.p_breach, 30));
  add("reopen", "reliability", "بازگشایی", f.reopens, val(p.p_reopen, 25));
  add("reassign", "quality", "ارجاع دوباره", Math.max(0, f.reassignments), val(p.p_reassign, 15));
  const limit = val(p.response_hours, 4);
  const late = f.first_response_hours !== null ? f.first_response_hours > limit : f.open_hours > limit;
  add("late_response", "quality", "پاسخ نخست دیرتر از موعد", late ? 1 : 0, val(p.p_late_response, 20));
  add("chase", "effort", "پیگیری‌های درخواست‌کننده", Math.max(0, f.customer_comments - 2), val(p.p_chase, 10));
  const theme = (t: XlaDriver["theme"]) => Math.max(0, 100 - drivers.filter((d) => d.theme === t).reduce((a, d) => a + d.points, 0));
  let effort = theme("effort");
  let survey = false;
  if (p.use_survey !== false) {
    const h = num(f.survey_happiness);
    const c = num(f.survey_csat);
    if (h !== null) {
      effort = Math.round(Math.max(0, Math.min(10, h)) * 10);
      survey = true;
    } else if (c !== null) {
      effort = Math.round(((Math.max(1, Math.min(5, c)) - 1) / 4) * 100);
      survey = true;
    }
    if (survey) drivers.push({ rule: "survey", theme: "effort", label: "پاسخ نظرسنجی درخواست‌کننده", count: 1, points: 100 - effort });
  }
  const reliability = theme("reliability");
  const quality = theme("quality");
  const wr = val(p.w_reliability, 40);
  const wq = val(p.w_quality, 40);
  const we = val(p.w_effort, 20);
  const total = wr + wq + we || 100;
  const score = Math.round((reliability * wr + quality * wq + effort * we) / total);
  return { score, band: bandOf(score), reliability, quality, effort, survey, drivers };
}

/** A Persian sentence of what lowered an XLA score (the rule-based explanation). */
export function xlaExplanation(r: XlaResult): string {
  const lost = r.drivers.filter((d) => d.points > 0).sort((a, b) => b.points - a.points);
  if (!lost.length) return `امتیاز تجربه ${faDigits(r.score)} است؛ هیچ قاعده‌ای از آن نکاسته است.`;
  const parts = lost.slice(0, 3).map((d) => (d.count > 1 ? `${d.label} (${faDigits(d.count)} بار، ${faDigits(d.points)} امتیاز)` : `${d.label} (${faDigits(d.points)} امتیاز)`));
  return `امتیاز تجربه ${faDigits(r.score)} است؛ بیشترین کاهش از ${parts.join("، ")}.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Target recommendation and what-if (SLM-052), breach probability (SLM-049)

export const PRIORITY_KEYS = ["1", "2", "3", "4", "5"] as const;

/** The value at percentile `p` (0–100) of a sample (linear interpolation). */
export function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const at = (Math.min(100, Math.max(0, p)) / 100) * (s.length - 1);
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return s[lo] + (s[hi] - s[lo]) * (at - lo);
}

/** Durations (hours, rounded up to a quarter hour) that `p`% of the finished records of each priority met. */
export function recommendHours(samples: Record<string, number[]>, p = 85): Record<string, { hours: number | null; n: number }> {
  const out: Record<string, { hours: number | null; n: number }> = {};
  for (const k of PRIORITY_KEYS) {
    const xs = (samples[k] ?? []).filter((v) => Number.isFinite(v) && v >= 0);
    const v = percentile(xs, p);
    out[k] = { hours: v === null ? null : Math.max(0.25, Math.ceil((v / 3600) * 4) / 4), n: xs.length };
  }
  return out;
}

/** How many of the finished records (business seconds per priority) would have breached proposed hours. */
export function simulateBreaches(samples: Record<string, number[]>, hours: Record<string, number | null | undefined>): { total: number; breached: number; pct: number | null; byPriority: Record<string, { total: number; breached: number }> } {
  let total = 0;
  let breached = 0;
  const byPriority: Record<string, { total: number; breached: number }> = {};
  for (const k of PRIORITY_KEYS) {
    const h = num(hours[k]);
    const xs = samples[k] ?? [];
    if (h === null || !xs.length) continue;
    const b = xs.filter((s) => s > h * 3600).length;
    byPriority[k] = { total: xs.length, breached: b };
    total += xs.length;
    breached += b;
  }
  return { total, breached, pct: total ? round(((total - breached) / total) * 100, 1) : null, byPriority };
}

/**
 * The empirical probability that a running timer at `percent` of its target ends breached: among finished timers of
 * the same definition that got at least that far, the share that ended breached (Laplace-smoothed, so a short history
 * stays cautious). Every finished timer that ended at or past `percent` "reached" it.
 */
export function breachProbability(percent: number, finished: { percent: number; breached: boolean }[]): { p: number; n: number } {
  const reached = finished.filter((f) => f.percent >= percent || f.breached);
  const b = reached.filter((f) => f.breached).length;
  const prior = Math.min(0.95, Math.max(0.05, percent / 100));
  return { p: round((b + 2 * prior) / (reached.length + 2), 3), n: reached.length };
}

/** A label of the urgency of a running timer for the «SLA at risk» lists (SLM-050): reason in Persian. */
export function urgencyOf(t: { percent: number | null; remaining_ms: number | null; priority?: string | null; p?: number | null }): { level: "critical" | "high" | "medium" | "low"; reason: string } {
  const pct = t.percent ?? 0;
  const left = t.remaining_ms ?? null;
  const hours = left === null ? null : left / 3_600_000;
  if (left !== null && left <= 0) return { level: "critical", reason: "موعد گذشته است" };
  if (pct >= 90 || (hours !== null && hours <= 1) || (t.p ?? 0) >= 0.7) return { level: "critical", reason: hours !== null && hours <= 1 ? "کمتر از یک ساعت کاری مانده است" : (t.p ?? 0) >= 0.7 ? "احتمال نقض بالاست" : "بیش از ۹۰٪ زمان گذشته است" };
  if (pct >= 75 || (t.priority === "1" && pct >= 50)) return { level: "high", reason: t.priority === "1" ? "اولویت بحرانی و نیمی از زمان گذشته است" : "بیش از ۷۵٪ زمان گذشته است" };
  if (pct >= 50) return { level: "medium", reason: "نیمی از زمان گذشته است" };
  return { level: "low", reason: "در موعد" };
}

// ---------------------------------------------------------------------------------------------------------------
// Review packs (SLM-046/047/048): numbers code computed; the narrative and suggestions read only these

export interface PackTarget {
  id: string;
  name: string;
  kind: string;
  metric_category: string;
  goal: number | null;
  value: number | null;
  status: ComplianceStatus;
  total: number;
  breached: number;
  trend: { label: string; value: number | null }[];
}

export interface ReviewPack {
  title: string;
  period: { from: string; to: string; label: string };
  agreement: { id: string; number: string | null; name: string; kind: string; service: string | null; customer: string | null } | null;
  overall: { value: number | null; status: ComplianceStatus; goal: number | null };
  targets: PackTarget[];
  breaches: { by: string; label: string; count: number }[];
  volume: { created: number; resolved: number; limit: number | null; over_limit: boolean };
  incidents: { total: number; major: number; open: number };
  problems: { open: number };
  changes: { total: number; failed: number };
  experience: Experience | null;
  watermelon: { gap: number | null; flagged: boolean };
  credits: { count: number; pct_total: number };
  improvements: { open: number; overdue: number; done: number };
  generated_at: string;
}

const pctText = (v: number | null) => (v === null ? "بی‌داده" : `${faDigits(round(v, 1))}٪`);
const STATUS_FA: Record<ComplianceStatus, string> = { met: "برآورده", at_risk: "در خطر", missed: "برآورده نشد", no_data: "بی‌داده" };
export const complianceStatusLabel = (s: ComplianceStatus): string => STATUS_FA[s];

/** The rule-based narrative of a review pack (the AI skill's fallback; numbers only from the pack). */
export function packNarrative(p: ReviewPack): string {
  const lines: string[] = [];
  const who = p.agreement ? `توافق «${p.agreement.name}»` : "این خدمت";
  lines.push(`**وضعیت کلی.** در دورهٔ ${p.period.label} انطباق ${who} ${pctText(p.overall.value)} بود${p.overall.goal !== null ? ` (هدف ${pctText(p.overall.goal)})` : ""}؛ وضعیت: ${STATUS_FA[p.overall.status]}.`);
  const missed = p.targets.filter((t) => t.status === "missed");
  const risk = p.targets.filter((t) => t.status === "at_risk");
  if (missed.length) lines.push(`**اهداف برآورده‌نشده.** ${missed.map((t) => `«${t.name}» ${pctText(t.value)} در برابر هدف ${pctText(t.goal)}`).join("؛ ")}.`);
  if (risk.length) lines.push(`**اهداف در خطر.** ${risk.map((t) => `«${t.name}» ${pctText(t.value)}`).join("؛ ")}.`);
  if (!missed.length && !risk.length && p.targets.some((t) => t.status === "met")) lines.push("**اهداف.** همهٔ اهداف سنجیده‌شده برآورده شده‌اند.");
  const top = p.breaches.slice(0, 3);
  if (top.length) lines.push(`**نقض‌ها.** بیشترین نقض‌ها: ${top.map((b) => `${b.label} (${faDigits(b.count)})`).join("، ")}.`);
  lines.push(`**حجم کار.** ${faDigits(p.volume.created)} رکورد ثبت و ${faDigits(p.volume.resolved)} رکورد حل شد${p.volume.limit !== null ? `؛ سقف ماهانه ${faDigits(p.volume.limit)}${p.volume.over_limit ? " و از سقف گذشت" : ""}` : ""}. ${faDigits(p.incidents.major)} رخداد عمده، ${faDigits(p.problems.open)} مشکل باز و ${faDigits(p.changes.failed)} تغییر ناموفق در دوره بود.`);
  if (p.experience && !p.experience.suppressed && p.experience.experience_pct !== null) {
    lines.push(`**تجربه.** امتیاز تجربه ${pctText(p.experience.experience_pct)} از ${faDigits(p.experience.responses)} پاسخ${p.experience.csat !== null ? `، رضایت ${pctText(p.experience.csat)}` : ""}.`);
  } else if (p.experience?.suppressed) {
    lines.push(`**تجربه.** پاسخ‌های نظرسنجی برای گزارش کافی نیست (${faDigits(p.experience.responses)} پاسخ).`);
  }
  if (p.watermelon.flagged) lines.push(`**هشدار «هندوانه‌ای».** توافق سبز است اما تجربهٔ کاربران ${faDigits(p.watermelon.gap ?? 0)} امتیاز پایین‌تر است؛ عددهای عملیاتی تصویر کامل را نشان نمی‌دهند.`);
  if (p.credits.count) lines.push(`**جریمه‌ها.** ${faDigits(p.credits.count)} جریمهٔ خدمت محاسبه شد.`);
  lines.push(`**بهبود.** ${faDigits(p.improvements.open)} اقدام باز${p.improvements.overdue ? ` (${faDigits(p.improvements.overdue)} عقب‌افتاده)` : ""} و ${faDigits(p.improvements.done)} اقدام انجام‌شده.`);
  return lines.join("\n\n");
}

export interface CsiSuggestion {
  title: string;
  description: string;
  source: "review" | "breach" | "survey";
  value: number;
  effort: number;
}

/** Rule-based improvement suggestions from a pack (the AI skill's fallback). */
export function csiSuggestions(p: ReviewPack): CsiSuggestion[] {
  const out: CsiSuggestion[] = [];
  for (const t of p.targets.filter((x) => x.status === "missed").slice(0, 3)) {
    out.push({ title: `بازگرداندن «${t.name}» به هدف`, description: `انطباق این هدف ${pctText(t.value)} بود و هدف ${pctText(t.goal)} است. علت‌های اصلی نقض را بررسی و برای پرتکرارترین آن اقدام کنید.`, source: "breach", value: 5, effort: 3 });
  }
  const top = p.breaches[0];
  if (top && top.count >= 3) out.push({ title: `کاهش نقض‌ها در «${top.label}»`, description: `${faDigits(top.count)} نقض در این دسته رخ داد؛ ظرفیت، دانش یا ارجاع آن را بازبینی کنید.`, source: "breach", value: 4, effort: 3 });
  if (p.watermelon.flagged) out.push({ title: "بهبود تجربهٔ کاربران با وجود برآورده‌شدن توافق", description: "اهداف عملیاتی برآورده‌اند اما امتیاز تجربه پایین است؛ هدف تجربه (XLA) را به توافق بیفزایید و بازخوردهای منفی را دسته‌بندی کنید.", source: "survey", value: 4, effort: 2 });
  if (p.experience && !p.experience.suppressed && p.experience.csat !== null && p.experience.csat < 80) out.push({ title: "افزایش رضایت درخواست‌کنندگان", description: `رضایت ${pctText(p.experience.csat)} است؛ نظرهای منفی را بخوانید و دو علت پرتکرار را برطرف کنید.`, source: "survey", value: 4, effort: 2 });
  if (p.volume.over_limit) out.push({ title: "بازنگری سقف حجم توافق", description: "حجم رکوردها از سقف توافق گذشت؛ ظرفیت تیم یا بند حجم توافق را بازنگری کنید.", source: "review", value: 3, effort: 2 });
  if (p.improvements.overdue) out.push({ title: "پیگیری اقدام‌های عقب‌افتاده", description: `${faDigits(p.improvements.overdue)} اقدام بهبود از موعد گذشته است؛ مسئول و موعد تازه تعیین کنید.`, source: "review", value: 3, effort: 1 });
  return out.slice(0, 6);
}

/** Priority score of an improvement: value ÷ effort × 10 (1–50). */
export const improvementScore = (value: unknown, effort: unknown): number | null => {
  const v = num(value);
  const e = num(effort);
  return v === null || e === null || e <= 0 ? null : round((v / e) * 10, 1);
};

// ---------------------------------------------------------------------------------------------------------------
// The agreement document (SLM-055)

const label = (opts: { value: string; label: string }[], v: unknown) => opts.find((o) => o.value === v)?.label ?? String(v ?? "");
const dateFa = (v: unknown) => (typeof v === "string" && v ? formatJalali(v.slice(0, 10), { style: "long" }) : "—");

export interface DocumentInput {
  agreement: Row;
  targets: Row[];
  names: { service?: string | null; customer?: string | null; provider?: string | null; owner?: string | null; calendar?: string | null; parent?: string | null };
  /** the customer sees only customer-facing targets of customer agreements */
  customerView?: boolean;
}

/** The Persian agreement document (Markdown) built from the record and its targets. */
export function agreementDocument({ agreement: a, targets, names, customerView }: DocumentInput): string {
  const kinds = [
    { value: "sla", label: "توافق سطح خدمت" }, { value: "ola", label: "توافق سطح عملیات" }, { value: "uc", label: "قرارداد پشتیبان" },
    { value: "collaboration", label: "توافق همکاری ارائه‌دهندگان" }, { value: "flsa", label: "توافق پشتیبانی خط اول" },
  ];
  const lines: string[] = [];
  lines.push(`# ${label(kinds, a.kind)}: ${a.name ?? ""}`);
  lines.push(`شماره: ${a.number ?? "—"} · نسخه ${faDigits(a.agreement_version ?? 1)} · اعتبار از ${dateFa(a.valid_from)} تا ${dateFa(a.valid_to)}`);
  lines.push("## ۱. طرف‌ها و خدمت");
  lines.push([
    `- خدمت: ${names.service ?? "—"}`,
    `- مشتری: ${names.customer ?? "—"}`,
    names.provider ? `- گروه ارائه‌دهنده: ${names.provider}` : null,
    a.supplier_name ? `- تأمین‌کننده: ${a.supplier_name}${a.contract_ref ? ` (قرارداد ${a.contract_ref})` : ""}` : null,
    names.owner ? `- مالک توافق: ${names.owner}` : null,
    names.parent ? `- توافق بالادستی: ${names.parent}` : null,
  ].filter(Boolean).join("\n"));
  if (a.terms) lines.push("## ۲. شرح خدمت و شرایط", String(a.terms));
  lines.push("## ۳. ساعات خدمت", a.service_hours ? String(a.service_hours) : names.calendar ? `بر پایهٔ تقویم کاری «${names.calendar}» با تعطیلات رسمی.` : "شبانه‌روزی.");
  const shown = targets.filter((t) => t.active !== false && (!customerView || t.customer_facing !== false));
  lines.push("## ۴. اهداف سطح خدمت");
  if (!shown.length) lines.push("هدفی ثبت نشده است.");
  else {
    lines.push("| هدف | نوع | دسته | هدف انطباق | جزئیات |", "| --- | --- | --- | --- | --- |");
    for (const t of shown) {
      const hours = PRIORITY_KEYS.map((p) => (num(t[`p${p}_hours`]) !== null ? `اولویت ${faDigits(p)}: ${faDigits(num(t[`p${p}_hours`])!)} ساعت` : null)).filter(Boolean).join("، ");
      const goal = num(t.goal);
      lines.push(`| ${t.name ?? ""} | ${label(TARGET_KINDS, t.kind)} | ${label(METRIC_CATEGORIES, t.metric_category)} | ${goal === null ? "—" : `${faDigits(goal)}${t.kind === "timer" || t.kind === "availability" || t.kind === "satisfaction" ? "٪" : ""}`} | ${hours || (t.xla_clause && t.kind === "experience" ? label(XLA_CLAUSES, t.xla_clause) : "—")} |`);
    }
  }
  lines.push(`انطباق هر دورهٔ ${a.review_period === "quarter" ? "فصلی" : a.review_period === "year" ? "سالانه" : "ماهانه"} سنجیده می‌شود؛ هدف انطباق کل ${faDigits(num(a.compliance_target) ?? 95)}٪ است.`);
  if (a.volume_limit) lines.push(`سقف حجم ماهانه: ${faDigits(a.volume_limit)} رکورد؛ رکوردهای بیشتر جدا گزارش می‌شوند.`);
  if (a.responsibilities) lines.push("## ۵. مسئولیت‌های طرفین", String(a.responsibilities));
  if (a.escalation) lines.push("## ۶. مسیر تشدید و ارتباط", String(a.escalation));
  if (a.exclusions) lines.push("## ۷. استثناها", String(a.exclusions));
  lines.push("## ۸. بازبینی", `این توافق هر ${faDigits(a.review_months ?? 3)} ماه بازبینی می‌شود${a.next_review_at ? `؛ بازبینی بعدی ${dateFa(a.next_review_at)}` : ""}.`);
  if (a.accepted_at) lines.push(`پذیرفته‌شده در ${dateFa(a.accepted_at)}.`);
  return lines.join("\n\n");
}
