// Scheduled delivery of reports and dashboards (catalogue ANA-016/043): at each occurrence of a schedule (Jalali-aware,
// in the organisation's time zone) every recipient — the owner, the people and the members of the groups it names —
// gets the content computed with THEIR OWN access, re-checked at send time: a recipient who may no longer read the
// report, the dashboard or the reports area gets nothing (the log says so). Each delivery is a row of
// `analytics_delivery` readable only by its recipient (the evidence), carrying the summary and the Excel file as an
// attachment; the notification service tells the recipient in the app and by e-mail (rendered under the recipient's
// access as always) with a link to the delivery and, when asked, to the print view. «اگر خالی بود نفرست» logs an empty
// delivery without notifying. Recipients are processed until the job's deadline and the job continues where it stopped.
import { nextOccurrence, type ScheduleSpec } from "@shared/flows";
import { formatJalaliDateTime } from "@shared/jalali";
import { faDigits } from "@shared/format";
import { formatValue } from "@shared/analytics/kpi";
import { windowLabel } from "@shared/analytics/model";
import type { DashboardFilter, ReportResult, ReportSpec, ScorecardItem, Widget } from "@shared/analytics/types";
import type { Ctx } from "../../context";
import type { ServerConfig } from "../../context";
import { memberCtx } from "../../access";
import { addAttachmentIn, createIn, defFor, orgSchema, orgTz, updateIn } from "../../engine";
import { notifyPeople } from "../notify";
import { enqueue } from "../../jobs";
import { canRead, isUuid, liveRow, liveRows, sysOf, type Row } from "./common";
import { runOne } from "./dashboards";
import { isRestricted, runReport } from "./query";
import { aboutSheet, fileName, resultSheet, scorecardSheet, workbook, type XlsxSheet } from "./xlsx";

export const MAX_RECIPIENTS = 200;

export type DeliveryStatus = "sent" | "empty" | "no_access" | "failed";

export interface DeliveryOutcome {
  user: string;
  status: DeliveryStatus;
  delivery_id: string | null;
}

/** The people a schedule goes to (owner, named people, members of named groups), at most 200. */
export async function recipientsOf(sys: Ctx, s: Row): Promise<string[]> {
  const out = new Set<string>();
  if (s.include_owner && isUuid(s.owner_id)) out.add(String(s.owner_id));
  for (const u of Array.isArray(s.recipients) ? s.recipients : []) if (isUuid(u)) out.add(String(u));
  const groups = (Array.isArray(s.recipient_groups) ? s.recipient_groups : []).filter(isUuid);
  if (groups.length) {
    const now = Date.now();
    const members = await liveRows(sys.db, sys, "group_member", { f: "group_id", op: "in", v: groups }, { limit: 2000 });
    for (const m of members) {
      if (m.valid_from && Date.parse(m.valid_from) > now) continue;
      if (m.valid_to && Date.parse(m.valid_to) <= now) continue;
      if (isUuid(m.user_id)) out.add(String(m.user_id));
    }
  }
  return [...out].slice(0, MAX_RECIPIENTS);
}

interface Content {
  title: string;
  empty: boolean;
  rows: number;
  summary: string;
  sheets: XlsxSheet[];
}

const fmtResultLine = (r: ReportResult): string => {
  if (r.kind === "list") return `${faDigits(r.list?.total ?? r.list?.rows.length ?? 0)} رکورد`;
  const m = r.measures[0];
  if (!m) return "";
  return `${m.label}: **${formatValue(r.totals[m.key] ?? null, m.unit)}** (${faDigits(r.total_n)} رکورد)`;
};

/** The top rows of a result as Markdown lines (at most 8). */
function topLines(r: ReportResult): string[] {
  if (r.kind === "list") {
    const col = r.list?.columns[1] ?? r.list?.columns[0];
    return (r.list?.rows ?? []).slice(0, 8).map((row) => `- ${String(row.number ?? "")} ${col ? String(row[col.name] ?? "") : ""}`.trim());
  }
  const m = r.measures[0];
  if (!m || !r.dims.length) return [];
  return r.rows
    .filter((x) => !x.suppressed)
    .slice(0, 8)
    .map((x) => `- ${x.labels.join(" / ")}: ${formatValue(x.values[m.key] ?? null, m.unit)}`);
}

const isEmpty = (r: ReportResult) => (r.kind === "list" ? (r.list?.rows.length ?? 0) === 0 : r.total_n === 0);

