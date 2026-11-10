// Pure logic of the SLA service's screens (docs/spec/services/sla.md §7): the week editor of a working calendar, the
// visual preview of an SLA definition, the approval-rule builder's sentences, the priority matrix grid, the category
// tree, the holiday list by Jalali month and the due state of an approval. No React or antd here (tests:
// tests/sla-ui.test.ts); the arithmetic itself is the shared one the server uses (@shared/sla/*).
import type { Option } from "@shared/model/types";
import {
  addBusiness, businessBetween, calendarOf, DEFAULT_HOURS, FULL_HOURS, hoursProblem, midnightOf, parseHours, parseTime, weekMinutes, workingIntervals,
  type BusinessCalendar, type HoursJson,
} from "@shared/sla/calendar";
import { warnLevels } from "@shared/sla/timer";
import type { ApprovalRule, LevelDef, SourceDef } from "@shared/sla/approvals";
import { addDays, JALALI_MONTHS, toFa, toJalali, weekday, WEEKDAYS } from "@shared/jalali";

const DAY_MIN = 1440;

// ---------------------------------------------------------------------------------------------------------------
// Week editor of a working calendar

/** One working interval as typed ("HH:MM" twice); an end before the start is an overnight shift. */
export type Interval = [string, string];
/** Seven days, Saturday first. */
export type WeekDraft = Interval[][];

/** The stored `hours` as an editable draft (seven days; entries kept as typed so a mistake can be fixed). */
export function weekDraft(raw: unknown): WeekDraft {
  return Array.from({ length: 7 }, (_, d) => {
    const day = Array.isArray(raw) && Array.isArray(raw[d]) ? (raw[d] as unknown[]) : [];
    return day.filter((p): p is unknown[] => Array.isArray(p) && p.length === 2).map((p) => [String(p[0] ?? ""), String(p[1] ?? "")] as Interval);
  });
}

/** Ready-made weeks offered by the editor. */
export const WEEK_PRESETS: { key: string; label: string; hours: HoursJson }[] = [
  { key: "office", label: "اداری: شنبه تا چهارشنبه ۸ تا ۱۶، پنجشنبه تا ۱۲", hours: DEFAULT_HOURS },
  { key: "full", label: "شبانه‌روزی، همهٔ روزها", hours: FULL_HOURS },
  {
    key: "shifts",
    label: "دو نوبت: ۷ تا ۱۵ و ۱۵ تا ۲۳، جز جمعه",
    hours: [...Array.from({ length: 6 }, () => [["07:00", "15:00"], ["15:00", "23:00"]] as [string, string][]), []],
  },
];

/** What a person typed as a time, tidied: «۸» → 08:00, «830» → 08:30, «8.30» → 08:30 (unchanged when not a time). */
export function normalizeTime(raw: string): string {
  const s = raw.trim().replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[.٫/]/g, ":");
  let t = s;
  if (/^\d{1,2}$/.test(s)) t = `${s}:00`;
  else if (/^\d{3,4}$/.test(s)) t = `${s.slice(0, -2)}:${s.slice(-2)}`;
  const m = parseTime(t);
  if (m === null) return raw;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** The interval «+» adds to a day: 08:00–16:00 on an empty day, else an hour after its latest end (null: no room). */
export function nextInterval(day: readonly Interval[]): Interval | null {
  if (!day.length) return ["08:00", "16:00"];
  let latest = 0;
  for (const [a, b] of day) {
    const s = parseTime(a);
    const e = parseTime(b);
    if (s === null || e === null) continue;
    latest = Math.max(latest, e > s ? e : DAY_MIN);
  }
  const start = latest + 60;
  if (start > DAY_MIN - 60) return null;
  const end = Math.min(start + 240, DAY_MIN);
  const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return [hm(start), hm(end)];
}

/** `week` with day `d` replaced. */
export const withDay = (week: WeekDraft, d: number, day: Interval[]): WeekDraft => week.map((x, i) => (i === d ? day.map((p) => [...p] as Interval) : x));

