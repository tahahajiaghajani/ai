// Counter sale (فروش طلا — صندوق): a POS-like screen. Scan a tag or a bar (bar number, serial or
// QR), add weighed gold and coins (board coins at the board's price, Parsian coins by weight with
// wage and VAT), take the customer's used gold, coins and bars in trade, split the payment between cash,
// card and bank (the rest on the customer's account), save with F2 (or Ctrl ↵) and print an A5
// invoice or an 80 mm receipt (F9). Prices are computed live with the same module the server posts
// with. Layout (components.md §4.7): the items at the start; at the end the sale sheet — customer,
// the rate locked at the first edit, the invoice maths in one figure column, the payment and the
// settle row, and the footer with the total and the save action.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Dropdown, Input, Select, Tooltip, type InputRef } from "antd";
import {
  Banknote, Coins, CreditCard, Ellipsis, Equal, FileText, Landmark, Lock, Pencil, Plus, Printer, ScanBarcode, Ban,
  CircleCheck, TrendingUp, X, LoaderCircle, ReceiptText, Boxes, IdCard,
} from "lucide-react";
import { useOrg } from "../../lib/org";
import { useHotkey, useNotify } from "../../lib/hooks";
import { ApiError, errorText } from "../../lib/api";
import { PageHeader } from "../../components/layout";
import { DateInput, MoneyInput, NumberInput, PartySelect, PctInput, RefSelect, WeightInput } from "../../components/inputs";
import { Chip, Loader, Money, Weight } from "../../components/display";
import { Ic } from "../../components/shell/icons";
import { D, type Num } from "@shared/money";
import { faDigits, formatNumber } from "@shared/format";
import { formatJalaliDateTime } from "@shared/jalali";
import { gram18FromMazaneh, mazanehFromGram18 } from "@shared/gold";
import { isLegalNationalId, isNationalId } from "@shared/validate";
import { SEAL_TITLES, variantChips } from "@shared/gold-catalogue";
import { amountToWords } from "@shared/words";
import { todayISO } from "@shared/jalali";
import { uuidv7 } from "@shared/id";
import { jTime } from "../../lib/fa";
import {
  catalogueLineIn, docTotals, envOf, priceLine, settleSplit, StatusOf, useCatalogue, useCoins, useGoldSettings, useLatestRate, wageTypeOptions, formOptions, gw,
  type CatalogueRow, type LineIn, type PricedLine,
} from "./shared";
import { GoldStrip, KaratAvatar, KaratSeg } from "./kit";
import { useSheetFit } from "../goods/components";
import { PrintArea, printSheet, type PrintFormat } from "./Invoice";

interface SLine {
  key: string;
  kind: "piece" | "bulk" | "coin" | "old" | "bar";
  direction: "out" | "in";
  gold_item_id?: string | null;
  tag_no?: string | null;
  item_id?: string | null;
  title?: string | null;
  category_name?: string | null;
  ownership?: string | null;
  form?: string | null;
  qty?: string | null;
  fineness?: string | null;
  weight?: string | null;
  stone_weight?: string | null;
  gram_price?: string | null;
  wage_type?: string | null;
  wage_value?: string | null;
  profit_pct?: string | null;
  stone?: string | null;
  discount?: string | null;
  deduction_pct?: string | null;
  /** bars: the bar of the register (out) or the bar handed in (in) */
  gold_bar_id?: string | null;
  bar_no?: string | null;
  serial_no?: string | null;
  brand?: string | null;
  seal_status?: string | null;
  unit_price?: string | null;
  /** buy side: reason of a deduction for the condition */
  description?: string | null;
}

interface Pay {
  id: string | null;
  amount: string | null;
  ref_no?: string;
}

const blankPay = (): Pay => ({ id: null, amount: null });

export default function SaleScreen() {
  const { id } = useParams();
  return <SaleForm key={id ?? "new"} id={id && id !== "new" ? id : null} />;
}

