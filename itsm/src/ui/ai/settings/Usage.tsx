// «مصرف و بودجه»: this month's spend against the monthly budget (alert line, hard stop), the per-member daily cap, and
// usage by day, model, feature and member. Costs are estimates in US dollars from the providers' price lists; local
// models and unknown prices count as zero.
import { useEffect, useMemo, useState } from "react";
import { Button, InputNumber, Segmented } from "antd";
import { BarChart, Bar, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { ChartColumn } from "lucide-react";
import type { AiSettings } from "@shared/ai/types";
import { presetRange, todayISO, addDays } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { fa, jDayMonth } from "../../lib/fa";
import { EmptyState, Skeleton } from "../../components/display";
import { Card } from "../../components/blocks";
import { budgetShare, budgetState, num, tokens, usd } from "../kit/model";
import { useAiInvalidate, useAiUsage } from "../kit/hooks";
import type { AiUsageView } from "../kit/types";

type Period = "month" | "30d" | "lastMonth";
const PERIOD_LABEL: Record<Period, string> = { month: "این ماه", "30d": "۳۰ روز اخیر", lastMonth: "ماه قبل" };

/** Titles of the usage ledger's `feature` column; modules that call the models add theirs. */
export const USAGE_FEATURE_LABEL: Record<string, string> = {
  assistant: "دستیار",
  chat: "دستیار",
  test: "آزمایش اتصال",
  relay: "نسخهٔ ویندوز",
};

const day = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
};

function rangeOf(p: Period) {
  const today = todayISO();
  if (p === "30d") return { from: addDays(today, -29), to: today };
  const r = presetRange(p === "month" ? "month" : "lastMonth", today);
  return { from: r.from, to: r.to };
}

