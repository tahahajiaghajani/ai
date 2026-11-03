// Shared pieces of the exchange screens: the rate board query, currency pickers and amount
// display with each currency's own decimals, live market quotes, legs (cash box / bank /
// wallet / customer account) and labels.
import "./fx.css";
import "../goods/sheet.css";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Select, Segmented, Tooltip } from "antd";
import { SourceCredit, StatusTag } from "../../components/display";
import { pct as faPct } from "../../lib/fa";
import { useOrg } from "../../lib/org";
import { RefSelect } from "../../components/inputs";
import { formatNumber, faDigits, groupDigits } from "@shared/format";
import { formatJalaliDateTime } from "@shared/jalali";
import { D, type Num } from "@shared/money";

// ---------------------------------------------------------------- types

export type Kind = "fiat" | "crypto" | "metal";
export type Method = "cash" | "bank" | "wallet" | "party";

export interface BoardRate {
  id: string;
  buy: string | null;
  sell: string | null;
  mid: string | null;
  at: string;
  source: string;
  /** a custom source's own name and link, shown next to its rate (free plans such as EZRate's ask for it) */
  source_label?: string | null;
  source_link?: string | null;
}

/** The name and link of a custom source, as the board and the market answers give them. */
export interface SourceLabel {
  source_label: string;
  source_link: string | null;
}

export interface BoardCurrency {
  id: string;
  code: string;
  name: string;
  symbol: string | null;
  kind: Kind;
  decimals: number;
  is_base: boolean;
  is_active: boolean;
  sort: number;
  price_ids: Record<string, string>;
  rate: BoardRate | null;
  change_pct: string | null;
}

export interface Board {
  base: BoardCurrency;
  settings: { providers: string[]; margin_pct: string; refresh_seconds: number; kyc_threshold: string | null };
  currencies: BoardCurrency[];
}

// ---------------------------------------------------------------- labels

export const KIND_FA: Record<string, string> = { buy: "خرید ارز", sell: "فروش ارز", exchange: "تبدیل ارز" };
export const KIND_COLOR: Record<string, string> = { buy: "cyan", sell: "gold", exchange: "purple" };
export const CUR_KIND_FA: Record<Kind, string> = { fiat: "ارز", crypto: "رمزارز", metal: "فلز" };
export const METHOD_FA: Record<Method, string> = { cash: "صندوق", bank: "بانک", wallet: "کیف‌پول", party: "حساب مشتری" };
export const SOURCE_FA: Record<string, string> = {
  manual: "دستی", kucoin: "KuCoin", okx: "OKX", coingecko: "CoinGecko", mempool: "mempool", open_er: "نرخ رسمی", tgju: "tgju", nobitex: "نوبیتکس",
  nobitex_usdt: "تتر نوبیتکس", gold_api: "gold-api", custom: "منبع سفارشی", stable: "≈ دلار", base: "ارز پایه", USD: "دلار",
};
export const DEAL_STATUS: Record<string, [string, string]> = { draft: ["پیش‌نویس", "default"], posted: ["ثبت‌شده", "processing"], cancelled: ["باطل‌شده", "error"] };
export const REM_STATUS: Record<string, [string, string]> = {
  pending: ["در انتظار", "default"], sent: ["در راه", "processing"], paid: ["پرداخت‌شده", "success"], cancelled: ["لغوشده", "error"], returned: ["برگشتی", "error"],
};
export const STATUS_ACTION: Record<string, string> = { sent: "ارسال به همکار", paid: "پرداخت شد", cancelled: "لغو حواله", returned: "برگشت حواله", pending: "بازگشت به «در انتظار»" };

export const EXPLORER: Record<string, { address: string; tx: string }> = {
  BTC: { address: "https://mempool.space/address/", tx: "https://mempool.space/tx/" },
  LTC: { address: "https://litecoinspace.org/address/", tx: "https://litecoinspace.org/tx/" },
  DOGE: { address: "https://blockchair.com/dogecoin/address/", tx: "https://blockchair.com/dogecoin/transaction/" },
  ETH: { address: "https://etherscan.io/address/", tx: "https://etherscan.io/tx/" },
  BSC: { address: "https://bscscan.com/address/", tx: "https://bscscan.com/tx/" },
  POLYGON: { address: "https://polygonscan.com/address/", tx: "https://polygonscan.com/tx/" },
  ARBITRUM: { address: "https://arbiscan.io/address/", tx: "https://arbiscan.io/tx/" },
  BASE: { address: "https://basescan.org/address/", tx: "https://basescan.org/tx/" },
  TRON: { address: "https://tronscan.org/#/address/", tx: "https://tronscan.org/#/transaction/" },
  SOL: { address: "https://solscan.io/account/", tx: "https://solscan.io/tx/" },
  TON: { address: "https://tonviewer.com/", tx: "https://tonviewer.com/transaction/" },
};

