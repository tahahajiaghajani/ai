// Pure logic of the incident screens (no React, no antd; tests/incident-ui.test.ts): the agent's queues, row tones,
// the major-incident actions a person may take now, the update cadence of a major incident, durations in Persian,
// the merge primary of a selection, canned-response placeholders and the timeline filter.
import type { Cond } from "@shared/model/conditions";
import { fillPlaceholders, humanDuration, majorActionAllowed } from "@shared/incident/logic";
import { toPersianDigits } from "../../lib/fa";

export interface Queue {
  key: string;
  path: string;
  label: string;
  /** the queue's fixed condition (evaluated when the page opens: some depend on the clock) */
  filter: (now: number) => Cond;
  sort: string;
  columns: string[];
  emptyText: string;
}

const OPEN: Cond = { f: "active", op: "eq", v: true };
const COLUMNS = ["number", "short_description", "caller_id", "priority", "state", "assignment_group_id", "assigned_to", "sla_due", "updated_at"];
/** «نزدیک به نقض توافق»: due within this many hours (or already past) */
export const AT_RISK_HOURS = 4;

/** The agent workspace's queues (each a list page with a fixed filter; saved views add more). */
export const QUEUES: Queue[] = [
  {
    key: "mine", path: "incidents/mine", label: "رخدادهای من",
    filter: () => ({ and: [{ f: "assigned_to", op: "is_me" }, OPEN] }), sort: "priority,sla_due",
    columns: ["number", "short_description", "caller_id", "priority", "state", "sla_due", "updated_at"], emptyText: "رخداد بازی به شما سپرده نشده است",
  },
  {
    key: "unassigned", path: "incidents/unassigned", label: "بی‌مسئول در گروه‌های من",
    filter: () => ({ and: [{ f: "assignment_group_id", op: "is_my_group" }, { f: "assigned_to", op: "empty" }, OPEN] }), sort: "priority,opened_at",
    columns: ["number", "short_description", "caller_id", "priority", "assignment_group_id", "sla_due", "opened_at"], emptyText: "همهٔ رخدادهای گروه‌های شما مسئول دارند",
  },
  {
    key: "high", path: "incidents/high", label: "اولویت بالا",
    filter: () => ({ and: [{ f: "priority", op: "in", v: ["1", "2"] }, OPEN] }), sort: "priority,sla_due",
    columns: COLUMNS, emptyText: "رخداد باز با اولویت ۱ یا ۲ نیست",
  },
  {
    key: "at-risk", path: "incidents/at-risk", label: "نزدیک به نقض توافق",
    filter: (now) => ({ and: [OPEN, { f: "sla_due", op: "lte", v: new Date(now + AT_RISK_HOURS * 3600_000).toISOString() }] }), sort: "sla_due",
    columns: ["number", "short_description", "priority", "state", "assignment_group_id", "assigned_to", "sla_due"], emptyText: "رخدادی در چند ساعت آینده به موعد توافق نمی‌رسد",
  },
  {
    key: "awaiting", path: "incidents/awaiting", label: "منتظر درخواست‌دهنده",
    filter: () => ({ and: [{ f: "state", op: "eq", v: "on_hold" }, { f: "hold_reason", op: "eq", v: "awaiting_caller" }] }), sort: "hold_since",
    columns: ["number", "short_description", "caller_id", "assigned_to", "hold_since", "follow_ups"], emptyText: "رخدادی منتظر پاسخ درخواست‌دهنده نیست",
  },
  {
    key: "resolved-today", path: "incidents/resolved-today", label: "حل‌شده امروز",
    filter: () => ({ and: [{ f: "resolved_at", op: "relative", v: { unit: "day", n: 0, dir: "past" } }, { f: "state", op: "in", v: ["resolved", "closed"] }] }), sort: "-resolved_at",
    columns: ["number", "short_description", "caller_id", "close_code", "resolved_by", "resolved_at"], emptyText: "امروز هنوز رخدادی حل نشده است",
  },
  {
    key: "major", path: "incidents/major", label: "رخدادهای عمده",
    filter: () => ({ f: "major_state", op: "in", v: ["candidate", "proposed", "accepted"] }), sort: "major_state,-opened_at",
    columns: ["number", "short_description", "major_state", "priority", "state", "mi_manager_id", "next_update_at"], emptyText: "رخداد عمدهٔ فعالی نیست",
  },
];

export const queueOf = (key: string): Queue | undefined => QUEUES.find((q) => q.key === key);

