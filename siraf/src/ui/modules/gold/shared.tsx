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
import { SourceCredit, StatusTag, Weight } from "../../components/display";
import { Ic } from "../../components/shell/icons";
import { pct as faPct } from "../../lib/fa";
import { KINDS, FORM_TITLES, WAGE_TYPE_TITLES, type DocKind, type PriceEnv } from "../../../server/modules/gold/pricing";
import { vatPctAt, type PremiumBand, type VatPeriod } from "@shared/gold";
import { STANDARD_CATALOGUE, type GoldMeta, type ProductKind } from "@shared/gold-catalogue";
import { DEFAULT_BAR_DEFAULTS, barLineDefaults, coinLineDefaults, premiumToWage, type BarDefaults, type QuoteEnv } from "@shared/gold-quote";
import { barUnitCost, type LineIn } from "../../../server/modules/gold/pricing";

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
const CATALOGUE_NAMES = new Map(STANDARD_CATALOGUE.map((e) => [e.key, e.name]));
/** Name of a board key (the catalogue's name when the business has none of its own). */
export const coinTitle = (k: string, names?: Map<string, string>) => names?.get(k) ?? CATALOGUE_NAMES.get(k) ?? k;

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
  /** a custom JSON source; `header` (or {key} in `url`) carries the key this runtime keeps (never sent to the page) */
  price_source: { url: string; unit?: "rial" | "toman"; paths: Record<string, string>; header?: string; label?: string; link?: string } | null;
  kyc?: { enabled: boolean; threshold: string | null };
  bars?: BarDefaults & { premium_bands: PremiumBand[] };
  vat_history?: VatPeriod[];
  stale_minutes?: number;
  deviation_pct?: string;
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
  coins_buy?: Record<string, string>;
  bubbles?: Record<string, { domestic: string | null; world: string | null; domestic_amount: string | null; world_amount: string | null }>;
  meta?: {
    retail?: Record<string, string>; provider_bubble?: Record<string, string>; stale?: string[]; carried?: string[]; deviations?: string[];
    /** a custom source's own name and link, shown next to its prices */
    source_label?: string; source_link?: string;
  };
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
  buy_price?: string | null;
  rate_key?: string | null;
  gold_meta?: GoldMeta;
  is_active?: boolean;
}

/** A coin or bar model of the catalogue with stock, gold content, today's prices and bubble. */
export interface CatalogueRow {
  id: string;
  code: string;
  name: string;
  kind: ProductKind;
  rate_key: string | null;
  gold_weight: string | null;
  fineness: string | null;
  barcode: string | null;
  is_active: boolean;
  gold_meta: GoldMeta;
  qty: string;
  value: string;
  avg_cost: string | null;
  weight: string;
  pure: string;
  weight750: string;
  sell: string | null;
  buy: string | null;
  sell_value: string | null;
  buy_value: string | null;
  bubble: { domestic: string | null; world: string | null; domestic_amount: string | null; world_amount: string | null } | null;
}

export function useCatalogue(kind?: ProductKind) {
  const { api, orgId } = useOrg();
  return useQuery({
    queryKey: ["gold-catalogue", orgId, kind ?? "all"],
    queryFn: () => api.get<{ rows: CatalogueRow[]; rate: { at: string; gram18: string | null; source: string; meta?: Rate["meta"] } | null }>(`/gold/catalogue${kind ? `?kind=${kind}` : ""}`),
    staleTime: 30_000,
  });
}

/** A bar of the register. */
export interface Bar {
  id: string;
  bar_no: string;
  item_id: string | null;
  model_name?: string | null;
  brand: string | null;
  serial_no: string | null;
  qr: string | null;
  nominal_weight: string | null;
  weight: string;
  fineness: string;
  fine_weight: string;
  weight750: string;
  certificate_no: string | null;
  certificate_issuer: string | null;
  assay_lab: string | null;
  assay_no: string | null;
  assay_date: string | null;
  seal_status: string;
  source: string;
  source_ref: string | null;
  ownership: string;
  party_id: string | null;
  party_name?: string | null;
  status: string;
  cost: string | null;
  in_doc_id: string | null;
  out_doc_id: string | null;
  notes: string | null;
}

export const BAR_STATUS: Record<string, [string, string]> = { ...ITEM_STATUS, sold: ["فروخته‌شده", "default"] };

