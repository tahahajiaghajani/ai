// Who may order what, and for whom (REQ-013, REQ-014, REQ-019). Audiences are matched against a member's facts —
// their groups, unit and the units above it, location and the locations above it, roles, persona and VIP status
// (from the access model's subject and their profile) — and an audience's profile condition is evaluated in SQL on
// `member_profile`. The catalogue, every category on the way down and the item must each allow the person the item
// is for; the check runs when the catalogue is listed and again when an order is placed, in every channel.
// Ordering for someone else follows the item's «سفارش برای دیگران»; members who may change others' requests (agents)
// order for anyone. An item bound to a service offering (catalog_item.offering_id) is also for the people the
// service portfolio entitles to that offering (SPF-011, SPF-014: `registerOfferingEntitlement`), and each requested
// item keeps a snapshot of that entitlement (`offeringSnapshot`).
import { allows, audienceOf, entitled, pathUp, type AudienceDef, type Bindings, type MemberFacts } from "@shared/request/audience";
import type { ItemSettings } from "@shared/request/form";
import { grantIn } from "@shared/access";
import type { Cond } from "@shared/model/conditions";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { memberCtx, prepareSubject, subjectOf } from "../../access";
import { eqAll, liveRow, liveRows, sysOf, type Row } from "./common";

// ---------------------------------------------------------------------------------------------------------------
// Service offerings (the service portfolio plugs in its `entitledOfferings`)

export type OfferingSource = (q: Queryable, ctx: Ctx, userId: string) => Promise<{ offerings: Row[]; agreements: Row[] }>;
let offeringSource: OfferingSource | null = null;

/** The service portfolio's entitlement of members to offerings (a later registration replaces the earlier one). */
export function registerOfferingEntitlement(fn: OfferingSource): () => void {
  offeringSource = fn;
  return () => {
    if (offeringSource === fn) offeringSource = null;
  };
}

const offeringCache = new WeakMap<Ctx, Map<string, Promise<{ offerings: Row[]; agreements: Row[] }>>>();
function offeringsOf(q: Queryable, ctx: Ctx, userId: string): Promise<{ offerings: Row[]; agreements: Row[] }> {
  let m = offeringCache.get(ctx);
  if (!m) offeringCache.set(ctx, (m = new Map()));
  let p = m.get(userId);
  if (!p) m.set(userId, (p = offeringSource!(q, ctx, userId)));
  return p;
}

/** Is `userId` entitled to the offering (true without a portfolio, or when the item names none)? */
async function offeringAllowed(q: Queryable, ctx: Ctx, userId: string, offeringId: unknown): Promise<boolean> {
  if (!offeringSource || typeof offeringId !== "string" || !offeringId) return true;
  const { offerings } = await offeringsOf(q, ctx, userId);
  return offerings.some((o) => String(o.id) === offeringId);
}

/**
 * What entitled `userId` to an offering when they ordered (SPF-014), kept on the requested item: the offering and its
 * service, whether they were entitled, and how — the customer agreements of their unit that cover it, or the
 * offering being open to them. Null without a portfolio.
 */
export async function offeringSnapshot(q: Queryable, ctx: Ctx, userId: string, offeringId: string): Promise<Row | null> {
  if (!offeringSource) return null;
  const { offerings, agreements } = await offeringsOf(q, ctx, userId);
  const o = offerings.find((x) => String(x.id) === offeringId);
  const offering = o ?? (await liveRow(q, sysOf(ctx), "service_offering", offeringId));
  const covering = agreements.filter((g) => {
    const listed = Array.isArray(g.offerings) ? g.offerings.map(String) : [];
    return listed.length ? listed.includes(offeringId) : !!offering && g.service_id === offering.service_id;
  });
  return {
    offering_id: offeringId,
    offering: offering?.name ?? null,
    service_id: offering?.service_id ?? null,
    entitled: !!o,
    basis: !o ? "none" : covering.length ? "agreement" : "open",
    agreements: covering.map((g) => ({ id: String(g.id), name: g.name ?? null, number: g.number ?? null })),
    checked_at: new Date().toISOString(),
  };
}

