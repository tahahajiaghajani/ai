// Usage ledger (one row per model call, ok or not) and budgets: the business's monthly cap (this
// Jalali month, never above the platform's ceiling) and each member's daily cap, both in USD
// estimated from the dated price table. Local and unknown models count as 0.
import type { Ctx } from "../../context";
import type { AiErrorKind, AiSettings } from "@shared/ai/types";
import type { AiBudgetState, AiPolicy, AiUsageReport, AiUsageTotals } from "@shared/ai/api";
import { estimateCostUsd } from "@shared/ai/prices";
import { fromJalali, toJalali, todayISO } from "@shared/jalali";
import { D } from "@shared/money";
import { uuidv7 } from "@shared/id";
import type { Usage } from "./types";
import { monthlyCap } from "./settings";

export interface UsageEntry {
  feature: string;
  job?: string | null;
  connection_id?: string | null;
  preset?: string | null;
  model?: string | null;
  route?: "direct" | "via_cloud" | "relay";
  usage?: Usage;
  /** cost the provider reported itself (OpenRouter), USD */
  provider_cost?: string | null;
  /** runs on this computer: costs nothing */
  local?: boolean;
  ms?: number | null;
  ok: boolean;
  error_kind?: AiErrorKind | null;
  thread_id?: string | null;
}

export function orgTimeZone(ctx: Ctx): string {
  const tz = ctx.org.settings?.timezone;
  return typeof tz === "string" && tz ? tz : "Asia/Tehran";
}

