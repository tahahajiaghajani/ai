// The flow executor (docs/spec/services/flows.md §5). Deterministic: a run is a set of tokens walking the graph of
// its version; each step runs synchronously, and the run goes on until every token waits or ends, then pauses. Its
// state (tokens, frames of parallel branches and loops, data) is persisted after every step — inside the write
// transaction of steps that change records, so a record write and the step that made it commit together
// (exactly-once); steps that call outside services are at-least-once and get a stable idempotency key
// (`<run>:<step key>`). Waits resume through the job queue: a timer job, `resumeFlowWait` (approvals, subflows,
// services), or a record event re-checking a condition. A lease keeps one worker per run.
//
// Guards: at most FLOW_LIMITS.steps steps per run (a probable endless loop is stopped), at most
// FLOW_LIMITS.depth nested runs (records written by a run carry its depth into the events they cause, and subflows
// add one), at most FLOW_LIMITS.items items per loop.
import { enqueue, registerJobHandler } from "../../jobs";
import type { Ctx, ServerConfig } from "../../context";
import { pgArray, type Queryable, type Tx } from "../../db";
import { condEnv, orgSchema, systemCtx } from "../../engine";
import { memberCtx } from "../../access";
import { uuidv7 } from "@shared/id";
import { faDigits } from "@shared/format";
import { FLOW_LIMITS, RUN_STATES, edgesFrom, nodeLabel, renderTemplate, renderText, type FlowData, type FlowGraph, type FlowNode, type RunState } from "@shared/flows";
import { capJson, loadRun, loadVersion, loadWait, waitsOf, writeStep, type ForkFrame, type LoopFrame, type RunRow, type Runtime, type StepLog, type Token, type WaitRow } from "./store";
import { stepHandler, type StepContext, type StepOutcome, type WaitInfo, type WaitRequest } from "./registry";
import { forEachItems, readRecord } from "./records";
import { DEFAULT_TIMEZONE } from "@shared/constants";

/** The run was canceled or its lease was lost while a step ran: the step's transaction is rolled back. */
export class RunAborted extends Error {}

/** A step reported a failure from inside its transaction (its writes are rolled back). */
class StepFailed extends Error {
  constructor(public outcome: Extract<StepOutcome, { error: string }>) {
    super(outcome.error);
  }
}

/** Where a run starts: the trigger's data (what {{trigger.…}} reads). */
export interface TriggerData {
  /** record · schedule · webhook · manual · catalog · test · subflow */
  kind: string;
  table?: string | null;
  id?: string | null;
  number?: string | null;
  /** record events: created, updated, state_changed, assigned, commented, deleted */
  event?: string | null;
  changed?: string[];
  changes?: Record<string, unknown>;
  actor?: string | null;
  /** webhooks: the JSON body, query and safe headers */
  body?: unknown;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  /** manual runs, subflows, catalog orders */
  inputs?: Record<string, unknown>;
  scheduled_at?: string;
  [k: string]: unknown;
}

export interface StartInput {
  orgId: string;
  flow: { id: string; name: string };
  version: { id: string | null; no: number | null };
  /** a test run's draft graph (other runs execute their version's) */
  graph?: FlowGraph | null;
  trigger: TriggerData;
  actorId: string | null;
  runAs: { kind: "user" | "system"; userId: string | null };
  depth: number;
  parentRunId?: string | null;
  test?: boolean;
}

const START = "@start";
const LEASE = "interval '3 minutes'";

/** Create a run and queue its first execution (inside the caller's transaction when there is one). */
export async function startRun(q: Queryable, input: StartInput): Promise<string> {
  const id = uuidv7();
  const runtime: Runtime = { tokens: [{ id: "t1", node: START, frames: [] }], frames: {}, steps: 0, seq: 0, ids: 1 };
  const trigger = { ...input.trigger };
  const context = {
    trigger,
    vars: {},
    steps: {},
    run: { id, flow: { id: input.flow.id, name: input.flow.name }, version: input.version.no, test: !!input.test, depth: input.depth },
  };
  await q.query(
    `insert into sm_flow_runs (id, org_id, flow_id, flow_name, version_id, version_no, graph, state, test, trigger_kind, trigger_table,
       trigger_record_id, actor_id, run_as, run_as_kind, depth, parent_run_id, context, runtime, current_nodes)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, 'running', $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18::jsonb, $19::text[])`,
    [
      id, input.orgId, input.flow.id, input.flow.name.slice(0, 200), input.version.id, input.version.no,
      input.graph ? JSON.stringify(input.graph) : null, !!input.test, trigger.kind, trigger.table ?? null,
      trigger.id && /^[0-9a-f-]{36}$/i.test(trigger.id) ? trigger.id : null, input.actorId, input.runAs.kind === "system" ? null : input.runAs.userId,
      input.runAs.kind, input.depth, input.parentRunId ?? null, JSON.stringify(context), JSON.stringify(runtime), pgArray([]),
    ],
  );
  await enqueue(q, { kind: "flows.run", orgId: input.orgId, payload: { run: id }, dedupeKey: `flows.run:${id}`, maxAttempts: 20 });
  return id;
}

