// «فروش و تقاضا»: monthly sales of the whole business, a product group or one item (amount, or quantity for an item),
// with a fan chart of the next months — the median and the 80 % band — and how accurate the same method was on the
// business's own past («آزمون گذشته»). Thin data is refused with the reason, never guessed.
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Button, Segmented } from "antd";
import { ChartLine } from "lucide-react";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { RefSelect } from "../../components/inputs";
import { EmptyState, Skeleton } from "../../components/display";
import { Card } from "../../modules/reports/kit";
import { pickScale, scaled } from "../../modules/dashboard/kit";
import { FanChart } from "./charts";
import { fanRows, seriesOf } from "./data";
import { Accuracy, Disclaimer, ExplainForecast, LoadError, periodLabel, useForecast } from "./shared";

type Scope = "all" | "category" | "item";

export function DemandTab({ goods }: { goods: boolean }) {
  const { unit } = useOrg();
  const [scope, setScope] = useState<Scope>("all");
  const [id, setId] = useState<string | null>(null);
  const [name, setName] = useState<string>("");
  const [metric, setMetric] = useState<"amount" | "qty">("amount");
  const [sp] = useSearchParams();
  // «?grain=week» opens the weekly view (links from the assistant)
  const [grain, setGrain] = useState<"month" | "week">(() => (sp.get("grain") === "week" ? "week" : "month"));
  const [horizon, setHorizon] = useState<number>(() => (sp.get("grain") === "week" ? 8 : 6));
  const horizons = grain === "month" ? [3, 6, 12] : [4, 8, 13];
  const changeGrain = (g: "month" | "week") => {
    setGrain(g);
    setHorizon(g === "month" ? 6 : 8);
  };
  const ready = scope === "all" || !!id;
  const series = scope === "item" && metric === "qty" ? "demand" : "sales";
  const params = { grain, horizon, ...(scope === "item" && id ? { item: id } : scope === "category" && id ? { category: id } : {}) };
  const q = useForecast(series, params, seriesOf, ready);
  const f = q.data;
  const rows = useMemo(() => (f ? fanRows(f) : []), [f]);
  const qty = series === "demand";
  const s = useMemo(() => pickScale(rows.flatMap((r) => [r.actual ?? 0, ...(r.band ?? [])]), qty ? f?.unit || "واحد" : f?.unit || unit), [rows, f, qty, unit]);
  const title = scope === "all" ? "فروش کل" : scope === "category" ? `فروش گروه «${name}»` : qty ? `تقاضای «${name}»` : `فروش «${name}»`;

  return (
    <div className="bk-stack">
      <div className="ai-fc-bar">
        {goods ? (
          <Segmented<Scope>
            value={scope}
            onChange={(v) => {
              setScope(v);
              setId(null);
              setName("");
              if (v !== "item") setMetric("amount");
            }}
            options={[
              { value: "all", label: "کل فروش" },
              { value: "category", label: "گروه کالا" },
              { value: "item", label: "یک کالا" },
            ]}
            aria-label="دامنه"
          />
        ) : null}
        {scope === "category" ? (
          <RefSelect entity="item_category" value={id} onChange={(v, o) => (setId(v), setName(o?.label ?? ""))} placeholder="گروه کالا…" className="ai-fc-pick" showCode={false} />
        ) : scope === "item" ? (
          <RefSelect entity="item" value={id} onChange={(v, o) => (setId(v), setName(o?.label ?? ""))} placeholder="کالا…" className="ai-fc-pick" />
        ) : null}
        {scope === "item" ? (
          <Segmented<"amount" | "qty">
            value={metric}
            onChange={setMetric}
            options={[
              { value: "amount", label: "مبلغ" },
              { value: "qty", label: "مقدار" },
            ]}
            aria-label="سنجه"
          />
        ) : null}
        <span className="sf-end flex flex-wrap items-center gap-2">
          <Segmented<"month" | "week">
            value={grain}
            onChange={changeGrain}
            options={[
              { value: "month", label: "ماهانه" },
              { value: "week", label: "هفتگی" },
            ]}
            aria-label="دوره"
          />
          <Segmented<number>
            value={horizon}
            onChange={setHorizon}
            options={horizons.map((h) => ({ value: h, label: `${fa(h)} ${grain === "month" ? "ماه" : "هفته"}` }))}
            aria-label="افق"
          />
        </span>
      </div>
      {!ready ? (
        <div className="bk-card">
          <EmptyState icon={ChartLine} title={scope === "item" ? "کالایی را انتخاب کنید." : "گروه کالایی را انتخاب کنید."} />
        </div>
      ) : q.isLoading ? (
        <div className="bk-card">
          <div className="bk-card-b">
            <Skeleton rows={8} />
          </div>
        </div>
      ) : q.error ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      ) : !f || f.refused_reason_fa || !f.forecast.length ? (
        f && f.history.length > 1 ? (
          // too little history for a range: show what there is, say why, and offer the weekly view
          <Card title={f.title_fa || title} meta={<span className="bk-cap">{grain === "month" ? "ماهانه" : "هفتگی"}، {qty ? f.unit || "مقدار" : `مبالغ به ${s.unit}`}</span>}>
            <FanChart rows={rows} s={s} label={(p) => periodLabel(p, true)} aria={`${title}: ${f.history.map((h) => `${periodLabel(h.period)} ${scaled(h.value, s)}`).join("، ")}`} />
            <div className="ai-fc-alert" data-tone="neutral" role="note">
              <i className="sf-nuqta" aria-hidden />
              <span>
                <b>{f.refused_reason_fa ?? "برای پیش‌بینی این سری دادهٔ کافی نیست."}</b> پیش‌بینی بی‌پشتوانه ساخته نمی‌شود.
                {grain === "month" ? (
                  <>
                    {" "}
                    <Button type="link" size="small" className="!px-0" onClick={() => changeGrain("week")}>
                      پیش‌بینی هفتگی را ببینید
                    </Button>
                  </>
                ) : null}
              </span>
            </div>
          </Card>
        ) : (
          <div className="bk-card">
            <EmptyState icon={ChartLine} title={f?.refused_reason_fa ?? "برای پیش‌بینی این سری دادهٔ کافی نیست."} />
          </div>
        )
      ) : (
        <Card title={f.title_fa || title} meta={<span className="bk-cap">{grain === "month" ? "ماهانه" : "هفتگی"}، {qty ? f.unit || "مقدار" : `مبالغ به ${s.unit}`}</span>}>
          <FanChart rows={rows} s={s} label={(p) => periodLabel(p, true)} aria={`${title}: ${f.forecast.map((p) => `${periodLabel(p.period)} بین ${scaled(p.p10, s)} و ${scaled(p.p90, s)}`).join("، ")}`} />
          <div className="ai-fc-legend" aria-hidden>
            <span><i className="is-actual" />واقعی</span>
            <span><i className="is-median" />پیش‌بینی میانه</span>
            <span><i className="is-band" />بازهٔ ۸۰٪ (p10 تا p90)</span>
          </div>
          <div className="ai-fc-next">
            {f.forecast.slice(0, 3).map((p) => (
              <div key={p.period} className="ai-kpi">
                <small>{periodLabel(p.period)}</small>
                <b>{scaled(p.p50, s)}</b>
                <span>
                  بین {scaled(p.p10, s)} و {scaled(p.p90, s)}
                </span>
              </div>
            ))}
          </div>
          <Accuracy method={f.method} mase={f.backtest?.mase} coverage={f.backtest?.coverage80} n={f.backtest?.n} />
          <Disclaimer />
          <ExplainForecast series={series} params={params} title={f.title_fa || title} />
        </Card>
      )}
    </div>
  );
}
