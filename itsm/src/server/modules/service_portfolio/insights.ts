// What the portfolio's screens compute (catalogue SPF-016 owner scorecard, SPF-020 rationalization, SPF-039 catalogue
// health, SPF-041 portfolio reports). Every answer is built with the caller's context: services, offerings and
// linked records are the ones the caller may read (a service's owner reads its linked records through the
// participant source of roles.ts), cost only with the «مالی» field group, and counts of tables the caller may not
// read are left out and named in `hidden`.
import type { CatalogueHealth, HealthCheck, PortfolioReport, RationalizationRow, ServiceScorecard } from "@shared/service_portfolio/api";
import { SERVICE_STATES, SERVICE_TYPES } from "@shared/tables/service_portfolio";
import { CI_TIERS } from "@shared/tables/cmdb";
import { dailyBars, median, overlapPairs, quadrantOf, reviewDue, serviceValue, type ServiceStatus } from "@shared/service_portfolio/logic";
import { addDays, todayISO } from "@shared/jalali";
import { tableDef } from "@shared/tables";
import Decimal from "decimal.js";
import type { Ctx } from "../../context";
import { pgArray } from "../../db";
import { notFound } from "../../http/errors";
import { access } from "../../access/provider";
import { defFor } from "../../engine";
import { dependencyMap } from "../cmdb/graph";
import { CATALOGUE_STATES, OPEN_INCIDENT, PIPELINE_STATES, RETIRED_STATES, countRows, isUuid, liveRow, liveRows, sysOf, type Row } from "./common";
import { linkedTo, openStates } from "./score";
import { statusHistory } from "./status";

const DAY = 86_400_000;
const label = (opts: { value: string; label: string }[], v: unknown) => opts.find((o) => o.value === v)?.label ?? (v ? String(v) : "بدون مقدار");

/** Can the caller read `table` at all (and does it exist in this build)? */
async function readsTable(ctx: Ctx, table: string): Promise<boolean> {
  if (!tableDef(table)) return false;
  const { def } = await defFor(ctx, table);
  return access().canReadTable(ctx, def);
}

/** Count with the caller's rights, or null when the caller may not read the table (named in `hidden`). */
async function countIf(ctx: Ctx, table: string, where: Row, hidden: string[]): Promise<number | null> {
  if (!(await readsTable(ctx, table))) {
    if (tableDef(table)) hidden.push(tableDef(table)!.plural ?? table);
    return null;
  }
  return countRows(ctx.db, ctx, table, where as never).catch(() => null);
}

