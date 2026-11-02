// Counter sale (فروش طلا — صندوق): a POS-like screen. Scan a tag (or pick a piece), add weighed
// gold and coins, take the customer's used gold in trade, split the payment between cash,
// card and bank (the rest on the customer's account), save with F2 and print an A5 invoice
// or an 80 mm receipt. Prices are computed live with the same module the server posts with.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, Select, Spin, Tag, Tooltip, type InputRef } from "antd";
import {
  BarcodeOutlined, DeleteOutlined, PlusOutlined, PrinterOutlined, SaveOutlined, ReloadOutlined, FileAddOutlined, EditOutlined,
  CheckCircleOutlined, StopOutlined, UserOutlined,
} from "@ant-design/icons";
import { useOrg } from "../../lib/org";
import { useHotkey, useNotify } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { PageHeader } from "../../components/layout";
import { DateInput, MoneyInput, NumberInput, PartySelect, PctInput, RefSelect, WeightInput } from "../../components/inputs";
import { Money } from "../../components/display";
import { D } from "@shared/money";
import { faDigits, formatNumber, formatWeight } from "@shared/format";
import { gram18FromMazaneh, mazanehFromGram18 } from "@shared/gold";
import { amountToWords } from "@shared/words";
import { todayISO } from "@shared/jalali";
import { uuidv7 } from "@shared/id";
import {
  docTotals, envOf, priceLine, RateChange, RateStamp, settleSplit, StatusOf, useCoins, useGoldSettings, useLatestRate,
  wageTypeOptions, formOptions, type LineIn, type PricedLine,
} from "./shared";
import { PrintArea, printSheet, type PrintFormat } from "./Invoice";

interface SLine {
  key: string;
  kind: "piece" | "bulk" | "coin" | "old";
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
  const scanRef = useRef<InputRef>(null);

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
  const doc = saved ?? existing.data ?? null;