/** What one recipient receives, computed with their own access (null: they may not read it). */
async function contentFor(ctx: Ctx, s: Row, opts: { now?: number }): Promise<Content | null> {
  const schema = await orgSchema(ctx);
  if (isUuid(s.report_id)) {
    const rep = await liveRow(ctx.db, ctx, "analytics_report", s.report_id);
    if (!rep || rep.trashed) return null;
    let r: ReportResult;
    try {
      r = await runReport(ctx, rep.spec as ReportSpec, { now: opts.now });
    } catch (e) {
      if (isRestricted(e)) return null;
      throw e;
    }
    const spec = rep.spec as ReportSpec;
    const lines = [`**${rep.name}** — ${fmtResultLine(r)}`, ...(spec.time?.window ? [`بازه: ${windowLabel(spec.time.window)}`] : []), ...topLines(r)];
    return {
      title: String(rep.name),
      empty: isEmpty(r),
      rows: r.kind === "list" ? (r.list?.rows.length ?? 0) : r.rows.length,
      summary: lines.join("\n"),
      sheets: [resultSheet(String(rep.name), r, schema)],
    };
  }
  if (isUuid(s.dashboard_id)) {
    const d = await liveRow(ctx.db, ctx, "analytics_dashboard", s.dashboard_id);
    if (!d || d.trashed) return null;
    const widgets = ((d.layout as { widgets?: Widget[] } | null)?.widgets ?? []).slice().sort((a, b) => a.y - b.y || a.x - b.x);
    const filters = Array.isArray(d.filters) ? (d.filters as DashboardFilter[]) : [];
    const sheets: XlsxSheet[] = [];
    const lines: string[] = [`**${d.name}**`];
    let empty = true;
    let rows = 0;
    const cards: ScorecardItem[] = [];
    for (const w of widgets) {
      const run = await runOne(ctx, w, filters, {}, opts);
      if (run.kind === "report") {
        const title = w.title || run.report?.name || run.result.table_label;
        sheets.push(resultSheet(title, run.result, schema));
        lines.push(`- ${title}: ${fmtResultLine(run.result)}`);
        if (!isEmpty(run.result)) empty = false;
        rows += run.result.kind === "list" ? (run.result.list?.rows.length ?? 0) : run.result.rows.length;
      } else if (run.kind === "indicator") {
        cards.push(run.item);
      } else if (run.kind === "scorecard") {
        for (const i of run.items) if (!cards.some((c) => c.id === i.id)) cards.push(i);
      }
    }
    if (cards.length) {
      sheets.unshift(scorecardSheet("شاخص‌ها", cards));
      for (const c of cards.slice(0, 8)) lines.push(`- ${c.name}: ${c.restricted ? "در دسترس نیست" : formatValue(c.current.value, c.unit, c.decimals)}`);
      if (cards.some((c) => !c.restricted && c.current.value !== null)) empty = false;
    }
    return { title: String(d.name), empty, rows, summary: lines.join("\n"), sheets };
  }
  return null;
}

/** The print view of what a schedule sends (the recipient opens it with their own access). */
const printPath = (s: Row) => (isUuid(s.report_id) ? `analytics/print/report/${s.report_id}` : `analytics/print/dashboard/${s.dashboard_id}`);

