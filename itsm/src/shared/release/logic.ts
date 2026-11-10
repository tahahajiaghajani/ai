// Pure logic of release management, shared by the server and the screens (no I/O):
//   · the deterministic release risk score (REL-015): overdue tasks and failed checks tiered and weighted by the
//     elapsed share of the release window, the aggregated risk of the release's changes P = 1 − Π(1 − pᵢ), the number
//     of teams and services touched, the type, and a freeze or blackout inside the window — with Persian factors
//   · the readiness roll-up of check results (REL-013) and the go/no-go gate (REL-014)
//   · the lifecycle bar, early-life-support end, schedule adherence, tones for lists and calendars
import { CHECK_PASSING, RELEASE_STATES } from "../tables/release";

export type Row = Record<string, any>;

export const DAY_MS = 86_400_000;

const ms = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const t = typeof v === "number" ? v : Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
};

// ---------------------------------------------------------------------------------------------------------------
// Risk

/** 0 below 10 %, 1 from 10 % to 40 %, 2 above 40 % (the tiers of REL-015). */
export function riskTier(share: number): 0 | 1 | 2 {
  if (!Number.isFinite(share) || share < 0.1) return 0;
  return share <= 0.4 ? 1 : 2;
}

/** Probability that a change of this risk level fails (the change module's risk levels). */
export const CHANGE_FAILURE_P: Record<string, number> = { low: 0.03, moderate: 0.1, high: 0.25, very_high: 0.45 };

/** P(any of the changes fails) = 1 − Π(1 − pᵢ). */
export function anyFails(risks: readonly (string | null | undefined)[]): number {
  let ok = 1;
  for (const r of risks) ok *= 1 - (CHANGE_FAILURE_P[String(r ?? "")] ?? CHANGE_FAILURE_P.moderate);
  return Math.round((1 - ok) * 1000) / 1000;
}

export interface RiskInput {
  type: string;
  now: number;
  planned_start?: unknown;
  planned_end?: unknown;
  tasks: { total: number; overdue: number };
  checks: { total: number; failed: number };
  /** risk levels of the release's changes */
  change_risks: (string | null | undefined)[];
  teams: number;
  services: number;
  /** a blocking freeze or blackout overlaps the release window */
  freeze: boolean;
  /** failed deployments of this release so far */
  failed_deployments?: number;
}

export interface RiskFactor {
  key: string;
  label: string;
  points: number;
  detail: string;
}

export interface RiskResult {
  score: number;
  band: "low" | "medium" | "high" | "very_high";
  points: number;
  factors: RiskFactor[];
  elapsed: number;
  change_failure: number;
}

const fa = (n: number) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]).replace(".", "٫");
const pct = (x: number) => `${fa(Math.round(x * 100))}٪`;

/** Elapsed share of the release window at `now` (0 before it starts, 1 after it ends). */
export function elapsedShare(start: unknown, end: unknown, now: number): number {
  const s = ms(start);
  const e = ms(end);
  if (s === null || e === null || e <= s) return 0;
  return Math.min(1, Math.max(0, (now - s) / (e - s)));
}

/** Points → band: below 1.5 low, below 3 medium, below 4.5 high, else very high. */
export function bandOf(points: number): RiskResult["band"] {
  if (points < 1.5) return "low";
  if (points < 3) return "medium";
  if (points < 4.5) return "high";
  return "very_high";
}

