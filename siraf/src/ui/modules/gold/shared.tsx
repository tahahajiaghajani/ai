// Shared pieces of the gold module UI: document kinds and their routes, data hooks (settings,
// latest rate, coins), small tags and cells, the pricing environment and print helpers.
// Pricing itself comes from the server's pure module so the screen shows exactly what posts.
import { useEffect, type ReactNode } from "react";
import { Button, Dropdown, Space, Tag, Tooltip, type MenuProps } from "antd";
import { ArrowUpOutlined, ArrowDownOutlined, DownOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { D, type Num } from "@shared/money";
import { formatNumber, formatWeight, faDigits } from "@shared/format";
import { formatJalaliDateTime } from "@shared/jalali";
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

const KIND_COLOR: Record<DocKind, string> = {
  sale: "gold", purchase: "cyan", buyback: "orange", consign_in: "purple", consign_return: "magenta", workshop_out: "geekblue",
  workshop_in: "blue", melt: "volcano", bullion_sale: "lime", opening: "default",
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

export function KindTag({ kind }: { kind: DocKind }) {
  return (
    <Tag color={KIND_COLOR[kind] ?? "default"} variant="filled" className="!m-0">
      {KINDS[kind]?.title ?? kind}
    </Tag>
  );
}

export function StatusOf({ s, map = DOC_STATUS }: { s: string; map?: Record<string, [string, string]> }) {
  const [label, color] = map[s] ?? [s, "default"];
  return (
    <Tag color={color} variant="filled" className="!m-0">
      {label}
    </Tag>
  );
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

/** Grams with up to three decimals (سوت), Persian digits. */
export function G({ v, zero = "—", unit }: { v: Num; zero?: string; unit?: boolean }) {
  const d = D(v);
  if (d.isZero()) return <span className="num text-muted">{zero}</span>;
  return (
    <span className={`num ${d.isNeg() ? "tz-neg" : ""}`}>
      {formatWeight(d)}
      {unit ? <span className="ms-1 text-[11px] text-muted">گرم</span> : null}
    </span>
  );
}

/** Signed weight balance with «بد / بس» (we are owed / we owe). */
export function WBalance({ v }: { v: Num }) {
  const d = D(v);
  if (d.isZero()) return <span className="num text-muted">—</span>;
  return (
    <span className="num">
      {formatWeight(d.abs())}
      <span className={`ms-1 text-[11px] ${d.gt(0) ? "text-brand" : "text-gold"}`}>{d.gt(0) ? "بد" : "بس"}</span>
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

/** Change of the 18k gram against the previous rate: ▲ green / ▼ red. */
export function RateChange({ change, pct }: { change: string | null | undefined; pct: string | null | undefined }) {
  if (!change || D(change).isZero()) return <span className="text-xs text-muted">بدون تغییر</span>;
  const up = D(change).gt(0);
  return (
    <span className={`num inline-flex items-center gap-1 text-xs ${up ? "text-ok" : "text-bad"}`}>
      {up ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
      {formatNumber(D(change).abs())}
      {pct ? <span>({faDigits(D(pct).abs().toString())}٪)</span> : null}
    </span>
  );
}

export function RateStamp({ rate }: { rate: Rate | null | undefined }) {
  if (!rate) return <span className="text-xs text-muted">قیمتی ثبت نشده است</span>;
  const src: Record<string, string> = { manual: "دستی", tgju: "tgju", goldapi: "انس جهانی", custom: "منبع دلخواه" };
  return (
    <Tooltip title={rate.note ?? undefined}>
      <span className="text-xs text-muted">
        {formatJalaliDateTime(rate.at)}، {src[rate.source] ?? rate.source}
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
    <div className="mb-2 flex items-center gap-2">
      <div className="text-xs font-bold text-muted">{children}</div>
      <div className="ms-auto">{extra}</div>
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
        <Button type={type} icon={<DownOutlined />} aria-label="گزینه‌های بیشتر" />
      </Dropdown>
    </Space.Compact>
  );
}
