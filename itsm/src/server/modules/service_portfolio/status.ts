// Live service status and the status page (catalogue SPF-015 live health, SPF-013 status messages, the status page of
// «Beyond the market»). A service's status comes from its signals — open incidents on it (major incidents, priority 1
// and 2), CIs that are down or in repair and reach the service's CI through the dependency graph (redundancy
// absorbs), planned maintenance — unless its owner set it by hand («تعیین وضعیت»). `refreshStatuses` recomputes them
// (after incident and CI events, and hourly), writes `status`/`status_since`/`status_reason` on change (the field's
// history is the status page's record), tells the subscribers (on their subscription record, which they may read) and
// raises `record.service.status_changed` for the owners' rule.
//
// The status page shows only services their owners published (`on_status_page`), as a projection: name, status,
// message and daily bars — never the service record itself — to every member of the organisation, and by a secret
// link without signing in when the portfolio manager turned the public page on.
import { statusFromSignals, dailyBars, STATUS_RANK, statusLabel, type ServiceStatus, type StatusChange, type StatusSignals } from "@shared/service_portfolio/logic";
import type { StatusPage, StatusPageService } from "@shared/service_portfolio/api";
import { todayISO } from "@shared/jalali";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { pgArray } from "../../db";
import { addJournalIn, defFor, emitEvent, updateIn } from "../../engine";
import { notifyPeople } from "../notify";
import { computeImpact } from "../cmdb/impact";
import { CATALOGUE_STATES, OPEN_INCIDENT, isUuid, liveRows, serviceConfig, subscriptionLive, subscriptionPeople, sysOf, type Row } from "./common";

/** Services whose status is followed (in the catalogue, and in transition: early life support). */
const FOLLOWED = [...CATALOGUE_STATES, "transition"];
const DOWN_CI = ["non_operational", "repair"];

/** The signals of each service (system rights: a status is the same for everyone). */
export async function serviceSignals(q: Queryable, ctx: Ctx, services: Row[]): Promise<Map<string, StatusSignals>> {
  const sys = sysOf(ctx);
  const out = new Map<string, StatusSignals>(services.map((s) => [String(s.id), { incidents: [], ci: null, override: s.status_override ?? null }]));
  const ids = [...out.keys()];
  if (!ids.length) return out;
  // open incidents on the services (the service field or the affected services)
  const incidents = await liveRows(q, sys, "incident", { and: [OPEN_INCIDENT, { or: [{ f: "service_id", op: "in", v: ids }, { f: "affected_services", op: "in", v: ids }] }] }, { limit: 5000 }).catch(() => [] as Row[]);
  for (const i of incidents) {
    const on = new Set([i.service_id, ...(Array.isArray(i.affected_services) ? i.affected_services : [])].filter((x) => isUuid(x) && out.has(x)));
    for (const id of on) out.get(id)!.incidents.push({ priority: i.priority ? String(i.priority) : null, major: i.major_state === "accepted" });
  }
  // CIs that are down, in repair or in maintenance, and how badly they reach each service's CI
  const byCi = new Map<string, string[]>();
  for (const s of services) if (isUuid(s.ci_id)) byCi.set(s.ci_id, [...(byCi.get(s.ci_id) ?? []), String(s.id)]);
  if (!byCi.size) return out;
  const live = { f: "state", op: "nin" as const, v: ["retired", "disposed", "canceled"] };
  const failing = await liveRows(q, sys, "ci", { and: [live, { f: "operational_status", op: "in", v: DOWN_CI }] }, { limit: 300 });
  const maintenance = await liveRows(q, sys, "ci", { and: [live, { f: "state", op: "eq", v: "maintenance" }, { f: "operational_status", op: "nin", v: DOWN_CI }] }, { limit: 300 });
  const reach = async (sources: Row[], isMaintenance: boolean) => {
    if (!sources.length) return;
    const g = await computeImpact(q, sys, new Map(sources.map((c) => [String(c.id), 1])), { depth: 8 });
    for (const [ciId, serviceIds] of byCi) {
      const h = g.hits.get(ciId);
      if (!h || h.absorbed || !(h.severity > 0)) continue;
      for (const sid of serviceIds) {
        const sig = out.get(sid)!;
        if (!sig.ci || h.severity > sig.ci.severity || (sig.ci.maintenance && !isMaintenance)) sig.ci = { severity: h.severity, maintenance: isMaintenance };
      }
    }
  };
  await reach(maintenance, true);
  await reach(failing, false);
  return out;
}

