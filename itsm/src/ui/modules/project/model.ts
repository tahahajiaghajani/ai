// Pure helpers of the project screens (tested in tests/project-ui.test.ts): queues, the Gantt's geometry, health and
// load tones.
import type { Cond } from "@shared/model/conditions";
import { HEALTH } from "@shared/tables/project";
import type { ChipTone } from "../../components/display";

export type Row = Record<string, any>;

export interface Queue {
  key: string;
  label: string;
  path: string;
  table: string;
  filter: Cond;
  sort?: string;
  empty: string;
}

const RUNNING: Cond = { f: "state", op: "in", v: ["planning", "executing", "closing", "on_hold", "approved", "gate", "proposed"] };

export const QUEUES: Queue[] = [
  { key: "mine", table: "project", label: "پروژه‌های من", path: "projects/mine", sort: "planned_end", filter: { and: [RUNNING, { or: [{ f: "project_manager_id", op: "is_me" }, { f: "sponsor_id", op: "is_me" }] }] }, empty: "پروژهٔ بازی ندارید" },
  { key: "at_risk", table: "project", label: "پروژه‌های در خطر", path: "projects/at-risk", sort: "-schedule_variance_days", filter: { and: [RUNNING, { f: "health", op: "in", v: ["amber", "red"] }] }, empty: "پروژه‌ای در خطر نیست" },
  { key: "tasks", table: "project_task", label: "کارهای پروژهٔ من", path: "projects/my-tasks", sort: "planned_end", filter: { and: [{ f: "assigned_to", op: "is_me" }, { f: "state", op: "in", v: ["open", "in_progress", "blocked"] }] }, empty: "کار پروژهٔ بازی به شما سپرده نشده است" },
  { key: "time", table: "time_entry", label: "ثبت زمان من", path: "projects/my-time", sort: "-entry_date", filter: { f: "user_id", op: "is_me" }, empty: "هنوز زمانی ثبت نکرده‌اید" },
  { key: "approve", table: "time_entry", label: "زمان‌های منتظر تأیید", path: "projects/time-approvals", sort: "entry_date", filter: { and: [{ f: "state", op: "eq", v: "submitted" }, { f: "project_manager_id", op: "is_me" }] }, empty: "زمانی منتظر تأیید شما نیست" },
];

export const healthLabel = (v: unknown) => HEALTH.find((o) => o.value === v)?.label ?? "نامعلوم";
export const healthTone = (v: unknown): ChipTone => (v === "green" ? "in" : v === "amber" ? "warning" : v === "red" ? "danger" : "neutral");

/** The load tone of a heat-map cell (percent of the weekly capacity). */
export const loadTone = (load: number): "low" | "ok" | "high" | "over" => (load <= 0 ? "low" : load < 80 ? "ok" : load <= 100 ? "high" : "over");

// ---------------------------------------------------------------------------------------------------------------
// The Gantt's geometry

const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);

export interface GanttRange {
  from: string;
  to: string;
  days: number;
}

/** The days the chart shows: the tasks' and baselines' span with a margin, at least two weeks. */
export function ganttRange(tasks: Row[], today: string): GanttRange {
  const dates: number[] = [];
  for (const t of tasks) for (const f of ["planned_start", "planned_end", "baseline_start", "baseline_end"]) if (typeof t[f] === "string" && t[f]) dates.push(ms(t[f]));
  if (!dates.length) dates.push(ms(today));
  const lo = Math.min(...dates) - 2 * DAY;
  const hi = Math.max(...dates, lo + 14 * DAY) + 3 * DAY;
  const days = Math.round((hi - lo) / DAY);
  return { from: new Date(lo).toISOString().slice(0, 10), to: new Date(hi).toISOString().slice(0, 10), days };
}

/** A bar's position in percent of the range (inline start and size); null without dates. */
export function barOf(start: unknown, end: unknown, r: GanttRange): { start: number; size: number } | null {
  if (typeof start !== "string" || !start) return null;
  const s = ms(start);
  const e = typeof end === "string" && end ? ms(end) : s;
  const lo = ms(r.from);
  const span = r.days * DAY;
  return { start: ((s - lo) / span) * 100, size: Math.max(((e - s + DAY) / span) * 100, 0.6) };
}

/** Indentation depth from a WBS number (1 → 0, 1.2 → 1, 1.2.3 → 2). */
export const depthOf = (wbs: unknown) => (typeof wbs === "string" && wbs ? wbs.split(".").length - 1 : 0);

/** Dependency arrows between bars: from the predecessor's end to the successor's start (row indices). */
export function arrowsOf(tasks: Row[]): { from: number; to: number; critical: boolean }[] {
  const index = new Map(tasks.map((t, i) => [String(t.id), i]));
  const out: { from: number; to: number; critical: boolean }[] = [];
  tasks.forEach((t, i) => {
    for (const d of Array.isArray(t.depends_on) ? t.depends_on : []) {
      const j = index.get(String(d));
      if (j !== undefined) out.push({ from: j, to: i, critical: !!(t.is_critical && tasks[j].is_critical) });
    }
  });
  return out;
}
