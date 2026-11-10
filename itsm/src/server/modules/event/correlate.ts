// Correlation of alerts into groups («گروه هم‌بسته», catalogue EVT-011) and the groups' roll-up:
//   · rules in order: «یک پیکربندی» (same CI, else same host), «یک خدمت», «ویژگی‌های یکسان» (chosen fields) and
//     «وابستگی پیکربندی‌ها» (an alert whose CI reaches the other's CI through the CMDB's impact relations within a
//     few hops — the upstream CI is the group's root and the downstream alerts are its symptoms), each within its
//     time window; a new alert joins the open group of its key, or opens one with the alerts it matches
//   · the roll-up (once per transaction and group, `onBeforeCommit`): counts, worst severity and best priority,
//     first/last seen, affected services, state (resolved when no member is open, back to open when one reopens,
//     «در رسیدگی» when every open member is acknowledged), the title, the ranked probable causes and the rule-based
//     summary
// Everything runs with system rights inside the pipeline's or the writer's transaction. A group may hold other teams'
// alerts, so the stored title names only an alert of the group's own team (its readers), and the stored summary and
// causes reach a reader as they are only when the reader may read every member and change they name (`redactGroups`).
import { corrKey, groupSummary, groupTitle, rankCauses, severityRank, type Cause, type CauseAlert, type CauseChange } from "@shared/event/logic";
import { ALERT_OPEN_STATES, SEVERITY_ORDER } from "@shared/tables/event";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { condEnv, createIn, onBeforeCommit, orgSchema, updateIn } from "../../engine";
import { computeImpact } from "../cmdb/impact";
import { holds, withWalks } from "../sla/common";
import { idList, isUuid, liveRow, liveRows, msOf, sysOf, type Row } from "./common";
import { attachToIncident } from "./incidents";

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
        // a dependency explains the group better than a shared CI or service: it becomes a topology group of the root
        if (group.reason !== "topology" || (root && group.ci_id !== root)) {
          await updateIn(tx, sys, "alert_group", String(group.id), { reason: "topology", rule_id: rule.id, ci_id: root ?? group.ci_id ?? alert.ci_id }, { trusted: true, keepVersion: true });
        }
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
    // the title names an alert of the group's team (the lead's), never another team's
    title: groupTitle(reason, alerts.length, { node: lead.node ?? null, first: String(lead.short_description ?? "").slice(0, 80) }),
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

