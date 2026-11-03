// Planning tools: forecasts, who to collect from, the cheque calendar, inventory advice and
// rule-based anomalies. Numbers come from ../features/ops.ts and ../features/forecasts.ts.
import { z } from "zod";
import { D } from "@shared/money";
import { addDays } from "@shared/jalali";
import { forbidden } from "../../../http/errors";
import { FORECAST_SERIES, forecast as runForecast } from "../features/forecasts";
import { ANOMALY_RULES_FA, chequesCalendar, deadStock, findAnomalies, receivables, reorderAdvice, repricingAdvice, stockItems } from "../features/ops";
import { defineTool } from "./registry";
import { bounded, fmtMoney, jd, moneyInfo, partyName, period, periodInput, reportRef } from "./common";

export const forecastTool = defineTool({
  name: "forecast",
  title_fa: "پیش‌بینی",
  description:
    "Deterministic forecasts from the business's own records, always as ranges (p10 = pessimistic, p50 = middle, p90 = optimistic) with the method and its measured accuracy (backtest MASE < 1 beats a naive forecast; coverage80 should be near 0.8). series=cashflow: cash + bank balance for the next 13 weeks from balances, cheques due both ways, open invoices with predicted payment dates and average recurring costs; flags shortfall weeks. series=sales: net sales per Jalali month (or week) — optional item or category. series=demand: units sold of a goods item / category / all (intermittent demand uses Croston/SBA/TSB). series=rate: price ranges of gold18, mazaneh, coin:<board key> or fx:<currency code> for 1, 7 and 30 days from EWMA volatility (the middle is today's price — no direction is implied). Refuses with a reason when the data is too thin. Never give buy/sell advice from it.",
  input: z.object({
    series: z.enum(FORECAST_SERIES),
    grain: z.enum(["month", "week"]).nullish(),
    horizon: z.number().int().min(1).max(26).nullish().describe("periods ahead (months ≤ 12, weeks ≤ 26)"),
    item: z.string().max(120).nullish(),
    category: z.string().max(120).nullish(),
    rate: z.string().max(60).nullish().describe("series=rate: gold18 | mazaneh | coin:<key> | fx:<code>"),
  }),
  kind: "read",
  area: "ai",
  level: "view",
  async run(ctx, input, rt) {
    const out = await runForecast(ctx, input.series, { grain: input.grain ?? undefined, horizon: input.horizon ?? undefined, item: input.item, category: input.category, rate: input.rate }, rt.today);
    const s = out.series;
    const rows = [
      ...s.history.slice(-24).map((h) => ({ label: h.period, actual: Number(h.value) })),
      ...s.forecast.map((f) => ({ label: f.period, p10: Number(f.p10), p50: Number(f.p50), p90: Number(f.p90) })),
    ];
    const data_ref = rows.length > 1 ? await rt.putData(rows, { title: s.title_fa }) : undefined;
    const details = { ...out.details };
    if (Array.isArray((details as { weeks?: unknown[] }).weeks)) (details as { weeks: unknown[] }).weeks = (details as { weeks: unknown[] }).weeks.slice(0, 13);
    return {
      data: { ...s, history: s.history.slice(-24), history_total: s.history.length, details, data_ref: data_ref ?? null },
      data_ref,
      chart: data_ref && s.forecast.length
        ? { kind: "line", title: s.title_fa, x: "label", series: [{ field: "actual", label: "واقعی" }, { field: "p10", label: "بدبینانه" }, { field: "p50", label: "میانه" }, { field: "p90", label: "خوش‌بینانه" }], unit: s.unit }
        : undefined,
      refs: [...out.refs, reportRef("forecast", "پیش‌بینی‌ها", `reports/forecast?series=${input.series}`)],
      summary_fa: s.refused_reason_fa ? `پیش‌بینی ممکن نشد: ${s.refused_reason_fa}` : s.title_fa,
    };
  },
});