/** The deterministic release risk (REL-015). */
export function releaseRisk(i: RiskInput): RiskResult {
  const factors: RiskFactor[] = [];
  const elapsed = elapsedShare(i.planned_start, i.planned_end, i.now);
  const weight = 0.5 + 0.5 * elapsed;
  const overdueShare = i.tasks.total ? i.tasks.overdue / i.tasks.total : 0;
  const failedShare = i.checks.total ? i.checks.failed / i.checks.total : 0;
  const tTasks = riskTier(overdueShare);
  const tChecks = riskTier(failedShare);
  if (tTasks) factors.push({ key: "overdue_tasks", label: "کارهای دیرکرد", points: round(tTasks * weight), detail: `${fa(i.tasks.overdue)} از ${fa(i.tasks.total)} کار (${pct(overdueShare)}) از موعد گذشته است` });
  if (tChecks) factors.push({ key: "failed_checks", label: "بررسی‌های ردشده", points: round(tChecks * weight), detail: `${fa(i.checks.failed)} از ${fa(i.checks.total)} بررسی آمادگی رد شده است` });
  const p = i.change_risks.length ? anyFails(i.change_risks) : 0;
  const tChanges = p < 0.2 ? 0 : p < 0.5 ? 1 : 2;
  if (tChanges) factors.push({ key: "changes", label: "ریسک تغییرهای انتشار", points: tChanges, detail: `احتمال شکست دست‌کم یکی از ${fa(i.change_risks.length)} تغییر: ${pct(p)}` });
  if (i.teams > 3) factors.push({ key: "teams", label: "تیم‌های درگیر", points: 1, detail: `${fa(i.teams)} تیم روی این انتشار کار می‌کنند` });
  if (i.services > 3) factors.push({ key: "services", label: "خدمت‌های متأثر", points: 1, detail: `${fa(i.services)} خدمت از این انتشار اثر می‌پذیرند` });
  if (i.freeze) factors.push({ key: "freeze", label: "دورهٔ انجماد", points: 1, detail: "بازهٔ انتشار با دورهٔ انجماد یا ممنوعیت تغییرات هم‌پوشانی دارد" });
  if (i.type === "emergency") factors.push({ key: "emergency", label: "انتشار اضطراری", points: 1, detail: "رویهٔ اضطراری فرصت آزمون کامل را کم می‌کند" });
  else if (i.type === "major") factors.push({ key: "major", label: "انتشار عمده", points: 0.5, detail: "دامنهٔ انتشار عمده بزرگ‌تر است" });
  if (i.failed_deployments) factors.push({ key: "failed_deployments", label: "استقرارهای ناموفق", points: Math.min(2, i.failed_deployments), detail: `${fa(i.failed_deployments)} استقرار این انتشار ناموفق بوده است` });
  const points = round(factors.reduce((s, f) => s + f.points, 0));
  return { score: Math.min(100, Math.round((points / 6) * 100)), band: bandOf(points), points, factors, elapsed: round(elapsed), change_failure: p };
}

const round = (x: number) => Math.round(x * 100) / 100;

/** A Persian explanation of a risk result (the rule-based answer of the risk narrative). */
export function explainReleaseRisk(r: RiskResult, labels: Record<string, string> = BAND_LABELS): string {
  const head = `ریسک انتشار «${labels[r.band] ?? r.band}» است (امتیاز ${fa(r.score)} از ${fa(100)}).`;
  if (!r.factors.length) return `${head}\n\nعامل ریسک‌زایی دیده نشد: کارها به‌موقع است، بررسی‌ها رد نشده‌اند و تغییرهای انتشار کم‌ریسک‌اند.`;
  const lines = r.factors.map((f) => `- **${f.label}** (+${fa(f.points)}): ${f.detail}`);
  const advice: string[] = [];
  if (r.factors.some((f) => f.key === "failed_checks")) advice.push("بررسی‌های ردشده را رفع کنید یا با دلیل چشم‌پوشی کنید");
  if (r.factors.some((f) => f.key === "overdue_tasks")) advice.push("کارهای دیرکرد را تمام یا دوباره زمان‌بندی کنید");
  if (r.factors.some((f) => f.key === "freeze")) advice.push("زمان عرضه را بیرون از دورهٔ انجماد بگذارید");
  if (r.factors.some((f) => f.key === "changes")) advice.push("تغییرهای پرریسک را جدا یا در موج‌های کوچک‌تر مستقر کنید");
  return [head, "", ...lines, ...(advice.length ? ["", `برای کاهش ریسک: ${advice.join("؛ ")}.`] : [])].join("\n");
}

export const BAND_LABELS: Record<string, string> = { low: "کم", medium: "متوسط", high: "زیاد", very_high: "بسیار زیاد" };

// ---------------------------------------------------------------------------------------------------------------
// Readiness

export interface CheckLike {
  status?: string | null;
  blocking?: boolean | null;
  name?: string | null;
}

export interface Readiness {
  total: number;
  passed: number;
  failed: number;
  pending: number;
  waived: number;
  pct: number;
  /** blocking checks that are neither passed, waived nor irrelevant */
  blockers: string[];
  ready: boolean;
}