const factsCache = new WeakMap<Ctx, Map<string, Promise<MemberFacts | null>>>();

/** A member's facts for audiences (null when they are not an active member of the organisation). */
export function memberFacts(q: Queryable, ctx: Ctx, userId: string): Promise<MemberFacts | null> {
  let m = factsCache.get(ctx);
  if (!m) factsCache.set(ctx, (m = new Map()));
  let p = m.get(userId);
  if (!p) {
    p = loadFacts(q, ctx, userId);
    m.set(userId, p);
  }
  return p;
}

async function loadFacts(q: Queryable, ctx: Ctx, userId: string): Promise<MemberFacts | null> {
  let s;
  try {
    s = subjectOf(await memberCtx(ctx.cfg, ctx.org.id, userId, q));
  } catch {
    return null;
  }
  const sys = sysOf(ctx);
  const [profile] = await liveRows(q, sys, "member_profile", eqAll({ user_id: userId }), { limit: 1 });
  const unit = s.unitId ? await liveRow(q, sys, "org_unit", s.unitId) : null;
  const locationId = (profile?.location_id as string | null) ?? null;
  const location = locationId ? await liveRow(q, sys, "location", locationId) : null;
  return {
    userId,
    groups: s.groups,
    unitPath: s.unitId ? pathUp(unit?.path, s.unitId) : [],
    locationPath: locationId ? pathUp(location?.path, locationId) : [],
    roles: s.eff.roles ?? [],
    persona: (profile?.persona as string | null) ?? null,
    vip: profile?.vip === true,
  };
}

/** The catalogue's structure an entitlement check walks: catalogues, categories and audiences by id. */
export interface CatalogIndex {
  catalogs: Map<string, Row>;
  categories: Map<string, Row>;
  audiences: Map<string, AudienceDef>;
}

const indexCache = new WeakMap<Ctx, Promise<CatalogIndex>>();

/** Every catalogue, category and audience of the organisation (read once per request). */
export function catalogIndex(q: Queryable, ctx: Ctx): Promise<CatalogIndex> {
  let p = indexCache.get(ctx);
  if (!p) {
    p = (async () => {
      const sys = sysOf(ctx);
      const [catalogs, categories, audiences] = await Promise.all([
        liveRows(q, sys, "catalog", null, { order: "t.sort_order, t.name" }),
        liveRows(q, sys, "catalog_category", null, { order: "t.sort_order, t.name" }),
        liveRows(q, sys, "catalog_audience", null, { order: "t.name" }),
      ]);
      return {
        catalogs: new Map(catalogs.map((r) => [String(r.id), r])),
        categories: new Map(categories.map((r) => [String(r.id), r])),
        audiences: new Map(audiences.map((r) => [String(r.id), audienceOf(r)])),
      };
    })();
    indexCache.set(ctx, p);
  }
  return p;
}

/** The categories from the top of the tree down to `categoryId` (cycles cut). */
export function categoryChain(index: CatalogIndex, categoryId: string | null | undefined): Row[] {
  const out: Row[] = [];
  const seen = new Set<string>();
  let id = categoryId ?? null;
  while (id && !seen.has(id)) {
    seen.add(id);
    const c = index.categories.get(id);
    if (!c) break;
    out.unshift(c);
    id = (c.parent_id as string | null) ?? null;
  }
  return out;
}

/** Evaluates audiences' profile conditions for one member (one query per audience, cached per request). */
function conditionOf(q: Queryable, ctx: Ctx, userId: string): { prepare(ids: Iterable<AudienceDef>): Promise<void>; test(a: AudienceDef): boolean } {
  const done = new Map<string, boolean>();
  return {
    async prepare(list) {
      for (const a of list) {
        if (done.has(a.id) || !a.condition || typeof a.condition !== "object" || !Object.keys(a.condition as object).length) continue;
        let ok = false;
        try {
          ok = (await liveRows(q, sysOf(ctx), "member_profile", { and: [{ f: "user_id", op: "eq", v: userId }, a.condition as Cond] }, { limit: 1 })).length > 0;
        } catch {
          ok = false;
        }
        done.set(a.id, ok);
      }
    },
    test: (a) => done.get(a.id) ?? false,
  };
}

