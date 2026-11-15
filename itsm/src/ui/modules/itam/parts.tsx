// Small shared pieces of the asset, supplier and financial screens: money in the organisation's unit (Rials or Tomans,
// Persian digits grouped, tabular), a usage meter, the AI/rule label of a narrative, and lazy-loading wrappers of
// record-page widgets.
import { type ComponentType, type ReactNode } from "react";
import { lazy, Suspense } from "@ui/lib/lazy";
import { useQuery } from "@tanstack/react-query";
import { formatRial, type MoneyUnit } from "@shared/financial/logic";
import { useOrg } from "../../lib/org";
import { Loader } from "../../components/display";
import type { RecordContext } from "../../records/extensions";
import { moneyUnitOf } from "./api";

export const ICON = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

/** The money unit the organisation shows (cached for five minutes). */
export function useMoneyUnit(): MoneyUnit {
  const { api, orgId } = useOrg();
  const q = useQuery({ queryKey: ["financial", orgId, "unit"], queryFn: () => moneyUnitOf(api), staleTime: 300_000 });
  return q.data ?? "rial";
}

/** An amount in Rials, shown in the organisation's unit («—» when hidden or empty). */
/** An amount in Rials (or Tomans by the organisation's setting); `compact` for tiles: «۱۰٫۸ میلیارد ریال», exact in the tooltip. */
export function Money({ v, unit, suffix = true, compact = false }: { v: string | number | null | undefined; unit?: MoneyUnit; suffix?: boolean; compact?: boolean }) {
  const u = useMoneyUnit();
  if (v === null || v === undefined || v === "") return <span className="text-ink-3">—</span>;
  const exact = formatRial(String(v), unit ?? u, { suffix });
  if (!compact) return <span className="ds-num whitespace-nowrap">{exact}</span>;
  return <span className="ds-num" title={exact}>{formatRial(String(v), unit ?? u, { suffix, compact: true })}</span>;
}

/** A usage bar: green under 75 %, amber to 100 %, red beyond. */
export function Meter({ pct, label }: { pct: number | null; label?: string }) {
  if (pct === null || !Number.isFinite(pct)) return <span className="text-ink-3">—</span>;
  const tone = pct > 100 ? "var(--ds-danger)" : pct >= 75 ? "var(--ds-warning-fill)" : "var(--ds-in)";
  return (
    <span className="itam-meter" aria-label={label ?? `${Math.round(pct)}٪`}>
      <span className="itam-meter-bar" aria-hidden>
        <span style={{ width: `${Math.max(3, Math.min(100, pct))}%`, background: tone }} />
      </span>
      <span className="ds-num text-[12px]">{new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 }).format(pct)}٪</span>
    </span>
  );
}

/** «ساخته‌شده با هوش مصنوعی…» or «بدون مدل هوش مصنوعی و با قاعده ساخته شد». */
export function AiLabel({ ai, model }: { ai: boolean; model: string | null }) {
  return <div className="text-[12px] text-ink-3">{ai ? `ساخته‌شده با هوش مصنوعی${model ? ` (${model})` : ""} — پیش از استفاده بازبینی کنید` : "بدون مدل هوش مصنوعی و با قاعده ساخته شد"}</div>;
}

/** A record-page widget that loads with first use. */
export const widget = (C: ComponentType<{ ctx: RecordContext }>) => (ctx: RecordContext): ReactNode => (
  <Suspense fallback={<Loader />}>
    <C ctx={ctx} />
  </Suspense>
);
export const action = (key: string, C: ComponentType<{ ctx: RecordContext }>) => (ctx: RecordContext): ReactNode => (
  <Suspense key={key} fallback={null}>
    <C ctx={ctx} />
  </Suspense>
);
export const lazyPage = (node: ReactNode) => <Suspense fallback={<Loader />}>{node}</Suspense>;
export const lazyPart = <K extends string>(load: () => Promise<Record<K, ComponentType<{ ctx: RecordContext }>>>, name: K) => lazy(() => load().then((m) => ({ default: m[name] })));
