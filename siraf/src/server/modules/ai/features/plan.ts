// Plans for the next month or quarter: deterministic sections (cash weeks, collections, reorder,
// the sales outlook, open insights) plus concrete steps written by the analysis model — or by
// rules when AI is unavailable. Saved in tz_ai_plans, private to their author.
import { z } from "zod";
import type { Ctx } from "../../../context";
import { D } from "@shared/money";
import type { AiPlanSummary, AiPlanView } from "@shared/ai/api";
import { addDays, formatJalali } from "@shared/jalali";
import { uuidv7 } from "@shared/id";
import { notFound } from "../../../http/errors";
import { cashflow13, forecast, type CashWeek } from "./forecasts";
import { deadStock, receivables, reorderAdvice, stockItems } from "./ops";
import { listInsights } from "./insights";
import { SYSTEM_RULES, dataBlock, narrate } from "./narrative";
import { businessToday, fmtMoney, jd, moneyInfo, type MoneyInfo } from "../tools/common";
import { metricAllowed, metricDef } from "../analytics/metrics";

export const planInput = z.object({
  horizon: z.enum(["month", "quarter"]).default("month"),
  focus: z.string().trim().max(300).nullish(),
});

export interface PlanStep {
  title: string;
  detail: string;
  when: string | null;
  area: string | null;
}

export interface PlanContent {
  horizon: "month" | "quarter";
  from: string;
  to: string;
  sections: { key: string; title: string; lines: string[] }[];
  steps: PlanStep[];
  risks: string[];
}

export type PlanView = AiPlanView;

