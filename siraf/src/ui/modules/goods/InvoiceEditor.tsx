// Invoice editor — sales and purchase invoices, returns, quotes and orders. Keyboard first:
// a barcode/code box adds or increments lines (Enter), Enter moves through the grid and the
// last cell opens a new row, F2 saves and posts, Alt+N adds a row, F4 jumps to the scan box.
// Totals use the same calculation as the server (calc.ts). Printing gives an A4 invoice.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Dropdown, Input, Modal, Select, Tooltip, type InputRef } from "antd";
import { ArrowLeftRight, Ban, CircleAlert, Copy, Ellipsis, FileOutput, FileText, IdCard, Plus, Printer, ScanBarcode, Tags, Text as TextIcon, Trash2, TriangleAlert, Undo2, X } from "lucide-react";
import { Ic } from "../../components/shell/icons";
import { useOrg } from "../../lib/org";
import { useHotkey, useNotify } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { PageHeader } from "../../components/layout";
import { DateInput, MoneyInput, NumberInput, PartySelect, PctInput, RefSelect } from "../../components/inputs";
import { Balance, JDateTime, Loader, Money } from "../../components/display";
import { D } from "@shared/money";
import { faDigits, formatNumber } from "@shared/format";
import { todayISO } from "@shared/jalali";
import { amountToWords } from "@shared/words";
import { uuidv7 } from "@shared/id";
import { calcInvoice } from "../../../server/modules/goods/calc";
import { INVOICE_KINDS, INVOICE_META, RETURN_KIND, SETTLEMENT, kindFromPath, type InvoiceKind } from "./labels";
import { InvoiceStatus, ItemSelect, KindTag, inUnit, type ItemOpt } from "./components";
import { InvoicePrint, type PrintData } from "./InvoicePrint";

interface Line {
  key: string;
  id?: string | null;
  item: ItemOpt | null;
  qty: string | null;
  unit_id: string | null;
  unit_price: string | null;
  disc_mode: "pct" | "amount";
  discount_pct: string | null;
  discount: string | null;
  vat_pct: string | null;
  description: string;
  warehouse_id?: string | null;
}

const blank = (): Line => ({ key: uuidv7(), item: null, qty: null, unit_id: null, unit_price: null, disc_mode: "pct", discount_pct: null, discount: null, vat_pct: null, description: "" });

const factorOf = (l: Line) => (l.item && l.unit_id && l.unit_id === l.item.unit2_id && l.item.unit2_factor ? l.item.unit2_factor : "1");
const decimalsOf = (l: Line) => (l.item && l.unit_id && l.unit_id === l.item.unit2_id ? l.item.unit2_decimals : l.item?.unit_decimals) ?? 3;
const unitNameOf = (l: Line) => (l.item && l.unit_id && l.unit_id === l.item.unit2_id ? l.item.unit2_name : l.item?.unit_name) ?? "";

const BUYER_FIELDS: [string, string, boolean?][] = [
  ["name", "نام / نام شرکت"],
  ["national_id", "کد ملی / شناسه ملی", true],
  ["economic_code", "کد اقتصادی", true],
  ["registration_no", "شماره ثبت", true],
  ["postal_code", "کد پستی", true],
  ["phone", "تلفن", true],
  ["province", "استان"],
  ["city", "شهر"],
  ["address", "نشانی"],
];

/** Remount the editor for every document / new-document request so no state leaks between them. */
export default function InvoiceEditorRoute() {
  const { id } = useParams();
  const loc = useLocation();
  return <InvoiceEditor key={`${loc.pathname}${loc.search}`} id={id && id !== "new" ? id : null} />;
}

function lineFromItem(it: ItemOpt, sale: boolean): Line {
  const price = it.price ?? (sale ? it.sale_price : it.purchase_price) ?? null;
  return {
    key: uuidv7(),
    item: it,
    qty: "1",
    unit_id: it.unit_id,
    unit_price: price !== null ? D(price).toString() : null,
    disc_mode: "pct",
    discount_pct: it.discount_pct ?? null,
    discount: null,
    vat_pct: it.vat_pct ?? "0",
    description: "",
  };
}

