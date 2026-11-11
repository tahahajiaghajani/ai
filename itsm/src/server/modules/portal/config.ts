// The portal a person sees (PTL-001…004): the active `portal` rows of their workspaces, else the default one (no
// workspace), else the built-in defaults; its branding, behaviour and the published home layout (the draft in an
// administrator's preview). Publishing a layout copies the cleaned draft and moves its version (PTL-002). The logo is
// one of the portal row's own image attachments, served to every member of the organisation.
import { DEFAULT_LAYOUT, layoutProblems, normalizeLayout } from "@shared/portal/logic";
import type { PortalConfig } from "@shared/portal/api";
import type { Ctx } from "../../context";
import { createIn, readAttachment, updateIn } from "../../engine";
import { bad, forbidden, notFound } from "../../http/errors";
import { grantOf, isUuid, liveRow, liveRows, managesPortal, subjectFor, sysOf, type Row } from "./common";
import { lockedRow } from "../incident/common";
import { lockKey } from "../../db";

const DEFAULTS = {
  name: "درگاه خدمات",
  title: "چه کمکی از ما برمی‌آید؟",
  subtitle: "پرسش، درخواست یا مشکلتان را بنویسید",
  accent: "indigo",
  hero: "calm" as const,
  chat_name: "دستیار",
};

/** The active portals the caller may use, the most specific (a workspace's) first. */
export async function portalsFor(ctx: Ctx): Promise<Row[]> {
  const rows = await liveRows(ctx.db, sysOf(ctx), "portal", { f: "active", op: "eq", v: true }, { order: "t.sort_order, t.name", limit: 100 });
  if (ctx.actor === "system") return rows;
  const s = await subjectFor(ctx);
  const mine = new Set(s.workspaces);
  const secure = new Set(s.secureWorkspaces);
  const usable = rows.filter((r) => !r.workspace_id || mine.has(String(r.workspace_id)) || (s.eff.workspacesAll && !secure.has(String(r.workspace_id))));
  return [...usable.filter((r) => r.workspace_id), ...usable.filter((r) => !r.workspace_id)];
}

/** The portal row a person sees: the one asked for (when usable), the one they chose last, else the first usable. */
export async function currentPortal(ctx: Ctx, asked?: string | null): Promise<{ row: Row | null; usable: Row[] }> {
  const usable = await portalsFor(ctx);
  if (isUuid(asked)) {
    const hit = usable.find((r) => r.id === asked);
    if (hit) return { row: hit, usable };
  }
  if (ctx.actor !== "system") {
    const [pref] = await liveRows(ctx.db, sysOf(ctx), "portal_pref", { f: "user_id", op: "eq", v: ctx.user.id }, { limit: 1 });
    const chosen = pref?.portal_id ? usable.find((r) => r.id === pref.portal_id) : null;
    if (chosen) return { row: chosen, usable };
  }
  return { row: usable[0] ?? null, usable };
}

const text = (v: unknown, dflt = ""): string => (typeof v === "string" && v.trim() ? v.trim() : dflt);

/** The portal configuration the screens need (the published layout; the draft in an administrator's preview). */
export async function portalConfig(ctx: Ctx, opts: { portal?: string | null; preview?: boolean } = {}): Promise<PortalConfig> {
  const { row, usable } = await currentPortal(ctx, opts.portal);
  const admin = await managesPortal(ctx);
  const writes = await Promise.all(["incident", "request", "problem", "change", "work"].map((a) => grantOf(ctx, a)));
  const [catalog, incident, request] = await Promise.all([grantOf(ctx, "catalog"), grantOf(ctx, "incident"), grantOf(ctx, "request")]);
  const preview = !!opts.preview && admin && !!row;
  const layout = normalizeLayout(row ? (preview ? (row.layout ?? row.published_layout) : (row.published_layout ?? row.layout)) ?? DEFAULT_LAYOUT : DEFAULT_LAYOUT);
  const orgName = String(ctx.org.name ?? "");
  return {
    portal: {
      id: row ? String(row.id) : null,
      name: text(row?.name, DEFAULTS.name),
      title: text(row?.title, DEFAULTS.title),
      subtitle: text(row?.subtitle, DEFAULTS.subtitle),
      brand_name: text(row?.brand_name, orgName || DEFAULTS.name),
      accent: text(row?.accent, DEFAULTS.accent),
      hero: (["calm", "bold", "plain"].includes(String(row?.hero)) ? row!.hero : DEFAULTS.hero) as PortalConfig["portal"]["hero"],
      logo_url: row?.logo_id && isUuid(row.logo_id) ? `portal/logo/${row.id}?v=${String(row.logo_id).slice(0, 8)}` : null,
      footer: typeof row?.footer === "string" && row.footer.trim() ? row.footer : null,
      privacy_notice: typeof row?.privacy_notice === "string" && row.privacy_notice.trim() ? row.privacy_notice : null,
      chat_enabled: row ? row.chat_enabled !== false : true,
      chat_name: text(row?.chat_name, DEFAULTS.chat_name),
      ai_answers: row ? row.ai_answers !== false : true,
      report_item_id: isUuid(row?.report_item_id) ? String(row!.report_item_id) : null,
    },
    layout,
    portals: usable.map((r) => ({ id: String(r.id), name: String(r.name) })),
    preview,
    can: {
      admin,
      agent: writes.some((g) => ["group", "unit", "unit_tree", "domain", "all"].includes(g.write)),
      order: catalog.read !== "none",
      report: incident.create,
      feedback: request.create,
    },
  };
}

