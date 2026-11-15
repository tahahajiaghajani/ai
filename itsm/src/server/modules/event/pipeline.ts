// The processing of stored events (job `event.process`, one queued per organisation; catalogue EVT-003…008/011):
//   1. the processing rules in order (`event_rule`): a rule applies when its source (if any), condition and message
//      pattern hold; named groups of the pattern fill fields; «تغییر و غنی‌سازی» sets severity, team, service, CI,
//      tags and a message prefix; «نادیده گرفتن» drops the event, «سرکوب» keeps it without an alert, «آستانه» holds it
//      until N events of its fingerprint arrived within M minutes (clearing events always pass); «توقف» ends the chain.
//      Every applied rule is stored on the event with its version.
//   2. CI binding through the CMDB: the payload's CI (number, name, cloud id), else the node against host name, FQDN,
//      IP, name and cloud resource id (cached per run); then the service (payload, rule, source)
//   3. deduplication: the open alert of the fingerprint (or the cleared one within the reopen window) takes the
//      event — count, last seen, severity history, value; a clear clears it; a fire after a clear re-opens it, or marks
//      it «نوسانی» after enough flips in the flap window; otherwise a new alert opens — «در نگهداری» when its CI or
//      services are inside an active maintenance window or a change being implemented on them (EVT-008)
//   4. correlation into groups (correlate.ts) and the alert → incident rules (incidents.ts)
//   5. modules' sinks (`registerEventSink`): the continuity module feeds capacity records from measured values
// Each event is processed in its own transaction; a failure marks that event «خطا» with the reason.
import { matchPattern, mapSeverity, nodeCandidates, thresholdReached, flapState, stillFlapping } from "@shared/event/logic";
import { occurrences, type WindowLike } from "@shared/change/logic";
import { ALERT_OPEN_STATES } from "@shared/tables/event";
import type { Ctx } from "../../context";
import { isTransientDbError, type Queryable, type Tx } from "../../db";
import { lockedRow } from "../incident/common";
import { condEnv, createIn, orgSchema, systemCtx, transitionIn, updateIn } from "../../engine";
import type { JobConfig } from "../../jobs";
import { servicesImpactedBy } from "../cmdb/impact";
import { holds } from "../sla/common";
import { eventConfig, idList, isUuid, liveRow, liveRows, msOf, orgTz, type Row } from "./common";
import { correlate } from "./correlate";
import { applyIncidentRules } from "./incidents";

export type EventSink = (tx: Tx, sys: Ctx, event: Row, alert: Row | null) => Promise<void>;
const sinks: EventSink[] = [];

/** Let another module react to every processed event (inside its transaction). Returns an unregister function. */
export function registerEventSink(fn: EventSink): () => void {
  sinks.push(fn);
  return () => {
    const i = sinks.indexOf(fn);
    if (i >= 0) sinks.splice(i, 1);
  };
}

/** What one run of the pipeline caches. */
interface RunCache {
  rules: Row[] | null;
  cis: Map<string, Row | null>;
  services: Map<string, string | null>;
  hits: Map<string, number>;
  windows: Row[] | null;
  memo: Map<string, Set<string>>;
}

const newCache = (): RunCache => ({ rules: null, cis: new Map(), services: new Map(), hits: new Map(), windows: null, memo: new Map() });

// ---------------------------------------------------------------------------------------------------------------
// CI and service binding

const CI_NUMBER = /^CI\d{3,}$/i;

/** The CI an event names or runs on (system rights; cached per run). */
export async function bindCi(q: Queryable, sys: Ctx, hint: string | null, node: string | null, cache: RunCache): Promise<Row | null> {
  const tries: { key: string; cond: unknown }[] = [];
  const live = { f: "state", op: "nin", v: ["retired", "disposed", "canceled"] };
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (hint) {
    if (UUID_RE.test(hint)) tries.push({ key: `id:${hint}`, cond: { f: "id", op: "eq", v: hint.toLowerCase() } });
    else if (CI_NUMBER.test(hint)) tries.push({ key: `no:${hint.toUpperCase()}`, cond: { f: "number", op: "eq", v: hint.toUpperCase() } });
    else tries.push({ key: `hint:${hint}`, cond: { or: [{ f: "cloud_resource_id", op: "eq", v: hint }, { f: "name", op: "eq", v: hint }, { f: "hostname", op: "eq", v: hint }] } });
  }
  const names = nodeCandidates(node);
  if (names.length) tries.push({ key: `node:${names.join("|")}`, cond: { or: [{ f: "hostname", op: "in", v: names }, { f: "fqdn", op: "in", v: names }, { f: "name", op: "in", v: names }, { f: "cloud_resource_id", op: "in", v: names }] } });
  const ip = names.find((n) => /^\d{1,3}(\.\d{1,3}){3}$/.test(n) || /^[0-9a-f:]+$/i.test(n) && n.includes(":"));
  if (ip) tries.push({ key: `ip:${ip}`, cond: { f: "ip_address", op: "eq", v: ip } });
  for (const t of tries) {
    if (cache.cis.has(t.key)) {
      const c = cache.cis.get(t.key)!;
      if (c) return c;
      continue;
    }
    const [row] = await liveRows(q, sys, "ci", { and: [live, t.cond] } as never, { order: "t.updated_at desc", limit: 1 }).catch(() => [] as Row[]);
    cache.cis.set(t.key, row ?? null);
    if (row) return row;
  }
  return null;
}

