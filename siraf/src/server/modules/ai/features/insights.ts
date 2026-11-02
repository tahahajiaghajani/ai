// «بینش‌ها»: a deterministic rule engine over the books — cheques due this week (and a shortfall),
// overdue receivables, low and dead stock, the sales trend, coin bubbles and stale rates, gold and
// currency position changes, anomalies and identification gaps. It works with AI switched off.
// Insights are computed once a day per business (for everything, then filtered by each member's
// permission on read) and keep a stable id per condition, so what a member did with one (seen,
// dismissed, snoozed, done) survives the next day's recompute.
import { createHash } from "node:crypto";
import type { Ctx } from "../../../context";
import type { AiInsight, AiRef, AiSeverity } from "@shared/ai/types";
import type { Area } from "@shared/permissions";
import { D } from "@shared/money";
import { addDays, formatJalali } from "@shared/jalali";
import { bad, notFound } from "../../../http/errors";
import { latestRate } from "../../gold/rates";
import { goldSettings } from "../../gold/settings";
import { coinBubbles } from "../../gold/position";
import { presetPeriod, previousMonthToDate } from "../analytics/period";
import { metricDef, runMetric } from "../analytics/metrics";
import { robustZ } from "../analytics/forecast";
import { ANOMALY_RULES_FA, cashAndBank, chequesCalendar, deadStock, findAnomalies, kycGaps, receivables, reorderAdvice, stockItems } from "./ops";
import { cashflow13 } from "./forecasts";
import { businessToday, changePct, fmtMoney, jd, moneyInfo, reportRef, type MoneyInfo } from "../tools/common";
import { loadSettings } from "../settings";

type Module = AiInsight["module"];

export interface InsightDraft {
  key: string;
  kind: string;
  module: Module;
  area: Area;
  severity: AiSeverity;
  title_fa: string;
  body_fa: string;
  why_fa: string;
  facts: { label: string; value: string }[];
  refs: AiRef[];
  action?: { label: string; path?: string; prompt?: string } | null;
  rank: number;
}

const SEVERITY_RANK: Record<AiSeverity, number> = { critical: 400, warning: 300, notice: 200, info: 100 };

export function insightId(orgId: string, key: string): string {
  return createHash("sha256").update(`${orgId}:${key}`).digest("hex").slice(0, 32);
}

/** The engine runs with every permission (it is not a person); rows are filtered per member on read. */
function engineCtx(ctx: Ctx): Ctx {
  return { ...ctx, can: () => true, need: () => undefined };
}

async function safely<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- rules