/** `week` with day `from`'s intervals copied to the days in `to`. */
export const copyDayTo = (week: WeekDraft, from: number, to: readonly number[]): WeekDraft =>
  week.map((x, i) => (to.includes(i) && i !== from ? week[from].map((p) => [...p] as Interval) : x));

/** What is wrong with one day's intervals (Persian), or null. */
export function dayProblem(day: readonly Interval[]): string | null {
  return hoursProblem([day, [], [], [], [], [], []]);
}

/** Working minutes per weekday and in the week (valid intervals only). */
export function weekTotals(week: WeekDraft): { perDay: number[]; total: number } {
  const perDay = weekMinutes(parseHours(week));
  return { perDay, total: perDay.reduce((a, b) => a + b, 0) };
}

/** Minutes as words: «۴۴ ساعت»، «۷ ساعت و ۳۰ دقیقه»، «۴۵ دقیقه»، «—». */
export function minutesText(m: number): string {
  if (!m) return "—";
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${toFa(r)} دقیقه`;
  return r ? `${toFa(h)} ساعت و ${toFa(r)} دقیقه` : `${toFa(h)} ساعت`;
}

export interface DayBar {
  /** percent of the day from its start (00:00) */
  from: number;
  to: number;
  /** runs past midnight (continues on the next day's bar) */
  overnight?: boolean;
  /** the tail of the previous day's overnight shift */
  carry?: boolean;
}

/** Bars of day `d` on a 24-hour scale: its own intervals and the tail of the previous day's overnight shifts. */
export function dayBars(week: WeekDraft, d: number): DayBar[] {
  const pct = (m: number) => Math.round((m / DAY_MIN) * 10000) / 100;
  const out: DayBar[] = [];
  const parsed = parseHours(week);
  for (const [a, b] of parsed[(d + 6) % 7]) if (b <= a && b > 0) out.push({ from: 0, to: pct(b), carry: true });
  for (const [a, b] of parsed[d]) out.push(b > a ? { from: pct(a), to: pct(b) } : { from: pct(a), to: 100, ...(b > 0 ? { overnight: true } : {}) });
  return out.sort((x, y) => x.from - y.from);
}

export interface UpcomingDay {
  date: string;
  weekday: string;
  /** working minutes of that local day under the week and the holidays */
  minutes: number;
  holiday?: { title: string; half: boolean };
}

/** The next `n` days from `from` (ISO date) as the calendar would count them: working minutes, holidays, half days. */
export function upcomingDays(week: WeekDraft, tz: string, holidays: readonly { date: string; title?: string; half?: boolean }[], from: string, n = 14): UpcomingDay[] {
  const cal = calendarOf({ timezone: tz, hours: week }, holidays.map((h) => ({ date: h.date, title: h.title ?? null, half_day: !!h.half })), tz);
  const out: UpcomingDay[] = [];
  for (let i = 0; i < n; i++) {
    const date = addDays(from, i);
    const a = midnightOf(date, tz);
    const b = midnightOf(addDays(date, 1), tz);
    const h = cal.holidays.get(date);
    out.push({ date, weekday: WEEKDAYS[weekday(date)], minutes: Math.round(businessBetween(cal, a, b) / 60_000), ...(h ? { holiday: { title: h.title ?? "", half: !!h.half } } : {}) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// SLA definition preview

export interface PreviewMark {
  kind: "start" | "warn" | "breach";
  /** share of the target's working time (0–100) */
  pct: number;
  /** the instant it is reached */
  at: number;
  /** where it sits on the wall-clock axis from the start to the breach (0–100) */
  pos: number;
  label: string;
}

export interface SlaPreview {
  /** the target in seconds of working time (null: none for this priority) */
  duration: number | null;
  start: number;
  /** the deadline (null: no target, or a calendar without working time) */
  end: number | null;
  marks: PreviewMark[];
  /** working stretches between the start and the deadline, as positions on the axis (0–100) */
  working: [number, number][];
  /** wall-clock time from the start to the deadline */
  wallMs: number | null;
}

/** Where a timer would reach its warnings and its breach when started at `start` (the same maths as the server). */
export function slaPreview(o: { duration: number | null | undefined; warn: unknown; cal: BusinessCalendar | null; start: number }): SlaPreview {
  const duration = o.duration && o.duration > 0 ? Math.round(o.duration) : null;
  const base: SlaPreview = { duration, start: o.start, end: null, marks: [], working: [], wallMs: null };
  if (!duration) return base;
  const end = addBusiness(o.cal, o.start, duration * 1000);
  if (end === null) return base;
  const span = Math.max(1, end - o.start);
  const pos = (t: number) => Math.min(100, Math.max(0, Math.round(((t - o.start) / span) * 10000) / 100));
  const marks: PreviewMark[] = [{ kind: "start", pct: 0, at: o.start, pos: 0, label: "شروع" }];
  for (const p of warnLevels(o.warn)) {
    const at = addBusiness(o.cal, o.start, (duration * 1000 * p) / 100);
    if (at !== null) marks.push({ kind: "warn", pct: p, at, pos: pos(at), label: `هشدار ${toFa(p)}٪` });
  }
  marks.push({ kind: "breach", pct: 100, at: end, pos: 100, label: "موعد" });
  const working: [number, number][] = o.cal ? workingIntervals(o.cal, o.start, end).map(([a, b]) => [pos(a), pos(b)]) : [[0, 100]];
  return { duration, start: o.start, end, marks, working, wallMs: end - o.start };
}

/** Which marks of the axis keep their label: the start and the deadline always, a warning when it has room (`gap` %). */
export function axisLabels(marks: readonly Pick<PreviewMark, "kind" | "pos">[], gap = 6): boolean[] {
  const end = marks.find((m) => m.kind === "breach")?.pos ?? 100;
  let last = -Infinity;
  return marks.map((m) => {
    if (m.kind !== "warn") {
      if (m.kind === "start") last = m.pos;
      return true;
    }
    const ok = m.pos - last >= gap && end - m.pos >= gap;
    if (ok) last = m.pos;
    return ok;
  });
}

/** The per-priority targets as a draft of seconds (one entry per priority option). */
export function durationsDraft(raw: unknown, priorities: readonly Option[]): Record<string, number | null> {
  const map = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, number | null> = {};
  for (const p of priorities) {
    const n = Number(map[p.value]);
    out[p.value] = Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }
  return out;
}

/** The draft as stored: priorities without a target are left out. */
export function durationsValue(draft: Record<string, number | null | undefined>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(draft)) if (typeof v === "number" && v > 0) out[k] = Math.round(v);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Approval rule builder

/** A new level: the requester's manager, one approval enough. */
export const emptyLevel = (): LevelDef => ({ name: "", sources: [{ kind: "manager" }], rule: "any" });

/** A new source of a kind, with empty choices. */
export function emptySource(kind: SourceDef["kind"]): SourceDef {
  switch (kind) {
    case "users":
      return { kind, users: [] };
    case "groups":
      return { kind, groups: [] };
    case "field":
      return { kind, field: "" };
    case "owner":
      return { kind, of: "" };
    default:
      return { kind: "manager" };
  }
}

export interface Names {
  user: (id: string) => string | undefined;
  group: (id: string) => string | undefined;
  field: (name: string) => string | undefined;
}

const list = (xs: string[]) => (xs.length <= 2 ? xs.join(" و ") : `${xs.slice(0, 2).join("، ")} و ${toFa(xs.length - 2)} نفر دیگر`);

/** A source in words: «مدیر درخواست‌دهنده»، «اعضای گروه شبکه»، «علی و رضا»… */
export function sourceText(s: SourceDef, n: Names): string {
  switch (s.kind) {
    case "users": {
      if (!s.users?.length) return "افرادی که برمی‌گزینید";
      const known = s.users.map((u) => n.user(u));
      return known.every(Boolean) ? list(known as string[]) : `${toFa(s.users.length)} نفر`;
    }
    case "groups": {
      if (!s.groups?.length) return "اعضای گروه‌هایی که برمی‌گزینید";
      const known = s.groups.map((g) => n.group(g));
      return known.every(Boolean) ? `اعضای ${known.map((x) => `«${x}»`).join(" و ")}` : `اعضای ${toFa(s.groups.length)} گروه`;
    }
    case "manager":
      return Number(s.depth) === 2 ? "مدیرِ مدیر درخواست‌دهنده" : "مدیر درخواست‌دهنده";
    case "field":
      return s.field ? `کسی که در «${n.field(s.field) ?? s.field}» آمده است` : "فیلدی از رکورد";
    case "owner":
      return s.of ? `مالک (${s.of})` : "مالک خدمت یا پیکربندی";
  }
}

/** A level's rule in words. */
export function ruleText(rule: ApprovalRule | string | undefined, threshold?: number | null): string {
  if (rule === "all") return "همه باید تأیید کنند";
  if (rule === "count") return `${toFa(Math.max(1, Number(threshold) || 1))} نفر باید تأیید کنند`;
  if (rule === "percent") return `${toFa(Math.min(100, Math.max(1, Number(threshold) || 1)))}٪ باید تأیید کنند`;
  if (rule === "first") return "نخستین پاسخ، تأیید یا رد، تصمیم را می‌گیرد";
  return "یک تأیید کافی است";
}

/** The sentence of a level: «سطح ۱ (مدیر): مدیر درخواست‌دهنده — یک تأیید کافی است». */
export function levelSentence(level: LevelDef, i: number, n: Names): string {
  const who = level.sources.map((s) => sourceText(s, n)).join(" یا ");
  return `سطح ${toFa(i + 1)}${level.name ? ` (${level.name})` : ""}: ${who} — ${ruleText(level.rule, level.threshold)}`;
}

/** `xs` with the item at `from` moved to `to`. */
export function moveItem<T>(xs: readonly T[], from: number, to: number): T[] {
  const out = [...xs];
  if (from < 0 || from >= out.length || to < 0 || to >= out.length) return out;
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Priority matrix grid

export type MatrixDraft = Record<string, Record<string, string | null>>;

/** Every impact × urgency cell of `cells` (empty ones null). */
export function matrixDraft(cells: unknown, impacts: readonly string[], urgencies: readonly string[]): MatrixDraft {
  const src = cells && typeof cells === "object" && !Array.isArray(cells) ? (cells as Record<string, Record<string, unknown>>) : {};
  const out: MatrixDraft = {};
  for (const i of impacts) {
    out[i] = {};
    for (const u of urgencies) {
      const v = src[i] && typeof src[i] === "object" ? src[i][u] : undefined;
      out[i][u] = v === null || v === undefined || v === "" ? null : String(v);
    }
  }
  return out;
}

export const setCell = (m: MatrixDraft, i: string, u: string, p: string | null): MatrixDraft => ({ ...m, [i]: { ...(m[i] ?? {}), [u]: p } });

/** The draft as stored: empty cells left out. */
export function matrixValue(m: MatrixDraft): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [i, row] of Object.entries(m)) for (const [u, p] of Object.entries(row)) if (p) (out[i] ??= {})[u] = p;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Category tree

export interface CategoryRow {
  id: string;
  name: string;
  value: string;
  parent_id?: string | null;
  sort_order?: number | null;
  active?: boolean | null;
  [k: string]: unknown;
}

export interface CategoryNode {
  row: CategoryRow;
  children: CategoryNode[];
}

const byOrder = (a: CategoryRow, b: CategoryRow) => (Number(a.sort_order ?? 100) - Number(b.sort_order ?? 100)) || a.name.localeCompare(b.name, "fa");

/** Categories as a two-level tree (a row whose parent is missing is a root), in order. */
export function categoryTree(rows: readonly CategoryRow[]): CategoryNode[] {
  const ids = new Set(rows.map((r) => r.id));
  const roots = rows.filter((r) => !r.parent_id || !ids.has(r.parent_id)).sort(byOrder);
  return roots.map((r) => ({ row: r, children: rows.filter((c) => c.parent_id === r.id).sort(byOrder).map((c) => ({ row: c, children: [] })) }));
}

/** A code for a new category from its name (Latin letters, digits, _ . -; empty when the name has none). */
export function suggestCode(name: string, taken: ReadonlySet<string>): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  if (!base) return "";
  let code = base;
  for (let i = 2; taken.has(code); i++) code = `${base}_${i}`;
  return code;
}

// ---------------------------------------------------------------------------------------------------------------
// Holidays by Jalali month

export interface HolidayRow {
  id: string;
  date: string;
  title: string;
  [k: string]: unknown;
}

/** Holidays of Jalali year `jy` grouped by month, in date order. */
export function holidaysByMonth<T extends HolidayRow>(rows: readonly T[], jy: number): { month: number; label: string; items: T[] }[] {
  const groups = new Map<number, T[]>();
  for (const r of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
    const j = toJalali(r.date);
    if (j.jy !== jy) continue;
    groups.set(j.jm, [...(groups.get(j.jm) ?? []), r]);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([month, items]) => ({ month, label: JALALI_MONTHS[month - 1], items }));
}

/** «دوشنبه» of an ISO date. */
export const weekdayName = (iso: string): string => WEEKDAYS[weekday(iso)];

// ---------------------------------------------------------------------------------------------------------------
// Approvals

/** How close an approval's deadline is: past it (danger), within a day (warning), or nothing to say. */
export function dueState(due: string | null | undefined, now = Date.now()): { tone: "danger" | "warning" | null; text: string } {
  const t = due ? Date.parse(due) : NaN;
  if (Number.isNaN(t)) return { tone: null, text: "" };
  const left = t - now;
  if (left <= 0) return { tone: "danger", text: "مهلت گذشته" };
  if (left < 86_400_000) {
    const h = Math.floor(left / 3_600_000);
    return { tone: "warning", text: h ? `${toFa(h)} ساعت تا پایان مهلت` : `${toFa(Math.max(1, Math.round(left / 60_000)))} دقیقه تا پایان مهلت` };
  }
  return { tone: null, text: "" };
}

export interface ApprovalLike {
  id: string;
  round?: number | null;
  level?: number | null;
  rule_id?: string | null;
  rule_name?: string | null;
  level_name?: string | null;
  rule?: string | null;
  threshold?: number | null;
  state: string;
}

export interface ApprovalStep<T extends ApprovalLike> {
  key: string;
  title: string;
  rule: string;
  rows: T[];
}

/** A record's approvals as steps (newest round first, then by level), each with its rule in words. */
export function approvalSteps<T extends ApprovalLike>(rows: readonly T[]): ApprovalStep<T>[] {
  const steps = new Map<string, ApprovalStep<T>>();
  const sorted = [...rows].sort((a, b) => Number(b.round ?? 1) - Number(a.round ?? 1) || String(a.rule_id ?? "").localeCompare(String(b.rule_id ?? "")) || Number(a.level ?? 1) - Number(b.level ?? 1));
  for (const r of sorted) {
    const key = `${r.rule_id ?? ""}:${r.round ?? 1}:${r.level ?? 1}`;
    let s = steps.get(key);
    if (!s) {
      const parts = [r.rule_name || "تأیید", r.level_name || (Number(r.level ?? 1) > 1 || r.rule_id ? `سطح ${toFa(Number(r.level ?? 1))}` : ""), Number(r.round ?? 1) > 1 ? `دور ${toFa(Number(r.round))}` : ""];
      s = { key, title: parts.filter(Boolean).join(" · "), rule: ruleText(r.rule ?? "any", r.threshold), rows: [] };
      steps.set(key, s);
    }
    s.rows.push(r);
  }
  return [...steps.values()];
}
