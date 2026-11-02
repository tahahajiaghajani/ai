// «نرخ‌ها»: for each market rate the business records (gold 18, mazaneh, the coins on its board, its currencies), the
// last rate, its recent path, and how far it moved in the past for the next day, week and month — as ranges from its own
// measured volatility, with how often the past ranges held. Information, never a buy or sell recommendation.
import { useState } from "react";
import { Gauge } from "lucide-react";
import { EmptyState, Skeleton } from "../../components/display";
import { Card } from "../../modules/reports/kit";
import { Sparkline, num, pickScale, scaled } from "../../modules/dashboard/kit";
import { formatJalaliDateTime } from "@shared/jalali";
import { fa } from "../../lib/fa";
import type { AiRateRange } from "../kit/types";
import { rangePos, ratesOf } from "./data";
import { Accuracy, Disclaimer, ExplainForecast, LoadError, useForecast } from "./shared";

const HORIZON: Record<number, string> = { 1: "فردا", 7: "یک هفته", 30: "یک ماه" };

function RateCard({ r, selected, onSelect }: { r: AiRateRange; selected: boolean; onSelect: () => void }) {
  const lo = Math.min(num(r.last), ...r.horizons.map((h) => num(h.p10)));
  const hi = Math.max(num(r.last), ...r.horizons.map((h) => num(h.p90)));
  const s = pickScale([hi], r.unit, 9);
  const last = rangePos(num(r.last), lo, hi);
  const path = r.history.map((h) => num(h.value));
  return (
    <section className="ai-rate" aria-label={r.title_fa} data-selected={selected || undefined}>
      <header>
        <h3>
          <button type="button" className="ai-rate-pick" onClick={onSelect} aria-pressed={selected} title="توضیح همین نرخ">
            {r.title_fa}
          </button>
        </h3>
        <span className={r.stale ? "text-warning" : undefined}>{r.at ? `${r.stale ? "قدیمی، " : ""}${formatJalaliDateTime(r.at)}` : null}</span>
      </header>
      <div className="ai-rate-last">
        <b className="sf-num">{scaled(r.last, s)}</b>
        <span>{s.unit}</span>
      </div>
      {path.length > 1 ? <Sparkline values={path} h={30} label={`مسیر ${fa(path.length)} روز گذشتهٔ ${r.title_fa}`} /> : null}
      {r.refused_reason_fa ? (
        <p className="ai-fc-note">{r.refused_reason_fa}</p>
      ) : (
        <ul className="ai-rate-h">
          {r.horizons.map((h) => {
            const a = rangePos(num(h.p10), lo, hi);
            const b = rangePos(num(h.p90), lo, hi);
            return (
              <li key={h.days}>
                <span className="k">{HORIZON[h.days] ?? `${fa(h.days)} روز`}</span>
                <span className="ai-rate-bar" aria-hidden>
                  <i style={{ insetInlineStart: `${a * 100}%`, inlineSize: `${Math.max(1.5, (b - a) * 100)}%` }} />
                  <em style={{ insetInlineStart: `${last * 100}%` }} />
                </span>
                <span className="v sf-num">
                  {scaled(h.p10, s)} تا {scaled(h.p90, s)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {!r.refused_reason_fa ? <Accuracy coverage={r.coverage80} n={r.n} /> : null}
      {r.thin ? <p className="ai-fc-note">فقط {fa(r.observations)} روز نرخ ثبت شده؛ این بازه کم‌اطمینان است و با ثبت روزانهٔ نرخ دقیق‌تر می‌شود.</p> : null}
    </section>
  );
}

export function RatesTab() {
  const q = useForecast("rates", {}, ratesOf);
  const [pick, setPick] = useState<string | null>(null);
  const rates = q.data ?? [];
  // the explanation follows the chosen card (first one with a range by default)
  const chosen = rates.find((r) => r.key === pick) ?? rates.find((r) => !r.refused_reason_fa) ?? rates[0] ?? null;
  return (
    <div className="bk-stack">
      <div className="ai-fc-alert" data-tone="neutral" role="note">
        <i className="sf-nuqta" aria-hidden />
        <span>
          <b>اطلاعات است، توصیهٔ خرید و فروش نیست.</b> بازه‌ها از نوسان گذشتهٔ همین نرخ‌ها ساخته شده‌اند و خبرها و تصمیم‌های تازه را نمی‌بینند.
        </span>
      </div>
      {q.isLoading ? (
        <div className="bk-card">
          <div className="bk-card-b">
            <Skeleton rows={8} />
          </div>
        </div>
      ) : q.error ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      ) : !rates.length ? (
        <div className="bk-card">
          <EmptyState icon={Gauge} title="هنوز نرخی برای ساختن بازه ثبت نشده است." />
        </div>
      ) : (
        <Card title="بازهٔ احتمالی نرخ‌ها" meta={<span className="bk-cap">بازهٔ ۸۰٪؛ نقطه، نرخ امروز است</span>}>
          <div className="ai-rates">
            {rates.map((r) => (
              <RateCard key={r.key} r={r} selected={chosen?.key === r.key && rates.length > 1} onSelect={() => setPick(r.key)} />
            ))}
          </div>
          <Disclaimer>روش: نوسان نمایی وزنی (EWMA) بازده روزانه و چندک‌های آن؛ هرچه افق دورتر، بازه پهن‌تر.</Disclaimer>
          {chosen ? <ExplainForecast key={chosen.key} series="rate" params={{ rate: chosen.key }} title={`بازهٔ ${chosen.title_fa}`} /> : null}
        </Card>
      )}
    </div>
  );
}
