// Pieces shared by the forecast tabs: period labels (Jalali), the data hook, the «توضیح با هوش مصنوعی» block over a
// forecast, the accuracy line, and the fixed notes.
import { useState, type ReactNode } from "react";
import { Button } from "antd";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, MessageCircleQuestion, Sparkles } from "lucide-react";
import type { AiPageContext } from "@shared/ai/types";
import type { AiForecastNarrative, AiForecastQuery } from "@shared/ai/api";
import { JALALI_MONTHS, toJalali } from "@shared/jalali";
import { aiErrorText } from "@shared/ai/errors";
import { useOrg } from "../../lib/org";
import { fa, jDayMonth, pct } from "../../lib/fa";
import { openAssistant } from "../assistant/bus";
import { Narrative } from "../kit/Narrative";
import { errorKindOf, explainOf, failText } from "../kit/model";
import { useAiKey, useAiStatus } from "../kit/hooks";
import { coverageRatio } from "./data";

export const ICON = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

const dayDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
};

/** «آبان ۱۴۰۵» for a Jalali or Gregorian month ("1405-08", "2026-11"), «۱۲ آبان» for a day. */
export function periodLabel(p: string, short = false): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(p)) return jDayMonth(dayDate(p));
  const m = p.match(/^(\d{4})-(\d{1,2})$/);
  // the server's own labels: «آبان ۱۴۰۵» (month) or «هفتهٔ …» (week); short = the month's name
  if (!m) return short ? p.replace(/^هفتهٔ /, "").replace(/ [۰-۹]{4}$/, "") : p;
  let [y, mo] = [Number(m[1]), Number(m[2])];
  if (y > 1700) {
    const j = toJalali(`${m[1]}-${m[2].padStart(2, "0")}-15`);
    y = j.jy;
    mo = j.jm;
  }
  const name = JALALI_MONTHS[mo - 1] ?? String(mo);
  return short ? name : `${name} ${fa(y).replace(/[^۰-۹]/g, "")}`;
}

export const weekLabel = (start: string) => (start ? jDayMonth(dayDate(start)) : "");

/** GET a forecast endpoint under the page's cache key. */
export function useForecast<R, T>(path: string, params: AiForecastQuery, read: (r: R) => T, enabled = true) {
  const { api } = useOrg();
  const key = useAiKey();
  return useQuery({ queryKey: key("forecast", path, params), queryFn: () => api.get<R>(`/ai/forecast/${path}`, params as Record<string, string | number | null | undefined>).then(read), enabled, staleTime: 10 * 60_000, retry: false });
}

/** «روش: … · خطای میانگین نسبت به روش ساده (MASE) ۰٫۸۲ · ۷۸٪ از ۲۴ آزمون در بازهٔ ۸۰٪» */
export function Accuracy({ method, mase, coverage, n }: { method?: string | null; mase?: string | null; coverage?: string | null; n?: number | null }) {
  const cov = coverageRatio(coverage);
  const m = mase !== null && mase !== undefined && mase !== "" ? Number(mase) : null;
  return (
    <p className="ai-fc-acc">
      {method ? <span>روش: {method}</span> : null}
      {m !== null && Number.isFinite(m) ? (
        <span title="خطای پیش‌بینی نسبت به روش «همان مقدار قبلی»؛ کمتر از ۱ یعنی بهتر از آن">
          دقت (MASE): <b className="sf-num">{fa(m, 2)}</b>
          {m < 1 ? " — بهتر از روش ساده" : " — بهتر از روش ساده نیست"}
        </span>
      ) : null}
      {cov !== null ? (
        <span>
          پوشش بازهٔ ۸۰٪: <b className="sf-num">{pct(cov, 0)}</b>
          {n ? ` در ${fa(n)} آزمون گذشته` : ""}
        </span>
      ) : null}
    </p>
  );
}

export function Disclaimer({ children }: { children?: ReactNode }) {
  return <p className="ai-fc-note">{children ?? "پیش‌بینی بازه است، نه عدد قطعی: از روی داده‌های گذشتهٔ همین کسب‌وکار ساخته شده و رویدادهای تازه را نمی‌بیند."}</p>;
}

/**
 * «توضیح با هوش مصنوعی» over a forecast: a short narrative from the business's model (or the server's template), and
 * «از دستیار بپرس». `series` null: only the assistant button (lists without a narrative of their own).
 */
export function ExplainForecast({ series, params, title }: { series: "cashflow" | "sales" | "demand" | "rate" | null; params: AiForecastQuery; title: string }) {
  const { api, can } = useOrg();
  const key = useAiKey();
  const status = useAiStatus(can("ai", "view"));
  const [on, setOn] = useState(false);
  const q = useQuery({
    queryKey: key("forecast-narrative", series, params),
    queryFn: () => api.post<AiForecastNarrative>(`/ai/forecast/${series}/narrative`, params).then(explainOf),
    enabled: on && !!series,
    staleTime: 30 * 60_000,
    retry: false,
  });
  if (!can("ai", "view") || (status.data && !status.data.enabled)) return null;
  const ctx: AiPageContext = { path: "reports/forecast", title: "پیش‌بینی و برنامه‌ریزی", report: { key: `forecast_${series ?? "stock"}`, params: { ...params } } };
  const kind = errorKindOf(q.error);
  const err = kind ? aiErrorText(kind, { canManage: can("ai", "full") }) : null;
  return (
    <div className="ai-fc-x">
      <div className="ai-fc-xb">
        {series ? (
          <Button icon={<Sparkles {...ICON} />} onClick={() => (on ? q.refetch() : setOn(true))} loading={q.isFetching}>
            توضیح با هوش مصنوعی
          </Button>
        ) : null}
        <Button type="text" icon={<MessageCircleQuestion {...ICON} />} onClick={() => openAssistant({ prompt: `دربارهٔ «${title}» توضیح بده: چه چیزی پشت این پیش‌بینی است و چه کار کنم؟`, send: true, context: ctx })}>
          از دستیار بپرس
        </Button>
      </div>
      {q.error ? (
        <div className="ai-err" role="alert">
          <CircleAlert {...ICON} aria-hidden />
          <div>
            <b>{err?.title ?? "توضیح آماده نشد"}</b>
            <span>{err?.remedy ?? failText(q.error)}</span>
          </div>
        </div>
      ) : q.data?.narrative ? (
        <div className="ai-well">
          <Narrative text={q.data.narrative} />
        </div>
      ) : null}
    </div>
  );
}

/** A quiet error row for a forecast that failed to load. */
export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="ai-err" role="alert">
      <CircleAlert {...ICON} aria-hidden />
      <div>
        <b>پیش‌بینی بارگذاری نشد</b>
        <span>{failText(error)}</span>
        <div className="mt-2">
          <Button size="small" onClick={onRetry}>
            تلاش دوباره
          </Button>
        </div>
      </div>
    </div>
  );
}
