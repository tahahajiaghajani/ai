// analyze_metric: one number of the business (sales, profit, balances, gold sold…) over a Jalali
// period, grouped by time or by a dimension, optionally compared with the previous period or the
// same period last year. The SQL comes from the metrics catalogue (../analytics/metrics.ts), with
// the organisation and posted-status filters added by code.
import { z } from "zod";
import type { Ctx } from "../../../context";
import type { AiChartSpec } from "@shared/ai/types";
import { D } from "@shared/money";
import { isUuid } from "@shared/id";
import { normalizeDigits } from "@shared/money";
import { bad, forbidden } from "../../../http/errors";
import { COMPARE_MODES, comparePeriod } from "../analytics/period";
import { DIMENSIONS, DIMENSION_FA, METRICS, METRIC_KEYS, metricAllowed, metricDef, metricDims, runMetric, type MetricFilters, type MetricResult, type MetricUnit } from "../analytics/metrics";
import { defineTool } from "./registry";
import { changePct, faNorm, faSql, moneyInfo, period, periodInput, resolveAccount, resolveCurrency, resolveItem, resolveParty, type MoneyInfo } from "./common";

export function unitOf(u: MetricUnit, m: MoneyInfo): string {
  return u === "money" ? m.unit : u === "grams750" ? "گرم (معادل ۷۵۰)" : "عدد";
}

async function resolveCategory(ctx: Ctx, q: string): Promise<string> {
  const s = q.trim();
  if (isUuid(s)) return s;
  const rows = await ctx.db.query<{ id: string }>(
    `select id from tz_item_categories where org_id = $1 and deleted_at is null and (${faSql("name")} = $2 or code = $3)
     union all select id from tz_gold_categories where org_id = $1 and deleted_at is null and (${faSql("name")} = $2 or code = $3) limit 2`,
    [ctx.org.id, faNorm(s), normalizeDigits(s)],
  );
  if (rows.length !== 1) throw bad(rows.length ? `چند گروه با «${s}» هست؛ شناسه را بدهید` : `گروه «${s}» پیدا نشد`);
  return rows[0].id;
}

/** Time buckets sent to the model: the first few and the most recent ones. */
const TIME_ROWS_MAX = 60;
const TIME_ROWS_HEAD = 12;

const metricList = METRICS.map((m) => `${m.key} (${m.about})`).join(" ");