export const receivablesCollection = defineTool({
  name: "receivables_collection",
  title_fa: "اولویت وصول مطالبات",
  description:
    "Customers who owe the business, ranked for collection: receivable balance (ledger), overdue amount of open sales invoices and the oldest due date, bounced cheques, past payment delays and the credit limit, with a late-payment score 0–100 (an invoice without a due date is due 30 days after its date) (rule: 35% days overdue, 25% average past delay, 20% bounced cheques, 10% share of late payments, 10% over credit limit), its band (high ≥ 60, medium ≥ 30) and confidence by the amount of history (score withheld when fewer than 2 settled invoices and nothing overdue). Money in the base currency. The score is a rule, not a credit rating — explain the reasons.",
  input: z.object({ limit: z.number().int().min(1).max(50).default(15) }),
  kind: "read",
  area: "reports",
  level: "view",
  async run(ctx, input, rt) {
    const m = await moneyInfo(ctx);
    const r = await receivables(ctx, rt.today);
    const b = bounded(r.rows, input.limit);
    const rows = b.rows.map((x) => ({
      party: partyName(x.name, x.code, rt), party_id: x.party_id, balance: fmtMoney(x.balance, m), overdue: fmtMoney(x.overdue, m), oldest_due_fa: jd(x.oldest_due), days_overdue: x.days_overdue,
      open_invoices: x.open_invoices, bounced_cheques: x.bounced_cheques, avg_delay_days: x.avg_delay_days, over_credit_limit: x.over_limit,
      score: x.score, band: x.band, confidence: x.confidence, reasons_fa: x.reasons_fa,
    }));
    const data_ref = rows.length ? await rt.putData(b.rows.map((x) => ({ party: partyName(x.name, x.code, rt), balance: x.balance, overdue: x.overdue, days_overdue: x.days_overdue, score: x.score ?? "" })), { title: "اولویت وصول" }) : undefined;
    return {
      data: { as_of_fa: jd(rt.today), unit: m.unit, debtors: r.debtors, total_balance: fmtMoney(r.total_balance, m), total_overdue: fmtMoney(r.total_overdue, m), rows, more: b.truncated },
      data_ref,
      table: data_ref ? { title: "اولویت وصول مطالبات", columns: [{ key: "party", title: "شخص" }, { key: "balance", title: "مانده", numeric: true }, { key: "overdue", title: "معوق", numeric: true }, { key: "days_overdue", title: "روز تأخیر", numeric: true }, { key: "score", title: "امتیاز", numeric: true }], total_rows: r.rows.length } : undefined,
      refs: b.rows.slice(0, 10).map((x) => x.ref),
      summary_fa: `${r.debtors} بدهکار، معوق ${fmtMoney(r.total_overdue, m)}`,
    };
  },
});

export const chequesCalendarTool = defineTool({
  name: "cheques_calendar",
  title_fa: "تقویم چک‌ها",
  description:
    "Open cheques due in a period (default: the next 8 weeks), both received (to collect) and issued (to pay), totalled per Jalali week (Saturday–Friday) with the net, the projected cash + bank balance after each week and shortfall weeks; overdue open cheques before the period; and risky received cheques (their drawer has bounced a cheque before). Money in the base currency.",
  input: z.object({ period: periodInput.nullish() }),
  kind: "read",
  area: "treasury",
  level: "view",
  async run(ctx, input, rt) {
    const m = await moneyInfo(ctx);
    const per = input.period && (input.period.preset || input.period.from || input.period.to) ? await period(ctx, input.period, rt.today, "this_month") : null;
    const from = per?.from ?? rt.today;
    const to = per?.to ?? addDays(rt.today, 55);
    const c = await chequesCalendar(ctx, from, to, rt.today);
    const weeks = c.weeks.map((w) => ({
      week_fa: `${jd(w.week_start)} تا ${jd(w.week_end)}`, received: w.received, received_count: w.received_count, issued: w.issued, issued_count: w.issued_count, net: w.net, projected_cash: w.projected_cash, shortfall: w.shortfall,
    }));
    const data_ref = weeks.length ? await rt.putData(weeks.map((w) => ({ label: w.week_fa, received: Number(w.received), issued: Number(w.issued), net: Number(w.net) })), { title: "تقویم چک‌ها" }) : undefined;
    return {
      data: {
        from_fa: jd(from), to_fa: jd(to), unit: m.unit, opening_cash_bank: c.opening_cash_bank, totals: c.totals, overdue_before_period: c.overdue_before, weeks,
        shortfall_weeks_fa: c.shortfall_weeks.map((w) => jd(w)),
        risky_received: c.risky.slice(0, 10).map((r) => ({ party: rt.dataPolicy === "aggregates" ? null : r.party, amount: fmtMoney(r.amount, m), due_fa: jd(r.due_date), prior_bounces: r.prior_bounces })),
      },
      data_ref,
      chart: data_ref ? { kind: "bar", title: "چک‌های دریافتی و پرداختی هر هفته", x: "label", series: [{ field: "received", label: "دریافتی" }, { field: "issued", label: "پرداختی" }], unit: m.unit } : undefined,
      refs: [reportRef("cheques_due", "سررسید چک‌ها", "treasury/cheques-due"), ...c.risky.slice(0, 5).map((r) => r.ref)],
      summary_fa: `${c.totals.received_count + c.totals.issued_count} چک تا ${jd(to)}`,
    };
  },
});

