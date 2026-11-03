// Shared pieces of the goods screens: the item picker (search by name, code or barcode with stock
// and the price for the document's party), quantity display and small tags.
import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Select } from "antd";
import { useQuery } from "@tanstack/react-query";
import "./sheet.css";
import { useOrg } from "../../lib/org";
import { useDebounced } from "../../lib/hooks";
import { D, type Num } from "@shared/money";
import { faDigits, formatNumber } from "@shared/format";
import { INVOICE_META, INVOICE_STATUS, STOCK_DOC_META, type InvoiceKind, type StockDocKind } from "./labels";
import { Loader, StatusTag } from "../../components/display";

export interface ItemOpt {
  id: string;
  code: string;
  name: string;
  kind: "goods" | "service" | "coin";
  barcode: string | null;
  unit_id: string | null;
  unit_name: string | null;
  unit_decimals: number | null;
  unit2_id: string | null;
  unit2_name: string | null;
  unit2_decimals: number | null;
  unit2_factor: string | null;
  sale_price: string | null;
  purchase_price: string | null;
  min_sale_price?: string | null;
  vat_pct: string | null;
  tax_goods_id?: string | null;
  stock?: string | null;
  wh_stock?: string | null;
  avg_cost?: string | null;
  allow_negative?: boolean | null;
  price?: string | null;
  price_source?: string | null;
  discount_pct?: string | null;
}

/** Context sent with item searches: prices follow the document's kind, party and price list. */
export interface LookupContext {
  invoice_kind?: string | null;
  party_id?: string | null;
  price_list_id?: string | null;
  warehouse_id?: string | null;
  date?: string | null;
  kinds?: string;
}

/** A quantity with up to 3 decimals; a negative is an isolated true minus (never red); the unit small and quiet. */
export function Qty({ v, unit, className }: { v: Num; unit?: string | null; className?: string }) {
  const d = D(v);
  const body = formatNumber(d.abs(), { dp: 3 });
  return (
    <span className={`sf-num ${className ?? ""}`}>
      {d.isNeg() ? <bdi dir="ltr">{"\u2212"}{body}</bdi> : body}
      {unit ? <span className="sf-unit">{"\u00a0"}{unit}</span> : null}
    </span>
  );
}

/** The kind of a document: plain text (a category, not a status, so it wears no colour). */
export function KindTag({ kind }: { kind: string }) {
  const m = INVOICE_META[kind as InvoiceKind];
  const s = STOCK_DOC_META[kind as StockDocKind];
  return <span className="whitespace-nowrap text-ink-2">{m?.title ?? s?.title ?? kind}</span>;
}

export function InvoiceStatus({ s }: { s: string }) {
  return <StatusTag s={s} map={INVOICE_STATUS} />;
}

