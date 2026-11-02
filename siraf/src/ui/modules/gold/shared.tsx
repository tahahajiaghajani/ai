// Shared pieces of the gold module UI: document kinds and their routes, data hooks (settings,
// latest rate, coins), small tags and cells, the pricing environment and print helpers.
// Pricing itself comes from the server's pure module so the screen shows exactly what posts.
import "./gold.css";
import "../goods/sheet.css";
import { useEffect, type ReactNode } from "react";
import { Button, Dropdown, Space, Tooltip, type MenuProps } from "antd";
import { ChevronDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { D, type Num } from "@shared/money";
import { formatNumber, faDigits } from "@shared/format";
import { formatJalaliDateTime } from "@shared/jalali";
import { StatusTag, Weight } from "../../components/display";
import { Ic } from "../../components/shell/icons";
import { pct as faPct } from "../../lib/fa";
import { KINDS, COIN_TITLES, FORM_TITLES, WAGE_TYPE_TITLES, type DocKind, type PriceEnv } from "../../../server/modules/gold/pricing";

export * from "../../../server/modules/gold/pricing";

/** Route of each document kind's editor (relative to /:org/). */
// (nested under the menu item they belong to, so the side menu keeps it highlighted)
export const KIND_PATH: Record<DocKind, string> = {
  sale: "gold/sale",
  purchase: "gold/purchase",
  buyback: "gold/buyback",
  consign_in: "gold/consignment/in",
  consign_return: "gold/consignment/return",
  workshop_out: "gold/workshop/out",
  workshop_in: "gold/workshop/in",
  melt: "gold/workshop/melt",
  bullion_sale: "gold/workshop/bullion-sale",
  opening: "gold/docs/opening",
};

export const DOC_STATUS: Record<string, [string, string]> = {
  draft: ["پیش‌نویس", "default"],
  posted: ["ثبت‌شده", "processing"],
  cancelled: ["باطل‌شده", "error"],
};

export const ITEM_STATUS: Record<string, [string, string]> = {
  in_stock: ["موجود", "success"],
  reserved: ["رزرو", "warning"],
  sold: ["فروخته‌شده", "default"],
  returned: ["برگشت به همکار", "magenta"],
  melted: ["ذوب‌شده", "volcano"],
  consigned_out: ["امانی نزد دیگران", "purple"],
};

/** The kind of a gold document: plain text (categories are not statuses and wear no colour). */
export function KindTag({ kind }: { kind: DocKind }) {
  return <span className="whitespace-nowrap text-ink-2">{KINDS[kind]?.title ?? kind}</span>;
}

/** Status is the exception: «ثبت‌شده» is plain text-3, a draft a neutral chip, a cancelled document a danger chip. */
export function StatusOf({ s, map = DOC_STATUS }: { s: string; map?: Record<string, [string, string]> }) {
  return <StatusTag s={s} map={map} />;
}

export const wageText = (type: string | null | undefined, value: Num) => {
  if (D(value).isZero()) return "—";
  if (type === "percent" || !type) return `${formatNumber(value, { dp: 3 })}٪`;
  if (type === "per_gram") return `${formatNumber(value)} هر گرم`;
  return `${formatNumber(value)} ثابت`;
};

export const formTitle = (f: string | null | undefined) => (f ? FORM_TITLES[f as keyof typeof FORM_TITLES] ?? f : "—");
export const wageTypeOptions = Object.entries(WAGE_TYPE_TITLES).map(([value, label]) => ({ value, label }));
export const formOptions = Object.entries(FORM_TITLES).map(([value, label]) => ({ value, label }));
export const coinTitle = (k: string) => COIN_TITLES[k] ?? k;

/** Grams with three decimals (سوت) at full size and in ink (a milligram is money); zero is «—». */
export function G({ v, zero = "—", unit }: { v: Num; zero?: string; unit?: boolean }) {
  const d = D(v);
  if (d.isZero()) return <span className="sf-num sf-zero">{zero}</span>;
  return <Weight v={d} unit={!!unit} />;
}

/** Weight balance: unsigned grams plus its «تشخیص» — «بد» (we are owed) or «بس» (we owe), never a colour. */
export function WBalance({ v }: { v: Num }) {
  const d = D(v);
  if (d.isZero()) return <span className="sf-num sf-zero">—</span>;
  return (
    <span className="sf-num">
      {formatNumber(d.abs(), { dp: 3, minDp: 3 })}
      {"\u00a0"}
      <span className="sf-bal-side">{d.gt(0) ? "بد" : "بس"}</span>
    </span>
  );
}

export interface GoldSettings {
  profit_pct: string;
  tax_pct: string;
  round_step: string;
  old_deduction_pct: string;
  purchase_tax_pct: string;
  provider: "auto" | "tgju" | "goldapi" | "custom";
  usd: string | null;
  price_source: { url: string; unit?: "rial" | "toman"; paths: Record<string, string> } | null;
}

export interface Rate {
  id: string;
  at: string;
  mazaneh: string | null;
  gram18: string | null;
  gram24: string | null;
  ounce_usd: string | null;
  usd: string | null;
  buy_gram18: string | null;
  coins: Record<string, string>;
  source: string;
  note?: string | null;
}

export function useGoldSettings() {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: ["gold-settings", orgId], queryFn: () => api.get<{ settings: GoldSettings }>("/gold/settings").then((r) => r.settings), staleTime: 60_000 });
}