export function useCoins() {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: ["gold-coins", orgId], queryFn: () => api.get<{ coins: Coin[] }>("/gold/coins").then((r) => r.coins), staleTime: 30_000 });
}

/** The money round step the server prices with (see server settings.moneyStep). */
export function stepOf(s: GoldSettings | undefined, moneyDecimals: number): string {
  if (s && D(s.round_step).gt(0)) return s.round_step;
  return moneyDecimals > 0 ? D(1).div(D(10).pow(moneyDecimals)).toString() : "1";
}

/** VAT percent of a date, as the server prices it (9% before 1405, the business's dated rates). */
export function taxOn(s: GoldSettings | undefined, date?: string | null): string {
  const pct = s?.tax_pct ?? "10";
  return date ? vatPctAt(date, pct, s?.vat_history) : pct;
}

export function quoteEnvOf(s: GoldSettings | undefined, moneyDecimals: number, date?: string | null): QuoteEnv {
  return { taxPct: taxOn(s, date), roundStep: stepOf(s, moneyDecimals), bars: s?.bars ?? DEFAULT_BAR_DEFAULTS };
}

export function envOf(s: GoldSettings | undefined, moneyDecimals: number, gram18: Num, mazaneh?: Num, date?: string | null): PriceEnv {
  return {
    gram18: gram18 || 0,
    mazaneh: mazaneh || null,
    profitPct: s?.profit_pct ?? "7",
    taxPct: taxOn(s, date),
    purchaseTaxPct: s?.purchase_tax_pct ?? "0",
    deductionPct: s?.old_deduction_pct ?? "0",
    roundStep: stepOf(s, moneyDecimals),
  };
}

/** The fields of a coin or bar row of a document screen that pricing needs. */
export interface CatalogueLineSrc {
  kind: string;
  direction: "out" | "in";
  qty?: string | null;
  weight?: string | null;
  fineness?: string | null;
  gram_price?: string | null;
  unit_price?: string | null;
  wage_type?: string | null;
  wage_value?: string | null;
  profit_pct?: string | null;
  discount?: string | null;
  cost?: string | null;
  seal_status?: string | null;
  /** margin VAT: the cost of the bar sold (its own cost) */
  unit_cost?: string | null;
  /** bars sold: a consigned bar's margin is over what its owner is owed */
  ownership?: string | null;
}

/** A bar bought in whose unit price came back from a saved document: the board's price for its seal then. */
export interface BoardUnitSrc {
  seal_status?: string | null;
  unit_price?: string | null;
  board_unit?: boolean;
}

/**
 * Applies a row patch. The board price a saved bar row came back with is for the seal it had then:
 * a new seal drops it so the row is priced afresh (an opened bar by its metal with the fees), while a
 * price the user types stays theirs.
 */
export function patchLine<T extends BoardUnitSrc>(l: T, patch: Partial<T>): T {
  const next: T = { ...l, ...patch };
  if ("unit_price" in patch) return { ...next, board_unit: false };
  if (l.board_unit && "seal_status" in patch && (patch.seal_status ?? "sealed") !== (l.seal_status ?? "sealed")) return { ...next, unit_price: null, board_unit: false };
  return next;
}

/**
 * The line a coin or bar row is priced with — the defaults of its product resolved from the board
 * exactly as the server resolves them (docs.ts prepare, src/shared/gold-quote.ts), so the screen
 * shows what posts. `buyGram18` is the buy price of an 18k gram of the screen (coins bought by weight).
 */
