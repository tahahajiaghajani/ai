// Pure logic of the change screens (tests/change-ui.test.ts): the queues, the calendar's spans and windows as the record
// kit's bands (its geometry — days, bands, bars at the minute — is the kit's, records/model/calendar.ts), tones of
// changes and windows, KPI rows of the dashboard, the CAB workbench's decision options and the questionnaire's
// progress. No React, no antd.
import type { Cond } from "@shared/model/conditions";
import { addDays, weekday } from "@shared/jalali";
import type { CalendarBand } from "../../records/model/calendar";
import { answerOption, conflictLabel, riskLabel, windowKindLabel, type RiskOption } from "@shared/change/logic";

export type Row = Record<string, any>;

// ---------------------------------------------------------------------------------------------------------------
// Queues

export interface Queue {
  key: string;
  label: string;
  path: string;
  filter: Cond;
  sort?: string;
  empty: string;
}

const OPEN: Cond = { f: "active", op: "eq", v: true };

export const QUEUES: Queue[] = [
  {
    key: "mine", label: "تغییرهای من", path: "changes/mine", sort: "planned_start",
    filter: { and: [OPEN, { or: [{ f: "assigned_to", op: "is_me" }, { f: "change_owner_id", op: "is_me" }, { f: "change_manager_id", op: "is_me" }] }] },
    empty: "تغییر بازی به شما سپرده نشده است",
  },
  { key: "approval", label: "در انتظار تأیید", path: "changes/awaiting-approval", sort: "submitted_at", filter: { f: "state", op: "eq", v: "authorize" }, empty: "تغییری در انتظار تأیید نیست" },
  {
    key: "week", label: "اجرای هفتهٔ پیش رو", path: "changes/this-week", sort: "planned_start",
    filter: { and: [{ f: "state", op: "in", v: ["scheduled", "implement"] }, { f: "planned_start", op: "relative", v: { unit: "day", n: 7, dir: "next" } }] },
    empty: "برای هفتهٔ پیش رو تغییری زمان‌بندی نشده است",
  },
  { key: "implementing", label: "در حال اجرا", path: "changes/implementing", sort: "planned_end", filter: { f: "state", op: "eq", v: "implement" }, empty: "تغییری در حال اجرا نیست" },
  { key: "conflicts", label: "دارای تداخل", path: "changes/with-conflicts", sort: "planned_start", filter: { and: [OPEN, { f: "conflict_status", op: "eq", v: "conflict" }] }, empty: "تغییر بازی تداخل بررسی‌نشده ندارد" },
  { key: "emergency", label: "تغییرهای اضطراری", path: "changes/emergency", sort: "-opened_at", filter: { and: [OPEN, { f: "type", op: "eq", v: "emergency" }] }, empty: "تغییر اضطراری بازی نیست" },
  { key: "review", label: "در بازبینی", path: "changes/in-review", sort: "actual_end", filter: { f: "state", op: "eq", v: "review" }, empty: "تغییری در بازبینی نیست" },
];

export const queueOf = (key: string): Queue | undefined => QUEUES.find((q) => q.key === key);

// ---------------------------------------------------------------------------------------------------------------
// Tones

export type Tone = "danger" | "warning" | null;

/** How a change needs attention on lists and the calendar. */
export function changeTone(c: Row): Tone {
  if (c.conflict_status === "conflict" || Number(c.conflict_count) > 0 || c.in_blackout) return "danger";
  if (c.outside_window || c.is_late || c.on_hold) return "warning";
  return null;
}

/** Why a change is flagged (Persian, for chips and the calendar's tooltip). */
export function flags(c: Row): string[] {
  const out: string[] = [];
  if (Number(c.conflict_count) > 0) out.push(`${c.conflict_count} تداخل باز`);
  else if (c.conflict_status === "acknowledged") out.push("تداخل بررسی‌شده");
  if (c.in_blackout) out.push("در دورهٔ ممنوعیت یا انجماد");
  if (c.outside_window) out.push("بیرون از پنجرهٔ نگهداری");
  if (c.is_late) out.push("دیرهنگام");
  if (c.on_hold) out.push("متوقف");
  return out;
}

export const riskChip = (risk: unknown): "danger" | "warning" | "neutral" => (risk === "very_high" || risk === "high" ? "danger" : risk === "moderate" ? "warning" : "neutral");

export { riskLabel, conflictLabel, windowKindLabel };

// ---------------------------------------------------------------------------------------------------------------
// The calendar

export type Span = "week" | "2w" | "month";
export const SPANS: { value: Span; label: string; days: number }[] = [
  { value: "week", label: "هفته", days: 7 },
  { value: "2w", label: "دو هفته", days: 14 },
  { value: "month", label: "چهار هفته", days: 28 },
];

/** The Saturday of the week of `iso` (local dates). */
export const weekStart = (iso: string): string => addDays(iso, -weekday(iso));

export interface WindowOcc {
  window_id: string;
  name: string;
  kind: string;
  enforcement: string;
  start: string;
  end: string;
}

/** Window occurrences as the kit's calendar bands (their kind is the band's colour; «فقط هشدار» in the tooltip). */
export function windowBandsOf(windows: readonly WindowOcc[]): CalendarBand[] {
  return windows.map((w, i) => ({
    id: `${w.window_id}:${w.start}:${i}`,
    start: w.start,
    end: w.end,
    label: w.name,
    kind: w.kind,
    title: `${windowKindLabel(w.kind)}: ${w.name}${w.enforcement === "warn" ? " (فقط هشدار)" : ""}`,
  }));
}