/** Roll-up of a release's check results. */
export function readinessOf(results: readonly CheckLike[]): Readiness {
  let passed = 0;
  let failed = 0;
  let pending = 0;
  let waived = 0;
  const blockers: string[] = [];
  const relevant = results.filter((r) => r.status !== "na");
  for (const r of relevant) {
    if (r.status === "pass") passed++;
    else if (r.status === "fail") failed++;
    else if (r.status === "waived") waived++;
    else pending++;
    if (r.blocking !== false && !CHECK_PASSING.includes(String(r.status ?? "pending"))) blockers.push(String(r.name ?? ""));
  }
  const total = relevant.length;
  return { total, passed, failed, pending, waived, pct: total ? Math.round(((passed + waived) / total) * 100) : 100, blockers, ready: blockers.length === 0 };
}

/** Does a check of the library apply to a release (active, of its type)? */
export function checkApplies(check: Row, release: Row): boolean {
  if (check.active === false) return false;
  const types = Array.isArray(check.types) ? check.types : [];
  return !types.length || types.includes(release.type);
}

/** Why a release may not start deploying (REL-014), or null. */
export function goProblem(release: Row, readiness: Readiness, opts: { decisionRequired: boolean }): string | null {
  if (readiness.blockers.length) return `بررسی‌های بازدارنده قبول نشده‌اند: ${readiness.blockers.slice(0, 5).join("، ")}${readiness.blockers.length > 5 ? "…" : ""}`;
  if (opts.decisionRequired && !["go", "go_with_conditions"].includes(String(release.go_no_go ?? "pending"))) return "تصمیم اجرا (Go) برای این انتشار ثبت نشده است";
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Lifecycle, dates and tones

const MAIN_PATH = ["draft", "planning", "build", "test", "readiness", "deploying", "els", "review", "closed"];

/** The steps of the lifecycle bar: done, current, todo (on hold and canceled stay on the step they left). */
export function lifecycleSteps(state: string, before?: string | null): { value: string; label: string; status: "done" | "current" | "todo" }[] {
  const at = state === "on_hold" || state === "canceled" ? (before && MAIN_PATH.includes(before) ? before : "draft") : state;
  const i = MAIN_PATH.indexOf(at);
  return MAIN_PATH.map((v, k) => ({
    value: v,
    label: RELEASE_STATES.states.find((s) => s.value === v)?.label ?? v,
    status: k < i ? "done" : k === i ? "current" : "todo",
  }));
}

/** End of early life support: `days` after the production deployment. */
export function elsEnd(deployedAt: unknown, days: number): string | null {
  const t = ms(deployedAt);
  if (t === null || !(days > 0)) return null;
  return new Date(t + days * DAY_MS).toISOString();
}

/** Was the release deployed by its planned date (a day's grace)? null when either is missing. */
export function onSchedule(plannedEnd: unknown, deployedAt: unknown): boolean | null {
  const p = ms(plannedEnd);
  const d = ms(deployedAt);
  if (p === null || d === null) return null;
  return d <= p + DAY_MS;
}

/** Days between the planned and the actual go-live (positive: late). */
export function scheduleVarianceDays(plannedEnd: unknown, deployedAt: unknown): number | null {
  const p = ms(plannedEnd);
  const d = ms(deployedAt);
  if (p === null || d === null) return null;
  return Math.round((d - p) / DAY_MS);
}

/** How a release stands out in lists and calendars. */
export function releaseTone(r: Row, now = Date.now()): "danger" | "warning" | null {
  if (r.risk_band === "very_high" || r.go_no_go === "no_go") return "danger";
  const target = ms(r.readiness_target_at);
  const preparing = ["draft", "planning", "build", "test", "readiness"].includes(String(r.state));
  if (preparing && target !== null && target < now && Number(r.checks_failed ?? 0) + Number(r.checks_pending ?? 0) > 0) return "danger";
  // still being prepared after its delivery date
  const end = ms(r.planned_end);
  if (preparing && end !== null && end < now) return "danger";
  if (r.risk_band === "high" || Number(r.checks_failed ?? 0) > 0) return "warning";
  return null;
}

/** Is an instant inside [start, end)? (open ends are unbounded) */
export function within(at: number, start: unknown, end: unknown): boolean {
  const s = ms(start);
  const e = ms(end);
  return (s === null || at >= s) && (e === null || at < e);
}

/** Do two intervals overlap? */
export function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1;
}