async function chequeRules(ctx: Ctx, today: string, m: MoneyInfo, out: InsightDraft[]) {
  const c = await chequesCalendar(ctx, today, addDays(today, 6), today);
  const cash = await cashAndBank(ctx, today);
  const rec = D(c.totals.received);
  const iss = D(c.totals.issued);
  if (rec.gt(0) || iss.gt(0)) {
    const after = D(cash.total).plus(rec).minus(iss);
    const short = after.lt(0);
    out.push({
      key: "cheques_due:7d", kind: "cheques_due", module: "treasury", area: "treasury",
      severity: short ? "critical" : iss.gt(rec) ? "warning" : "info",
      title_fa: short ? "کسری نقدینگی برای چک‌های این هفته" : "چک‌های سررسید هفت روز آینده",
      body_fa: `${c.totals.received_count} چک دریافتی به مبلغ ${fmtMoney(rec, m)} و ${c.totals.issued_count} چک پرداختی به مبلغ ${fmtMoney(iss, m)} تا ${jd(addDays(today, 6))} سررسید می‌شود؛ خالص ${fmtMoney(rec.minus(iss), m)}.${short ? ` موجودی صندوق و بانک (${fmtMoney(cash.total, m)}) برای پرداخت‌ها کافی نیست.` : ""}`,
      why_fa: "چک‌های باز (در دست، در جریان وصول و پرداختی وصول‌نشده) با سررسید هفت روز آینده جمع زده شده و با موجودی دفتری صندوق و بانک مقایسه شده است.",
      facts: [
        { label: "دریافتی", value: fmtMoney(rec, m) }, { label: "پرداختی", value: fmtMoney(iss, m) }, { label: "خالص", value: fmtMoney(rec.minus(iss), m) },
        { label: "موجودی صندوق و بانک", value: fmtMoney(cash.total, m) },
      ],
      refs: [reportRef("cheques_due", "سررسید چک‌ها", "treasury/cheques-due"), ...c.risky.slice(0, 3).map((r) => r.ref)],
      action: { label: "سررسید چک‌ها", path: "treasury/cheques-due", prompt: "چک‌های هفتهٔ آینده و کسری احتمالی را بررسی کن" },
      rank: 0,
    });
  }
  const od = c.overdue_before;
  if (od.received_count + od.issued_count > 0) {
    out.push({
      key: "cheques_overdue", kind: "cheques_overdue", module: "treasury", area: "treasury", severity: "warning",
      title_fa: "چک‌های سررسیدگذشته",
      body_fa: `${od.received_count} چک دریافتی (${fmtMoney(od.received, m)}) و ${od.issued_count} چک پرداختی (${fmtMoney(od.issued, m)}) از سررسیدشان گذشته و هنوز تعیین تکلیف نشده‌اند.`,
      why_fa: "چک‌هایی که تاریخ سررسیدشان گذشته ولی وضعیتشان هنوز «در دست»، «در جریان وصول» یا «صادرشده» است.",
      facts: [{ label: "دریافتی", value: fmtMoney(od.received, m) }, { label: "پرداختی", value: fmtMoney(od.issued, m) }],
      refs: [reportRef("cheques", "چک‌ها", "treasury/cheques")],
      action: { label: "چک‌ها", path: "treasury/cheques" },
      rank: 0,
    });
  }
}

async function cashRule(ctx: Ctx, today: string, m: MoneyInfo, out: InsightDraft[]) {
  const f = await cashflow13(ctx, today, m);
  const weeks = (f.details as { weeks: { label: string; closing_p50: string; closing_p10: string; shortfall: boolean; risk: boolean }[] }).weeks;
  const first = weeks.find((w) => w.shortfall) ?? weeks.find((w) => w.risk);
  if (!first) return;
  const sure = first === weeks.find((w) => w.shortfall);
  out.push({
    key: "cash_shortfall", kind: "cash_shortfall", module: "treasury", area: "treasury", severity: sure ? "critical" : "warning",
    title_fa: sure ? "کسری نقدینگی در ۱۳ هفتهٔ آینده" : "احتمال کسری نقدینگی",
    body_fa: `در ${first.label} موجودی پیش‌بینی‌شدهٔ صندوق و بانک ${sure ? `به ${fmtMoney(first.closing_p50, m)} می‌رسد` : `در حالت بدبینانه به ${fmtMoney(first.closing_p10, m)} می‌رسد`}.`,
    why_fa: "از موجودی امروز، چک‌های سررسید دو طرف، فاکتورهای باز با تاریخ پرداخت پیش‌بینی‌شده و میانگین هزینه‌های جاری ساخته شده است.",
    facts: [{ label: "هفته", value: first.label }, { label: "میانه", value: fmtMoney(first.closing_p50, m) }, { label: "بدبینانه", value: fmtMoney(first.closing_p10, m) }],
    refs: [reportRef("forecast", "پیش‌بینی جریان نقد", "reports/forecast?series=cashflow")],
    action: { label: "پیش‌بینی جریان نقد", path: "reports/forecast?series=cashflow", prompt: "برای جبران کسری نقدینگی پیش‌بینی‌شده برنامه بده" },
    rank: 0,
  });
}