async function bindService(q: Queryable, sys: Ctx, hint: string | null, cache: RunCache): Promise<string | null> {
  if (!hint) return null;
  if (cache.services.has(hint)) return cache.services.get(hint)!;
  const cond = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hint) ? { f: "id", op: "eq", v: hint.toLowerCase() } : { or: [{ f: "name", op: "eq", v: hint }, { f: "service_key", op: "eq", v: hint }, { f: "number", op: "eq", v: hint.toUpperCase() }] };
  const [row] = await liveRows(q, sys, "service", cond as never, { limit: 1 }).catch(() => [] as Row[]);
  cache.services.set(hint, row ? String(row.id) : null);
  return row ? String(row.id) : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Maintenance

/** The maintenance an alert falls in: an active maintenance window over its CI or services, or a change being implemented on them. */
export async function maintenanceFor(q: Queryable, sys: Ctx, a: { ci_id?: string | null; service_id?: string | null; affected_services?: unknown }, now: number, cache?: RunCache): Promise<{ window_id: string | null; change_id: string | null; label: string } | null> {
  const cis = isUuid(a.ci_id) ? [a.ci_id] : [];
  const services = [...new Set([...(isUuid(a.service_id) ? [a.service_id] : []), ...idList(a.affected_services)])];
  if (!cis.length && !services.length) return null;
  const windows = cache?.windows ?? (await liveRows(q, sys, "change_window", { and: [{ f: "kind", op: "eq", v: "maintenance" }, { f: "active", op: "eq", v: true }] }, { limit: 300 }).catch(() => [] as Row[]));
  if (cache) cache.windows = windows;
  const tz = orgTz(sys);
  for (const w of windows) {
    const scoped = idList(w.cis).some((x) => cis.includes(x)) || idList(w.services).some((x) => services.includes(x));
    if (!scoped) continue;
    if (occurrences(w as unknown as WindowLike, now, now + 1, tz, 1).length) return { window_id: String(w.id), change_id: null, label: `پنجرهٔ نگهداری «${w.name}»` };
  }
  const iso = new Date(now).toISOString();
  const touching: unknown[] = [];
  if (cis.length) touching.push({ f: "ci_id", op: "in", v: cis }, { f: "affected_cis", op: "in", v: cis });
  if (services.length) touching.push({ f: "service_id", op: "in", v: services }, { f: "affected_services", op: "in", v: services });
  const [change] = await liveRows(q, sys, "change_request", {
    and: [{ f: "state", op: "eq", v: "implement" }, { or: [{ f: "planned_end", op: "empty" }, { f: "planned_end", op: "gte", v: iso }] }, { or: touching }],
  } as never, { order: "t.planned_start desc", limit: 1 }).catch(() => [] as Row[]);
  return change ? { window_id: null, change_id: String(change.id), label: `تغییر در حال اجرای ${change.number ?? ""}` } : null;
}

// ---------------------------------------------------------------------------------------------------------------
// One event

interface Decision {
  rules: { id: string; name: string; version: number; action: string }[];
  notes: string[];
  hints?: { ci?: string | null; service?: string | null };
  /** a processing rule chose the team (it then wins over the CI's support group) */
  group_by_rule?: boolean;
}

async function loadRules(q: Queryable, sys: Ctx, cache: RunCache): Promise<Row[]> {
  if (!cache.rules) cache.rules = await liveRows(q, sys, "event_rule", { f: "active", op: "eq", v: true }, { order: "t.sort_order, t.name", limit: 300 });
  return cache.rules;
}