/** Searchable item picker over /goods/items/lookup. Calls `onChange` with the whole item. */
export function ItemSelect({
  value,
  item,
  onChange,
  ctx,
  disabled,
  autoFocus,
  placeholder = "نام، کد یا بارکد کالا…",
  variant,
  status,
  className,
  onKeyDown,
}: {
  value?: string | null;
  item?: ItemOpt | null;
  onChange: (item: ItemOpt | null) => void;
  ctx: LookupContext;
  disabled?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  variant?: "outlined" | "borderless" | "filled";
  status?: "error" | "warning";
  className?: string;
  onKeyDown?: (e: KeyboardEvent) => void;
}) {
  const { api } = useOrg();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const q = useDebounced(search, 200);
  const list = useQuery({
    queryKey: ["goods-items", q, ctx],
    queryFn: () => api.get<{ rows: ItemOpt[] }>("/goods/items/lookup", { q, ...ctx }).then((r) => r.rows),
    enabled: open || !!q,
    staleTime: 15_000,
  });
  const options = useMemo(() => {
    const all = [...(list.data ?? [])];
    if (item && !all.some((o) => o.id === item.id)) all.unshift(item);
    return all;
  }, [list.data, item]);
  return (
    <Select
      className={className}
      variant={variant}
      status={status}
      disabled={disabled}
      autoFocus={autoFocus}
      showSearch={{ filterOption: false, onSearch: setSearch }}
      value={value ?? undefined}
      placeholder={placeholder}
      popupMatchSelectWidth={420}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setSearch("");
      }}
      onKeyDown={onKeyDown}
      notFoundContent={list.isFetching ? <div className="grid place-items-center py-3"><Loader /></div> : <div className="py-2 text-center text-ink-3">کالایی پیدا نشد</div>}
      onChange={(id) => onChange(options.find((o) => o.id === id) ?? null)}
      options={options.map((o) => ({ value: o.id, label: `${faDigits(o.code)} — ${o.name}`, item: o }))}
      labelRender={(p) => {
        const o = options.find((x) => x.id === p.value);
        return o ? <span><span className="sf-docno">{faDigits(o.code)}</span> — <LatinRuns text={o.name} /></span> : p.label;
      }}
      optionRender={(opt) => {
        const o = (opt.data as { item: ItemOpt }).item;
        const stock = o.wh_stock ?? o.stock;
        return (
          <div className="sf-opt">
            <span className="sf-opt-code">{faDigits(o.code)}</span>
            <span className="sf-opt-main flex-1"><LatinRuns text={o.name} /></span>
            {o.kind === "service" ? (
              <span className="text-[12px] text-ink-3">خدمت</span>
            ) : stock !== undefined && stock !== null ? (
              <span className={`sf-num text-[12px] ${D(stock).gt(0) ? "text-ink-3" : "text-danger"}`}>{formatNumber(stock, { dp: 3 })} {o.unit_name ?? ""}</span>
            ) : null}
            {o.price ? <span className="sf-num min-w-[84px] text-[12px] text-ink-2">{formatNumber(o.price)}</span> : null}
          </div>
        );
      }}
    />
  );
}

/**
 * A name that may carry Latin model names («Galaxy Tab A9», «Band 8», «C1»): every Latin run is an isolate in Geist
 * with Latin digits (`.sf-latin`), so Siraf Num (whose ASCII digits are Persian) never draws its digits. Persian text stays as is.
 */
const LATIN_RUN = /[A-Za-z][A-Za-z0-9.\-+/]*(?:[ ][A-Za-z0-9][A-Za-z0-9.\-+/]*)*/g;
export function LatinRuns({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(LATIN_RUN)) {
    const i = m.index ?? 0;
    if (i > at) parts.push(text.slice(at, i));
    parts.push(<bdi key={i} dir="ltr" className="sf-latin">{m[0]}</bdi>);
    at = i + m[0].length;
  }
  if (!parts.length) return <>{text}</>;
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

/**
 * Keeps a sticky side sheet (`.sf-dsheet`) inside the viewport: its height is what is left below its top (or below
 * its sticky offset once the page scrolls), so the footer with the total and the save action never falls below the
 * fold. Writes `--sheet-max` on the element; the CSS falls back to the full height without it.
 */
export function useSheetFit<T extends HTMLElement>() {
  const cleanup = useRef<(() => void) | null>(null);
  return useCallback((el: T | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!el) return;
    let raf = 0;
    const fit = () => {
      raf = 0;
      const cs = getComputedStyle(el);
      if (cs.position !== "sticky") {
        el.style.removeProperty("--sheet-max");
        return;
      }
      const stickTop = parseFloat(cs.insetBlockStart) || 0;
      const top = Math.max(el.getBoundingClientRect().top, stickTop);
      el.style.setProperty("--sheet-max", `${Math.max(320, Math.floor(window.innerHeight - top - 16))}px`);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(fit);
    };
    fit();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const ro = new ResizeObserver(schedule);
    if (el.parentElement) ro.observe(el.parentElement);
    cleanup.current = () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
}

/** Translates a stock quantity in the main unit into the line's unit. */
export function inUnit(qtyMain: Num, factor: Num): string {
  const f = D(factor);
  return f.isZero() ? D(qtyMain).toString() : D(qtyMain).div(f).toDecimalPlaces(3).toString();
}