// ---------------------------------------------------------------- formatting

/** A number with up to `dp` decimals, Persian digits and separators. */
export const fnum = (v: Num, dp = 8) => formatNumber(v, { dp });

/** Readable rate: large numbers whole, small ones with significant decimals. */
export function rateLabel(v: Num, baseDp = 0): string {
  const d = D(v);
  if (d.isZero()) return "—";
  if (d.abs().gte(1000)) return formatNumber(d, { dp: baseDp });
  if (d.abs().gte(1)) return formatNumber(d, { dp: 4 });
  return formatNumber(d.toSignificantDigits(6), { dp: 12 });
}

/**
 * An amount in a currency. With a Latin code it is written in Latin digits in Geist («12,480.50 USDT»): the digit
 * script follows the unit's script (components.md §4.8). Without a code it is a Persian figure (a column whose header
 * carries the unit). Negatives are an isolated true minus, never red; `colored` paints money in green.
 */
export function FxAmount({ v, code, dp = 8, colored, className, strong, zero }: { v: Num; code?: string | null; dp?: number; colored?: boolean; className?: string; strong?: boolean; zero?: string }) {
  const d = D(v);
  if (zero !== undefined && d.isZero()) return <span className={`sf-num sf-zero ${className ?? ""}`}>{zero}</span>;
  const inT = colored && d.gt(0);
  if (code && /^[A-Za-z0-9.]+$/.test(code)) {
    const body = formatNumber(d.abs(), { dp, fa: false });
    return (
      <bdi dir="ltr" className={`sf-fxa ${inT ? "is-in" : ""} ${strong ? "is-strong" : ""} ${className ?? ""}`}>
        <span>{d.isNeg() ? "\u2212" : ""}{body}</span>
        <span className="c">{code}</span>
      </bdi>
    );
  }
  const body = formatNumber(d.abs(), { dp });
  return (
    <span className={`sf-num ${inT ? "sf-in-t" : ""} ${strong ? "font-semibold" : ""} ${className ?? ""}`}>
      {d.isNeg() ? <bdi dir="ltr">{"\u2212"}{body}</bdi> : body}
      {code ? <span className="sf-unit">{"\u00a0"}{code}</span> : null}
    </span>
  );
}

/** A 10 px filled triangle (Arad and the digit font lack ▲ ▼). */
function Tri({ up }: { up: boolean }) {
  return (
    <svg viewBox="0 0 10 10" aria-hidden>
      <path d={up ? "M5 1.5 9 8H1z" : "M5 8.5 1 2h8z"} fill="currentColor" />
    </svg>
  );
}

/** 24 h change as a delta chip: up in `in`, down in `danger`, below 0.1 % neutral. */
export function Change({ pct }: { pct: string | null | undefined }) {
  if (pct === null || pct === undefined || pct === "") return <span className="sf-zero text-[13px]">—</span>;
  const d = D(pct);
  const flat = d.abs().lt(0.1);
  return (
    <span className="sf-delta" data-dir={flat ? undefined : d.gt(0) ? "up" : "down"}>
      {flat ? null : <Tri up={d.gt(0)} />}
      {faPct(d.abs().div(100).toNumber(), 2)}
    </span>
  );
}

/** The currency chip: sea tint, the ISO code in Geist 600 (only inside «صرافی»). */
export function CurrencyChip({ c, size = "sm" }: { c: Pick<BoardCurrency, "code" | "kind"> | null | undefined; size?: "sm" | "lg" }) {
  if (!c) return null;
  return <span className={`sf-cur ${size === "lg" ? "is-lg" : ""}`}>{c.code}</span>;
}

/** The round currency avatar (24 / 28 / 36). */
export function CurrencyAvatar({ code, size }: { code: string; size?: "sm" | "lg" }) {
  return <span className={`sf-cur-av ${size === "sm" ? "is-sm" : size === "lg" ? "is-lg" : ""}`} data-long={code.length >= 4 ? "" : undefined} aria-hidden>{code.slice(0, 4)}</span>;
}