export const analyzeMetric = defineTool({
  name: "analyze_metric",
  title_fa: "تحلیل شاخص",
  description:
    `Measures one business metric over a period with server-side SQL (posted documents only), grouped by time (day | week | month — Jalali, weeks start Saturday) or by a dimension, with an optional comparison. Metrics: ${metricList} Dimensions: none, day, week, month, party, item, category, user, payment_method, product_type (goods/service/jewelry/coin/bar/melted), account, currency — not every metric has every dimension. Flow metrics sum over the period; balance metrics are the balance at the end of the period (or of each bucket). Returns rows (top \`limit\` for non-time dimensions), the total, the comparison and a data_ref for render_chart. Money is in the base currency unit.`,
  input: z.object({
    metric: z.enum(METRIC_KEYS),
    period: periodInput.nullish(),
    group_by: z.enum(DIMENSIONS).default("none"),
    filters: z
      .object({
        party: z.string().max(120).nullish().describe("party id or exact name/code/national id/mobile"),
        item: z.string().max(120).nullish().describe("item id or exact code/name"),
        category: z.string().max(120).nullish().describe("item or gold category id or exact name"),
        currency: z.string().max(40).nullish().describe("currency code (USD, EUR, USDT…) — fx metrics"),
        account: z.string().max(120).nullish().describe("account id/code — income/expenses only"),
        product_type: z.enum(["goods", "service", "jewelry", "coin", "bar", "melted"]).nullish(),
      })
      .partial()
      .nullish(),
    compare_to: z.enum(COMPARE_MODES).nullish(),
    limit: z.number().int().min(1).max(50).default(15),
  }),
  kind: "read",
  area: "ai",
  level: "view",
  async run(ctx, input, rt) {
    const def = metricDef(input.metric);
    if (!def) throw bad("شاخص پشتیبانی نمی‌شود");
    if (!metricAllowed(ctx, def)) throw forbidden(`دسترسی دیدن «${def.title_fa}» را ندارید یا بخش آن فعال نیست`);
    const dims = metricDims(def);
    if (!dims.includes(input.group_by)) throw bad(`«${def.title_fa}» تفکیک «${DIMENSION_FA[input.group_by]}» ندارد؛ یکی از این‌ها: ${dims.map((d) => DIMENSION_FA[d]).join("، ")}`);
    const m = await moneyInfo(ctx);
    const per = await period(ctx, input.period ?? null, rt.today, "this_month");
    const f = input.filters ?? {};
    const filters: MetricFilters = {};
    if (f.party) filters.party_id = (await resolveParty(ctx.db, ctx, f.party)).id;
    if (f.item) filters.item_id = (await resolveItem(ctx.db, ctx, f.item, ["goods", "service", "coin"])).id;
    if (f.category) filters.category_id = await resolveCategory(ctx, f.category);
    if (f.currency) filters.currency_id = (await resolveCurrency(ctx.db, ctx, f.currency)).id;
    if (f.account && def.kind === "flow") filters.account_id = (await resolveAccount(ctx.db, ctx, f.account)).id;
    if (f.product_type) filters.product_type = f.product_type;

    const res = await runMetric(ctx, def, per, input.group_by, filters);
    let cmp: MetricResult | null = null;
    const cmpPeriod = input.compare_to ? comparePeriod(per, input.compare_to) : null;
    if (cmpPeriod) cmp = await runMetric(ctx, def, cmpPeriod, input.group_by, filters);

    const unit = unitOf(def.unit, m);
    const time = input.group_by === "day" || input.group_by === "week" || input.group_by === "month";
    const prevByKey = new Map((cmp?.rows ?? []).map((r) => [r.key, r.value]));
    const prevByIndex = cmp?.rows ?? [];
    const rows = res.rows.map((r, i) => {
      const prev = time ? prevByIndex[i]?.value : prevByKey.get(r.key);
      return { key: r.key, label: r.label, value: r.value, ...(cmp ? { previous: prev ?? "0", change_pct: changePct(r.value, prev ?? "0") } : {}) };
    });
    // time buckets are bounded too (a year of days would not fit in a tool result): the first and
    // the most recent buckets, the whole series stays in data_ref for the chart
    const omitted = time && rows.length > TIME_ROWS_MAX ? rows.length - TIME_ROWS_MAX : 0;
    const shown = time ? (omitted ? [...rows.slice(0, TIME_ROWS_HEAD), ...rows.slice(rows.length - (TIME_ROWS_MAX - TIME_ROWS_HEAD))] : rows) : rows.slice(0, input.limit);
    // "aggregates": parties and members are not named to the model (ranked placeholders instead)
    const anonymous = rt.dataPolicy === "aggregates" && (input.group_by === "party" || input.group_by === "user");
    const modelRows = anonymous ? shown.map((r, i) => ({ ...r, key: undefined, label: `${input.group_by === "party" ? "شخص" : "کاربر"} ${i + 1}` })) : shown;
    let data_ref: string | undefined;
    let chart: AiChartSpec | undefined;
    if (input.group_by !== "none" && rows.length) {
      data_ref = await rt.putData(rows.slice(0, 400).map((r) => ({ ...r, value: Number(r.value), ...(cmp ? { previous: Number(r.previous) } : {}) })), { title: def.title_fa });
      chart = {
        kind: time ? (def.kind === "balance" ? "area" : "line") : "bar",
        title: `${def.title_fa} — ${per.label_fa}`,
        x: "label",
        series: [{ field: "value", label: per.label_fa }, ...(cmp && cmpPeriod ? [{ field: "previous", label: cmpPeriod.label_fa }] : [])],
        unit,
      };
    }
    const others = !time && rows.length > shown.length ? rows.slice(shown.length).reduce((a, r) => a.plus(D(r.value)), D(0)).toString() : null;
    // totals, the comparison and the notes come before the rows: a cut-off result keeps them
    return {
      data: {
        metric: def.key,
        title_fa: def.title_fa,
        definition: def.about,
        unit,
        period: { from: per.from, to: per.to, from_fa: per.from_fa, to_fa: per.to_fa, label_fa: per.label_fa },
        group_by: input.group_by,
        total: res.total,
        documents: res.documents,
        comparison: cmp && cmpPeriod
          ? { period: { from_fa: cmpPeriod.from_fa, to_fa: cmpPeriod.to_fa, label_fa: cmpPeriod.label_fa }, total: cmp.total, change: D(res.total).minus(D(cmp.total)).toString(), change_pct: changePct(res.total, cmp.total) }
          : null,
        sources: res.sources,
        notes: res.notes,
        data_ref: data_ref ?? null,
        rows_total: rows.length,
        others_total: others,
        ...(omitted ? { rows_omitted: `${omitted} buckets between the first ${TIME_ROWS_HEAD} and the last ${TIME_ROWS_MAX - TIME_ROWS_HEAD} are left out here (all are in data_ref); use a coarser group_by for the whole series` } : {}),
        rows: modelRows,
      },
      data_ref,
      chart,
      summary_fa: `${def.title_fa} — ${per.label_fa}`,
    };
  },
});