/** The levels (catalogue → categories → item) whose audiences decide whether `item` may be ordered. */
export function levelsOf(index: CatalogIndex, item: Row): Bindings[] {
  const levels: Bindings[] = [];
  const catalog = item.catalog_id ? index.catalogs.get(String(item.catalog_id)) : undefined;
  if (catalog) levels.push(catalog);
  levels.push(...categoryChain(index, item.category_id as string | null));
  levels.push(item);
  return levels;
}

export interface Entitlement {
  /** may `userId` see and order these items? */
  check(items: readonly Row[]): Promise<Map<string, boolean>>;
  /** do the catalogue and the category allow the member (for listing them)? */
  allowsLevel(row: Bindings): boolean;
  facts: MemberFacts | null;
}

/** An entitlement checker for one member (the person the order is for). */
export async function entitlementFor(q: Queryable, ctx: Ctx, userId: string): Promise<Entitlement> {
  const index = await catalogIndex(q, ctx);
  const facts = await memberFacts(q, ctx, userId);
  const cond = conditionOf(q, ctx, userId);
  // audience conditions are evaluated up front (the pure checks are synchronous)
  await cond.prepare(index.audiences.values());
  return {
    facts,
    allowsLevel: (row) => !!facts && allows(row, index.audiences, facts, cond.test),
    async check(items) {
      const out = new Map<string, boolean>();
      for (const it of items) {
        const catalog = it.catalog_id ? index.catalogs.get(String(it.catalog_id)) : undefined;
        const inactive = !catalog || catalog.active === false || categoryChain(index, it.category_id).some((c) => c.active === false);
        const ok = !!facts && !inactive && entitled(levelsOf(index, it), index.audiences, facts, cond.test);
        // an item bound to a service offering: only for the people the portfolio entitles to it
        out.set(String(it.id), ok && (await offeringAllowed(q, ctx, userId, it.offering_id)));
      }
      return out;
    },
  };
}

/** May `userId` order `item` (as stored now)? */
export async function canOrder(q: Queryable, ctx: Ctx, item: Row, userId: string): Promise<boolean> {
  const e = await entitlementFor(q, ctx, userId);
  return (await e.check([item])).get(String(item.id)) === true;
}

const AGENT_SCOPES = new Set(["group", "unit", "unit_tree", "domain", "all"]);

/** Why the caller may not order `item` for `forUser` (null when they may). */
export async function onBehalfRefusal(q: Queryable, ctx: Ctx, item: Pick<ItemSettings, "on_behalf">, forUser: string): Promise<string | null> {
  if (ctx.actor === "system" || forUser === ctx.user.id) return null;
  await prepareSubject(ctx, q);
  const s = subjectOf(ctx);
  if (AGENT_SCOPES.has(grantIn(s.eff, "request").write)) return null;
  switch (item.on_behalf ?? "anyone") {
    case "anyone":
      return null;
    case "reportees":
      return s.reportees.includes(forUser) ? null : "این قلم را فقط برای زیردستان خود می‌توانید سفارش دهید";
    case "unit_tree": {
      const f = await memberFacts(q, ctx, forUser);
      return f?.unitPath[0] && s.unitTree.includes(f.unitPath[0]) ? null : "این قلم را فقط برای افراد واحد خود می‌توانید سفارش دهید";
    }
    case "delegators":
      return s.delegators.includes(forUser) ? null : "این قلم را فقط برای کسانی که شما را جانشین کرده‌اند می‌توانید سفارش دهید";
    default:
      return "این قلم را فقط برای خود می‌توانید سفارش دهید";
  }
}