async function receivableRule(ctx: Ctx, today: string, m: MoneyInfo, out: InsightDraft[]) {
  const r = await receivables(ctx, today, { limit: 3 });
  if (!D(r.total_overdue).gt(0)) return;
  const top = r.rows.filter((x) => D(x.overdue).gt(0));
  out.push({
    key: "overdue_receivables", kind: "overdue_receivables", module: "accounting", area: "reports",
    severity: top.some((x) => x.days_overdue > 60) ? "warning" : "notice",
    title_fa: "مطالبات معوق",
    body_fa: `${fmtMoney(r.total_overdue, m)} از مطالبات از سررسید گذشته است. بیشترین: ${top.map((x) => `«${x.name}» ${fmtMoney(x.overdue, m)}`).join("، ")}.`,
    why_fa: "فاکتورهای فروش ثبت‌شده‌ای که سررسیدشان گذشته و هنوز تسویه نشده‌اند، با ماندهٔ حساب دریافتنی هر شخص سنجیده شده‌اند.",
    facts: [{ label: "کل مطالبات", value: fmtMoney(r.total_balance, m) }, { label: "معوق", value: fmtMoney(r.total_overdue, m) }, { label: "تعداد بدهکاران", value: String(r.debtors) }],
    refs: top.map((x) => x.ref),
    action: { label: "اولویت وصول", prompt: "فهرست اولویت وصول مطالبات را با دلیل‌ها نشان بده" },
    rank: 0,
  });
}

async function stockRules(ctx: Ctx, today: string, m: MoneyInfo, out: InsightDraft[]) {
  const items = await stockItems(ctx, today);
  const low = reorderAdvice(items);
  if (low.length) {
    out.push({
      key: "low_stock", kind: "low_stock", module: "goods", area: "inventory", severity: low.some((x) => D(x.item.qty).lte(0)) ? "warning" : "notice",
      title_fa: "کالاهای نیازمند سفارش",
      body_fa: `${low.length} کالا به نقطهٔ سفارش رسیده یا کمتر از دو هفته فروش موجودی دارد: ${low.slice(0, 3).map((x) => `«${x.item.name}»`).join("، ")}${low.length > 3 ? " و …" : ""}.`,
      why_fa: "موجودی هر کالا با نقطهٔ سفارش آن و با میانگین فروش روزانهٔ ۹۰ روز گذشته مقایسه شده است.",
      facts: [{ label: "تعداد کالا", value: String(low.length) }],
      refs: low.slice(0, 5).map((x) => x.ref),
      action: { label: "موجودی کم", path: "inventory/stock?low=1", prompt: "پیشنهاد سفارش خرید برای کالاهای کم‌موجود بده" },
      rank: 0,
    });
  }
  const dead = deadStock(items, today);
  const value = dead.reduce((a, x) => a.plus(D(x.item.value)), D(0));
  if (dead.length && value.gt(0)) {
    out.push({
      key: "dead_stock", kind: "dead_stock", module: "goods", area: "inventory", severity: "info",
      title_fa: "کالاهای راکد",
      body_fa: `${dead.length} کالا با ارزش ${fmtMoney(value, m)} در ۹۰ روز گذشته فروش نداشته است.`,
      why_fa: "کالاهایی که موجودی دارند و در ۹۰ روز گذشته هیچ فاکتور فروشی نداشته‌اند.",
      facts: [{ label: "ارزش راکد", value: fmtMoney(value, m) }, { label: "تعداد کالا", value: String(dead.length) }],
      refs: dead.slice(0, 5).map((x) => x.ref),
      action: { label: "بررسی", prompt: "برای کالاهای راکد پیشنهاد بده" },
      rank: 0,
    });
  }
}

async function salesRule(ctx: Ctx, today: string, m: MoneyInfo, out: InsightDraft[]) {
  const def = metricDef("sales_amount")!;
  const cur = presetPeriod("month_to_date", today);
  if (cur.days < 5) return;
  const prev = previousMonthToDate(cur);
  const a = await runMetric(ctx, def, cur, "none");
  const b = await runMetric(ctx, def, prev, "none");
  const pct = changePct(a.total, b.total);
  if (pct === null || D(b.total).lte(0) || D(pct).abs().lt(20)) return;
  const up = D(pct).gt(0);
  out.push({
    key: `sales_change:${up ? "up" : "down"}`, kind: "sales_change", module: "core", area: "reports", severity: up ? "info" : "notice",
    title_fa: up ? "رشد فروش این ماه" : "کاهش فروش این ماه",
    body_fa: `فروش ${cur.days} روز اول این ماه ${fmtMoney(a.total, m)} است؛ ${D(pct).abs().toString()}٪ ${up ? "بیشتر" : "کمتر"} از همین مدت در ماه قبل (${fmtMoney(b.total, m)}).`,
    why_fa: "فروش خالص (بدون مالیات) از ابتدای ماه جاری تا امروز با همان تعداد روز از ابتدای ماه قبل مقایسه شده است؛ تغییرهای کمتر از ۲۰٪ نشان داده نمی‌شوند.",
    facts: [{ label: "این ماه", value: fmtMoney(a.total, m) }, { label: "ماه قبل (همان مدت)", value: fmtMoney(b.total, m) }, { label: "تغییر", value: `${D(pct).toString()}٪` }],
    refs: [reportRef("sales", "گزارش فروش", "reports/sales")],
    action: { label: "تحلیل", prompt: "علت تغییر فروش این ماه نسبت به ماه قبل را تحلیل کن" },
    rank: 0,
  });
}

