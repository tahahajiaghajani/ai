// The lifecycle of requests as pure functions (REQ-022, REQ-023, REQ-026, REQ-044, REQ-046): which requester-facing
// stage a requested item is in, how an order's state and stage roll up from its items, which fulfilment tasks may
// start once the ones they wait for are done, when a requester may still cancel, the close code a final state
// implies and the order's title. The server's hooks and the screens run the same code. Pure.
import { DEFAULT_STAGES } from "./vocab";

export type ItemState =
  | "pending" | "awaiting_approval" | "in_fulfilment" | "awaiting_info" | "backordered"
  | "delivered" | "closed_complete" | "closed_incomplete" | "rejected" | "cancelled";
export type RequestState =
  | "submitted" | "awaiting_approval" | "in_fulfilment" | "awaiting_info" | "delivered"
  | "closed_complete" | "closed_incomplete" | "rejected" | "cancelled";
export type TaskState = "pending" | "open" | "work_in_progress" | "on_hold" | "closed_complete" | "closed_incomplete" | "cancelled" | "skipped";

export const ITEM_OPEN: readonly ItemState[] = ["pending", "awaiting_approval", "in_fulfilment", "awaiting_info", "backordered"];
export const ITEM_DONE: readonly ItemState[] = ["closed_complete", "closed_incomplete", "rejected", "cancelled"];
export const TASK_DONE: readonly TaskState[] = ["closed_complete", "closed_incomplete", "cancelled", "skipped"];
export const TASK_OPEN: readonly TaskState[] = ["pending", "open", "work_in_progress", "on_hold"];

export const isItemOpen = (s: unknown): boolean => ITEM_OPEN.includes(s as ItemState);
export const isItemDone = (s: unknown): boolean => ITEM_DONE.includes(s as ItemState);
export const isTaskDone = (s: unknown): boolean => TASK_DONE.includes(s as TaskState);

/** The stage each state shows (before the item's own list of stages is applied). */
const STATE_STAGE: Record<ItemState, string> = {
  pending: "submitted",
  awaiting_approval: "approval",
  in_fulfilment: "fulfilment",
  awaiting_info: "fulfilment",
  backordered: "sourcing",
  delivered: "delivery",
  closed_complete: "completed",
  closed_incomplete: "completed",
  rejected: "rejected",
  cancelled: "cancelled",
};

/** Stages shown after the end of every progress bar (an item ends in exactly one of them). */
const TERMINAL = new Set(["completed", "rejected", "cancelled"]);
const WORKING = new Set(["in_fulfilment", "awaiting_info", "backordered"]);
const MOVABLE = new Set(["sourcing", "fulfilment", "delivery"]);
/** A stage the bar does not show: the working stage first (waiting for stock is still fulfilment), else earlier ones. */
const FALLBACK: Record<string, string[]> = {
  approval: ["submitted"],
  sourcing: ["fulfilment", "approval", "submitted"],
  fulfilment: ["sourcing", "approval", "submitted"],
  delivery: ["fulfilment", "sourcing", "approval", "submitted"],
};

/**
 * The requester-facing stage of an item in `state` (REQ-023). `stages` is the item's progress bar (default
 * submitted → approval → fulfilment → delivery → completed): a stage the bar does not show falls back to the working
 * stage, else to the closest earlier one it shows. `current` keeps a stage a flow set on purpose while the item works.
 */
export function stageFor(state: string, stages?: readonly string[] | null, current?: string | null): string {
  const bar = stages?.length ? stages : DEFAULT_STAGES;
  const natural = STATE_STAGE[state as ItemState] ?? "submitted";
  if (TERMINAL.has(natural)) return natural;
  // while the work runs a flow may move the stage on («تأمین»، «تحویل» before the item is formally delivered)
  if (current && WORKING.has(state) && bar.includes(current) && MOVABLE.has(current)) return current;
  if (bar.includes(natural)) return natural;
  for (const s of FALLBACK[natural] ?? []) if (bar.includes(s)) return s;
  return bar[0] ?? natural;
}

/** Position of a stage on a bar (−1 for a terminal stage), for the progress display. */
export function stageIndex(stage: string, stages?: readonly string[] | null): number {
  const bar = stages?.length ? stages : DEFAULT_STAGES;
  if (stage === "completed") return bar.length - 1;
  return bar.indexOf(stage);
}

const STAGE_ORDER = ["submitted", "approval", "sourcing", "fulfilment", "delivery", "completed"];

/**
 * An order's state and stage from its items (REQ-022): open while any item is open (waiting for the requester first,
 * then fulfilment, then approval, then submitted); delivered while some are delivered and none open; closed when all
 * are done — complete when every item was fulfilled, incomplete when only some were, rejected or cancelled when none
 * was (rejected wins). The stage is the least advanced among the open items.
 */