export function catalogueLineIn(
  docKind: DocKind, l: CatalogueLineSrc, prod: CatalogueRow | undefined, rate: Rate | null | undefined, s: GoldSettings | undefined, gram18: string | null, buyGram18?: string | null,
  env?: PriceEnv,
): LineIn {
  const side = l.direction === "out" ? "sell" : "buy";
  const priced = docKind === "sale" || docKind === "buyback" || docKind === "purchase" || (docKind === "opening" && !l.cost);
  if (l.kind === "coin") {
    const d = prod ? coinLineDefaults(prod, priced ? rate : null, side, { wholesale: docKind === "purchase" }) : null;
    const weight = prod ? D(l.qty || 0).times(D(prod.gold_weight ?? 0)).toString() : "0";
    const weighted = d?.pricing_mode === "weight";
    const price = l.gram_price || (priced ? (weighted ? (side === "sell" ? gram18 : buyGram18 || d?.gram_price || gram18) : d?.gram_price) : null) || null;
    // margin VAT on the price over the average cost of the stock (the server takes it at the document's date)
    const unitCost = d?.vat_mode === "margin" && side === "sell" && docKind === "sale" ? l.unit_cost || prod?.avg_cost || "0" : null;
    return {
      kind: "coin", direction: l.direction, qty: l.qty, fineness: prod?.fineness ?? "900", weight, gram_price: price, pricing_mode: d?.pricing_mode ?? "board", vat_mode: d?.vat_mode ?? "exempt",
      wage_type: weighted ? l.wage_type ?? d!.wage_type : null, wage_value: weighted ? l.wage_value ?? d!.wage_value : null,
      profit_pct: weighted && side === "sell" ? l.profit_pct ?? d!.profit_pct : null, unit_cost: unitCost, discount: l.discount, cost: l.cost,
    };
  }
  const d = barLineDefaults(prod, { weight: l.weight ?? prod?.gold_weight ?? 0, seal_status: l.seal_status }, rate, s?.bars ?? DEFAULT_BAR_DEFAULTS, side);
  const sellSide = docKind === "sale" && side === "sell";
  const buyIn = (docKind === "sale" || docKind === "buyback") && side === "buy";
  const unit = l.unit_price || (sellSide || buyIn ? d.unit_price : null);
  const line: LineIn = {
    // bought from a customer: the buy price of an 18k gram (the screen's, else the board's)
    kind: "bar", direction: l.direction, weight: l.weight, fineness: l.fineness, gram_price: l.gram_price || (buyIn && !unit ? buyGram18 || d.gram_price : null),
    unit_price: unit, basis: d.basis, unit_cost: sellSide && d.vat_mode === "margin" ? l.unit_cost || "0" : null,
    wage_type: sellSide ? l.wage_type ?? premiumToWage(d.premium_type) : docKind === "purchase" || docKind === "opening" ? l.wage_type ?? "percent" : null,
    wage_value: sellSide ? l.wage_value ?? d.premium_value : docKind === "purchase" || docKind === "opening" ? l.wage_value ?? "0" : null,
    profit_pct: sellSide ? l.profit_pct : null, vat_mode: d.vat_mode, discount: l.discount, cost: l.cost, sealed: (l.seal_status ?? "sealed") === "sealed",
    fee_pct: buyIn ? (unit ? "0" : d.fee_pct) : null, assay_fee: buyIn ? d.assay_fee : null, opened_fineness: d.opened_fineness,
  };
  // a consigned bar: what its owner is owed at the screen's gram price (as docs.ts prepare)
  if (line.unit_cost !== null && l.ownership === "consignment" && env) line.unit_cost = barUnitCost({ ownership: "consignment" }, line, env);
  return line;
}

/** A 10 px filled triangle (Arad and the digit font lack ▲ ▼). */
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

export const SOURCE_FA: Record<string, string> = { manual: "دستی", tgju: "tgju", goldapi: "انس جهانی", custom: "منبع دلخواه" };

/** Where a rate came from: a custom source by its own name («منبع: EZRate», linked), others by their title. */
export function RateSource({ rate, bare }: { rate: Pick<Rate, "source" | "meta">; bare?: boolean }) {
  const label = rate.source === "custom" ? rate.meta?.source_label : undefined;
  return label ? <SourceCredit label={label} link={rate.meta?.source_link} bare={bare} /> : <span>{SOURCE_FA[rate.source] ?? rate.source}</span>;
}

export function RateStamp({ rate }: { rate: Rate | null | undefined }) {
  if (!rate) return <span>قیمتی ثبت نشده است</span>;
  return (
    <Tooltip title={rate.note ?? undefined}>
      <span className="inline-flex items-center gap-2">
        <span className="sf-num">{formatJalaliDateTime(rate.at)}</span>
        <span className="sf-sep" aria-hidden />
        <RateSource rate={rate} />
      </span>
    </Tooltip>
  );
}

/**
 * Print a sheet with a given page size (lib/print.ts; the goods invoice prints through it too).
 */
export { printWithPage } from "../../lib/print";

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