/**
 * Wake the runs waiting on `key` ("approval:<id>", "run:<id>", or a service's own) with `result` — call it inside
 * the transaction that decided (an approval's decision, a subflow's end): the resume job exists exactly when that
 * decision committed. `result.port` picks the waiting step's next path (e.g. "approved"); the step's own `resume`
 * may interpret the rest. Returns how many waits were woken.
 */
export async function resumeFlowWait(q: Queryable, orgId: string, key: string, result: Record<string, unknown>): Promise<number> {
  const rows = await q.query<{ id: string; run_id: string }>(
    `update sm_flow_waits set result = $3::jsonb where org_id = $1 and key = $2 returning id, run_id`,
    [orgId, key, JSON.stringify(result ?? {})],
  );
  for (const r of rows) {
    await enqueue(q, { kind: "flows.resume", orgId, payload: { run: r.run_id, wait: r.id, reason: "result" }, dedupeKey: `flows.resume:${r.id}`, maxAttempts: 20 });
  }
  return rows.length;
}

// ----- execution ------------------------------------------------------------------------------------------------

interface Exec {
  cfg: ServerConfig;
  run: RunRow;
  graph: FlowGraph;
  nodes: Map<string, FlowNode>;
  rt: Runtime;
  data: Record<string, any>;
  worker: string;
  tz: string;
  ident?: Ctx;
  /** the run reached an end (completed, failed or canceled) in this execution */
  ended: boolean;
}

interface Pending {
  step?: StepLog;
  deleteWaits: string[];
  newWaits: { id: string; token: string; node: string; key: string; req: WaitRequest }[];
}

const isOpen = (s: RunState) => !RUN_STATES[s]?.done;

async function acquire(q: Queryable, runId: string, worker: string): Promise<RunRow | null> {
  return q.one<RunRow>(
    `update sm_flow_runs set lease_by = $2, lease_until = now() + ${LEASE}
     where id = $1 and state in ('running', 'waiting') and (lease_until is null or lease_until < now() or lease_by = $2)
     returning *`,
    [runId, worker],
  );
}

async function release(q: Queryable, runId: string, worker: string): Promise<void> {
  await q.query(`update sm_flow_runs set lease_by = null, lease_until = null where id = $1 and lease_by = $2`, [runId, worker]);
}

/** The run's identity: the member it acts as (through the access provider), or the system. */
async function identity(x: Exec): Promise<Ctx> {
  if (x.ident) return x.ident;
  if (x.run.run_as_kind === "system" || !x.run.run_as) x.ident = await systemCtx(x.cfg, x.run.org_id);
  else {
    try {
      x.ident = await memberCtx(x.cfg, x.run.org_id, x.run.run_as);
    } catch {
      throw new Error("کاربری که این گردش‌کار با دسترسی او اجرا می‌شود دیگر عضو فعال سازمان نیست");
    }
  }
  // warm the per-request caches outside any transaction (PGlite has one connection)
  await orgSchema(x.ident);
  await condEnv(x.ident);
  return x.ident;
}

function nextId(x: Exec, prefix: string): string {
  x.rt.ids = (x.rt.ids ?? 0) + 1;
  return `${prefix}${x.rt.ids}`;
}

/** The data a token sees: the run's, plus the current item of its innermost loop. */
function dataFor(x: Exec, token: Token | null): FlowData {
  const out: FlowData = { ...x.data };
  if (token) {
    for (let i = token.frames.length - 1; i >= 0; i--) {
      const f = x.rt.frames[token.frames[i]];
      if (f?.kind === "loop") {
        out.item = f.items[f.index];
        out.item_index = f.index;
        break;
      }
    }
  }
  return out;
}

function render(x: Exec, token: Token | null, value: unknown): unknown {
  return renderTemplate(value, dataFor(x, token), { tz: x.tz });
}

function setStep(x: Exec, nodeId: string, v: { output?: unknown; error?: string | null; status: string }) {
  x.data.steps ??= {};
  x.data.steps[nodeId] = { output: capJson(v.output ?? {}), error: v.error ?? null, status: v.status };
}