/** Apply the processing rules to an event (in memory); returns the outcome they decided, if any. */
export async function applyRules(q: Queryable, sys: Ctx, ev: Row, decision: Decision, cache: RunCache, now: number): Promise<"ignored" | "suppressed" | "held" | null> {
  const rules = await loadRules(q, sys, cache);
  if (!rules.length) return null;
  const schema = await orgSchema(sys, q);
  const def = schema.def("event")!;
  const env = await condEnv(sys);
  for (const r of rules) {
    if (isUuid(r.source_id) && r.source_id !== ev.source_id) continue;
    if (!holds(r.condition, ev, env, def, schema.lookup, true)) continue;
    let groups: Record<string, string> | null = {};
    if (r.pattern) {
      groups = matchPattern(r.pattern, ev.message);
      if (!groups) continue;
    }
    for (const [k, v] of Object.entries(groups ?? {})) {
      if (k === "severity") ev.severity = mapSeverity(v, null, ev.severity);
      else if (["node", "resource", "metric"].includes(k)) ev[k] = v.slice(0, 255);
      else if (k === "message") ev.message = v.slice(0, 300);
      else if (k === "ci") decision.hints = { ...(decision.hints ?? {}), ci: v };
      else if (k === "service") decision.hints = { ...(decision.hints ?? {}), service: v };
    }
    decision.rules.push({ id: String(r.id), name: String(r.name), version: Number(r.version ?? 1), action: String(r.action) });
    cache.hits.set(String(r.id), (cache.hits.get(String(r.id)) ?? 0) + 1);
    if (r.action === "ignore") return "ignored";
    if (r.action === "suppress") return "suppressed";
    if (r.action === "threshold") {
      if (ev.status === "resolved") continue;
      const minutes = Math.max(1, Number(r.threshold_minutes) || 5);
      const since = new Date(now - minutes * 60_000).toISOString();
      const same = await liveRows(q, sys, "event", { and: [{ f: "fingerprint", op: "eq", v: ev.fingerprint }, { f: "received_at", op: "gte", v: since }, { f: "status", op: "eq", v: "firing" }] }, { limit: 1000 });
      const times = same.map((x) => msOf(x.received_at) ?? now);
      if (!same.some((x) => x.id === ev.id)) times.push(now);
      if (!thresholdReached(times, now, Number(r.threshold_count) || 3, minutes)) {
        decision.notes.push(`زیر آستانهٔ «${r.name}»: ${times.length.toLocaleString("fa-IR")} از ${Number(r.threshold_count).toLocaleString("fa-IR")}`);
        return "held";
      }
    }
    if (r.action === "set") {
      if (r.set_severity) ev.severity = r.set_severity;
      if (isUuid(r.set_group_id)) {
        ev.assignment_group_id = r.set_group_id;
        decision.group_by_rule = true;
      }
      if (isUuid(r.set_service_id)) ev.service_id = r.set_service_id;
      if (isUuid(r.set_ci_id)) ev.ci_id = r.set_ci_id;
      if (Array.isArray(r.add_tags) && r.add_tags.length) ev.tags = [...new Set([...(Array.isArray(ev.tags) ? ev.tags : []), ...r.add_tags])].slice(0, 50);
      if (r.message_prefix && !String(ev.message).startsWith(String(r.message_prefix))) ev.message = `${r.message_prefix} ${ev.message}`.slice(0, 300);
    }
    if (r.stop) break;
  }
  return null;
}

/** The open alert of a fingerprint, or the one cleared within the reopen window. */
async function alertOf(q: Queryable, sys: Ctx, fingerprint: string, reopenMinutes: number, now: number): Promise<Row | null> {
  const [open] = await liveRows(q, sys, "alert", { and: [{ f: "fingerprint", op: "eq", v: fingerprint }, { f: "state", op: "in", v: ALERT_OPEN_STATES }] }, { order: "t.created_at desc", limit: 1 });
  if (open) return open;
  if (reopenMinutes <= 0) return null;
  const since = new Date(now - reopenMinutes * 60_000).toISOString();
  const [cleared] = await liveRows(q, sys, "alert", { and: [{ f: "fingerprint", op: "eq", v: fingerprint }, { f: "state", op: "eq", v: "cleared" }, { f: "resolved_at", op: "gte", v: since }] }, { order: "t.resolved_at desc", limit: 1 });
  return cleared ?? null;
}

const history = (h: unknown, at: string, from: unknown, to: unknown) => [...(Array.isArray(h) ? h : []), { at, from, to }].slice(-50);