export function rollupRequest(items: readonly { state: string; stage?: string | null }[]): { state: RequestState; stage: string } | null {
  if (!items.length) return null;
  const has = (...xs: string[]) => items.some((i) => xs.includes(i.state));
  const all = (...xs: string[]) => items.every((i) => xs.includes(i.state));
  const open = items.filter((i) => isItemOpen(i.state));
  let state: RequestState;
  if (open.length) {
    if (has("awaiting_info")) state = "awaiting_info";
    else if (has("in_fulfilment", "backordered")) state = "in_fulfilment";
    else if (has("delivered", "closed_complete", "closed_incomplete")) state = "in_fulfilment";
    else if (has("awaiting_approval")) state = "awaiting_approval";
    else state = "submitted";
  } else if (has("delivered")) state = "delivered";
  else if (all("closed_complete")) state = "closed_complete";
  else if (has("closed_complete", "closed_incomplete")) state = "closed_incomplete";
  else if (has("rejected")) state = "rejected";
  else state = "cancelled";
  let stage: string;
  const working = open.length ? open : items.filter((i) => i.state === "delivered");
  if (working.length) {
    const stages = working.map((i) => i.stage || stageFor(i.state));
    stage = stages.sort((a, b) => STAGE_ORDER.indexOf(a) - STAGE_ORDER.indexOf(b))[0];
  } else stage = state === "rejected" ? "rejected" : state === "cancelled" ? "cancelled" : "completed";
  return { state, stage };
}

/** The close code a final item state implies (kept when someone chose one). */
export function closeCodeFor(state: string, current?: string | null): string | null {
  if (current) return current;
  switch (state) {
    case "closed_complete":
      return "fulfilled";
    case "closed_incomplete":
      return "partially_fulfilled";
    case "rejected":
      return "rejected";
    case "cancelled":
      return "cancelled";
    default:
      return null;
  }
}

export interface TaskLike {
  id: string;
  state: string;
  depends_on?: string | null;
}

/** Waiting tasks («در انتظار نوبت») whose predecessor is done (or gone): they open now. */
export function readyTasks(tasks: readonly TaskLike[]): string[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return tasks
    .filter((t) => t.state === "pending")
    .filter((t) => {
      const dep = t.depends_on ? byId.get(t.depends_on) : undefined;
      return !dep || isTaskDone(dep.state);
    })
    .map((t) => t.id);
}

/**
 * What the tasks of an item say about it: `open` while any is open, `done` when all are done and at least one was
 * completed or skipped, `failed` when all are done but none was completed (nothing delivered), `none` without tasks.
 */
export function tasksOutcome(tasks: readonly { state?: unknown }[]): "none" | "open" | "done" | "failed" {
  if (!tasks.length) return "none";
  if (tasks.some((t) => !isTaskDone(t.state))) return "open";
  const live = tasks.filter((t) => t.state !== "cancelled");
  if (!live.length) return "failed";
  if (live.some((t) => t.state === "closed_incomplete")) return "failed";
  return "done";
}

/** Why a requester may not cancel an item now under the item's policy (REQ-044), or null when they may. */
export function cancelRefusal(policy: string | null | undefined, state: string): string | null {
  if (!isItemOpen(state)) return "این قلم دیگر باز نیست";
  switch (policy ?? "before_fulfilment") {
    case "never":
      return "این قلم را پس از ثبت نمی‌توان لغو کرد؛ با کارشناس هماهنگ کنید";
    case "before_approval":
      return state === "pending" || state === "awaiting_approval" ? null : "لغو این قلم فقط تا پیش از تأیید ممکن است";
    case "before_fulfilment":
      return state === "pending" || state === "awaiting_approval" ? null : "انجام این قلم آغاز شده و دیگر لغو نمی‌شود؛ با کارشناس هماهنگ کنید";
    default:
      return null;
  }
}

/** May the requester still edit the answers (REQ-044: before approval, when the item allows it)? */
export function answersEditable(allowed: boolean | null | undefined, state: string): boolean {
  return allowed !== false && (state === "pending" || state === "awaiting_approval");
}

/** «لپ‌تاپ جدید» / «لپ‌تاپ جدید و ۲ قلم دیگر» — the title of an order from its items' titles. */
export function orderTitle(titles: readonly string[]): string {
  const xs = titles.map((t) => t.trim()).filter(Boolean);
  if (!xs.length) return "درخواست خدمت";
  if (xs.length === 1) return xs[0].slice(0, 200);
  return `${xs[0]} و ${(xs.length - 1).toLocaleString("fa-IR")} قلم دیگر`.slice(0, 200);
}

/** The people one cart line is ordered for: everyone listed (multi-user items), else one person. */
export function linePeople(line: { requested_for?: string | null; requested_for_list?: readonly string[] | null }, fallback: string, multi: boolean): string[] {
  const list = multi ? [...new Set((line.requested_for_list ?? []).filter(Boolean))] : [];
  if (list.length) return list;
  return [line.requested_for || fallback];
}