/** Header-like keys whose values never reach a log. */
const SECRET_KEY = /authorization|cookie|token|secret|password|api[-_]?key/i;
function redact(v: unknown, depth = 0): unknown {
  if (depth > 8 || !v || typeof v !== "object") return v;
  if (Array.isArray(v)) {
    return v.map((x) => {
      if (x && typeof x === "object" && "key" in x && SECRET_KEY.test(String((x as { key: unknown }).key))) return { ...(x as object), value: "••••" };
      return redact(x, depth + 1);
    });
  }
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = SECRET_KEY.test(k) && typeof val === "string" ? "••••" : redact(val, depth + 1);
  return out;
}

function stepContext(x: Exec, token: Token, node: FlowNode, key: string, ctx: Ctx, tx: Tx | null, logs: string[]): StepContext {
  const t = x.data.trigger ?? {};
  return {
    cfg: x.cfg,
    orgId: x.run.org_id,
    run: {
      id: x.run.id,
      flowId: x.run.flow_id,
      flowName: x.run.flow_name,
      versionNo: x.run.version_no,
      test: x.run.test,
      depth: x.run.depth,
      actorId: x.run.actor_id,
      runAsId: x.run.run_as_kind === "system" ? null : x.run.run_as,
    },
    node: { id: node.id, type: node.type, label: nodeLabel(node), config: node.config ?? {} },
    stepKey: key,
    ctx,
    tx,
    render: (v) => render(x, token, v),
    text: (v) => renderText(v, dataFor(x, token), { tz: x.tz }),
    data: dataFor(x, token),
    tz: x.tz,
    triggerRecord: t.table && t.id ? { table: String(t.table), id: String(t.id) } : null,
    log: (m) => logs.push(String(m).slice(0, 500)),
  };
}

// ----- tokens and frames ------------------------------------------------------------------------------------------

function removeToken(x: Exec, token: Token) {
  const i = x.rt.tokens.indexOf(token);
  if (i >= 0) x.rt.tokens.splice(i, 1);
}

/** Move a token on along `port` of `node` (or end its path). Several edges fork it into parallel branches. */
function advance(x: Exec, token: Token, node: FlowNode, port: string) {
  const edges = edgesFrom(x.graph, node.id, port);
  if (!edges.length) {
    removeToken(x, token);
    pathEnded(x, token.frames);
    return;
  }
  if (edges.length === 1) {
    token.node = edges[0].target;
    // round robin: a token that moved goes behind the others
    removeToken(x, token);
    x.rt.tokens.push(token);
    return;
  }
  removeToken(x, token);
  fork(x, node, edges.map((e) => e.target), token.frames);
}

/** Start new tokens at the targets of `port` of `node` with `frames` (a continuation after a join or loop). */
function continueFrom(x: Exec, node: FlowNode, port: string, frames: string[]) {
  const edges = edgesFrom(x.graph, node.id, port);
  if (!edges.length) return pathEnded(x, frames);
  if (edges.length === 1) {
    x.rt.tokens.push({ id: nextId(x, "t"), node: edges[0].target, frames: [...frames] });
    return;
  }
  fork(x, node, edges.map((e) => e.target), frames);
}

function fork(x: Exec, node: FlowNode, targets: string[], frames: string[]) {
  const f: ForkFrame = { kind: "fork", id: nextId(x, "f"), node: node.id, expected: targets.length, arrived: 0, dead: 0, join: null, fired: false };
  x.rt.frames[f.id] = f;
  for (const target of targets) x.rt.tokens.push({ id: nextId(x, "t"), node: target, frames: [...frames, f.id] });
}

/** A path ended (no edge to follow): its innermost frame counts it — a branch is done, a loop iteration is done. */
function pathEnded(x: Exec, frames: string[]) {
  if (!frames.length) return;
  const f = x.rt.frames[frames[frames.length - 1]];
  const outer = frames.slice(0, -1);
  if (!f) return;
  if (f.kind === "fork") {
    f.dead++;
    settleFork(x, f, outer);
  } else {
    f.live--;
    if (f.live <= 0) nextIteration(x, f, outer);
  }
}

function settleFork(x: Exec, f: ForkFrame, outer: string[]) {
  if (f.arrived + f.dead < f.expected) return;
  delete x.rt.frames[f.id];
  if (f.fired) return;
  if (f.arrived > 0 && f.join) {
    const join = x.nodes.get(f.join);
    if (join) return continueFrom(x, join, "out", outer);
  }
  // no branch reached a join: the parallel part ends here
  pathEnded(x, outer);
}

function nextIteration(x: Exec, f: LoopFrame, outer: string[]) {
  f.index++;
  if (f.index < f.items.length) {
    f.live = 1;
    x.rt.tokens.push({ id: nextId(x, "t"), node: f.target, frames: [...outer, f.id] });
    return;
  }
  delete x.rt.frames[f.id];
  const loop = x.nodes.get(f.node);
  if (loop) continueFrom(x, loop, "done", outer);
  else pathEnded(x, outer);
}