/**
 * Claim an event for this transaction: one event at a time per organisation (several instances may run
 * `event.process` at once — a delivery queues a job while another runs — and two runs must not both open the alert of
 * a new fingerprint), and only while it is still pending (a run that read it before another processed it leaves it).
 */
async function claim(tx: Tx, sys: Ctx, id: string): Promise<boolean> {
  await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [`event.process:${sys.org.id}`]);
  const table = (await orgSchema(sys, tx)).def("event")?.table ?? "sm_events";
  const cur = await tx.one<{ outcome: string | null }>(`select outcome from ${table} where id = $1::uuid and org_id = $2 for update`, [id, sys.org.id]);
  return cur?.outcome === "pending";
}

/** Process one pending event inside `tx`; null when it is no longer pending (another run processed it). */
export async function processEvent(tx: Tx, sys: Ctx, ev0: Row, cache: RunCache = newCache(), now = Date.now()): Promise<Row | null> {
  if (!(await claim(tx, sys, String(ev0.id)))) return null;
  const ev: Row = { ...ev0, tags: Array.isArray(ev0.tags) ? [...ev0.tags] : [] };
  const decision: Decision = { rules: [], notes: [], hints: (ev0.decision as Decision | null)?.hints ?? {} };
  const cfg = await eventConfig(tx, sys);
  const src = isUuid(ev.source_id) ? await liveRow(tx, sys, "event_source", ev.source_id) : null;
  const ruled = await applyRules(tx, sys, ev, decision, cache, now);
  let alert: Row | null = null;
  let outcome: string;
  if (ruled) outcome = ruled;
  else {
    // CI and service
    if (!isUuid(ev.ci_id)) {
      const ci = await bindCi(tx, sys, decision.hints?.ci ?? null, ev.node ?? null, cache);
      if (ci) ev.ci_id = ci.id;
    }
    const ci = isUuid(ev.ci_id) ? await liveRow(tx, sys, "ci", ev.ci_id) : null;
    if (!isUuid(ev.service_id)) ev.service_id = (await bindService(tx, sys, decision.hints?.service ?? null, cache)) ?? src?.service_id ?? null;
    if (!isUuid(ev.assignment_group_id)) ev.assignment_group_id = ci?.support_group_id ?? src?.assignment_group_id ?? null;
    // the CI's support group is more precise than the source's default team; a rule's choice stays
    else if (ci?.support_group_id && !decision.group_by_rule) ev.assignment_group_id = ci.support_group_id;
    const at = new Date(now).toISOString();
    const existing = await alertOf(tx, sys, String(ev.fingerprint), cfg.reopen_minutes, now);
    const value = ev.value !== null && ev.value !== undefined ? String(ev.value) : null;
    if (ev.status === "resolved") {
      if (existing && ALERT_OPEN_STATES.includes(String(existing.state))) {
        const flips = flapState(existing.flips, now, cfg.flap_window_minutes * 60_000, cfg.flap_threshold);
        await updateIn(tx, sys, "alert", String(existing.id), { event_count: Number(existing.event_count ?? 0) + 1, last_seen_at: at, last_event_id: ev.id, flips: flips.flips, ...(value !== null ? { last_value: value } : {}) }, { trusted: true, keepVersion: true });
        alert = await transitionIn(tx, sys, "alert", String(existing.id), "cleared", {}, { trusted: true });
        outcome = "cleared";
      } else if (existing) {
        alert = await updateIn(tx, sys, "alert", String(existing.id), { event_count: Number(existing.event_count ?? 0) + 1, last_seen_at: at, last_event_id: ev.id }, { trusted: true, keepVersion: true, allowLocked: true });
        outcome = "cleared";
      } else outcome = "orphan_clear";
    } else if (existing && existing.state === "cleared") {
      const flips = flapState(existing.flips, now, cfg.flap_window_minutes * 60_000, cfg.flap_threshold);
      await updateIn(tx, sys, "alert", String(existing.id), {
        event_count: Number(existing.event_count ?? 0) + 1, last_seen_at: at, last_event_id: ev.id, flips: flips.flips,
        severity: ev.severity, ...(ev.severity !== existing.severity ? { severity_history: history(existing.severity_history, at, existing.severity, ev.severity) } : {}),
        ...(value !== null ? { last_value: value } : {}),
      }, { trusted: true, keepVersion: true });
      alert = await transitionIn(tx, sys, "alert", String(existing.id), "open", {}, { trusted: true });
      // a re-opened alert inside maintenance (a window over its CI or services, a change being implemented on them)
      // waits there like a new one: no escalation, no paging
      const services = idList(existing.affected_services);
      const maint = await maintenanceFor(tx, sys, { ci_id: existing.ci_id ?? ci?.id ?? null, service_id: existing.service_id ?? null, affected_services: services }, now, cache);
      if (maint) {
        alert = await transitionIn(tx, sys, "alert", String(existing.id), "maintenance", { maintenance_window_id: maint.window_id, change_id: maint.change_id }, { trusted: true });
        decision.notes.push(`در نگهداری: ${maint.label}`);
      } else if (flips.flapping) {
        alert = await transitionIn(tx, sys, "alert", String(existing.id), "flapping", { flap_count: Number(existing.flap_count ?? 0) + 1 }, { trusted: true });
        decision.notes.push("نوسان: هشدار در بازهٔ نوسان بارها رفع و دوباره فعال شد");
      }
      outcome = "reopened";
    } else if (existing) {
      const worse = ev.severity !== existing.severity;
      alert = await updateIn(tx, sys, "alert", String(existing.id), {
        event_count: Number(existing.event_count ?? 0) + 1, last_seen_at: at, last_event_id: ev.id,
        ...(worse ? { severity: ev.severity, severity_history: history(existing.severity_history, at, existing.severity, ev.severity) } : {}),
        ...(ev.description && ev.description !== existing.description ? { description: ev.description } : {}),
        ...(value !== null ? { last_value: value } : {}),
      }, { trusted: true, keepVersion: true });
      outcome = "updated";
      // a flapping alert that keeps firing after its flips aged out of the flap window is down for good: back to open,
      // so its escalation starts again
      if (existing.state === "flapping" && !stillFlapping(existing.flips, now, cfg.flap_window_minutes * 60_000, cfg.flap_threshold)) {
        alert = await transitionIn(tx, sys, "alert", String(existing.id), "open", {}, { trusted: true });
        decision.notes.push("نوسان پایان یافت و هشدار همچنان فعال است؛ هشدار باز شد");
      }
      if (worse) await applyIncidentRules(tx, sys, alert);
    } else {
      const services = ci ? await servicesImpactedBy(tx, sys, [String(ci.id)], 6).catch(() => [] as string[]) : [];
      const service = isUuid(ev.service_id) ? ev.service_id : services[0] ?? null;
      const maint = await maintenanceFor(tx, sys, { ci_id: ci?.id ?? null, service_id: service, affected_services: services }, now, cache);
      const first = ev.occurred_at && (msOf(ev.occurred_at) ?? now) <= now ? ev.occurred_at : at;
      alert = await createIn(tx, sys, "alert", {
        short_description: ev.message,
        description: ev.description ?? null,
        severity: ev.severity,
        source_id: ev.source_id,
        node: ev.node ?? null,
        resource: ev.resource ?? null,
        metric: ev.metric ?? null,
        tags: ev.tags,
        ci_id: ci?.id ?? null,
        service_id: service,
        affected_services: [...new Set([...(service ? [service] : []), ...services])].slice(0, 50),
        assignment_group_id: ev.assignment_group_id ?? null,
        fingerprint: ev.fingerprint,
        event_count: 1,
        first_seen_at: first,
        last_seen_at: at,
        last_event_id: ev.id,
        last_value: value,
        severity_history: [{ at, from: null, to: ev.severity }],
        state: maint ? "maintenance" : "open",
        maintenance_window_id: maint?.window_id ?? null,
        change_id: maint?.change_id ?? null,
      }, { trusted: true });
      if (maint) decision.notes.push(`در نگهداری: ${maint.label}`);
      outcome = "created";
      await correlate(tx, sys, alert, now, cache.memo);
      alert = (await liveRow(tx, sys, "alert", String(alert.id))) ?? alert;
      if (!maint) await applyIncidentRules(tx, sys, alert);
    }
  }
  const stored = await updateIn(tx, sys, "event", String(ev.id), {
    outcome,
    alert_id: alert?.id ?? null,
    ci_id: ev.ci_id ?? null,
    service_id: ev.service_id ?? null,
    assignment_group_id: ev.assignment_group_id ?? null,
    severity: ev.severity,
    message: ev.message,
    node: ev.node ?? null,
    resource: ev.resource ?? null,
    metric: ev.metric ?? null,
    tags: ev.tags,
    decision,
    processed_at: new Date(now).toISOString(),
  }, { trusted: true, keepVersion: true });
  for (const s of sinks) await s(tx, sys, stored, alert);
  return stored;
}

