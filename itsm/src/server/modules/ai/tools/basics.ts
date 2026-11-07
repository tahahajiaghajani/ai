// Basic tools: who is asking, about which organisation and when (today in the organisation's time zone and
// in the Jalali calendar), what this person may see, an exact calculator, and charts of rows another tool
// stored.
import { z } from "zod";
import { AREAS, permissionMap, ROLES, type Area } from "@shared/permissions";
import { MODULES } from "@shared/constants";
import { formatJalali, toJalali, WEEKDAYS, weekday } from "@shared/jalali";
import { formatNumber } from "@shared/format";
import { D } from "@shared/money";
import { bad } from "../../../http/errors";
import { CalcError, evaluate } from "../analytics/calc";
import { defineTool } from "./registry";
import { orgTimezone, orgToday } from "./common";

const LEVEL_FA: Record<string, string> = { none: "بدون دسترسی", view: "مشاهده", edit: "ثبت و ویرایش", full: "کامل" };

export const getOrgContext = defineTool({
  name: "get_org_context",
  title_fa: "شناخت سازمان",
  description:
    "Returns who is asking and where: the organisation (name, legal name, city, switched-on modules, member count), today's date (Gregorian ISO and Jalali, weekday, in the organisation's time zone), and the caller (name, role, and access level per area: settings, users, integrations, ai, reports). Call it first when the question depends on any of these, e.g. «who am I», «what is my access», «what is today's date».",
  input: z.object({}),
  kind: "read",
  area: "ai",
  level: "view",
  async run(ctx) {
    const today = orgToday(ctx);
    const perms = ctx.member.id ? permissionMap(ctx.member.role, ctx.member.overrides) : null;
    const access: Record<string, { level: string; title_fa: string; level_fa: string }> = {};
    for (const a of Object.keys(AREAS) as Area[]) {
      const level = perms ? perms[a] : ctx.can(a, "full") ? "full" : ctx.can(a, "edit") ? "edit" : ctx.can(a, "view") ? "view" : "none";
      access[a] = { level, title_fa: AREAS[a], level_fa: LEVEL_FA[level] };
    }
    const members = await ctx.db.one<{ n: number }>(`select count(*)::int as n from sm_org_members where org_id = $1 and deleted_at is null and is_active`, [ctx.org.id]);
    const j = toJalali(today);
    return {
      data: {
        organisation: {
          name: ctx.org.name,
          legal_name: ctx.org.legal_name ?? null,
          city: ctx.org.city ?? null,
          modules: MODULES.filter((m) => ctx.hasModule(m.key)).map((m) => ({ key: m.key, title_fa: m.title })),
          active_members: members?.n ?? 0,
        },
        today: {
          iso: today,
          jalali: formatJalali(today),
          jalali_long: formatJalali(today, { style: "full" }),
          weekday_fa: WEEKDAYS[weekday(today)],
          jalali_year: j.jy,
          jalali_month: j.jm,
          time_zone: orgTimezone(ctx),
        },
        you: {
          name: ctx.user.full_name,
          email: ctx.user.email,
          role: ctx.member.id ? ctx.member.role : "support",
          role_fa: ctx.member.id ? ROLES[ctx.member.role]?.title : "پشتیبانی",
          access,
        },
        notes: [
          "Weeks start on Saturday; months, quarters (seasons) and years are Jalali.",
          "Use the calculate tool for any arithmetic; never compute numbers mentally.",
          "Answer only from what the tools return; anything outside the caller's access is not available to you either.",
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
    "Exact decimal calculator. Supports + - * / (also × ÷), parentheses, unary minus, percent (\"20%\" = 0.2, \"1200 * 9%\"), Persian/Arabic digits and the Persian scale words for thousand, million, billion and trillion. No variables or functions. Use it for EVERY sum, difference, ratio, percentage or unit conversion you state. Returns the exact result and a rounded one.",
  input: z.object({
    expression: z.string().min(1).max(500).describe("Arithmetic expression, e.g. \"(125 - 98) / 98 * 100\""),
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
    unit: z.string().max(30).nullish().describe("Unit shown on the axis, e.g. «نفر», «مورد»"),
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