// ----- persistence ----------------------------------------------------------------------------------------------

function stateOf(x: Exec): RunState {
  if (!isOpen(x.run.state)) return x.run.state;
  return x.rt.tokens.length && x.rt.tokens.every((t) => t.wait) ? "waiting" : "running";
}

async function persist(q: Queryable, x: Exec, p: Pending, end?: { state: RunState; error?: string | null }) {
  const state = end?.state ?? stateOf(x);
  const nodes = [...new Set(x.rt.tokens.map((t) => t.node).filter((n) => n !== START))];
  const r = await q.one<{ id: string }>(
    `update sm_flow_runs set runtime = $3::jsonb, context = $4::jsonb, state = $5, current_nodes = $6::text[], steps_count = $7,
       error = coalesce($8, error), ended_at = case when $9::boolean then now() else ended_at end, updated_at = now()
     where id = $1 and lease_by = $2 and state in ('running', 'waiting') returning id`,
    [x.run.id, x.worker, JSON.stringify(x.rt), JSON.stringify(x.data), state, pgArray(nodes), x.rt.steps, end?.error ?? null, !!end],
  );
  if (!r) throw new RunAborted("run is no longer open or its lease was lost");
  x.run.state = state;
  if (p.step) await writeStep(q, x.run.org_id, x.run.id, p.step);
  for (const id of p.deleteWaits) await q.query(`delete from sm_flow_waits where id = $1`, [id]);
  for (const w of p.newWaits) {
    const due = w.req.dueAt ?? null;
    await q.query(
      `insert into sm_flow_waits (id, org_id, run_id, token_id, node_id, step_key, kind, key, due_at, data)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::jsonb)`,
      [w.id, x.run.org_id, x.run.id, w.token, w.node, w.key, w.req.kind.slice(0, 40), w.req.key ?? null, due ? new Date(due).toISOString() : null, JSON.stringify(capJson(w.req.data ?? {}))],
    );
    if (due) {
      await enqueue(q, { kind: "flows.timer", orgId: x.run.org_id, payload: { run: x.run.id, wait: w.id }, runAt: new Date(due), dedupeKey: `flows.timer:${w.id}`, maxAttempts: 20 });
    }
  }
  if (end && x.run.parent_run_id) {
    await resumeFlowWait(q, x.run.org_id, `run:${x.run.id}`, {
      state: end.state,
      port: end.state === "completed" ? "out" : "error",
      error: end.error ?? null,
      outputs: x.data.outputs ?? {},
      vars: x.data.vars ?? {},
    });
  }
}

/**
 * Records written in this transaction carry the run into the events they cause (`$flow`), so flows those events
 * start know their depth (the endless-chain guard). The events were queued by this transaction under the
 * organisation's write lock: they are exactly the queued record events of this organisation created at its start.
 */
async function tagEvents(tx: Tx, x: Exec) {
  await tx.query(
    `update sm_jobs set payload = payload || jsonb_build_object('$flow', $2::jsonb)
     where org_id = $1 and status = 'queued' and kind like 'record.%' and created_at = now()`,
    [x.run.org_id, JSON.stringify({ run: x.run.id, flow: x.run.flow_id, depth: x.run.depth })],
  );
}

function snapshot(x: Exec): { rt: Runtime; data: Record<string, any>; state: RunState } {
  return { rt: structuredClone(x.rt), data: structuredClone(x.data), state: x.run.state };
}
function restore(x: Exec, s: ReturnType<typeof snapshot>) {
  x.rt = s.rt;
  x.data = s.data;
  x.run.state = s.state;
}

// ----- ending runs ----------------------------------------------------------------------------------------------

function waitInfo(w: WaitRow, reason: WaitInfo["reason"]): WaitInfo {
  return { id: w.id, kind: w.kind, key: w.key, dueAt: w.due_at ? Date.parse(String(w.due_at)) : null, data: w.data ?? {}, result: w.result ?? null, reason: w.result ? "result" : reason };
}

/** Let the waiting steps of a run withdraw what they asked for (approvals…). Never throws. */
async function cancelWaits(cfg: ServerConfig, orgId: string, runId: string, graph: FlowGraph | null, waits: WaitRow[]) {
  for (const w of waits) {
    const node = graph?.nodes.find((n) => n.id === w.node_id);
    const h = node ? stepHandler(node.type) : undefined;
    if (!node || !h?.cancel) continue;
    try {
      await h.cancel({ cfg, orgId, runId, node: { id: node.id, type: node.type, label: nodeLabel(node), config: node.config ?? {} }, wait: waitInfo(w, "result") });
    } catch (e) {
      cfg.log.warn("flow wait cancel failed", { run: runId, wait: w.id, error: String((e as Error)?.message ?? e) });
    }
  }
}

