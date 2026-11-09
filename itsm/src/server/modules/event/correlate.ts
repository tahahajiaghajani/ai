// Correlation of alerts into groups («گروه هم‌بسته», catalogue EVT-011) and the groups' roll-up:
//   · rules in order: «یک پیکربندی» (same CI, else same host), «یک خدمت», «ویژگی‌های یکسان» (chosen fields) and
//     «وابستگی پیکربندی‌ها» (an alert whose CI reaches the other's CI through the CMDB's impact relations within a
//     few hops — the upstream CI is the group's root and the downstream alerts are its symptoms), each within its
//     time window; a new alert joins the open group of its key, or opens one with the alerts it matches
//   · the roll-up (once per transaction and group, `onBeforeCommit`): counts, worst severity and best priority,
//     first/last seen, affected services, state (resolved when no member is open, back to open when one reopens,
//     «در رسیدگی» when every open member is acknowledged), the title, the ranked probable causes and the rule-based
//     summary
// Everything runs with system rights inside the pipeline's or the writer's transaction.
import { corrKey, groupSummary, groupTitle, rankCauses, severityRank, type CauseAlert, type CauseChange } from "@shared/event/logic";
import { ALERT_OPEN_STATES, SEVERITY_ORDER } from "@shared/tables/event";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { condEnv, createIn, onBeforeCommit, orgSchema, updateIn } from "../../engine";
import { computeImpact } from "../cmdb/impact";
import { holds, withWalks } from "../sla/common";
import { idList, isUuid, liveRow, liveRows, msOf, type Row } from "./common";

const MIN = 60_000;

/** CIs that depend on `ciId` within `hops` (system rights; cached per call site through `memo`). */
export async function dependentsOf(q: Queryable, sys: Ctx, ciId: string, hops: number, memo?: Map<string, Set<string>>): Promise<Set<string>> {
  const key = `${ciId}:${hops}`;
  const hit = memo?.get(key);
  if (hit) return hit;
  let out = new Set<string>();
  try {
    const g = await computeImpact(q, sys, new Map([[ciId, 1]]), { depth: Math.max(1, Math.min(6, hops)) });
    out = new Set([...g.hits].filter(([id, h]) => id !== ciId && (h.severity ?? 0) > 0).map(([id]) => id));
  } catch {
    out = new Set();
  }
  memo?.set(key, out);
  return out;
}

const groupKey = (ruleId: string, key: string) => `${ruleId}:${key}`.slice(0, 300);

