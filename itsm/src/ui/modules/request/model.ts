// Pure logic of the request screens (no React, no antd; tests/request-ui.test.ts): the fulfillers' queues, row tones,
// the order form's sections and visible questions, prices and promises in Persian, the stage bar, error keys of the
// server mapped onto the form, the builder's helpers (a technical name from a label, a new question of a type,
// moving rows, a policy as a sentence) and the cart's totals.
import type { Cond } from "@shared/model/conditions";
import { formState, type Answers, type FormSchema, type FormState, type GridDef, type PolicyDef, type VarDef } from "@shared/request/form";
import { stageFor, stageIndex } from "@shared/request/logic";
import { DEFAULT_STAGES, NO_VALUE_TYPES, STAGES, VARIABLE_TYPES, label as optionLabel, FREQUENCIES } from "@shared/request/vocab";
import { NAME_RE, RESERVED_NAMES } from "@shared/request/form";

export interface Queue {
  key: string;
  table: "request_item" | "request_task";
  path: string;
  label: string;
  /** the queue's fixed condition (evaluated when the page opens: some depend on the clock) */
  filter: (now: number) => Cond;
  sort: string;
  columns: string[];
  emptyText: string;
}

const ACTIVE: Cond = { f: "active", op: "eq", v: true };
const TASK_OPEN: Cond = { f: "state", op: "in", v: ["open", "work_in_progress", "on_hold"] };

/** The fulfillers' queues (list pages with a fixed filter; saved views add more). */
export const QUEUES: Queue[] = [
  {
    key: "mine", table: "request_item", path: "requests/mine", label: "اقلام من",
    filter: () => ({ and: [{ f: "assigned_to", op: "is_me" }, ACTIVE] }), sort: "due_at,priority",
    columns: ["number", "short_description", "requested_for", "state", "stage", "due_at", "updated_at"], emptyText: "قلم بازی به شما سپرده نشده است",
  },
  {
    key: "unassigned", table: "request_item", path: "requests/unassigned", label: "بی‌مسئول در گروه‌های من",
    filter: () => ({ and: [{ f: "assignment_group_id", op: "is_my_group" }, { f: "assigned_to", op: "empty" }, ACTIVE] }), sort: "due_at,opened_at",
    columns: ["number", "short_description", "cat_item_id", "requested_for", "assignment_group_id", "due_at", "opened_at"], emptyText: "همهٔ اقلام گروه‌های شما مسئول دارند",
  },
  {
    key: "my-tasks", table: "request_task", path: "requests/my-tasks", label: "وظایف من",
    filter: () => ({ and: [{ f: "assigned_to", op: "is_me" }, TASK_OPEN] }), sort: "sort_order,due_at",
    columns: ["number", "short_description", "request_item_id", "state", "class_of_service", "blocked", "due_at"], emptyText: "وظیفهٔ بازی به شما سپرده نشده است",
  },
  {
    key: "group-tasks", table: "request_task", path: "requests/group-tasks", label: "وظایف گروه‌های من",
    filter: () => ({ and: [{ f: "assignment_group_id", op: "is_my_group" }, { f: "assigned_to", op: "empty" }, TASK_OPEN] }), sort: "class_of_service,opened_at",
    columns: ["number", "short_description", "request_item_id", "assignment_group_id", "class_of_service", "opened_at"], emptyText: "وظیفهٔ بی‌مسئولی در گروه‌های شما نیست",
  },
  {
    key: "approval", table: "request_item", path: "requests/awaiting-approval", label: "در انتظار تأیید",
    filter: () => ({ f: "state", op: "eq", v: "awaiting_approval" }), sort: "approval_requested_at",
    columns: ["number", "short_description", "requested_for", "approval", "approval_requested_at", "total"], emptyText: "قلمی در انتظار تأیید نیست",
  },
  {
    key: "info", table: "request_item", path: "requests/awaiting-info", label: "منتظر درخواست‌کننده",
    filter: () => ({ f: "state", op: "eq", v: "awaiting_info" }), sort: "info_since",
    columns: ["number", "short_description", "requested_for", "assigned_to", "info_since", "reminded_at"], emptyText: "قلمی منتظر پاسخ درخواست‌کننده نیست",
  },
  {
    key: "overdue", table: "request_item", path: "requests/overdue", label: "گذشته از موعد",
    filter: (now) => ({ and: [ACTIVE, { f: "due_at", op: "lt", v: new Date(now).toISOString() }] }), sort: "due_at",
    columns: ["number", "short_description", "requested_for", "state", "assignment_group_id", "assigned_to", "due_at"], emptyText: "قلمی از موعد وعده‌داده‌شده نگذشته است",
  },
];

export const queueOf = (key: string): Queue | undefined => QUEUES.find((q) => q.key === key);

