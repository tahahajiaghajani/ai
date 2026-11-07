// Record events: written into the job queue (the outbox) inside the write transaction, so an event exists exactly
// when its write committed, and delivered afterwards by the queue to every subscriber registered with
// `onRecordEvent`. Notifications, SLA timers, business rules, flows and AI indexing subscribe here without
// touching the engine.
//
//   onRecordEvent("sla", async (e, jctx) => { if (e.kind === "record.state_changed") … }, { tables: ["incident"] });
//
// Kinds: record.created · record.updated (payload.changed = field names) · record.state_changed (from/to and their
// categories) · record.assigned (assigned_to and/or assignment group changed) · record.deleted · record.restored ·
// record.commented (a journal entry) · record.watched.
// Delivery is at-least-once: one job per event runs the matching subscribers in registration order; a subscriber
// that throws makes the job retry with backoff, and subscribers that already succeeded are skipped on the retry.
// Subscribers run outside any transaction (open `jctx.db.tx` or use `systemCtx`), on the runtime that applied the
// write — the Windows app for its own writes, and the cloud again when it applies the pushed rows (`via: "sync"`):
// a subscriber that talks to the outside world should check `jctx.cfg.mode` if it must act once.
import type { Ctx } from "../context";
import type { Queryable } from "../db";
import { enqueue, registerJobHandler, type Job, type JobContext } from "../jobs";
import { actorId } from "./env";

export type RecordEventKind =
  | "record.created" | "record.updated" | "record.state_changed" | "record.assigned" | "record.deleted" | "record.restored"
  | "record.commented" | "record.watched";

export interface RecordEvent {
  kind: RecordEventKind;
  org_id: string;
  table: string;
  id: string;
  number?: string | null;
  /** the member who acted (null: the system) */
  actor: string | null;
  at: string;
  /** "sync": applied from a Windows app's push; "api": everything else */
  via?: "api" | "sync" | "import";
  /** record.updated: the changed field names; with from/to values of the short ones */
  changed?: string[];
  changes?: Record<string, { from: unknown; to: unknown }>;
  /** record.state_changed */
  from?: string | null;
  to?: string | null;
  from_category?: string | null;
  to_category?: string | null;
  /** record.assigned */
  assigned_to?: { from: string | null; to: string | null };
  assignment_group?: { from: string | null; to: string | null };
  /** record.commented: the journal entry */
  entry?: { id: string; kind: string; visibility: string };
  /** record.watched */
  user_id?: string;
  watching?: boolean;
  /** anything else a module adds to its own events */
  data?: Record<string, unknown>;
}

/** What `emitEvent` takes: an event without the fields the engine fills in. */
export type RecordEventInput = Omit<RecordEvent, "org_id" | "actor" | "at"> & { actor?: string | null };

export type RecordEventHandler = (e: RecordEvent, jctx: JobContext) => Promise<void> | void;

interface Subscriber {
  name: string;
  fn: RecordEventHandler;
  tables?: Set<string>;
  kinds?: Set<string>;
}

const subscribers: Subscriber[] = [];

/**
 * Subscribe to record events. `name` identifies the subscriber (retries skip the ones already done; a later
 * registration with the same name replaces the earlier one). Returns an unsubscribe function.
 */
export function onRecordEvent(name: string, fn: RecordEventHandler, opts: { tables?: string[]; kinds?: RecordEventKind[] } = {}): () => void {
  const s: Subscriber = { name, fn, tables: opts.tables ? new Set(opts.tables) : undefined, kinds: opts.kinds ? new Set(opts.kinds) : undefined };
  const at = subscribers.findIndex((x) => x.name === name);
  if (at >= 0) subscribers.splice(at, 1, s);
  else subscribers.push(s);
  return () => {
    const i = subscribers.indexOf(s);
    if (i >= 0) subscribers.splice(i, 1);
  };
}

/** Write an event into the outbox (inside the caller's transaction). */
export async function emitEvent(q: Queryable, ctx: Ctx, e: RecordEventInput): Promise<void> {
  const event: RecordEvent = { ...e, org_id: ctx.org.id, actor: e.actor === undefined ? actorId(ctx) : e.actor, at: new Date().toISOString() };
  await enqueue(q, { kind: event.kind, orgId: ctx.org.id, payload: event as unknown as Record<string, unknown>, maxAttempts: 10 });
}

async function deliver(job: Job, jctx: JobContext): Promise<void> {
  const e = job.payload as unknown as RecordEvent;
  const done = new Set<string>(Array.isArray(job.payload.$done) ? job.payload.$done : []);
  for (const s of [...subscribers]) {
    if (done.has(s.name)) continue;
    if (s.tables && !s.tables.has(e.table)) continue;
    if (s.kinds && !s.kinds.has(e.kind)) continue;
    await s.fn(e, jctx);
    done.add(s.name);
    if (subscribers.length > 1) await jctx.save({ ...job.payload, $done: [...done] });
  }
}

registerJobHandler("record.*", deliver);

/** Text values longer than this are reported as changed without their values. */
const SHORT = 500;

/** from/to of the changed fields whose values are short (secrets never). */
export function changeSummary(changed: Iterable<string>, prev: Record<string, unknown> | null, next: Record<string, unknown>, skip: (name: string) => boolean): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const name of changed) {
    if (skip(name)) continue;
    const from = prev ? prev[name] ?? null : null;
    const to = next[name] ?? null;
    const size = JSON.stringify([from, to]).length;
    if (size <= SHORT) out[name] = { from, to };
  }
  return out;
}