async function sections(ctx: Ctx, today: string, horizon: "month" | "quarter", m: MoneyInfo) {
  const out: PlanContent["sections"] = [];
  const facts: Record<string, unknown> = {};
  const ruleSteps: PlanStep[] = [];
  const weeksAhead = horizon === "month" ? 5 : 13;
  if (ctx.can("treasury", "view") && ctx.can("reports", "view")) {
    const cf = await cashflow13(ctx, today, m);
    const weeks = ((cf.details as { weeks: CashWeek[] }).weeks ?? []).slice(0, weeksAhead);
    const short = weeks.filter((w) => w.shortfall);
    const risky = weeks.filter((w) => w.risk && !w.shortfall);
    out.push({
      key: "cash", title: "نقدینگی",
      lines: [
        `موجودی امروز صندوق و بانک: ${fmtMoney((cf.details as { opening: { total: string } }).opening.total, m)}`,
        ...weeks.map((w) => `${w.label}: ورود ${fmtMoney(D(w.cheques_in).plus(D(w.invoices_in)), m)}، خروج ${fmtMoney(D(w.cheques_out).plus(D(w.invoices_out)).plus(D(w.recurring_out)), m)}، مانده ${fmtMoney(w.closing_p50, m)}${w.shortfall ? " (کسری)" : w.risk ? " (در حالت بدبینانه کسری)" : ""}`),
      ],
    });
    facts.cash_weeks = weeks.map((w) => ({ week: w.label, closing: w.closing_p50, pessimistic: w.closing_p10, shortfall: w.shortfall }));
    if (short.length) ruleSteps.push({ title: "جبران کسری نقدینگی", detail: `پیش از ${short[0].label} مانده به ${fmtMoney(short[0].closing_p50, m)} می‌رسد؛ وصول مطالبات معوق را جلو بیندازید و پرداخت‌های غیرضروری را جابه‌جا کنید.`, when: short[0].label, area: "treasury" });
    else if (risky.length) ruleSteps.push({ title: "ذخیرهٔ احتیاطی نقدینگی", detail: `در حالت بدبینانه در ${risky[0].label} کسری پیش می‌آید؛ وصول چک‌های پرخطر را پیگیری کنید.`, when: risky[0].label, area: "treasury" });
  }
  if (ctx.can("reports", "view")) {
    const r = await receivables(ctx, today, { limit: 5 });
    const top = r.rows.filter((x) => D(x.overdue).gt(0));
    if (top.length) {
      out.push({ key: "collections", title: "وصول مطالبات", lines: [`کل معوق: ${fmtMoney(r.total_overdue, m)}`, ...top.map((x) => `${x.name}: معوق ${fmtMoney(x.overdue, m)}، ${x.days_overdue} روز${x.score !== null ? `، امتیاز ریسک ${x.score}` : ""}`)] });
      facts.collections = top.map((x) => ({ party: x.name, overdue: x.overdue, days: x.days_overdue, score: x.score }));
      ruleSteps.push({ title: "پیگیری بدهکاران معوق", detail: `به ترتیب با ${top.slice(0, 3).map((x) => `«${x.name}»`).join("، ")} تماس بگیرید و برای مانده‌ها چک یا زمان پرداخت بگیرید.`, when: "هفتهٔ اول", area: "treasury" });
    }
  }
  if (ctx.hasModule("goods") && ctx.can("inventory", "view")) {
    const items = await stockItems(ctx, today);
    const re = reorderAdvice(items).slice(0, 8);
    const dead = deadStock(items, today).slice(0, 5);
    if (re.length) {
      out.push({ key: "reorder", title: "سفارش کالا", lines: re.map((x) => `${x.item.name}: موجودی ${x.item.qty}، پیشنهاد سفارش ${x.order_qty}`) });
      facts.reorder = re.map((x) => ({ item: x.item.name, stock: x.item.qty, order: x.order_qty }));
      ruleSteps.push({ title: "سفارش خرید کالاهای کم‌موجود", detail: re.slice(0, 4).map((x) => `${x.item.name} (${x.order_qty})`).join("، "), when: "هفتهٔ اول", area: "purchases" });
    }
    if (dead.length) {
      const v = dead.reduce((a, x) => a.plus(D(x.item.value)), D(0));
      out.push({ key: "dead", title: "کالاهای راکد", lines: dead.map((x) => `${x.item.name}: ${fmtMoney(x.item.value, m)}`) });
      facts.dead_stock = { value: v.toString(), items: dead.map((x) => x.item.name) };
      ruleSteps.push({ title: "آزادسازی سرمایهٔ راکد", detail: `کالاهای راکد به ارزش ${fmtMoney(v, m)} را با تخفیف یا فروش همکاری عرضه کنید.`, when: null, area: "sales" });
    }
  }
  if (metricAllowed(ctx, metricDef("sales_amount")!)) {
    const f = await forecast(ctx, "sales", { grain: "month", horizon: horizon === "month" ? 1 : 3 }, today);
    if (!f.series.refused_reason_fa && f.series.forecast.length) {
      out.push({ key: "sales", title: "چشم‌انداز فروش", lines: [...f.series.forecast.map((p) => `${p.period}: بین ${fmtMoney(p.p10, m)} و ${fmtMoney(p.p90, m)} (میانه ${fmtMoney(p.p50, m)})`), `روش: ${f.series.method}`] });
      facts.sales_outlook = f.series.forecast;
    } else if (f.series.refused_reason_fa) out.push({ key: "sales", title: "چشم‌انداز فروش", lines: [f.series.refused_reason_fa] });
  }
  const ins = (await listInsights(ctx)).insights.slice(0, 6);
  if (ins.length) {
    out.push({ key: "insights", title: "موارد نیازمند توجه", lines: ins.map((i) => `${i.title_fa}: ${i.body_fa}`) });
    facts.insights = ins.map((i) => ({ title: i.title_fa, body: i.body_fa }));
  }
  return { sections: out, facts, ruleSteps };
}

function markdownOf(title: string, c: PlanContent): string {
  const parts = [`## ${title}`, ""];
  for (const s of c.sections) parts.push(`### ${s.title}`, ...s.lines.map((l) => `- ${l}`), "");
  if (c.steps.length) parts.push("### گام‌ها", ...c.steps.map((s, i) => `${i + 1}. **${s.title}**${s.when ? ` (${s.when})` : ""}: ${s.detail}`), "");
  if (c.risks.length) parts.push("### ریسک‌ها", ...c.risks.map((r) => `- ${r}`));
  return parts.join("\n").trim();
}

