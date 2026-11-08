// Who has which service (catalogue SPF-012/013/014) and the service picker of other modules (SPF-010):
//   · `myServices`: the services a member has — subscriptions (their own, their groups', their unit's, their
//     location's), the agreements of their unit and offerings open to them — as a projection a requester may see
//     (name, status, message, the offerings open to them), even when the service record itself is the owners'
//   · `entitledOfferings`: the live offerings a member may consume (an offering open to everyone, or naming their unit,
//     a group of theirs or their location; or covered by an agreement of their unit) — the request catalogue filters
//     its items with it
//   · `servicePicker`: services and offerings for the «خدمت» fields of incidents, problems and changes, the ones a
//     record's CIs reach first («خدمت‌های متأثر» derived from the CMDB, editable)
import type { MyService, ServicePickerHit } from "@shared/service_portfolio/api";
import { todayISO } from "@shared/jalali";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { list } from "../../engine";
import { servicesImpactedBy } from "../cmdb/impact";
import { CATALOGUE_STATES, isUuid, liveRows, memberAnchors, subscriptionLive, sysOf, type Row } from "./common";

/** Is a (live) offering open to a member with these anchors? */
export function offeringOpenTo(o: Row, a: { groups: string[]; unit: string | null; location: string | null }): boolean {
  if (o.entitled_everyone !== false) return true;
  const has = (xs: unknown, v: string | null) => !!v && Array.isArray(xs) && xs.includes(v);
  return has(o.entitled_units, a.unit) || has(o.entitled_locations, a.location) || (Array.isArray(o.entitled_groups) && o.entitled_groups.some((g: string) => a.groups.includes(g)));
}

/** The live offerings a member may consume, and the agreements that cover them. */
export async function entitledOfferings(ctx: Ctx, userId: string, q: Queryable = ctx.db): Promise<{ offerings: Row[]; agreements: Row[] }> {
  const sys = sysOf(ctx);
  const a = await memberAnchors(q, ctx, userId);
  const offerings = await liveRows(q, sys, "service_offering", { f: "state", op: "eq", v: "active" }, { order: "t.name", limit: 5000 });
  const today = todayISO(String(ctx.org.settings?.timezone ?? "Asia/Tehran"));
  const agreements = a.unit
    ? (await liveRows(q, sys, "service_agreement", { and: [{ f: "customer_unit_id", op: "eq", v: a.unit }, { f: "status", op: "eq", v: "active" }] }, { limit: 500 })).filter((g) => (!g.valid_from || g.valid_from <= today) && (!g.valid_to || g.valid_to >= today))
    : [];
  const covered = new Set<string>();
  for (const g of agreements) {
    const listed = Array.isArray(g.offerings) ? g.offerings.filter(isUuid) : [];
    if (listed.length) for (const o of listed) covered.add(o);
    else for (const o of offerings) if (o.service_id === g.service_id) covered.add(String(o.id));
  }
  return { offerings: offerings.filter((o) => covered.has(String(o.id)) || offeringOpenTo(o, a)), agreements };
}