/** Record one model call. Never throws: losing a ledger row must not lose an answer. */
export async function recordUsage(ctx: Ctx, e: UsageEntry): Promise<{ cost_usd: string; priced: boolean }> {
  const u = e.usage ?? { input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 };
  const est = e.model ? estimateCostUsd(e.model, u, { day: todayISO(orgTimeZone(ctx)), local: e.local }) : { usd: "0", priced: true };
  const cost = e.provider_cost && /^\d+(\.\d+)?(e-?\d+)?$/i.test(e.provider_cost) ? { usd: D(e.provider_cost).toDecimalPlaces(6).toFixed(), priced: true } : est;
  try {
    await ctx.write(
      (tx) =>
        tx.query(
          `insert into tz_ai_usage (id, org_id, user_id, feature, job, connection_id, preset, model, route, input, output, cache_read, cache_write, reasoning, cost_usd, priced, ms, ok, error_kind, thread_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
          [
            uuidv7(), ctx.org.id, ctx.user.id, e.feature.slice(0, 40), e.job ?? null, e.connection_id ?? null, e.preset ?? null, e.model ?? null, e.route ?? "direct",
            u.input, u.output, u.cache_read, u.cache_write, u.reasoning, cost.usd, cost.priced, e.ms != null ? Math.round(e.ms) : null, e.ok, e.error_kind ?? null, e.thread_id ?? null,
          ],
        ),
      { internal: true },
    );
  } catch (err) {
    ctx.cfg.log.warn("ai usage row not stored", String((err as Error)?.message ?? err));
  }
  return { cost_usd: cost.usd, priced: cost.priced };
}

/** First day of this Jalali month and today (ISO dates in the business's time zone). */
export function periodDays(ctx: Ctx): { monthStart: string; today: string } {
  const today = todayISO(orgTimeZone(ctx));
  const j = toJalali(today);
  return { monthStart: fromJalali(j.jy, j.jm, 1), today };
}

async function spentSince(ctx: Ctx, day: string, userId: string | null): Promise<string> {
  const r = await ctx.db.one<{ s: string | null }>(
    `select coalesce(sum(cost_usd), 0)::text as s from tz_ai_usage
     where org_id = $1 and created_at >= ($2::date)::timestamp at time zone $3 ${userId ? "and user_id = $4" : ""}`,
    userId ? [ctx.org.id, day, orgTimeZone(ctx), userId] : [ctx.org.id, day, orgTimeZone(ctx)],
  );
  return D(r?.s ?? "0").toDecimalPlaces(6).toFixed();
}

export async function budgetState(ctx: Ctx, settings: AiSettings, policy: AiPolicy): Promise<AiBudgetState> {
  const { monthStart, today } = periodDays(ctx);
  const [month, mine] = await Promise.all([spentSince(ctx, monthStart, null), spentSince(ctx, today, ctx.user.id)]);
  const monthCap = monthlyCap(settings, policy);
  const dayCap = settings.budgets.user_daily_usd;
  const pct = settings.budgets.alert_pct || 80;
  let state: AiBudgetState["state"] = "ok";
  const over = (spent: string, cap: string | null) => cap !== null && D(spent).gte(cap);
  const near = (spent: string, cap: string | null) => cap !== null && D(cap).gt(0) && D(spent).gte(D(cap).mul(pct).div(100));
  if (over(month, monthCap) || over(mine, dayCap)) state = "stopped";
  else if (near(month, monthCap) || near(mine, dayCap)) state = "alert";
  return { state, month_usd: month, month_cap_usd: monthCap, today_usd: mine, today_cap_usd: dayCap, alert_pct: pct };
}

const totalsOf = (t = "") => `coalesce(sum(${t}cost_usd), 0)::text as cost_usd, count(*)::int as calls, count(*) filter (where not ${t}ok)::int as errors,
  coalesce(sum(${t}input), 0)::int as input, coalesce(sum(${t}output), 0)::int as output, coalesce(sum(${t}cache_read), 0)::int as cache_read,
  coalesce(sum(${t}cache_write), 0)::int as cache_write, coalesce(sum(${t}reasoning), 0)::int as reasoning,
  count(*) filter (where not ${t}priced)::int as unpriced_calls`;
const totalsSql = totalsOf();

function totals(r: Record<string, unknown> | null | undefined): AiUsageTotals {
  return {
    cost_usd: D(String(r?.cost_usd ?? "0")).toDecimalPlaces(6).toFixed(),
    calls: Number(r?.calls ?? 0),
    errors: Number(r?.errors ?? 0),
    input: Number(r?.input ?? 0),
    output: Number(r?.output ?? 0),
    cache_read: Number(r?.cache_read ?? 0),
    cache_write: Number(r?.cache_write ?? 0),
    reasoning: Number(r?.reasoning ?? 0),
    unpriced_calls: Number(r?.unpriced_calls ?? 0),
  };
}

/** Usage between two days (inclusive, business time zone): by day, model, feature and member. */
export async function usageReport(ctx: Ctx, from: string, to: string, budget: AiBudgetState): Promise<AiUsageReport> {
  const tz = orgTimeZone(ctx);
  const where = `org_id = $1 and created_at >= ($2::date)::timestamp at time zone $4 and created_at < (($3::date) + 1)::timestamp at time zone $4`;
  const p = [ctx.org.id, from, to, tz];
  const [all, byDay, byModel, byFeature, byUser] = await Promise.all([
    ctx.db.one(`select ${totalsSql} from tz_ai_usage where ${where}`, p),
    ctx.db.query(`select to_char(created_at at time zone $4, 'YYYY-MM-DD') as day, ${totalsSql} from tz_ai_usage where ${where} group by 1 order by 1`, p),
    ctx.db.query(`select coalesce(model, '') as model, max(preset) as preset, ${totalsSql} from tz_ai_usage where ${where} group by 1 order by sum(cost_usd) desc, count(*) desc limit 50`, p),
    ctx.db.query(`select feature, ${totalsSql} from tz_ai_usage where ${where} group by 1 order by sum(cost_usd) desc, count(*) desc`, p),
    ctx.db.query(
      `select u.user_id, max(us.full_name) as name, ${totalsOf("u.")}
       from tz_ai_usage u left join tz_users us on us.id = u.user_id
       where ${where.replace(/\b(org_id|created_at)\b/g, "u.$1")} group by u.user_id order by sum(u.cost_usd) desc limit 100`,
      p,
    ),
  ]);
  return {
    from,
    to,
    totals: totals(all),
    by_day: byDay.map((r) => ({ day: String(r.day), ...totals(r) })),
    by_model: byModel.map((r) => ({ model: String(r.model), preset: (r.preset as string | null) ?? null, ...totals(r) })),
    by_feature: byFeature.map((r) => ({ feature: String(r.feature), ...totals(r) })),
    by_user: byUser.map((r) => ({ user_id: (r.user_id as string | null) ?? null, name: (r.name as string | null) ?? null, ...totals(r) })),
    budget,
  };
}