/** The service owner's scorecard of one service (SPF-016). */
export async function serviceScorecard(ctx: Ctx, id: string): Promise<ServiceScorecard> {
  const s = await liveRow(ctx.db, ctx, "service", id);
  if (!s) throw notFound("خدمت پیدا نشد یا به آن دسترسی ندارید");
  const sys = sysOf(ctx);
  const hidden: string[] = [];
  const since30 = new Date(Date.now() - 30 * DAY).toISOString();
  const ids = [String(s.id)];
  const openIncidents = (await countIf(ctx, "incident", linkedTo(ids, [OPEN_INCIDENT]), hidden)) ?? 0;
  const major = (await countIf(ctx, "incident", linkedTo(ids, [OPEN_INCIDENT, { f: "major_state", op: "eq", v: "accepted" }]), [])) ?? 0;
  const incidents30 = (await countIf(ctx, "incident", linkedTo(ids, [{ f: "opened_at", op: "gte", v: since30 }]), [])) ?? 0;
  const problemOpen = openStates("problem");
  const openProblems = problemOpen ? (await countIf(ctx, "problem", linkedTo(ids, [{ f: "state", op: "in", v: problemOpen }]), hidden)) ?? 0 : 0;
  const changeOpen = openStates("change_request");
  const upcoming = changeOpen ? await countIf(ctx, "change_request", linkedTo(ids, [{ f: "state", op: "in", v: changeOpen }]), hidden) : null;
  const offerings = await liveRows(ctx.db, ctx, "service_offering", { f: "service_id", op: "eq", v: s.id }, { order: "t.name", limit: 200 });
  const commitments = offerings.length ? await liveRows(ctx.db, ctx, "service_commitment", { and: [{ f: "offering_id", op: "in", v: offerings.map((o) => o.id) }, { f: "active", op: "eq", v: true }] }, { limit: 2000 }) : [];
  const perOffering = new Map<string, number>();
  for (const c of commitments) perOffering.set(String(c.offering_id), (perOffering.get(String(c.offering_id)) ?? 0) + 1);
  const subscribers = await countRows(ctx.db, sys, "service_subscription", { f: "service_id", op: "eq", v: s.id });
  const tz = String(ctx.org.settings?.timezone ?? "Asia/Tehran");
  const facts = await liveRows(ctx.db, sys, "service_score_fact", { and: [{ f: "service_id", op: "eq", v: s.id }, { f: "day", op: "gte", v: addDays(todayISO(tz), -30) }] }, { order: "t.day", limit: 60 });
  const history = await statusHistory(ctx.db, sys, ids, since30);
  const avail = CATALOGUE_STATES.includes(s.state) ? dailyBars(String(s.status ?? "operational") as ServiceStatus, history.get(String(s.id)) ?? [], 30, Date.now(), tz, s.live_at ?? s.created_at).availability : null;
  const ratings = facts.filter((f) => f.csat !== null && f.csat !== undefined).map((f) => Number(f.csat));
  let dependencies = 0;
  let dependents = 0;
  if (isUuid(s.ci_id)) {
    const up = await dependencyMap(ctx, { roots: [s.ci_id], direction: "dependencies", depth: 4, max_nodes: 400 }).catch(() => null);
    const down = await dependencyMap(ctx, { roots: [s.ci_id], direction: "dependents", depth: 4, max_nodes: 400 }).catch(() => null);
    dependencies = Math.max(0, (up?.nodes.length ?? 1) - 1);
    dependents = Math.max(0, (down?.nodes.length ?? 1) - 1);
  }
  const last = facts[facts.length - 1];
  const due = reviewDue(s.last_reviewed_at, s.review_months, s.live_at ?? s.created_at);
  const today = todayISO(tz);
  return {
    service: {
      id: String(s.id), number: s.number ?? null, name: String(s.name), state: String(s.state), status: String(s.status ?? "operational"), status_reason: s.status_reason ?? null,
      tier: s.tier ?? null, owner_id: s.owner_id ?? null, ci_id: s.ci_id ?? null, score: s.score ?? null,
      availability_target: s.availability_target !== null && s.availability_target !== undefined ? Number(s.availability_target) : null,
    },
    kpis: {
      open_incidents: openIncidents, major_incidents: major, incidents_30d: incidents30,
      breaches_30d: facts.reduce((a, f) => a + Number(f.breaches ?? 0), 0),
      open_problems: openProblems, upcoming_changes: upcoming, subscribers,
      offerings: offerings.length, active_offerings: offerings.filter((o) => o.state === "active").length, commitments: commitments.length,
      availability_30d: avail, csat: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 100) / 100 : null,
      dependencies, dependents,
    },
    trend: facts.map((f) => ({ day: String(f.day), score: f.score ?? null, availability: f.availability !== null && f.availability !== undefined ? Number(f.availability) : null, incidents: Number(f.incidents ?? 0) })),
    components: (last?.components as Record<string, number>) ?? null,
    offerings: offerings.map((o) => ({ id: String(o.id), number: o.number ?? null, name: String(o.name), level: o.level ?? null, state: String(o.state), commitments: perOffering.get(String(o.id)) ?? 0 })),
    hidden: [...new Set(hidden)],
    review: { last: s.last_reviewed_at ?? null, due, overdue: !!due && due < today },
  };
}

const counts = (rows: Row[], key: (r: Row) => string, lab: (k: string) => string) => {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return [...m].map(([k, count]) => ({ key: k, label: lab(k), count })).sort((a, b) => b.count - a.count);
};

