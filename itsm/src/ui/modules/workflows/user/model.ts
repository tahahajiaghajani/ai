// The pure logic of the person's «گردش‌کارها» (design F §5, §8.6, package F7): no React, no requests — tested in
// tests/workflows-user-ui.test.ts.
//   · addresses: the app's pages under `workflows`, the portal's under `portal/workflows` (the same pages in the
//     portal's light shell), and the API's links mapped onto them (a record approval opens the record, or the portal's
//     approval page);
//   · the four tabs (in the URL; «کارتابل» first when something waits, else «گردش‌کارهای من») and the filters of
//     «پرونده‌ها» (in the URL too);
//   · what a row of «کارتابل» says: the kind, the step and its action, from whom, since when, the due pill, and the
//     notes «به جانشینی از …»، «در دست …»، «در صف ارسال»، «متوقف»;
//   · a case: its state's word, the state channel («ثبت درخواست ●──● تأیید رئیس شعبه ──○ … ──○ پایان»), the path it
//     took on the diagram, its open steps and their people, my part;
//   · the step form: the decisions a step offers (fill: «ارسال برای "…"»; review: «ادامهٔ گردش‌کار»، «بازگشت برای اصلاح»;
//     approve: «تأیید»، «رد»، «بازگشت برای اصلاح»), which need a reason, the return targets, the confirmation that names
//     the consequence, the values a submission sends (only what I may enter; files as `{ upload: n }`), where the form
//     starts (my refused values, my draft, the case's values), the required fields left empty, and what the person is
//     told after it (§8.6's strings);
//   · the start: the menu, the start form's first values, the start's message.
// Imported by UI code only; keep it free of server imports.
import {
  formStepOf, forwardEdges, OUTCOME_PORT, processNodeLabel, type NodeStatusView, type ProcessGraph, type StepOutcome,
} from "@shared/process";
import { applyShowIf, canEdit, canRead, fieldGetter, formView, isRight, type FieldSource, type FormLayoutV2, type Right } from "@shared/forms/layout";
import type { FieldDef } from "@shared/model/types";
import { CASE_STATES, TASK_ACTIONS, TASK_OUTCOMES } from "@shared/tables/process";
import { faDigits } from "@shared/format";
import { todayISO } from "@shared/jalali";
import { listSteps } from "../kit/model";
import { fileIds } from "../kit/files";
import type { ReresolveResult, StepWaiting } from "@shared/process/waiting";
import type { CaseDetail, CaseFilters, CaseListRow, HistoryTask, Inbox, InboxRow, MyProcess, MyStep, StepView, SubmitResult } from "./api";

const fa = (n: number) => faDigits(n);
const q = (s: string) => `«${s}»`;

// ---------------------------------------------------------------------------------------------------------------
// Addresses

/** The person's «گردش‌کارها» in the app, and the same pages in the portal. */
export const WF_PATH = "workflows";
export const PORTAL_WF_PATH = "portal/workflows";

export const PROCESS_PATH = `${WF_PATH}/p/:key`;
export const START_PATH = `${WF_PATH}/start/:key`;
export const CASE_PATH = `${WF_PATH}/c/:id`;
export const STEP_PATH = `${WF_PATH}/c/:id/s/:task`;
export const PRINT_PATH = `${WF_PATH}/c/:id/print`;
/** The seeded notifications link to the generic record page of a case: it opens the case here (with my step). */
export const RECORD_CASE_PATH = "r/process_case/:id";

const enc = encodeURIComponent;

/** The pages under a base (`workflows`, or `portal/workflows`), organisation-relative. */
export function wfPaths(base: string) {
  return {
    home: (tab?: Tab | null) => (tab && tab !== "inbox" ? `${base}?tab=${tab}` : base),
    tab: (tab: Tab) => `${base}?tab=${tab}`,
    process: (key: string) => `${base}/p/${enc(key)}`,
    start: (key: string) => `${base}/start/${enc(key)}`,
    kase: (id: string) => `${base}/c/${enc(id)}`,
    step: (id: string, task: string) => `${base}/c/${enc(id)}/s/${enc(task)}`,
    print: (id: string) => `${base}/c/${enc(id)}/print`,
  };
}
export type WfPaths = ReturnType<typeof wfPaths>;

/**
 * An organisation-relative link the API gave, as an address under `base`: `workflows/…` moves under the base; a
 * record's page (`r/:table/:id`) stays in the app, and in the portal becomes the portal's page of that record.
 */