export function useLatestRate() {
  const { api, orgId } = useOrg();
  return useQuery({
    queryKey: ["gold-rate", orgId],
    queryFn: () => api.get<{ rate: Rate | null; previous: Rate | null; change: string | null; change_pct: string | null }>("/gold/rates/latest"),
    refetchInterval: 60_000,
  });
}

export interface Coin {
  id: string;
  code: string;
  name: string;
  gold_weight: string | null;
  fineness: string | null;
  qty: string;
  value: string;
  avg_cost: string | null;
  key: string | null;
  price: string | null;
}

export function useCoins() {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: ["gold-coins", orgId], queryFn: () => api.get<{ coins: Coin[] }>("/gold/coins").then((r) => r.coins), staleTime: 30_000 });
}

/** The money round step the server prices with (see server settings.moneyStep). */
export function stepOf(s: GoldSettings | undefined, moneyDecimals: number): string {
  if (s && D(s.round_step).gt(0)) return s.round_step;
  return moneyDecimals > 0 ? D(1).div(D(10).pow(moneyDecimals)).toString() : "1";
}

export function envOf(s: GoldSettings | undefined, moneyDecimals: number, gram18: Num, mazaneh?: Num): PriceEnv {
  return {
    gram18: gram18 || 0,
    mazaneh: mazaneh || null,
    profitPct: s?.profit_pct ?? "7",
    taxPct: s?.tax_pct ?? "10",
    purchaseTaxPct: s?.purchase_tax_pct ?? "0",
    deductionPct: s?.old_deduction_pct ?? "0",
    roundStep: stepOf(s, moneyDecimals),
  };
}

/** A 10 px filled triangle (Vazirmatn and Arad lack ▲ ▼). */
export function Tri({ up }: { up: boolean }) {
  return (
    <svg viewBox="0 0 10 10" aria-hidden>
      <path d={up ? "M5 1.5 9 8H1z" : "M5 8.5 1 2h8z"} fill="currentColor" />
    </svg>
  );
}