const planSchema = z.object({
  steps: z.array(z.object({ title: z.string().max(120), detail: z.string().max(600), when: z.string().max(60).nullish(), area: z.string().max(30).nullish() })).min(2).max(10),
  risks: z.array(z.string().max(300)).max(5),
});

export async function makePlan(ctx: Ctx, input: z.infer<typeof planInput>, opts: { signal?: AbortSignal } = {}): Promise<PlanView> {
  const today = businessToday(ctx);
  const m = await moneyInfo(ctx);
  const to = addDays(today, input.horizon === "month" ? 30 : 91);
  const s = await sections(ctx, today, input.horizon, m);
  const title = `برنامهٔ ${input.horizon === "month" ? "یک ماه" : "سه ماه"} آینده (${formatJalali(today)} تا ${formatJalali(to)})`;
  const data = { horizon: input.horizon, from: jd(today), to: jd(to), currency_unit: m.unit, ...s.facts };
  const n = await narrate(
    ctx,
    {
      job: "analysis", feature: "plan",
      system: `${SYSTEM_RULES}\nWrite an operating plan for the period: 4–8 concrete, ordered steps (title, detail with who/what/how much from the data, when = a week or date in Jalali, area = treasury|sales|purchases|inventory|gold|fx|accounting) and up to 4 risks. Reply as JSON {"steps": [...], "risks": [...]}.`,
      prompt: `${dataBlock("plan_facts", data)}${input.focus ? `\n${dataBlock("owner_focus", input.focus)}` : ""}\nWrite the plan.`,
      schema: planSchema, facts: data, text: (o) => [...o.steps.map((x) => `${x.title} ${x.detail} ${x.when ?? ""}`), ...o.risks].join("\n"), signal: opts.signal,
    },
    (o) => ({ steps: o.steps.map((x) => ({ title: x.title, detail: x.detail, when: x.when ?? null, area: x.area ?? null })), risks: o.risks }),
    () => ({ steps: s.ruleSteps, risks: [] as string[] }),
  );
  const content: PlanContent = { horizon: input.horizon, from: today, to, sections: s.sections, steps: n.value.steps, risks: n.value.risks };
  const markdown = markdownOf(title, content);
  const id = uuidv7();
  const row = await ctx.write(
    (tx) =>
      tx.one<{ created_at: string }>(
        `insert into tz_ai_plans (id, org_id, user_id, horizon, title, focus, content, markdown, source, model) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10) returning created_at`,
        [id, ctx.org.id, ctx.user.id, input.horizon, title, input.focus ?? null, JSON.stringify(content), markdown, n.source, n.model],
      ),
    { internal: true },
  );
  return { id, title, horizon: input.horizon, focus: input.focus ?? null, content, markdown, source: n.source, model: n.model, note_fa: n.note_fa ?? null, created_at: row!.created_at };
}

export async function listPlans(ctx: Ctx): Promise<AiPlanSummary[]> {
  return ctx.db.query<AiPlanSummary>(
    `select id, title, horizon, focus, source, created_at from tz_ai_plans where org_id = $1 and user_id = $2 order by created_at desc limit 50`,
    [ctx.org.id, ctx.user.id],
  );
}

export async function getPlan(ctx: Ctx, id: string): Promise<PlanView> {
  const r = await ctx.db.one<Record<string, any>>(`select * from tz_ai_plans where id = $1 and org_id = $2 and user_id = $3`, [id, ctx.org.id, ctx.user.id]);
  if (!r) throw notFound("برنامه پیدا نشد");
  return { id: r.id, title: r.title, horizon: r.horizon, focus: r.focus, content: r.content, markdown: r.markdown, source: r.source, model: r.model, created_at: r.created_at };
}

export async function deletePlan(ctx: Ctx, id: string): Promise<void> {
  const n = await ctx.write((tx) => tx.query(`delete from tz_ai_plans where id = $1 and org_id = $2 and user_id = $3 returning id`, [id, ctx.org.id, ctx.user.id]), { internal: true });
  if (!n.length) throw notFound("برنامه پیدا نشد");
}