function Rank({ rows, label }: { rows: { key: string; name: string; cost: number; calls: number; hi?: boolean }[]; label: string }) {
  const max = Math.max(0.000001, ...rows.map((r) => r.cost));
  if (!rows.length) return <div className="blk-line"><i className="ds-nuqta" aria-hidden />مصرفی ثبت نشده.</div>;
  return (
    <div className="ai-rank" role="list" aria-label={label}>
      {rows.slice(0, 8).map((r) => (
        <div key={r.key} className="ai-rank-r" role="listitem">
          <span className="ai-rank-n" title={r.name}>{r.name}</span>
          <span className="ai-rank-v">{usd(r.cost)} <span className="ds-unit">دلار</span></span>
          <span className="ai-rank-q">{fa(r.calls)} بار</span>
          <span className="ai-rank-b" aria-hidden>
            <i className={r.hi ? "hi" : ""} style={{ inlineSize: `${Math.max(2, (r.cost / max) * 100)}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

function DayTip({ active, payload }: { active?: boolean; payload?: { payload: { day: string; cost: number; calls: number; tokens: number } }[] }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="ai-tip-card">
      <div>{jDayMonth(day(r.day))}</div>
      <div><b>{usd(r.cost)}</b> دلار</div>
      <div>{fa(r.calls)} درخواست، {tokens(r.tokens)} توکن</div>
    </div>
  );
}

function BudgetCard({ settings, month, unpriced }: { settings: AiSettings; month: number; unpriced?: boolean }) {
  const { api } = useOrg();
  const n = useNotify();
  const refresh = useAiInvalidate();
  const [b, setB] = useState(settings.budgets);
  const [saving, setSaving] = useState(false);
  useEffect(() => setB(settings.budgets), [settings.budgets]);
  const share = budgetShare(month, b.monthly_usd);
  const state = budgetState(share, b.alert_pct);
  const dirty = JSON.stringify(b) !== JSON.stringify(settings.budgets);
  const save = async () => {
    setSaving(true);
    try {
      await api.put("/ai/settings", { budgets: b });
      n.ok("بودجه ذخیره شد.");
      refresh();
    } catch (e) {
      n.error(e);
    } finally {
      setSaving(false);
    }
  };
  const money = (v: string | null, set: (v: string | null) => void, label: string) => (
    <InputNumber<number>
      className="w-full"
      min={0}
      step={1}
      precision={2}
      value={v === null || v === "" ? null : Number(v)}
      onChange={(x) => set(x === null || x === undefined ? null : String(x))}
      suffix="دلار"
      placeholder="بدون سقف"
      aria-label={label}
      controls={false}
    />
  );
  return (
    <Card title="بودجه" meta={<span className="blk-cap">برآورد از روی تعرفهٔ سرویس‌ها، به دلار</span>}>
      <div className="ai-meter">
        <div className="ai-meter-fig">
          <b className="ds-num">{usd(month)}</b>
          <span>دلار در این ماه</span>
          {b.monthly_usd ? <span>از {usd(b.monthly_usd)} دلار</span> : <span>بدون سقف ماهانه</span>}
        </div>
        {share !== null ? (
          <div className="ai-meter-t" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} aria-label="مصرف از بودجهٔ ماه">
            <i data-state={state} style={{ inlineSize: `${Math.min(100, share * 100)}%` }} />
            <b style={{ insetInlineStart: `${Math.min(100, b.alert_pct)}%` }} title={`هشدار در ${fa(b.alert_pct)}٪`} />
          </div>
        ) : null}
        <div className="ai-meter-s">
          {state === "over" ? <span className="text-danger">بودجهٔ ماه تمام شده؛ کارهای هوش مصنوعی تا ماه بعد متوقف است.</span> : state === "alert" ? <span className="text-warning">از خط هشدار گذشته است.</span> : null}
          {unpriced ? <span>مدل‌های محلی و بی‌تعرفه صفر حساب شده‌اند.</span> : null}
        </div>
      </div>
      <div className="ai-grid2 mt-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        <label className="blk-f">
          <span className="blk-f-l">سقف ماهانهٔ سازمان</span>
          {money(b.monthly_usd, (v) => setB({ ...b, monthly_usd: v }), "سقف ماهانه")}
        </label>
        <label className="blk-f">
          <span className="blk-f-l">سقف روزانهٔ هر کاربر</span>
          {money(b.user_daily_usd, (v) => setB({ ...b, user_daily_usd: v }), "سقف روزانهٔ هر کاربر")}
        </label>
        <label className="blk-f">
          <span className="blk-f-l">هشدار در</span>
          <InputNumber<number> className="w-full" min={10} max={100} value={b.alert_pct} onChange={(x) => setB({ ...b, alert_pct: Number(x) || 80 })} suffix="٪" aria-label="هشدار در درصد" controls={false} />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <span className="blk-f-h flex-1">با رسیدن به سقف، درخواست تازه به مدل‌ها فرستاده نمی‌شود؛ بینش‌ها بدون مدل ادامه دارند.</span>
        <Button type="primary" loading={saving} disabled={!dirty} onClick={save}>
          ذخیره
        </Button>
      </div>
    </Card>
  );
}

export function UsageTab({ settings }: { settings: AiSettings }) {
  const [period, setPeriod] = useState<Period>("month");
  const [metric, setMetric] = useState<"cost" | "calls">("cost");
  const range = useMemo(() => rangeOf(period), [period]);
  const q = useAiUsage(range);
  const u: AiUsageView | undefined = q.data;
  const monthCost = num(u?.budget?.month_usd ?? (period === "month" ? u?.totals.cost_usd : 0));

  const days = useMemo(() => {
    if (!u) return [];
    const map = new Map(u.by_day.map((d) => [d.day.slice(0, 10), d]));
    const out: { day: string; cost: number; calls: number; tokens: number }[] = [];
    for (let d = range.from; d <= range.to; d = addDays(d, 1)) {
      const r = map.get(d);
      out.push({ day: d, cost: num(r?.cost_usd), calls: num(r?.calls), tokens: num(r?.input) + num(r?.output) });
    }
    return out;
  }, [u, range]);
  const empty = !!u && !u.totals.calls;

  return (
    <div className="ai-usage">
      <div className="blk-stack">
        <Card
          title="مصرف"
          meta={u ? <span className="blk-cap">{fa(u.totals.calls)} درخواست، {tokens(num(u.totals.input) + num(u.totals.output))} توکن، {usd(u.totals.cost_usd)} دلار</span> : null}
          tools={<Segmented<Period> size="small" value={period} onChange={setPeriod} options={(Object.keys(PERIOD_LABEL) as Period[]).map((p) => ({ value: p, label: PERIOD_LABEL[p] }))} aria-label="دوره" />}
        >
          {q.isLoading ? (
            <Skeleton rows={6} />
          ) : q.error ? (
            <EmptyState compact title="گزارش مصرف بارگذاری نشد." description={(q.error as Error).message} action={<Button onClick={() => q.refetch()}>تلاش دوباره</Button>} />
          ) : empty ? (
            <EmptyState compact icon={ChartColumn} title="در این دوره درخواستی به مدل‌ها فرستاده نشده." />
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="blk-cap">{metric === "cost" ? "هزینهٔ روزانه، دلار" : "تعداد درخواست در روز"}</span>
                <Segmented<"cost" | "calls"> size="small" value={metric} onChange={setMetric} options={[{ value: "cost", label: "هزینه" }, { value: "calls", label: "درخواست" }]} aria-label="نمایش" />
              </div>
              <div className="ai-chart" role="img" aria-label="مصرف روزانهٔ هوش مصنوعی">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={days} margin={{ top: 8, right: 0, left: 4, bottom: 0 }} barCategoryGap="22%">
                    <CartesianGrid vertical={false} stroke="var(--ds-chart-grid)" />
                    <XAxis dataKey="day" reversed tickLine={false} axisLine={{ stroke: "var(--ds-chart-axis)" }} tick={{ fontSize: 12, fill: "var(--ds-text-3)" }} tickFormatter={(d: string) => jDayMonth(day(d))} minTickGap={24} />
                    <YAxis orientation="right" tickCount={3} width={44} axisLine={false} tickLine={false} tickMargin={8} tick={{ fontSize: 12, fill: "var(--ds-text-3)", textAnchor: "start" }} tickFormatter={(v: number) => (metric === "cost" ? usd(v) : fa(v))} />
                    <Tooltip cursor={{ fill: "var(--ds-hover)" }} content={<DayTip />} isAnimationActive={false} />
                    <Bar dataKey={metric} fill="var(--ds-accent-line)" radius={[4, 4, 0, 0]} maxBarSize={24} animationDuration={500} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </Card>
        {u && !empty ? (
          <Card title="به تفکیک مدل">
            <Rank label="مصرف به تفکیک مدل" rows={u.by_model.map((m, i) => ({ key: `${m.model}-${i}`, name: m.model, cost: num(m.cost_usd), calls: num(m.calls), hi: i === 0 }))} />
          </Card>
        ) : null}
      </div>
      <div className="blk-stack">
        <BudgetCard settings={settings} month={monthCost} unpriced={num(u?.totals.unpriced_calls) > 0} />
        {u && !empty ? (
          <>
            <Card title="به تفکیک قابلیت">
              <Rank label="مصرف به تفکیک قابلیت" rows={u.by_feature.map((f) => ({ key: f.feature, name: USAGE_FEATURE_LABEL[f.feature] ?? f.feature, cost: num(f.cost_usd), calls: num(f.calls) }))} />
            </Card>
            <Card title="به تفکیک کاربر">
              <Rank label="مصرف به تفکیک کاربر" rows={u.by_user.map((x, i) => ({ key: x.user_id ?? `u${i}`, name: x.name ?? "—", cost: num(x.cost_usd), calls: num(x.calls) }))} />
            </Card>
          </>
        ) : null}
      </div>
    </div>
  );
}