const DAY = 86_400_000;

/** A row's tone in lists: past its promised date → danger; due within a day or a blocked task → warning. */
export function rowTone(row: Record<string, unknown>, now = Date.now()): "danger" | "warning" | null {
  if (row.active === false) return null;
  const due = Date.parse(String(row.due_at ?? ""));
  if (Number.isFinite(due) && due < now) return "danger";
  if (row.blocked === true) return "warning";
  if (Number.isFinite(due) && due - now < DAY) return "warning";
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// The order form

export interface FormSection {
  key: string;
  label: string | null;
  variables: VarDef[];
}

/** The questions grouped by section in order: the item's own first, then each single-row question set. */
export function sectionsOf(schema: Pick<FormSchema, "variables" | "sections">): FormSection[] {
  const own = schema.variables.filter((v) => !v.section).sort((a, b) => a.order - b.order);
  const out: FormSection[] = [{ key: "_", label: null, variables: own }];
  for (const s of schema.sections) out.push({ key: s.key, label: s.label, variables: schema.variables.filter((v) => v.section === s.key).sort((a, b) => a.order - b.order) });
  return out.filter((s) => s.variables.length);
}

/** The questions shown now (definition and policies), and the grids. */
export function visibleQuestions(schema: FormSchema, answers: Answers, mode: "order" | "fulfil"): { state: FormState; sections: FormSection[]; grids: GridDef[] } {
  const state = formState(schema, answers, { mode });
  const sections = sectionsOf(schema)
    .map((s) => ({ ...s, variables: s.variables.filter((v) => !state.hidden.has(v.name)) }))
    .filter((s) => s.variables.length);
  return { state, sections, grids: schema.grids.filter((g) => !state.hidden.has(g.code)) };
}

/** Server errors of an order line (`lines.0.answers.<name>` / `answers.<name>`) as errors per question. */
export function answerErrors(fields: Record<string, string> | null | undefined, line = 0): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields ?? {})) {
    const m = /^(?:lines\.(\d+)\.)?answers\.(.+)$/.exec(k);
    if (m && (m[1] === undefined || Number(m[1]) === line)) out[m[2]] = v;
  }
  return out;
}

/** Problems of a line that are not about one question (the item, the person). */
export function lineErrors(fields: Record<string, string> | null | undefined, line = 0): string[] {
  return Object.entries(fields ?? {})
    .filter(([k]) => k.startsWith(`lines.${line}.`) && !k.includes(".answers."))
    .map(([, v]) => v);
}

const fa = (n: number | string) => Number(n).toLocaleString("fa-IR");

/** «۶۵۰٬۰۰۰٬۰۰۰ ریال» (exact decimals from the server; whole Rials shown). */
export function money(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "" || !Number.isFinite(Number(v))) return "";
  const [int] = String(v).split(".");
  return `${BigInt(int || "0").toLocaleString("fa-IR")} ریال`;
}

/** «۱٬۵۰۰٬۰۰۰ ریال ماهانه» */
export function recurringText(price: string | null | undefined, frequency: string | null | undefined): string {
  const m = money(price);
  if (!m || Number(price) <= 0) return "";
  const f = frequency ? optionLabel(FREQUENCIES, frequency) : "";
  return f ? `${m} ${f}` : m;
}

/** A duration in seconds as «۲ روز و ۴ ساعت» (days of 24 hours), «۳ ساعت»، «۲۵ دقیقه». */
export function durationText(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "";
  const s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return h ? `${fa(d)} روز و ${fa(h)} ساعت` : `${fa(d)} روز`;
  if (h) return m ? `${fa(h)} ساعت و ${fa(m)} دقیقه` : `${fa(h)} ساعت`;
  return `${fa(Math.max(1, m))} دقیقه`;
}

export interface StageStep {
  key: string;
  label: string;
  status: "done" | "current" | "todo";
}

/** The stage bar of an item (REQ-023): done stages, the current one and those ahead; a terminal stage ends it. */
export function stageSteps(state: string, stage: string | null | undefined, stages?: readonly string[] | null): StageStep[] {
  const bar = stages?.length ? [...stages] : DEFAULT_STAGES;
  const now = stage || stageFor(state, bar);
  const label = (k: string) => STAGES.find((s) => s.value === k)?.label ?? k;
  if (now === "rejected" || now === "cancelled") {
    return [...bar.filter((k) => k !== "completed").slice(0, 1).map((k) => ({ key: k, label: label(k), status: "done" as const })), { key: now, label: label(now), status: "current" }];
  }
  const at = stageIndex(now, bar);
  return bar.map((k, i) => ({ key: k, label: label(k), status: now === "completed" || i < at ? "done" : i === at ? "current" : "todo" }));
}

// ---------------------------------------------------------------------------------------------------------------
// The builder

