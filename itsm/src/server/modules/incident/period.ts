// Periodic incident reviews (catalogue INC-080; the table `incident_period_review`): the figures of a period computed
// from the incidents the reviewer may read — opened in it, resolved in it, and the 90 days before it for new kinds of
// incident — a stable sample of resolved incidents for the quality check, and the report draft. The sweep drafts the
// next review every `period_review_days` (settings) once the organisation has that much history.
import { localDate, periodReport, periodStats, type PeriodIncident } from "@shared/incident/logic";
import { addDays, formatJalali } from "@shared/jalali";
import { PRIORITIES } from "@shared/model/task";
import type { Option } from "@shared/model/types";
import { INCIDENT_CHOICE_LISTS } from "@shared/tables/incident";
import type { Cond } from "@shared/model/conditions";
import type { Ctx } from "../../context";
import { access } from "../../access/provider";
import { createIn, defFor, get, orgTz, updateIn } from "../../engine";
import { bad, forbidden, notFound } from "../../http/errors";
import { incidentConfig, isUuid, liveRow, liveRows, sysOf, type Row } from "./common";

const FIELDS_LIMIT = 5000;
const DAY = 86_400_000;

/** Incidents of `ctx`'s access whose `field` falls on the local days from..to (inclusive). */
async function incidentsBetween(ctx: Ctx, field: "opened_at" | "resolved_at", from: string, to: string, tz: string): Promise<PeriodIncident[]> {
  // a day of margin on each side in UTC, then the local day decides
  const lo = new Date(Date.parse(`${from}T00:00:00Z`) - DAY).toISOString();
  const hi = new Date(Date.parse(`${to}T00:00:00Z`) + 2 * DAY).toISOString();
  const where: Cond = { and: [{ f: field, op: "gte", v: lo }, { f: field, op: "lt", v: hi }] };
  const rows = await liveRows(ctx.db, ctx, "incident", where, { order: `t.${field}`, limit: FIELDS_LIMIT });
  return rows.filter((r) => {
    const t = Date.parse(String(r[field] ?? ""));
    if (Number.isNaN(t)) return false;
    const d = localDate(t, tz);
    return d >= from && d <= to;
  }) as PeriodIncident[];
}

const labelOf = (options: Option[]) => (v: string) => options.find((o) => o.value === v)?.label ?? v;

/**
 * Compute a review's figures, sample and (when it has none, or `overwrite`) its report, with the caller's access: the
 * caller must be able to change the review; the incidents counted are those they may read.
 */
export async function computePeriodReview(ctx: Ctx, id: string, opts: { overwrite?: boolean; now?: number } = {}): Promise<{ row: Row; display: Record<string, string> }> {
  if (!isUuid(id)) throw notFound("بازبینی پیدا نشد");
  const review = await liveRow(ctx.db, ctx, "incident_period_review", id);
  if (!review) throw notFound("بازبینی پیدا نشد");
  const { def } = await defFor(ctx, "incident_period_review");
  if (!access().canWrite(ctx, def, review)) throw forbidden("محاسبهٔ آمار با مسئول و شرکت‌کنندگان بازبینی است");
  if (review.state === "canceled") throw bad("این بازبینی لغو شده است");
  const from = String(review.period_from ?? "");
  const to = String(review.period_to ?? "");
  if (!from || !to || to < from) throw bad("بازهٔ بازبینی را درست مشخص کنید");
  const tz = orgTz(ctx);
  const cfg = await incidentConfig(ctx.db, ctx);
  const [opened, resolved, before] = await Promise.all([
    incidentsBetween(ctx, "opened_at", from, to, tz),
    incidentsBetween(ctx, "resolved_at", from, to, tz),
    incidentsBetween(ctx, "opened_at", addDays(from, -90), addDays(from, -1), tz),
  ]);
  const stats = periodStats(opened, resolved, new Set(before.map((r) => r.subcategory).filter((x): x is string => !!x)), {
    from, to, bounceAt: cfg.reassignment_alert, seed: id, sampleSize: 10, now: opts.now,
  });
  const report = periodReport(stats, {
    priority: labelOf(PRIORITIES),
    category: labelOf(INCIDENT_CHOICE_LISTS["incident.category"]),
    subcategory: labelOf(INCIDENT_CHOICE_LISTS["incident.subcategory"]),
    channel: labelOf(INCIDENT_CHOICE_LISTS["incident.channel"]),
    date: (iso) => formatJalali(iso, { latin: true }),
  });
  const writer = sysOf(ctx, ctx.actor === "system" ? null : ctx.user.id);
  await ctx.write((tx) =>
    updateIn(tx, writer, "incident_period_review", id, {
      stats,
      sample_ids: stats.sample,
      computed_at: new Date().toISOString(),
      ...(opts.overwrite || !String(review.report ?? "").trim() ? { report } : {}),
    }, { trusted: true }),
  );
  const r = await get(ctx, "incident_period_review", id);
  return { row: r.row, display: r.display };
}

/**
 * The sweep's part: when the settings ask for a review every N days and the last one (not canceled) ended N days ago —
 * or there is none and incidents go back N days — draft the next one for the days since, and compute it.
 */
export async function ensurePeriodReview(sys: Ctx, now = Date.now()): Promise<Row | null> {
  const cfg = await incidentConfig(sys.db, sys);
  const days = cfg.period_review_days;
  if (!days || days <= 0) return null;
  const tz = orgTz(sys);
  const today = localDate(now, tz);
  const yesterday = addDays(today, -1);
  const [last] = await liveRows(sys.db, sys, "incident_period_review", { f: "state", op: "ne", v: "canceled" }, { order: "t.period_to desc", limit: 1 });
  let from: string;
  if (last) {
    const lastTo = String(last.period_to ?? "");
    if (!lastTo || addDays(lastTo, days) > yesterday) return null;
    from = addDays(lastTo, 1);
  } else {
    const [first] = await liveRows(sys.db, sys, "incident", null, { order: "t.opened_at", limit: 1 });
    const firstAt = Date.parse(String(first?.opened_at ?? ""));
    if (Number.isNaN(firstAt) || localDate(firstAt, tz) > addDays(today, -days)) return null;
    from = addDays(today, -days);
  }
  if (from > yesterday) return null;
  const row = await sys.write((tx) =>
    createIn(tx, sys, "incident_period_review", {
      title: `بازبینی دوره‌ای رخدادها — ${formatJalali(from, { latin: true })} تا ${formatJalali(yesterday, { latin: true })}`,
      period_from: from,
      period_to: yesterday,
      review_trigger: "scheduled",
      owner_id: null,
    }, { trusted: true }),
  );
  await computePeriodReview(sys, row.id as string, { now });
  return row;
}
