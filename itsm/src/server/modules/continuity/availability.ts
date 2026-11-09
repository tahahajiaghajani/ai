// Service availability (catalogue CON-002/004): per service and Jalali month, quarter or year — availability % on the
// service's agreed hours (its working calendar with the official holidays; none = 24 × 7), downtime against the
// target's budget, failures, MTBF, MTRS, MTBSI — computed from the outage register with system rights (a figure is
// the same for everyone), for the services the caller may read. The outages listed in a drill-down are only those
// the caller may read.
import { availabilityOf, periodOf, type Availability, type PeriodUnit } from "@shared/continuity/logic";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { defFor, list } from "../../engine";
import { access } from "../../access/provider";
import { forbidden, notFound } from "../../http/errors";
import { calendarFor } from "../sla";
import { continuityConfig, isUuid, liveRows, orgTz, sysOf, type Row } from "./common";

export interface ServiceAvailability extends Availability {
  id: string;
  number: string | null;
  name: string;
  tier: string | null;
  outages: number;
}

export interface AvailabilityReport {
  period: { unit: PeriodUnit; offset: number; label: string; from: string; to: string };
  services: ServiceAvailability[];
  totals: { services: number; with_target: number; meeting: number; average: number | null; downtime_ms: number; failures: number };
}

const SERVICE_FIELDS = ["number", "name", "tier", "availability_target", "calendar_id", "state", "status"];

/**
 * Availability is for continuity readers and for those who look after services (create in area `service`: portfolio
 * managers and owners) — not for everyone who may browse the catalogue.
 */
async function needServices(ctx: Ctx) {
  const { def } = await defFor(ctx, "service");
  if (!access().canReadTable(ctx, def)) throw forbidden("به خدمت‌ها دسترسی ندارید");
  const outage = (await defFor(ctx, "outage")).def;
  if (!access().canReadTable(ctx, outage) && !access().canCreate(ctx, def, null)) throw forbidden("دسترس‌پذیری خدمت‌ها برای تیم تداوم و مالکان خدمت است");
}

/** Outages of the services overlapping [from, to) (system rights). */
async function outagesOf(q: Queryable, sys: Ctx, serviceIds: string[], from: number, to: number): Promise<Row[]> {
  if (!serviceIds.length) return [];
  return liveRows(q, sys, "outage", {
    and: [
      { f: "service_id", op: "in", v: serviceIds },
      { f: "begin_at", op: "lt", v: new Date(to).toISOString() },
      { or: [{ f: "end_at", op: "empty" }, { f: "end_at", op: "gt", v: new Date(from).toISOString() }] },
    ],
  }, { order: "t.begin_at", limit: 20_000 });
}

/** Availability of one service over [from, to). */
export async function availabilityFor(q: Queryable, ctx: Ctx, service: Row, outages: Row[], from: number, to: number, now = Date.now()): Promise<Availability> {
  const cfg = await continuityConfig(q, sysOf(ctx));
  const cal = isUuid(service.calendar_id) ? await calendarFor(q, sysOf(ctx), service.calendar_id) : null;
  const target = service.availability_target !== null && service.availability_target !== undefined && service.availability_target !== "" ? Number(service.availability_target) : null;
  return availabilityOf({ outages: outages as never, from, to, now, cal, excludePlanned: cfg.exclude_planned, degradationWeight: cfg.degradation_weight, target });
}

/** The availability report of every service the caller may read, for one period. */
export async function availabilityReport(ctx: Ctx, unit: PeriodUnit, offset: number, now = Date.now()): Promise<AvailabilityReport> {
  await needServices(ctx);
  const tz = orgTz(ctx);
  const period = periodOf(unit, offset, now, tz);
  const res = await list(ctx, "service", { filter: { f: "state", op: "in", v: ["transition", "live", "deprecated"] } as never, size: 500, sort: "name", fields: SERVICE_FIELDS, total: false });
  const outages = await outagesOf(ctx.db, sysOf(ctx), res.rows.map((s) => String(s.id)), period.from, period.to);
  const services: ServiceAvailability[] = [];
  for (const s of res.rows) {
    const mine = outages.filter((o) => o.service_id === s.id);
    const a = await availabilityFor(ctx.db, ctx, s, mine, period.from, period.to, now);
    services.push({ ...a, id: String(s.id), number: s.number ?? null, name: String(s.name ?? ""), tier: s.tier ?? null, outages: mine.length });
  }
  services.sort((a, b) => (a.met === false ? 0 : 1) - (b.met === false ? 0 : 1) || (a.availability ?? 100) - (b.availability ?? 100) || a.name.localeCompare(b.name, "fa"));
  const withTarget = services.filter((s) => s.target !== null && s.availability !== null);
  const avail = services.filter((s) => s.availability !== null).map((s) => s.availability!);
  return {
    period: { unit, offset, label: period.label, from: new Date(period.from).toISOString(), to: new Date(period.to).toISOString() },
    services,
    totals: {
      services: services.length,
      with_target: withTarget.length,
      meeting: withTarget.filter((s) => s.met).length,
      average: avail.length ? Math.round((avail.reduce((a, b) => a + b, 0) / avail.length) * 1000) / 1000 : null,
      downtime_ms: services.reduce((a, s) => a + s.downtime_ms, 0),
      failures: services.reduce((a, s) => a + s.failures, 0),
    },
  };
}

export interface ServiceTrend {
  service: { id: string; number: string | null; name: string; target: number | null };
  periods: (Availability & { label: string; key: string })[];
  outages: Row[];
  display: Record<string, string>;
}

/** One service over the last `count` periods, with the outages of the latest ones the caller may read. */
export async function serviceTrend(ctx: Ctx, serviceId: string, unit: PeriodUnit, count = 12, now = Date.now()): Promise<ServiceTrend> {
  if (!isUuid(serviceId)) throw notFound("خدمت پیدا نشد");
  await needServices(ctx);
  const svc = (await list(ctx, "service", { ids: [serviceId], size: 1, fields: SERVICE_FIELDS, total: false })).rows[0];
  if (!svc) throw notFound("خدمت پیدا نشد");
  const tz = orgTz(ctx);
  const n = Math.max(1, Math.min(24, count));
  const first = periodOf(unit, -(n - 1), now, tz);
  const all = await outagesOf(ctx.db, sysOf(ctx), [serviceId], first.from, now + 1);
  const periods: ServiceTrend["periods"] = [];
  for (let i = n - 1; i >= 0; i--) {
    const p = periodOf(unit, -i, now, tz);
    const a = await availabilityFor(ctx.db, ctx, svc, all.filter((o) => Date.parse(String(o.begin_at)) < p.to && (!o.end_at || Date.parse(String(o.end_at)) > p.from)), p.from, p.to, now);
    periods.push({ ...a, label: p.label, key: p.key });
  }
  const outageDef = (await defFor(ctx, "outage")).def;
  const readable = access().canReadTable(ctx, outageDef)
    ? await list(ctx, "outage", { filter: { f: "service_id", op: "eq", v: serviceId } as never, sort: "-begin_at", size: 50, fields: ["number", "title", "outage_type", "state", "begin_at", "end_at", "duration", "cause", "impact_pct", "incident_id"], total: false })
    : { rows: [] as Row[], display: {} as Record<string, string> };
  const target = svc.availability_target !== null && svc.availability_target !== undefined && svc.availability_target !== "" ? Number(svc.availability_target) : null;
  return { service: { id: serviceId, number: svc.number ?? null, name: String(svc.name ?? ""), target }, periods, outages: readable.rows, display: readable.display };
}