async function endRun(x: Exec, state: RunState, error: string | null, p: Pending = { deleteWaits: [], newWaits: [] }) {
  const waits = await waitsOf(x.cfg.db, x.run.id);
  x.rt.tokens = [];
  x.rt.frames = {};
  x.ended = true;
  await x.cfg.db.tx(async (tx) => {
    await persist(tx, x, { ...p, deleteWaits: [...new Set([...p.deleteWaits, ...waits.map((w) => w.id)])] }, { state, error });
  });
  await cancelWaits(x.cfg, x.run.org_id, x.run.id, x.graph, waits);
  await cancelChildren(x.cfg, x.run.id);
}

async function cancelChildren(cfg: ServerConfig, runId: string) {
  const children = await cfg.db.query<{ id: string }>(`select id from sm_flow_runs where parent_run_id = $1 and state in ('running', 'waiting')`, [runId]);
  for (const c of children) await cancelRun(cfg, c.id, "اجرای بالادستی پایان یافت");
}

/** Cancel a run (and its open subflow runs); its waiting steps withdraw what they asked for. */
export async function cancelRun(cfg: ServerConfig, runId: string, reason = "اجرا لغو شد"): Promise<boolean> {
  const run = await cfg.db.tx(async (tx) => {
    const r = await tx.one<RunRow>(
      `update sm_flow_runs set state = 'canceled', error = $2, ended_at = now(), updated_at = now(), current_nodes = '{}',
         runtime = jsonb_set(jsonb_set(runtime, '{tokens}', '[]'::jsonb), '{frames}', '{}'::jsonb), lease_by = null, lease_until = null
       where id = $1 and state in ('running', 'waiting') returning *`,
      [runId, reason],
    );
    if (r?.parent_run_id) await resumeFlowWait(tx, r.org_id, `run:${r.id}`, { state: "canceled", port: "error", error: reason, outputs: {} });
    return r;
  });
  if (!run) return false;
  const waits = await waitsOf(cfg.db, runId);
  await cfg.db.query(`delete from sm_flow_waits where run_id = $1`, [runId]);
  const graph = run.graph ?? (run.version_id ? (await loadVersion(cfg.db, run.org_id, run.version_id))?.graph ?? null : null);
  await cancelWaits(cfg, run.org_id, runId, graph, waits);
  await cancelChildren(cfg, runId);
  return true;
}

// ----- steps ----------------------------------------------------------------------------------------------------

const errorText = (e: unknown) => String((e as Error)?.message ?? e ?? "خطای ناشناخته").slice(0, 2000);

/** Apply a step's outcome to the tokens and data (in memory); returns the step's log entry. */
function applyOutcome(x: Exec, token: Token, node: FlowNode, key: string, started: number, outcome: StepOutcome, input: unknown, logs: string[], p: Pending): string | null {
  const label = nodeLabel(node);
  const base = { key, node: { id: node.id, type: node.type, label }, startedAt: started, input };
  const withLogs = (o: unknown) => (logs.length ? { ...(o && typeof o === "object" ? (o as object) : {}), $log: logs } : o);
  if ("wait" in outcome) {
    const id = uuidv7();
    token.wait = id;
    p.newWaits.push({ id, token: token.id, node: node.id, key, req: outcome.wait });
    if (outcome.output) setStep(x, node.id, { output: outcome.output, status: "waiting" });
    p.step = { ...base, status: "waiting", output: withLogs(outcome.output ?? {}), endedAt: null };
    return null;
  }
  if ("error" in outcome) {
    const handled = edgesFrom(x.graph, node.id, "error").length > 0;
    setStep(x, node.id, { output: outcome.output, error: outcome.error, status: "failed" });
    p.step = { ...base, status: "failed", port: handled ? "error" : null, error: outcome.error, output: withLogs(outcome.output ?? null), endedAt: Date.now() };
    if (handled) {
      advance(x, token, node, "error");
      return null;
    }
    return `گام «${label}» ناموفق بود: ${outcome.error}`;
  }
  const port = outcome.port ?? "out";
  if (outcome.vars) {
    x.data.vars ??= {};
    for (const [k, v] of Object.entries(outcome.vars)) x.data.vars[k] = capJson(v);
  }
  setStep(x, node.id, { output: outcome.output ?? {}, status: "completed" });
  p.step = { ...base, status: "completed", port, output: withLogs(outcome.output ?? {}), endedAt: Date.now() };
  advance(x, token, node, port);
  return null;
}