/** Delta chip of the 18k gram against the previous rate: up in `in`, down in `danger`, below 0.1 % neutral. */
export function RateChange({ change, pct, amount }: { change: string | null | undefined; pct: string | null | undefined; amount?: boolean }) {
  if (!change || D(change).isZero()) return <span className="sf-delta">بدون تغییر</span>;
  const up = D(change).gt(0);
  const p = pct ? D(pct).abs() : null;
  const flat = p !== null && p.lt(0.1);
  return (
    <span className="sf-delta" data-dir={flat ? undefined : up ? "up" : "down"} title={`${up ? "افزایش" : "کاهش"} ${formatNumber(D(change).abs())}`}>
      {flat ? null : <Tri up={up} />}
      {amount || p === null ? formatNumber(D(change).abs()) : faPct(p.div(100).toNumber(), 2)}
    </span>
  );
}

const SOURCE_FA: Record<string, string> = { manual: "دستی", tgju: "tgju", goldapi: "انس جهانی", custom: "منبع دلخواه" };

export function RateStamp({ rate }: { rate: Rate | null | undefined }) {
  if (!rate) return <span>قیمتی ثبت نشده است</span>;
  return (
    <Tooltip title={rate.note ?? undefined}>
      <span className="inline-flex items-center gap-2">
        <span className="sf-num">{formatJalaliDateTime(rate.at)}</span>
        <span className="sf-sep" aria-hidden />
        <span>{SOURCE_FA[rate.source] ?? rate.source}</span>
      </span>
    </Tooltip>
  );
}

/**
 * Print a sheet with a given page size: adds an @page rule for the print, then removes it.
 * The sheet itself is any element with `hidden print:block` inside the page.
 */
export function printWithPage(size: string, margin = "6mm") {
  const style = document.createElement("style");
  style.setAttribute("data-gold-print", "1");
  // the page size of this print, without the app frame's padding around the sheet
  // (the frame's full-height layout would otherwise add blank pages — wasted labels on a roll)
  style.textContent = `@page { size: ${size}; margin: ${margin}; }
@media print {
  html, body, #root { height: auto !important; min-height: 0 !important; }
  .min-h-screen, .ant-layout { min-height: 0 !important; height: auto !important; background: #fff !important; }
  .ant-layout-content { padding: 0 !important; }
}`;
  document.head.appendChild(style);
  const done = () => {
    style.remove();
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  setTimeout(() => {
    const bridge = (window as unknown as { taraz?: { print?: (o?: Record<string, unknown>) => Promise<unknown> } }).taraz;
    if (bridge?.print) {
      // the Windows app prints asynchronously through Electron
      Promise.resolve(bridge.print({})).catch(() => window.print()).finally(done);
    } else {
      window.print();
      setTimeout(done, 1500);
    }
  }, 60);
}

/** Section title row used inside cards. */
export function Caption({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="sf-sec-t mb-2">
      <span>{children}</span>
      {extra ? <span className="sf-sec-x">{extra}</span> : null}
    </div>
  );
}

/** Focus an element after render (scanner field). */
export function useAutoFocus(ref: { current: { focus: () => void } | null }, deps: unknown[] = []) {
  useEffect(() => {
    const t = setTimeout(() => ref.current?.focus(), 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export const pct = (v: Num) => `${formatNumber(v, { dp: 3 })}٪`;

/** A gold weight as text: always three decimals («۱۲٫۳۴۰»), Persian digits (a milligram is money). */
export const gw = (v: Num) => formatNumber(v ?? 0, { dp: 3, minDp: 3 });

/** A button with a menu of alternatives (Space.Compact + Dropdown, the v6 replacement of Dropdown.Button). */
export function SplitButton({ children, onClick, loading, items, type, icon, disabled }: {
  children: ReactNode;
  onClick: () => void;
  loading?: boolean;
  items: MenuProps["items"];
  type?: "primary" | "default";
  icon?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Space.Compact>
      <Button type={type} icon={icon} loading={loading} onClick={onClick} disabled={disabled}>
        {children}
      </Button>
      <Dropdown menu={{ items }} trigger={["click"]} disabled={disabled}>
        <Button type={type} icon={<Ic icon={ChevronDown} />} aria-label="گزینه‌های بیشتر" />
      </Dropdown>
    </Space.Compact>
  );
}