function InvoiceEditor({ id }: { id: string | null }) {
  const isNew = !id;
  const [sp] = useSearchParams();
  const loc = useLocation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const n = useNotify();
  const { api, org, can, orgId, unit } = useOrg();
  const tz = (org.settings?.timezone as string) || "Asia/Tehran";
  const dp = org.money_decimals ?? 0;
  const copyId = isNew ? sp.get("copy") : null;
  const refParam = isNew ? sp.get("ref") : null;
  const initialKind = ((sp.get("kind") as InvoiceKind) || kindFromPath(loc.pathname) || "sale") as InvoiceKind;

  const [kind, setKind] = useState<InvoiceKind>(INVOICE_KINDS.includes(initialKind) ? initialKind : "sale");
  const [date, setDate] = useState<string | null>(todayISO(tz));
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [partyId, setPartyId] = useState<string | null>(sp.get("party"));
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [priceListId, setPriceListId] = useState<string | null>(null);
  const [refNo, setRefNo] = useState("");
  const [refInvoiceId, setRefInvoiceId] = useState<string | null>(null);
  const [settlement, setSettlement] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [buyer, setBuyer] = useState<Record<string, string> | null>(null);
  const [discMode, setDiscMode] = useState<"amount" | "pct">("amount");
  const [discount, setDiscount] = useState<string | null>(null);
  const [discountPct, setDiscountPct] = useState<string | null>(null);
  const [additions, setAdditions] = useState<string | null>(null);
  const [deductions, setDeductions] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [showDesc, setShowDesc] = useState(false);
  const [saving, setSaving] = useState(false);
  const [buyerOpen, setBuyerOpen] = useState(false);
  const [buyerDraft, setBuyerDraft] = useState<Record<string, string>>({});
  const [scan, setScan] = useState("");
  const gridRef = useRef<HTMLDivElement>(null);
  const scanRef = useRef<InputRef>(null);

  const meta = INVOICE_META[kind];
  const sourceId = id ?? copyId;
  const q = useQuery({ queryKey: ["goods-invoice", sourceId], queryFn: () => api.get(`/goods/invoices/${sourceId}`).then((r) => r.invoice), enabled: !!sourceId });
  const inv = id ? q.data : null;
  const refQ = useQuery({ queryKey: ["goods-returnable", refParam], queryFn: () => api.get(`/goods/invoices/${refParam}/returnable`), enabled: !!refParam });
  const whQ = useQuery({ queryKey: ["goods-warehouses"], queryFn: () => api.get("/data/warehouse/options").then((r) => r.options as { id: string; label: string }[]), staleTime: 60_000 });
  const partyQ = useQuery({ queryKey: ["goods-party", partyId], queryFn: () => api.get(`/goods/parties/${partyId}/info`), enabled: !!partyId, staleTime: 15_000 });

  // ----- load an invoice (or the one being copied)
  useEffect(() => {
    const d = q.data;
    if (!d) return;
    if (id) setKind(d.kind);
    else if (!sp.get("kind")) setKind(d.kind);
    setDate(id ? d.date : todayISO(tz));
    setDueDate(id ? d.due_date : null);
    setPartyId(d.party_id);
    setWarehouseId(d.warehouse_id);
    setPriceListId(d.price_list_id);
    setRefNo(id ? d.ref_no ?? "" : "");
    setRefInvoiceId(id ? d.ref_invoice_id : null);
    setSettlement(d.settlement);
    setNotes(d.notes ?? "");
    setTerms(d.terms ?? "");
    setBuyer(d.buyer && Object.keys(d.buyer).length ? d.buyer : null);
    const hp = d.extra?.discount_pct;
    setDiscMode(hp ? "pct" : "amount");
    setDiscountPct(hp ?? null);
    setDiscount(!hp && !D(d.discount).isZero() ? d.discount : null);
    setAdditions(D(d.additions).isZero() ? null : d.additions);
    setDeductions(D(d.deductions).isZero() ? null : d.deductions);
    const ls: Line[] = d.lines.map((l: any) => ({
      key: id ? l.id : uuidv7(),
      id: id ? l.id : null,
      item: {
        id: l.item_id, code: l.item_code, name: l.item_name, kind: l.item_kind, barcode: l.barcode,
        unit_id: l.item_unit_id, unit_name: l.main_unit_name, unit_decimals: l.main_unit_decimals,
        unit2_id: l.item_unit2_id, unit2_name: l.unit2_name, unit2_decimals: l.unit2_decimals, unit2_factor: l.item_unit2_factor,
        sale_price: null, purchase_price: null, vat_pct: l.vat_pct, tax_goods_id: l.tax_goods_id,
      } as ItemOpt,
      qty: l.qty,
      unit_id: l.unit_id,
      unit_price: l.unit_price,
      disc_mode: D(l.discount_pct).gt(0) || D(l.discount).isZero() ? "pct" : "amount",
      discount_pct: D(l.discount_pct).gt(0) ? l.discount_pct : null,
      discount: D(l.discount_pct).gt(0) || D(l.discount).isZero() ? null : l.discount,
      vat_pct: l.vat_pct,
      description: l.description ?? "",
      warehouse_id: l.warehouse_id,
    }));
    setShowDesc(ls.some((l) => l.description));
    const editable = !id || (d.status !== "cancelled" && !d.extra?.converted_to);
    setLines(editable ? [...ls, blank()] : ls);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  // ----- a return of an invoice: its lines with what is left to return
  useEffect(() => {
    const d = refQ.data;
    if (!d) return;
    const back = RETURN_KIND[d.invoice.kind as InvoiceKind];
    if (back) setKind(back);
    setRefInvoiceId(d.invoice.id);
    setPartyId(d.invoice.party_id);
    setWarehouseId(d.invoice.warehouse_id);
    setPriceListId(d.invoice.price_list_id);
    const ls: Line[] = d.lines
      .filter((l: any) => D(l.remaining).gt(0))
      .map((l: any) => ({
        key: uuidv7(),
        item: { id: l.item_id, code: l.item_code, name: l.item_name, kind: l.item_kind, barcode: null, unit_id: l.unit_id, unit_name: l.unit_name, unit_decimals: 3, unit2_id: null, unit2_name: null, unit2_decimals: null, unit2_factor: null, sale_price: null, purchase_price: null, vat_pct: l.vat_pct } as ItemOpt,
        qty: D(l.remaining).toString(),
        unit_id: l.unit_id,
        unit_price: l.unit_price,
        disc_mode: "pct",
        discount_pct: D(l.discount_pct).isZero() ? null : l.discount_pct,
        discount: null,
        vat_pct: l.vat_pct,
        description: "",
        warehouse_id: l.warehouse_id,
      }));
    setLines(ls.length ? ls : [blank()]);
    if (!ls.length) n.warn("همه‌ی اقلام این فاکتور قبلاً برگشت خورده‌اند");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refQ.data]);

  // ----- default warehouse for a new document
  useEffect(() => {
    if (isNew && !warehouseId && !copyId && !refParam && whQ.data?.length) setWarehouseId(whQ.data[0].id);
  }, [whQ.data, isNew, warehouseId, copyId, refParam]);

  const readonly = !!inv && (inv.status === "cancelled" || !!inv.extra?.converted_to || !can(meta.area, "edit"));
  const isReturn = kind === "sale_return" || kind === "purchase_return";
  const lookupCtx = useMemo(() => ({ invoice_kind: kind, party_id: partyId, price_list_id: priceListId, warehouse_id: warehouseId, date }), [kind, partyId, priceListId, warehouseId, date]);

  // ----- live totals (same arithmetic as the server)
  const itemLines = lines.filter((l) => l.item);
  const calc = useMemo(
    () =>
      calcInvoice({
        lines: itemLines.map((l) => ({
          qty: l.qty ?? 0,
          unit_price: l.unit_price ?? 0,
          discount_pct: l.disc_mode === "pct" ? l.discount_pct : 0,
          discount: l.disc_mode === "amount" ? l.discount : 0,
          vat_pct: l.vat_pct ?? 0,
        })),
        discount: discMode === "amount" ? discount : 0,
        discount_pct: discMode === "pct" ? discountPct : 0,
        additions,
        deductions,
        dp,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, discMode, discount, discountPct, additions, deductions, dp],
  );
  const calcIndex = useMemo(() => {
    const m = new Map<string, number>();
    let k = 0;
    for (const l of lines) if (l.item) m.set(l.key, k++);
    return m;
  }, [lines]);
  const lineCalc = (l: Line) => {
    const i = calcIndex.get(l.key);
    return i === undefined ? null : calc.lines[i];
  };

  // ----- editing helpers
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const ensureTail = (ls: Line[]) => (ls.length && !ls[ls.length - 1].item ? ls : [...ls, blank()]);
  const focusCell = (row: number, col: number) => {
    requestAnimationFrame(() => {
      const input = gridRef.current?.querySelector<HTMLInputElement>(`[data-cell="${row}-${col}"] input`);
      input?.focus();
      input?.select?.();
    });
  };
  const COLS = 5;
  const onEnter = (row: number, col: number) => {
    if (col < COLS - 1) focusCell(row, col + 1);
    else {
      if (row === lines.length - 1) setLines((ls) => [...ls, blank()]);
      focusCell(row + 1, 0);
    }
  };
  const pickItem = (i: number, it: ItemOpt | null) => {
    if (!it) return set(i, { item: null });
    setLines((ls) => ensureTail(ls.map((l, j) => (j === i ? { ...lineFromItem(it, meta.sale), key: l.key, id: l.id, qty: l.qty ?? "1", description: l.description } : l))));
    focusCell(i, 1);
  };
  const changeUnit = (i: number, unitId: string) => {
    const l = lines[i];
    if (!l.item) return;
    const oldF = D(factorOf(l));
    const newF = D(unitId === l.item.unit2_id ? l.item.unit2_factor ?? "1" : "1");
    const price = l.unit_price !== null && !oldF.isZero() ? D(l.unit_price).div(oldF).times(newF).toDecimalPlaces(dp).toString() : l.unit_price;
    set(i, { unit_id: unitId, unit_price: price });
  };
  const addScanned = (it: ItemOpt) => {
    setLines((ls) => {
      const j = ls.findIndex((l) => l.item?.id === it.id && (!l.unit_id || l.unit_id === it.unit_id));
      if (j >= 0) return ls.map((l, k) => (k === j ? { ...l, qty: D(l.qty).plus(1).toString() } : l));
      const empty = ls.findIndex((l) => !l.item);
      const line = lineFromItem(it, meta.sale);
      const next = empty >= 0 ? ls.map((l, k) => (k === empty ? { ...line, key: l.key } : l)) : [...ls, line];
      return ensureTail(next);
    });
  };
  const doScan = async () => {
    const code = scan.trim();
    if (!code) return;
    try {
      const r = await api.get("/goods/items/by-code", { code, ...lookupCtx });
      if (!r.item) n.warn(`کالایی با کد «${faDigits(code)}» پیدا نشد`);
      else addScanned(r.item);
    } catch (e) {
      n.error(e);
    }
    setScan("");
    scanRef.current?.focus();
  };
  const repriceAll = async () => {
    const ids = lines.filter((l) => l.item).map((l) => l.item!.id);
    if (!ids.length) return;
    try {
      const r = await api.get("/goods/prices", { kind, party_id: partyId, price_list_id: priceListId, date, items: Array.from(new Set(ids)).join(",") });
      setLines((ls) => ls.map((l) => {
        const p = l.item ? r.prices[l.item.id]?.price : null;
        return p !== null && p !== undefined ? { ...l, unit_price: D(p).times(D(factorOf(l))).toDecimalPlaces(dp).toString() } : l;
      }));
      n.ok("قیمت ردیف‌ها به‌روز شد");
    } catch (e) {
      n.error(e);
    }
  };

  // ----- save
  const payload = (status: "draft" | "posted") => ({
    kind,
    status,
    date,
    due_date: dueDate,
    party_id: partyId,
    warehouse_id: warehouseId,
    price_list_id: priceListId,
    ref_no: refNo.trim() || null,
    ref_invoice_id: isReturn ? refInvoiceId : null,
    settlement,
    notes: notes.trim() || null,
    terms: terms.trim() || null,
    buyer,
    discount: discMode === "amount" ? discount : null,
    discount_pct: discMode === "pct" ? discountPct : null,
    additions,
    deductions,
    lines: lines
      .filter((l) => l.item)
      .map((l) => ({
        id: l.id ?? null,
        item_id: l.item!.id,
        description: l.description.trim() || null,
        qty: l.qty ?? "0",
        unit_id: l.unit_id,
        unit_price: l.unit_price ?? "0",
        discount_pct: l.disc_mode === "pct" ? l.discount_pct : null,
        discount: l.disc_mode === "amount" ? l.discount : null,
        vat_pct: l.vat_pct ?? "0",
        warehouse_id: l.warehouse_id ?? null,
      })),
  });

  const save = async (status: "draft" | "posted") => {
    if (readonly || saving) return;
    if (!date) return n.warn("تاریخ را وارد کنید");
    if (!lines.some((l) => l.item)) return n.warn("دست‌کم یک ردیف کالا یا خدمت وارد کنید");
    const zero = lines.find((l) => l.item && !D(l.qty).gt(0));
    if (zero) return n.warn(`مقدار «${zero.item!.name}» را وارد کنید`);
    setSaving(true);
    try {
      const r = isNew ? await api.post("/goods/invoices", payload(status)) : await api.put(`/goods/invoices/${id}`, payload(status));
      n.ok(`${meta.title} شماره‌ی ${faDigits(r.invoice.no)} ${status === "draft" && meta.postable ? "به‌صورت پیش‌نویس " : ""}ذخیره شد`);
      for (const k of [["table"], ["goods-invoice"], ["goods-items"], ["goods-party"], ["dashboard"], ["goods-summary"]]) qc.invalidateQueries({ queryKey: k });
      nav(`/${orgId}/${INVOICE_META[kind].path}/${r.invoice.id}`, { replace: true });
    } catch (e) {
      n.error(e);
    } finally {
      setSaving(false);
    }
  };
  // hotkeys call the latest save (it closes over the whole editor state)
  const saveRef = useRef(save);
  saveRef.current = save;
  useHotkey("f2", () => saveRef.current(INVOICE_META[kind].postable ? "posted" : "draft"), [kind]);
  useHotkey("alt+n", () => setLines((ls) => [...ls, blank()]), []);
  useHotkey("f4", () => scanRef.current?.focus(), []);

  const action = async (fn: () => Promise<any>, ok: string, after?: (r: any) => void) => {
    try {
      const r = await fn();
      n.ok(ok);
      for (const k of [["table"], ["goods-invoice"], ["goods-items"], ["dashboard"]]) qc.invalidateQueries({ queryKey: k });
      if (after) after(r);
      else q.refetch();
    } catch (e) {
      n.error(e);
    }
  };
  const downloadMoadian = async () => {
    try {
      const r = await api.get(`/goods/invoices/${id}/moadian`);
      const blob = new Blob([JSON.stringify(r, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `moadian-${inv?.no ?? "invoice"}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      if (r.meta?.warnings?.length) n.notify.warning({ title: "نکات صورتحساب الکترونیکی", description: <ul className="m-0 ps-4">{r.meta.warnings.map((w: string) => <li key={w}>{w}</li>)}</ul>, duration: 12 });
    } catch (e) {
      n.error(e);
    }
  };

  if (sourceId && q.isLoading) return <div className="grid h-64 place-content-center"><Loader /></div>;
  if (sourceId && q.error) return <Alert type="error" showIcon title={errorText(q.error)} />;

  // ----- derived view data
  const party = partyQ.data;
  const balance = party ? D(party.balance) : null;
  const creditLimit = party?.credit_limit ? D(party.credit_limit) : null;
  const overCredit = !!(meta.sale && kind !== "sale_return" && creditLimit && balance && balance.plus(D(calc.total)).minus(D(inv?.status === "posted" ? inv.total : 0)).gt(creditLimit));
  const effectiveBuyer = buyer ?? party?.buyer ?? null;
  const settleable = !!inv && inv.status === "posted" && !!meta.settle && D(inv.remaining ?? 0).gt(0) && can("treasury", "edit");
  const printData: PrintData = {
    kind,
    no: inv?.no ?? null,
    date,
    dueDate,
    refNo: refNo || null,
    draft: meta.postable && (!inv || inv.status !== "posted"),
    party: effectiveBuyer,
    lines: itemLines.map((l) => {
      const c = lineCalc(l)!;
      return {
        code: l.item!.code,
        name: l.item!.name,
        description: l.description,
        qty: l.qty ?? 0,
        unit: unitNameOf(l),
        unit_price: l.unit_price ?? 0,
        gross: c.gross,
        discount: D(c.line_discount).plus(D(c.header_discount)).toString(),
        net: c.net,
        vat: c.vat,
        total: c.total,
      };
    }),
    totals: { subtotal: calc.subtotal, discount: D(calc.line_discount).plus(D(calc.discount)).toString(), tax: calc.tax, additions: calc.additions, deductions: calc.deductions, total: calc.total },
    notes,
    terms,
  };
  const allowedKinds = INVOICE_KINDS.filter((k) => can(INVOICE_META[k].area, "edit"));
  const moreItems = inv
    ? [
        ...(RETURN_KIND[kind as InvoiceKind] && inv.status === "posted" && can(meta.area, "edit")
          ? [{ key: "return", icon: <Ic icon={Undo2} />, label: `ثبت ${INVOICE_META[RETURN_KIND[kind]!].title}`, onClick: () => nav(`/${orgId}/${INVOICE_META[RETURN_KIND[kind]!].path}/new?ref=${inv.id}`) }]
          : []),
        ...(kind === "quote" && !inv.extra?.converted_to && inv.status !== "cancelled"
          ? [
              { key: "to-sale", icon: <Ic icon={ArrowLeftRight} />, label: "تبدیل به فاکتور فروش", onClick: () => action(() => api.post(`/goods/invoices/${inv.id}/convert`, { kind: "sale" }), "فاکتور فروش ساخته شد", (r) => nav(`/${orgId}/${INVOICE_META.sale.path}/${r.invoice.id}`)) },
              { key: "to-order", icon: <Ic icon={ArrowLeftRight} />, label: "تبدیل به سفارش فروش", onClick: () => action(() => api.post(`/goods/invoices/${inv.id}/convert`, { kind: "sale_order" }), "سفارش فروش ساخته شد", (r) => nav(`/${orgId}/${INVOICE_META.sale_order.path}/${r.invoice.id}`)) },
            ]
          : []),
        ...((kind === "sale_order" || kind === "purchase_order") && !inv.extra?.converted_to && inv.status !== "cancelled"
          ? [{ key: "to-invoice", icon: <Ic icon={ArrowLeftRight} />, label: "تبدیل به فاکتور", onClick: () => action(() => api.post(`/goods/invoices/${inv.id}/convert`, {}), "فاکتور ساخته شد", (r) => nav(`/${orgId}/${INVOICE_META[r.invoice.kind as InvoiceKind].path}/${r.invoice.id}`)) }]
          : []),
        { key: "copy", icon: <Ic icon={Copy} />, label: "کپی به سند جدید", onClick: () => nav(`/${orgId}/${meta.path}/new?copy=${inv.id}`) },
        ...(inv.voucher_id && can("accounting", "view") ? [{ key: "voucher", icon: <Ic icon={FileText} />, label: `سند حسابداری ${faDigits(inv.voucher_no ?? "")}`, onClick: () => nav(`/${orgId}/accounting/vouchers/${inv.voucher_id}`) }] : []),
        ...((kind === "sale" || kind === "sale_return") && inv.status === "posted" ? [{ key: "moadian", icon: <Ic icon={FileOutput} />, label: "خروجی سامانه‌ی مؤدیان (JSON)", onClick: downloadMoadian }] : []),
        ...(inv.status === "posted" && can(meta.area, "edit")
          ? [{ key: "unpost", icon: <Ic icon={Undo2} />, label: "برگشت به پیش‌نویس", onClick: async () => { if (await n.confirm("فاکتور به پیش‌نویس برگردد؟", "اثر آن روی انبار و سند حسابداری حذف می‌شود.")) action(() => api.post(`/goods/invoices/${inv.id}/unpost`), "به پیش‌نویس برگشت"); } }]
          : []),
        ...(inv.status === "cancelled" && can(meta.area, "edit")
          ? [{ key: "reopen", icon: <Ic icon={Undo2} />, label: "خارج کردن از ابطال", onClick: () => action(() => api.post(`/goods/invoices/${inv.id}/unpost`), "سند دوباره باز شد") }]
          : []),
        ...(inv.status !== "cancelled" && can(meta.area, "full")
          ? [{ key: "cancel", icon: <Ic icon={Ban} />, danger: true, label: "ابطال", onClick: async () => { if (await n.confirm(`ابطال ${meta.title}؟`, "سند باقی می‌ماند ولی اثری در انبار و حساب‌ها ندارد.", true)) action(() => api.post(`/goods/invoices/${inv.id}/cancel`), "ابطال شد"); } }]
          : []),
        ...(can(meta.area, "full")
          ? [{ key: "del", icon: <Ic icon={Trash2} />, danger: true, label: "حذف", onClick: async () => { if (await n.confirm(`حذف ${meta.title}؟`, undefined, true)) action(() => api.del(`/goods/invoices/${inv.id}`), "حذف شد", () => nav(`/${orgId}/${meta.path}`)); } }]
          : []),
      ]
    : [];

  const isPosted = !!inv && inv.status === "posted";
  const remaining = inv ? D(inv.remaining ?? 0) : D(0);
  return (
    <div className="sf-doc">
      <PageHeader
        back={`/${orgId}/${meta.path}`}
        title={inv ? `${meta.title} ${faDigits(inv.no)}` : `${meta.title} جدید`}
        subtitle={
          inv ? (
            <span className="sf-doc-meta">
              <InvoiceStatus s={inv.status} />
              {inv.extra?.converted_to ? <><span className="sf-sep" aria-hidden /><span>تبدیل‌شده</span></> : null}
              <span className="sf-sep" aria-hidden />
              <JDateTime v={inv.created_at} />
              {inv.created_by_name ? <><span className="sf-sep" aria-hidden /><span>{inv.created_by_name}</span></> : null}
            </span>
          ) : null
        }
        actions={
          <>
            {moreItems.length ? (
              <Dropdown trigger={["click"]} menu={{ items: moreItems }} placement="bottomLeft">
                <Button icon={<Ic icon={Ellipsis} />} aria-label="بیشتر" />
              </Dropdown>
            ) : null}
            <Tooltip title="چاپ فاکتور">
              <Button icon={<Ic icon={Printer} />} onClick={() => window.print()} aria-label="چاپ" />
            </Tooltip>
            {!readonly ? (
              <>
                {meta.postable ? <Button onClick={() => save("draft")} disabled={saving}>پیش‌نویس</Button> : null}
                <Button type="primary" loading={saving} onClick={() => save(meta.postable ? "posted" : "draft")}>
                  {meta.postable ? "ثبت فاکتور" : "ذخیره"}
                  <span className="sf-kw" aria-hidden><bdi dir="ltr"><kbd>F2</kbd></bdi></span>
                </Button>
              </>
            ) : null}
          </>
        }
      />

      {inv?.status === "cancelled" ? <div className="sf-inline no-print" data-tone="danger"><i className="sf-nuqta" aria-hidden /><span><b>ابطال شده.</b> این سند اثری در انبار و حساب‌ها ندارد.</span></div> : null}
      {inv?.converted_to ? (
        <div className="sf-inline no-print"><i className="sf-nuqta" aria-hidden /><span>این سند به <Link className="sf-link" to={`/${orgId}/${INVOICE_META[inv.converted_to.kind as InvoiceKind].path}/${inv.converted_to.id}`}>{INVOICE_META[inv.converted_to.kind as InvoiceKind].title} {faDigits(inv.converted_to.no)}</Link> تبدیل شده است.</span></div>
      ) : null}
      {inv?.converted_from ? (
        <div className="sf-inline no-print"><i className="sf-nuqta" aria-hidden /><span>ساخته‌شده از <Link className="sf-link" to={`/${orgId}/${INVOICE_META[inv.converted_from.kind as InvoiceKind].path}/${inv.converted_from.id}`}>{INVOICE_META[inv.converted_from.kind as InvoiceKind].title} {faDigits(inv.converted_from.no)}</Link></span></div>
      ) : null}
      {inv?.returns?.length ? (
        <div className="sf-inline no-print" data-tone="warning">
          <i className="sf-nuqta" aria-hidden />
          <span><b>برگشتی دارد:</b> {inv.returns.map((r: any, i: number) => <span key={r.id}>{i ? "، " : ""}<Link className="sf-link" to={`/${orgId}/${INVOICE_META[r.kind as InvoiceKind].path}/${r.id}`}>{INVOICE_META[r.kind as InvoiceKind].title} {faDigits(r.no)}</Link></span>)}</span>
        </div>
      ) : null}

      {/* header */}
      <section className="sf-doc-card no-print" aria-label="مشخصات سند">
        <div className="sf-doc-pad sf-fields">
          {isNew ? (
            <div className="sf-field">
              <div className="sf-field-l">نوع سند</div>
              <Select className="w-full" value={kind} onChange={(k) => setKind(k)} options={allowedKinds.map((k) => ({ value: k, label: INVOICE_META[k].title }))} disabled={!!refParam} />
            </div>
          ) : (
            <div className="sf-field">
              <div className="sf-field-l">نوع سند</div>
              <div className="sf-field-v"><KindTag kind={kind} /></div>
            </div>
          )}
          <div className="sf-field">
            <div className="sf-field-l">تاریخ</div>
            <DateInput value={date} onChange={setDate} disabled={readonly} />
          </div>
          <div className="sf-field span-2">
            <div className="sf-field-l">
              {meta.party}
              {party ? (
                <span className="sf-field-x">
                  <Tooltip title="مانده‌ی حساب این شخص در دفاتر"><span>مانده <Balance v={party.balance} /></span></Tooltip>
                  {creditLimit ? <><span className="sf-sep" aria-hidden /><span>سقف <Money v={creditLimit.toString()} /></span></> : null}
                </span>
              ) : null}
            </div>
            <div className="flex gap-1.5">
              <PartySelect
                className="min-w-0 flex-1"
                value={partyId}
                allowClear
                disabled={readonly || (isReturn && !!refInvoiceId)}
                placeholder={meta.sale ? "خالی، مشتری نقدی (گذری)" : "انتخاب فروشنده…"}
                onChange={(pid) => {
                  setPartyId(pid);
                  setBuyer(null);
                }}
              />
              <Tooltip title={meta.sale ? "مشخصات خریدار (برای صورتحساب رسمی)" : "مشخصات فروشنده"}>
                <Button
                  icon={<Ic icon={IdCard} />}
                  disabled={readonly}
                  aria-label="مشخصات روی فاکتور"
                  onClick={() => {
                    setBuyerDraft({ ...(effectiveBuyer ?? {}) } as Record<string, string>);
                    setBuyerOpen(true);
                  }}
                />
              </Tooltip>
            </div>
            {party?.party?.is_blacklisted ? <div className="sf-field-err"><Ic icon={CircleAlert} size={14} />این شخص در فهرست سیاه است.</div> : null}
            {overCredit ? <div className="sf-field-warn"><Ic icon={TriangleAlert} size={14} />با این فاکتور از سقف اعتبار شخص بیشتر می‌شود.</div> : null}
          </div>
          <div className="sf-field">
            <div className="sf-field-l">انبار</div>
            <RefSelect entity="warehouse" value={warehouseId} onChange={setWarehouseId} disabled={readonly} showCode={false} />
          </div>
          <div className="sf-field">
            <div className="sf-field-l">{kind === "quote" ? "اعتبار تا" : "سررسید"}</div>
            <DateInput value={dueDate} onChange={setDueDate} allowClear disabled={readonly} placeholder="—" />
          </div>
          {meta.sale ? (
            <div className="sf-field">
              <div className="sf-field-l">فهرست قیمت</div>
              <RefSelect entity="price_list" value={priceListId} onChange={setPriceListId} allowClear disabled={readonly} showCode={false} placeholder={party?.price_list_id ? "فهرست شخص" : "خودکار"} />
            </div>
          ) : null}
          <div className="sf-field">
            <div className="sf-field-l">{meta.sale ? "شماره‌ی عطف" : "شماره‌ی فاکتور فروشنده"}</div>
            <Input value={refNo} onChange={(e) => setRefNo(e.target.value)} disabled={readonly} dir="ltr" className="sf-numin" />
          </div>
          <div className="sf-field">
            <div className="sf-field-l">نحوه‌ی تسویه</div>
            <Select className="w-full" allowClear value={settlement ?? undefined} onChange={(v) => setSettlement(v ?? null)} options={SETTLEMENT} disabled={readonly} placeholder="—" />
          </div>
          {isReturn ? (
            <div className="sf-field span-2">
              <div className="sf-field-l">فاکتور اصلی</div>
              {refInvoiceId ? (
                <div className="sf-field-v">
                  <Link className="sf-link" to={`/${orgId}/${INVOICE_META[RETURN_KIND.sale === kind ? "sale" : "purchase"].path}/${refInvoiceId}`}>
                    {inv?.ref_invoice ? `${INVOICE_META[inv.ref_invoice.kind as InvoiceKind].title} ${faDigits(inv.ref_invoice.no)}` : refQ.data ? `فاکتور ${faDigits(refQ.data.invoice.no)}` : "مشاهده"}
                  </Link>
                </div>
              ) : (
                <div className="sf-field-h">بدون فاکتور مرجع؛ برگشت را از صفحه‌ی فاکتور اصلی بزنید تا قیمت و بهای آن بیاید.</div>
              )}
            </div>
          ) : null}
        </div>
      </section>

      {/* lines */}
      <section className="sf-doc-card no-print" aria-label="اقلام">
        <div className="sf-doc-h flex-wrap">
          <h2>اقلام</h2>
          <span className="sf-doc-hm">مبالغ به {unit}</span>
          {!readonly ? (
            <div className="sf-doc-hx flex-wrap">
              <Input
                ref={scanRef}
                className="sf-scan-in !w-72"
                prefix={<Ic icon={ScanBarcode} className="text-ink-3" />}
                suffix={<bdi dir="ltr" className="sf-scan-k sf-latin">F4</bdi>}
                placeholder="اسکن بارکد یا کد کالا، Enter"
                value={scan}
                onChange={(e) => setScan(e.target.value)}
                onPressEnter={doScan}
                autoFocus={isNew && meta.sale && !refParam}
                dir="ltr"
                aria-label="اسکن بارکد"
              />
              <Button size="small" type="text" aria-pressed={showDesc} className={showDesc ? "!bg-sunken !text-ink" : ""} icon={<Ic icon={TextIcon} />} onClick={() => setShowDesc(!showDesc)}>شرح ردیف</Button>
              {!isReturn ? <Button size="small" type="text" icon={<Ic icon={Tags} />} onClick={repriceAll}>{meta.sale ? "قیمت فهرست" : "قیمت خرید کالاها"}</Button> : null}
            </div>
          ) : null}
        </div>
        <div ref={gridRef} className="sf-grid-wrap">
          <table className="sf-grid min-w-[1000px]">
            <thead>
              <tr>
                <th className="w-12">ردیف</th>
                <th className="min-w-[260px]">کالا / خدمت</th>
                {showDesc ? <th className="min-w-[180px]">شرح</th> : null}
                <th className="w-[120px]">مقدار</th>
                <th className="w-[100px]">واحد</th>
                <th className="w-[148px]">فی</th>
                <th className="w-[140px]">تخفیف</th>
                <th className="w-[92px]">مالیات</th>
                <th className="w-[148px]">مبلغ</th>
                {!readonly ? <th className="w-10" aria-label="حذف" /> : null}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const c = lineCalc(l);
                const stock = l.item?.wh_stock ?? l.item?.stock;
                const short = !!l.item && l.item.kind === "goods" && (kind === "sale" || kind === "purchase_return") && stock !== undefined && stock !== null && !l.item.allow_negative
                  && D(l.qty).times(D(factorOf(l))).gt(D(stock)) && !inv;
                return (
                  <tr key={l.key}>
                    <td className="sf-gi">{faDigits(i + 1)}</td>
                    <td data-cell={`${i}-0`}>
                      <ItemSelect variant="borderless" className="w-full" value={l.item?.id} item={l.item} ctx={lookupCtx} disabled={readonly || (isReturn && !!refInvoiceId && !!l.item)} onChange={(it) => pickItem(i, it)} />
                    </td>
                    {showDesc ? (
                      <td>
                        <Input variant="borderless" value={l.description} disabled={readonly} placeholder="شرح تکمیلی" onChange={(e) => set(i, { description: e.target.value })} />
                      </td>
                    ) : null}
                    <td data-cell={`${i}-1`}>
                      <div className="flex items-center gap-1">
                        <NumberInput variant="borderless" decimals={decimalsOf(l)} value={l.qty} disabled={readonly || !l.item} onChange={(v) => set(i, { qty: v })} onPressEnter={() => onEnter(i, 1)} />
                        {short ? (
                          <Tooltip title={`موجودی: ${formatNumber(inUnit(stock!, factorOf(l)), { dp: 3 })} ${unitNameOf(l)}`}>
                            <span className="inline-grid shrink-0 text-warning" aria-label="بیش از موجودی"><Ic icon={TriangleAlert} size={14} /></span>
                          </Tooltip>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      {l.item?.unit2_id ? (
                        <Select
                          variant="borderless"
                          className="w-full"
                          value={l.unit_id ?? l.item.unit_id ?? undefined}
                          disabled={readonly || (isReturn && !!refInvoiceId)}
                          onChange={(u) => changeUnit(i, u)}
                          options={[
                            { value: l.item.unit_id ?? "", label: l.item.unit_name ?? "اصلی" },
                            { value: l.item.unit2_id, label: `${l.item.unit2_name ?? "فرعی"} (${formatNumber(l.item.unit2_factor ?? 1)})` },
                          ]}
                        />
                      ) : (
                        <span className="px-2 text-[13px] text-ink-3">{unitNameOf(l)}</span>
                      )}
                    </td>
                    <td data-cell={`${i}-2`}>
                      <MoneyInput variant="borderless" value={l.unit_price} disabled={readonly || !l.item} onChange={(v) => set(i, { unit_price: v })} onPressEnter={() => onEnter(i, 2)} placeholder={l.item ? "۰" : ""} />
                    </td>
                    <td data-cell={`${i}-3`}>
                      <div className="flex items-center">
                        {l.disc_mode === "pct" ? (
                          <PctInput variant="borderless" value={l.discount_pct} disabled={readonly || !l.item} onChange={(v) => set(i, { discount_pct: v })} onPressEnter={() => onEnter(i, 3)} />
                        ) : (
                          <MoneyInput variant="borderless" value={l.discount} disabled={readonly || !l.item} onChange={(v) => set(i, { discount: v })} onPressEnter={() => onEnter(i, 3)} />
                        )}
                        {!readonly && l.item ? (
                          <Tooltip title={l.disc_mode === "pct" ? "تخفیف به مبلغ" : "تخفیف به درصد"}>
                            <Button size="small" type="text" tabIndex={-1} icon={<Ic icon={ArrowLeftRight} size={14} />} aria-label="تغییر نوع تخفیف" onClick={() => set(i, l.disc_mode === "pct" ? { disc_mode: "amount", discount: c?.line_discount && !D(c.line_discount).isZero() ? c.line_discount : null, discount_pct: null } : { disc_mode: "pct", discount: null, discount_pct: null })} />
                          </Tooltip>
                        ) : null}
                      </div>
                    </td>
                    <td data-cell={`${i}-4`}>
                      <PctInput variant="borderless" value={l.vat_pct} disabled={readonly || !l.item} onChange={(v) => set(i, { vat_pct: v })} onPressEnter={() => onEnter(i, 4)} />
                    </td>
                    <td className="sf-gn">
                      {c ? (
                        <Tooltip
                          title={
                            <div className="text-[12px] leading-5">
                              <div>مبلغ کل: {formatNumber(c.gross, { dp })}</div>
                              {!D(c.line_discount).isZero() ? <div>تخفیف ردیف: {formatNumber(c.line_discount, { dp })}</div> : null}
                              {!D(c.header_discount).isZero() ? <div>سهم تخفیف فاکتور: {formatNumber(c.header_discount, { dp })}</div> : null}
                              <div>مالیات: {formatNumber(c.vat, { dp })}</div>
                            </div>
                          }
                        >
                          <span><Money v={c.total} /></span>
                        </Tooltip>
                      ) : null}
                    </td>
                    {!readonly ? (
                      <td>
                        <span className="sf-row-x">
                          <Button type="text" size="small" icon={<Ic icon={X} />} tabIndex={-1} onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [blank()]))} aria-label="حذف ردیف" />
                        </span>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={showDesc ? 3 : 2}>
                  <span className="inline-flex items-center gap-3">
                    {!readonly ? <Button size="small" icon={<Ic icon={Plus} />} onClick={() => setLines((ls) => [...ls, blank()])}>ردیف<span className="sf-kw" aria-hidden><bdi dir="ltr"><kbd>Alt</kbd><kbd>N</kbd></bdi></span></Button> : null}
                    <span className="sf-cnt"><span className="sf-num">{faDigits(itemLines.length)}</span> ردیف</span>
                  </span>
                </td>
                <td colSpan={5} />
                <td className="sf-gn"><Money v={D(calc.net).plus(D(calc.tax)).toString()} zero="—" /></td>
                {!readonly ? <td /> : null}
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* notes + totals */}
      <div className="grid items-start gap-4 no-print lg:grid-cols-[minmax(0,1fr)_400px]">
        <section className="sf-doc-card" aria-label="توضیحات">
          <div className="sf-doc-pad grid gap-4">
            <div className="sf-field">
              <div className="sf-field-l">توضیحات<span className="sf-field-x">روی فاکتور چاپ می‌شود</span></div>
              <Input.TextArea value={notes} onChange={(e) => setNotes(e.target.value)} autoSize={{ minRows: 3, maxRows: 6 }} disabled={readonly} />
            </div>
            {kind === "quote" || kind === "sale_order" || kind === "purchase_order" ? (
              <div className="sf-field">
                <div className="sf-field-l">شرایط (پرداخت، تحویل، اعتبار)</div>
                <Input.TextArea value={terms} onChange={(e) => setTerms(e.target.value)} autoSize={{ minRows: 2, maxRows: 5 }} disabled={readonly} />
              </div>
            ) : null}
          </div>
        </section>
        <section className="sf-doc-card" aria-label="جمع فاکتور">
          <div className="sf-doc-pad !py-4">
            <div className="sf-sums is-flat">
              <SRow label="جمع ردیف‌ها" v={calc.subtotal} />
              {!D(calc.line_discount).isZero() ? <SRow label="تخفیف ردیف‌ها" v={D(calc.line_discount).neg().toString()} /> : null}
              <div className="r is-field">
                <span>
                  تخفیف فاکتور
                  {!readonly ? (
                    <button type="button" className="sf-link !text-[12px]" onClick={() => { setDiscMode(discMode === "amount" ? "pct" : "amount"); setDiscount(null); setDiscountPct(null); }}>
                      {discMode === "amount" ? "به درصد" : "به مبلغ"}
                    </button>
                  ) : null}
                </span>
                <span className="n">{discMode === "amount" ? <MoneyInput size="small" value={discount} onChange={setDiscount} disabled={readonly} placeholder="—" /> : <PctInput size="small" value={discountPct} onChange={setDiscountPct} disabled={readonly} />}</span>
              </div>
              {discMode === "pct" && !D(calc.discount).isZero() ? <SRow label="مبلغ تخفیف فاکتور" v={D(calc.discount).neg().toString()} /> : null}
              <SRow label="مالیات و عوارض ارزش افزوده" v={calc.tax} />
              <div className="r is-field">
                <span>اضافات<span className="why">حمل، بسته‌بندی</span></span>
                <span className="n"><MoneyInput size="small" value={additions} onChange={setAdditions} disabled={readonly} placeholder="—" /></span>
              </div>
              <div className="r is-field">
                <span>کسورات</span>
                <span className="n"><MoneyInput size="small" value={deductions} onChange={setDeductions} disabled={readonly} placeholder="—" /></span>
              </div>
              <div className="r is-total">
                <span>مبلغ نهایی</span>
                <span className="n">{D(calc.total).isZero() ? <span className="sf-zero">—</span> : <><Money v={calc.total} /><span className="sf-unit">{"\u00a0"}{unit}</span></>}</span>
              </div>
              {D(calc.total).gt(0) ? <div className="r is-words"><span>{amountToWords(calc.total, unit)}</span></div> : null}
            </div>
            {isPosted && meta.postable ? (
              <div className="mt-2">
                <div className="sf-sums is-flat">
                  <SRow label={meta.settle === "receipt" ? "دریافت‌شده" : "پرداخت‌شده"} v={inv.allocated} />
                  {inv.gross_profit !== null && inv.gross_profit !== undefined && can("reports", "view") ? <SRow label="سود ناخالص" v={inv.gross_profit} sub /> : null}
                </div>
                {remaining.isZero() ? (
                  <div className="sf-settle" data-state="in"><span className="k">تسویه شد</span></div>
                ) : (
                  <div className="sf-settle" data-state="due">
                    <span className="k">
                      مانده تا تسویه
                      {settleable ? (
                        <button type="button" className="sf-link !text-[12px] !font-normal" onClick={() => nav(`/${orgId}/treasury/docs/new?kind=${meta.settle}&party=${inv.party_id}&invoice=${inv.id}`)}>
                          {meta.settle === "receipt" ? "ثبت دریافت" : "ثبت پرداخت"}
                        </button>
                      ) : null}
                    </span>
                    <span className="n"><Money v={remaining.toString()} /></span>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <InvoicePrint data={printData} />

      <Modal
        open={buyerOpen}
        title={meta.sale ? "مشخصات خریدار روی فاکتور" : "مشخصات فروشنده روی فاکتور"}
        onCancel={() => setBuyerOpen(false)}
        onOk={() => {
          setBuyer(buyerDraft);
          setBuyerOpen(false);
        }}
        okText="تأیید"
        cancelText="انصراف"
        destroyOnHidden
      >
        <div className="grid gap-3 md:grid-cols-2">
          {BUYER_FIELDS.map(([k, label, ltr]) => (
            <div key={k} className={k === "address" ? "md:col-span-2" : ""}>
              <div className="sf-field-l mb-1.5">{label}</div>
              <Input value={buyerDraft[k] ?? ""} dir={ltr ? "ltr" : undefined} onChange={(e) => setBuyerDraft({ ...buyerDraft, [k]: e.target.value })} />
            </div>
          ))}
        </div>
        <div className="mt-3 text-[12px] text-ink-3">این مشخصات فقط روی همین فاکتور ذخیره می‌شود؛ برای تغییر پرونده‌ی شخص از بخش اشخاص اقدام کنید.</div>
      </Modal>
    </div>
  );
}

function SRow({ label, v, sub }: { label: string; v: string; sub?: boolean }) {
  return (
    <div className={`r ${sub ? "is-sub" : ""}`}>
      <span>{label}</span>
      <span className="n"><Money v={v} zero="—" /></span>
    </div>
  );
}