/** Avatar + the Persian name over its code. */
export function CurrencyName({ c, sub }: { c: Pick<BoardCurrency, "code" | "name"> & { kind?: Kind }; sub?: ReactNode }) {
  return (
    <span className="sf-cur-name">
      <CurrencyAvatar code={c.code} />
      <span className="t">
        <b>{c.name}</b>
        <span>{sub ?? <bdi dir="ltr" className="sf-latin">{c.code}</bdi>}</span>
      </span>
    </span>
  );
}

/** Where a rate came from: plain text-3 (a source is not a status); a custom source by its own name, linked. */
export function SourceTag({ s, at, label, link }: { s?: string | null; at?: string | null; label?: string | null; link?: string | null }) {
  if (!s) return <span className="sf-zero">—</span>;
  const t = <span className="whitespace-nowrap text-[13px] text-ink-3">{label ? <SourceCredit label={label} link={link} bare /> : SOURCE_FA[s] ?? s}</span>;
  return at ? <Tooltip title={formatJalaliDateTime(at)}>{t}</Tooltip> : t;
}

/**
 * A remittance status (components.md §4.8): open remittances («در انتظار»، «در راه») are a neutral chip with a sea
 * nuqta, never amber (warning is for overdue only); paid is plain text; cancelled and returned are danger chips.
 */
export function RemStatus({ s }: { s: string }) {
  if (s === "pending" || s === "sent") {
    return (
      <span className="sf-chip" data-tone="neutral">
        <i className="sf-nuqta is-sea" aria-hidden />
        <span>{REM_STATUS[s][0]}</span>
      </span>
    );
  }
  return <StatusTag s={s} map={REM_STATUS} />;
}

const COUNTRY_FA: Record<string, string> = {
  UAE: "امارات", AE: "امارات", ARE: "امارات", "UNITED ARAB EMIRATES": "امارات", DUBAI: "امارات",
  TR: "ترکیه", TUR: "ترکیه", TURKEY: "ترکیه", TURKIYE: "ترکیه", IR: "ایران", IRN: "ایران", IRAN: "ایران",
  IQ: "عراق", IRQ: "عراق", IRAQ: "عراق", AF: "افغانستان", AFG: "افغانستان", AFGHANISTAN: "افغانستان",
  CN: "چین", CHN: "چین", CHINA: "چین", DE: "آلمان", DEU: "آلمان", GERMANY: "آلمان", GB: "بریتانیا", UK: "بریتانیا", GBR: "بریتانیا",
  US: "آمریکا", USA: "آمریکا", CA: "کانادا", CAN: "کانادا", CANADA: "کانادا", OM: "عمان", OMN: "عمان", OMAN: "عمان",
  QA: "قطر", QAT: "قطر", QATAR: "قطر", AM: "ارمنستان", ARM: "ارمنستان", ARMENIA: "ارمنستان", GE: "گرجستان", GEO: "گرجستان", GEORGIA: "گرجستان",
  MY: "مالزی", MYS: "مالزی", MALAYSIA: "مالزی", RU: "روسیه", RUS: "روسیه", RUSSIA: "روسیه", FR: "فرانسه", FRA: "فرانسه", FRANCE: "فرانسه",
  IT: "ایتالیا", ITA: "ایتالیا", ITALY: "ایتالیا", NL: "هلند", NLD: "هلند", SE: "سوئد", SWE: "سوئد", AU: "استرالیا", AUS: "استرالیا",
};

/** A country as Persian text («UAE» → «امارات»); a name already in Persian is kept. */
export const countryFa = (v: string | null | undefined) => (v ? COUNTRY_FA[v.trim().toUpperCase()] ?? v : v);

/** A tracking code grouped in fours with Persian digits («۰۵۷۱ ۱۸۲۰ ۱۳»), the same everywhere it is shown. */
export const trackNo = (v: string | null | undefined) => (v ? faDigits(groupDigits(String(v), 4)) : "—");

/** A deal or remittance status: plain text for the normal state, a chip only for what needs attention. */
export function FxStatus({ s, map }: { s: string; map: Record<string, [string, string]> }) {
  return <StatusTag s={s} map={map} />;
}