/** A quiet tint for rows that need attention: overdue or a declared major incident (danger), P1 or due within the hour (warning). */
export function rowTone(row: Record<string, unknown>, now = Date.now()): "danger" | "warning" | null {
  if (!row.active && row.active !== undefined) return null;
  const due = Date.parse(String(row.sla_due ?? ""));
  if (row.major_state === "accepted") return "danger";
  if (!Number.isNaN(due) && due < now) return "danger";
  if (row.priority === "1") return "warning";
  if (!Number.isNaN(due) && due - now < 3600_000) return "warning";
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Major incidents

export interface MajorMenuItem {
  action: "propose" | "declare" | "reject" | "downgrade";
  label: string;
  danger?: boolean;
  /** the dialog asks for a reason */
  reason: boolean;
}

const MAJOR_ITEMS: MajorMenuItem[] = [
  { action: "declare", label: "اعلام رخداد عمده", reason: false },
  { action: "propose", label: "پیشنهاد رخداد عمده", reason: true },
  { action: "reject", label: "رد پیشنهاد رخداد عمده", reason: true },
  { action: "downgrade", label: "خروج از رخداد عمده", danger: true, reason: true },
];

/** What a person may do on the overlay now: proposing needs to work the incident, the rest the manager's grant. */
export function majorMenu(state: string | null | undefined, open: boolean, may: { work: boolean; manage: boolean }): MajorMenuItem[] {
  return MAJOR_ITEMS.filter((m) => {
    if (!majorActionAllowed(m.action, state ?? null)) return false;
    if ((m.action === "declare" || m.action === "propose") && !open) return false;
    if (m.action === "propose") return may.work && !may.manage;
    return may.manage;
  });
}

/** The cadence of a major incident's updates: when the next is due and how urgent that is. */
export function cadence(nextIso: string | null | undefined, now = Date.now()): { tone: "danger" | "warning" | "neutral" | null; text: string } {
  if (!nextIso) return { tone: null, text: "" };
  const t = Date.parse(nextIso);
  if (Number.isNaN(t)) return { tone: null, text: "" };
  const diff = t - now;
  if (diff < 0) return { tone: "danger", text: `${persian(humanDuration(-diff))} از موعد اطلاع‌رسانی گذشته است` };
  if (diff < 10 * 60_000) return { tone: "warning", text: `${persian(humanDuration(diff))} تا اطلاع‌رسانی بعدی` };
  return { tone: "neutral", text: `${persian(humanDuration(diff))} تا اطلاع‌رسانی بعدی` };
}

// ---------------------------------------------------------------------------------------------------------------
// Small helpers

export const persian = (s: string) => toPersianDigits(s);

/** «۲ ساعت و ۱۵ دقیقه» from seconds (empty for nothing). */
export function durationText(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "";
  if (seconds < 60) return "کمتر از یک دقیقه";
  return persian(humanDuration(seconds * 1000));
}

/** The primary of a merge: the oldest of the selected incidents (by opening time, then number). */
export function mergePrimary<T extends { id: string; opened_at?: unknown; number?: unknown }>(rows: T[]): { primary: T | null; rest: T[] } {
  if (!rows.length) return { primary: null, rest: [] };
  const sorted = [...rows].sort((a, b) => Date.parse(String(a.opened_at ?? "")) - Date.parse(String(b.opened_at ?? "")) || String(a.number ?? "").localeCompare(String(b.number ?? "")));
  return { primary: sorted[0], rest: sorted.slice(1) };
}

/** Fill a canned response for a record: {{caller}} {{number}} {{title}} {{assignee}} {{group}} {{me}}. */
export function cannedText(body: string, row: Record<string, unknown>, display: Record<string, string>, me: string): string {
  const name = (v: unknown) => (typeof v === "string" && v ? display[v] ?? "" : "");
  return fillPlaceholders(body, {
    caller: name(row.requested_for) || name(row.caller_id),
    number: String(row.number ?? ""),
    title: String(row.short_description ?? ""),
    assignee: name(row.assigned_to) || me,
    group: name(row.assignment_group_id),
    me,
  });
}

/** Canned responses offered on a composer tab (`kind` both or the tab's), active ones, the record's category first. */
export function cannedFor<T extends Record<string, unknown>>(rows: T[], tab: "comment" | "work_note", category: unknown): T[] {
  return rows
    .filter((r) => r.active !== false && (r.kind === "both" || r.kind === tab || !r.kind))
    .sort((a, b) => Number(b.category === category && !!category) - Number(a.category === category && !!category) || Number(a.sort_order ?? 100) - Number(b.sort_order ?? 100) || String(a.name).localeCompare(String(b.name)));
}

/** The timeline a view shows: everything, or only key events. */
export function visibleTimeline<T extends { key?: boolean }>(items: T[], keyOnly: boolean): T[] {
  return keyOnly ? items.filter((x) => x.key) : items;
}

/** A local `datetime-local` value («YYYY-MM-DDTHH:mm») of an instant in a time zone, and back. */
export function localInput(ms: number, tz: string): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}