/** Process pending events of an organisation until none is left or the budget ends. */
export async function processPending(cfg: JobConfig, orgId: string, deadline: number, now = () => Date.now()): Promise<{ processed: number; failed: number; more: boolean }> {
  const sys = await systemCtx(cfg as never, orgId);
  const cache = newCache();
  const out = { processed: 0, failed: 0, more: false };
  // events met by a deadlock or a serialization failure (writes side by side): processed again, a few times, before
  // they count as an error (nothing of the aborted transaction was kept)
  const transient = new Map<string, number>();
  try {
    for (let round = 0; round < 200; round++) {
      const batch = await liveRows(sys.db, sys, "event", { f: "outcome", op: "eq", v: "pending" }, { order: "t.received_at, t.id", limit: 25 });
      if (!batch.length) break;
      for (const ev of batch) {
        if (Date.now() > deadline) {
          out.more = true;
          return out;
        }
        try {
          if (await sys.write((tx) => processEvent(tx, sys, ev, cache, now()))) out.processed++;
        } catch (e) {
          const tries = transient.get(String(ev.id)) ?? 0;
          if (isTransientDbError(e) && tries < 3) {
            transient.set(String(ev.id), tries + 1);
            continue;
          }
          out.failed++;
          const message = String((e as Error).message ?? e).slice(0, 500);
          await sys.write(async (tx) => {
            if ((await liveRow(tx, sys, "event", String(ev.id)))?.outcome !== "pending") return;
            await updateIn(tx, sys, "event", String(ev.id), { outcome: "error", decision: { rules: [], notes: [], error: message }, processed_at: new Date().toISOString() }, { trusted: true, keepVersion: true });
          }).catch(() => undefined);
        }
      }
    }
    return out;
  } finally {
    await flushHits(sys, cache).catch(() => undefined);
  }
}