/** Deliver a schedule to one recipient (system writes; the content is the recipient's). */
export async function deliverTo(cfg: ServerConfig, sys: Ctx, s: Row, userId: string, opts: { now?: number } = {}): Promise<DeliveryOutcome> {
  const at = new Date(opts.now ?? Date.now());
  const base = { recipient_id: userId, schedule_id: s.id, report_id: isUuid(s.report_id) ? s.report_id : null, dashboard_id: isUuid(s.dashboard_id) ? s.dashboard_id : null, delivered_at: at.toISOString() };
  const log = (status: DeliveryStatus, title: string, extra: Row = {}) =>
    sys.write(async (tx) => (await createIn(tx, sys, "analytics_delivery", { ...base, title: title.slice(0, 200), status, ...extra }, { trusted: true })).id as string);

  let ctx: Ctx;
  try {
    ctx = await memberCtx(cfg, sys.org.id, userId);
  } catch {
    return { user: userId, status: "no_access", delivery_id: null };
  }
  let content: Content | null;
  try {
    content = canRead(ctx) ? await contentFor(ctx, s, opts) : null;
  } catch (e) {
    const id = await log("failed", String(s.name ?? "گزارش"), { error: (e instanceof Error ? e.message : String(e)).slice(0, 1000) });
    return { user: userId, status: "failed", delivery_id: id };
  }
  if (!content) {
    const id = await log("no_access", String(s.name ?? "گزارش"), { summary: "گیرنده اکنون اجازهٔ دیدن این گزارش را ندارد؛ چیزی فرستاده نشد." });
    return { user: userId, status: "no_access", delivery_id: id };
  }
  const title = `${content.title} — ${formatJalaliDateTime(at.toISOString(), orgTz(sys))}`;
  if (content.empty && s.skip_if_empty) {
    const id = await log("empty", title, { summary: content.summary });
    return { user: userId, status: "empty", delivery_id: id };
  }
  const formats: string[] = Array.isArray(s.formats) ? s.formats : [];
  const channels: string[] = Array.isArray(s.channels) ? s.channels : ["in_app"];
  const bytes = formats.includes("xlsx")
    ? await workbook([
        ...content.sheets,
        aboutSheet([
          ["گزارش", content.title],
          ["ساخته‌شده برای", ctx.user.full_name || ctx.user.email || "گیرنده"],
          ["زمان", formatJalaliDateTime(at.toISOString(), orgTz(sys))],
          ["دسترسی", "فقط رکوردهایی که گیرنده اجازهٔ دیدن آن‌ها را دارد"],
        ]),
      ])
    : null;
  const { def } = await defFor(sys, "analytics_delivery");
  const id = await sys.write(async (tx) => {
    const row = await createIn(tx, sys, "analytics_delivery", { ...base, title: title.slice(0, 200), status: "sent", rows: content.rows, summary: content.summary }, { trusted: true });
    if (bytes) await addAttachmentIn(tx, sys, def, row.id as string, { name: fileName(content.title, at), type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", data: bytes });
    const body = [
      s.message ? String(s.message) : null,
      formats.includes("summary") ? content.summary : null,
      bytes ? "پروندهٔ اکسل پیوست همین گزارش است." : null,
      formats.includes("link") ? `نسخهٔ چاپی: /${printPath(s)}` : null,
    ].filter(Boolean).join("\n\n");
    await notifyPeople(tx, sys.org.id, {
      table: "analytics_delivery",
      id: row.id as string,
      users: [userId],
      label: "گزارش زمان‌بندی‌شده",
      subject: `گزارش «${content.title}»`,
      body,
      channels: channels.filter((c) => c === "in_app" || c === "email") as ("in_app" | "email")[],
      source: "گزارش‌های زمان‌بندی‌شده",
    });
    return row.id as string;
  });
  return { user: userId, status: "sent", delivery_id: id };
}

/**
 * Advance a schedule after a run (system): the next occurrence and how many recipients it reached. What each recipient
 * got (sent, empty under their access, no access) stays on their own delivery row: the owner — who chose the report,
 * its filter and the recipients — learns nothing about records only a recipient may read.
 */
export async function finishRun(sys: Ctx, s: Row, outcomes: DeliveryOutcome[], opts: { now?: number; manual?: boolean } = {}): Promise<void> {
  const now = opts.now ?? Date.now();
  const failed = outcomes.filter((o) => o.status === "failed").length;
  const result = `${faDigits(outcomes.length - failed)} گیرنده پردازش شد، ${faDigits(failed)} ناموفق`;
  const patch: Row = { last_run_at: new Date(now).toISOString(), last_result: result };
  if (!opts.manual) {
    const next = s.active ? nextOccurrence(s.schedule as ScheduleSpec, now + 1000, orgTz(sys)) : null;
    patch.next_run_at = next ? new Date(next).toISOString() : null;
    if (!next && (s.schedule as ScheduleSpec)?.kind === "once") patch.active = false;
  }
  await sys.write((tx) => updateIn(tx, sys, "analytics_schedule", s.id, patch, { trusted: true, keepVersion: true }));
}

/** Schedules due now (system). */
export async function dueSchedules(sys: Ctx, now = Date.now()): Promise<Row[]> {
  return liveRows(sys.db, sys, "analytics_schedule", { and: [{ f: "active", op: "eq", v: true }, { f: "next_run_at", op: "lte", v: new Date(now).toISOString() }] }, { order: "t.next_run_at", limit: 50 });
}

/**
 * The owner's «ارسال اکنون»: the occurrence is queued as a delivery job (progress saved per recipient, never sent twice
 * when the request or a worker stops halfway). Answers how many recipients it goes to — never what each one got.
 */
export async function runSchedule(ctx: Ctx, id: string, opts: { now?: number } = {}): Promise<{ queued: boolean; recipients: number }> {
  const sys = sysOf(ctx);
  const s = await liveRow(sys.db, sys, "analytics_schedule", id);
  if (!s) return { queued: false, recipients: 0 };
  const recipients = (await recipientsOf(sys, s)).length;
  const at = new Date(opts.now ?? Date.now()).toISOString();
  await enqueue(ctx.db, { kind: "analytics.deliver", orgId: ctx.org.id, payload: { id: s.id, at, manual: true }, dedupeKey: `analytics.deliver.manual:${s.id}`, maxAttempts: 3 });
  return { queued: true, recipients };
}
