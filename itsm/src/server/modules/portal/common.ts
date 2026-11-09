// Helpers of the portal module: reads through the access rule (the incident module's `liveRows`/`liveRow`, safe with a
// member's context), who manages what, the tables that make up «درخواست‌های من», and the portal's event stream
// (sm_portal_events, migration 0067 — best effort: a failure never fails the request that caused it).
import { uuidv7 } from "@shared/id";
import { grantIn, type FullGrant } from "@shared/access/model";
import { searchForm } from "@shared/ai/text";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { prepareSubject, subjectOf } from "../../access";
import type { Subject } from "@shared/access/evaluate";

export { sysOf, liveRows, liveRow, countRows, eqAll, isUuid, type Row } from "../incident/common";

export const DAY_MS = 86_400_000;

/** The caller's access subject, loaded once per request (the engine loads it too, in orgSchema). */
export async function subjectFor(ctx: Ctx): Promise<Subject> {
  await prepareSubject(ctx);
  return subjectOf(ctx);
}

const ALL: FullGrant = { read: "all", create: true, write: "all", delete: "all", approve: true, admin: true };

/** The caller's effective grant in an area (the system: everything). */
export async function grantOf(ctx: Ctx, area: string): Promise<FullGrant> {
  if (ctx.actor === "system") return ALL;
  return grantIn((await subjectFor(ctx)).eff, area);
}

/** Changes the portal's look, home page, quick links and topics: the catalogue's administrators. */
export const managesPortal = async (ctx: Ctx): Promise<boolean> => ctx.actor === "system" || (await grantOf(ctx, "catalog")).admin;

/** Designs and sends surveys, reads every result: write access to every survey record. */
export const managesSurveys = async (ctx: Ctx): Promise<boolean> => ctx.actor === "system" || (await grantOf(ctx, "survey")).write === "all";

/** Sets up messaging connectors and the website widget. */
export async function managesChannels(ctx: Ctx): Promise<boolean> {
  if (ctx.actor === "system") return true;
  const g = await grantOf(ctx, "integrations");
  return g.write === "all" || g.admin;
}

/** Publishes knowledge without sign-in: the knowledge area's approvers and administrators. */
export async function publishesKnowledge(ctx: Ctx): Promise<boolean> {
  if (ctx.actor === "system") return true;
  const g = await grantOf(ctx, "knowledge");
  return g.approve || g.admin;
}

/** Reads the portal's analytics (searches people typed, conversations): the catalogue's administrators and the reports' writers. */
export const readsPortalAnalytics = async (ctx: Ctx): Promise<boolean> => (await managesPortal(ctx)) || (await grantOf(ctx, "reports")).write === "all";

// ---------------------------------------------------------------------------------------------------------------
// «درخواست‌های من» across departments (PTL-010)

export interface PortalItemTable {
  table: string;
  /** what people call one: «گزارش مشکل»، «درخواست»… */
  kind_label: string;
  /** the record's title field (default short_description) */
  title?: string;
  /** a field that says the record waits on its requester (a hold reason, a flag) */
  waits?: string;
}

const ITEM_TABLES: PortalItemTable[] = [
  { table: "incident", kind_label: "گزارش مشکل", waits: "hold_reason" },
  { table: "request_item", kind_label: "درخواست", waits: "info_requested" },
  { table: "portal_feedback", kind_label: "بازخورد" },
  { table: "interaction", kind_label: "گفتگو با میز خدمت" },
];

/** Another module's requester-facing table in «درخواست‌های من» (an HR case, a facilities request…). */
export function registerPortalItems(t: PortalItemTable): () => void {
  const i = ITEM_TABLES.findIndex((x) => x.table === t.table);
  if (i >= 0) ITEM_TABLES.splice(i, 1, t);
  else ITEM_TABLES.push(t);
  return () => {
    const at = ITEM_TABLES.indexOf(t);
    if (at >= 0) ITEM_TABLES.splice(at, 1);
  };
}

export const portalItemTables = (): readonly PortalItemTable[] => ITEM_TABLES;
export const portalItemTable = (table: string): PortalItemTable | undefined => ITEM_TABLES.find((t) => t.table === table);

// ---------------------------------------------------------------------------------------------------------------
// The event stream

export type PortalEventKind =
  | "search" | "click" | "answer" | "deflect" | "order" | "report" | "home" | "feedback"
  | "widget_search" | "public_view" | "public_search" | "public_vote" | "survey";

export interface PortalEventInput {
  kind: PortalEventKind;
  channel?: "portal" | "widget" | "public" | "messenger" | null;
  query?: string | null;
  results?: number | null;
  value?: number | null;
  ref_table?: string | null;
  ref_id?: string | null;
  session_id?: string | null;
  data?: Record<string, unknown> | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v.toLowerCase() : null);

/** Append an event of an organisation (best effort). `user` null: a guest or the system. */
export async function logPortalEvent(q: Queryable, orgId: string, user: string | null, e: PortalEventInput, log?: { warn?: (m: string, d?: unknown) => void }): Promise<void> {
  try {
    await q.query(
      `insert into sm_portal_events (id, org_id, kind, user_id, session_id, channel, query, results, value, ref_table, ref_id, data)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        uuidv7(), orgId, e.kind, uuidOrNull(user), e.session_id ? String(e.session_id).slice(0, 80) : null, e.channel ?? "portal",
        e.query ? searchForm(e.query).slice(0, 300) : null, e.results ?? null, e.value ?? null, e.ref_table ? String(e.ref_table).slice(0, 60) : null, uuidOrNull(e.ref_id),
        e.data ? JSON.stringify(e.data) : null,
      ],
    );
  } catch (err) {
    log?.warn?.("portal event not written", { err: String(err) });
  }
}

/** The caller's event (the member, or nobody for the system). */
export const logEvent = (q: Queryable, ctx: Ctx, e: PortalEventInput): Promise<void> => logPortalEvent(q, ctx.org.id, ctx.actor === "system" ? null : ctx.user.id, e, ctx.cfg.log);

/** An ISO string of a date-time value (rows carry strings or Dates). */
export const isoOf = (v: unknown): string | null => (typeof v === "string" ? v : v instanceof Date ? v.toISOString() : null);

/** Persian list «الف، ب و ج». */
export function faJoin(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join("، ")} و ${xs[xs.length - 1]}`;
}