export function mapLink(link: string, base: string): string {
  const rel = String(link ?? "").replace(/^\/+/, "");
  if (rel === WF_PATH || rel.startsWith(`${WF_PATH}/`) || rel.startsWith(`${WF_PATH}?`)) return `${base}${rel.slice(WF_PATH.length)}`;
  if (base.startsWith("portal/")) {
    const m = rel.match(/^r\/([^/]+)\/([^/?#]+)/);
    if (m) return `portal/t/${m[1]}/${m[2]}`;
  }
  return rel;
}

/** Where a row of «کارتابل» opens: my step's form (2 clicks from the nav), or the record with its approval panel. */
export function rowLink(row: Pick<InboxRow, "kind" | "id" | "case_id" | "link">, base: string): string {
  if (row.kind === "record_approval" && base.startsWith("portal/")) return `portal/approvals/${enc(row.id)}`;
  if (row.kind === "process_step" && row.case_id) return wfPaths(base).step(row.case_id, row.id);
  return mapLink(row.link, base);
}

// ---------------------------------------------------------------------------------------------------------------
// The tabs and the filters of «پرونده‌ها»

export type Tab = "inbox" | "mine" | "cases" | "done";
export const TABS: { key: Tab; label: string }[] = [
  { key: "inbox", label: "کارتابل" },
  { key: "mine", label: "گردش‌کارهای من" },
  { key: "cases", label: "پرونده‌ها" },
  { key: "done", label: "انجام‌شده‌ها" },
];
const TAB_KEYS = new Set<string>(TABS.map((t) => t.key));

/** The tab an address asks for, else the page's default («کارتابل» when something waits for me). */
export function tabOf(params: URLSearchParams, fallback: Inbox["default_tab"] | Tab | null | undefined): Tab {
  const t = params.get("tab");
  if (t && TAB_KEYS.has(t)) return t as Tab;
  return fallback === "mine" ? "mine" : "inbox";
}

/** The filters of «پرونده‌ها» as an address keeps them (`state=open|closed`, `mine=1`, process, step, dates, search, page). */
export function caseFiltersOf(params: URLSearchParams): CaseFilters {
  const f: CaseFilters = {};
  const state = params.get("state");
  if (state === "open" || state === "closed") f.state = state;
  if (params.get("mine") === "1") f.mine = true;
  for (const k of ["process", "step", "from", "to", "q"] as const) {
    const v = params.get(k);
    if (v) f[k] = v;
  }
  const page = Number(params.get("page"));
  if (Number.isInteger(page) && page > 1) f.page = page;
  return f;
}

/** The address's parameters with one filter changed (an empty value removes it; any change goes back to page 1). */
export function withCaseFilter(params: URLSearchParams, key: keyof CaseFilters, value: string | boolean | number | null | undefined): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set("tab", "cases");
  const v = value === true ? "1" : value === false || value === null || value === undefined ? "" : String(value);
  if (v) next.set(key, v);
  else next.delete(key);
  if (key !== "page") next.delete("page");
  // a step belongs to its process
  if (key === "process") next.delete("step");
  return next;
}

/** Does the list show something narrower than every case I read? */
export const filtered = (f: CaseFilters): boolean => !!(f.state || f.mine || f.process || f.step || f.from || f.to || f.q);

// ---------------------------------------------------------------------------------------------------------------
// Words

/** The word of a step's action («تکمیل فرم»، «بررسی»، «تأیید»). */
export const actionLabel = (action: string | null | undefined): string => TASK_ACTIONS.find((o) => o.value === action)?.label ?? "";

/** The word of a decision («ثبت شد»، «تأیید شد»، «رد شد»، «بازگشت برای اصلاح»). */
export const outcomeWord = (outcome: string | null | undefined): string => TASK_OUTCOMES.find((o) => o.value === outcome)?.label ?? "";

/** A person's name from the API's display map («—» when unknown). */
export const nameOf = (display: Record<string, string> | null | undefined, id: string | null | undefined): string => (id ? display?.[id] ?? "—" : "—");

export type Tone = "neutral" | "warning" | "danger" | "accent" | "in" | "info";

export interface DueView {
  text: string;
  tone: Tone;
  late: boolean;
}

const spanText = (ms: number): string => {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${fa(min)} دقیقه`;
  const h = Math.round(min / 60);
  if (h < 48) return `${fa(h)} ساعت`;
  return `${fa(Math.round(h / 24))} روز`;
};

/** The due pill: «۵ ساعت مانده» (warning within four hours), «۲ ساعت از مهلت گذشته» (danger); null without a due time. */
export function dueView(due: string | null | undefined, now = Date.now()): DueView | null {
  const t = due ? Date.parse(due) : NaN;
  if (!Number.isFinite(t)) return null;
  const left = t - now;
  if (left < 0) return { text: `${spanText(-left)} از مهلت گذشته`, tone: "danger", late: true };
  return { text: `${spanText(left)} مانده`, tone: left < 4 * 3_600_000 ? "warning" : "neutral", late: false };
}

/** «به جانشینی از …»، «در دست …»، «در صف ارسال»، «متوقف‌شده» — the notes of a row of «کارتابل» or of a step. */
export function stepNotes(
  x: { on_behalf_of?: string | null; delegated_from?: string | null; claimed_by?: string | null; queued?: boolean; paused?: boolean },
  display: Record<string, string>,
  me?: string | null,
): string[] {
  const out: string[] = [];
  const behalf = x.on_behalf_of ?? x.delegated_from ?? null;
  if (behalf) out.push(`به جانشینی از ${nameOf(display, behalf)}`);
  if (x.claimed_by && x.claimed_by !== me) out.push(`در دست ${nameOf(display, x.claimed_by)}`);
  if (x.queued) out.push("در صف ارسال");
  if (x.paused) out.push("پرونده موقتاً متوقف است");
  return out;
}

/**
 * The step form's delegation line: the delegate reads «به جانشینی از …»; the person who delegated the step (the case
 * lists it among their steps too — they may still do it) reads «سپرده به …», whom its task is with now, never their
 * own name.
 */
export function delegationNote(
  step: Pick<MyStep, "id" | "delegated_from">,
  tasks: readonly Pick<HistoryTask, "id" | "assigned_to">[],
  me: string | null | undefined,
  display: Record<string, string>,
): string | null {
  if (!step.delegated_from) return null;
  if (step.delegated_from !== me) return `به جانشینی از ${nameOf(display, step.delegated_from)}`;
  const to = tasks.find((t) => t.id === step.id)?.assigned_to;
  return to && to !== me ? `سپرده به ${nameOf(display, to)}` : null;
}

/** What a row of «کارتابل» shows. */
export interface InboxRowView {
  key: string;
  number: string;
  title: string;
  source: string;
  /** «تأیید رکورد» on a record approval (it opens the record with its approval panel) */
  kind: string | null;
  action: string;
  step: string;
  from: string;
  since: string | null;
  due: DueView | null;
  notes: string[];
  link: string;
  /** a case of the demo pack: the row says «نمایشی» */
  demo: boolean;
}

export function inboxRowView(row: InboxRow, display: Record<string, string>, base: string, now = Date.now()): InboxRowView {
  return {
    demo: row.demo === true,
    key: `${row.kind}:${row.id}`,
    number: row.number ?? "",
    title: row.title || row.number || row.source,
    source: row.source,
    kind: row.kind === "record_approval" ? "تأیید رکورد" : null,
    action: actionLabel(row.action),
    step: row.step,
    from: row.from ? nameOf(display, row.from) : "",
    since: row.since,
    due: dueView(row.due_at, now),
    notes: stepNotes(row, display),
    link: rowLink(row, base),
  };
}

/**
 * What a row of «کارتابل»'s table does: a click anywhere on it (or Enter) opens the step — the title's link already does,
 * and a click on a link inside the row is that link's own (B5).
 */
export function inboxRowProps(v: Pick<InboxRowView, "link">, open: (link: string) => void) {
  const fromLink = (t: EventTarget | null) => !!t && typeof (t as Element).closest === "function" && !!(t as Element).closest("a, button");
  return {
    onClick: (e: { target: EventTarget | null }) => {
      if (!fromLink(e.target)) open(v.link);
    },
    onKeyDown: (e: { key: string; target: EventTarget | null; currentTarget?: EventTarget | null }) => {
      if (e.key === "Enter" && (e.currentTarget === undefined || e.target === e.currentTarget)) open(v.link);
    },
    tabIndex: 0,
    className: "wfu-row-open",
  };
}

/** «۵ مورد منتظر شما» (the page's subtitle; nothing when nothing waits). */
export const waitingText = (n: number): string => (n > 0 ? `${fa(n)} مورد منتظر شما` : "");

/**
 * My open process steps of «کارتابل» without the record approvals: what the portal's «کارهای من» adds to its own
 * lists (it shows the record approvals itself, from the same approvals service).
 */
export const waitingSteps = (inbox: Pick<Inbox, "rows"> | null | undefined): InboxRow[] => (inbox?.rows ?? []).filter((r) => r.kind === "process_step");

/** The processes I may start (the start menu), by name. */
export const startable = (processes: readonly MyProcess[]): MyProcess[] => processes.filter((p) => p.can_start).sort((a, b) => a.name.localeCompare(b.name, "fa"));

// ---------------------------------------------------------------------------------------------------------------
// A case

/** A state's word and the kit's state chip kind (a paused case says so). */
export function caseStateView(state: string, pausedAt?: string | null): { label: string; kind: "progress" | "hold" | "resolved" | "closed" | "cancelled" } {
  const label = CASE_STATES.find((o) => o.value === state)?.label ?? state;
  if (pausedAt && (state === "active" || state === "waiting")) return { label: "متوقف‌شده", kind: "hold" };
  switch (state) {
    case "active":
      return { label, kind: "progress" };
    case "waiting":
    case "attention":
      return { label, kind: "hold" };
    case "completed":
      return { label, kind: "resolved" };
    case "rejected":
      return { label, kind: "closed" };
    default:
      return { label, kind: "cancelled" };
  }
}

export const isOpenCase = (state: string): boolean => state === "active" || state === "waiting" || state === "attention";

export type ChannelState = "done" | "current" | "mine" | "future";

/** The state channel of the header: the case's form steps in order (those passed by left out), then «پایان». */
export function stateChannel(graph: ProcessGraph, statuses: Record<string, NodeStatusView> | null | undefined, finished: boolean): { key: string; label: string; state: ChannelState }[] {
  const out: { key: string; label: string; state: ChannelState }[] = [];
  for (const n of listSteps(graph)) {
    if (n.type !== "form_step") continue;
    const st = statuses?.[n.id]?.status;
    if (st === "skipped") continue;
    const state: ChannelState = st === "done" || st === "mine_done" ? "done" : st === "mine_open" ? "mine" : st === "active" ? "current" : "future";
    out.push({ key: n.id, label: processNodeLabel(n), state });
  }
  out.push({ key: "__end", label: "پایان", state: finished ? "done" : "future" });
  return out;
}

/**
 * The edges the case went along, read from the statuses (the case's progress stays on the server): from a passed
 * node to a node it reached, a decided form step only by the way its decision leads.
 */
export function takenFromStatuses(graph: ProcessGraph, statuses: Record<string, NodeStatusView> | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!statuses) return out;
  const passed = (id: string) => ["done", "mine_done"].includes(statuses[id]?.status ?? "");
  const reached = (id: string) => ["done", "mine_done", "active", "mine_open"].includes(statuses[id]?.status ?? "");
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const e of forwardEdges(graph)) {
    if (!passed(e.source) || !reached(e.target)) continue;
    const src = byId.get(e.source);
    const outcome = statuses[e.source]?.outcome;
    if (src?.type === "form_step" && outcome && outcome in OUTCOME_PORT && (e.port ?? "out") !== OUTCOME_PORT[outcome as StepOutcome]) continue;
    out.add(e.id);
  }
  return out;
}

/** The case's open steps and who holds each (from its tasks). */
export function openSteps(detail: Pick<CaseDetail, "case" | "history">): { key: string; label: string; people: string[] }[] {
  const open = detail.history.tasks.filter((t) => t.status === "open");
  const steps = detail.case.current_steps.length ? detail.case.current_steps : [...new Map(open.map((t) => [t.step_key, { key: t.step_key, label: t.step_label ?? t.step_key }])).values()];
  return steps.map((s) => ({ key: s.key, label: s.label, people: [...new Set(open.filter((t) => t.step_key === s.key).map((t) => t.assigned_to).filter((x): x is string => !!x))] }));
}

/**
 * My part in the case, in words: «درخواست‌دهنده»، «تأییدکننده در "…"» (my open and done steps), and «مسئول گردش‌کار»
 * when I manage it (its managers' actions are mine: B3, never «خواننده»).
 */
export function myPart(detail: Pick<CaseDetail, "case" | "history" | "my_steps"> & { can?: Pick<CaseDetail["can"], "manage"> }, me: string | null): string[] {
  const out: string[] = [];
  if (me && (detail.case.requested_by === me || detail.case.requested_for === me)) out.push("درخواست‌دهنده");
  const mine = (t: HistoryTask) => !!me && (t.assigned_to === me || t.delegated_from === me || t.acted_by === me || t.acted_for === me);
  const seen = new Set<string>();
  for (const t of detail.history.tasks) {
    if (!mine(t) || seen.has(t.step_key) || t.status === "not_needed" || t.status === "canceled") continue;
    seen.add(t.step_key);
    const who = t.action === "approve" ? "تأییدکننده" : t.action === "review" ? "بررسی‌کننده" : "انجام‌دهنده";
    out.push(`${who} در ${q(t.step_label ?? t.step_key)}`);
  }
  if (detail.can?.manage) out.push("مسئول گردش‌کار");
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// A step nobody took (release 1.1.5): why, «دوباره پیدا کردن انجام‌دهنده», too many people to choose from

/**
 * A waiting step's line under «مرحلهٔ کنونی»: for the case's managers the case journal's line and the resolver's
 * reasons («مدیر گروه» در «…» دارنده‌ای ندارد، the demo pack's people left out…); for anyone else a few words.
 */
export function waitingLine(w: StepWaiting | null | undefined, manager: boolean): { text: string; notes: string[] } | null {
  if (!w) return null;
  if (manager) return { text: w.message, notes: w.notes ?? [] };
  return { text: w.reason === "too_many" ? "مسئولان گردش‌کار انجام‌دهنده را برمی‌گزینند" : "کسی پیدا نشد", notes: [] };
}

/** The steps «دوباره پیدا کردن انجام‌دهنده» may run again: the case's steps that wait (nobody, or too many), in the case's order. */
export function stalledSteps(detail: Pick<CaseDetail, "case" | "history" | "graph"> & { waiting?: Record<string, StepWaiting> }): { key: string; label: string; reason: StepWaiting["reason"] }[] {
  const waiting = detail.waiting ?? {};
  const open = openSteps(detail);
  const label = (key: string) => open.find((s) => s.key === key)?.label ?? processNodeLabel(detail.graph.nodes.find((n) => n.id === key) ?? { type: "form_step" });
  const keys = [...open.map((s) => s.key).filter((k) => k in waiting), ...Object.keys(waiting).filter((k) => !open.some((s) => s.key === k))];
  return keys.map((key) => ({ key, label: label(key), reason: waiting[key].reason }));
}

/** What «دوباره پیدا کردن انجام‌دهنده» holds: the step, and whose rules — this version's or the current version's. */
export interface ReresolveForm {
  step: string | null;
  rules: "case" | "current";
}

/**
 * The re-resolve dialog's input as the case page renders: afresh, the first step that waits and this version's rules;
 * the case read again keeps what the manager chose while the step still waits (else its first waiting step). The same
 * object comes back while all of it holds.
 */
export function reresolveForm(prev: ReresolveForm | null, detail: Parameters<typeof stalledSteps>[0]): ReresolveForm {
  const steps = stalledSteps(detail);
  if (!prev) return { step: steps[0]?.key ?? null, rules: "case" };
  const step = steps.some((s) => s.key === prev.step) ? prev.step : (steps[0]?.key ?? null);
  return step === prev.step ? prev : { ...prev, step };
}

/** What the managers are told after «دوباره پیدا کردن انجام‌دهنده». */
export function reresolveMessage(r: Pick<ReresolveResult, "status" | "people" | "message">, label: string): { tone: "ok" | "warning"; text: string } {
  const step = q(label);
  if (r.status === "ok") {
    const names = r.people.map((p) => p.name);
    const shown = names.slice(0, 3).join("، ");
    const more = names.length > 3 ? ` و ${fa(names.length - 3)} نفر دیگر` : "";
    return { tone: "ok", text: names.length ? `${step} به ${shown}${more} رسید.` : `${step} دوباره باز شد.` };
  }
  if (r.status === "managers") return { tone: "warning", text: `برای ${step} کسی پیدا نشد؛ مرحله به مسئولان گردش‌کار رسید.` };
  if (r.status === "too_many") return { tone: "warning", text: r.message || `برای ${step} بیش از اندازه نفر پیدا شد؛ از «ارجاع مرحله» کسانی را برگزینید.` };
  return { tone: "warning", text: r.message || `برای ${step} باز هم کسی پیدا نشد.` };
}

/** Whom «ارجاع مرحله» offers for a step that found more people than it takes: the server's candidates (managers only). */
export function candidatesOf(detail: { waiting?: Record<string, StepWaiting> }, step: string | null): NonNullable<StepWaiting["candidates"]> {
  const w = step ? detail.waiting?.[step] : undefined;
  return w?.reason === "too_many" ? (w.candidates ?? []) : [];
}

/** The pack's people in a case's people pickers: left out of the organisation's own cases (FINAL-1), marked on the pack's. */
export const demoPick = (detail: { demo?: boolean }): "hide" | "mark" => (detail.demo ? "mark" : "hide");

/** The primary action of the case's header: my first open step («انجام مرحلهٔ "…"»), or null. */
export function headerStep(steps: readonly MyStep[]): MyStep | null {
  return steps.find((s) => !s.queued) ?? steps[0] ?? null;
}

/** A case's line in «پرونده‌ها»: the steps it is at. */
export const currentText = (row: Pick<CaseListRow, "current_steps" | "state">): string =>
  isOpenCase(row.state) ? (row.current_steps ?? []).map((s) => s.label).join("، ") : "";

/** What a dialog of the case's «اقدام‌ها» holds: the action it is open for, the note, the step, whose task, the people, the step to resume from. */
export interface ManagerForm {
  action: string | null;
  comment: string;
  step: string | null;
  task: string | null;
  to: string[];
  node: string | null;
}

/**
 * A case dialog's input as the case page renders: opening it for an action starts it afresh — no note, the case's
 * first open step, nobody chosen, the first step to resume from; the case read again while it is open (the page
 * refreshes live whenever someone acts on the case) keeps what the manager typed and chose, as far as the case still
 * has it: a step it no longer has open gives way to its first open step (and nobody's task), a task no longer open in
 * the step to nobody's, a step no longer among the restart targets to the first of them. The note and the people stay.
 * The same object comes back while all of it holds (the page sets the input only when it changed).
 */
export function managerForm(prev: ManagerForm | null, action: string | null, detail: Pick<CaseDetail, "case" | "history" | "restart_targets">): ManagerForm {
  const steps = openSteps(detail);
  const targets = detail.restart_targets;
  if (!prev || prev.action !== action) return { action, comment: "", step: steps[0]?.key ?? null, task: null, to: [], node: targets[0]?.key ?? null };
  const step = steps.some((s) => s.key === prev.step) ? prev.step : (steps[0]?.key ?? null);
  const task = step === prev.step && detail.history.tasks.some((t) => t.id === prev.task && t.status === "open" && t.step_key === step) ? prev.task : null;
  const node = targets.some((t) => t.key === prev.node) ? prev.node : (targets[0]?.key ?? null);
  return step === prev.step && task === prev.task && node === prev.node ? prev : { ...prev, step, task, node };
}

// ---------------------------------------------------------------------------------------------------------------
// The step form

export interface StepActionDef {
  outcome: StepOutcome;
  label: string;
  primary: boolean;
  danger: boolean;
  /** «رد» and «بازگشت» ask for a reason */
  needsComment: boolean;
}

/** «ارسال برای "تأیید رئیس شعبه"» when the next step is known, «ارسال و پایان» before the end, else «ارسال». */
export function sendLabel(next: string | null | undefined): string {
  if (!next) return "ارسال";
  if (next === "پایان") return "ارسال و پایان";
  return `ارسال برای ${q(next)}`;
}

/** The decisions a step offers, in the order of §5's table (the first is the primary one). */
export function stepActions(step: Pick<MyStep, "action" | "outcomes" | "next">): StepActionDef[] {
  const has = (o: StepOutcome) => step.outcomes.includes(o);
  const out: StepActionDef[] = [];
  if (step.action === "approve") {
    if (has("approved")) out.push({ outcome: "approved", label: "تأیید", primary: true, danger: false, needsComment: false });
    if (has("rejected")) out.push({ outcome: "rejected", label: "رد", primary: false, danger: true, needsComment: true });
  } else if (has("submitted")) {
    out.push({ outcome: "submitted", label: step.action === "review" ? "ادامهٔ گردش‌کار" : sendLabel(step.next?.submitted), primary: true, danger: false, needsComment: false });
  }
  if (has("returned")) out.push({ outcome: "returned", label: "بازگشت برای اصلاح", primary: false, danger: false, needsComment: true });
  return out;
}

/** The «توضیح» box's hint: the decisions of this very step that need a reason, or none (B6: a fill step has none). */
export function commentHint(step: Pick<MyStep, "action" | "outcomes" | "next">): string | undefined {
  const need = stepActions(step)
    .filter((a) => a.needsComment)
    .map((a) => (a.outcome === "rejected" ? "«رد»" : "«بازگشت»"));
  return need.length ? `برای ${need.join(" و ")} دلیل را بنویسید` : undefined;
}

/** Does a decision send values (submit and approve take the form; reject and return send only the reason)? */
export const takesValues = (outcome: StepOutcome): boolean => outcome === "submitted" || outcome === "approved";

/** The confirmation of a «بازگشت» or a «رد»: it names the consequence. */
export function consequence(step: Pick<MyStep, "return_targets" | "next">, outcome: StepOutcome, returnTo: string | null, display: Record<string, string>): string {
  if (outcome === "returned") {
    const target = step.return_targets.find((t) => t.key === returnTo) ?? step.return_targets.find((t) => t.default) ?? step.return_targets[0];
    if (!target) return "پرونده برای اصلاح بازمی‌گردد";
    return target.to ? `پرونده برای ${q(target.label)} به ${nameOf(display, target.to)} بازمی‌گردد` : `پرونده برای اصلاح به ${q(target.label)} بازمی‌گردد`;
  }
  if (outcome === "rejected") {
    const next = step.next?.rejected;
    return next && next !== "پایان" ? `با «رد»، پرونده به ${q(next)} می‌رود` : "با «رد»، پرونده رد می‌شود و پایان می‌یابد";
  }
  return "";
}

/** The default target of a «بازگشت»: the one the server marks, else the first. */
export const defaultReturn = (step: Pick<MyStep, "return_targets">): string | null => (step.return_targets.find((t) => t.default) ?? step.return_targets[0])?.key ?? null;

/** What the person is told after a decision was sent (§8.6's strings). */
export function resultMessage(r: Pick<SubmitResult, "result" | "note">, outcome: StepOutcome, step: Pick<MyStep, "next" | "return_targets">, returnTo: string | null, display: Record<string, string>): { tone: "ok" | "info" | "warning"; text: string } {
  if (r.result === "pending") return { tone: "info", text: "در صف ارسال؛ با برقراری اتصال فرستاده می‌شود." };
  if (r.result === "late") return { tone: "warning", text: r.note || "این مرحله را همکارتان پیش‌تر انجام داده بود؛ آنچه نوشتید نگه داشته شد ولی در پرونده ثبت نشد." };
  if (outcome === "returned") {
    const target = step.return_targets.find((t) => t.key === returnTo) ?? step.return_targets.find((t) => t.default);
    return { tone: "ok", text: target?.to ? `پرونده برای اصلاح به ${nameOf(display, target.to)} بازگشت.` : "پرونده برای اصلاح بازگشت." };
  }
  if (outcome === "rejected") return { tone: "ok", text: step.next?.rejected && step.next.rejected !== "پایان" ? `رد شد؛ پرونده به ${q(step.next.rejected)} رفت.` : "رد شد؛ پرونده رد شد." };
  const next = step.next?.[outcome];
  if (next === "پایان") return { tone: "ok", text: "مرحله ثبت شد؛ پرونده به پایان رسید." };
  return { tone: "ok", text: next ? `مرحله ثبت شد؛ پرونده به ${q(next)} رفت.` : "مرحله ثبت شد." };
}

/** What the person is told after a start. */
export function startMessage(r: Pick<SubmitResult, "result" | "note">, next: string | null | undefined): { tone: "ok" | "info" | "warning"; text: string } {
  if (r.result === "pending") return { tone: "info", text: "در صف ارسال؛ با برقراری اتصال فرستاده می‌شود." };
  if (r.result === "late") return { tone: "warning", text: r.note || "این پرونده پیش‌تر ثبت شده بود." };
  return { tone: "ok", text: next && next !== "پایان" ? `پرونده ثبت شد؛ پرونده به ${q(next)} رفت.` : "پرونده ثبت شد." };
}

/**
 * What the person is told after «لغو پرونده»: «پرونده لغو شد.» only when the cancel was applied; a linked Windows app
 * queues it; a case that ended first (its last approver completed it while the dialog was open) comes back «late» —
 * nothing was cancelled, and the server's note says so.
 */
export function cancelMessage(r: { result: SubmitResult["result"] | "refused"; note?: string | null }): { tone: "ok" | "info" | "warning"; text: string } {
  if (r.result === "applied") return { tone: "ok", text: "پرونده لغو شد." };
  if (r.result === "pending") return { tone: "info", text: "در صف ارسال؛ با برقراری اتصال فرستاده می‌شود." };
  return { tone: "warning", text: r.note || "این پرونده پیش‌تر بسته شده است." };
}

/** A local file of the form: its token in the field's value until it is sent. */
export const LOCAL_FILE = /^local-\d+$/;

/**
 * The values a submission sends: only the fields I may enter now (`rights` after «نمایش وقتی…»; see packShown), and
 * the files of a «پیوست» field as `{ upload: n }` (n: its place among the files sent), its earlier files by their ids.
 */
export function packValues(values: Record<string, unknown>, rights: Record<string, Right>, defs: FieldSource, local: ReadonlyMap<string, File>): { values: Record<string, unknown>; files: File[] } {
  const get = fieldGetter(defs);
  const files: File[] = [];
  const out: Record<string, unknown> = {};
  for (const [k, r] of Object.entries(rights)) {
    if (!canEdit(r) || !(k in values)) continue;
    const f = get(k);
    const v = values[k];
    if (f?.check === "attachments") {
      const ids = fileIds(v);
      out[k] = ids.map((id) => {
        const file = local.get(id);
        if (!file) return id;
        files.push(file);
        return { upload: files.length - 1 };
      });
      continue;
    }
    out[k] = v === undefined ? null : v;
  }
  return { values: out, files };
}

/**
 * What a start or a step form sends: its values packed with the rights the form shows now — a field «نمایش وقتی…» hides
 * sends neither its value nor the files picked in it (the server drops the value, but files sent with the submission
 * would stay stored on it).
 */
export function packShown(
  layout: FormLayoutV2,
  rights: Record<string, Right>,
  values: Record<string, unknown>,
  defs: FieldSource,
  local: ReadonlyMap<string, File>,
): { values: Record<string, unknown>; files: File[] } {
  return packValues(values, applyShowIf(layout, rights, values, defs), defs, local);
}

/** A draft keeps what was typed, never the files waiting to be sent (they live in this window only). */
export function draftValues(values: Record<string, unknown>, rights: Record<string, Right>, defs: FieldSource): Record<string, unknown> {
  const get = fieldGetter(defs);
  const out: Record<string, unknown> = {};
  for (const [k, r] of Object.entries(rights)) {
    if (!canEdit(r) || !(k in values)) continue;
    const v = values[k];
    out[k] = get(k)?.check === "attachments" ? fileIds(v).filter((id) => !LOCAL_FILE.test(id)) : v;
  }
  return out;
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/** Where the form starts: my refused values first, else my draft, over the case's values I may read. */
export function initialValues(step: Pick<MyStep, "refused" | "draft" | "rights">, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, r] of Object.entries(step.rights)) if (canRead(r) && k in data) out[k] = data[k];
  const over = step.refused?.values ?? step.draft ?? null;
  if (over) for (const [k, v] of Object.entries(over)) if (canEdit(step.rights[k])) out[k] = v;
  return out;
}

/** The required fields (of those shown now) left empty: field → «"…" را پر کنید». */
export function missingRequired(layout: FormLayoutV2, rights: Record<string, Right>, values: Record<string, unknown>, defs: FieldSource): Record<string, string> {
  const now = applyShowIf(layout, rights, values, defs);
  const out: Record<string, string> = {};
  for (const tab of formView(layout, now, defs).tabs)
    for (const s of tab.sections)
      for (const item of s.items) if (item.kind === "field" && item.right === "required" && isEmpty(values[item.name])) out[item.name] = `${q(item.label)} را پر کنید`;
  return out;
}

/** Field messages of a refused write (a 400 «validation» carries `details.fields`). */
export function fieldProblems(details: unknown): Record<string, string> {
  const d = details && typeof details === "object" ? (details as { fields?: unknown }).fields : null;
  if (!d || typeof d !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(d as Record<string, unknown>)) if (typeof v === "string" && v) out[k] = v;
  return out;
}

/** The first values of a start form: the fields' simple defaults («من»، «امروز», fixed values), then my draft. */
export function startValues(fields: Record<string, FieldDef>, rights: Record<string, Right>, me: string | null, tz: string, draft: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(fields)) {
    if (!canEdit(rights[k])) continue;
    const d = f.default;
    if (d === "$me") out[k] = me;
    else if (d === "$today") out[k] = todayISO(tz);
    else if (typeof d === "string" && d.startsWith("$")) continue;
    else if (d !== undefined && d !== null) out[k] = d;
  }
  if (draft) for (const [k, v] of Object.entries(draft)) if (canEdit(rights[k])) out[k] = v;
  return out;
}

/** The rights a form step gives as a map (only the fields of the form). */
export const rightsOf = (raw: Record<string, unknown> | null | undefined): Record<string, Right> =>
  Object.fromEntries(Object.entries(raw ?? {}).filter(([, r]) => isRight(r))) as Record<string, Right>;

/**
 * A process's diagram for me: my steps marked — «نوبت شما» where cases wait for me, «مرحلهٔ آیندهٔ شما» where my part may
 * come (an icon and a word each, never colour alone) — and the people of the other steps as their line.
 */
export function processMarks(steps: readonly StepView[]): { statuses: Record<string, NodeStatusView>; notes: Record<string, string> } {
  const statuses: Record<string, NodeStatusView> = {};
  const notes: Record<string, string> = {};
  for (const s of steps) {
    if (s.mine) statuses[s.key] = { status: s.queue.length ? "mine_open" : "mine_expected" };
    else if (s.people.length) notes[s.key] = s.people.join("، ");
  }
  return { statuses, notes };
}

/** «مرحلهٔ ۲ از ۴»: the phone header's place of the case among its form steps. */
export function stepOfText(at: number, of: number): string {
  return of ? `مرحلهٔ ${fa(Math.max(at, 1))} از ${fa(of)}` : "";
}

/** The step keys of a graph that are form steps, with their actions (the diagram's table view). */
export function formSteps(graph: ProcessGraph): { key: string; label: string; action: string; start: boolean }[] {
  return listSteps(graph)
    .filter((n) => n.type === "form_step")
    .map((n) => {
      const s = formStepOf(n.config);
      return { key: n.id, label: processNodeLabel(n), action: s.action, start: !!s.start };
    });
}

/** A new case's id, chosen here so the case opens at once (and a second send of the same start is applied once). */
export function newCaseId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * The case id of one «پروندهٔ تازه» page: chosen at the first «ارسال» and sent again by every retry, so a start the
 * server applied but whose answer was lost (a timeout, a proxy's 502, the network gone) is applied once — the retry
 * comes back «late» with that case instead of opening a second one. Once the server has answered with a result
 * (applied, late or pending), the next start is a new case.
 */
export function caseIdHolder(make: () => string = newCaseId) {
  let id: string | null = null;
  return {
    /** the id this send uses */
    take: (): string => (id ??= make()),
    /** the server answered with a result */
    answered: (): void => {
      id = null;
    },
  };
}
export type CaseIdHolder = ReturnType<typeof caseIdHolder>;