/** Run a node through its handler (or resume it) and persist the result. */
async function handlerStep(x: Exec, token: Token, node: FlowNode, key: string, started: number, resume?: { wait: WaitRow; info: WaitInfo }) {
  const h = stepHandler(node.type);
  const logs: string[] = [];
  let input: unknown = undefined;
  try {
    input = redact(render(x, token, node.config ?? {}));
  } catch {
    input = null;
  }
  const p: Pending = { deleteWaits: resume ? [resume.wait.id] : [], newWaits: [] };
  const snap = snapshot(x);
  let outcome: StepOutcome | null = null;
  let failure: string | null = null;
  try {
    if (!h) throw new Error(`گام «${node.type}» در این نسخه پیاده نشده است`);
    const ctx = await identity(x);
    if (resume && !h.resume) {
      outcome = { port: typeof resume.info.result?.port === "string" ? resume.info.result.port : "out", output: resume.info.result ?? {} };
    }
    if (h.transactional) {
      await ctx.write(async (tx) => {
        const s = stepContext(x, token, node, key, ctx, tx, logs);
        const o = outcome ?? (resume ? await h.resume!(s, resume.info) : await h.run(s));
        if ("error" in o) throw new StepFailed(o);
        await tagEvents(tx, x);
        failure = applyOutcome(x, token, node, key, started, o, input, logs, p);
        await persist(tx, x, p);
        outcome = o;
      });
      if (failure) await endRun(x, "failed", failure);
      return;
    }
    if (!resume && !outcome) {
      // a marker, so a long call shows as running (and a crash leaves a trace)
      await writeStep(x.cfg.db, x.run.org_id, x.run.id, { key, node: { id: node.id, type: node.type, label: nodeLabel(node) }, status: "running", input, startedAt: started });
    }
    const s = stepContext(x, token, node, key, ctx, null, logs);
    outcome = outcome ?? (resume ? await h.resume!(s, resume.info) : await h.run(s));
  } catch (e) {
    if (e instanceof RunAborted) throw e;
    restore(x, snap);
    p.newWaits = [];
    outcome = e instanceof StepFailed ? e.outcome : { error: errorText(e) };
  }
  failure = applyOutcome(x, token, node, key, started, outcome!, input, logs, p);
  await x.cfg.db.tx((tx) => persist(tx, x, p));
  if (failure) await endRun(x, "failed", failure);
}

/** «شروع»: read the trigger record as the run's identity into {{trigger.record}}. */
async function triggerStep(x: Exec, token: Token, node: FlowNode, key: string, started: number) {
  const t = (x.data.trigger ??= {});
  const p: Pending = { deleteWaits: [], newWaits: [] };
  const logs: string[] = [];
  let outcome: StepOutcome = { port: "out", output: {} };
  if (t.table && t.id && !t.record) {
    try {
      const ctx = await identity(x);
      t.record = await readRecord(ctx, String(t.table), String(t.id));
    } catch (e) {
      if (t.event === "deleted") t.record = { id: t.id, number: t.number ?? null };
      else outcome = { error: `رکورد آغازکننده برای کاربرِ اجرا در دسترس نیست (${errorText(e)})` };
    }
  }
  const failure = applyOutcome(x, token, node, key, started, outcome, null, logs, p);
  await x.cfg.db.tx((tx) => persist(tx, x, p));
  if (failure) await endRun(x, "failed", failure);
}

function controlStep(x: Exec, node: FlowNode, key: string, started: number, output: unknown, port: string | null): Pending {
  setStep(x, node.id, { output, status: "completed" });
  return { deleteWaits: [], newWaits: [], step: { key, node: { id: node.id, type: node.type, label: nodeLabel(node) }, status: "completed", port, output, startedAt: started, endedAt: Date.now() } };
}

/** «پیوستن شاخه‌ها»: count the arrival in the innermost parallel; continue when all (or the first) arrived. */
async function joinStep(x: Exec, token: Token, node: FlowNode, key: string, started: number) {
  const fid = token.frames[token.frames.length - 1];
  const f = fid ? x.rt.frames[fid] : undefined;
  if (!f || f.kind !== "fork") {
    // not inside a parallel part: nothing to wait for
    const p = controlStep(x, node, key, started, { arrived: 1, expected: 1 }, "out");
    advance(x, token, node, "out");
    return x.cfg.db.tx((tx) => persist(tx, x, p));
  }
  if (f.join && f.join !== node.id) return endRun(x, "failed", "شاخه‌های یک «اجرای موازی» به «پیوستن شاخه‌ها»ی متفاوتی رسیده‌اند");
  f.join = node.id;
  f.arrived++;
  removeToken(x, token);
  const outer = token.frames.slice(0, -1);
  const all = (node.config?.mode ?? "all") !== "any";
  const p = controlStep(x, node, key, started, { arrived: f.arrived, expected: f.expected }, null);
  if (!all && !f.fired) {
    f.fired = true;
    p.step!.port = "out";
    continueFrom(x, node, "out", outer);
  } else if (all && f.arrived + f.dead >= f.expected) p.step!.port = "out";
  settleFork(x, f, outer);
  await x.cfg.db.tx((tx) => persist(tx, x, p));
}

