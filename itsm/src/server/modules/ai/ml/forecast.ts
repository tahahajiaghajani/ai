// Volume forecasts for a viewer (catalogue AI-052, AI-116, ANA-027; docs/spec/AI.md §13.5): the daily counts come from
// the engine's aggregate WITH THE VIEWER'S ACCESS (a forecast counts exactly what its viewer could list — nothing is
// stored, nothing computed for one person reaches another), optionally narrowed to one value of a service, group or
// channel field the viewer sees; the Iranian week and the organisation's official holidays shape it (./core/volume.ts);
// the staffing hint uses the median work time of the viewer's resolved records when the table records it.
import { addDays, todayISO } from "@shared/jalali";
import type { Cond } from "@shared/model/conditions";
import type { Ctx } from "../../../context";
import { bad, forbidden } from "../../../http/errors";
import { access } from "../../../access/provider";
import { aggregate, orgSchema, orgTz, systemCtx } from "../../../engine";
import { toolPath } from "../tools/fields";
import { DEFAULT_STAFFING, denseDaily, forecastDaily, forecastWeekly, staffingHints, weeklyOf, type VolumeForecast } from "./core/volume";
import { generalizedEsd, seasonalResiduals } from "./core/anomaly";
import { readRows } from "./data";

export interface ForecastInput {
  table: string;
  /** narrow to one value of a field (service, group, channel…) */
  by?: string | null;
  value?: string | null;
  grain?: "day" | "week";
  horizon?: number;
}

export interface ForecastView extends VolumeForecast {
  table: string;
  table_label: string;
  grain: "day" | "week";
  by: { field: string; label: string; value: string } | null;
  /** indices into `history` the ESD test marks as unusual */
  anomalies: number[];
  staffing: { date: string; people_p50: number; people_p90: number }[];
  assumptions: { handle_minutes: number; productive_hours: number; handle_from_data: boolean };
}

/**
 * Official holidays (full days) of the organisation's default calendar sets between two dates — the sets the default
 * calendar uses (default ["ir"]); a set of one site's shutdown days is not the whole organisation's holiday.
 */
export async function holidaysBetween(ctx: Ctx, from: string, to: string): Promise<Set<string>> {
  const sys = await systemCtx(ctx.cfg, ctx.org.id);
  const schema = await orgSchema(sys);
  const def = schema.def("holiday");
  if (!def) return new Set();
  const cal = schema.def("calendar");
  const [dflt] = cal ? await readRows(sys, cal, ["holiday_sets", "is_default", "active"], { where: { and: [{ f: "is_default", op: "eq", v: true }, { f: "active", op: "eq", v: true }] }, limit: 1, order: "t.created_at" }) : [];
  const sets = Array.isArray(dflt?.holiday_sets) && (dflt!.holiday_sets as unknown[]).length ? (dflt!.holiday_sets as unknown[]).map(String) : ["ir"];
  const rows = await readRows(sys, def, ["date", "half_day", "active", "holiday_set"], { where: { and: [{ f: "date", op: "gte", v: from }, { f: "date", op: "lte", v: to }, { f: "active", op: "eq", v: true }, { f: "holiday_set", op: "in", v: sets }] }, limit: 2000, order: "t.date" });
  return new Set(rows.filter((r) => r.half_day !== true).map((r) => String(r.date).slice(0, 10)));
}

/** A volume forecast as the viewer may compute it (see the file's head). */
export async function forecastFor(ctx: Ctx, input: ForecastInput): Promise<ForecastView> {
  const schema = await orgSchema(ctx);
  const def = schema.def(input.table);
  if (!def || def.virtual) throw bad("جدول پیدا نشد");
  if (!access().canReadTable(ctx, def)) throw forbidden(`به «${def.plural}» دسترسی ندارید`);
  const grain = input.grain === "week" ? "week" : "day";
  const horizon = Math.max(1, Math.min(grain === "day" ? 60 : 26, Math.floor(input.horizon ?? (grain === "day" ? 14 : 8))));
  const tz = orgTz(ctx);
  const today = todayISO(tz);
  const days = grain === "day" ? 182 : 735;
  const from = addDays(today, -days);
  const filter: Cond[] = [{ f: "created_at", op: "gte", v: from }];
  let by: ForecastView["by"] = null;
  if (input.by) {
    const f = toolPath(ctx, schema, def, input.by);
    if (f !== null) throw forbidden("این فیلد برای پیش‌بینی در دسترس نیست");
    const field = def.fields.find((x) => x.name === input.by);
    if (!field || input.value === undefined || input.value === null) throw bad("فیلد یا مقدار تفکیک معتبر نیست");
    filter.push({ f: input.by, op: "eq", v: input.value });
    by = { field: field.name, label: field.label, value: String(input.value) };
  }
  // yesterday is the last full day: today is still filling up
  const until = addDays(today, -1);
  filter.push({ f: "created_at", op: "lt", v: today });
  const agg = await aggregate(ctx, def.key, { filter: { and: filter }, groupBy: [{ field: "created_at", bucket: "day" }], metrics: [{ fn: "count" }], limit: 5000 });
  const daily = denseDaily(
    agg.rows.map((r) => ({ date: String(r.keys[0]).slice(0, 10), count: Number(r.values.count ?? 0) })),
    from,
    until,
  );
  // start at the first day with a record (a table that began recently is not «zero» before it)
  const first = daily.findIndex((d) => d.count > 0);
  const history = first > 0 ? daily.slice(first) : daily;
  const holidays = await holidaysBetween(ctx, from, addDays(today, horizon * (grain === "day" ? 1 : 7) + 7));
  const f = grain === "day" ? forecastDaily(history, horizon, holidays) : forecastWeekly(weeklyOf(history), horizon);
  const anomalies = f.history.length >= 15 ? generalizedEsd(seasonalResiduals(f.history.map((h) => h.count), grain === "day" ? 7 : 52), 5).sort((a, b) => a - b) : [];
  // work per record: the median «زمان کار» of the viewer's resolved records of the last 90 days, when recorded
  let handle = DEFAULT_STAFFING.handle_minutes;
  let fromData = false;
  const worked = def.fields.find((x) => x.name === "time_worked");
  const visible = access().visibleFields(ctx, def);
  if (worked && (!visible || visible.has("time_worked"))) {
    const a = await aggregate(ctx, def.key, { filter: { and: [{ f: "time_worked", op: "gt", v: 0 }, { f: "created_at", op: "gte", v: addDays(today, -90) }] }, metrics: [{ fn: "median", field: "time_worked" }, { fn: "count" }] });
    const med = Number(a.totals["median:time_worked"] ?? NaN);
    if (Number(a.totals.count ?? 0) >= 20 && Number.isFinite(med) && med > 0) {
      handle = Math.max(1, Math.round(med / 60));
      fromData = true;
    }
  }
  const assumptions = { handle_minutes: handle, productive_hours: DEFAULT_STAFFING.productive_hours };
  return {
    ...f,
    table: def.key,
    table_label: def.plural,
    grain,
    by,
    anomalies,
    staffing: grain === "day" ? staffingHints(f.points, assumptions) : [],
    assumptions: { ...assumptions, handle_from_data: fromData },
  };
}
