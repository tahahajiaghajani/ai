// «خلاصهٔ امروز»: the day's facts the member may see (sales, cash, cheques, receivables, rates)
// and the top insights, with a short Persian narrative written by the fast model when AI is
// available, otherwise by a template. Cached per member per day.
import { z } from "zod";
import type { Ctx } from "../../../context";
import type { AiInsight } from "@shared/ai/types";
import type { AiBriefView } from "@shared/ai/api";
import { D } from "@shared/money";
import { formatNumber } from "@shared/format";
import { addDays, formatJalali } from "@shared/jalali";
import { formatJalaliDateTime } from "@shared/jalali";
import { latestRate } from "../../gold/rates";
import { comparePeriod, presetPeriod } from "../analytics/period";
import { metricAllowed, metricDef, runMetric } from "../analytics/metrics";
import { cashAndBank, chequesCalendar, receivables } from "./ops";
import { listInsights } from "./insights";
import { SYSTEM_RULES, dataBlock, narrate } from "./narrative";
import { businessToday, changePct, fmtMoney, moneyInfo } from "../tools/common";

export type BriefView = AiBriefView;

async function facts(ctx: Ctx, today: string): Promise<BriefView["facts"]> {
  const m = await moneyInfo(ctx);
  const out: BriefView["facts"] = [];
  const sales = metricDef("sales_amount")!;
  if (metricAllowed(ctx, sales)) {
    const day = await runMetric(ctx, sales, presetPeriod("today", today), "none");
    const mtd = presetPeriod("month_to_date", today);
    const cur = await runMetric(ctx, sales, mtd, "none");
    const prevP = comparePeriod(mtd, "previous_period");
    const prev = await runMetric(ctx, sales, { ...prevP, to: addDays(prevP.from, mtd.days - 1) }, "none");
    const pct = changePct(cur.total, prev.total);
    out.push({ key: "sales_today", label: "فروش امروز", value: fmtMoney(day.total, m), hint: `${day.documents ?? 0} سند`, tone: D(day.total).gt(0) ? "in" : null, path: ctx.hasModule("goods") ? "sales/invoices" : null });
    out.push({ key: "sales_mtd", label: "فروش این ماه تا امروز", value: fmtMoney(cur.total, m), hint: pct === null ? null : `${D(pct).gt(0) ? "+" : ""}${formatNumber(pct, { dp: 1 })}٪ نسبت به همین مدت ماه قبل`, tone: pct !== null && D(pct).lt(-20) ? "warning" : null, path: ctx.hasModule("goods") ? "sales/reports" : null });
  }
  if (ctx.can("treasury", "view")) {
    const cash = await cashAndBank(ctx, today);
    out.push({ key: "cash_bank", label: "موجودی صندوق و بانک", value: fmtMoney(cash.total, m), hint: null, tone: D(cash.total).lt(0) ? "danger" : null, path: "treasury/book" });
    const ch = await chequesCalendar(ctx, today, addDays(today, 6), today);
    out.push({ key: "cheques_in_7d", label: "چک‌های دریافتی ۷ روز آینده", value: fmtMoney(ch.totals.received, m), hint: `${ch.totals.received_count} چک`, tone: D(ch.totals.received).gt(0) ? "in" : null, path: "treasury/cheques/due" });
    out.push({ key: "cheques_out_7d", label: "چک‌های پرداختی ۷ روز آینده", value: fmtMoney(ch.totals.issued, m), hint: `${ch.totals.issued_count} چک`, tone: D(ch.totals.issued).gt(D(cash.total)) ? "danger" : D(ch.totals.issued).gt(0) ? "warning" : null, path: "treasury/cheques/due" });
  }
  if (ctx.can("reports", "view")) {
    const r = await receivables(ctx, today, { limit: 1 });
    out.push({ key: "overdue", label: "مطالبات معوق", value: fmtMoney(r.total_overdue, m), hint: `از ${fmtMoney(r.total_balance, m)} کل مطالبات`, tone: D(r.total_overdue).gt(0) ? "warning" : null, path: "reports/detail-balances" });
  }
  if (ctx.hasModule("gold") && ctx.can("gold", "view")) {
    const rate = (await latestRate(ctx.db, ctx.org.id)) as Record<string, any> | null;
    if (rate?.gram18) out.push({ key: "gold18", label: "نرخ گرم ۱۸", value: fmtMoney(rate.gram18, m), hint: `ثبت ${formatJalaliDateTime(rate.at)}`, path: "gold/rates" });
  }
  if (ctx.hasModule("fx") && ctx.can("fx", "view")) {
    const usd = await ctx.db.one<{ sell: string | null; at: string }>(
      `select r.sell, r.at from tz_fx_rates r join tz_currencies c on c.id = r.currency_id
       where r.org_id = $1 and c.code = 'USD' and r.quote_currency_id is null and r.deleted_at is null order by r.at desc limit 1`,
      [ctx.org.id],
    );
    if (usd?.sell) out.push({ key: "usd", label: "نرخ فروش دلار", value: fmtMoney(usd.sell, m), hint: `ثبت ${formatJalaliDateTime(usd.at)}`, path: "fx/rates" });
  }
  return out;
}