/** «اجرای موازی»: one token per outgoing edge. */
async function parallelStep(x: Exec, token: Token, node: FlowNode, key: string, started: number) {
  const n = edgesFrom(x.graph, node.id, "out").length;
  const p = controlStep(x, node, key, started, { branches: n }, "out");
  advance(x, token, node, "out");
  await x.cfg.db.tx((tx) => persist(tx, x, p));
}

/** «برای هر مورد»: read the items, then run the body once per item (a loop frame). */
async function forEachStep(x: Exec, token: Token, node: FlowNode, key: string, started: number) {
  let items: unknown[];
  try {
    const ctx = await identity(x);
    items = await forEachItems(ctx, node.config ?? {}, (v) => render(x, token, v), x.data.trigger ?? {});
  } catch (e) {
    const logs: string[] = [];
    const p: Pending = { deleteWaits: [], newWaits: [] };
    const failure = applyOutcome(x, token, node, key, started, { error: errorText(e) }, redact(render(x, token, node.config ?? {})), logs, p);
    await x.cfg.db.tx((tx) => persist(tx, x, p));
    if (failure) await endRun(x, "failed", failure);
    return;
  }
  const each = edgesFrom(x.graph, node.id, "each")[0];
  const p = controlStep(x, node, key, started, { count: items.length }, items.length && each ? "each" : "done");
  if (!items.length || !each) advance(x, token, node, "done");
  else {
    const f: LoopFrame = { kind: "loop", id: nextId(x, "l"), node: node.id, items: items.map((i) => capJson(i, 16 * 1024)), index: 0, live: 1, target: each.target };
    x.rt.frames[f.id] = f;
    token.node = each.target;
    token.frames = [...token.frames, f.id];
  }
  await x.cfg.db.tx((tx) => persist(tx, x, p));
}

/** «پایان»: end the whole run with its outcome and outputs. */
async function endStep(x: Exec, token: Token, node: FlowNode, key: string, started: number) {
  const failed = node.config?.outcome === "failed";
  const message = node.config?.message ? renderText(node.config.message, dataFor(x, token), { tz: x.tz }) : "";
  const outputs: Record<string, unknown> = {};
  for (const a of Array.isArray(node.config?.outputs) ? (node.config.outputs as { name?: string; value?: unknown }[]) : []) {
    if (a?.name) outputs[String(a.name)] = capJson(render(x, token, a.value));
  }
  x.data.outputs = outputs;
  const p = controlStep(x, node, key, started, { outcome: failed ? "failed" : "completed", message, outputs }, null);
  await endRun(x, failed ? "failed" : "completed", failed ? message || "گردش‌کار با نتیجهٔ «ناموفق» پایان یافت" : null, p);
}

async function stepToken(x: Exec, token: Token) {
  if (token.node === START) {
    const trigger = x.graph.nodes.find((n) => n.type === "trigger");
    if (!trigger) return endRun(x, "failed", "گام «شروع» در طرح پیدا نشد");
    token.node = trigger.id;
  }
  const node = x.nodes.get(token.node);
  if (!node) return endRun(x, "failed", `گام «${token.node}» در طرح پیدا نشد`);
  const max = FLOW_LIMITS.steps;
  if (x.rt.steps >= max) return endRun(x, "failed", `اجرا پس از ${faDigits(max)} گام متوقف شد؛ احتمالاً حلقه‌ای بی‌پایان در کار است`);
  x.rt.steps++;
  const key = `s${++x.rt.seq}`;
  const started = Date.now();
  switch (node.type) {
    case "trigger":
      return triggerStep(x, token, node, key, started);
    case "parallel":
      return parallelStep(x, token, node, key, started);
    case "join":
      return joinStep(x, token, node, key, started);
    case "for_each":
      return forEachStep(x, token, node, key, started);
    case "end":
      return endStep(x, token, node, key, started);
    default:
      return handlerStep(x, token, node, key, started);
  }
}

async function resumeStep(x: Exec, waitId: string, reason: WaitInfo["reason"]) {
  const w = await loadWait(x.cfg.db, waitId);
  if (!w || w.run_id !== x.run.id) return;
  const token = x.rt.tokens.find((t) => t.wait === waitId);
  if (!token) {
    await x.cfg.db.query(`delete from sm_flow_waits where id = $1`, [waitId]);
    return;
  }
  // a timer that fires early (clock skew between runtimes) waits for its time
  if (reason === "timer" && !w.result && w.due_at && Date.parse(String(w.due_at)) > Date.now() + 1000) {
    await enqueue(x.cfg.db, { kind: "flows.timer", orgId: x.run.org_id, payload: { run: x.run.id, wait: w.id }, runAt: new Date(String(w.due_at)), dedupeKey: `flows.timer:${w.id}` });
    return;
  }
  const node = x.nodes.get(w.node_id);
  if (!node) return endRun(x, "failed", `گام «${w.node_id}» در طرح پیدا نشد`);
  token.wait = null;
  await handlerStep(x, token, node, w.step_key, Date.now(), { wait: w, info: waitInfo(w, reason) });
}

