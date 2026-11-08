// Outage announcements (catalogue INC-043; the table `announcement` in src/shared/tables/incident.ts): the banners on
// air for a person — everyone, agents only, or the groups, unit trees, locations and people named — a draft from an
// incident (the war room's «اطلاعیهٔ قطعی»), and their end: with the incident's resolution (`end_with_incident`, the
// subscriber in jobs.ts) or when their window is over (the sweep). People read banners through
// GET /incident/announcements, which returns what reaches them and nothing about the rest; the table itself is read
// and kept by the group that owns an announcement and by managers.
import { announcementActive, announcementReaches, type AudienceMember } from "@shared/incident/logic";
import type { AnnouncementItem } from "@shared/incident/api";
import type { Ctx } from "../../context";
import { access } from "../../access/provider";
import { createIn, get, transitionIn } from "../../engine";
import { forbidden } from "../../http/errors";
import { isUuid, liveRow, liveRows, requesterOnly, sysOf, type Row } from "./common";
import { canWork, lockIncident } from "./major";

/** What decides whether a banner reaches the caller: groups, their unit and the units above it, location, agent or not. */
export async function audienceOf(ctx: Ctx): Promise<AudienceMember> {
  const env = await access().env(ctx);
  const sys = sysOf(ctx);
  const [profile] = await liveRows(ctx.db, sys, "member_profile", { f: "user_id", op: "eq", v: ctx.user.id }, { limit: 1 });
  const unit = profile?.org_unit_id ? await liveRow(ctx.db, sys, "org_unit", profile.org_unit_id) : null;
  const units = unit ? String(unit.path ?? `/${unit.id}/`).split("/").filter(isUuid) : [];
  return { userId: ctx.user.id, agent: !requesterOnly(ctx, "incident"), groups: env.groups ?? [], units, location: profile?.location_id ?? null };
}

/** The announcements on air for the caller, newest first (an incident is named only when they may read it). */
export async function activeAnnouncements(ctx: Ctx, now = Date.now()): Promise<{ items: AnnouncementItem[] }> {
  if (ctx.actor === "system") return { items: [] };
  const rows = await liveRows(ctx.db, sysOf(ctx), "announcement", { f: "state", op: "eq", v: "published" }, { order: "t.starts_at desc nulls last, t.created_at desc", limit: 200 });
  const live = rows.filter((a) => announcementActive(a, now));
  if (!live.length) return { items: [] };
  const me = await audienceOf(ctx);
  const items: AnnouncementItem[] = [];
  for (const a of live) {
    if (!announcementReaches(a, me)) continue;
    const inc = a.incident_id ? await liveRow(ctx.db, ctx, "incident", a.incident_id) : null;
    items.push({
      id: a.id,
      number: a.number ?? null,
      title: String(a.title ?? ""),
      body: a.body ?? null,
      kind: String(a.kind ?? "info"),
      starts_at: a.starts_at ?? null,
      ends_at: a.ends_at ?? null,
      incident: inc ? { id: inc.id, number: inc.number ?? null } : null,
    });
  }
  return { items: items.slice(0, 20) };
}

/**
 * The incident's announcement: its live one (draft or on air), or a new draft filled from the incident — kept by the
 * incident's group, ending with its resolution. Only someone working the incident asks for it.
 */
export async function announceFromIncident(ctx: Ctx, id: string): Promise<{ row: Row; display: Record<string, string>; created: boolean }> {
  const out = await ctx.write(async (tx) => {
    const { def, row: inc } = await lockIncident(tx, ctx, id);
    if (!canWork(ctx, def, inc)) throw forbidden("اطلاعیهٔ رخداد را کسی می‌سازد که روی آن کار می‌کند");
    const [existing] = await liveRows(tx, sysOf(ctx), "announcement", { and: [{ f: "incident_id", op: "eq", v: id }, { f: "state", op: "in", v: ["draft", "published"] }] }, { order: "t.created_at desc", limit: 1 });
    if (existing) return { id: existing.id as string, created: false };
    const major = inc.major_state === "accepted";
    const row = await createIn(tx, ctx, "announcement", {
      title: `${major ? "اختلال گسترده" : "اختلال"}: ${inc.short_description ?? ""}`.slice(0, 160),
      body: [
        "همکاران گرامی،",
        `${inc.short_description ?? "یکی از خدمت‌ها"} دچار اختلال شده است و همکاران ما در حال رفع آن هستند.`,
        inc.business_impact ? `\n${inc.business_impact}` : "",
        "\nبه محض تغییر وضعیت، همین‌جا خبر می‌دهیم. لطفاً برای همین موضوع درخواست تازه ثبت نکنید.",
      ].filter(Boolean).join("\n"),
      kind: "outage",
      audience: "everyone",
      incident_id: id,
      end_with_incident: true,
      assignment_group_id: inc.assignment_group_id ?? null,
      owner_id: inc.mi_comms_id ?? (ctx.actor === "system" ? null : ctx.user.id),
    }, { trusted: true });
    return { id: row.id as string, created: true };
  });
  const r = await get(ctx, "announcement", out.id);
  return { row: r.row, display: r.display, created: out.created };
}

/** End the announcements on air about an incident that marked them «با حل رخداد پایان یابد» (as the system). */
export async function endWithIncident(sys: Ctx, incidentId: string, number: string | null): Promise<number> {
  const rows = await liveRows(sys.db, sys, "announcement", { and: [{ f: "incident_id", op: "eq", v: incidentId }, { f: "state", op: "eq", v: "published" }, { f: "end_with_incident", op: "eq", v: true }] }, { limit: 50 });
  let ended = 0;
  for (const a of rows) {
    await sys.write((tx) => transitionIn(tx, sys, "announcement", a.id, "ended")).then(
      () => ended++,
      (e) => sys.cfg.log?.warn?.("announcement end", { id: a.id, incident: number, error: (e as Error).message }),
    );
  }
  return ended;
}

/** End the announcements whose window is over (the sweep); returns how many, and whether any is still on air. */
export async function expireAnnouncements(sys: Ctx, now = Date.now()): Promise<{ ended: number; live: number }> {
  const rows = await liveRows(sys.db, sys, "announcement", { f: "state", op: "eq", v: "published" }, { limit: 500 });
  let ended = 0;
  for (const a of rows) {
    const to = Date.parse(String(a.ends_at ?? ""));
    if (Number.isNaN(to) || to > now) continue;
    await sys.write((tx) => transitionIn(tx, sys, "announcement", a.id, "ended")).then(
      () => ended++,
      (e) => sys.cfg.log?.warn?.("announcement expiry", { id: a.id, error: (e as Error).message }),
    );
  }
  return { ended, live: rows.length - ended };
}