/** Portfolio reports (SPF-041): counts by stage, tier, type, node and owner; time to market; completeness; cost. */
export async function portfolioReport(ctx: Ctx): Promise<PortfolioReport> {
  const services = await liveRows(ctx.db, ctx, "service", null, { limit: 5000 });
  const nodes = new Map((await liveRows(ctx.db, sysOf(ctx), "portfolio_node", null, { limit: 2000 })).map((n) => [String(n.id), String(n.name)]));
  const owners = new Map<string, string>();
  const ownerIds = [...new Set(services.map((s) => s.owner_id).filter(isUuid))];
  if (ownerIds.length) {
    const rows = await ctx.db.query<{ id: string; full_name: string }>(
      `select u.id, u.full_name from sm_org_members m join sm_users u on u.id = m.user_id where m.org_id = $1 and m.deleted_at is null and u.id = any($2::uuid[])`,
      [ctx.org.id, pgArray(ownerIds)],
    );
    for (const r of rows) owners.set(String(r.id), r.full_name);
  }
  const ttm = SERVICE_TYPES.map((t) => {
    const done = services.filter((s) => s.service_type === t.value && s.approved_at && s.live_at);
    const days = done.map((s) => (Date.parse(s.live_at) - Date.parse(s.approved_at)) / DAY).filter((d) => Number.isFinite(d) && d >= 0);
    return { type: t.value, label: t.label, days: days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null, services: days.length };
  });
  const live = services.filter((s) => CATALOGUE_STATES.includes(s.state));
  const complete = live.filter((s) => isUuid(s.owner_id) && String(s.description ?? "").trim() && String(s.outcomes ?? "").trim());
  const costVisible = access().hasFieldGroup(ctx, "financial");
  let total: Decimal | null = null;
  if (costVisible) for (const s of live) if (s.annual_cost !== null && s.annual_cost !== undefined && s.annual_cost !== "") total = (total ?? new Decimal(0)).plus(new Decimal(String(s.annual_cost)));
  return {
    total: services.length,
    by_state: counts(services, (s) => String(s.state), (k) => SERVICE_STATES.states.find((x) => x.value === k)?.label ?? k),
    by_tier: counts(services, (s) => String(s.tier ?? ""), (k) => (k ? label(CI_TIERS, k) : "بدون رده")),
    by_type: counts(services, (s) => String(s.service_type ?? ""), (k) => label(SERVICE_TYPES, k)),
    by_node: counts(services, (s) => String(s.portfolio_node_id ?? ""), (k) => (k ? nodes.get(k) ?? "شاخهٔ محدود" : "بدون شاخه")),
    by_owner: counts(services, (s) => String(s.owner_id ?? ""), (k) => (k ? owners.get(k) ?? "عضو" : "بدون مالک")).slice(0, 20),
    time_to_market: ttm,
    views: {
      pipeline: services.filter((s) => PIPELINE_STATES.includes(s.state)).length,
      catalogue: live.length,
      retired: services.filter((s) => RETIRED_STATES.includes(s.state)).length,
    },
    completeness: live.length ? Math.round((complete.length / live.length) * 100) : null,
    cost: { total: total ? total.toFixed(0) : null, visible: costVisible },
  };
}

