// Pure logic of workforce and agent experience (shared by the server and the screens): skill matching and the
// routing score with its Persian explanation, utilisation bands, the daily demand forecast (weekday seasonality,
// exponential level, Iranian holidays) with its back-test error, staffing (FTE from volume and handle time, Erlang C
// for live channels), shifts of a roster from its pattern's calendar, labour-rule checks, points, levels and badges.
// No I/O here.
import { shiftsOf, type BusinessCalendar } from "../sla/calendar";
import { addDays, weekday } from "../jalali";
import { faDigits } from "../format";
import { proficiencyLabel } from "../tables/workforce";

type Row = Record<string, any>;

const round = (n: number, dp = 1): number => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

// ---------------------------------------------------------------------------------------------------------------
// Skills and routing (WFM-002/009)

export interface PersonSkill {
  skill_id: string;
  level: number;
  verified?: boolean;
  status?: string | null;
  expires_at?: string | null;
}

/** Skills that count for a person today: accepted, not expired, at least `minLevel`, verified when required. */
export function countingSkills(xs: PersonSkill[], today: string, opts: { minLevel?: number; needsVerified?: boolean } = {}): PersonSkill[] {
  return xs.filter((s) => (s.status ?? "active") === "active" && (!s.expires_at || s.expires_at >= today) && s.level >= (opts.minLevel ?? 1) && (!opts.needsVerified || s.verified));
}

/**
 * How well a person's skills cover what a piece of work needs (0–1): each required skill counts its level ratio
 * (capped at 1), a verified skill a little more; no requirement = 1.
 */
export function skillMatch(required: { skill_id: string; level: number }[], person: PersonSkill[]): { match: number; missing: string[] } {
  if (!required.length) return { match: 1, missing: [] };
  const mine = new Map(person.map((s) => [s.skill_id, s]));
  let sum = 0;
  const missing: string[] = [];
  for (const r of required) {
    const s = mine.get(r.skill_id);
    if (!s) {
      missing.push(r.skill_id);
      continue;
    }
    sum += Math.min(1, s.level / Math.max(1, r.level)) * (s.verified ? 1 : 0.9);
  }
  return { match: round(sum / required.length, 3), missing };
}

export interface RoutingInput {
  user_id: string;
  match: number;
  /** presence state */
  presence: string | null;
  /** on shift now (null: no roster known — treated as working hours) */
  on_shift: boolean | null;
  /** minutes until the shift ends (null: unknown) */
  shift_left_minutes: number | null;
  /** away by an approved absence or out of office */
  absent: boolean;
  open: number;
  limit: number;
}

export interface RoutingCandidate extends RoutingInput {
  score: number;
  eligible: boolean;
  reasons: string[];
}

/**
 * The routing score (WFM-009): skill match × availability × spare capacity. Absent, offline or off-shift people,
 * people within `guard` minutes of the end of their shift and people at their limit are not eligible; the reasons
 * say why in Persian.
 */
export function routingScore(c: RoutingInput, guard = 60): RoutingCandidate {
  const reasons: string[] = [];
  let eligible = true;
  if (c.absent) {
    eligible = false;
    reasons.push("در مرخصی یا خارج از دفتر");
  }
  if (c.presence === "offline" || c.presence === "away" || c.presence === "break") {
    eligible = false;
    reasons.push(c.presence === "offline" ? "خارج از سامانه" : c.presence === "break" ? "در استراحت" : "دور از میز");
  }
  if (c.on_shift === false) {
    eligible = false;
    reasons.push("در شیفت نیست");
  } else if (c.shift_left_minutes !== null && c.shift_left_minutes < guard) {
    eligible = false;
    reasons.push(`کمتر از ${faDigits(guard)} دقیقه تا پایان شیفت`);
  }
  if (c.open >= c.limit) {
    eligible = false;
    reasons.push("به سقف کار باز رسیده است");
  }
  const availability = c.presence === "busy" || c.presence === "meeting" ? 0.6 : 1;
  const spare = Math.max(0, 1 - c.open / Math.max(1, c.limit));
  const score = round(c.match * availability * (0.2 + 0.8 * spare), 3);
  if (eligible) reasons.push(`تطابق مهارت ${faDigits(Math.round(c.match * 100))}٪، ${faDigits(c.open)} کار باز از سقف ${faDigits(c.limit)}`);
  return { ...c, score: eligible ? score : 0, eligible, reasons };
}