async function goldRules(ctx: Ctx, m: MoneyInfo, out: InsightDraft[]) {
  const s = goldSettings(ctx.org);
  const rate = (await latestRate(ctx.db, ctx.org.id)) as Record<string, any> | null;
  const age = rate ? Math.round((Date.now() - new Date(rate.at).getTime()) / 60000) : null;
  if (!rate || (age !== null && age > s.stale_minutes)) {
    out.push({
      key: "stale_rate:gold", kind: "stale_rate", module: "gold", area: "gold", severity: "warning",
      title_fa: rate ? "نرخ طلا به‌روز نیست" : "نرخ طلا ثبت نشده است",
      body_fa: rate ? `آخرین نرخ طلا ${formatJalali(rate.at.slice(0, 10))} ثبت شده است؛ قیمت‌گذاری فروش و خرید با نرخ قدیمی انجام می‌شود.` : "برای قیمت‌گذاری فروش و خرید طلا، نرخ روز را ثبت کنید.",
      why_fa: `نرخی که بیش از ${s.stale_minutes} دقیقه از ثبتش گذشته باشد قدیمی شمرده می‌شود (از تنظیمات طلا).`,
      facts: rate ? [{ label: "گرم ۱۸", value: fmtMoney(rate.gram18 ?? 0, m) }] : [],
      refs: [reportRef("gold_rates", "نرخ طلا", "gold/rates")],
      action: { label: "ثبت نرخ", path: "gold/rates" },
      rank: 0,
    });
  }
  if (!rate) return;
  const bubbles = await coinBubbles(ctx, 90);
  for (const c of bubbles.rows) {
    const xs = c.history.slice(0, -1).map((h) => Number(h.domestic)).filter(Number.isFinite);
    if (c.domestic === null || xs.length < 10) continue;
    const z = robustZ(Number(c.domestic), xs);
    if (Math.abs(z) < 2.5) continue;
    const med = [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    out.push({
      key: `coin_bubble:${c.key}`, kind: "coin_bubble", module: "gold", area: "gold", severity: "notice",
      title_fa: `حباب ${c.name} ${z > 0 ? "بالاتر" : "پایین‌تر"} از معمول`,
      body_fa: `حباب ${c.name} امروز ${D(c.domestic).toString()}٪ است؛ میانهٔ ۹۰ روز گذشته ${med.toFixed(2)}٪ بوده است.`,
      why_fa: "حباب = قیمت سکه منهای ارزش طلای آن به نرخ گرم ۱۸. حباب امروز با نرخ‌های ثبت‌شدهٔ ۹۰ روز گذشته مقایسه شده است (فاصلهٔ بیش از ۲٫۵ برابر پراکندگی معمول).",
      facts: [{ label: "حباب امروز", value: `${D(c.domestic).toString()}٪` }, ...(c.domestic_amount ? [{ label: "مبلغ حباب", value: fmtMoney(c.domestic_amount, m) }] : [])],
      refs: [reportRef("gold_bubbles", "حباب سکه‌ها", "gold/rates")],
      action: { label: "حباب سکه", prompt: `روند حباب ${c.name} را نشان بده` },
      rank: 0,
    });
  }
  const prev = (await latestRate(ctx.db, ctx.org.id, rate.at)) as Record<string, any> | null;
  if (prev?.gram18 && rate.gram18 && D(prev.gram18).gt(0)) {
    const pct = D(rate.gram18).minus(D(prev.gram18)).div(D(prev.gram18)).times(100);
    if (pct.abs().gte(3)) {
      const own = await ctx.db.one<{ w: string }>(
        `select coalesce(sum(l.w_debit - l.w_credit), 0) as w from tz_voucher_lines l join tz_vouchers v on v.id = l.voucher_id join tz_accounts a on a.id = l.account_id
         where l.org_id = $1 and v.deleted_at is null and v.status in ('posted', 'final') and a.system_key in ('gold_inventory', 'gold_old', 'gold_bullion', 'gold_at_workshop')`,
        [ctx.org.id],
      );
      const w = D(own?.w ?? 0);
      if (w.gt(0)) {
        const delta = w.times(D(rate.gram18).minus(D(prev.gram18))).toDecimalPlaces(m.dp);
        out.push({
          key: "position:gold", kind: "position", module: "gold", area: "gold", severity: "info",
          title_fa: "تغییر ارزش موجودی طلا",
          body_fa: `نرخ گرم ۱۸ ${pct.toDecimalPlaces(2).toString()}٪ تغییر کرده است؛ ارزش ${w.toDecimalPlaces(3).toString()} گرم طلای موجود (معادل ۷۵۰) حدود ${fmtMoney(delta, m)} ${delta.gt(0) ? "بیشتر" : "کمتر"} شده است.`,
          why_fa: "وزن طلای خود کسب‌وکار در دفتر (مصنوعات، آب‌شده، مستعمل و نزد کارگاه) در تغییر دو نرخ آخر گرم ۱۸ ضرب شده است.",
          facts: [{ label: "تغییر نرخ", value: `${pct.toDecimalPlaces(2).toString()}٪` }, { label: "تغییر ارزش", value: fmtMoney(delta, m) }],
          refs: [reportRef("gold_stock", "موجودی طلا", "gold/reports/stock")],
          action: { label: "موقعیت طلا", prompt: "موقعیت طلا و ارز را نشان بده" },
          rank: 0,
        });
      }
    }
  }
}

async function fxRules(ctx: Ctx, m: MoneyInfo, out: InsightDraft[]) {
  const rows = await ctx.db.query<{ code: string; at: string | null; held: string; mid: string | null; prev: string | null }>(
    `select c.code, r.at, coalesce(h.fx, 0) as held, r.mid, p.mid as prev from tz_currencies c
     left join lateral (select at, coalesce(mid, (buy + sell) / 2, sell, buy) as mid from tz_fx_rates where org_id = c.org_id and currency_id = c.id and quote_currency_id is null and deleted_at is null order by at desc limit 1) r on true
     left join lateral (select coalesce(mid, (buy + sell) / 2, sell, buy) as mid from tz_fx_rates where org_id = c.org_id and currency_id = c.id and quote_currency_id is null and deleted_at is null order by at desc offset 1 limit 1) p on true
     left join (select l.currency_id, sum(l.fx_debit - l.fx_credit) as fx from tz_voucher_lines l join tz_vouchers v on v.id = l.voucher_id join tz_accounts a on a.id = l.account_id
                where l.org_id = $1 and v.deleted_at is null and v.status in ('posted', 'final') and a.system_key in ('fx_cash', 'fx_bank', 'crypto_wallets') group by l.currency_id) h on h.currency_id = c.id
     where c.org_id = $1 and c.deleted_at is null and not c.is_base and c.is_active`,
    [ctx.org.id],
  );
  const stale = rows.filter((r) => !D(r.held).isZero() && (!r.at || Date.now() - new Date(r.at).getTime() > 24 * 3600 * 1000));
  if (stale.length) {
    out.push({
      key: "stale_rate:fx", kind: "stale_rate", module: "fx", area: "fx", severity: "notice",
      title_fa: "نرخ ارزهای موجود به‌روز نیست",
      body_fa: `برای ${stale.map((r) => r.code).join("، ")} که موجودی دارید، بیش از یک روز است نرخی ثبت نشده است؛ ارزش موقعیت ارزی با نرخ قدیمی حساب می‌شود.`,
      why_fa: "ارزهایی که در صندوق، بانک یا کیف‌پول موجودی دارند و آخرین نرخشان بیش از ۲۴ ساعت پیش ثبت شده است.",
      facts: stale.slice(0, 6).map((r) => ({ label: r.code, value: r.at ? jd(r.at.slice(0, 10))! : "بدون نرخ" })),
      refs: [reportRef("fx_rates", "تابلوی نرخ", "fx/rates")],
      action: { label: "به‌روزرسانی نرخ", path: "fx/rates" },
      rank: 0,
    });
  }
  const moved = rows
    .filter((r) => !D(r.held).isZero() && r.mid && r.prev && D(r.prev).gt(0))
    .map((r) => ({ code: r.code, pct: D(r.mid!).minus(D(r.prev!)).div(D(r.prev!)).times(100), delta: D(r.held).times(D(r.mid!).minus(D(r.prev!))).toDecimalPlaces(m.dp) }))
    .filter((x) => x.pct.abs().gte(3));
  if (moved.length) {
    const total = moved.reduce((a, x) => a.plus(x.delta), D(0));
    out.push({
      key: "position:fx", kind: "position", module: "fx", area: "fx", severity: total.isNeg() ? "notice" : "info",
      title_fa: "تغییر ارزش موقعیت ارزی",
      body_fa: `با تغییر نرخ ${moved.map((x) => `${x.code} (${x.pct.toDecimalPlaces(2).toString()}٪)`).join("، ")}، ارزش ارزهای موجود حدود ${fmtMoney(total.abs(), m)} ${total.isNeg() ? "کم" : "زیاد"} شده است.`,
      why_fa: "موجودی هر ارز در صندوق، بانک و کیف‌پول در تغییر دو نرخ آخر آن ضرب شده است (تغییرهای کمتر از ۳٪ نشان داده نمی‌شوند).",
      facts: moved.slice(0, 6).map((x) => ({ label: x.code, value: fmtMoney(x.delta, m) })),
      refs: [reportRef("fx_positions", "موقعیت ارزی", "fx/reports/positions")],
      action: { label: "موقعیت ارزی", prompt: "موقعیت ارزی و ریسک آن را نشان بده" },
      rank: 0,
    });
  }
}

async function anomalyRule(ctx: Ctx, today: string, out: InsightDraft[]) {
  const list = await findAnomalies(ctx, addDays(today, -6), today);
  const byRule = new Map<string, typeof list>();
  for (const a of list) byRule.set(a.rule, [...(byRule.get(a.rule) ?? []), a]);
  for (const [rule, xs] of byRule) {
    const sev = xs.some((x) => x.severity === "critical") ? "critical" : xs.some((x) => x.severity === "warning") ? "warning" : "notice";
    out.push({
      key: `anomaly:${rule}`, kind: "anomaly", module: rule === "structuring" || rule === "unusual_remittance" ? "fx" : "accounting", area: "reports", severity: sev,
      title_fa: ANOMALY_RULES_FA[rule] ?? "مورد غیرعادی",
      body_fa: xs.length === 1 ? xs[0].detail_fa : `${xs.length} مورد در هفت روز گذشته؛ از جمله: ${xs[0].detail_fa}`,
      why_fa: "قاعده‌های ثابت روی اسناد هفت روز گذشته اجرا شده‌اند؛ این موارد برای بازبینی است و لزوماً خطا نیست.",
      facts: xs[0].facts,
      refs: xs.flatMap((x) => x.refs).slice(0, 6),
      action: { label: "بررسی", prompt: "موارد غیرعادی هفتهٔ گذشته را توضیح بده" },
      rank: 0,
    });
  }
}

async function kycRule(ctx: Ctx, today: string, m: MoneyInfo, out: InsightDraft[]) {
  const gaps = await kycGaps(ctx, addDays(today, -29), today);
  if (!gaps.length) return;
  const sum = gaps.reduce((a, g) => a.plus(D(g.amount)), D(0));
  out.push({
    key: "kyc", kind: "kyc", module: gaps.some((g) => g.type === "fx_deal") ? "fx" : "gold", area: gaps.some((g) => g.type === "fx_deal") ? "fx" : "gold", severity: "warning",
    title_fa: "معاملات بزرگ بدون احراز هویت",
    body_fa: `${gaps.length} معاملهٔ طلا یا ارز در ۳۰ روز گذشته بالای سقف احراز هویت بوده ولی هویت طرف معامله تأیید نشده است (جمع ${fmtMoney(sum, m)}).`,
    why_fa: "سقف احراز هویت از تنظیمات طلا و صرافی خوانده شده و وضعیت احراز اشخاص بررسی شده است.",
    facts: [{ label: "تعداد", value: String(gaps.length) }, { label: "جمع", value: fmtMoney(sum, m) }],
    refs: gaps.slice(0, 5).map((g) => g.ref),
    action: { label: "بررسی", prompt: "معاملات بدون احراز هویت را فهرست کن" },
    rank: 0,
  });
}

/** Run every rule for the business (each rule guarded; a failing rule is skipped). */
export async function computeInsights(ctx: Ctx, today: string): Promise<InsightDraft[]> {
  const ectx = engineCtx(ctx);
  const m = await moneyInfo(ctx);
  const out: InsightDraft[] = [];
  await safely(() => chequeRules(ectx, today, m, out));
  await safely(() => cashRule(ectx, today, m, out));
  await safely(() => receivableRule(ectx, today, m, out));
  if (ctx.hasModule("goods")) {
    await safely(() => stockRules(ectx, today, m, out));
  }
  await safely(() => salesRule(ectx, today, m, out));
  if (ctx.hasModule("gold")) await safely(() => goldRules(ectx, m, out));
  if (ctx.hasModule("fx")) await safely(() => fxRules(ectx, m, out));
  await safely(() => anomalyRule(ectx, today, out));
  await safely(() => kycRule(ectx, today, m, out));
  return out.map((i) => ({ ...i, rank: SEVERITY_RANK[i.severity] }));
}

// ---------------------------------------------------------------- storage and statuses

interface InsightRow {
  id: string;
  kind: string;
  module: Module;
  area: Area;
  severity: AiSeverity;
  title_fa: string;
  body_fa: string;
  why_fa: string;
  facts: AiInsight["facts"];
  refs: AiRef[];
  action: AiInsight["action"];
  status: string;
  user_states: Record<string, { status: AiInsight["status"]; until?: string | null; at?: string }>;
  rank: number;
  day: string;
  created_at: string;
}

const MARK = (orgId: string) => `ai.insights.day:${orgId}`;

/** Recompute when today's run has not happened yet (or `force`). Never awaits a model. */
export async function refreshInsights(ctx: Ctx, opts: { force?: boolean; today?: string } = {}): Promise<void> {
  const today = opts.today ?? businessToday(ctx);
  if (!opts.force) {
    const mark = await ctx.db.one<{ value: { day?: string } }>(`select value from tz_kv where key = $1`, [MARK(ctx.org.id)]);
    if (mark?.value?.day === today) return;
  }
  const drafts = await computeInsights(ctx, today);
  await ctx.write(
    async (tx) => {
      const ids: string[] = [];
      for (const d of drafts) {
        const id = insightId(ctx.org.id, d.key);
        ids.push(id);
        await tx.query(
          `insert into tz_ai_insights (id, org_id, kind, module, area, severity, title_fa, body_fa, why_fa, facts, refs, action, status, rank, day, created_at, updated_at, resolved_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, 'active', $13, $14, now(), now(), null)
           on conflict (id) do update set kind = excluded.kind, module = excluded.module, area = excluded.area, severity = excluded.severity, title_fa = excluded.title_fa,
             body_fa = excluded.body_fa, why_fa = excluded.why_fa, facts = excluded.facts, refs = excluded.refs, action = excluded.action, rank = excluded.rank,
             day = excluded.day, updated_at = now(), resolved_at = null,
             -- a condition that comes back after it was resolved is new again for everyone
             user_states = case when tz_ai_insights.status = 'resolved' then '{}'::jsonb else tz_ai_insights.user_states end,
             created_at = case when tz_ai_insights.status = 'resolved' then now() else tz_ai_insights.created_at end,
             status = 'active'`,
          [id, ctx.org.id, d.kind, d.module, d.area, d.severity, d.title_fa, d.body_fa, d.why_fa, JSON.stringify(d.facts), JSON.stringify(d.refs), JSON.stringify(d.action ?? null), d.rank, today],
        );
      }
      await tx.query(
        `update tz_ai_insights set status = 'resolved', resolved_at = now(), updated_at = now() where org_id = $1 and status = 'active' and not (id = any($2::text[]))`,
        [ctx.org.id, `{${ids.join(",")}}`],
      );
      await tx.query(
        `insert into tz_kv (key, value, updated_at) values ($1, $2::jsonb, now()) on conflict (key) do update set value = excluded.value, updated_at = now()`,
        [MARK(ctx.org.id), JSON.stringify({ day: today, count: drafts.length })],
      );
    },
    { internal: true },
  );
}

function view(r: InsightRow, userId: string, nowIso: string): AiInsight {
  const st = r.user_states?.[userId];
  let status: AiInsight["status"] = st?.status ?? "new";
  if (status === "snoozed" && st?.until && st.until <= nowIso) status = "seen";
  return {
    id: r.id, kind: r.kind, module: r.module, severity: r.severity, title_fa: r.title_fa, body_fa: r.body_fa, why_fa: r.why_fa,
    facts: r.facts ?? [], refs: r.refs ?? [], action: r.action ?? null, status, created_at: r.created_at,
  };
}

/** Insights this member may see (by the area of each), newest-most-severe first. */
export async function listInsights(ctx: Ctx, opts: { all?: boolean } = {}): Promise<{ insights: AiInsight[]; enabled: boolean; day: string }> {
  const settings = await loadSettings(ctx.db, ctx.org.id);
  const today = businessToday(ctx);
  if (!settings.features.insights) return { insights: [], enabled: false, day: today };
  await refreshInsights(ctx, { today });
  const rows = await ctx.db.query<InsightRow>(
    `select * from tz_ai_insights where org_id = $1 and status = 'active' order by rank desc, updated_at desc`,
    [ctx.org.id],
  );
  const now = new Date().toISOString();
  const list = rows
    .filter((r) => ctx.can(r.area, "view") && (r.module === "core" || r.module === "accounting" || r.module === "treasury" || ctx.hasModule(r.module as "goods" | "gold" | "fx")))
    .map((r) => view(r, ctx.user.id, now))
    .filter((i) => opts.all || (i.status !== "dismissed" && i.status !== "done" && i.status !== "snoozed"));
  return { insights: list, enabled: true, day: today };
}

export const INSIGHT_STATUSES = ["new", "seen", "snoozed", "dismissed", "done"] as const;

/** What this member did with an insight (only for an insight they may see). */
export async function setInsightStatus(ctx: Ctx, id: string, status: AiInsight["status"], until?: string | null): Promise<AiInsight> {
  const row = await ctx.db.one<InsightRow>(`select * from tz_ai_insights where id = $1 and org_id = $2`, [id, ctx.org.id]);
  if (!row || !ctx.can(row.area, "view")) throw notFound("بینش پیدا نشد");
  let snooze: string | null = null;
  if (status === "snoozed") {
    const t = until ? new Date(until) : new Date(Date.now() + 24 * 3600 * 1000);
    if (Number.isNaN(t.getTime()) || t.getTime() <= Date.now()) throw bad("زمان یادآوری معتبر نیست");
    snooze = t.toISOString();
  }
  const state = { status, until: snooze, at: new Date().toISOString() };
  const updated = await ctx.write(
    (tx) =>
      tx.one<InsightRow>(
        `update tz_ai_insights set user_states = jsonb_set(coalesce(user_states, '{}'::jsonb), $3::text[], $4::jsonb, true), updated_at = updated_at
         where id = $1 and org_id = $2 returning *`,
        [id, ctx.org.id, `{${ctx.user.id}}`, JSON.stringify(state)],
      ),
    { internal: true },
  );
  return view(updated!, ctx.user.id, new Date().toISOString());
}