/** The direction of the last change of a value: "up" / "down" for 1.2 s after it changes (the live-rate flash). */
export function useFlash(value: string | null | undefined): string {
  const prev = useRef(value);
  const [cls, setCls] = useState("");
  useEffect(() => {
    const was = prev.current;
    prev.current = value;
    if (was === undefined || was === null || value === undefined || value === null || D(was).eq(D(value))) return;
    setCls(D(value).gt(D(was)) ? "sf-flash-up" : "sf-flash-down");
    const t = setTimeout(() => setCls(""), 1300);
    return () => clearTimeout(t);
  }, [value]);
  return cls;
}

/** «۵ دقیقه پیش» */
export function ago(ts: string | null | undefined): string {
  if (!ts) return "—";
  const s = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 60) return "لحظاتی پیش";
  if (s < 3600) return `${faDigits(Math.floor(s / 60))} دقیقه پیش`;
  if (s < 86400) return `${faDigits(Math.floor(s / 3600))} ساعت پیش`;
  return formatJalaliDateTime(ts);
}

// ---------------------------------------------------------------- data hooks

export function useBoard(refetchMs?: number) {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: ["fx-board", orgId], queryFn: () => api.get<Board>("/fx/rates"), staleTime: 15_000, refetchInterval: refetchMs });
}

export function useCurrencyMap(board: Board | undefined) {
  return useMemo(() => new Map((board?.currencies ?? []).map((c) => [c.id, c])), [board]);
}

export interface LiveQuote {
  code: string;
  name: string;
  kind: Kind;
  price_usd: string | null;
  change_24h: string | null;
  source: string | null;
  price_base: string | null;
}

export interface LiveAnswer {
  at: string;
  base: { code: string; decimals: number };
  usd_rate: string | null;
  usd_source: string | null;
  usd_label?: SourceLabel | null;
  quotes: LiveQuote[];
  errors: string[];
}

/** Live market quotes, refreshed every `refresh_seconds` of the business's fx settings. */
export function useLive(symbols: string[], enabled = true) {
  const { api, orgId, org } = useOrg();
  const seconds = Math.max(10, Number(org.settings?.fx?.refresh_seconds) || 60);
  return useQuery({
    queryKey: ["fx-live", orgId, symbols.join(",")],
    queryFn: () => api.get<LiveAnswer>("/fx/prices/live", { symbols: symbols.join(",") }),
    refetchInterval: seconds * 1000,
    staleTime: Math.min(seconds, 45) * 1000,
    enabled: enabled && symbols.length > 0,
    placeholderData: keepPreviousData,
  });
}

// ---------------------------------------------------------------- inputs

export function CurrencyPick({
  currencies, value, onChange, exclude, kinds, size, className, placeholder = "ارز…", disabled, allowClear, status, autoFocus,
}: {
  currencies: BoardCurrency[];
  value?: string | null;
  onChange?: (id: string | null) => void;
  exclude?: string[];
  kinds?: Kind[];
  size?: "small" | "middle" | "large";
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  status?: "error" | "warning";
  autoFocus?: boolean;
}) {
  const list = currencies.filter((c) => (c.is_active || c.id === value) && !exclude?.includes(c.id) && (!kinds || kinds.includes(c.kind)));
  return (
    <Select
      value={value ?? undefined}
      onChange={(v) => onChange?.((v as string) ?? null)}
      size={size}
      className={className}
      disabled={disabled}
      allowClear={allowClear}
      status={status}
      autoFocus={autoFocus}
      placeholder={placeholder}
      popupMatchSelectWidth={false}
      showSearch={{
        filterOption: (input, opt) => {
          const c = list.find((x) => x.id === opt?.value);
          const s = input.trim().toLowerCase();
          return !!c && (c.code.toLowerCase().includes(s) || c.name.includes(input.trim()));
        },
      }}
      options={list.map((c) => ({
        value: c.id,
        label: (
          <span className="flex items-center gap-2">
            <CurrencyAvatar code={c.code} size="sm" />
            <span>{c.name}</span>
            <bdi dir="ltr" className="sf-latin text-[12px] text-ink-3">{c.code}</bdi>
          </span>
        ),
      }))}
    />
  );
}

/** Quick buttons for the most used currencies under a picker. */
export function QuickCurrencies({ currencies, codes, value, onPick, exclude }: { currencies: BoardCurrency[]; codes: string[]; value?: string | null; onPick: (id: string) => void; exclude?: string | null }) {
  const list = codes.map((code) => currencies.find((c) => c.code === code)).filter((c): c is BoardCurrency => !!c && c.id !== exclude);
  return (
    <div className="sf-qcur" role="group" aria-label="ارزهای پرکاربرد">
      {list.map((c) => (
        <button key={c.id} type="button" tabIndex={-1} aria-pressed={c.id === value} onClick={() => onPick(c.id)} title={c.name}>
          {c.code}
        </button>
      ))}
    </div>
  );
}