/** Candidates best first; ties broken by fewer open items, then id (stable). */
export function rankCandidates(xs: RoutingCandidate[]): RoutingCandidate[] {
  return [...xs].sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score || a.open - b.open || (a.user_id < b.user_id ? -1 : 1));
}

export const levelText = (n: number) => `${proficiencyLabel(n)} (${faDigits(n)})`;

// ---------------------------------------------------------------------------------------------------------------
// Capacity and utilisation (WFM-013)

export type UtilBand = "idle" | "optimal" | "high" | "overloaded";
export const UTIL_BANDS: Record<UtilBand, { label: string; color: string }> = {
  idle: { label: "کم‌کار", color: "gray" },
  optimal: { label: "مناسب", color: "green" },
  high: { label: "زیاد", color: "gold" },
  overloaded: { label: "بیش از ظرفیت", color: "red" },
};

/** Overloaded > 84%, high 60–84%, optimal 10–60%, idle below. */
export function utilBand(pct: number | null): UtilBand {
  if (pct === null || pct < 10) return "idle";
  if (pct > 84) return "overloaded";
  if (pct >= 60) return "high";
  return "optimal";
}

export const utilisation = (open: number, capacity: number): number | null => (capacity > 0 ? round((open / capacity) * 100, 1) : null);

// ---------------------------------------------------------------------------------------------------------------
// Demand forecast (WFM-019)

export interface ForecastPoint {
  day: string;
  predicted: number;
  lower: number;
  upper: number;
  holiday: boolean;
}

export interface Forecast {
  points: ForecastPoint[];
  /** mean absolute percentage error of a back-test on the last week of history (null: too little history) */
  mape: number | null;
  /** weekday factors, Saturday first */
  weekdays: number[];
  level: number;
  holiday_factor: number;
}

/**
 * Daily volume for `days` days after `from` (exclusive of history). History: counts per day (missing days = 0) from
 * `history[0].day` up to the day before `from`. Weekday seasonality from non-holiday days, an exponentially smoothed
 * deseasonalised level, holidays scaled by their observed share (default 0.2), an 80% band from the residuals.
 */
export function forecastDaily(history: { day: string; count: number }[], from: string, days: number, holidays: Set<string>, alpha = 0.3): Forecast {
  const series = history.filter((h) => h.day < from).sort((a, b) => (a.day < b.day ? -1 : 1));
  const work = series.filter((h) => !holidays.has(h.day));
  const mean = work.length ? work.reduce((a, h) => a + h.count, 0) / work.length : 0;
  const weekdays = Array.from({ length: 7 }, (_, d) => {
    const xs = work.filter((h) => weekday(h.day) === d).map((h) => h.count);
    return xs.length && mean > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length / mean : 1;
  });
  const hol = series.filter((h) => holidays.has(h.day));
  let holidayFactor = 0.2;
  if (hol.length && mean > 0) {
    const expected = hol.reduce((a, h) => a + mean * (weekdays[weekday(h.day)] || 1), 0);
    if (expected > 0) holidayFactor = Math.min(1, hol.reduce((a, h) => a + h.count, 0) / expected);
  }
  const factor = (day: string) => (weekdays[weekday(day)] || 0) * (holidays.has(day) ? holidayFactor : 1);
  let level = mean;
  const residuals: number[] = [];
  for (const h of series) {
    const f = factor(h.day);
    if (f <= 0) continue;
    residuals.push(h.count - level * f);
    level = alpha * (h.count / f) + (1 - alpha) * level;
  }
  const sd = residuals.length > 2 ? Math.sqrt(residuals.reduce((a, r) => a + r * r, 0) / (residuals.length - 1)) : mean * 0.3;
  const points: ForecastPoint[] = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(from, i);
    const f = factor(day);
    const p = Math.max(0, level * f);
    const band = 1.28 * sd * (f > 0 ? Math.sqrt(f) : 0);
    points.push({ day, predicted: round(p, 1), lower: round(Math.max(0, p - band), 1), upper: round(p + band, 1), holiday: holidays.has(day) });
  }
  // back-test: forecast the last 7 days of history from what came before
  let mape: number | null = null;
  if (series.length >= 21) {
    const cut = series[series.length - 7].day;
    const bt = forecastDaily(series.filter((h) => h.day < cut), cut, 7, holidays, alpha);
    const errs = bt.points
      .map((pt) => ({ pt, actual: series.find((h) => h.day === pt.day)?.count ?? 0 }))
      .filter((x) => x.actual > 0)
      .map((x) => Math.abs(x.actual - x.pt.predicted) / x.actual);
    mape = errs.length ? round((errs.reduce((a, b) => a + b, 0) / errs.length) * 100, 1) : null;
  }
  return { points, mape, weekdays: weekdays.map((w) => round(w, 3)), level: round(level, 2), holiday_factor: round(holidayFactor, 3) };
}