/** Put alerts into a group (and queue its roll-up); the group's incident, if any, covers them too. */
export async function join(tx: Tx, sys: Ctx, group: Row, alerts: Row[]): Promise<void> {
  for (const a of alerts) {
    if (a.group_id === group.id) continue;
    await updateIn(tx, sys, "alert", String(a.id), { group_id: group.id }, { trusted: true, keepVersion: true, allowLocked: true });
    a.group_id = group.id;
  }
  // one incident per situation: the group's, else the first a member already has
  let incident: string | null = isUuid(group.incident_id) ? group.incident_id : null;
  let auto = false;
  if (!incident) {
    const members = await liveRows(tx, sys, "alert", { and: [{ f: "group_id", op: "eq", v: group.id }, { f: "incident_id", op: "nempty" }] }, { order: "t.created_at", limit: 1 });
    const holder = members[0] ?? alerts.find((a) => isUuid(a.incident_id));
    if (holder) {
      incident = String(holder.incident_id);
      auto = !!holder.incident_auto_resolve;
      await updateIn(tx, sys, "alert_group", String(group.id), { incident_id: incident }, { trusted: true, keepVersion: true });
      group.incident_id = incident;
    }
  } else {
    const [holder] = await liveRows(tx, sys, "alert", { and: [{ f: "group_id", op: "eq", v: group.id }, { f: "incident_id", op: "eq", v: incident }] }, { limit: 1 });
    auto = !!holder?.incident_auto_resolve;
  }
  if (incident) {
    const open = await liveRows(tx, sys, "alert", { and: [{ f: "group_id", op: "eq", v: group.id }, { f: "state", op: "in", v: ALERT_OPEN_STATES }, { or: [{ f: "incident_id", op: "empty" }, { f: "incident_id", op: "ne", v: incident }] }] }, { limit: 200 });
    await attachToIncident(tx, sys, incident, open.filter((a) => !isUuid(a.incident_id)), auto);
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
    const named = members.find((m) => (m.assignment_group_id ?? null) === (group.assignment_group_id ?? null)) ?? null;
    patch.title = groupTitle(String(group.reason ?? "ci"), members.length, { ci: ciName, service: serviceName, node: named?.node ?? null, first: named ? String(named.short_description ?? "").slice(0, 80) : null });
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

/**
 * Rows of `alert_group` (redactRows): the stored summary and probable causes are made with system rights from every
 * member and from changes near the group's CIs. A reader who may not read some of those — another team's alerts under
 * «نیاز به دانستن», a change of a restricted group or a secure workspace — gets them made again from what they may
 * read (their members, the causes among them and the readable changes, names under their access).
 */
export async function redactGroups(q: Queryable, ctx: Ctx, _def: unknown, rows: Row[]): Promise<void> {
  const targets = rows.filter((r) => isUuid(r.id) && ("summary" in r || "probable_causes" in r));
  if (!targets.length) return;
  const ids = [...new Set(targets.map((r) => String(r.id)))];
  const sys = sysOf(ctx);
  const groups = new Map((await liveRows(q, sys, "alert_group", { f: "id", op: "in", v: ids }, { limit: ids.length })).map((g) => [String(g.id), g]));
  const members = await liveRows(q, sys, "alert", { f: "group_id", op: "in", v: ids }, { order: "t.first_seen_at", limit: 10_000 });
  const readable = await liveRows(q, ctx, "alert", { f: "group_id", op: "in", v: ids }, { order: "t.first_seen_at", limit: 10_000 });
  const seen = new Set(readable.map((m) => String(m.id)));
  const causesIn = (g: Row): Cause[] => (Array.isArray(g.probable_causes) ? (g.probable_causes as Cause[]) : []);
  const changeIds = [...new Set([...groups.values()].flatMap((g) => causesIn(g).filter((c) => c.kind === "change").map((c) => c.id)).filter(isUuid))];
  const changes = changeIds.length ? new Set((await liveRows(q, ctx, "change_request", { f: "id", op: "in", v: changeIds }, { limit: changeIds.length }).catch(() => [] as Row[])).map((c) => String(c.id))) : new Set<string>();
  const rebuild: { r: Row; g: Row; visible: Row[]; causes: Cause[] }[] = [];
  for (const r of targets) {
    const g = groups.get(String(r.id));
    if (!g) continue;
    const all = members.filter((m) => m.group_id === g.id);
    const visible = readable.filter((m) => m.group_id === g.id);
    const causes = causesIn(g);
    const kept = causes.filter((c) => (c.kind === "change" ? changes.has(c.id) : seen.has(c.id)));
    if (visible.length === all.length && kept.length === causes.length) continue;
    rebuild.push({ r, g, visible, causes: kept });
  }
  if (!rebuild.length) return;
  // names of CIs and services under the reader's access
  const ciIds = [...new Set(rebuild.flatMap((x) => x.visible.map((m) => m.ci_id)).filter(isUuid))];
  const serviceIds = [...new Set(rebuild.flatMap((x) => idList(x.g.affected_services)))];
  const ciNames = new Map(ciIds.length ? (await liveRows(q, ctx, "ci", { f: "id", op: "in", v: ciIds.slice(0, 500) }, { limit: 500 }).catch(() => [] as Row[])).map((c) => [String(c.id), String(c.name ?? "")] as const) : []);
  const serviceNames = new Map(serviceIds.length ? (await liveRows(q, ctx, "service", { f: "id", op: "in", v: serviceIds.slice(0, 500) }, { limit: 500 }).catch(() => [] as Row[])).map((s) => [String(s.id), String(s.name ?? "")] as const) : []);
  for (const { r, g, visible, causes } of rebuild) {
    if ("probable_causes" in r) r.probable_causes = causes;
    if ("summary" in r) {
      r.summary = groupSummary({
        title: String(g.title ?? ""),
        alerts: visible.map((m) => ({ number: m.number ?? null, title: String(m.short_description ?? ""), severity: String(m.severity ?? "minor"), state: String(m.state ?? ""), ci_name: m.ci_id ? ciNames.get(String(m.ci_id)) ?? null : null })),
        services: idList(g.affected_services).map((s) => serviceNames.get(s)).filter((x): x is string => !!x).slice(0, 10),
        causes,
      });
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