/** Write the rules' hit counters once per run. */
async function flushHits(sys: Ctx, cache: RunCache): Promise<void> {
  if (!cache.hits.size) return;
  await sys.write(async (tx) => {
    for (const [id, n] of cache.hits) {
      // counted on the rule locked: two runs flushing at once both count
      const r = await lockedRow(tx, sys, "event_rule", id);
      if (r) await updateIn(tx, sys, "event_rule", id, { hits: Number(r.hits ?? 0) + n, last_hit_at: new Date().toISOString() }, { trusted: true, keepVersion: true });
    }
  });
  cache.hits.clear();
}

/** Try the processing rules on stored events without changing anything (the simulation before activation). */
export async function simulateRule(q: Queryable, sys: Ctx, rule: Row, opts: { days: number; limit?: number }): Promise<{ checked: number; matched: number; outcomes: Record<string, number>; samples: { id: string; message: string; before: Record<string, unknown>; after: Record<string, unknown>; outcome: string | null }[] }> {
  const since = new Date(Date.now() - Math.max(1, Math.min(30, opts.days)) * 86_400_000).toISOString();
  const events = await liveRows(q, sys, "event", { f: "received_at", op: "gte", v: since }, { order: "t.received_at desc", limit: Math.max(10, Math.min(2000, opts.limit ?? 500)) });
  const cache = newCache();
  cache.rules = [{ ...rule, id: rule.id ?? "draft", active: true, version: rule.version ?? 0 }];
  const out = { checked: events.length, matched: 0, outcomes: {} as Record<string, number>, samples: [] as { id: string; message: string; before: Record<string, unknown>; after: Record<string, unknown>; outcome: string | null }[] };
  for (const e of events) {
    const copy: Row = { ...e, tags: Array.isArray(e.tags) ? [...e.tags] : [] };
    const decision: Decision = { rules: [], notes: [] };
    const outcome = await applyRules(q, sys, copy, decision, cache, msOf(e.received_at) ?? Date.now());
    if (!decision.rules.length) continue;
    out.matched++;
    const key = outcome ?? "changed";
    out.outcomes[key] = (out.outcomes[key] ?? 0) + 1;
    if (out.samples.length < 10) {
      const fields = ["severity", "message", "node", "assignment_group_id", "service_id", "ci_id", "tags"];
      out.samples.push({ id: String(e.id), message: String(e.message), before: Object.fromEntries(fields.map((f) => [f, e[f] ?? null])), after: Object.fromEntries(fields.map((f) => [f, copy[f] ?? null])), outcome });
    }
  }
  return out;
}
