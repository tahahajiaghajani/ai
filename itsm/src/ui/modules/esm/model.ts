// Pure helpers of the enterprise service screens (tested in tests/esm-ui.test.ts): where each department's case table
// lives in the app, the journey tracker's phases and readiness, and the booking grid's free hours.
import { toFa } from "@shared/jalali";
import type { Cond } from "@shared/model/conditions";
import { ACTIVITY_STATES, JOURNEY_PHASES, JOURNEY_STATES } from "@shared/tables/esm";
import type { ChipTone } from "../../components/display";

export type Row = Record<string, any>;

/** Paths of the department case tables (the nav lists and links). */
export const CASE_PATHS: Record<string, string> = {
  hr_case: "hr/cases",
  facility_request: "facilities/requests",
  hse_event: "facilities/hse",
  finance_case: "finance/cases",
  legal_request: "legal/requests",
  purchase_request: "procurement/requests",
  service_case: "departments/cases",
};

export interface Queue {
  key: string;
  label: string;
  path: string;
  table: string;
  filter: Cond;
  sort: string;
  empty: string;
}

const ACTIVE: Cond = { f: "active", op: "eq", v: true };

export const QUEUES: Queue[] = [
  { key: "hr_mine", table: "hr_case", label: "پرونده‌های منابع انسانی من", path: "hr/my-cases", sort: "priority,sla_due", filter: { and: [ACTIVE, { f: "assigned_to", op: "is_me" }] }, empty: "پروندهٔ بازی به شما سپرده نشده است" },
  { key: "hr_group", table: "hr_case", label: "بی‌کارشناس در گروه‌های من", path: "hr/unassigned", sort: "priority,opened_at", filter: { and: [ACTIVE, { f: "assignment_group_id", op: "is_my_group" }, { f: "assigned_to", op: "empty" }] }, empty: "پروندهٔ بی‌کارشناسی در گروه‌های شما نیست" },
  { key: "fac_group", table: "facility_request", label: "درخواست‌های پشتیبانی گروه من", path: "facilities/my-group", sort: "priority,opened_at", filter: { and: [ACTIVE, { f: "assignment_group_id", op: "is_my_group" }] }, empty: "درخواست بازی در گروه‌های شما نیست" },
  { key: "visits_today", table: "visit", label: "مراجعه‌کنندگان امروز", path: "facilities/reception", sort: "expected_at", filter: { and: [{ f: "expected_at", op: "relative", v: { unit: "day", from: 0, to: 0 } }, { f: "state", op: "nin", v: ["cancelled"] }] }, empty: "امروز مراجعه‌کننده‌ای ثبت نشده است" },
];

export const journeyState = (v: unknown) => JOURNEY_STATES.states.find((s) => s.value === v);
export const activityState = (v: unknown) => ACTIVITY_STATES.states.find((s) => s.value === v);

export interface PhaseGroup {
  key: string;
  label: string;
  activities: Row[];
  done: number;
}

/** Activities by phase in the template's order (phases without activities are left out; unknown phases go last). */
export function byPhase(activities: readonly Row[]): PhaseGroup[] {
  const order = new Map(JOURNEY_PHASES.map((p, i) => [p.value, i]));
  const groups = new Map<string, Row[]>();
  for (const a of activities) {
    const k = String(a.phase ?? "after");
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  return [...groups.entries()]
    .sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99))
    .map(([key, acts]) => ({ key, label: JOURNEY_PHASES.find((p) => p.value === key)?.label ?? key, activities: acts, done: acts.filter((a) => a.state === "done" || a.state === "skipped").length }));
}

/** The tone of an activity: overdue (danger), failed (danger), waiting for approval (warning), done (in). */
export function activityTone(a: Row, today: string): ChipTone {
  if (a.state === "failed") return "danger";
  if (a.state === "done" || a.state === "skipped") return "in";
  if (a.approval === "requested") return "warning";
  if (a.overdue || (a.due_date && String(a.due_date) < today)) return "danger";
  return a.state === "in_progress" ? "accent" : "neutral";
}

/** Day-one readiness: «آماده» when every day-one activity is done; otherwise what remains. */
export function readiness(j: Row): { ready: boolean; text: string } {
  const total = Number(j.day_one_total ?? 0);
  const done = Number(j.day_one_done ?? 0);
  if (!total) return { ready: true, text: "فعالیت روز نخستی ندارد" };
  return done >= total ? { ready: true, text: "برای روز نخست آماده است" } : { ready: false, text: `${toFa(total - done)} از ${toFa(total)} کار روز نخست مانده است` };
}

/** Free half-hours of a space between `from` and `to` given its busy spans (ISO instants). */
export function freeSlots(busy: readonly { start: string; end: string }[], from: number, to: number, stepMinutes = 30): { start: number; end: number }[] {
  const step = stepMinutes * 60_000;
  const spans = busy.map((b) => [Date.parse(b.start), Date.parse(b.end)] as const).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  const out: { start: number; end: number }[] = [];
  for (let t = from; t + step <= to; t += step) {
    if (!spans.some(([a, b]) => a < t + step && t < b)) out.push({ start: t, end: t + step });
  }
  return out;
}
