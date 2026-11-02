// Shared pieces of the goods screens: the item picker (search by name, code or barcode with stock
// and the price for the document's party), quantity display and small tags.
import { useMemo, useState, type KeyboardEvent } from "react";
import { Select, Spin, Tag } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { useDebounced } from "../../lib/hooks";
import { D, type Num } from "@shared/money";
import { faDigits, formatNumber } from "@shared/format";
import { INVOICE_META, INVOICE_STATUS, STOCK_DOC_META, type InvoiceKind, type StockDocKind } from "./labels";
import { StatusTag } from "../../components/display";

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

export function Qty({ v, unit, className }: { v: Num; unit?: string | null; className?: string }) {
  const d = D(v);
  return (
    <span className={`num ${d.isNeg() ? "tz-neg" : ""} ${className ?? ""}`}>
      {formatNumber(d, { dp: 3 })}
      {unit ? <span className="ms-1 text-[11px] text-muted">{unit}</span> : null}
    </span>
  );
}

export function KindTag({ kind }: { kind: string }) {
  const m = INVOICE_META[kind as InvoiceKind];
  const s = STOCK_DOC_META[kind as StockDocKind];
  const label = m?.title ?? s?.title ?? kind;
  return (
    <Tag variant="filled" color={m?.color ?? s?.color} className="!m-0">
      {label}
    </Tag>
  );
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
      notFoundContent={list.isFetching ? <Spin size="small" /> : "کالایی پیدا نشد"}
      onChange={(id) => onChange(options.find((o) => o.id === id) ?? null)}
      options={options.map((o) => ({ value: o.id, label: `${faDigits(o.code)} — ${o.name}`, item: o }))}
      optionRender={(opt) => {
        const o = (opt.data as { item: ItemOpt }).item;
        const stock = o.wh_stock ?? o.stock;
        return (
          <div className="flex items-center gap-2">
            <span className="num w-14 shrink-0 text-xs text-muted">{faDigits(o.code)}</span>
            <span className="min-w-0 flex-1 truncate">{o.name}</span>
            {o.kind === "service" ? (
              <Tag variant="filled" className="!m-0 !text-[10px]">خدمت</Tag>
            ) : stock !== undefined && stock !== null ? (
              <span className={`num text-[11px] ${D(stock).gt(0) ? "text-ok" : "text-bad"}`}>{formatNumber(stock, { dp: 3 })} {o.unit_name ?? ""}</span>
            ) : null}
            {o.price ? <span className="num text-[11px] text-muted">{formatNumber(o.price)}</span> : null}
          </div>
        );
      }}
    />
  );
}

/** Translates a stock quantity in the main unit into the line's unit. */
export function inUnit(qtyMain: Num, factor: Num): string {
  const f = D(factor);
  return f.isZero() ? D(qtyMain).toString() : D(qtyMain).div(f).toDecimalPlaces(3).toString();
}