/** Fill missing days with zeros between `from` (inclusive) and `to` (exclusive). */
export function denseDays(rows: { day: string; count: number }[], from: string, to: string): { day: string; count: number }[] {
  const by = new Map(rows.map((r) => [r.day, r.count]));
  const out: { day: string; count: number }[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) out.push({ day: d, count: by.get(d) ?? 0 });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Staffing (WFM-020)

/**
 * Agents needed for a day's work queue: volume × handle hours ÷ (productive hours × occupancy), grossed up for
 * shrinkage (leave, meetings, training).
 */
export function requiredFte(volume: number, ahtHours: number, productiveHours: number, occupancyPct: number, shrinkagePct: number): number {
  if (volume <= 0 || ahtHours <= 0 || productiveHours <= 0) return 0;
  const occ = Math.min(1, Math.max(0.05, occupancyPct / 100));
  const shrink = Math.min(0.9, Math.max(0, shrinkagePct / 100));
  return round((volume * ahtHours) / (productiveHours * occ) / (1 - shrink), 2);
}

/** Erlang C: the probability a contact waits, with traffic `a` erlangs and `n` agents (through Erlang B, stable). */
export function erlangC(a: number, n: number): number {
  if (a <= 0) return 0;
  if (n <= a) return 1;
  let b = 1;
  for (let k = 1; k <= n; k++) b = (a * b) / (k + a * b);
  const c = (n * b) / (n - a * (1 - b));
  return Math.min(1, Math.max(0, c));
}

/** Agents needed so that `targetPct`% of contacts are answered within `targetSec` (Erlang C). */
export function agentsForServiceLevel(contactsPerHour: number, ahtSec: number, targetSec: number, targetPct: number): { agents: number; service_level: number } {
  const a = (contactsPerHour * ahtSec) / 3600;
  if (a <= 0) return { agents: 0, service_level: 100 };
  for (let n = Math.max(1, Math.ceil(a)); n < Math.ceil(a) + 500; n++) {
    const pw = erlangC(a, n);
    const sl = 1 - pw * Math.exp(-((n - a) * targetSec) / ahtSec);
    if (sl * 100 >= targetPct) return { agents: n, service_level: round(sl * 100, 1) };
  }
  return { agents: Math.ceil(a) + 500, service_level: 0 };
}

// ---------------------------------------------------------------------------------------------------------------
// Shifts of rosters (WFM-015/018)

export interface RosterLike {
  user_id: string;
  group_id: string;
  pattern_id: string;
  valid_from: string;
  valid_to?: string | null;
  role?: string | null;
}

export const rosterCovers = (r: RosterLike, day: string): boolean => r.valid_from <= day && (!r.valid_to || r.valid_to >= day);

/** The working intervals [start, end) (epoch ms) of a pattern's calendar on a local date. */
export function shiftIntervals(cal: BusinessCalendar | null, day: string): [number, number][] {
  return cal ? shiftsOf(cal, day) : [];
}

export const hoursOf = (xs: [number, number][]): number => round(xs.reduce((a, [s, e]) => a + Math.max(0, e - s), 0) / 3_600_000, 2);

/** Does [a1, a2) overlap [b1, b2)? */
export const overlaps = (a1: number, a2: number, b1: number, b2: number): boolean => a1 < b2 && b1 < a2;

// ---------------------------------------------------------------------------------------------------------------
// Labour rules (WFM-043)

export interface LabourIssue {
  user_id: string;
  kind: "weekly_hours" | "rest" | "friday";
  day: string;
  detail: string;
}

/**
 * Check one person's shifts (intervals with their local date) against the rules: hours per Saturday-based week,
 * rest between consecutive shifts and Friday rest.
 */
export function labourIssues(userId: string, shifts: { day: string; start: number; end: number }[], rules: { weekly_hours_max: number; min_rest_hours: number; friday_rest?: boolean }): LabourIssue[] {
  const out: LabourIssue[] = [];
  const sorted = [...shifts].sort((a, b) => a.start - b.start);
  const weeks = new Map<string, number>();
  for (const s of sorted) {
    const wk = addDays(s.day, -weekday(s.day));
    weeks.set(wk, (weeks.get(wk) ?? 0) + (s.end - s.start) / 3_600_000);
    if (rules.friday_rest !== false && weekday(s.day) === 6) out.push({ user_id: userId, kind: "friday", day: s.day, detail: "کار در روز جمعه" });
  }
  for (const [wk, h] of weeks) if (h > rules.weekly_hours_max + 1e-9) out.push({ user_id: userId, kind: "weekly_hours", day: wk, detail: `${faDigits(round(h, 1))} ساعت در هفته (سقف ${faDigits(rules.weekly_hours_max)})` });
  for (let i = 1; i < sorted.length; i++) {
    const gap = (sorted[i].start - sorted[i - 1].end) / 3_600_000;
    // pieces of one shift (a lunch break) are not a rest period: only gaps that separate two days' shifts count
    if (sorted[i].day !== sorted[i - 1].day && gap < rules.min_rest_hours - 1e-9 && gap >= 0) out.push({ user_id: userId, kind: "rest", day: sorted[i].day, detail: `استراحت ${faDigits(round(gap, 1))} ساعت میان دو شیفت (کمینه ${faDigits(rules.min_rest_hours)})` });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Light gamification (WFM-035)

export const LEVELS: { min: number; label: string }[] = [
  { min: 0, label: "تازه‌کار" },
  { min: 100, label: "همراه" },
  { min: 300, label: "کاردان" },
  { min: 700, label: "حرفه‌ای" },
  { min: 1500, label: "استاد" },
  { min: 3000, label: "اسطوره" },
];

export function levelOf(points: number): { label: string; index: number; next: number | null; progress: number } {
  let i = 0;
  for (let k = 0; k < LEVELS.length; k++) if (points >= LEVELS[k].min) i = k;
  const next = LEVELS[i + 1]?.min ?? null;
  const progress = next === null ? 100 : Math.round(((points - LEVELS[i].min) / (next - LEVELS[i].min)) * 100);
  return { label: LEVELS[i].label, index: i, next, progress };
}

export interface BadgeInput {
  resolved_month: number;
  within_sla_pct: number | null;
  first_contact: number;
  knowledge: number;
  kudos: number;
  csat_pct: number | null;
}

/** Badges earned this month (team-friendly: none compares people). */
export function badgesOf(b: BadgeInput): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  if (b.resolved_month >= 50) out.push({ key: "fifty", label: "پنجاه حل در ماه" });
  else if (b.resolved_month >= 20) out.push({ key: "twenty", label: "بیست حل در ماه" });
  if (b.within_sla_pct !== null && b.within_sla_pct >= 100 && b.resolved_month >= 5) out.push({ key: "on_time", label: "همه در موعد" });
  if (b.first_contact >= 10) out.push({ key: "first_contact", label: "حل در نخستین تماس" });
  if (b.knowledge >= 1) out.push({ key: "author", label: "نویسندهٔ دانش" });
  if (b.kudos >= 3) out.push({ key: "thanked", label: "قدردانی همکاران" });
  if (b.csat_pct !== null && b.csat_pct >= 90) out.push({ key: "loved", label: "رضایت بالای درخواست‌کنندگان" });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Agent performance (WFM-034): the shape and the rule-based coaching notes (the AI skill's fallback)

export interface AgentMetrics {
  period: string;
  resolved: number;
  open: number;
  median_resolve_hours: number | null;
  within_sla_pct: number | null;
  reassigned_pct: number | null;
  reopened_pct: number | null;
  first_contact_pct: number | null;
  csat_pct: number | null;
  csat_n: number;
  knowledge: number;
  points: number;
}

/** Coaching notes for the agent (rule-based): strengths first, then two concrete things to work on. */
export function coachingNotes(m: AgentMetrics, team?: Partial<AgentMetrics> | null): string {
  const good: string[] = [];
  const work: string[] = [];
  if (m.within_sla_pct !== null) (m.within_sla_pct >= 95 ? good : m.within_sla_pct < 85 ? work : good).push(m.within_sla_pct >= 85 ? `${faDigits(m.within_sla_pct)}٪ کارهایتان در موعد توافق حل شد` : `فقط ${faDigits(m.within_sla_pct)}٪ کارها در موعد حل شد؛ صف «در خطر» خانهٔ کارشناس را هر روز صبح ببینید`);
  if (m.reopened_pct !== null && m.reopened_pct > 8) work.push(`${faDigits(m.reopened_pct)}٪ کارها بازگشایی شد؛ پیش از بستن، حل را با درخواست‌کننده تأیید کنید`);
  if (m.reassigned_pct !== null && m.reassigned_pct > 25) work.push(`${faDigits(m.reassigned_pct)}٪ کارها به گروه دیگری رفت؛ مهارت‌های پرتکرار این کارها را در برنامهٔ یادگیری بگذارید`);
  if (m.first_contact_pct !== null && m.first_contact_pct >= 60) good.push(`${faDigits(m.first_contact_pct)}٪ کارها بی‌ارجاع حل شد`);
  if (m.csat_pct !== null && m.csat_n >= 5) (m.csat_pct >= 85 ? good : work).push(m.csat_pct >= 85 ? `رضایت درخواست‌کنندگان ${faDigits(m.csat_pct)}٪ است` : `رضایت ${faDigits(m.csat_pct)}٪ است؛ در پاسخ‌ها مراحل بعدی و زمان آن‌ها را روشن بگویید`);
  if (m.knowledge > 0) good.push(`${faDigits(m.knowledge)} مقالهٔ دانش منتشر کردید`);
  else if (m.resolved >= 20) work.push("راه‌حل‌های تکراری را به مقالهٔ دانش تبدیل کنید تا همکاران هم از آن استفاده کنند");
  if (team?.median_resolve_hours && m.median_resolve_hours !== null && m.median_resolve_hours > team.median_resolve_hours * 1.5) work.push("زمان حل شما از میانهٔ تیم بیشتر است؛ کارهای طولانی را زودتر با سرپرست در میان بگذارید");
  const lines = [`**دورهٔ ${m.period}** — ${faDigits(m.resolved)} کار حل شد و ${faDigits(m.open)} کار باز است.`];
  if (good.length) lines.push(`**نقاط قوت:** ${good.join("؛ ")}.`);
  lines.push(work.length ? `**پیشنهاد برای بهبود:** ${work.slice(0, 3).join("؛ ")}.` : "**پیشنهاد:** همین روند را ادامه دهید و تجربه‌تان را با همکاران تازه‌کار در میان بگذارید.");
  lines.push("این یادداشت فقط برای شماست و در ارزیابی دیگران به کار نمی‌رود.");
  return lines.join("\n\n");
}

/** Is `n` people enough to show a team's numbers? */
export const teamLargeEnough = (n: number, min: number): boolean => n >= Math.max(1, min);

export type { Row as WorkforceRow };