/** The people subscribed to a service who want status news, by subscription (each is told on their subscription). */
async function subscribersOf(q: Queryable, ctx: Ctx, serviceId: string): Promise<{ sub: Row; users: string[] }[]> {
  const today = todayISO(String(ctx.org.settings?.timezone ?? "Asia/Tehran"));
  const subs = await liveRows(q, sysOf(ctx), "service_subscription", { and: [{ f: "service_id", op: "eq", v: serviceId }, { f: "notify", op: "eq", v: true }] }, { limit: 2000 });
  const out: { sub: Row; users: string[] }[] = [];
  for (const s of subs) if (subscriptionLive(s, today)) out.push({ sub: s, users: await subscriptionPeople(q, ctx, s) });
  return out;
}

/** Tell a service's subscribers that its status changed (in-app; e-mail too for outages). */
export async function notifySubscribers(tx: Tx, ctx: Ctx, service: Row, from: string | null, to: string, reason: string): Promise<number> {
  const subject = `«${service.name}»: ${statusLabel(to)}`;
  const body = [
    `وضعیت خدمت «${service.name}» از «${statusLabel(from)}» به «${statusLabel(to)}» تغییر کرد.`,
    reason ? `علت: ${reason}` : "",
    service.status_note ? `پیام: ${service.status_note}` : "",
  ].filter(Boolean).join("\n\n");
  const outage = STATUS_RANK[to as ServiceStatus] >= STATUS_RANK.partial_outage;
  let n = 0;
  for (const { sub, users } of await subscribersOf(tx, ctx, String(service.id))) {
    if (!users.length) continue;
    n += await notifyPeople(tx, ctx.org.id, {
      table: "service_subscription", id: String(sub.id), users, subject, body, label: "تغییر وضعیت خدمت", source: "سبد خدمات",
      channels: outage ? ["in_app", "email"] : ["in_app"], mandatory: outage,
    });
  }
  return n;
}

/**
 * Recompute the status of the followed services (all of them, or `ids`), write the changes and tell people. Returns how
 * many changed. Runs as the system inside `tx`.
 */
export async function refreshStatuses(tx: Tx, ctx: Ctx, opts: { ids?: string[] } = {}): Promise<{ checked: number; changed: number }> {
  const sys = sysOf(ctx);
  const parts: Row[] = [{ f: "state", op: "in", v: FOLLOWED }];
  if (opts.ids) {
    const ids = opts.ids.filter(isUuid);
    if (!ids.length) return { checked: 0, changed: 0 };
    parts.push({ f: "id", op: "in", v: ids });
  }
  const services = await liveRows(tx, sys, "service", { and: parts as never }, { limit: 2000 });
  if (!services.length) return { checked: 0, changed: 0 };
  const signals = await serviceSignals(tx, sys, services);
  const cfg = await serviceConfig(tx, sys);
  const { def } = await defFor(sys, "service", tx);
  let changed = 0;
  for (const s of services) {
    const { status, reason } = statusFromSignals(signals.get(String(s.id))!);
    if (status === s.status && (reason || null) === (s.status_reason ?? null)) continue;
    const from = s.status ?? null;
    const row = await updateIn(tx, sys, "service", s.id, { status, status_reason: reason || null, ...(status !== from ? { status_since: new Date().toISOString() } : {}) }, { trusted: true, keepVersion: true, allowLocked: true });
    if (status === from) continue;
    changed++;
    await addJournalIn(tx, sys, def, row, { kind: "system", body: `وضعیت: ${statusLabel(from)} ← ${statusLabel(status)}${reason ? ` (${reason})` : ""}` }, { trusted: true }).catch(() => undefined);
    const owners = [s.owner_id, s.product_owner_id].filter(isUuid);
    await emitEvent(tx, sys, { kind: "record.service.status_changed", table: "service", id: s.id, number: s.number ?? null, actor: null, data: { users: owners, from, to: status, reason } });
    if (cfg.notify_subscribers) await notifySubscribers(tx, sys, { ...s, ...row }, from, status, reason);
  }
  return { checked: services.length, changed };
}

/** The status history of services since `sinceIso` (from the engine's field history), oldest first. */
export async function statusHistory(q: Queryable, ctx: Ctx, ids: string[], sinceIso: string): Promise<Map<string, StatusChange[]>> {
  const out = new Map<string, StatusChange[]>();
  const list = ids.filter(isUuid);
  if (!list.length) return out;
  const rows = await q.query<{ record_id: string; old: unknown; new: unknown; at: string | Date }>(
    `select record_id, old, new, at from sm_history where org_id = $1 and table_key = 'service' and field = 'status' and record_id = any($2::uuid[]) and at >= $3 order by at`,
    [ctx.org.id, pgArray(list), sinceIso],
  );
  for (const r of rows) {
    const id = String(r.record_id);
    const at = r.at instanceof Date ? r.at.toISOString() : String(r.at);
    out.set(id, [...(out.get(id) ?? []), { at, from: typeof r.old === "string" ? r.old : null, to: typeof r.new === "string" ? r.new : "operational" }]);
  }
  return out;
}