/** A technical name from a question's label: Latin words joined by _ ; otherwise q1, q2… (never one taken). */
export function nameFromLabel(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const latin = label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[0-9_]+/, "")
    .slice(0, 40);
  if (latin && NAME_RE.test(latin) && !RESERVED_NAMES.has(latin) && !used.has(latin)) return latin;
  for (let i = 1; i < 1000; i++) {
    const n = latin && NAME_RE.test(`${latin}_${i}`) ? `${latin}_${i}` : `q${i}`;
    if (!used.has(n) && !RESERVED_NAMES.has(n)) return n;
  }
  return `q${Date.now() % 100000}`;
}

/** A new question of `type` (defaults the designer starts from). */
export function newQuestion(type: string, order: number, taken: Iterable<string>): Record<string, unknown> {
  const t = VARIABLE_TYPES.find((x) => x.value === type) ?? VARIABLE_TYPES[0];
  const label = t.value === "label" ? "عنوان بخش" : `پرسش تازه (${t.label})`;
  const base: Record<string, unknown> = { label, name: nameFromLabel("", taken), type: t.value, sort_order: order, required: false, width: "full", field_class: t.value === "secret" ? "secret" : "public" };
  if (t.value === "select" || t.value === "radio" || t.value === "multiselect") base.choices = [{ value: "a", label: "گزینهٔ ۱" }, { value: "b", label: "گزینهٔ ۲" }];
  if (t.value === "reference" || t.value === "list_collector") base.ref_table = "";
  return base;
}

/** The next sort order after the given rows (by tens). */
export const nextOrder = (rows: readonly { sort_order?: unknown }[]) => (Math.max(0, ...rows.map((r) => Number(r.sort_order) || 0)) + 10);

/** New sort orders after moving row `from` to `to` (every row renumbered by tens; only changed ones returned). */
export function reorder<T extends { id: string; sort_order?: unknown }>(rows: readonly T[], from: number, to: number): { id: string; sort_order: number }[] {
  if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return [];
  const list = [...rows];
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  return list.map((r, i) => ({ id: r.id, sort_order: (i + 1) * 10 })).filter((x, i) => Number(list[i].sort_order) !== x.sort_order);
}

/** A form policy as a sentence: «اگر … ← نمایش «الف»، الزامی «ب»». */
export function policySentence(p: Pick<PolicyDef, "actions">, describeCond: string, labels: Record<string, string>): string {
  const parts = p.actions.map((a) => {
    const what: string[] = [];
    if (a.visible === true) what.push("نمایش");
    if (a.visible === false) what.push("پنهان");
    if (a.mandatory === true) what.push("الزامی");
    if (a.mandatory === false) what.push("اختیاری");
    if (a.readonly === true) what.push("فقط‌خواندنی");
    if (a.readonly === false) what.push("ویرایش‌پذیر");
    return `${what.join(" و ") || "بی‌اثر"} «${labels[a.variable] ?? a.variable}»`;
  });
  return `${describeCond ? `اگر ${describeCond}` : "همیشه"} ← ${parts.join("، ")}`;
}

/** Question types for the «پرسش تازه» menu, grouped. */
export function typeGroups(): { group: string; types: { value: string; label: string }[] }[] {
  const out: { group: string; types: { value: string; label: string }[] }[] = [];
  for (const t of VARIABLE_TYPES) {
    let g = out.find((x) => x.group === t.group);
    if (!g) out.push((g = { group: t.group, types: [] }));
    g.types.push({ value: t.value, label: t.label });
  }
  return out;
}

/** Does a question hold an answer (not a section title or an attachment)? */
export const answers = (v: Pick<VarDef, "type">) => !NO_VALUE_TYPES.has(v.type) && v.type !== "attachment";

// ---------------------------------------------------------------------------------------------------------------
// The cart

export interface CartLineLike {
  saved?: boolean;
  price?: string | null;
  problem?: string | null;
}

/** Lines to order now (not saved for later, without problems) and those that block the checkout. */
export function cartState(lines: readonly CartLineLike[]): { ready: number; saved: number; blocked: number } {
  return {
    ready: lines.filter((l) => !l.saved && !l.problem).length,
    saved: lines.filter((l) => l.saved).length,
    blocked: lines.filter((l) => !l.saved && !!l.problem).length,
  };
}

/**
 * The confirmation button after an order: «دیدن سفارش» for an order, otherwise the record the form produced by its
 * table («دیدن رخداد» for «گزارش مشکل», «دیدن تغییر»…); `label` is the produced table's singular label.
 */
export function orderDoneLabel(target: { table: string } | null, label?: string | null): string {
  if (!target) return "باشه";
  if (target.table === "request") return "دیدن سفارش";
  return `دیدن ${label?.trim() || "رکورد"}`;
}