/** Correlate a new (or re-opened) alert; returns the group it joined or opened, or null. */
export async function correlate(tx: Tx, sys: Ctx, alert: Row, now = Date.now(), memo = new Map<string, Set<string>>()): Promise<Row | null> {
  if (isUuid(alert.group_id)) return liveRow(tx, sys, "alert_group", alert.group_id);
  const rules = await liveRows(tx, sys, "correlation_rule", { f: "active", op: "eq", v: true }, { order: "t.sort_order, t.name", limit: 50 });
  if (!rules.length) return null;
  const schema = await orgSchema(sys, tx);
  const def = schema.def("alert")!;
  const env = await condEnv(sys);
  const row = await withWalks(tx, def, sys.org.id, alert, rules.map((r) => r.condition), env, schema.lookup);
  for (const rule of rules) {
    if (!holds(rule.condition, row, env, def, schema.lookup, true)) continue;
    const since = new Date(now - Math.max(1, Number(rule.window_minutes) || 15) * MIN).toISOString();
    const recent = { and: [{ f: "state", op: "in" as const, v: ALERT_OPEN_STATES }, { f: "last_seen_at", op: "gte" as const, v: since }, { f: "id", op: "ne" as const, v: alert.id }] };
    if (rule.kind === "topology") {
      if (!isUuid(alert.ci_id)) continue;
      const others = (await liveRows(tx, sys, "alert", { and: [...recent.and, { f: "ci_id", op: "nempty" }] }, { order: "t.first_seen_at", limit: 40 })).filter((o) => o.ci_id !== alert.ci_id || isUuid(o.group_id));
      if (!others.length) continue;
      const hops = Math.max(1, Math.min(6, Number(rule.max_hops) || 3));
      const mine = await dependentsOf(tx, sys, alert.ci_id, hops, memo);
      let root: string | null = null;
      const related: Row[] = [];
      for (const o of others) {
        if (mine.has(o.ci_id)) {
          related.push(o);
          root = alert.ci_id;
        } else if ((await dependentsOf(tx, sys, o.ci_id, hops, memo)).has(alert.ci_id)) {
          related.push(o);
          root = root ?? o.ci_id;
        }
      }
      if (!related.length) continue;
      const existing = related.find((o) => isUuid(o.group_id));
      const group = existing ? await liveRow(tx, sys, "alert_group", existing.group_id) : null;
      if (group && !["resolved", "closed"].includes(String(group.state))) {
        await join(tx, sys, group, [alert, ...related.filter((o) => !isUuid(o.group_id))]);
        return group;
      }
      return open(tx, sys, rule, "topology", groupKey(rule.id, `topo:${root ?? alert.ci_id}`), [alert, ...related.filter((o) => !isUuid(o.group_id))], { ci_id: root ?? alert.ci_id });
    }
    const fields = idList(rule.match_fields);
    const key = corrKey(String(rule.kind), alert as never, fields);
    if (!key) continue;
    const gkey = groupKey(String(rule.id), key);
    const [existing] = await liveRows(tx, sys, "alert_group", { and: [{ f: "corr_key", op: "eq", v: gkey }, { f: "state", op: "in", v: ["open", "acknowledged"] }, { f: "last_seen_at", op: "gte", v: since }] }, { order: "t.created_at desc", limit: 1 });
    if (existing) {
      await join(tx, sys, existing, [alert]);
      return existing;
    }
    const candidates = (await liveRows(tx, sys, "alert", { and: [...recent.and, { f: "group_id", op: "empty" }] }, { order: "t.first_seen_at", limit: 100 })).filter((o) => corrKey(String(rule.kind), o as never, fields) === key);
    if (!candidates.length) continue;
    return open(tx, sys, rule, String(rule.kind), gkey, [alert, ...candidates], { ci_id: rule.kind === "ci" ? alert.ci_id ?? null : null, service_id: rule.kind === "service" ? alert.service_id ?? null : null });
  }
  return null;
}

async function open(tx: Tx, sys: Ctx, rule: Row, reason: string, key: string, alerts: Row[], extra: { ci_id?: string | null; service_id?: string | null }): Promise<Row> {
  const worst = alerts.reduce((w, a) => (severityRank(a.severity) < severityRank(w) ? a.severity : w), SEVERITY_ORDER[SEVERITY_ORDER.length - 1]);
  const lead = alerts.find((a) => a.assignment_group_id) ?? alerts[0];
  const group = await createIn(tx, sys, "alert_group", {
    title: groupTitle(reason, alerts.length, { node: alerts[0].node ?? null, first: String(alerts[0].short_description ?? "").slice(0, 80) }),
    severity: worst,
    reason,
    rule_id: rule.id,
    corr_key: key,
    ci_id: extra.ci_id ?? null,
    service_id: extra.service_id ?? lead.service_id ?? null,
    assignment_group_id: lead.assignment_group_id ?? null,
    first_seen_at: alerts.map((a) => a.first_seen_at).filter(Boolean).sort()[0] ?? new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
  }, { trusted: true });
  await join(tx, sys, group, alerts);
  return group;
}

/** Put alerts into a group (and queue its roll-up). */
export async function join(tx: Tx, sys: Ctx, group: Row, alerts: Row[]): Promise<void> {
  for (const a of alerts) {
    if (a.group_id === group.id) continue;
    await updateIn(tx, sys, "alert", String(a.id), { group_id: group.id }, { trusted: true, keepVersion: true, allowLocked: true });
    a.group_id = group.id;
  }
  queueRollup(tx, sys, String(group.id));
}