export const inventoryAdvice = defineTool({
  name: "inventory_advice",
  title_fa: "پیشنهاد انبار",
  description:
    "Goods inventory advice from stock and the last 90 days of sales: mode=reorder — items at/below their reorder point or with fewer than 14 days of cover, with average daily sales, days of cover and a suggested order quantity (up to max stock, else 45 days of sales); mode=dead_stock — items holding stock with no sale in 90 days, by tied-up value; mode=repricing — items sold below cost or with a margin under 5% (cost = the higher of average cost and last purchase cost), with a suggested price at the business's median margin. Quantities in the item's main unit, money in the base currency. Suggestions only.",
  input: z.object({ mode: z.enum(["reorder", "dead_stock", "repricing"]), limit: z.number().int().min(1).max(50).default(15) }),
  kind: "read",
  area: "inventory",
  level: "view",
  modules: ["goods"],
  async run(ctx, input, rt) {
    if (input.mode === "repricing" && !ctx.can("reports", "view")) throw forbidden("پیشنهاد قیمت به دسترسی گزارش‌ها نیاز دارد");
    const m = await moneyInfo(ctx);
    const items = await stockItems(ctx, rt.today);
    if (input.mode === "reorder") {
      const r = reorderAdvice(items);
      const b = bounded(r, input.limit);
      return {
        data: { mode: input.mode, unit: m.unit, rows: b.rows.map((x) => ({ item: x.item.name, code: x.item.code, item_id: x.item.id, stock: x.item.qty, avg_daily_sales: x.daily, cover_days: x.cover_days, reorder_point: x.item.reorder_point, suggested_order_qty: x.order_qty, reason_fa: x.reason_fa })), total: r.length, more: b.truncated },
        refs: b.rows.slice(0, 10).map((x) => x.ref),
        summary_fa: `${r.length} کالا نیاز به سفارش`,
      };
    }
    if (input.mode === "dead_stock") {
      const r = deadStock(items, rt.today);
      const b = bounded(r, input.limit);
      const value = r.reduce((a, x) => a.plus(D(x.item.value)), D(0));
      return {
        data: { mode: input.mode, unit: m.unit, tied_up_value: fmtMoney(value, m), rows: b.rows.map((x) => ({ item: x.item.name, code: x.item.code, item_id: x.item.id, stock: x.item.qty, value: fmtMoney(x.item.value, m), last_sale_fa: jd(x.item.last_sale), idle_days: x.idle_days })), total: r.length, more: b.truncated },
        refs: b.rows.slice(0, 10).map((x) => x.ref),
        summary_fa: `${r.length} کالای راکد، ${fmtMoney(value, m)}`,
      };
    }
    const r = repricingAdvice(items, m.dp);
    const b = bounded(r, input.limit);
    return {
      data: { mode: input.mode, unit: m.unit, rows: b.rows.map((x) => ({ item: x.item.name, code: x.item.code, item_id: x.item.id, sale_price: fmtMoney(x.item.sale_price ?? 0, m), cost: fmtMoney(x.cost, m), margin_pct: x.margin_pct, suggested_price: fmtMoney(x.suggested_price, m), reason_fa: x.reason_fa })), total: r.length, more: b.truncated },
      refs: b.rows.slice(0, 10).map((x) => x.ref),
      summary_fa: `${r.length} کالا با قیمت نیازمند بازبینی`,
    };
  },
});

export const findAnomaliesTool = defineTool({
  name: "find_anomalies",
  title_fa: "یافتن موارد غیرعادی",
  description:
    `Rule-based checks of a period (default: the last 30 days) — ${Object.entries(ANOMALY_RULES_FA).map(([k]) => k).join(", ")}: likely duplicate documents, documents cancelled after posting or deleted, vouchers recorded more than 7 days after their date, goods sold below cost, deal/document rates more than 3% from the recorded market rate, negative stock, negative cash boxes, several currency deals of one party just below the KYC threshold that together exceed it, and remittances far above the usual size. Each finding has a severity, facts and links. These are flags to review, not accusations — explain them neutrally.`,
  input: z.object({ period: periodInput.nullish() }),
  kind: "read",
  area: "reports",
  level: "view",
  async run(ctx, input, rt) {
    const per = await period(ctx, input.period ?? { preset: "last_30_days" }, rt.today, "last_30_days");
    const list = await findAnomalies(ctx, per.from, per.to);
    const b = bounded(list, 30);
    return {
      data: {
        period: { from_fa: per.from_fa, to_fa: per.to_fa, label_fa: per.label_fa },
        count: list.length,
        by_rule: Object.fromEntries(Object.keys(ANOMALY_RULES_FA).map((k) => [k, list.filter((a) => a.rule === k).length]).filter(([, n]) => n)),
        rows: b.rows.map((a) => ({ rule: a.rule, title_fa: a.title_fa, severity: a.severity, detail_fa: a.detail_fa, facts: a.facts })),
        more: b.truncated,
      },
      refs: b.rows.flatMap((a) => a.refs).slice(0, 12),
      summary_fa: list.length ? `${list.length} مورد برای بررسی` : "مورد غیرعادی پیدا نشد",
    };
  },
});