/** The worst status of a set (the page's headline). */
export const overallOf = (xs: string[]): ServiceStatus => xs.reduce<ServiceStatus>((w, s) => ((STATUS_RANK[s as ServiceStatus] ?? 0) > STATUS_RANK[w] ? (s as ServiceStatus) : w), "operational");

/**
 * The status page: published services in the catalogue, with daily bars over `days` days. Built with system rights
 * as a projection (name, status, message, bars); `forUser` marks the caller's subscriptions.
 */
export async function statusPage(ctx: Ctx, opts: { days?: number; forUser?: string | null } = {}): Promise<StatusPage> {
  const sys = sysOf(ctx);
  const days = Math.min(90, Math.max(7, Math.round(opts.days ?? 90)));
  const cfg = await serviceConfig(ctx.db, sys);
  const services = await liveRows(ctx.db, sys, "service", { and: [{ f: "on_status_page", op: "eq", v: true }, { f: "state", op: "in", v: FOLLOWED }] }, { order: "t.name", limit: 300 });
  const nodes = new Map<string, string>();
  const nodeIds = [...new Set(services.map((s) => s.portfolio_node_id).filter(isUuid))];
  if (nodeIds.length) for (const n of await liveRows(ctx.db, sys, "portfolio_node", { f: "id", op: "in", v: nodeIds })) nodes.set(String(n.id), String(n.name));
  const now = Date.now();
  const since = new Date(now - days * 86_400_000).toISOString();
  const history = await statusHistory(ctx.db, sys, services.map((s) => String(s.id)), since);
  const tz = String(ctx.org.settings?.timezone ?? "Asia/Tehran");
  let mine = new Set<string>();
  if (opts.forUser) {
    const subs = await liveRows(ctx.db, sys, "service_subscription", { and: [{ f: "user_id", op: "eq", v: opts.forUser }, { f: "service_id", op: "in", v: services.map((s) => s.id) }] }, { limit: 1000 });
    mine = new Set(subs.map((s) => String(s.service_id)));
  }
  const rows: StatusPageService[] = services.map((s) => {
    const status = (s.status in STATUS_RANK ? s.status : "operational") as ServiceStatus;
    const { bars, availability } = dailyBars(status, history.get(String(s.id)) ?? [], days, now, tz, s.live_at ?? s.created_at ?? null);
    return {
      id: String(s.id), number: s.number ?? null, name: String(s.name), status, since: s.status_since ?? null, note: s.status_note ?? null, bars, availability,
      tier: s.tier ?? null, group: isUuid(s.portfolio_node_id) ? nodes.get(s.portfolio_node_id) ?? null : null, ...(opts.forUser ? { subscribed: mine.has(String(s.id)) } : {}),
    };
  });
  rows.sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status] || (a.group ?? "").localeCompare(b.group ?? "", "fa") || a.name.localeCompare(b.name, "fa"));
  return { title: cfg.status_page_title, overall: overallOf(rows.map((r) => r.status)), services: rows, days, updated_at: new Date().toISOString() };
}

/** The organisation a public status link opens (the link's key on the settings row, the public page switched on). */
export async function orgOfStatusToken(q: Queryable, token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{24,80}$/.test(token)) return null;
  const rows = await q.query<{ org_id: string }>(
    `select org_id from sm_service_configs where status_page_token = $1 and status_page_public = true and deleted_at is null limit 1`,
    [token],
  ).catch(() => [] as { org_id: string }[]);
  return rows[0]?.org_id ?? null;
}

/** The public projection: no ids of records, no subscriptions, no numbers. */
export function publicView(p: StatusPage): StatusPage {
  return { ...p, services: p.services.map((s) => ({ ...s, id: s.id.slice(-8), number: null, subscribed: undefined })) };
}

/** Tell a service's subscribers that it is being phased out or was retired (SPF-002), on their subscriptions. */
export async function notifyLifecycle(tx: Tx, ctx: Ctx, service: Row, to: "deprecated" | "retired"): Promise<number> {
  const subject = to === "deprecated" ? `خدمت «${service.name}» رو به کنارگذاری است` : `خدمت «${service.name}» کنار گذاشته شد`;
  const body = [
    to === "deprecated" ? `خدمت «${service.name}» به‌تدریج کنار گذاشته می‌شود و مشترک تازه نمی‌پذیرد.` : `خدمت «${service.name}» دیگر ارائه نمی‌شود.`,
    service.retire_reason ? `توضیح: ${service.retire_reason}` : "",
  ].filter(Boolean).join("\n\n");
  let n = 0;
  for (const { sub, users } of await subscribersOf(tx, ctx, String(service.id))) {
    if (!users.length) continue;
    n += await notifyPeople(tx, ctx.org.id, { table: "service_subscription", id: String(sub.id), users, subject, body, label: "کنارگذاری خدمت", source: "سبد خدمات", channels: ["in_app", "email"], mandatory: true });
  }
  return n;
}