async function graphOf(cfg: ServerConfig, run: RunRow): Promise<FlowGraph | null> {
  if (run.graph) return run.graph;
  if (!run.version_id) return null;
  return (await loadVersion(cfg.db, run.org_id, run.version_id))?.graph ?? null;
}

export interface ExecuteOptions {
  /** stop starting new steps after this instant (epoch ms; default: 8 s from now) */
  deadline?: number;
  worker?: string;
  /** wake a waiting step first */
  resume?: { waitId: string; reason: WaitInfo["reason"] };
}

/**
 * Run a run's ready tokens until they all wait or end, or the deadline passes (then a `flows.run` job continues).
 * `busy`: another worker holds the run (try again shortly).
 */
export async function executeRun(cfg: ServerConfig, runId: string, opts: ExecuteOptions = {}): Promise<{ busy?: boolean; state?: RunState }> {
  const worker = opts.worker ?? `w${process.pid}-${uuidv7().slice(-10)}`;
  const run = await acquire(cfg.db, runId, worker);
  if (!run) {
    const r = await loadRun(cfg.db, runId);
    return r && isOpen(r.state) ? { busy: true } : { state: r?.state };
  }
  const graph = await graphOf(cfg, run);
  const x: Exec = {
    cfg,
    run,
    graph: graph ?? { nodes: [], edges: [] },
    nodes: new Map((graph?.nodes ?? []).map((n) => [n.id, n])),
    rt: Object.assign({ tokens: [], frames: {}, steps: 0, seq: 0, ids: 1 } as Runtime, run.runtime ?? {}),
    data: run.context ?? {},
    worker,
    tz: DEFAULT_TIMEZONE,
    ended: false,
  };
  try {
    const org = await cfg.db.one<{ settings: Record<string, unknown> | null }>(`select settings from sm_orgs where id = $1`, [run.org_id]);
    const tz = org?.settings?.timezone;
    x.tz = typeof tz === "string" && tz ? tz : DEFAULT_TIMEZONE;
    if (!graph) {
      await endRun(x, "failed", "نسخهٔ گردش‌کار پیدا نشد");
      return { state: x.run.state };
    }
    if (opts.resume) await resumeStep(x, opts.resume.waitId, opts.resume.reason);
    const deadline = opts.deadline ?? Date.now() + 8000;
    while (!x.ended) {
      const token = x.rt.tokens.find((t) => !t.wait);
      if (!token) break;
      if (Date.now() > deadline) {
        await enqueue(cfg.db, { kind: "flows.run", orgId: run.org_id, payload: { run: run.id }, dedupeKey: `flows.run:${run.id}`, maxAttempts: 20 });
        break;
      }
      await stepToken(x, token);
    }
    if (!x.ended && !x.rt.tokens.length) await endRun(x, "completed", null);
    else if (!x.ended && x.run.state !== stateOf(x)) await cfg.db.tx((tx) => persist(tx, x, { deleteWaits: [], newWaits: [] }));
    return { state: x.run.state };
  } catch (e) {
    if (e instanceof RunAborted) return { state: (await loadRun(cfg.db, runId))?.state };
    throw e;
  } finally {
    await release(cfg.db, runId, worker).catch(() => undefined);
  }
}

// ----- jobs -----------------------------------------------------------------------------------------------------

registerJobHandler("flows.run", async (job, jctx) => {
  const r = await executeRun(jctx.cfg as ServerConfig, String(job.payload.run), { deadline: jctx.deadline - 500 });
  if (r.busy) return { again: 2000 };
});

const resumeJob = (reason: WaitInfo["reason"]) =>
  async (job: { payload: Record<string, any> }, jctx: { cfg: unknown; deadline: number }) => {
    const r = await executeRun(jctx.cfg as ServerConfig, String(job.payload.run), {
      deadline: jctx.deadline - 500,
      resume: { waitId: String(job.payload.wait), reason: (job.payload.reason as WaitInfo["reason"]) ?? reason },
    });
    if (r.busy) return { again: 2000 };
  };

registerJobHandler("flows.resume", resumeJob("result"));
registerJobHandler("flows.timer", resumeJob("timer"));
registerJobHandler("flows.recheck", resumeJob("event"));
