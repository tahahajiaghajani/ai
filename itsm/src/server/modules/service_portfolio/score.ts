// The service performance score (catalogue SPF-015): once a day per service in the catalogue — availability from the
// status history against the service's target, the incidents opened on it (major ones weigh more), the SLA breaches
// of those incidents, open problems and the satisfaction ratings of resolved incidents — weighted by the settings row
// into one 0–100 score. One fact row per service and day (`service_score_fact`, the trend of the owner's scorecard);
// the latest score is copied onto the service. Roll-ups per portfolio node are averages computed on read.
import { dailyBars, serviceScore, type ServiceStatus } from "@shared/service_portfolio/logic";
import { addDays, todayISO } from "@shared/jalali";
import { zonedMidnight } from "@shared/model/jalali-buckets";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { createIn, updateIn } from "../../engine";
import { CATALOGUE_STATES, isUuid, liveRows, serviceConfig, sysOf, type Row } from "./common";
import { statusHistory } from "./status";

/** Open states of a table (not resolved, closed or cancelled), from its state model. */
export function openStates(table: string): string[] | null {
  const def = tableDef(table);
  if (!def?.states) return null;
  return def.states.states.filter((s) => !["resolved", "closed", "canceled"].includes(s.category)).map((s) => s.value);
}

/** Records of `table` linked to the services (service field or affected services) matching `extra`. */
export function linkedTo(ids: string[], extra: Row[] = []): Row {
  return { and: [{ or: [{ f: "service_id", op: "in", v: ids }, { f: "affected_services", op: "in", v: ids }] }, ...extra] };
}

const servicesOf = (r: Row, ids: Set<string>) => new Set([r.service_id, ...(Array.isArray(r.affected_services) ? r.affected_services : [])].filter((x) => isUuid(x) && ids.has(x)));

/** Score the catalogue's services for `day` (YYYY-MM-DD, the organisation's time zone; default yesterday). */
export async function scoreDay(tx: Tx, ctx: Ctx, opts: { day?: string; ids?: string[] } = {}): Promise<{ scored: number; day: string }> {
  const sys = sysOf(ctx);
  const tz = String(ctx.org.settings?.timezone ?? "Asia/Tehran");
  const day = opts.day ?? addDays(todayISO(tz), -1);
  const parts: Row[] = [{ f: "state", op: "in", v: CATALOGUE_STATES }];
  if (opts.ids) parts.push({ f: "id", op: "in", v: opts.ids.filter(isUuid) });
  const services = await liveRows(tx, sys, "service", { and: parts as never }, { limit: 2000 });
  if (!services.length) return { scored: 0, day };
  const ids = services.map((s) => String(s.id));
  const idSet = new Set(ids);
  const cfg = await serviceConfig(tx, sys);
  // the day's window: from local midnight of `day` to the next local midnight in the organisation's zone, so each
  // incident, breach and rating counts on exactly one day (availability comes from the sampled bars)
  const start = zonedMidnight(day, tz);
  const end = zonedMidnight(addDays(day, 1), tz);
  const history = await statusHistory(tx, sys, ids, new Date(start - 86_400_000).toISOString());
  const per = new Map<string, { incidents: number; major: number; breaches: number; problems: number; ratings: number[]; incidentIds: string[] }>(ids.map((id) => [id, { incidents: 0, major: 0, breaches: 0, problems: 0, ratings: [], incidentIds: [] }]));
  const window = [{ f: "opened_at", op: "gte", v: new Date(start).toISOString() }, { f: "opened_at", op: "lt", v: new Date(end).toISOString() }];
  for (const i of await liveRows(tx, sys, "incident", linkedTo(ids, window) as never, { limit: 10_000 }).catch(() => [] as Row[])) {
    for (const sid of servicesOf(i, idSet)) {
      const p = per.get(sid)!;
      p.incidents++;
      if (i.major_state === "accepted" || i.major_state === "resolved" || i.major_state === "pir_done") p.major++;
      p.incidentIds.push(String(i.id));
    }
  }
  const resolvedWindow = [{ f: "resolved_at", op: "gte", v: new Date(start).toISOString() }, { f: "resolved_at", op: "lt", v: new Date(end).toISOString() }, { f: "satisfaction", op: "nempty" }];
  for (const i of await liveRows(tx, sys, "incident", linkedTo(ids, resolvedWindow) as never, { limit: 10_000 }).catch(() => [] as Row[])) {
    for (const sid of servicesOf(i, idSet)) per.get(sid)!.ratings.push(Number(i.satisfaction));
  }
  const allIncidents = [...per.values()].flatMap((p) => p.incidentIds);
  if (allIncidents.length) {
    const breached = await liveRows(tx, sys, "task_sla", { and: [{ f: "table_key", op: "eq", v: "incident" }, { f: "breached", op: "eq", v: true }, { f: "record_id", op: "in", v: allIncidents.slice(0, 5000) }] }, { limit: 10_000 }).catch(() => [] as Row[]);
    const set = new Set(breached.map((b) => String(b.record_id)));
    for (const p of per.values()) p.breaches = p.incidentIds.filter((x) => set.has(x)).length;
  }
  const problemOpen = openStates("problem");
  if (problemOpen) {
    for (const pr of await liveRows(tx, sys, "problem", linkedTo(ids, [{ f: "state", op: "in", v: problemOpen }]) as never, { limit: 5000 }).catch(() => [] as Row[])) {
      for (const sid of servicesOf(pr, idSet)) per.get(sid)!.problems++;
    }
  }
  const existing = new Map((await liveRows(tx, sys, "service_score_fact", { and: [{ f: "day", op: "eq", v: day }, { f: "service_id", op: "in", v: ids }] }, { limit: 5000 })).map((f) => [String(f.service_id), f]));
  const w = { availability: cfg.w_availability, incidents: cfg.w_incidents, breaches: cfg.w_breaches, csat: cfg.w_csat };
  let scored = 0;
  for (const s of services) {
    const p = per.get(String(s.id))!;
    const changes = history.get(String(s.id)) ?? [];
    const current = String(s.status ?? "operational") as ServiceStatus;
    // availability of that day: the bars of the window that ends at the day's end
    const { bars } = dailyBars(current, changes, 2, Math.min(Date.now(), Date.parse(`${addDays(day, 1)}T00:00:00Z`)), tz, s.live_at ?? s.created_at ?? null);
    const bar = bars.find((b) => b.day === day);
    const availability = bar && !bar.empty ? bar.availability : null;
    const csat = p.ratings.length ? Math.round((p.ratings.reduce((a, b) => a + b, 0) / p.ratings.length) * 100) / 100 : null;
    const target = s.availability_target !== null && s.availability_target !== undefined ? Number(s.availability_target) : null;
    const { score, components } = serviceScore({ availability, target, incidents: p.incidents, major: p.major, breaches: p.breaches, csat }, w);
    const values = { availability, incidents: p.incidents, major: p.major, breaches: p.breaches, problems: p.problems, csat, score, components };
    const prev = existing.get(String(s.id));
    if (prev) await updateIn(tx, sys, "service_score_fact", prev.id, values, { trusted: true, keepVersion: true });
    else await createIn(tx, sys, "service_score_fact", { day, service_id: s.id, ...values }, { trusted: true });
    if (s.score !== score && day >= addDays(todayISO(tz), -1)) await updateIn(tx, sys, "service", s.id, { score }, { trusted: true, keepVersion: true, allowLocked: true });
    scored++;
  }
  return { scored, day };
}