/** Without a model: what needs attention today (the numbers themselves are the facts beside it). */
function template(f: BriefView["facts"], ins: AiInsight[]): string {
  const lines = ins.length ? ins.map((i) => `- **${i.title_fa}**: ${i.body_fa}`) : ["مورد فوری‌ای برای امروز دیده نشد."];
  const mtd = f.find((x) => x.key === "sales_mtd");
  if (mtd) lines.push("", `فروش این ماه تا امروز ${mtd.value}${mtd.hint ? ` (${mtd.hint})` : ""}.`);
  return lines.join("\n");
}

const briefSchema = z.object({ markdown: z.string().min(20).max(4000) });

const KEY = (orgId: string, userId: string) => `ai.brief:${orgId}:${userId}`;

export async function dailyBrief(ctx: Ctx, opts: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<BriefView> {
  const today = businessToday(ctx);
  if (!opts.refresh) {
    const cached = await ctx.db.one<{ value: BriefView }>(`select value from tz_kv where key = $1`, [KEY(ctx.org.id, ctx.user.id)]);
    if (cached?.value?.day === today) return cached.value;
  }
  const f = await facts(ctx, today);
  const ins = (await listInsights(ctx)).insights.filter((i) => i.status !== "dismissed").slice(0, 5);
  const date = formatJalali(today, { style: "full" });
  const data = { date, facts: f.map(({ label, value, hint }) => ({ label, value, hint })), insights: ins.map((i) => ({ title: i.title_fa, body: i.body_fa, severity: i.severity })) };
  const n = await narrate(
    ctx,
    {
      job: "fast", feature: "brief",
      system: `${SYSTEM_RULES}\nWrite «خلاصهٔ امروز»: 3–6 short markdown bullet lines, the most important first (cash shortfalls, cheques, overdue debts, unusual items), then one line on sales. Reply as JSON {"markdown": "..."}.`,
      prompt: `${dataBlock("brief", data)}\nWrite today's brief from this data only.`,
      schema: briefSchema, facts: data, text: (o) => o.markdown, signal: opts.signal,
    },
    (o) => o.markdown,
    () => template(f, ins),
  );
  const view: BriefView = { day: today, date_fa: date, facts: f, insights: ins, markdown: n.value, source: n.source, model: n.model, note_fa: n.note_fa ?? null, generated_at: new Date().toISOString() };
  await ctx.write(
    (tx) => tx.query(`insert into tz_kv (key, value, updated_at) values ($1, $2::jsonb, now()) on conflict (key) do update set value = excluded.value, updated_at = now()`, [KEY(ctx.org.id, ctx.user.id), JSON.stringify(view)]),
    { internal: true },
  );
  return view;
}
