// Invoice editor — sales and purchase invoices, returns, quotes and orders. Keyboard first:
// a barcode/code box adds or increments lines (Enter), Enter moves through the grid and the
// last cell opens a new row, F2 saves and posts, Alt+N adds a row, F4 jumps to the scan box.
// Totals use the same calculation as the server (calc.ts). Printing gives an A4 invoice.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Dropdown, Input, Modal, Select, Spin, Tag, Tooltip, type InputRef } from "antd";
import {
  BarcodeOutlined, CopyOutlined, DeleteOutlined, DollarOutlined, ExportOutlined, FileTextOutlined, IdcardOutlined, MoreOutlined,
  PlusOutlined, PrinterOutlined, RollbackOutlined, SaveOutlined, StopOutlined, SwapOutlined, UndoOutlined, WarningOutlined,
} from "@ant-design/icons";
import { useOrg } from "../../lib/org";
import { useHotkey, useNotify } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { PageHeader } from "../../components/layout";
import { DateInput, MoneyInput, NumberInput, PartySelect, PctInput, RefSelect } from "../../components/inputs";
import { Balance, JDateTime, Money } from "../../components/display";
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

  if (sourceId && q.isLoading) return <div className="grid h-64 place-content-center"><Spin /></div>;
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
          ? [{ key: "return", icon: <RollbackOutlined />, label: `ثبت ${INVOICE_META[RETURN_KIND[kind]!].title}`, onClick: () => nav(`/${orgId}/${INVOICE_META[RETURN_KIND[kind]!].path}/new?ref=${inv.id}`) }]
          : []),
        ...(kind === "quote" && !inv.extra?.converted_to && inv.status !== "cancelled"
          ? [
              { key: "to-sale", icon: <SwapOutlined />, label: "تبدیل به فاکتور فروش", onClick: () => action(() => api.post(`/goods/invoices/${inv.id}/convert`, { kind: "sale" }), "فاکتور فروش ساخته شد", (r) => nav(`/${orgId}/${INVOICE_META.sale.path}/${r.invoice.id}`)) },
              { key: "to-order", icon: <SwapOutlined />, label: "تبدیل به سفارش فروش", onClick: () => action(() => api.post(`/goods/invoices/${inv.id}/convert`, { kind: "sale_order" }), "سفارش فروش ساخته شد", (r) => nav(`/${orgId}/${INVOICE_META.sale_order.path}/${r.invoice.id}`)) },
            ]
          : []),
        ...((kind === "sale_order" || kind === "purchase_order") && !inv.extra?.converted_to && inv.status !== "cancelled"
          ? [{ key: "to-invoice", icon: <SwapOutlined />, label: "تبدیل به فاکتور", onClick: () => action(() => api.post(`/goods/invoices/${inv.id}/convert`, {}), "فاکتور ساخته شد", (r) => nav(`/${orgId}/${INVOICE_META[r.invoice.kind as InvoiceKind].path}/${r.invoice.id}`)) }]
          : []),
        { key: "copy", icon: <CopyOutlined />, label: "کپی به سند جدید", onClick: () => nav(`/${orgId}/${meta.path}/new?copy=${inv.id}`) },
        ...(inv.voucher_id && can("accounting", "view") ? [{ key: "voucher", icon: <FileTextOutlined />, label: `سند حسابداری ${faDigits(inv.voucher_no ?? "")}`, onClick: () => nav(`/${orgId}/accounting/vouchers/${inv.voucher_id}`) }] : []),
        ...((kind === "sale" || kind === "sale_return") && inv.status === "posted" ? [{ key: "moadian", icon: <ExportOutlined />, label: "خروجی سامانه‌ی مؤدیان (JSON)", onClick: downloadMoadian }] : []),
        ...(inv.status === "posted" && can(meta.area, "edit")
          ? [{ key: "unpost", icon: <UndoOutlined />, label: "برگشت به پیش‌نویس", onClick: async () => { if (await n.confirm("فاکتور به پیش‌نویس برگردد؟", "اثر آن روی انبار و سند حسابداری حذف می‌شود.")) action(() => api.post(`/goods/invoices/${inv.id}/unpost`), "به پیش‌نویس برگشت"); } }]
          : []),
        ...(inv.status === "cancelled" && can(meta.area, "edit")
          ? [{ key: "reopen", icon: <UndoOutlined />, label: "خارج کردن از ابطال", onClick: () => action(() => api.post(`/goods/invoices/${inv.id}/unpost`), "سند دوباره باز شد") }]
          : []),
        ...(inv.status !== "cancelled" && can(meta.area, "full")
          ? [{ key: "cancel", icon: <StopOutlined />, danger: true, label: "ابطال", onClick: async () => { if (await n.confirm(`ابطال ${meta.title}؟`, "سند باقی می‌ماند ولی اثری در انبار و حساب‌ها ندارد.", true)) action(() => api.post(`/goods/invoices/${inv.id}/cancel`), "ابطال شد"); } }]
          : []),
        ...(can(meta.area, "full")
          ? [{ key: "del", icon: <DeleteOutlined />, danger: true, label: "حذف", onClick: async () => { if (await n.confirm(`حذف ${meta.title}؟`, undefined, true)) action(() => api.del(`/goods/invoices/${inv.id}`), "حذف شد", () => nav(`/${orgId}/${meta.path}`)); } }]
          : []),
      ]
    : [];

  return (
    <div>
      <PageHeader
        back={`/${orgId}/${meta.path}`}
        title={inv ? `${meta.title} شماره‌ی ${faDigits(inv.no)}` : `${meta.title} جدید`}
        subtitle={inv ? <>ثبت: <JDateTime v={inv.created_at} />{inv.created_by_name ? ` · ${inv.created_by_name}` : ""}</> : "F4: اسکن بارکد · Enter: خانه‌ی بعد · F2: ثبت · Alt+N: ردیف جدید"}
        extra={inv ? <div className="flex flex-wrap gap-1"><InvoiceStatus s={inv.status} />{inv.extra?.converted_to ? <Tag variant="filled" color="purple">تبدیل‌شده</Tag> : null}</div> : null}
        actions={
          <>
            {settleable ? (
              <Button icon={<DollarOutlined />} onClick={() => nav(`/${orgId}/treasury/docs/new?kind=${meta.settle}&party=${inv.party_id}&invoice=${inv.id}`)}>
                {meta.settle === "receipt" ? "ثبت دریافت" : "ثبت پرداخت"}
              </Button>
            ) : null}
            {!readonly ? (
              <>
                <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => save(meta.postable ? "posted" : "draft")}>
                  {meta.postable ? "ثبت فاکتور" : "ذخیره"} <span className="tz-kbd ltr ms-1 !bg-transparent !text-white/80">F2</span>
                </Button>
                {meta.postable ? <Button onClick={() => save("draft")} disabled={saving}>پیش‌نویس</Button> : null}
              </>
            ) : null}
            <Button icon={<PrinterOutlined />} onClick={() => window.print()}>چاپ</Button>
            {moreItems.length ? (
              <Dropdown trigger={["click"]} menu={{ items: moreItems }}>
                <Button icon={<MoreOutlined />} aria-label="بیشتر" />
              </Dropdown>
            ) : null}
          </>
        }
      />

      <div className="no-print">
        {inv?.status === "cancelled" ? <Alert className="!mb-3" type="error" showIcon title="این سند ابطال شده و اثری در انبار و حساب‌ها ندارد." /> : null}
        {inv?.converted_to ? (
          <Alert className="!mb-3" type="info" showIcon title={<span>این سند به <Link to={`/${orgId}/${INVOICE_META[inv.converted_to.kind as InvoiceKind].path}/${inv.converted_to.id}`}>{INVOICE_META[inv.converted_to.kind as InvoiceKind].title} شماره‌ی {faDigits(inv.converted_to.no)}</Link> تبدیل شده است.</span>} />
        ) : null}
        {inv?.converted_from ? (
          <Alert className="!mb-3" type="info" showIcon title={<span>ساخته‌شده از <Link to={`/${orgId}/${INVOICE_META[inv.converted_from.kind as InvoiceKind].path}/${inv.converted_from.id}`}>{INVOICE_META[inv.converted_from.kind as InvoiceKind].title} شماره‌ی {faDigits(inv.converted_from.no)}</Link></span>} />
        ) : null}
        {inv?.returns?.length ? (
          <Alert
            className="!mb-3"
            type="warning"
            showIcon
            title={<span>برگشتی‌ها: {inv.returns.map((r: any, i: number) => <span key={r.id}>{i ? "، " : ""}<Link to={`/${orgId}/${INVOICE_META[r.kind as InvoiceKind].path}/${r.id}`}>شماره‌ی {faDigits(r.no)}</Link></span>)}</span>}
          />
        ) : null}
      </div>

      <div className="tz-card no-print p-4">
        {/* header */}
        <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          {isNew ? (
            <div>
              <div className="mb-1 text-xs text-muted">نوع سند</div>
              <Select className="w-full" value={kind} onChange={(k) => setKind(k)} options={allowedKinds.map((k) => ({ value: k, label: INVOICE_META[k].title }))} disabled={!!refParam} />
            </div>
          ) : (
            <div>
              <div className="mb-1 text-xs text-muted">نوع سند</div>
              <div className="pt-1"><KindTag kind={kind} /></div>
            </div>
          )}
          <div>
            <div className="mb-1 text-xs text-muted">تاریخ</div>
            <DateInput value={date} onChange={setDate} disabled={readonly} />
          </div>
          <div className="xl:col-span-2">
            <div className="mb-1 flex items-center justify-between text-xs text-muted">
              <span>{meta.party}</span>
              {party ? (
                <span className="flex items-center gap-2">
                  <Tooltip title="مانده‌ی حساب این شخص در دفاتر">مانده: <Balance v={party.balance} /></Tooltip>
                  {creditLimit ? <span>سقف: <Money v={creditLimit.toString()} /></span> : null}
                </span>
              ) : null}
            </div>
            <div className="flex gap-1">
              <PartySelect
                className="min-w-0 flex-1"
                value={partyId}
                allowClear
                disabled={readonly || (isReturn && !!refInvoiceId)}
                placeholder={meta.sale ? "خالی = مشتری نقدی (گذری)" : "انتخاب فروشنده…"}
                onChange={(pid) => {
                  setPartyId(pid);
                  setBuyer(null);
                }}
              />
              <Tooltip title={meta.sale ? "مشخصات خریدار (برای صورتحساب رسمی)" : "مشخصات فروشنده"}>
                <Button
                  icon={<IdcardOutlined />}
                  disabled={readonly}
                  onClick={() => {
                    setBuyerDraft({ ...(effectiveBuyer ?? {}) } as Record<string, string>);
                    setBuyerOpen(true);
                  }}
                />
              </Tooltip>
            </div>
            {party?.party?.is_blacklisted ? <div className="mt-1 text-xs text-bad"><WarningOutlined /> این شخص در فهرست سیاه است</div> : null}
            {overCredit ? <div className="mt-1 text-xs text-warn"><WarningOutlined /> با این فاکتور از سقف اعتبار شخص بیشتر می‌شود</div> : null}
          </div>
          <div>
            <div className="mb-1 text-xs text-muted">انبار</div>
            <RefSelect entity="warehouse" value={warehouseId} onChange={setWarehouseId} disabled={readonly} showCode={false} />
          </div>
          <div>
            <div className="mb-1 text-xs text-muted">{kind === "quote" ? "اعتبار تا" : "سررسید"}</div>
            <DateInput value={dueDate} onChange={setDueDate} allowClear disabled={readonly} placeholder="—" />
          </div>
          {meta.sale ? (
            <div>
              <div className="mb-1 text-xs text-muted">فهرست قیمت</div>
              <RefSelect entity="price_list" value={priceListId} onChange={setPriceListId} allowClear disabled={readonly} showCode={false} placeholder={party?.price_list_id ? "فهرست شخص" : "خودکار"} />
            </div>
          ) : null}
          <div>
            <div className="mb-1 text-xs text-muted">{meta.sale ? "شماره‌ی عطف" : "شماره‌ی فاکتور فروشنده"}</div>
            <Input value={refNo} onChange={(e) => setRefNo(e.target.value)} disabled={readonly} dir="ltr" />
          </div>
          <div>
            <div className="mb-1 text-xs text-muted">نحوه‌ی تسویه</div>
            <Select className="w-full" allowClear value={settlement ?? undefined} onChange={(v) => setSettlement(v ?? null)} options={SETTLEMENT} disabled={readonly} placeholder="—" />
          </div>
          {isReturn ? (
            <div className="xl:col-span-2">
              <div className="mb-1 text-xs text-muted">فاکتور اصلی</div>
              {refInvoiceId ? (
                <Link to={`/${orgId}/${INVOICE_META[RETURN_KIND.sale === kind ? "sale" : "purchase"].path}/${refInvoiceId}`} className="inline-block pt-1">
                  {inv?.ref_invoice ? `${INVOICE_META[inv.ref_invoice.kind as InvoiceKind].title} شماره‌ی ${faDigits(inv.ref_invoice.no)}` : refQ.data ? `شماره‌ی ${faDigits(refQ.data.invoice.no)}` : "مشاهده"}
                </Link>
              ) : (
                <div className="pt-1 text-xs text-muted">بدون فاکتور مرجع (برگشت را از صفحه‌ی فاکتور اصلی بزنید تا قیمت و بهای آن بیاید)</div>
              )}
            </div>
          ) : null}
        </div>

        {/* scan + tools */}
        {!readonly ? (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Input
              ref={scanRef}
              className="!w-72"
              prefix={<BarcodeOutlined className="text-muted" />}
              placeholder="اسکن بارکد یا کد کالا و Enter (F4)"
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              onPressEnter={doScan}
              autoFocus={isNew && meta.sale && !refParam}
              dir="ltr"
            />
            <Button size="small" type={showDesc ? "primary" : "default"} ghost={showDesc} onClick={() => setShowDesc(!showDesc)}>شرح ردیف</Button>
            {!isReturn ? <Button size="small" onClick={repriceAll}>{meta.sale ? "اعمال قیمت فهرست" : "اعمال قیمت خرید کالاها"}</Button> : null}
          </div>
        ) : null}

        {/* grid */}
        <div ref={gridRef} className="overflow-x-auto">
          <table className="tz-grid min-w-[1000px]">
            <thead>
              <tr>
                <th className="w-10">ردیف</th>
                <th className="min-w-[260px]">کالا / خدمت</th>
                {showDesc ? <th className="min-w-[180px]">شرح</th> : null}
                <th className="w-[120px]">مقدار</th>
                <th className="w-[100px]">واحد</th>
                <th className="w-[150px]">فی ({unit})</th>
                <th className="w-[140px]">تخفیف</th>
                <th className="w-[90px]">مالیات ٪</th>
                <th className="w-[150px]">مبلغ</th>
                {!readonly ? <th className="w-10" /> : null}
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
                    <td className="num text-center text-xs text-muted">{faDigits(i + 1)}</td>
                    <td data-cell={`${i}-0`}>
                      <ItemSelect variant="borderless" value={l.item?.id} item={l.item} ctx={lookupCtx} disabled={readonly || (isReturn && !!refInvoiceId && !!l.item)} onChange={(it) => pickItem(i, it)} />
                    </td>
                    {showDesc ? (
                      <td>
                        <Input variant="borderless" value={l.description} disabled={readonly} placeholder="شرح تکمیلی" onChange={(e) => set(i, { description: e.target.value })} />
                      </td>
                    ) : null}
                    <td data-cell={`${i}-1`}>
                      <div className="flex items-center">
                        <NumberInput variant="borderless" decimals={decimalsOf(l)} value={l.qty} disabled={readonly || !l.item} onChange={(v) => set(i, { qty: v })} onPressEnter={() => onEnter(i, 1)} />
                        {short ? (
                          <Tooltip title={`موجودی: ${formatNumber(inUnit(stock!, factorOf(l)), { dp: 3 })} ${unitNameOf(l)}`}>
                            <WarningOutlined className="text-warn" />
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
                        <span className="px-2 text-xs text-muted">{unitNameOf(l)}</span>
                      )}
                    </td>
                    <td data-cell={`${i}-2`}>
                      <MoneyInput variant="borderless" value={l.unit_price} disabled={readonly || !l.item} onChange={(v) => set(i, { unit_price: v })} onPressEnter={() => onEnter(i, 2)} placeholder="۰" />
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
                            <Button size="small" type="text" tabIndex={-1} icon={<SwapOutlined />} onClick={() => set(i, l.disc_mode === "pct" ? { disc_mode: "amount", discount: c?.line_discount && !D(c.line_discount).isZero() ? c.line_discount : null, discount_pct: null } : { disc_mode: "pct", discount: null, discount_pct: null })} />
                          </Tooltip>
                        ) : null}
                      </div>
                    </td>
                    <td data-cell={`${i}-4`}>
                      <PctInput variant="borderless" value={l.vat_pct} disabled={readonly || !l.item} onChange={(v) => set(i, { vat_pct: v })} onPressEnter={() => onEnter(i, 4)} />
                    </td>
                    <td className="px-2 text-left">
                      {c ? (
                        <Tooltip
                          title={
                            <div className="text-xs leading-5">
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
                      <td className="text-center">
                        <Button type="text" size="small" danger icon={<DeleteOutlined />} tabIndex={-1} onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [blank()]))} aria-label="حذف ردیف" />
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={showDesc ? 3 : 2}>
                  {!readonly ? <Button size="small" icon={<PlusOutlined />} onClick={() => setLines((ls) => [...ls, blank()])}>ردیف</Button> : null}
                  <span className="ms-3 text-xs font-normal text-muted">{faDigits(itemLines.length)} ردیف</span>
                </td>
                <td colSpan={5} />
                <td className="text-left"><Money v={D(calc.net).plus(D(calc.tax)).toString()} /></td>
                {!readonly ? <td /> : null}
              </tr>
            </tfoot>
          </table>
        </div>

        {/* notes + totals */}
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_380px]">
          <div className="grid content-start gap-3">
            <div>
              <div className="mb-1 text-xs text-muted">توضیحات (روی فاکتور چاپ می‌شود)</div>
              <Input.TextArea value={notes} onChange={(e) => setNotes(e.target.value)} autoSize={{ minRows: 2, maxRows: 5 }} disabled={readonly} />
            </div>
            {kind === "quote" || kind === "sale_order" || kind === "purchase_order" ? (
              <div>
                <div className="mb-1 text-xs text-muted">شرایط (پرداخت، تحویل، اعتبار)</div>
                <Input.TextArea value={terms} onChange={(e) => setTerms(e.target.value)} autoSize={{ minRows: 2, maxRows: 5 }} disabled={readonly} />
              </div>
            ) : null}
          </div>
          <div className="tz-soft p-3 text-sm">
            <Row label="جمع ردیف‌ها" v={calc.subtotal} />
            {!D(calc.line_discount).isZero() ? <Row label="تخفیف ردیف‌ها" v={calc.line_discount} neg /> : null}
            <div className="flex items-center justify-between gap-2 py-1">
              <span className="flex items-center gap-1 text-muted">
                تخفیف فاکتور
                {!readonly ? (
                  <Button size="small" type="link" className="!px-1" onClick={() => { setDiscMode(discMode === "amount" ? "pct" : "amount"); setDiscount(null); setDiscountPct(null); }}>
                    {discMode === "amount" ? "(درصد)" : "(مبلغ)"}
                  </Button>
                ) : null}
              </span>
              <div className="w-40">
                {discMode === "amount" ? <MoneyInput size="small" value={discount} onChange={setDiscount} disabled={readonly} placeholder="۰" /> : <PctInput size="small" value={discountPct} onChange={setDiscountPct} disabled={readonly} />}
              </div>
            </div>
            {discMode === "pct" && !D(calc.discount).isZero() ? <Row label="مبلغ تخفیف فاکتور" v={calc.discount} neg /> : null}
            <Row label="مالیات و عوارض ارزش افزوده" v={calc.tax} />
            <div className="flex items-center justify-between gap-2 py-1">
              <span className="text-muted">اضافات (حمل، بسته‌بندی…)</span>
              <div className="w-40"><MoneyInput size="small" value={additions} onChange={setAdditions} disabled={readonly} placeholder="۰" /></div>
            </div>
            <div className="flex items-center justify-between gap-2 py-1">
              <span className="text-muted">کسورات</span>
              <div className="w-40"><MoneyInput size="small" value={deductions} onChange={setDeductions} disabled={readonly} placeholder="۰" /></div>
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-line pt-2 text-base font-extrabold">
              <span>مبلغ نهایی</span>
              <Money v={calc.total} unit />
            </div>
            <div className="mt-1 text-[11px] leading-5 text-muted">{D(calc.total).gt(0) ? amountToWords(calc.total, unit) : ""}</div>
            {inv && meta.postable && inv.status === "posted" ? (
              <div className="mt-2 border-t border-line pt-2">
                <Row label={meta.settle === "receipt" ? "دریافت‌شده" : "پرداخت‌شده"} v={inv.allocated} />
                <Row label="مانده" v={inv.remaining ?? "0"} strong />
                {inv.gross_profit !== null && inv.gross_profit !== undefined && can("reports", "view") ? <Row label="سود ناخالص" v={inv.gross_profit} /> : null}
              </div>
            ) : null}
          </div>
        </div>
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
              <div className="mb-1 text-xs text-muted">{label}</div>
              <Input value={buyerDraft[k] ?? ""} dir={ltr ? "ltr" : undefined} onChange={(e) => setBuyerDraft({ ...buyerDraft, [k]: e.target.value })} />
            </div>
          ))}
        </div>
        <div className="mt-2 text-[11px] text-muted">این مشخصات فقط روی همین فاکتور ذخیره می‌شود؛ برای تغییر پرونده‌ی شخص از بخش اشخاص اقدام کنید.</div>
      </Modal>
    </div>
  );
}

function Row({ label, v, neg, strong }: { label: string; v: string; neg?: boolean; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-1 ${strong ? "font-bold" : ""}`}>
      <span className="text-muted">{label}</span>
      <span className={neg ? "tz-neg" : ""}>
        {neg ? "−" : ""}
        <Money v={v} />
      </span>
    </div>
  );
}