/** «خدمت‌های من» of a member (a projection; see the file comment). */
export async function myServices(ctx: Ctx, userId: string): Promise<MyService[]> {
  const sys = sysOf(ctx);
  const a = await memberAnchors(ctx.db, ctx, userId);
  const today = todayISO(String(ctx.org.settings?.timezone ?? "Asia/Tehran"));
  const or: Row[] = [{ f: "user_id", op: "eq", v: userId }];
  if (a.groups.length) or.push({ f: "group_id", op: "in", v: a.groups });
  if (a.unit) or.push({ f: "org_unit_id", op: "eq", v: a.unit });
  if (a.location) or.push({ f: "location_id", op: "eq", v: a.location });
  const subs = (await liveRows(ctx.db, sys, "service_subscription", { or } as never, { limit: 2000 })).filter((s) => subscriptionLive(s, today));
  const { offerings, agreements } = await entitledOfferings(ctx, userId);
  const via = new Map<string, Set<MyService["via"][number]>>();
  const subOf = new Map<string, string>();
  const add = (sid: unknown, v: MyService["via"][number]) => {
    if (!isUuid(sid)) return;
    if (!via.has(sid)) via.set(sid, new Set());
    via.get(sid)!.add(v);
  };
  for (const s of subs) {
    const kind = s.subscriber_kind === "group" ? "group" : s.subscriber_kind === "unit" ? "unit" : s.subscriber_kind === "location" ? "location" : "subscription";
    add(s.service_id, kind);
    if (kind === "subscription") subOf.set(String(s.service_id), String(s.id));
  }
  for (const g of agreements) add(g.service_id, "agreement");
  // offerings restricted to the member's unit, group or location (not the ones open to everyone: those are the catalogue)
  for (const o of offerings) if (o.entitled_everyone === false) add(o.service_id, "entitlement");
  if (!via.size) return [];
  const services = await liveRows(ctx.db, sys, "service", { and: [{ f: "id", op: "in", v: [...via.keys()] }, { f: "state", op: "in", v: CATALOGUE_STATES }] }, { order: "t.name", limit: 500 });
  return services.map((s) => ({
    id: String(s.id), number: s.number ?? null, name: String(s.name), status: String(s.status ?? "operational"), note: s.status_note ?? null,
    via: [...(via.get(String(s.id)) ?? [])],
    offerings: offerings.filter((o) => o.service_id === s.id).map((o) => ({ id: String(o.id), name: String(o.name), level: o.level ?? null })),
    subscription_id: subOf.get(String(s.id)) ?? null,
  }));
}

/**
 * Services and offerings for a picker: what the caller may read matching `q`, the services `ci_ids` reach first
 * (marked `derived`), offerings of `service_id` only when given.
 */
export async function servicePicker(ctx: Ctx, opts: { q?: string; ci_ids?: string[]; service_id?: string | null; kind?: "service" | "offering"; limit?: number }): Promise<ServicePickerHit[]> {
  const size = Math.min(50, Math.max(1, opts.limit ?? 20));
  const out: ServicePickerHit[] = [];
  const seen = new Set<string>();
  const kind = opts.kind ?? "service";
  if (kind === "service") {
    if (opts.ci_ids?.length) {
      const reached = await servicesImpactedBy(ctx.db, ctx, opts.ci_ids.filter(isUuid).slice(0, 20));
      if (reached.length) {
        for (const s of await liveRows(ctx.db, ctx, "service", { f: "id", op: "in", v: reached }, { order: "t.name", limit: size })) {
          seen.add(String(s.id));
          out.push({ id: String(s.id), number: s.number ?? null, name: String(s.name), kind: "service", state: s.state ?? null, status: s.status ?? null, tier: s.tier ?? null, ci_id: s.ci_id ?? null, derived: true });
        }
      }
    }
    const r = await list(ctx, "service", { q: opts.q?.trim() || undefined, size: size + seen.size, fields: ["number", "name", "state", "status", "tier", "ci_id"], total: false, sort: "name" });
    for (const s of r.rows) {
      if (seen.has(String(s.id)) || out.length >= size) continue;
      out.push({ id: String(s.id), number: (s.number as string) ?? null, name: String(s.name ?? ""), kind: "service", state: (s.state as string) ?? null, status: (s.status as string) ?? null, tier: (s.tier as string) ?? null, ci_id: (s.ci_id as string) ?? null });
    }
    return out;
  }
  const where = isUuid(opts.service_id) ? { f: "service_id", op: "eq", v: opts.service_id } : null;
  const r = await list(ctx, "service_offering", { q: opts.q?.trim() || undefined, size, fields: ["number", "name", "state", "service_id", "ci_id"], total: false, sort: "name", ...(where ? { filter: where as never } : {}) });
  return r.rows.map((o) => ({ id: String(o.id), number: (o.number as string) ?? null, name: String(o.name ?? ""), kind: "offering" as const, service_id: (o.service_id as string) ?? null, state: (o.state as string) ?? null, status: null, tier: null, ci_id: (o.ci_id as string) ?? null }));
}
