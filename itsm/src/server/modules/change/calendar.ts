// The change calendar — the forward schedule of change (catalogue CHG-041–044): the changes the caller may read in a
// range with their conflict flags, the occurrences of maintenance / blackout / freeze windows on the Jalali calendar,
// planned outages, lockdowns and the official holidays of the default working calendar; an iCalendar feed of the same
// (CHG-042, read with the caller's access); and blackouts made from the official holidays of a Jalali year.
import { jalaliYearRange, addDays } from "@shared/jalali";
import { riskLabel } from "@shared/change/logic";
import { localInstant } from "@shared/sla/calendar";
import type { Ctx } from "../../context";
import { access } from "../../access/provider";
import { createIn, defFor, list, orgTz } from "../../engine";
import { bad, forbidden } from "../../http/errors";
import { holidaysBetween } from "../sla";
import { iso, liveRows, msOf, sysOf, type Row } from "./common";
import { occurrencesBetween } from "./schedule";

const DAY = 86_400_000;
const CHANGE_FIELDS = [
  "number", "short_description", "type", "state", "risk", "planned_start", "planned_end", "actual_start", "actual_end", "assignment_group_id", "assigned_to", "change_owner_id",
  "conflict_status", "conflict_count", "in_blackout", "outside_window", "on_hold", "cab_required", "approval", "outage_expected", "service_id", "ci_id", "is_late",
];

export interface CalendarQuery {
  from: string;
  to: string;
  types?: string[];
  groups?: string[];
  states?: string[];
  mine?: boolean;
}

/** Everything the change calendar shows between two instants (≤ 400 days). */
export async function calendarView(ctx: Ctx, input: CalendarQuery): Promise<Row> {
  const from = msOf(input.from);
  const to = msOf(input.to);
  if (from === null || to === null || to <= from) throw bad("بازهٔ تقویم معتبر نیست");
  if (to - from > 400 * DAY) throw bad("بازهٔ تقویم حداکثر ۴۰۰ روز است");
  const and: Row[] = [
    { f: "planned_start", op: "lt", v: iso(to) },
    { f: "planned_end", op: "gt", v: iso(from) },
  ];
  and.push(input.states?.length ? { f: "state", op: "in", v: input.states } : { f: "state", op: "ne", v: "canceled" });
  if (input.types?.length) and.push({ f: "type", op: "in", v: input.types });
  if (input.groups?.length) and.push({ f: "assignment_group_id", op: "in", v: input.groups });
  if (input.mine) and.push({ or: [{ f: "assigned_to", op: "is_me" }, { f: "change_owner_id", op: "is_me" }, { f: "assignment_group_id", op: "is_my_group" }] });
  const changes = await list(ctx, "change_request", { filter: { and } as never, sort: "planned_start", size: 500, fields: CHANGE_FIELDS, total: false });

  const { def: wdef } = await defFor(ctx, "change_window");
  const windows = access().canReadTable(ctx, wdef)
    ? (await occurrencesBetween(ctx.db, sysOf(ctx), from, to)).map((o) => ({ window_id: o.window_id, name: o.name, kind: o.kind, enforcement: o.enforcement, start: iso(o.start), end: iso(o.end) }))
    : [];
  const outages = await list(ctx, "change_outage", {
    filter: { and: [{ f: "starts_at", op: "lt", v: iso(to) }, { f: "ends_at", op: "gt", v: iso(from) }] } as never, sort: "starts_at", size: 300, total: false,
    fields: ["title", "change_id", "outage_type", "service_id", "ci_id", "starts_at", "ends_at"],
  });
  const lockdowns = await list(ctx, "change_lockdown", {
    filter: { and: [{ f: "state", op: "eq", v: "active" }, { f: "starts_at", op: "lt", v: iso(to) }] } as never, sort: "starts_at", size: 50, total: false,
    fields: ["number", "title", "starts_at", "ends_at", "state"],
  });
  const tz = orgTz(ctx);
  const day = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  const holidays = await holidaysBetween(ctx.db, ctx, day(from), day(to), null);
  return {
    from: iso(from), to: iso(to), timezone: tz,
    changes: changes.rows, windows, outages: outages.rows, lockdowns: lockdowns.rows.filter((l) => msOf(l.ends_at) === null || msOf(l.ends_at)! > from), holidays,
    display: { ...changes.display, ...outages.display, ...lockdowns.display },
  };
}