function SaleForm({ id }: { id: string | null }) {
  const { api, org, orgId, can, unit } = useOrg();
  const nav = useNavigate();
  const qc = useQueryClient();
  const n = useNotify();
  const settings = useGoldSettings();
  const latest = useLatestRate();
  const coins = useCoins();
  const catalogue = useCatalogue();
  const prods = useMemo(() => new Map((catalogue.data?.rows ?? []).map((p) => [p.id, p])), [catalogue.data]);
  const scanRef = useRef<InputRef>(null);
  const sheetRef = useSheetFit<HTMLElement>();

  const existing = useQuery({ queryKey: ["gold-doc", id], queryFn: () => api.get(`/gold/docs/${id}`).then((r) => r.doc), enabled: !!id });
  const boxes = useQuery({ queryKey: ["options", "cash_box", "", {}], queryFn: () => api.get("/data/cash_box/options").then((r) => r.options as any[]), staleTime: 60_000 });
  const poses = useQuery({ queryKey: ["options", "pos_terminal", "", {}], queryFn: () => api.get("/data/pos_terminal/options").then((r) => r.options as any[]), staleTime: 60_000 });

  const [date, setDate] = useState<string | null>(todayISO((org.settings?.timezone as string) || "Asia/Tehran"));
  const [gram18, setGram18] = useState<string | null>(null);
  const [mazaneh, setMazaneh] = useState<string | null>(null);
  const [buyPrice, setBuyPrice] = useState<string | null>(null);
  const [partyId, setPartyId] = useState<string | null>(null);
  const [buyer, setBuyer] = useState<{ name?: string; mobile?: string; national_id?: string; address?: string }>({});
  const [lines, setLines] = useState<SLine[]>([]);
  const [cash, setCash] = useState<Pay>(blankPay());
  const [pos, setPos] = useState<Pay>(blankPay());
  const [bank, setBank] = useState<Pay>(blankPay());
  const [description, setDescription] = useState("");
  const [tag, setTag] = useState("");
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [locked, setLocked] = useState(!!id);
  const [saved, setSaved] = useState<any>(null);
  const [format, setFormat] = useState<PrintFormat>("a5");
  // the rate freezes at the start of a sale; the time it was taken from the board is shown beside it (the lock)
  const [rateAt, setRateAt] = useState<string | null>(null);
  const doc = saved ?? existing.data ?? null;

  // the rate board's price for a new sale
  useEffect(() => {
    if (id || gram18 || !latest.data?.rate) return;
    const r = latest.data.rate;
    setGram18(r.gram18);
    setMazaneh(r.mazaneh);
    setBuyPrice(r.buy_gram18 ?? r.gram18);
    setRateAt(r.at);
  }, [latest.data, id, gram18]);
  // default till and card reader
  useEffect(() => {
    if (!cash.id && boxes.data?.length) setCash((c) => ({ ...c, id: boxes.data![0].id }));
  }, [boxes.data, cash.id]);
  useEffect(() => {
    if (!pos.id && poses.data?.length) setPos((p) => ({ ...p, id: poses.data![0].id }));
  }, [poses.data, pos.id]);
  // load a saved sale
  useEffect(() => {
    const d = existing.data;
    if (!d) return;
    setDate(d.date);
    setGram18(d.gram18);
    setMazaneh(d.mazaneh);
    setPartyId(d.party_id);
    setBuyer(d.buyer ?? {});
    setDescription(d.description ?? "");
    const s = d.settle ?? {};
    setCash({ id: s.cash?.cash_box_id ?? null, amount: s.cash?.amount ?? null });
    setPos({ id: s.pos?.pos_id ?? null, amount: s.pos?.amount ?? null });
    setBank({ id: s.bank?.bank_account_id ?? null, amount: s.bank?.amount ?? null, ref_no: s.bank?.ref_no ?? "" });
    const old = d.lines.find((l: any) => l.kind === "old");
    setBuyPrice(old?.gram_price ?? d.gram18);
    setLines(
      d.lines.map((l: any): SLine => ({
        key: l.id, kind: l.kind, direction: l.direction, gold_item_id: l.gold_item_id, tag_no: l.tag_no, item_id: l.item_id, title: l.title,
        category_name: l.category_name, ownership: l.ownership, form: l.form, qty: l.qty, fineness: l.fineness, weight: l.weight, stone_weight: l.stone_weight,
        gram_price: l.kind === "coin" || (l.gram_price && l.gram_price !== d.gram18) ? l.gram_price : null, wage_type: l.wage_type, wage_value: l.wage_value,
        profit_pct: l.profit_pct, stone: D(l.stone ?? 0).isZero() ? null : l.stone, discount: D(l.discount).isZero() || l.kind === "old" || (l.kind === "bar" && l.direction === "in") ? null : l.discount, deduction_pct: l.deduction_pct,
        gold_bar_id: l.gold_bar_id, bar_no: l.bar_no ?? l.tag_no, serial_no: l.serial_no ?? l.extra?.bar?.serial_no ?? null, brand: l.brand ?? l.extra?.bar?.brand ?? null,
        seal_status: l.seal_status ?? l.extra?.bar?.seal_status ?? null, unit_price: l.extra?.unit_price ?? null, description: l.description,
      })),
    );
    setLocked(d.status !== "draft");
  }, [existing.data]);

  const env = useMemo(() => envOf(settings.data, org.money_decimals, gram18 ?? 0, mazaneh, date), [settings.data, org.money_decimals, gram18, mazaneh, date]);
  const rate = latest.data?.rate ?? null;
  const lineIn = (l: SLine): LineIn =>
    l.kind === "coin" || l.kind === "bar"
      ? catalogueLineIn("sale", l, prods.get(l.item_id ?? ""), rate, settings.data, gram18, buyPrice)
      : {
          kind: l.kind, direction: l.direction, form: l.form, qty: l.qty, fineness: l.fineness, weight: l.weight,
          gram_price: l.kind === "old" ? l.gram_price ?? buyPrice : l.gram_price, wage_type: l.wage_type, wage_value: l.wage_value,
          profit_pct: l.profit_pct, stone: l.stone, discount: l.discount, deduction_pct: l.deduction_pct,
        };
  const priced = useMemo(() => lines.map((l) => ({ l, p: priceLine("sale", lineIn(l), env) })), [lines, env, buyPrice, prods, rate, settings.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const totals = useMemo(() => docTotals("sale", priced.map(({ l, p }) => ({ ...p, kind: l.kind, direction: l.direction }))), [priced]);
  const split = settleSplit(totals.net, { cash: { amount: cash.amount }, pos: { amount: pos.amount }, bank: { amount: bank.amount } });
  const remaining = D(split.remaining);
  const outLines = priced.filter(({ l }) => l.direction === "out");
  const oldLines = priced.filter(({ l }) => l.kind === "old");
  const coinIns = priced.filter(({ l }) => l.kind === "coin" && l.direction === "in");
  const barIns = priced.filter(({ l }) => l.kind === "bar" && l.direction === "in");
  const tradeIns = oldLines.length + coinIns.length + barIns.length;
  // identification (KYC) for coins, bars and آب‌شده: a valid national id of the customer
  const kyc = settings.data?.kyc;
  const needsId =
    !!kyc?.enabled &&
    lines.some((l) => l.kind === "coin" || l.kind === "bar" || (l.kind === "bulk" && (l.form ?? "bullion") === "bullion")) &&
    (!kyc.threshold || D(totals.total).abs().gte(D(kyc.threshold)) || D(totals.old_value).gte(D(kyc.threshold)));
  const idOk = !!partyId || isNationalId(buyer.national_id ?? "") || isLegalNationalId(buyer.national_id ?? "");
  const readOnly = locked || !can("gold", "edit");

  const set = (key: string, patch: Partial<SLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));
  const focusScan = () => setTimeout(() => scanRef.current?.focus(), 30);

  /** A scanned bar (our bar number, the maker's serial or its QR) joins the sale. */
  const addBar = async (t: string) => {
    const r = await api.get(`/gold/bars/lookup/${encodeURIComponent(t)}`);
    if (!r.available) {
      n.warn(`شمش ${faDigits(r.bar.bar_no)} «${r.status_title}» است`);
      return;
    }
    if (lines.some((l) => l.gold_bar_id === r.bar.id)) {
      n.warn("این شمش قبلاً در فاکتور هست");
      return;
    }
    const b = r.bar;
    setLines((ls) => [
      ...ls,
      {
        key: uuidv7(), kind: "bar", direction: "out", gold_bar_id: b.id, item_id: b.item_id, bar_no: b.bar_no, title: b.model_name ?? "شمش", weight: b.weight, fineness: b.fineness,
        serial_no: b.serial_no, brand: b.brand, seal_status: b.seal_status, ownership: b.ownership,
      },
    ]);
    setTag("");
  };

  const addTag = async (raw: string) => {
    const t = raw.trim();
    if (!t || readOnly) return;
    setScanning(true);
    try {
      let r: any;
      try {
        r = await api.get(`/gold/items/by-tag/${encodeURIComponent(t)}`, { gram18 });
      } catch (e) {
        // not a tag: a bar number, serial or QR
        if (e instanceof ApiError && e.status === 404) return await addBar(t);
        throw e;
      }
      if (!r.available) {
        n.warn(`اتیکت ${faDigits(r.item.tag_no)} «${r.status_title}» است`);
        return;
      }
      if (lines.some((l) => l.gold_item_id === r.item.id)) {
        n.warn("این جنس قبلاً در فاکتور هست");
        return;
      }
      const x = r.line;
      setLines((ls) => [
        ...ls,
        {
          key: uuidv7(), kind: "piece", direction: "out", gold_item_id: x.gold_item_id, tag_no: x.tag_no, title: x.title, category_name: x.category_name,
          ownership: x.ownership, weight: x.weight, fineness: x.fineness, stone_weight: x.stone_weight, wage_type: x.wage_type, wage_value: x.wage_value,
          profit_pct: x.profit_pct, stone: x.stone && !D(x.stone).isZero() ? x.stone : null,
        },
      ]);
      setTag("");
    } catch (e) {
      n.error(e);
    } finally {
      setScanning(false);
      focusScan();
    }
  };

  const addBulk = () => setLines((ls) => [...ls, { key: uuidv7(), kind: "bulk", direction: "out", form: "bullion", fineness: "750", weight: null, wage_type: "fixed", wage_value: "0" }]);
  const addCoin = () => {
    const c = coins.data?.find((x) => D(x.qty).gt(0)) ?? coins.data?.[0];
    setLines((ls) => [...ls, { key: uuidv7(), kind: "coin", direction: "out", item_id: c?.id ?? null, title: c?.name ?? null, qty: "1", fineness: c?.fineness ?? "900" }]);
  };
  const addCoinIn = () => {
    const c = coins.data?.find((x) => x.rate_key === "emami") ?? coins.data?.[0];
    setLines((ls) => [...ls, { key: uuidv7(), kind: "coin", direction: "in", item_id: c?.id ?? null, title: c?.name ?? null, qty: "1", fineness: c?.fineness ?? "900" }]);
  };
  const addBarIn = () => {
    const m = (catalogue.data?.rows ?? []).find((x) => x.kind === "bar" && x.rate_key === "bar_other") ?? (catalogue.data?.rows ?? []).find((x) => x.kind === "bar");
    setLines((ls) => [...ls, { key: uuidv7(), kind: "bar", direction: "in", item_id: m?.id ?? null, weight: null, fineness: m?.fineness ?? "995", seal_status: "sealed" }]);
  };
  const addOld = () => setLines((ls) => [...ls, { key: uuidv7(), kind: "old", direction: "in", fineness: "750", weight: null, deduction_pct: settings.data?.old_deduction_pct ?? null }]);

  const fillRest = (which: "cash" | "pos" | "bank") => {
    const others = D(which === "cash" ? 0 : cash.amount).plus(D(which === "pos" ? 0 : pos.amount)).plus(D(which === "bank" ? 0 : bank.amount));
    const rest = D(totals.net).abs().minus(others);
    const v = rest.gt(0) ? rest.toString() : null;
    if (which === "cash") setCash((c) => ({ ...c, amount: v }));
    if (which === "pos") setPos((c) => ({ ...c, amount: v }));
    if (which === "bank") setBank((c) => ({ ...c, amount: v }));
  };

  const payload = (status: "posted" | "draft") => ({
    kind: "sale",
    date,
    status,
    party_id: partyId,
    gram18,
    mazaneh,
    description: description || null,
    buyer: partyId ? null : buyer,
    settle: {
      cash: cash.id && cash.amount ? { cash_box_id: cash.id, amount: cash.amount } : null,
      pos: pos.id && pos.amount ? { pos_id: pos.id, amount: pos.amount } : null,
      bank: bank.id && bank.amount ? { bank_account_id: bank.id, amount: bank.amount, ref_no: bank.ref_no || null } : null,
    },
    lines: lines.map((l) => {
      const p = lineIn(l);
      if (l.kind === "coin") {
        return { kind: "coin", direction: l.direction, item_id: l.item_id ?? null, qty: l.qty, gram_price: p.gram_price ?? null, wage_type: l.wage_type ?? null, wage_value: l.wage_value ?? null, profit_pct: l.profit_pct ?? null, discount: l.discount ?? null, description: l.description || null };
      }
      if (l.kind === "bar") {
        return l.direction === "out"
          ? { kind: "bar", direction: "out", gold_bar_id: l.gold_bar_id, unit_price: l.unit_price ?? null, wage_type: l.wage_type ?? null, wage_value: l.wage_value ?? null, profit_pct: l.profit_pct ?? null, discount: l.discount ?? null }
          : {
              kind: "bar", direction: "in", item_id: l.item_id ?? null, gold_bar_id: l.gold_bar_id ?? null, weight: l.weight, fineness: l.fineness, unit_price: l.unit_price ?? null,
              discount: l.discount ?? null, description: l.description || null, bar: { serial_no: l.serial_no || null, brand: l.brand || null, seal_status: l.seal_status ?? "sealed" },
            };
      }
      return {
        kind: l.kind, direction: l.direction, gold_item_id: l.gold_item_id ?? null, item_id: l.item_id ?? null, title: l.kind === "piece" ? null : l.title ?? null,
        form: l.kind === "bulk" ? l.form : null, qty: null, fineness: l.kind === "piece" ? null : l.fineness, weight: l.kind === "piece" ? null : l.weight,
        gram_price: p.gram_price ?? null, wage_type: l.wage_type ?? null, wage_value: l.wage_value ?? null, profit_pct: l.profit_pct ?? null, stone: l.stone ?? null,
        discount: l.discount ?? null, deduction_pct: l.kind === "old" ? l.deduction_pct ?? null : null,
      };
    }),
  });

  const save = async (status: "posted" | "draft" = "posted") => {
    if (readOnly || saving) return;
    if (!outLines.length) return n.warn("هیچ جنسی در فاکتور نیست؛ اتیکت را اسکن کنید");
    if (!date) return n.warn("تاریخ را وارد کنید");
    if (!gram18 && outLines.some(({ l }) => l.kind !== "coin")) return n.warn("قیمت گرم ۱۸ عیار را وارد کنید");
    if (status === "posted" && needsId && !idOk) return n.warn("برای سکه، شمش و آب‌شده کد ملی معتبر خریدار لازم است");
    if (status === "posted" && !remaining.isZero() && !partyId) return n.warn("برای فروش نسیه، مشتری را انتخاب کنید یا مبلغ را کامل دریافت کنید");
    setSaving(true);
    try {
      const r = id ? await api.put(`/gold/docs/${id}`, payload(status)) : await api.post("/gold/docs", payload(status));
      n.ok(status === "draft" ? "پیش‌نویس ذخیره شد" : `فاکتور شماره‌ی ${faDigits(r.doc.no)} ثبت شد`);
      qc.invalidateQueries({ queryKey: ["table"] });
      qc.invalidateQueries({ queryKey: ["gold-summary"] });
      qc.invalidateQueries({ queryKey: ["gold-coins"] });
      qc.invalidateQueries({ queryKey: ["gold-catalogue"] });
      qc.setQueryData(["gold-doc", r.doc.id], r.doc);
      setSaved(r.doc);
      setLocked(r.doc.status !== "draft");
      if (!id) nav(`/${orgId}/gold/sale/${r.doc.id}`, { replace: true, state: { saved: true } });
    } catch (e) {
      n.error(e);
    } finally {
      setSaving(false);
    }
  };

  const print = (f: PrintFormat) => {
    if (!doc) return;
    setFormat(f);
    printSheet(f);
  };

  const action = async (what: "cancel" | "post") => {
    if (!id) return;
    if (what === "cancel" && !(await n.confirm("این فاکتور باطل شود؟", "اجناس به موجودی برمی‌گردند و سند حسابداری حذف می‌شود.", true))) return;
    try {
      const r = await api.post(`/gold/docs/${id}/${what}`);
      qc.setQueryData(["gold-doc", id], r.doc);
      setSaved(r.doc);
      qc.invalidateQueries({ queryKey: ["table"] });
      n.ok(what === "cancel" ? "فاکتور باطل شد" : "فاکتور ثبت شد");
    } catch (e) {
      n.error(e);
    }
  };

  useHotkey("f2", () => save("posted"), [lines, date, gram18, mazaneh, buyPrice, partyId, buyer, cash, pos, bank, description, saving, readOnly]);
  useHotkey("ctrl+enter", () => save("posted"), [lines, date, gram18, mazaneh, buyPrice, partyId, buyer, cash, pos, bank, description, saving, readOnly]);
  useHotkey("f4", () => focusScan(), []);
  useHotkey("f9", () => print(format), [doc, format]);

  const applyBoard = () => {
    const r = latest.data?.rate;
    if (!r) return n.warn("قیمتی در تابلو ثبت نشده است");
    setGram18(r.gram18);
    setMazaneh(r.mazaneh);
    setBuyPrice(r.buy_gram18 ?? r.gram18);
    setRateAt(r.at);
  };

  if (id && existing.isLoading) return <div className="grid h-64 place-content-center"><Loader /></div>;
  if (id && existing.error) return <Alert type="error" showIcon title={errorText(existing.error)} />;

  const dp = org.money_decimals ?? 0;
  const g18Missing = !gram18 && lines.some((l) => l.kind !== "coin");
  const net = D(totals.net);
  const payOut = net.isNeg();
  const board = latest.data?.rate ?? null;
  const marketMoved = !readOnly && !!board?.gram18 && !!gram18 && !D(board.gram18).eq(D(gram18));
  const soldWeight = outLines.filter(({ l }) => l.kind !== "coin").reduce((a, { p }) => a.plus(D(p.weight)), D(0));
  const canEdit = can("gold", "edit");
  const more = doc
    ? [
        ...(locked && canEdit && doc.status === "posted" ? [{ key: "edit", icon: <Ic icon={Pencil} />, label: "ویرایش فاکتور", onClick: () => setLocked(false) }] : []),
        ...(doc.status !== "posted" && canEdit ? [{ key: "post", icon: <Ic icon={CircleCheck} />, label: "ثبت قطعی", onClick: () => action("post") }] : []),
        ...(doc.voucher ? [{ key: "voucher", icon: <Ic icon={FileText} />, label: `سند حسابداری ${faDigits(doc.voucher.no)}`, onClick: () => nav(`/${orgId}/accounting/vouchers/${doc.voucher.id}`) }] : []),
        ...(doc.status === "posted" && canEdit ? [{ type: "divider" as const }, { key: "cancel", icon: <Ic icon={Ban} />, danger: true, label: "ابطال فاکتور", onClick: () => action("cancel") }] : []),
      ]
    : [];

  return (
    <div className="sf-doc">
      <PageHeader
        back={`/${orgId}/gold/docs?kind=sale`}
        title={doc ? `فروش طلا ${faDigits(doc.no)}` : "فروش طلا"}
        subtitle={
          doc ? (
            <span className="sf-doc-meta">
              <StatusOf s={doc.status} />
              {doc.created_at ? <><span className="sf-sep" aria-hidden /><span className="sf-num">{formatJalaliDateTime(doc.created_at)}</span></> : null}
              {doc.created_by_name ? <><span className="sf-sep" aria-hidden /><span>{doc.created_by_name}</span></> : null}
            </span>
          ) : (
            <span className="sf-doc-meta">صندوق</span>
          )
        }
        actions={
          doc ? (
            <>
              {more.length ? (
                <Dropdown trigger={["click"]} menu={{ items: more }} placement="bottomLeft">
                  <Button icon={<Ic icon={Ellipsis} />} aria-label="بیشتر" />
                </Dropdown>
              ) : null}
              <Button icon={<Ic icon={Plus} />} onClick={() => nav(`/${orgId}/gold/sale/new`)}>فروش جدید</Button>
            </>
          ) : null
        }
      />

      {doc?.status === "cancelled" ? (
        <div className="sf-inline no-print" data-tone="danger"><i className="sf-nuqta" aria-hidden /><span><b>باطل شده.</b> اجناس به موجودی برگشته و سند حسابداری آن حذف شده است.</span></div>
      ) : null}

      <div className="no-print">
        <GoldStrip rate={board} change={latest.data?.change} changePct={latest.data?.change_pct} coins={coins.data ?? []} />
      </div>

      <div className="sf-dpage no-print">
        {/* ---------------------------------------------------------------- items */}
        <div className="sf-doc">
          <section className="sf-doc-card" aria-label="اقلام فاکتور">
            <div className="sf-doc-h">
              <h2>اقلام</h2>
              {outLines.length ? (
                <span className="sf-doc-hm">
                  <span className="sf-num">{faDigits(outLines.length)}</span> قلم
                  {!soldWeight.isZero() ? <><span className="sf-sep" aria-hidden /><Weight v={soldWeight} /></> : null}
                </span>
              ) : null}
              {!readOnly ? (
                <div className="sf-doc-hx">
                  <Button size="small" type="text" icon={<Ic icon={Plus} />} onClick={addBulk}>طلای وزنی</Button>
                  <Button size="small" type="text" icon={<Ic icon={Coins} />} onClick={addCoin}>سکه</Button>
                </div>
              ) : null}
            </div>
            {!readOnly ? (
              <div className="sf-scan px-5 pt-4">
                <Input
                  ref={scanRef}
                  autoFocus
                  className="sf-scan-in"
                  dir="ltr"
                  prefix={<Ic icon={ScanBarcode} />}
                  suffix={scanning ? <Ic icon={LoaderCircle} className="sf-spin" /> : <bdi dir="ltr" className="sf-scan-k sf-latin">F4</bdi>}
                  placeholder="اسکن اتیکت یا شمش، Enter"
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  onPressEnter={() => addTag(tag)}
                  aria-label="اسکن اتیکت"
                />
                <RefSelect
                  entity="gold_item"
                  filters={{ status: "in_stock" }}
                  value={null}
                  placeholder="جستجوی جنس با نام یا اتیکت…"
                  className="min-w-0 flex-1"
                  popupWidth={380}
                  onChange={(_, o) => o?.sub && addTag(String(o.sub))}
                />
              </div>
            ) : null}
            {outLines.length ? (
              <div className="sf-glines sf-stagger mt-2">
                {outLines.map(({ l, p }) => (
                  <SaleLine key={l.key} l={l} p={p} breakdown={outLines.length > 1} readOnly={readOnly} coins={coins.data ?? []} prod={prods.get(l.item_id ?? "")} defaultProfit={env.profitPct} onChange={(patch) => set(l.key, patch)} onRemove={() => remove(l.key)} />
                ))}
              </div>
            ) : (
              <div className="sf-gline-empty">
                <span className="tile" aria-hidden><Ic icon={ScanBarcode} size={28} /></span>
                <span>اتیکت جنس یا شمش را اسکن کنید تا به فاکتور اضافه شود.</span>
                {!readOnly ? <span className="k">برای طلای وزنی یا سکه از دکمه‌های بالای فهرست استفاده کنید.</span> : null}
              </div>
            )}
          </section>

          {/* ---------------------------------------------------------------- trade-in */}
          <section className="sf-doc-card" aria-label="دریافتی از مشتری">
            <div className="sf-doc-h">
              <h2>دریافتی از مشتری</h2>
              <span className="sf-doc-hm">{tradeIns ? <>تعویض، <Money v={totals.old_value} /></> : "تعویض"}</span>
              {!readOnly ? (
                <div className="sf-doc-hx">
                  <Button size="small" type="text" icon={<Ic icon={Plus} />} onClick={addOld}>طلای مستعمل</Button>
                  <Button size="small" type="text" icon={<Ic icon={Coins} />} onClick={addCoinIn}>سکه</Button>
                  <Button size="small" type="text" icon={<Ic icon={Boxes} />} onClick={addBarIn}>شمش</Button>
                </div>
              ) : null}
            </div>
            {coinIns.length || barIns.length ? (
              <TradeIns coins={coinIns} bars={barIns} readOnly={readOnly} catalogue={catalogue.data?.rows ?? []} onChange={set} onRemove={remove} />
            ) : null}
            {oldLines.length ? (
              <div className="sf-grid-wrap">
                <table className="sf-grid min-w-[660px]">
                  <thead>
                    <tr>
                      <th>شرح</th>
                      <th className="w-[116px]">وزن (گرم)</th>
                      <th className="w-[84px]">عیار</th>
                      <th className="w-[80px]">کسر ٪</th>
                      <th className="w-[136px]">نرخ گرم ۱۸</th>
                      <th className="w-[136px]">ارزش ({unit})</th>
                      {!readOnly ? <th className="w-9" aria-label="حذف" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {oldLines.map(({ l, p }) => (
                      <tr key={l.key}>
                        <td><Input variant="borderless" disabled={readOnly} value={l.title ?? ""} placeholder="طلای مستعمل" onChange={(e) => set(l.key, { title: e.target.value })} /></td>
                        <td>
                          {readOnly ? <span className="sf-gsub !text-[13px] !text-ink"><Weight v={l.weight ?? 0} unit={false} zero="—" /></span> : <WeightInput variant="borderless" suffix={undefined} value={l.weight} onChange={(v) => set(l.key, { weight: v })} />}
                          {!D(p.weight750).isZero() ? <span className="sf-gsub">معادل ۷۵۰: <Weight v={p.weight750} unit={false} /></span> : null}
                        </td>
                        <td><NumberInput variant="borderless" decimals={1} disabled={readOnly} value={l.fineness} onChange={(v) => set(l.key, { fineness: v })} /></td>
                        <td><PctInput variant="borderless" suffix={undefined} disabled={readOnly} value={l.deduction_pct} onChange={(v) => set(l.key, { deduction_pct: v })} /></td>
                        <td><MoneyInput variant="borderless" disabled={readOnly} value={l.gram_price} placeholder={buyPrice ? formatNumber(buyPrice) : ""} onChange={(v) => set(l.key, { gram_price: v })} /></td>
                        <td className="sf-gn">
                          <Money v={p.total} />
                          {!D(p.discount).isZero() ? <span className="sf-gsub !px-0">کسر <Money v={p.discount} /></span> : null}
                        </td>
                        {!readOnly ? (
                          <td><span className="sf-row-x"><Button type="text" size="small" icon={<Ic icon={X} />} onClick={() => remove(l.key)} aria-label="حذف ردیف" /></span></td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              !coinIns.length && !barIns.length ? <div className="px-5 py-4 text-[13px] text-ink-3">مشتری طلا، سکه یا شمشی برای تعویض ندارد.</div> : null
            )}
          </section>
        </div>

        {/* ---------------------------------------------------------------- the sale sheet */}
        <aside ref={sheetRef} className="sf-dsheet" aria-label="فاکتور">
          <div className="sf-dsheet-b">
            <div className="sf-field">
              <div className="sf-field-l">مشتری</div>
              <PartySelect role="customer" value={partyId} disabled={readOnly} allowClear placeholder="مشتری گذری، یا جستجوی مشتری…" onChange={(v) => setPartyId(v)} className="w-full" />
            </div>
            {!partyId ? (
              <div className="grid grid-cols-2 gap-3">
                <Input disabled={readOnly} placeholder="نام خریدار" value={buyer.name ?? ""} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} aria-label="نام خریدار" />
                <Input disabled={readOnly} placeholder="موبایل" dir="ltr" inputMode="tel" className="sf-numin" value={buyer.mobile ?? ""} onChange={(e) => setBuyer({ ...buyer, mobile: e.target.value })} aria-label="موبایل" />
                <Input disabled={readOnly} placeholder="کد ملی" dir="ltr" inputMode="numeric" className="sf-numin" value={buyer.national_id ?? ""} onChange={(e) => setBuyer({ ...buyer, national_id: e.target.value })} aria-label="کد ملی" />
                <DateInput value={date} disabled={readOnly} onChange={setDate} />
                {needsId && !idOk && !readOnly ? (
                  <div className="sf-field-err col-span-2 flex items-center gap-1.5"><Ic icon={IdCard} size={14} />برای سکه، شمش و آب‌شده کد ملی معتبر خریدار لازم است.</div>
                ) : null}
              </div>
            ) : (
              <div className="sf-field">
                <div className="sf-field-l">تاریخ</div>
                <DateInput value={date} disabled={readOnly} onChange={setDate} />
              </div>
            )}

            <div className="sf-field">
              <div className="sf-field-l">نرخ هر گرم ۱۸ عیار</div>
              <MoneyInput
                value={gram18}
                disabled={readOnly}
                status={g18Missing ? "error" : undefined}
                suffix={
                  rateAt && !readOnly ? (
                    <Tooltip title="نرخ این فاکتور در شروع فروش ثابت شد">
                      <span className="sf-lock-sfx"><Ic icon={Lock} size={14} /><span>{jTime(new Date(rateAt))}</span></span>
                    </Tooltip>
                  ) : (
                    <span>{unit}</span>
                  )
                }
                onChange={(v) => { setGram18(v); setMazaneh(v ? mazanehFromGram18(v) : null); setRateAt(null); }}
              />
              {g18Missing ? <div className="sf-field-err">نرخ گرم ۱۸ عیار را وارد کنید.</div> : null}
            </div>
            {marketMoved ? (
              <div className="sf-lock-note">
                <Ic icon={TrendingUp} size={14} />
                <span>نرخ بازار اکنون <span className="sf-num">{formatNumber(board!.gram18!)}</span> است.</span>
                <button type="button" className="sf-link" onClick={applyBoard}>به‌روزرسانی نرخ</button>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <div className="sf-field">
                <div className="sf-field-l">مظنه</div>
                <MoneyInput value={mazaneh} disabled={readOnly} onChange={(v) => { setMazaneh(v); setGram18(v ? gram18FromMazaneh(v) : null); setRateAt(null); }} />
              </div>
              <div className="sf-field">
                <div className="sf-field-l">خرید مستعمل (گرم ۱۸)</div>
                <MoneyInput value={buyPrice} disabled={readOnly} onChange={setBuyPrice} />
              </div>
            </div>

            {/* the invoice maths: one start-aligned figure column, shared with the payments and the settle row */}
            <div className="sf-sums" role="group" aria-label="محاسبه‌ی فاکتور">
              <SumRow k="ارزش طلا" why={!D(totals.weight_out).isZero() && gram18 ? <>{formatNumber(totals.weight_out, { dp: 3, minDp: 3 })} × {formatNumber(gram18)}</> : null} v={totals.gold_value} />
              <SumRow k="اجرت ساخت" v={totals.wage} />
              <SumRow k="سود فروشنده" why="طلا و اجرت" v={totals.profit} />
              {!D(totals.discount).isZero() ? <SumRow k="تخفیف" v={D(totals.discount).neg().toString()} /> : null}
              <SumRow k="مالیات" why={`${faDigits(String(env.taxPct))}٪ اجرت و سود`} v={totals.tax} />
              {!D(totals.stone).isZero() ? <SumRow k="سنگ و جواهر" v={totals.stone} /> : null}
              {!D(totals.coins).isZero() ? <SumRow k="سکه" v={totals.coins} /> : null}
              {!D(totals.bars).isZero() ? <SumRow k="شمش" why={`${faDigits(outLines.filter(({ l }) => l.kind === "bar").length)} شمش`} v={totals.bars} /> : null}
              <SumRow k="مبلغ فاکتور" v={totals.total} total={D(totals.old_value).isZero()} />
              {!D(totals.old_value).isZero() ? (
                <>
                  <SumRow k={coinIns.length || barIns.length ? "دریافتی از مشتری" : "طلای مستعمل"} why={!D(totals.weight_in).isZero() ? <>{formatNumber(totals.weight_in, { dp: 3, minDp: 3 })} گرم ۷۵۰</> : null} v={D(totals.old_value).neg().toString()} />
                  <SumRow k={payOut ? "قابل پرداخت به مشتری" : "قابل دریافت"} v={net.abs().toString()} total />
                </>
              ) : null}
              {!net.isZero() ? <div className="r is-words"><span>{amountToWords(net.abs(), unit)}</span></div> : null}
            </div>

            <div className="sf-field">
              <div className="sf-sec-t"><span>{payOut ? "پرداخت به مشتری" : "دریافت"}</span></div>
              <div className="sf-pay is-2row">
                <PayRow icon={Banknote} label="نقد" entity="cash_box" pay={cash} setPay={setCash} readOnly={readOnly} onRest={() => fillRest("cash")} />
                {!payOut ? <PayRow icon={CreditCard} label="کارتخوان" entity="pos_terminal" pay={pos} setPay={setPos} readOnly={readOnly} onRest={() => fillRest("pos")} /> : null}
                <PayRow icon={Landmark} label="واریز" entity="bank_account" pay={bank} setPay={setBank} readOnly={readOnly} onRest={() => fillRest("bank")} />
                {bank.amount ? (
                  <div className="r is-ref">
                    <span />
                    <Input size="small" dir="ltr" className="sf-numin" disabled={readOnly} placeholder="شماره‌ی پیگیری واریز" value={bank.ref_no ?? ""} onChange={(e) => setBank({ ...bank, ref_no: e.target.value })} />
                  </div>
                ) : null}
              </div>
              {!net.isZero() ? (
                remaining.isZero() ? (
                  <div className="sf-settle" data-state="in"><span className="k">تسویه شد</span></div>
                ) : remaining.isNeg() ? (
                  <div className="sf-settle" data-state="over"><span className="k">بیش از مبلغ فاکتور</span><span className="n"><Money v={remaining.abs().toString()} /></span></div>
                ) : (
                  <div className="sf-settle" data-state="due">
                    <span className="k">مانده تا تسویه<span className="h">{partyId ? "به حساب مشتری" : "مشتری را انتخاب کنید"}</span></span>
                    <span className="n"><Money v={remaining.toString()} /></span>
                  </div>
                )
              ) : null}
            </div>

            <Input.TextArea autoSize={{ minRows: 1, maxRows: 3 }} disabled={readOnly} placeholder="توضیحات فاکتور (اختیاری)" value={description} onChange={(e) => setDescription(e.target.value)} aria-label="توضیحات" />
          </div>

          <div className="sf-dsheet-f">
            <div className="tot">
              <small>{payOut ? "قابل پرداخت به مشتری" : D(totals.old_value).isZero() ? "مبلغ فاکتور" : "قابل دریافت"}</small>
              <b>{formatNumber(net.abs(), { dp })}<span className="sf-unit">{"\u00a0"}{unit}</span></b>
            </div>
            <div className="act">
              {!readOnly ? (
                <>
                  {!doc || doc.status === "draft" ? <Button onClick={() => save("draft")} disabled={saving}>پیش‌نویس</Button> : null}
                  <Button type="primary" loading={saving} onClick={() => save("posted")}>
                    ثبت فاکتور<Kbd k="F2" />
                  </Button>
                </>
              ) : doc ? (
                <>
                  <Tooltip title="رسید ۸۰ میلی‌متری">
                    <Button icon={<Ic icon={ReceiptText} />} onClick={() => print("receipt")} aria-label="چاپ رسید ۸۰ میلی‌متری" />
                  </Tooltip>
                  <Button type="primary" icon={<Ic icon={Printer} />} onClick={() => print("a5")}>
                    چاپ فاکتور<Kbd k="F9" />
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        </aside>
      </div>
      <PrintArea doc={doc} format={format} />
    </div>
  );
}

/** The shortcut inside a button: an LTR isolate in a 6 px RTL wrapper. */
function Kbd({ k }: { k: string }) {
  return (
    <span className="sf-kw" aria-hidden>
      <bdi dir="ltr"><kbd>{k}</kbd></bdi>
    </span>
  );
}

function SumRow({ k, why, v, total }: { k: ReactNode; why?: ReactNode; v: Num; total?: boolean }) {
  return (
    <div className={`r ${total ? "is-total" : ""}`}>
      <span>
        {k}
        {why ? <span className="why">{why}</span> : null}
      </span>
      <span className="n"><Money v={v} zero="—" /></span>
    </div>
  );
}

function PayRow({ icon, label, entity, pay, setPay, readOnly, onRest }: { icon: typeof Banknote; label: string; entity: string; pay: Pay; setPay: (m: Pay) => void; readOnly: boolean; onRest: () => void }) {
  return (
    <div className="r">
      <span className="ic"><Ic icon={icon} /></span>
      <span className="m">
        <span className="k">{label}</span>
        <RefSelect entity={entity} size="small" variant="borderless" className="acct" value={pay.id} disabled={readOnly} showCode={false} placeholder="انتخاب…" onChange={(v) => setPay({ ...pay, id: v })} />
      </span>
      <span className="n">
        <MoneyInput size="small" value={pay.amount} disabled={readOnly} placeholder="—" onChange={(v) => setPay({ ...pay, amount: v })} />
        <Tooltip title="باقی‌مانده با این روش">
          <Button size="small" type="text" disabled={readOnly} icon={<Ic icon={Equal} size={14} />} onClick={onRest} aria-label={`باقی‌مانده با ${label}`} />
        </Tooltip>
      </span>
    </div>
  );
}

/** Coins and bars the customer hands in: board coins at the board's buy price, bars at the day rate less the fee. */
function TradeIns({ coins, bars, readOnly, catalogue, onChange, onRemove }: {
  coins: { l: SLine; p: PricedLine }[];
  bars: { l: SLine; p: PricedLine }[];
  readOnly: boolean;
  catalogue: CatalogueRow[];
  onChange: (key: string, patch: Partial<SLine>) => void;
  onRemove: (key: string) => void;
}) {
  const coinOptions = catalogue.filter((c) => c.kind === "coin" && (c.is_active || coins.some(({ l }) => l.item_id === c.id))).map((c) => ({ value: c.id, label: c.name }));
  const models = catalogue.filter((c) => c.kind === "bar").map((c) => ({ value: c.id, label: c.name }));
  const x = (key: string) => (!readOnly ? <td><span className="sf-row-x"><Button type="text" size="small" icon={<Ic icon={X} />} onClick={() => onRemove(key)} aria-label="حذف ردیف" /></span></td> : null);
  const reason = (l: SLine, p: PricedLine) =>
    D(l.discount ?? 0).gt(0) ? (
      <Input size="small" variant="borderless" status={l.description?.trim() ? undefined : "error"} disabled={readOnly} placeholder="دلیل کسر (الزامی)" value={l.description ?? ""} onChange={(e) => onChange(l.key, { description: e.target.value })} />
    ) : !D(p.discount).isZero() ? <span className="sf-gsub !px-0">کسر <Money v={p.discount} /></span> : null;
  return (
    <div className="sf-grid-wrap">
      <table className="sf-grid min-w-[700px]">
        <thead>
          <tr>
            <th>سکه / شمش</th>
            <th className="w-[150px]">تعداد / وزن و عیار</th>
            <th className="w-[136px]">قیمت خرید</th>
            <th className="w-[120px]">کسر بابت وضعیت</th>
            <th className="w-[136px]">ارزش</th>
            {!readOnly ? <th className="w-9" aria-label="حذف" /> : null}
          </tr>
        </thead>
        <tbody>
          {coins.map(({ l, p }) => (
            <tr key={l.key}>
              <td><Select variant="borderless" className="w-full" disabled={readOnly} value={l.item_id ?? undefined} options={coinOptions} onChange={(v) => onChange(l.key, { item_id: v, gram_price: null })} aria-label="نوع سکه" /></td>
              <td><NumberInput variant="borderless" disabled={readOnly} value={l.qty} suffix={<span>عدد</span>} onChange={(v) => onChange(l.key, { qty: v })} /></td>
              <td><MoneyInput variant="borderless" disabled={readOnly} value={l.gram_price} placeholder={p.gram_price ? formatNumber(p.gram_price) : "قیمت"} onChange={(v) => onChange(l.key, { gram_price: v })} /></td>
              <td><MoneyInput variant="borderless" disabled={readOnly} value={l.discount} placeholder="—" onChange={(v) => onChange(l.key, { discount: v })} /></td>
              <td className="sf-gn"><Money v={p.total} />{reason(l, p)}</td>
              {x(l.key)}
            </tr>
          ))}
          {bars.map(({ l, p }) => (
            <tr key={l.key}>
              <td>
                <Select variant="borderless" className="w-full" disabled={readOnly} value={l.item_id ?? undefined} options={models} onChange={(v) => onChange(l.key, { item_id: v })} aria-label="مدل شمش" />
                <div className="flex gap-1 px-2 pb-1">
                  <Input size="small" disabled={readOnly} placeholder="برند" value={l.brand ?? ""} onChange={(e) => onChange(l.key, { brand: e.target.value })} />
                  <Input size="small" dir="ltr" disabled={readOnly} placeholder="سریال" value={l.serial_no ?? ""} onChange={(e) => onChange(l.key, { serial_no: e.target.value })} />
                  <Select size="small" className="!w-28 shrink-0" disabled={readOnly} value={l.seal_status ?? "sealed"} options={Object.entries(SEAL_TITLES).map(([value, label]) => ({ value, label }))} onChange={(v) => onChange(l.key, { seal_status: v })} aria-label="پلمپ" />
                </div>
              </td>
              <td>
                <WeightInput variant="borderless" disabled={readOnly} value={l.weight} onChange={(v) => onChange(l.key, { weight: v })} />
                <NumberInput variant="borderless" decimals={1} disabled={readOnly} value={l.fineness} onChange={(v) => onChange(l.key, { fineness: v })} aria-label="عیار" />
              </td>
              <td><MoneyInput variant="borderless" disabled={readOnly} value={l.unit_price} placeholder="به نرخ روز" onChange={(v) => onChange(l.key, { unit_price: v })} /></td>
              <td><MoneyInput variant="borderless" disabled={readOnly} value={l.discount} placeholder="—" onChange={(v) => onChange(l.key, { discount: v })} /></td>
              <td className="sf-gn"><Money v={p.total} />{!D(p.discount).isZero() && !D(l.discount ?? 0).gt(0) ? <span className="sf-gsub !px-0">کارمزد <Money v={p.discount} /></span> : reason(l, p)}</td>
              {x(l.key)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SaleLine({ l, p, breakdown, readOnly, coins, prod, defaultProfit, onChange, onRemove }: {
  l: SLine;
  p: PricedLine;
  breakdown?: boolean;
  readOnly: boolean;
  coins: { id: string; name: string; price: string | null; fineness: string | null; qty: string }[];
  prod?: CatalogueRow;
  defaultProfit: unknown;
  onChange: (patch: Partial<SLine>) => void;
  onRemove: () => void;
}) {
  const piece = l.kind === "piece";
  const coin = l.kind === "coin";
  const bar = l.kind === "bar";
  const byWeight = coin && prod?.gold_meta.pricing_mode === "weight";
  const wage = (
    <div className="sf-field is-wide">
      <div className="sf-field-l">اجرت ساخت</div>
      <div className="flex gap-1.5">
        <Select className="!w-[92px] shrink-0" disabled={readOnly} value={l.wage_type ?? "percent"} options={wageTypeOptions} onChange={(v) => onChange({ wage_type: v })} aria-label="نوع اجرت" />
        <NumberInput decimals={l.wage_type === "percent" || !l.wage_type ? 3 : 0} disabled={readOnly} value={l.wage_value} suffix={l.wage_type === "percent" || !l.wage_type ? <span>٪</span> : undefined} onChange={(v) => onChange({ wage_value: v })} />
      </div>
    </div>
  );
  return (
    <div className="sf-gline">
      <div className="sf-gline-h">
        <KaratAvatar kind={l.kind} fineness={p.fineness} />
        <div className="sf-gline-t">
          {coin ? (
            <Select
              className="max-w-[360px]"
              disabled={readOnly}
              value={l.item_id ?? undefined}
              placeholder="نوع سکه"
              options={coins.map((c) => ({ value: c.id, label: `${c.name} (${faDigits(D(c.qty).toString())} عدد)`, disabled: !D(c.qty).gt(0) && c.id !== l.item_id }))}
              onChange={(v) => {
                const c = coins.find((x) => x.id === v);
                onChange({ item_id: v, title: c?.name ?? null, gram_price: null, wage_type: null, wage_value: null, profit_pct: null, fineness: c?.fineness ?? "900" });
              }}
              aria-label="نوع سکه"
            />
          ) : bar ? (
            <>
              <b>{l.title ?? "شمش"}</b>
              <span>
                <span>شمش <span className="sf-docno">{faDigits(l.bar_no ?? "")}</span></span>
                {l.serial_no ? <><span className="sf-sep" aria-hidden /><bdi dir="ltr">{l.serial_no}</bdi></> : null}
                {l.brand ? <><span className="sf-sep" aria-hidden /><span>{l.brand}</span></> : null}
                {l.seal_status && l.seal_status !== "sealed" ? <><span className="sf-sep" aria-hidden /><Chip tone="neutral">{SEAL_TITLES[l.seal_status as keyof typeof SEAL_TITLES]}</Chip></> : null}
                {l.ownership === "consignment" ? <><span className="sf-sep" aria-hidden /><Chip tone="neutral">امانی</Chip></> : null}
              </span>
            </>
          ) : piece ? (
            <>
              <b>{l.title}</b>
              <span>
                <span>اتیکت <span className="sf-docno">{faDigits(l.tag_no ?? "")}</span></span>
                {l.category_name ? <><span className="sf-sep" aria-hidden /><span>{l.category_name}</span></> : null}
                {l.ownership === "consignment" ? <><span className="sf-sep" aria-hidden /><Chip tone="neutral">امانی</Chip></> : null}
              </span>
            </>
          ) : (
            <div className="flex gap-1.5">
              <Select className="!w-32 shrink-0" disabled={readOnly} value={l.form ?? "bullion"} options={formOptions} onChange={(v) => onChange({ form: v })} aria-label="نوع طلا" />
              <Input disabled={readOnly} value={l.title ?? ""} placeholder="شرح (اختیاری)" onChange={(e) => onChange({ title: e.target.value })} />
            </div>
          )}
        </div>
        <div className="sf-gline-sum">
          <small>جمع</small>
          <b><Money v={p.total} zero="—" /></b>
        </div>
        {!readOnly ? (
          <Tooltip title="حذف از فاکتور">
            <Button className="sf-gline-x" type="text" size="small" icon={<Ic icon={X} />} tabIndex={-1} onClick={onRemove} aria-label="حذف قلم" />
          </Tooltip>
        ) : null}
      </div>

      <div className="sf-gline-f">
        {coin ? (
          <>
            <div className="sf-field">
              <div className="sf-field-l">تعداد</div>
              <NumberInput disabled={readOnly} value={l.qty} suffix={<span>عدد</span>} onChange={(v) => onChange({ qty: v })} />
              {prod ? <div className="sf-field-h">{gw(D(prod.gold_weight ?? 0).times(D(l.qty || 0)).toString())} گرم · {faDigits(D(prod.fineness ?? 900).toString())}</div> : null}
            </div>
            {byWeight ? (
              <>
                {wage}
                <div className="sf-field">
                  <div className="sf-field-l">سود فروشنده</div>
                  <PctInput disabled={readOnly} value={l.profit_pct} placeholder={faDigits(prod?.gold_meta.profit_pct ?? "0")} onChange={(v) => onChange({ profit_pct: v })} />
                </div>
              </>
            ) : (
              <div className="sf-field is-wide">
                <div className="sf-field-l">قیمت هر سکه</div>
                <MoneyInput disabled={readOnly} value={l.gram_price} placeholder={p.gram_price ? formatNumber(p.gram_price) : "قیمت هر سکه"} onChange={(v) => onChange({ gram_price: v })} />
                {prod && variantChips(prod.gold_meta).length ? <div className="sf-field-h">{variantChips(prod.gold_meta).join(" · ")}</div> : null}
              </div>
            )}
            <div className="sf-field">
              <div className="sf-field-l">تخفیف</div>
              <MoneyInput disabled={readOnly} value={l.discount} placeholder="—" onChange={(v) => onChange({ discount: v })} />
            </div>
          </>
        ) : bar ? (
          <>
            <div className="sf-field">
              <div className="sf-field-l">وزن</div>
              <div className="sf-gline-ro"><Weight v={l.weight ?? 0} unit={false} /><span className="sf-unit">گرم</span></div>
            </div>
            <div className="sf-field">
              <div className="sf-field-l">عیار</div>
              <div className="sf-gline-ro"><span>{faDigits(D(l.fineness ?? 0).toString())}</span><span className="sf-unit">در هزار</span></div>
            </div>
            <div className="sf-field is-wide">
              <div className="sf-field-l">حق ضرب / کارمزد</div>
              <div className="flex gap-1.5">
                <Select className="!w-[92px] shrink-0" disabled={readOnly} value={l.wage_type ?? undefined} placeholder="پیش‌فرض" options={wageTypeOptions} onChange={(v) => onChange({ wage_type: v })} aria-label="نوع حق ضرب" />
                <NumberInput decimals={3} disabled={readOnly} value={l.wage_value} placeholder={D(p.wage).isZero() ? "—" : formatNumber(p.wage)} onChange={(v) => onChange({ wage_value: v })} />
              </div>
            </div>
            <div className="sf-field">
              <div className="sf-field-l">تخفیف</div>
              <MoneyInput disabled={readOnly} value={l.discount} placeholder="—" onChange={(v) => onChange({ discount: v })} />
            </div>
          </>
        ) : (
          <>
            <div className="sf-field">
              <div className="sf-field-l">وزن</div>
              {piece ? (
                <div className="sf-gline-ro">
                  <Weight v={p.weight} unit={false} />
                  <span className="sf-unit">گرم</span>
                </div>
              ) : (
                <WeightInput disabled={readOnly} value={l.weight} onChange={(v) => onChange({ weight: v })} />
              )}
              {piece && !D(l.stone_weight ?? 0).isZero() ? <div className="sf-field-h">سنگ <Weight v={l.stone_weight ?? 0} unit={false} /> گرم</div> : null}
            </div>
            <div className={`sf-field ${piece ? "" : "is-wide"}`}>
              <div className="sf-field-l">عیار</div>
              {piece ? (
                <div className="sf-gline-ro"><span>{faDigits(D(p.fineness).toString())}</span><span className="sf-unit">در هزار</span></div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <KaratSeg value={l.fineness} disabled={readOnly} onChange={(v) => onChange({ fineness: v })} />
                  <div className="w-[84px] shrink-0">
                    <NumberInput decimals={1} disabled={readOnly} value={l.fineness} onChange={(v) => onChange({ fineness: v })} aria-label="عیار در هزار" />
                  </div>
                </div>
              )}
            </div>
            {wage}
            <div className="sf-field">
              <div className="sf-field-l">سود فروشنده</div>
              <PctInput disabled={readOnly} value={l.profit_pct} placeholder={piece ? faDigits(String(defaultProfit ?? "")) : "—"} onChange={(v) => onChange({ profit_pct: v })} />
            </div>
            <div className="sf-field">
              <div className="sf-field-l">تخفیف</div>
              <MoneyInput disabled={readOnly} value={l.discount} placeholder="—" onChange={(v) => onChange({ discount: v })} />
            </div>
            <div className="sf-field">
              <div className="sf-field-l">سنگ و جواهر</div>
              <MoneyInput disabled={readOnly} value={l.stone} placeholder="—" onChange={(v) => onChange({ stone: v })} />
            </div>
          </>
        )}
      </div>

      {(byWeight || bar) && !D(p.total).isZero() ? (
        <div className="sf-gline-why">
          <span>ارزش طلا <span className="n"><Money v={p.gold_value} zero="—" /></span></span>
          <span className="sf-sep" aria-hidden />
          <span>{bar ? "حق ضرب" : "اجرت"} <span className="n"><Money v={p.wage} zero="—" /></span></span>
          {!D(p.profit).isZero() ? <><span className="sf-sep" aria-hidden /><span>سود <span className="n"><Money v={p.profit} /></span></span></> : null}
          <span className="sf-sep" aria-hidden />
          <span>مالیات <span className="n"><Money v={p.tax} zero="—" /></span></span>
        </div>
      ) : null}
      {!coin && !bar && breakdown ? (
        <div className="sf-gline-why">
          <span>ارزش طلا <span className="n"><Money v={p.gold_value} zero="—" /></span></span>
          <span className="sf-sep" aria-hidden />
          <span>اجرت <span className="n"><Money v={p.wage} zero="—" /></span></span>
          <span className="sf-sep" aria-hidden />
          <span>سود <span className="n"><Money v={p.profit} zero="—" /></span></span>
          <span className="sf-sep" aria-hidden />
          <span>مالیات <span className="n"><Money v={p.tax} zero="—" /></span></span>
        </div>
      ) : null}
    </div>
  );
}