export function methodsFor(kind: Kind | undefined): Method[] {
  return kind === "crypto" ? ["wallet", "party"] : ["cash", "bank", "party"];
}

export interface LegValue {
  method: Method;
  ref_id: string | null;
  /** chain of the chosen wallet (to prefill the network of a crypto transfer) */
  chain?: string | null;
}

/** Where an amount is received or paid: method buttons and the matching cash box / bank / wallet. */
export function LegPicker({ currency, value, onChange, partyName, disabled, size }: { currency?: BoardCurrency | null; value: LegValue; onChange: (v: LegValue) => void; partyName?: string | null; disabled?: boolean; size?: "small" | "middle" }) {
  const { api } = useOrg();
  const methods = methodsFor(currency?.kind);
  // keep the method valid for the currency (crypto has no cash box)
  useEffect(() => {
    if (currency && !methods.includes(value.method)) onChange({ method: methods[0], ref_id: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency?.kind]);
  // pick a sensible default cash box / wallet
  const defaults = useQuery({
    queryKey: ["fx-leg-default", value.method, currency?.id],
    queryFn: async () => {
      if (value.method === "cash") {
        const r = await api.get<{ options: { id: string; currency_id: string | null }[] }>("/data/cash_box/options");
        return r.options.find((o) => !o.currency_id || o.currency_id === currency?.id)?.id ?? null;
      }
      if (value.method === "wallet" && currency) {
        const r = await api.get<{ options: { id: string; kind: string }[] }>("/data/wallet/options", { "f.currency_id": currency.id });
        return r.options.find((o) => o.kind !== "customer")?.id ?? null;
      }
      return null;
    },
    enabled: !disabled && !!currency && (value.method === "cash" || value.method === "wallet") && !value.ref_id,
    staleTime: 60_000,
  });
  useEffect(() => {
    if (defaults.data && !value.ref_id) onChange({ ...value, ref_id: defaults.data });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaults.data]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented
        size={size ?? "small"}
        disabled={disabled}
        value={value.method}
        onChange={(m) => onChange({ method: m as Method, ref_id: null })}
        options={methods.map((m) => ({ value: m, label: METHOD_FA[m] }))}
      />
      <div className="min-w-[170px] flex-1">
        {value.method === "cash" ? (
          <RefSelect entity="cash_box" size={size ?? "small"} value={value.ref_id} disabled={disabled} onChange={(id) => onChange({ ...value, ref_id: id })} placeholder="صندوق…" />
        ) : value.method === "bank" ? (
          <RefSelect entity="bank_account" size={size ?? "small"} value={value.ref_id} disabled={disabled} onChange={(id) => onChange({ ...value, ref_id: id })} placeholder="حساب بانکی…" />
        ) : value.method === "wallet" ? (
          <RefSelect entity="wallet" size={size ?? "small"} value={value.ref_id} disabled={disabled} filters={{ currency_id: currency?.id }} onChange={(id, opt) => onChange({ ...value, ref_id: id, chain: opt?.chain ?? null })} placeholder="کیف‌پول…" showCode={false} />
        ) : (
          <span className={`text-[13px] ${partyName ? "text-ink" : "text-ink-3"}`}>{partyName ? `حساب «${partyName}»` : "ابتدا مشتری را انتخاب کنید"}</span>
        )}
      </div>
    </div>
  );
}

/** Small label/value grid used on detail pages and receipts. */
export function Facts({ items, cols = 2 }: { items: [ReactNode, ReactNode][]; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={`m-0 grid gap-x-8 ${cols === 3 ? "sm:grid-cols-3" : cols === 2 ? "sm:grid-cols-2" : ""}`}>
      {items
        .filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== false)
        .map(([k, v], i) => (
          <div key={i} className="flex min-w-0 items-baseline gap-3 border-b border-line py-2 text-[13px] leading-5">
            <dt className="shrink-0 text-ink-3">{k}</dt>
            <dd className="m-0 ms-auto min-w-0 truncate text-ink">{v}</dd>
          </div>
        ))}
    </dl>
  );
}