/** Rationalization (SPF-020): value × cost quadrants, overlaps and candidates for retirement or consolidation. */
export async function rationalization(ctx: Ctx): Promise<{ rows: RationalizationRow[]; cost_visible: boolean; axis: "cost" | "load" }> {
  const services = await liveRows(ctx.db, ctx, "service", { f: "state", op: "in", v: [...CATALOGUE_STATES, "transition"] }, { order: "t.name", limit: 2000 });
  if (!services.length) return { rows: [], cost_visible: access().hasFieldGroup(ctx, "financial"), axis: "cost" };
  const sys = sysOf(ctx);
  const ids = services.map((s) => String(s.id));
  const nodes = new Map((await liveRows(ctx.db, sys, "portfolio_node", null, { limit: 2000 })).map((n) => [String(n.id), String(n.name)]));
  const subs = new Map<string, number>();
  for (const s of await liveRows(ctx.db, sys, "service_subscription", { f: "service_id", op: "in", v: ids }, { limit: 10_000 })) subs.set(String(s.service_id), (subs.get(String(s.service_id)) ?? 0) + 1);
  const since = new Date(Date.now() - 90 * DAY).toISOString();
  const incidents = new Map<string, number>();
  if (await readsTable(ctx, "incident")) {
    for (const i of await liveRows(ctx.db, ctx, "incident", linkedTo(ids, [{ f: "opened_at", op: "gte", v: since }]) as never, { limit: 10_000 })) {
      for (const sid of new Set([i.service_id, ...(Array.isArray(i.affected_services) ? i.affected_services : [])])) if (isUuid(sid)) incidents.set(sid, (incidents.get(sid) ?? 0) + 1);
    }
  }
  // requests per service, when a request table with a service field exists in this build
  let requests: Map<string, number> | null = null;
  for (const t of ["request_item", "request", "sc_req_item"]) {
    const def = tableDef(t);
    if (!def || !def.fields.some((f) => f.name === "service_id")) continue;
    if (!(await readsTable(ctx, t))) break;
    requests = new Map();
    for (const r of await liveRows(ctx.db, ctx, t, { and: [{ f: "service_id", op: "in", v: ids }, { f: "created_at", op: "gte", v: since }] }, { limit: 10_000 })) requests.set(String(r.service_id), (requests.get(String(r.service_id)) ?? 0) + 1);
    break;
  }
  const costVisible = access().hasFieldGroup(ctx, "financial");
  const maxSubs = Math.max(0, ...subs.values());
  const pairs = overlapPairs(services.map((s) => ({ id: String(s.id), name: String(s.name), tags: s.tags, node: s.portfolio_node_id ?? null })));
  const byId = new Map(services.map((s) => [String(s.id), s]));
  const values = services.map((s) => serviceValue(s.tier, subs.get(String(s.id)) ?? 0, maxSubs, s.score));
  const costs = services.map((s) => (costVisible && s.annual_cost !== null && s.annual_cost !== undefined && s.annual_cost !== "" ? Number(s.annual_cost) : NaN));
  const axis: "cost" | "load" = costs.filter((c) => Number.isFinite(c)).length >= Math.max(2, services.length / 2) ? "cost" : "load";
  const loads = services.map((s) => incidents.get(String(s.id)) ?? 0);
  const yOf = (i: number) => (axis === "cost" ? (Number.isFinite(costs[i]) ? costs[i] : 0) : loads[i]);
  const medV = median(values);
  const medY = median(services.map((_, i) => yOf(i)));
  const rows: RationalizationRow[] = services.map((s, i) => {
    const id = String(s.id);
    const quadrant = quadrantOf(values[i], yOf(i), medV, medY);
    const overlaps = pairs.filter((p) => p.a === id || p.b === id).slice(0, 5).map((p) => {
      const other = byId.get(p.a === id ? p.b : p.a)!;
      return { id: String(other.id), name: String(other.name), similarity: p.similarity };
    });
    const reasons: string[] = [];
    if (overlaps.length) reasons.push(`شبیه «${overlaps[0].name}»`);
    if (!(subs.get(id) ?? 0)) reasons.push("بدون مشترک");
    if (s.state === "deprecated") reasons.push("رو به کنارگذاری");
    if ((s.score ?? 100) < 60) reasons.push("امتیاز عملکرد پایین");
    if (requests && !(requests.get(id) ?? 0)) reasons.push("بدون درخواست در ۹۰ روز");
    return {
      id, number: s.number ?? null, name: String(s.name), state: String(s.state), tier: s.tier ?? null,
      node: isUuid(s.portfolio_node_id) ? nodes.get(s.portfolio_node_id) ?? null : null, score: s.score ?? null,
      annual_cost: costVisible && s.annual_cost !== null && s.annual_cost !== undefined ? String(s.annual_cost) : null,
      subscribers: subs.get(id) ?? 0, incidents_90d: incidents.get(id) ?? 0, requests_90d: requests ? requests.get(id) ?? 0 : null,
      value: values[i], quadrant, overlaps, reasons,
    };
  });
  return { rows, cost_visible: costVisible, axis };
}