/** Remember the portal a person chose (their preference row, written by the module). */
export async function choosePortal(ctx: Ctx, portalId: string): Promise<void> {
  const { usable } = await currentPortal(ctx, portalId);
  if (!usable.some((r) => r.id === portalId)) throw notFound("درگاه پیدا نشد");
  await savePref(ctx, { portal_id: portalId });
}

/** Create or update the caller's preference row (as the system: the row is theirs only). */
export async function savePref(ctx: Ctx, values: { favorites?: string[]; portal_id?: string | null }): Promise<Row> {
  const sys = sysOf(ctx);
  return ctx.write(async (tx) => {
    const [row] = await liveRows(tx, sys, "portal_pref", { f: "user_id", op: "eq", v: ctx.user.id }, { limit: 1 });
    if (row) return updateIn(tx, sys, "portal_pref", String(row.id), values, { trusted: true });
    return createIn(tx, sys, "portal_pref", { user_id: ctx.user.id, favorites: [], ...values }, { trusted: true });
  });
}

/** The caller's favourite catalogue items. */
export async function favoritesOf(ctx: Ctx): Promise<string[]> {
  if (ctx.actor === "system") return [];
  const [row] = await liveRows(ctx.db, sysOf(ctx), "portal_pref", { f: "user_id", op: "eq", v: ctx.user.id }, { limit: 1 });
  return Array.isArray(row?.favorites) ? (row!.favorites as string[]) : [];
}

/** Add or remove a favourite (an item the person may see in the catalogue). */
export async function toggleFavorite(ctx: Ctx, itemId: string, on: boolean): Promise<string[]> {
  if (ctx.actor === "system") return [];
  const sys = sysOf(ctx);
  // decided from the person's preferences as stored, under their key: two toggles at once keep both
  return ctx.write(async (tx) => {
    await lockKey(tx, `portal.pref:${ctx.org.id}:${ctx.user.id}`);
    const [row] = await liveRows(tx, sys, "portal_pref", { f: "user_id", op: "eq", v: ctx.user.id }, { limit: 1 });
    const current = Array.isArray(row?.favorites) ? (row!.favorites as string[]) : [];
    const next = on ? [...new Set([itemId, ...current])].slice(0, 50) : current.filter((x) => x !== itemId);
    if (row) await updateIn(tx, sys, "portal_pref", String(row.id), { favorites: next }, { trusted: true });
    else await createIn(tx, sys, "portal_pref", { user_id: ctx.user.id, favorites: next }, { trusted: true });
    return next;
  });
}

/** Publish a portal's draft layout (catalogue administrators): the cleaned draft becomes the published one. */
export async function publishLayout(ctx: Ctx, portalId: string): Promise<Row> {
  if (!(await managesPortal(ctx))) throw forbidden("چیدمان درگاه را مدیران کاتالوگ منتشر می‌کنند");
  const sys = sysOf(ctx);
  return ctx.write(async (tx) => {
    // locked: two publications at once number their versions one after the other
    const row = await lockedRow(tx, sys, "portal", portalId);
    if (!row) throw notFound("درگاه پیدا نشد");
    const layout = normalizeLayout(row.layout ?? row.published_layout ?? DEFAULT_LAYOUT);
    const problems = layoutProblems(layout);
    if (problems.length) throw bad(problems[0]);
    return updateIn(tx, sys, "portal", portalId, { layout, published_layout: layout, layout_version: Number(row.layout_version ?? 0) + 1, published_at: new Date().toISOString(), published_by: ctx.user.id }, { trusted: true });
  });
}

/** The portal's logo (an image attached to the portal row), for every member of the organisation. */
export async function portalLogo(ctx: Ctx, portalId: string): Promise<{ data: Uint8Array; mime: string }> {
  const sys = sysOf(ctx);
  const row = await liveRow(ctx.db, sys, "portal", portalId);
  if (!row || !isUuid(row.logo_id)) throw notFound("نشان درگاه پیدا نشد");
  const a = await ctx.db.one<{ id: string }>(`select id from sm_attachments where org_id = $1 and table_key = 'portal' and record_id = $2 and id = $3 and deleted_at is null`, [ctx.org.id, portalId, row.logo_id]);
  if (!a) throw notFound("نشان درگاه پیدا نشد");
  const { meta, data } = await readAttachment(sys, String(row.logo_id));
  if (!meta.previewable) throw notFound("نشان درگاه تصویر نیست");
  return { data, mime: meta.mime };
}