const icsText = (s: unknown) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsTime = (v: unknown) => new Date(String(v)).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Fold a content line at 75 octets (RFC 5545 §3.1). */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  let len = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, "utf8");
    if (len + n > (parts.length ? 74 : 75)) {
      parts.push(cur);
      cur = "";
      len = 0;
    }
    cur += ch;
    len += n;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

/** The calendar as iCalendar (changes and blackout / freeze / maintenance occurrences), with the caller's access. */
export async function calendarIcs(ctx: Ctx, input: CalendarQuery, labels: { state: (v: string) => string; window: (v: string) => string }): Promise<string> {
  const v = await calendarView(ctx, input);
  const stamp = icsTime(new Date().toISOString());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ITSM//Change calendar//FA", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:تقویم تغییرات"];
  for (const c of v.changes as Row[]) {
    lines.push(
      "BEGIN:VEVENT", `UID:${c.id}@change.itsm`, `DTSTAMP:${stamp}`, `DTSTART:${icsTime(c.planned_start)}`, `DTEND:${icsTime(c.planned_end)}`,
      `SUMMARY:${icsText(`${c.number} — ${c.short_description}`)}`,
      `DESCRIPTION:${icsText(`وضعیت: ${labels.state(String(c.state))}\nریسک: ${riskLabel(c.risk)}`)}`,
      `CATEGORIES:${icsText(String(c.type ?? ""))}`, "END:VEVENT",
    );
  }
  for (const w of v.windows as Row[]) {
    lines.push(
      "BEGIN:VEVENT", `UID:${w.window_id}-${icsTime(w.start)}@window.itsm`, `DTSTAMP:${stamp}`, `DTSTART:${icsTime(w.start)}`, `DTEND:${icsTime(w.end)}`,
      `SUMMARY:${icsText(`${labels.window(String(w.kind))}: ${w.name}`)}`, "TRANSP:TRANSPARENT", "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/**
 * Blackouts from the official holidays of a Jalali year (the default working calendar's sets): consecutive holidays
 * become one window; a window that already exists (same name and start) is not added twice. Returns how many.
 */
export async function blackoutsFromHolidays(ctx: Ctx, input: { year: number; enforcement?: "block" | "warn" }): Promise<{ created: number; skipped: number }> {
  const { def } = await defFor(ctx, "change_window");
  if (!access().canCreate(ctx, def, null)) throw forbidden("اجازهٔ افزودن پنجرهٔ زمانی را ندارید");
  const range = jalaliYearRange(input.year);
  const days = (await holidaysBetween(ctx.db, ctx, range.start, range.end, null)).filter((h) => !h.half).sort((a, b) => a.date.localeCompare(b.date));
  const tz = orgTz(ctx);
  const runs: { from: string; to: string; titles: string[] }[] = [];
  for (const h of days) {
    const last = runs[runs.length - 1];
    if (last && addDays(last.to, 1) === h.date) {
      last.to = h.date;
      if (!last.titles.includes(h.title)) last.titles.push(h.title);
    } else runs.push({ from: h.date, to: h.date, titles: [h.title] });
  }
  const existing = await liveRows(ctx.db, sysOf(ctx), "change_window", { f: "source", op: "eq", v: "holiday" }, { limit: 2000 });
  const have = new Set(existing.map((w) => `${w.name}|${msOf(w.start_at)}`));
  let created = 0;
  let skipped = 0;
  await ctx.write(async (tx) => {
    for (const r of runs) {
      const name = `تعطیل رسمی: ${r.titles.join("، ")}`.slice(0, 160);
      const start = localInstant(r.from, 0, tz);
      if (have.has(`${name}|${start}`)) {
        skipped++;
        continue;
      }
      // create access was checked above; `source` is an engine stamp people do not set
      await createIn(tx, sysOf(ctx, ctx.user.id), "change_window", {
        name, kind: "blackout", recurrence: "none", enforcement: input.enforcement ?? "warn", exempt_emergency: true, source: "holiday",
        start_at: iso(start), end_at: iso(localInstant(addDays(r.to, 1), 0, tz)), description: `از تعطیلات رسمی سال ${input.year}`,
      }, { trusted: true });
      created++;
    }
  });
  return { created, skipped };
}