/** Recompute a group once, just before the transaction commits. */
export function queueRollup(tx: Tx, sys: Ctx, groupId: string): void {
  if (!isUuid(groupId)) return;
  onBeforeCommit(tx, `event.group:${groupId}`, () => rollupGroup(tx, sys, groupId));
}

/** Recent changes on the group's CIs that may explain it (implemented or running within a day before it began). */
async function changesNear(q: Queryable, sys: Ctx, ciIds: string[], firstMs: number): Promise<CauseChange[]> {
  if (!ciIds.length) return [];
  const from = new Date(firstMs - 24 * 3600_000).toISOString();
  const rows = await liveRows(q, sys, "change_request", {
    and: [
      { f: "state", op: "in", v: ["implement", "review", "closed"] },
      { or: [{ f: "actual_start", op: "gte", v: from }, { f: "planned_start", op: "gte", v: from }] },
      { or: [{ f: "ci_id", op: "in", v: ciIds }, { f: "affected_cis", op: "in", v: ciIds }] },
    ],
  }, { order: "t.planned_start desc", limit: 20 }).catch(() => [] as Row[]);
  return rows.map((c) => ({
    id: String(c.id),
    number: c.number ?? null,
    title: String(c.short_description ?? ""),
    at_ms: msOf(c.actual_start) ?? msOf(c.planned_start) ?? firstMs,
    on_group_ci: true,
  }));
}

/** The probable causes of a group's alerts (deterministic; system rights). */
export async function causesOf(q: Queryable, sys: Ctx, members: Row[], memo = new Map<string, Set<string>>()): Promise<ReturnType<typeof rankCauses>> {
  const withCi = members.filter((m) => isUuid(m.ci_id)).slice(0, 15);
  const names = new Map<string, string>();
  if (withCi.length) {
    const cis = await liveRows(q, sys, "ci", { f: "id", op: "in", v: [...new Set(withCi.map((m) => String(m.ci_id)))] }, { limit: 50 });
    for (const c of cis) names.set(String(c.id), String(c.name ?? ""));
  }
  const alerts: CauseAlert[] = [];
  for (const m of members.slice(0, 40)) {
    let dependents = 0;
    if (isUuid(m.ci_id) && withCi.includes(m)) {
      const deps = await dependentsOf(q, sys, m.ci_id, 4, memo);
      dependents = members.filter((o) => o.id !== m.id && isUuid(o.ci_id) && deps.has(o.ci_id)).length;
    }
    alerts.push({ id: String(m.id), number: m.number ?? null, title: String(m.short_description ?? ""), ci_id: m.ci_id ?? null, ci_name: m.ci_id ? names.get(String(m.ci_id)) ?? null : null, severity: String(m.severity ?? "minor"), first_seen_ms: msOf(m.first_seen_at) ?? msOf(m.created_at) ?? Date.now(), dependents });
  }
  const first = Math.min(...alerts.map((a) => a.first_seen_ms));
  const changes = await changesNear(q, sys, [...new Set(withCi.map((m) => String(m.ci_id)))], first);
  return rankCauses(alerts, changes, 3);
}