export const WINDOW_TONE: Record<string, string> = { blackout: "danger", freeze: "freeze", maintenance: "maintenance", information: "info" };

// ---------------------------------------------------------------------------------------------------------------
// Dashboard

export interface Kpi {
  key: string;
  label: string;
  value: number | null;
  unit: "%" | "";
  /** "good" when the value meets the usual target, "bad" when it clearly misses it */
  verdict: "good" | "bad" | null;
}

const PCT: [string, string, (v: number) => "good" | "bad" | null][] = [
  ["success_rate", "نرخ موفقیت", (v) => (v >= 95 ? "good" : v < 85 ? "bad" : null)],
  ["failure_rate", "نرخ شکست", (v) => (v <= 5 ? "good" : v > 15 ? "bad" : null)],
  ["backout_rate", "نرخ بازگشت", (v) => (v <= 3 ? "good" : v > 8 ? "bad" : null)],
  ["caused_incident_rate", "تغییرهای منجر به رخداد", (v) => (v <= 5 ? "good" : v > 10 ? "bad" : null)],
  ["emergency_ratio", "سهم تغییرهای اضطراری", (v) => (v <= 10 ? "good" : v > 20 ? "bad" : null)],
  ["standard_ratio", "سهم تغییرهای استاندارد", (v) => (v >= 50 ? "good" : null)],
  ["late_rate", "تغییرهای دیرهنگام", (v) => (v <= 10 ? "good" : v > 25 ? "bad" : null)],
  ["schedule_compliance", "اجرا در پنجرهٔ مجاز", (v) => (v >= 95 ? "good" : v < 85 ? "bad" : null)],
  ["pir_completion", "انجام بازبینی پس از اجرا", (v) => (v >= 95 ? "good" : v < 70 ? "bad" : null)],
];
const COUNTS: [string, string][] = [
  ["total", "تغییرهای ثبت‌شده"],
  ["implemented", "تغییرهای اجراشده"],
  ["backlog", "در ارزیابی یا انتظار تأیید"],
  ["unresolved_conflicts", "مجاز یا در انتظار با تداخل باز"],
];

/** The dashboard's KPI rows from the server's numbers (nothing is computed here but the verdict). */
export function kpiRows(k: Record<string, number | null>): { counts: Kpi[]; rates: Kpi[] } {
  return {
    counts: COUNTS.map(([key, label]) => ({ key, label, value: k[key] ?? null, unit: "" as const, verdict: key === "unresolved_conflicts" && (k[key] ?? 0) > 0 ? ("bad" as const) : null })),
    rates: PCT.map(([key, label, judge]) => ({ key, label, value: k[key] ?? null, unit: "%" as const, verdict: k[key] === null || k[key] === undefined ? null : judge(Number(k[key])) })),
  };
}

/** Is the failure rate monotonic over the risk bands (a calibrated risk model fails more often at higher risk)? */
export function calibrated(bands: readonly { implemented: number; failure_rate: number | null }[]): boolean | null {
  const xs = bands.filter((b) => b.implemented >= 5 && b.failure_rate !== null).map((b) => Number(b.failure_rate));
  if (xs.length < 2) return null;
  return xs.every((x, i) => i === 0 || x >= xs[i - 1]);
}

// ---------------------------------------------------------------------------------------------------------------
// CAB workbench

export interface Votes {
  approved: number;
  rejected: number;
  open: number;
  total: number;
  my_approval: string | null;
}

/** The decisions a person may take on an agenda item: their own vote (an approval of theirs is open) and the chair's. */
export function decisionsFor(item: Row, change: Row | undefined, votes: Votes | undefined, canManage: boolean): { vote: boolean; chair: ("deferred" | "info_requested" | "reviewed")[] } {
  const open = item.decision === "pending" || item.decision === "voting" || item.decision === "deferred" || item.decision === "info_requested";
  const vote = !!change && change.state === "authorize" && item.kind === "authorize" && !!votes?.my_approval && open;
  const chair: ("deferred" | "info_requested" | "reviewed")[] = !canManage || !open ? [] : item.kind === "authorize" ? ["deferred", "info_requested"] : ["reviewed", "deferred"];
  return { vote, chair };
}

/** «۲ موافق، ۱ مخالف از ۳» */
export function voteText(v: Votes | undefined): string {
  if (!v || !v.total) return "رأیی خواسته نشده است";
  return `${v.approved} موافق، ${v.rejected} مخالف از ${v.total}${v.open ? ` (${v.open} در انتظار)` : ""}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Risk questionnaire

export interface QuestionView {
  id: string;
  question: string;
  kind: "choice" | "yes_no" | "number";
  weight: number;
  mandatory: boolean;
  help: string | null;
  options: RiskOption[];
}

/** Answered and missing mandatory questions. */
export function progress(questions: readonly QuestionView[], answers: Record<string, unknown>): { answered: number; total: number; missing: number } {
  let answered = 0;
  let missing = 0;
  for (const q of questions) {
    if (answerOption(q, answers[q.id])) answered++;
    else if (q.mandatory) missing++;
  }
  return { answered, total: questions.length, missing };
}

/** Answers without the empty ones (what is sent). */
export function cleanAnswers(answers: Record<string, unknown>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(answers)) if (v !== null && v !== undefined && v !== "") out[k] = typeof v === "number" ? v : String(v);
  return out;
}

/** The factors that weigh most (score × weight), for the risk panel's bars. */
export function topFactors(factors: readonly { key: string; label: string; score: number; weight: number; detail: string }[], n = 4) {
  return [...factors].sort((a, b) => b.score * b.weight - a.score * a.weight).slice(0, n);
}
