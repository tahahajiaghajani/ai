// Plug-in points of the flow engine for the services built next to it (docs/spec/services/flows.md §8):
//
// - `registerFlowStepHandler(type, handler)` implements a node type. The executor ships handlers for every node,
//   and for three of them a stand-in the real service replaces by registering its own:
//     "notify"    default: writes the rendered message and recipients into the step log (nothing is sent)
//     "approval"  default: a built-in approval decided in the run's page (POST /flows/waits/:id/decide)
//     "ai_skill"  default: runs a skill registered with `registerFlowSkill`; none registered → a no-op
//   A later registration replaces the earlier one (the merge of a service only adds its registration).
// - `registerFlowSkill(skill)` adds an AI skill the «مهارت هوش مصنوعی» step can run (the AI layer).
// - `setFlowBusinessClock(clock)` makes «انتظار زمانی» count business time (the calendar service); without one,
//   business time is counted as calendar time and the step log says so.
// - `resumeFlowWait(q, orgId, key, result)` (executor.ts) wakes the runs waiting on `key` — e.g. the approvals
//   service calls it with "approval:<id>" when a decision is made, inside its own write transaction.
import type { Ctx, ServerConfig } from "../../context";
import type { Tx } from "../../db";
import type { FlowData } from "@shared/flows";

/** What a step handler gets. */
export interface StepContext {
  cfg: ServerConfig;
  orgId: string;
  run: {
    id: string;
    flowId: string;
    flowName: string;
    versionNo: number | null;
    test: boolean;
    depth: number;
    /** the member whose action started the run (null: schedule, webhook, the system) */
    actorId: string | null;
    /** the identity the run acts as (null: the system) */
    runAsId: string | null;
  };
  node: { id: string; type: string; label: string; config: Record<string, unknown> };
  /** idempotency key of this step (stable across retries of the same step): use it to deduplicate side effects */
  stepKey: string;
  /** the run's identity — reads and writes go through the access provider as this member (or the system) */
  ctx: Ctx;
  /** the write transaction of a transactional handler (its writes commit together with the step), else null */
  tx: Tx | null;
  /** fill data pills ({{trigger.record.x}}, {{steps.<id>.output.y}}, {{vars.z}}, {{item.w}}, {{now}}…) */
  render(value: unknown): unknown;
  /** fill data pills and return text */
  text(value: unknown): string;
  /** the run's data (read-only) */
  data: Readonly<FlowData>;
  /** the organisation's time zone */
  tz: string;
  /** the record the run started with, if any */
  triggerRecord: { table: string; id: string } | null;
  /** a line in the step log */
  log(message: string): void;
}

/** Wait until something happens; the run pauses and resumes through the job queue. */
export interface WaitRequest {
  /** a short kind ("timer", "condition", "approval", "subflow", or a service's own) */
  kind: string;
  /** how `resumeFlowWait` finds it ("approval:<id>"); null: only `dueAt` wakes it */
  key?: string | null;
  /** when to resume anyway (epoch ms): a timer, a timeout, the next poll */
  dueAt?: number | null;
  /** kept with the wait and handed back to `resume` */
  data?: Record<string, unknown>;
}

export type StepOutcome =
  /** continue on `port` (default "out") with `output` as {{steps.<id>.output…}} */
  | { port?: string; output?: Record<string, unknown>; vars?: Record<string, unknown> }
  | { wait: WaitRequest; output?: Record<string, unknown> }
  /** fail the step (the error port is taken when connected, otherwise the run fails) */
  | { error: string; output?: Record<string, unknown> };

/** A wait being resumed. */
export interface WaitInfo {
  id: string;
  kind: string;
  key: string | null;
  dueAt: number | null;
  data: Record<string, unknown>;
  /** what `resumeFlowWait` handed over (null when the timer fired or a record event woke it) */
  result: Record<string, unknown> | null;
  /** why the step wakes up */
  reason: "result" | "timer" | "event";
}

export interface FlowStepHandler {
  /**
   * true: `run`/`resume` are called inside the run identity's write transaction (`s.tx`), committed together with
   * the step's log and the run's state — writes are exactly-once. false (default): outside any transaction (calls to
   * outside services; at-least-once: deduplicate with `s.stepKey`).
   */
  transactional?: boolean;
  run(s: StepContext): Promise<StepOutcome>;
  /** a waiting step wakes up (its wait's timer fired, `resumeFlowWait` delivered a result, or a record changed) */
  resume?(s: StepContext, wait: WaitInfo): Promise<StepOutcome>;
  /** the run was canceled (or ended) while this step waited: withdraw what it asked for (e.g. open approvals) */
  cancel?(args: WaitCancel): Promise<void>;
}

/** What `cancel` gets: the waiting step and its wait (outside any transaction). */
export interface WaitCancel {
  cfg: ServerConfig;
  orgId: string;
  runId: string;
  node: { id: string; type: string; label: string; config: Record<string, unknown> };
  wait: WaitInfo;
}

const handlers = new Map<string, FlowStepHandler>();
const builtins = new WeakSet<FlowStepHandler>();

/** Implement a node type (a later registration replaces the earlier one). Returns an unregister function. */
export function registerFlowStepHandler(type: string, handler: FlowStepHandler): () => void {
  const before = handlers.get(type);
  handlers.set(type, handler);
  return () => {
    if (handlers.get(type) !== handler) return;
    if (before) handlers.set(type, before);
    else handlers.delete(type);
  };
}

/** The flow engine's own implementation of a node type (a service may replace it). */
export function registerBuiltinStepHandler(type: string, handler: FlowStepHandler): () => void {
  builtins.add(handler);
  return registerFlowStepHandler(type, handler);
}

export function stepHandler(type: string): FlowStepHandler | undefined {
  return handlers.get(type);
}

/** Does a service (not the built-in stand-in) implement this node type now? */
export function serviceInstalled(type: string): boolean {
  const h = handlers.get(type);
  return !!h && !builtins.has(h);
}

// ----- AI skills ------------------------------------------------------------------------------------------------

export interface FlowSkill {
  key: string;
  label: string;
  description?: string;
  /** names of the inputs the skill reads (the designer offers them) */
  inputs?: { name: string; label: string }[];
  run(s: StepContext, inputs: Record<string, unknown>): Promise<{ text?: string; data?: unknown; [k: string]: unknown }>;
}

const skills = new Map<string, FlowSkill>();

/** Add an AI skill «مهارت هوش مصنوعی» can run (the AI layer). Returns an unregister function. */
export function registerFlowSkill(skill: FlowSkill): () => void {
  skills.set(skill.key, skill);
  return () => {
    if (skills.get(skill.key) === skill) skills.delete(skill.key);
  };
}

export function flowSkill(key: string): FlowSkill | undefined {
  return skills.get(key);
}

export function flowSkills(): FlowSkill[] {
  return [...skills.values()];
}

// ----- business time --------------------------------------------------------------------------------------------

export interface BusinessClock {
  /** the instant `ms` of business time after `from` (epoch ms) in the organisation's (or the named) calendar */
  add(args: { cfg: ServerConfig; orgId: string; from: number; ms: number; calendarId?: string | null }): Promise<number>;
}

let clock: BusinessClock | null = null;

/** Count «به وقت کاری» waits with the calendar service. Returns a function restoring the previous clock. */
export function setFlowBusinessClock(c: BusinessClock | null): () => void {
  const before = clock;
  clock = c;
  return () => {
    clock = before;
  };
}

export function businessClock(): BusinessClock | null {
  return clock;
}

export type { FlowData };