  // the rate board's price for a new sale
  useEffect(() => {
    if (id || gram18 || !latest.data?.rate) return;
    const r = latest.data.rate;
    setGram18(r.gram18);
    setMazaneh(r.mazaneh);
    setBuyPrice(r.buy_gram18 ?? r.gram18);
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
        profit_pct: l.profit_pct, stone: l.stone, discount: D(l.discount).isZero() || l.kind === "old" ? null : l.discount, deduction_pct: l.deduction_pct,
      })),
    );
    setLocked(d.status !== "draft");
  }, [existing.data]);

  const env = useMemo(() => envOf(settings.data, org.money_decimals, gram18 ?? 0, mazaneh), [settings.data, org.money_decimals, gram18, mazaneh]);
  const lineIn = (l: SLine): LineIn => ({
    kind: l.kind, direction: l.direction, form: l.form, qty: l.qty, fineness: l.fineness, weight: l.weight,
    gram_price: l.kind === "old" ? l.gram_price ?? buyPrice : l.gram_price, wage_type: l.wage_type, wage_value: l.wage_value,
    profit_pct: l.profit_pct, stone: l.stone, discount: l.discount, deduction_pct: l.deduction_pct,
  });
  const priced = useMemo(() => lines.map((l) => ({ l, p: priceLine("sale", lineIn(l), env) })), [lines, env, buyPrice]); // eslint-disable-line react-hooks/exhaustive-deps
  const totals = useMemo(() => docTotals("sale", priced.map(({ l, p }) => ({ ...p, kind: l.kind, direction: l.direction }))), [priced]);
  const split = settleSplit(totals.net, { cash: { amount: cash.amount }, pos: { amount: pos.amount }, bank: { amount: bank.amount } });
  const remaining = D(split.remaining);
  const outLines = priced.filter(({ l }) => l.direction === "out");
  const oldLines = priced.filter(({ l }) => l.kind === "old");
  const readOnly = locked || !can("gold", "edit");

  const set = (key: string, patch: Partial<SLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));
  const focusScan = () => setTimeout(() => scanRef.current?.focus(), 30);

  const addTag = async (raw: string) => {
    const t = raw.trim();
    if (!t || readOnly) return;
    setScanning(true);
    try {
      const r = await api.get(`/gold/items/by-tag/${encodeURIComponent(t)}`, { gram18 });
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
          profit_pct: x.profit_pct, stone: x.stone,
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
    setLines((ls) => [...ls, { key: uuidv7(), kind: "coin", direction: "out", item_id: c?.id ?? null, title: c?.name ?? null, qty: "1", gram_price: c?.price ?? null, fineness: c?.fineness ?? "900" }]);
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
      return {
        kind: l.kind, direction: l.direction, gold_item_id: l.gold_item_id ?? null, item_id: l.item_id ?? null, title: l.kind === "piece" ? null : l.title ?? null,
        form: l.kind === "bulk" ? l.form : null, qty: l.kind === "coin" ? l.qty : null, fineness: l.kind === "piece" ? null : l.fineness, weight: l.kind === "piece" || l.kind === "coin" ? null : l.weight,
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
    if (status === "posted" && !remaining.isZero() && !partyId) return n.warn("برای فروش نسیه، مشتری را انتخاب کنید یا مبلغ را کامل دریافت کنید");
    setSaving(true);
    try {
      const r = id ? await api.put(`/gold/docs/${id}`, payload(status)) : await api.post("/gold/docs", payload(status));
      n.ok(status === "draft" ? "پیش‌نویس ذخیره شد" : `فاکتور شماره‌ی ${faDigits(r.doc.no)} ثبت شد`);
      qc.invalidateQueries({ queryKey: ["table"] });
      qc.invalidateQueries({ queryKey: ["gold-summary"] });
      qc.invalidateQueries({ queryKey: ["gold-coins"] });
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
  useHotkey("f4", () => focusScan(), []);
  useHotkey("f9", () => print(format), [doc, format]);

  if (id && existing.isLoading) return <div className="grid h-64 place-content-center"><Spin /></div>;
  if (id && existing.error) return <Alert type="error" title={errorText(existing.error)} />;

  const g18Missing = !gram18 && lines.some((l) => l.kind !== "coin");
  return (
    <div>
      <PageHeader
        back={`/${orgId}/gold/docs?kind=sale`}
        title={doc ? `فاکتور فروش طلا شماره‌ی ${faDigits(doc.no)}` : "فروش طلا (صندوق)"}
        subtitle={doc ? null : "F4: اسکن اتیکت، F2: ثبت فاکتور، F9: چاپ"}
        extra={doc ? <StatusOf s={doc.status} /> : null}
        actions={
          <>
            {doc ? (
              <>
                <Button icon={<PrinterOutlined />} onClick={() => print("a5")}>فاکتور A5</Button>
                <Button icon={<PrinterOutlined />} onClick={() => print("receipt")}>رسید ۸۰ میلی‌متری</Button>
                {locked && can("gold", "edit") && doc.status === "posted" ? <Button icon={<EditOutlined />} onClick={() => setLocked(false)}>ویرایش</Button> : null}
                {doc.status === "posted" && can("gold", "edit") ? <Button danger icon={<StopOutlined />} onClick={() => action("cancel")}>ابطال</Button> : null}
                {doc.status !== "posted" && can("gold", "edit") ? <Button icon={<CheckCircleOutlined />} onClick={() => action("post")}>ثبت قطعی</Button> : null}
                <Button type="primary" icon={<FileAddOutlined />} onClick={() => nav(`/${orgId}/gold/sale/new`)}>فروش جدید</Button>
              </>
            ) : null}
            {!readOnly ? (
              <>
                {!doc || doc.status === "draft" ? <Button onClick={() => save("draft")} disabled={saving}>پیش‌نویس</Button> : null}
                <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => save("posted")}>
                  ثبت فاکتور <span className="tz-kbd ltr ms-1 !bg-transparent !text-white/80">F2</span>
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <div className="no-print">
        {doc?.voucher ? (
          <div className="mb-3 text-xs text-muted">
            سند حسابداری شماره‌ی <a onClick={() => nav(`/${orgId}/accounting/vouchers/${doc.voucher.id}`)} className="num">{faDigits(doc.voucher.no)}</a>
            {doc.created_by_name ? <>، ثبت‌کننده: {doc.created_by_name}</> : null}
          </div>
        ) : null}
        {doc?.status === "cancelled" ? <Alert className="!mb-3" type="error" showIcon title="این فاکتور باطل شده است." /> : null}
        {locked && doc?.status === "posted" ? <Alert className="!mb-3" type="success" showIcon title="فاکتور ثبت شده است؛ برای تغییر «ویرایش» را بزنید (سند حسابداری همان سند به‌روز می‌شود)." /> : null}

        {/* rate strip */}
        <div className="mb-3 grid gap-3 rounded-xl border border-line bg-gold-soft p-3 md:grid-cols-[1.2fr_1fr_1fr_1.4fr]">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs text-muted">
              هر گرم ۱۸ عیار (این فاکتور)
              <RateChange change={latest.data?.change} pct={latest.data?.change_pct} />
            </div>
            <MoneyInput size="large" value={gram18} disabled={readOnly} status={g18Missing ? "error" : undefined} className="!text-xl !font-extrabold" onChange={(v) => { setGram18(v); setMazaneh(v ? mazanehFromGram18(v) : null); }} />
          </div>
          <div>
            <div className="mb-1 text-xs text-muted">مظنه</div>
            <MoneyInput size="large" value={mazaneh} disabled={readOnly} onChange={(v) => { setMazaneh(v); setGram18(v ? gram18FromMazaneh(v) : null); }} />
          </div>
          <div>
            <div className="mb-1 text-xs text-muted">خرید طلای کهنه (گرم ۱۸)</div>
            <MoneyInput size="large" value={buyPrice} disabled={readOnly} onChange={setBuyPrice} />
          </div>
          <div className="flex flex-col justify-between gap-1">
            <div className="flex flex-wrap gap-1">
              {(coins.data ?? []).filter((c) => c.price).map((c) => (
                <Tag key={c.id} variant="filled" className="!m-0 num">{c.name.replace("سکه ", "")}: {formatNumber(c.price!)}</Tag>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <RateStamp rate={latest.data?.rate} />
              {!readOnly ? (
                <Tooltip title="قیمت آخرین تابلو">
                  <Button
                    size="small"
                    type="text"
                    icon={<ReloadOutlined />}
                    onClick={() => {
                      const r = latest.data?.rate;
                      if (!r) return n.warn("قیمتی در تابلو ثبت نشده است");
                      setGram18(r.gram18);
                      setMazaneh(r.mazaneh);
                      setBuyPrice(r.buy_gram18 ?? r.gram18);
                    }}
                  />
                </Tooltip>
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid gap-3 min-[106rem]:grid-cols-[1fr_360px]">
          <div className="min-w-0">
            {/* scanner */}
            {!readOnly ? (
              <div className="tz-card mb-3 flex flex-wrap items-center gap-2 p-3">
                <Input
                  ref={scanRef}
                  autoFocus
                  size="large"
                  className="!max-w-sm num"
                  dir="ltr"
                  prefix={<BarcodeOutlined className="text-gold" />}
                  suffix={scanning ? <Spin size="small" /> : null}
                  placeholder="اسکن یا شماره‌ی اتیکت + Enter"
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  onPressEnter={() => addTag(tag)}
                />
                <RefSelect
                  entity="gold_item"
                  filters={{ status: "in_stock" }}
                  value={null}
                  placeholder="جستجوی جنس (نام یا اتیکت)…"
                  className="!w-64"
                  popupWidth={360}
                  onChange={(_, o) => o?.sub && addTag(String(o.sub))}
                />
                <div className="flex gap-1">
                  <Button icon={<PlusOutlined />} onClick={addBulk}>طلای وزنی</Button>
                  <Button icon={<PlusOutlined />} onClick={addCoin}>سکه</Button>
                </div>
                <div className="ms-auto text-end">
                  <div className="text-[11px] text-muted">{D(totals.net).isNeg() ? "قابل پرداخت به مشتری" : "قابل دریافت"}</div>
                  <div className="num text-xl font-extrabold text-gold">{formatNumber(D(totals.net).abs(), { dp: org.money_decimals })}</div>
                </div>
              </div>
            ) : null}

            {/* sold lines */}
            <div className="tz-card mb-3 overflow-x-auto">
              <table className="tz-grid min-w-[980px]">
                <thead>
                  <tr>
                    <th className="w-8">#</th>
                    <th className="min-w-[180px]">شرح</th>
                    <th className="w-[74px]">عیار</th>
                    <th className="w-[96px]">وزن (گرم)</th>
                    <th className="min-w-[110px]">ارزش طلا</th>
                    <th className="min-w-[170px]">اجرت</th>
                    <th className="min-w-[120px]">سود</th>
                    <th className="min-w-[110px]">تخفیف</th>
                    <th className="min-w-[96px]">مالیات</th>
                    <th className="min-w-[96px]">سنگ</th>
                    <th className="min-w-[120px]">جمع</th>
                    {!readOnly ? <th className="w-8" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {outLines.map(({ l, p }, i) => (
                    <SaleRow key={l.key} i={i} l={l} p={p} readOnly={readOnly} coins={coins.data ?? []} defaultProfit={env.profitPct} onChange={(patch) => set(l.key, patch)} onRemove={() => remove(l.key)} />
                  ))}
                  {!outLines.length ? (
                    <tr>
                      <td colSpan={12} className="py-10 text-center text-sm text-muted">
                        <BarcodeOutlined className="me-1 text-gold" /> اتیکت جنس را اسکن کنید تا به فاکتور اضافه شود
                      </td>
                    </tr>
                  ) : null}
                </tbody>
                {outLines.length ? (
                  <tfoot>
                    <tr>
                      <td colSpan={3}>جمع ({faDigits(outLines.length)} ردیف)</td>
                      <td><span className="num">{formatWeight(outLines.filter(({ l }) => l.kind !== "coin").reduce((a, { p }) => a.plus(D(p.weight)), D(0)))}</span></td>
                      <td><Money v={totals.gold_value} /></td>
                      <td><Money v={totals.wage} /></td>
                      <td><Money v={totals.profit} /></td>
                      <td><Money v={totals.discount} zero="—" /></td>
                      <td><Money v={totals.tax} /></td>
                      <td><Money v={totals.stone} zero="—" /></td>
                      <td><Money v={totals.total} /></td>
                      {!readOnly ? <td /> : null}
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>

            {/* trade-in */}
            <div className="tz-card p-3">
              <div className="mb-2 flex items-center gap-2">
                <div className="text-sm font-bold">طلای مستعمل مشتری (تعویض)</div>
                <span className="text-xs text-muted">بخشی از پرداخت؛ به موجودی طلای مستعمل می‌رود</span>
                {!readOnly ? <Button size="small" className="ms-auto" icon={<PlusOutlined />} onClick={addOld}>طلای مستعمل</Button> : null}
              </div>
              {oldLines.length ? (
                <table className="tz-grid">
                  <thead>
                    <tr>
                      <th>شرح</th>
                      <th className="w-[110px]">وزن (گرم)</th>
                      <th className="w-[90px]">عیار</th>
                      <th className="w-[90px]">کسر ٪</th>
                      <th className="w-[150px]">قیمت گرم ۱۸</th>
                      <th className="w-[90px]">معادل ۷۵۰</th>
                      <th className="w-[130px]">ارزش</th>
                      {!readOnly ? <th className="w-8" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {oldLines.map(({ l, p }) => (
                      <tr key={l.key}>
                        <td><Input variant="borderless" disabled={readOnly} value={l.title ?? ""} placeholder="طلای مستعمل" onChange={(e) => set(l.key, { title: e.target.value })} /></td>
                        <td><WeightInput variant="borderless" disabled={readOnly} value={l.weight} onChange={(v) => set(l.key, { weight: v })} /></td>
                        <td><NumberInput variant="borderless" decimals={1} disabled={readOnly} value={l.fineness} onChange={(v) => set(l.key, { fineness: v })} /></td>
                        <td><PctInput variant="borderless" disabled={readOnly} value={l.deduction_pct} onChange={(v) => set(l.key, { deduction_pct: v })} /></td>
                        <td><MoneyInput variant="borderless" disabled={readOnly} value={l.gram_price} placeholder={buyPrice ? formatNumber(buyPrice) : ""} onChange={(v) => set(l.key, { gram_price: v })} /></td>
                        <td className="num text-center">{formatWeight(p.weight750)}</td>
                        <td>
                          <Money v={p.total} />
                          {!D(p.discount).isZero() ? <div className="text-[10px] text-muted">کسر: <Money v={p.discount} /></div> : null}
                        </td>
                        {!readOnly ? <td><Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => remove(l.key)} aria-label="حذف" /></td> : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="py-2 text-xs text-muted">مشتری طلای کهنه برای تعویض ندارد.</div>
              )}
            </div>
          </div>

          {/* side: customer, totals, payment (under the lines on narrower screens) */}
          <div className="grid content-start gap-3 lg:grid-cols-3 min-[106rem]:grid-cols-1">
            <div className="tz-card p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-bold"><UserOutlined /> مشتری</div>
              <PartySelect role="customer" value={partyId} disabled={readOnly} allowClear placeholder="مشتری گذری (خالی) یا جستجوی مشتری…" onChange={(v) => setPartyId(v)} className="w-full" />
              {!partyId ? (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Input size="small" disabled={readOnly} placeholder="نام خریدار" value={buyer.name ?? ""} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} />
                  <Input size="small" disabled={readOnly} placeholder="موبایل" dir="ltr" value={buyer.mobile ?? ""} onChange={(e) => setBuyer({ ...buyer, mobile: e.target.value })} />
                  <Input size="small" disabled={readOnly} placeholder="کد ملی" dir="ltr" value={buyer.national_id ?? ""} onChange={(e) => setBuyer({ ...buyer, national_id: e.target.value })} />
                  <DateInput size="small" value={date} disabled={readOnly} onChange={setDate} />
                </div>
              ) : (
                <div className="mt-2"><DateInput size="small" value={date} disabled={readOnly} onChange={setDate} /></div>
              )}
            </div>

            <div className="tz-card p-3">
              <TotalRow k="ارزش طلا" v={totals.gold_value} />
              <TotalRow k="اجرت ساخت" v={totals.wage} />
              <TotalRow k="سود فروشنده" v={totals.profit} />
              {!D(totals.discount).isZero() ? <TotalRow k="تخفیف" v={totals.discount} neg /> : null}
              <TotalRow k={`مالیات (${faDigits(env.taxPct as string)}٪ اجرت و سود)`} v={totals.tax} />
              {!D(totals.stone).isZero() ? <TotalRow k="سنگ و جواهر" v={totals.stone} /> : null}
              {!D(totals.coins).isZero() ? <TotalRow k="سکه" v={totals.coins} /> : null}
              <div className="my-2 border-t border-line" />
              <TotalRow k="جمع فاکتور" v={totals.total} strong />
              {!D(totals.old_value).isZero() ? <TotalRow k={`طلای مستعمل (${formatWeight(totals.weight_in)} گرم ۷۵۰)`} v={totals.old_value} neg /> : null}
              <div className="mt-2 rounded-lg bg-gold-soft p-3 text-center">
                <div className="text-xs text-muted">{D(totals.net).isNeg() ? "قابل پرداخت به مشتری" : "قابل دریافت از مشتری"}</div>
                <div className="num text-2xl font-extrabold text-gold">{formatNumber(D(totals.net).abs(), { dp: org.money_decimals })}</div>
                <div className="text-[11px] leading-4 text-muted">{D(totals.net).isZero() ? "" : amountToWords(D(totals.net).abs(), unit)}</div>
              </div>
              <div className="mt-2 text-[11px] text-muted">
                وزن فروش: <span className="num">{formatWeight(totals.weight_out)}</span> گرم ۷۵۰، {faDigits(totals.pieces)} جنس
              </div>
            </div>

            <div className="tz-card p-3">
              <div className="mb-2 text-sm font-bold">{D(totals.net).isNeg() ? "پرداخت به مشتری" : "دریافت"}</div>
              <PayRow label="نقد" entity="cash_box" pay={cash} setPay={setCash} readOnly={readOnly} onRest={() => fillRest("cash")} />
              {!D(totals.net).isNeg() ? <PayRow label="کارتخوان" entity="pos_terminal" pay={pos} setPay={setPos} readOnly={readOnly} onRest={() => fillRest("pos")} /> : null}
              <PayRow label="واریز" entity="bank_account" pay={bank} setPay={setBank} readOnly={readOnly} onRest={() => fillRest("bank")} withRef />
              <div className={`mt-2 flex items-center justify-between rounded-lg px-3 py-2 text-sm ${remaining.isNeg() ? "bg-[color-mix(in_srgb,var(--tz-danger)_12%,transparent)] text-bad" : remaining.isZero() ? "bg-[color-mix(in_srgb,var(--tz-success)_12%,transparent)] text-ok" : "bg-surface-2"}`}>
                <span>{remaining.isNeg() ? "بیش از مبلغ فاکتور" : remaining.isZero() ? "تسویه کامل" : partyId ? "مانده به حساب مشتری (نسیه)" : "مانده — مشتری را انتخاب کنید"}</span>
                <b className="num">{formatNumber(remaining.abs(), { dp: org.money_decimals })}</b>
              </div>
              <Input.TextArea className="!mt-2" autoSize={{ minRows: 1, maxRows: 3 }} disabled={readOnly} placeholder="توضیحات فاکتور" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
        </div>
      </div>
      <PrintArea doc={doc} format={format} />
    </div>
  );
}

function TotalRow({ k, v, strong, neg }: { k: string; v: string; strong?: boolean; neg?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-0.5 ${strong ? "text-base font-extrabold" : "text-sm"}`}>
      <span className={strong ? "" : "text-muted"}>{k}</span>
      <span className={neg ? "text-bad" : ""}>{neg ? "−" : ""}<Money v={v} /></span>
    </div>
  );
}

function PayRow({ label, entity, pay, setPay, readOnly, onRest, withRef }: { label: string; entity: string; pay: Pay; setPay: (m: Pay) => void; readOnly: boolean; onRest: () => void; withRef?: boolean }) {
  return (
    <div className="mb-2">
      <div className="grid grid-cols-[64px_1fr_1fr_auto] items-center gap-1.5">
        <span className="text-xs text-muted">{label}</span>
        <RefSelect entity={entity} size="small" value={pay.id} disabled={readOnly} showCode={false} placeholder="انتخاب…" onChange={(v) => setPay({ ...pay, id: v })} />
        <MoneyInput size="small" value={pay.amount} disabled={readOnly} placeholder="۰" onChange={(v) => setPay({ ...pay, amount: v })} />
        <Tooltip title="باقی‌مانده با این روش">
          <Button size="small" disabled={readOnly} onClick={onRest}>همه</Button>
        </Tooltip>
      </div>
      {withRef && pay.amount ? (
        <Input size="small" className="!mt-1" dir="ltr" disabled={readOnly} placeholder="شماره‌ی پیگیری" value={pay.ref_no ?? ""} onChange={(e) => setPay({ ...pay, ref_no: e.target.value })} />
      ) : null}
    </div>
  );
}

function SaleRow({ i, l, p, readOnly, coins, defaultProfit, onChange, onRemove }: {
  i: number;
  l: SLine;
  p: PricedLine;
  readOnly: boolean;
  coins: { id: string; name: string; price: string | null; fineness: string | null; qty: string }[];
  defaultProfit: unknown;
  onChange: (patch: Partial<SLine>) => void;
  onRemove: () => void;
}) {
  const piece = l.kind === "piece";
  const coin = l.kind === "coin";
  return (
    <tr>
      <td className="num text-center text-xs text-muted">{faDigits(i + 1)}</td>
      <td>
        {coin ? (
          <Select
            variant="borderless"
            className="w-full"
            disabled={readOnly}
            value={l.item_id ?? undefined}
            placeholder="نوع سکه"
            options={coins.map((c) => ({ value: c.id, label: `${c.name} (${faDigits(D(c.qty).toString())} عدد)`, disabled: !D(c.qty).gt(0) && c.id !== l.item_id }))}
            onChange={(v) => {
              const c = coins.find((x) => x.id === v);
              onChange({ item_id: v, title: c?.name ?? null, gram_price: c?.price ?? l.gram_price, fineness: c?.fineness ?? "900" });
            }}
          />
        ) : piece ? (
          <div className="px-1 leading-5">
            <div className="font-semibold">{l.title}</div>
            <div className="text-[11px] text-muted">
              <span className="num">اتیکت {faDigits(l.tag_no ?? "")}</span>
              {l.category_name ? <>، {l.category_name}</> : null}
              {l.ownership === "consignment" ? <Tag color="purple" variant="filled" className="!ms-1 !me-0 !text-[10px]">امانی</Tag> : null}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <Select size="small" variant="borderless" className="!w-28" disabled={readOnly} value={l.form ?? "bullion"} options={formOptions} onChange={(v) => onChange({ form: v })} />
            <Input size="small" variant="borderless" disabled={readOnly} value={l.title ?? ""} placeholder="شرح" onChange={(e) => onChange({ title: e.target.value })} />
          </div>
        )}
      </td>
      <td className="text-center">
        {piece || coin ? <span className="num">{faDigits(D(p.fineness).toString())}</span> : <NumberInput variant="borderless" decimals={1} disabled={readOnly} value={l.fineness} onChange={(v) => onChange({ fineness: v })} />}
      </td>
      <td className="text-center">
        {piece ? (
          <div className="num leading-5">
            {formatWeight(p.weight)}
            {!D(l.stone_weight ?? 0).isZero() ? <div className="text-[10px] text-muted">سنگ {formatWeight(l.stone_weight)}</div> : null}
          </div>
        ) : coin ? (
          <NumberInput variant="borderless" disabled={readOnly} value={l.qty} suffix={<span className="text-[10px] text-muted">عدد</span>} onChange={(v) => onChange({ qty: v })} />
        ) : (
          <WeightInput variant="borderless" disabled={readOnly} value={l.weight} onChange={(v) => onChange({ weight: v })} />
        )}
      </td>
      <td>
        {coin ? (
          <MoneyInput variant="borderless" disabled={readOnly} value={l.gram_price} placeholder="قیمت هر سکه" onChange={(v) => onChange({ gram_price: v })} />
        ) : (
          <Money v={p.gold_value} />
        )}
      </td>
      <td>
        {coin ? (
          <span className="text-muted">—</span>
        ) : (
          <div>
            <div className="flex items-center gap-1">
              <Select size="small" variant="borderless" className="!w-[76px]" disabled={readOnly} value={l.wage_type ?? "percent"} options={wageTypeOptions} onChange={(v) => onChange({ wage_type: v })} />
              <NumberInput size="small" variant="borderless" decimals={l.wage_type === "percent" || !l.wage_type ? 3 : 0} disabled={readOnly} value={l.wage_value} onChange={(v) => onChange({ wage_value: v })} />
            </div>
            <div className="ps-2 text-[11px]"><Money v={p.wage} /></div>
          </div>
        )}
      </td>
      <td>
        {coin ? (
          <span className="text-muted">—</span>
        ) : (
          <div>
            <PctInput size="small" variant="borderless" disabled={readOnly} value={l.profit_pct} placeholder={piece ? faDigits(String(defaultProfit ?? "")) : "۰"} onChange={(v) => onChange({ profit_pct: v })} />
            <div className="ps-2 text-[11px]"><Money v={p.profit} /></div>
          </div>
        )}
      </td>
      <td><MoneyInput size="small" variant="borderless" disabled={readOnly} value={l.discount} placeholder="۰" onChange={(v) => onChange({ discount: v })} /></td>
      <td>{coin ? <span className="text-muted">—</span> : <Money v={p.tax} />}</td>
      <td>{coin ? <span className="text-muted">—</span> : <MoneyInput size="small" variant="borderless" disabled={readOnly} value={l.stone} placeholder="۰" onChange={(v) => onChange({ stone: v })} />}</td>
      <td><b><Money v={p.total} /></b></td>
      {!readOnly ? <td><Button type="text" size="small" danger icon={<DeleteOutlined />} tabIndex={-1} onClick={onRemove} aria-label="حذف ردیف" /></td> : null}
    </tr>
  );
}