/** Recompute a group from its members (counts, severity, state, services, title, causes, summary). */
export async function rollupGroup(tx: Tx, sys: Ctx, groupId: string): Promise<void> {
  const group = await liveRow(tx, sys, "alert_group", groupId);
  if (!group) return;
  const members = await liveRows(tx, sys, "alert", { f: "group_id", op: "eq", v: groupId }, { order: "t.first_seen_at", limit: 500 });
  const open = members.filter((m) => ALERT_OPEN_STATES.includes(String(m.state)));
  const basis = open.length ? open : members;
  const severity = basis.reduce((w, a) => (severityRank(a.severity) < severityRank(w) ? a.severity : w), "info");
  const priority = basis.reduce((p, a) => (Number(a.priority) && Number(a.priority) < Number(p) ? String(a.priority) : p), "5");
  const services = [...new Set(members.flatMap((m) => [...idList(m.affected_services), ...(isUuid(m.service_id) ? [m.service_id] : [])]))].slice(0, 50);
  const firsts = members.map((m) => m.first_seen_at).filter(Boolean).sort();
  const lasts = members.map((m) => m.last_seen_at).filter(Boolean).sort();
  const patch: Row = {
    alert_count: members.length,
    open_count: open.length,
    severity,
    priority,
    affected_services: services,
    first_seen_at: firsts[0] ?? group.first_seen_at ?? null,
    last_seen_at: lasts[lasts.length - 1] ?? group.last_seen_at ?? null,
  };
  if (members.length !== Number(group.alert_count ?? 0)) {
    let ciName: string | null = null;
    if (isUuid(group.ci_id)) ciName = String((await liveRow(tx, sys, "ci", group.ci_id))?.name ?? "") || null;
    let serviceName: string | null = null;
    if (isUuid(group.service_id)) serviceName = String((await liveRow(tx, sys, "service", group.service_id))?.name ?? "") || null;
    patch.title = groupTitle(String(group.reason ?? "ci"), members.length, { ci: ciName, service: serviceName, node: members[0]?.node ?? null, first: String(members[0]?.short_description ?? "").slice(0, 80) });
    const causes = await causesOf(tx, sys, members);
    patch.probable_causes = causes;
    const serviceRows = services.length ? await liveRows(tx, sys, "service", { f: "id", op: "in", v: services.slice(0, 10) }, { limit: 10 }) : [];
    const ciNames = new Map<string, string>();
    const ciIds = [...new Set(members.map((m) => m.ci_id).filter(isUuid))];
    if (ciIds.length) for (const c of await liveRows(tx, sys, "ci", { f: "id", op: "in", v: ciIds.slice(0, 50) }, { limit: 50 })) ciNames.set(String(c.id), String(c.name ?? ""));
    patch.summary = groupSummary({
      title: String(patch.title),
      alerts: members.map((m) => ({ number: m.number ?? null, title: String(m.short_description ?? ""), severity: String(m.severity ?? "minor"), state: String(m.state ?? ""), ci_name: m.ci_id ? ciNames.get(String(m.ci_id)) ?? null : null })),
      services: serviceRows.map((s) => String(s.name ?? "")),
      causes,
    });
  }
  // the state follows the members (a person may still close the group by hand)
  const state = String(group.state);
  if (state !== "closed") {
    if (!open.length && (state === "open" || state === "acknowledged")) patch.state = "resolved";
    else if (open.length && state === "resolved") patch.state = "open";
    else if (open.length && state === "open" && open.every((m) => m.state !== "open")) patch.state = "acknowledged";
    else if (open.some((m) => m.state === "open") && state === "acknowledged") patch.state = "open";
  }
  await updateIn(tx, sys, "alert_group", groupId, patch, { trusted: true, keepVersion: true });
  // symptoms: alerts whose CI depends on the group's root CI
  if (group.reason === "topology" && isUuid(group.ci_id)) {
    const deps = await dependentsOf(tx, sys, group.ci_id, 6);
    for (const m of members) {
      const symptom = isUuid(m.ci_id) && m.ci_id !== group.ci_id && deps.has(m.ci_id);
      if (!!m.symptom !== symptom) await updateIn(tx, sys, "alert", String(m.id), { symptom }, { trusted: true, keepVersion: true, allowLocked: true });
    }
  }
}

/** Take an alert out of its group (a person's split; the group is recomputed). */
export async function ungroup(tx: Tx, sys: Ctx, alert: Row): Promise<void> {
  if (!isUuid(alert.group_id)) return;
  const gid = String(alert.group_id);
  await updateIn(tx, sys, "alert", String(alert.id), { group_id: null, symptom: false }, { trusted: true, keepVersion: true, allowLocked: true });
  queueRollup(tx, sys, gid);
}