/** Catalogue health checks and periodic review (SPF-039) over the catalogue's services the caller may read. */
export async function catalogueHealth(ctx: Ctx): Promise<CatalogueHealth> {
  const services = await liveRows(ctx.db, ctx, "service", { f: "state", op: "in", v: CATALOGUE_STATES }, { order: "t.name", limit: 5000 });
  const sys = sysOf(ctx);
  const ids = services.map((s) => String(s.id));
  const offerings = ids.length ? await liveRows(ctx.db, sys, "service_offering", { f: "service_id", op: "in", v: ids }, { limit: 10_000 }) : [];
  const active = offerings.filter((o) => o.state === "active");
  const commitments = active.length ? await liveRows(ctx.db, sys, "service_commitment", { and: [{ f: "offering_id", op: "in", v: active.map((o) => o.id) }, { f: "active", op: "eq", v: true }] }, { limit: 10_000 }) : [];
  const withCommitment = new Set(commitments.map((c) => String(c.offering_id)));
  const activeBy = new Map<string, Row[]>();
  for (const o of active) activeBy.set(String(o.service_id), [...(activeBy.get(String(o.service_id)) ?? []), o]);
  const tz = String(ctx.org.settings?.timezone ?? "Asia/Tehran");
  const today = todayISO(tz);
  const check = (key: string, labelText: string, applies: (s: Row) => boolean, ok: (s: Row) => boolean): HealthCheck => {
    const subject = services.filter(applies);
    const failing = subject.filter((s) => !ok(s));
    return { key, label: labelText, total: subject.length, passing: subject.length - failing.length, failing: failing.slice(0, 8).map((s) => ({ id: String(s.id), number: s.number ?? null, name: String(s.name) })) };
  };
  const text = (v: unknown) => !!String(v ?? "").trim();
  const due = (s: Row) => reviewDue(s.last_reviewed_at, s.review_months, s.live_at ?? s.created_at);
  const checks = [
    check("owner", "مالک خدمت مشخص است", () => true, (s) => isUuid(s.owner_id)),
    check("description", "شرح به زبان مشتری دارد", () => true, (s) => text(s.description)),
    check("outcomes", "نتایج مورد انتظار نوشته شده", () => true, (s) => text(s.outcomes)),
    check("support", "گروه پشتیبانی دارد", () => true, (s) => isUuid(s.support_group_id)),
    check("offering", "دست‌کم یک گزینهٔ فعال دارد", () => true, (s) => (activeBy.get(String(s.id)) ?? []).length > 0),
    check("commitments", "گزینه‌های فعالش تعهد دارند", (s) => (activeBy.get(String(s.id)) ?? []).length > 0, (s) => (activeBy.get(String(s.id)) ?? []).every((o) => withCommitment.has(String(o.id)))),
    check("tier", "رده و اهمیت تعیین شده", () => true, (s) => !!s.tier),
    check("reviewed", "در موعد بازبینی شده", (s) => !!due(s), (s) => (due(s) ?? "9999") >= today),
  ];
  const passed = checks.reduce((a, c) => a + c.passing, 0);
  const total = checks.reduce((a, c) => a + c.total, 0);
  const reviewList = services
    .map((s) => ({ s, d: due(s) }))
    .filter((x) => x.d && x.d <= addDays(today, 30))
    .sort((a, b) => a.d!.localeCompare(b.d!))
    .slice(0, 50)
    .map(({ s, d }) => ({ id: String(s.id), number: s.number ?? null, name: String(s.name), due: d!, overdue: d! < today, owner_id: s.owner_id ?? null }));
  return { score: total ? Math.round((passed / total) * 100) : null, checks, review_due: reviewList, computed_at: new Date().toISOString() };
}
