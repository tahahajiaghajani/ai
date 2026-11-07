// Basic tools: what the business is and what this person may see, an exact calculator, and charts
// of rows another tool stored.
import { z } from "zod";
import { AREAS, permissionMap, ROLES, type Area } from "@shared/permissions";
import { MODULES } from "@shared/constants";
import { formatJalali, toJalali, WEEKDAYS, weekday } from "@shared/jalali";
import { formatNumber } from "@shared/format";
import { D } from "@shared/money";
import { bad } from "../../../http/errors";
import { CalcError, evaluate } from "../analytics/calc";
import { defineTool } from "./registry";
import { businessToday, fiscalYears, moneyInfo, orgTimezone } from "./common";

export const getBusinessContext = defineTool({
  name: "get_business_context",
  title_fa: "شناخت سازمان",
  description:
    "Returns the business profile: name, kind, switched-on modules (goods = trading/inventory, gold = jewellery/coins/bars, fx = currency exchange), the base currency and its Persian unit (every amount other tools return is in it unless stated), money decimals, VAT percent, today's date (Gregorian ISO and Jalali, in the business's time zone), fiscal years with their status, and the caller's role and access level per area. Call it first when the question depends on any of these.",
  input: z.object({}),
  kind: "read",
  area: "ai",
  level: "view",
  async run(ctx) {
    const money = await moneyInfo(ctx);
    const today = businessToday(ctx);
    const fys = await fiscalYears(ctx);
    const perms = ctx.member.id ? permissionMap(ctx.member.role, ctx.member.overrides) : null;
    const access: Record<string, string> = {};
    for (const a of Object.keys(AREAS) as Area[]) {
      const level = perms ? perms[a] : ctx.can(a, "full") ? "full" : ctx.can(a, "edit") ? "edit" : ctx.can(a, "view") ? "view" : "none";
      access[a] = level;
    }
    const j = toJalali(today);
    const current = fys.find((f) => f.start_date <= today && f.end_date >= today) ?? null;
    return {
      data: {
        business: { name: ctx.org.name, kind: ctx.org.business_kind },
        modules: MODULES.filter((m) => ctx.hasModule(m.key)).map((m) => ({ key: m.key, title_fa: m.title })),
        currency: { code: money.code, unit_fa: money.unit, decimals: money.dp },
        vat_pct: String(ctx.org.settings?.vat_pct ?? "10"),
        today: {
          iso: today,
          jalali: formatJalali(today),
          jalali_long: formatJalali(today, { style: "full" }),
          weekday_fa: WEEKDAYS[weekday(today)],
          jalali_year: j.jy,
          jalali_month: j.jm,
          time_zone: orgTimezone(ctx),
        },
        fiscal_years: fys.map((f) => ({
          id: f.id,
          title: f.title,
          from: f.start_date,
          to: f.end_date,
          from_fa: formatJalali(f.start_date),
          to_fa: formatJalali(f.end_date),
          status: f.status ?? "open",
          current: current?.id === f.id,
        })),
        you: {
          name: ctx.user.full_name,
          role: ctx.member.id ? ctx.member.role : "support",
          role_fa: ctx.member.id ? ROLES[ctx.member.role]?.title : "پشتیبانی",
          access,
        },
        notes: [
          "Weeks start on Saturday; months, quarters (seasons) and years are Jalali.",
          "Use the calculate tool for any arithmetic; never compute numbers mentally.",
        ],
      },
      summary_fa: `${ctx.org.name} — امروز ${formatJalali(today, { style: "long" })}`,
    };
  },
});

export const calculate = defineTool({
  name: "calculate",
  title_fa: "محاسبه",
  description:
    "Exact decimal calculator. Supports + - * / (also × ÷), parentheses, unary minus, percent (\"20%\" = 0.2, \"1200 * 9%\"), Persian/Arabic digits and the Persian scale words for thousand, million, billion and trillion. No variables or functions. Use it for EVERY sum, difference, ratio, percentage or unit conversion you state (1 toman = 10 rial; 1 mesghal = 4.6083 g). Returns the exact result and a rounded one.",
  input: z.object({
    expression: z.string().min(1).max(500).describe("Arithmetic expression, e.g. \"(125000000 - 98000000) / 98000000 * 100\""),
    decimals: z.number().int().min(0).max(12).nullish().describe("Decimals of the rounded result (default 2)"),
  }),
  kind: "meta",
  area: "ai",
  level: "view",
  async run(_ctx, input) {
    let v;
    try {
      v = evaluate(input.expression);
    } catch (e) {
      if (e instanceof CalcError) throw bad(e.message);
      throw e;
    }
    const dp = input.decimals ?? 2;
    const exact = v.toSignificantDigits(30).toFixed();
    const rounded = v.toDecimalPlaces(dp).toFixed();
    return {
      data: { expression: input.expression, result: exact, rounded, rounded_decimals: dp, formatted_fa: formatNumber(D(rounded), { dp }) },
      summary_fa: `= ${formatNumber(D(rounded), { dp })}`,
    };
  },
});

export const renderChart = defineTool({
  name: "render_chart",
  title_fa: "رسم نمودار",
  description:
    "Shows a chart in the answer from rows another tool stored (its data_ref). x is the field of the categories/periods (usually \"label\"), series are numeric fields (usually \"value\"). Use line/area for time series, bar for rankings and comparisons, pie only for a few shares of a whole. Do not invent a data_ref.",
  input: z.object({
    data_ref: z.string().min(8).max(64).describe("data_ref returned by another tool"),
    kind: z.enum(["bar", "line", "area", "pie"]),
    title: z.string().max(120).nullish(),
    x: z.string().max(40).default("label"),
    series: z.array(z.object({ field: z.string().max(40), label: z.string().max(60) })).min(1).max(6),
    unit: z.string().max(30).nullish().describe("Unit shown on the axis, e.g. «ریال», «گرم»"),
  }),
  kind: "meta",
  area: "ai",
  level: "view",
  async run(_ctx, input) {
    if (!/^[A-Za-z0-9_-]+$/.test(input.data_ref)) throw bad("شناسهٔ داده معتبر نیست");
    const spec = { kind: input.kind, title: input.title ?? undefined, x: input.x, series: input.series, unit: input.unit ?? undefined };
    return { data: { ok: true, shown: true }, chart: spec, data_ref: input.data_ref, summary_fa: input.title ?? "نمودار" };
  },
});
