// Editor of the other gold documents: purchase from a wholesaler (rial or طلا به طلا), buy-back
// of used gold, consignment in / return, sending gold to a workshop and receiving the made
// pieces, melting with assay (ری‌گیری), bullion sale by mazaneh and opening stock. Lines are
// priced live with the server's pure pricing module; costs from the ledger are added on posting.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, Radio, Segmented, Select, type InputRef } from "antd";
import { Banknote, CreditCard, Landmark, Plus, ScanBarcode, X } from "lucide-react";
import { Ic } from "../../components/shell/icons";
import { useOrg } from "../../lib/org";
import { useHotkey, useNotify } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { PageHeader } from "../../components/layout";
import { DateInput, MoneyInput, NumberInput, PartySelect, PctInput, RefSelect, WeightInput } from "../../components/inputs";
import { Loader, Money } from "../../components/display";
import { D } from "@shared/money";
import { faDigits } from "@shared/format";
import { gram18FromMazaneh, mazanehFromGram18 } from "@shared/gold";
import { todayISO } from "@shared/jalali";
import { uuidv7 } from "@shared/id";
import { gw, KINDS, docTotals, envOf, priceLine, settleSplit, StatusOf, useCoins, useGoldSettings, useLatestRate, wageTypeOptions, formOptions, WBalance, type DocKind, type LineKind, type Direction, type LineIn, type PricedLine } from "./shared";

interface ELine {
  key: string;
  kind: LineKind;
  direction: Direction;
  gold_item_id?: string | null;
  item_id?: string | null;
  category_id?: string | null;
  title?: string | null;
  tag_no?: string | null;
  form?: string | null;
  qty?: string | null;
  fineness?: string | null;
  weight?: string | null;
  stone_weight?: string | null;
  gram_price?: string | null;
  wage_type?: string | null;
  wage_value?: string | null;
  stone?: string | null;
  deduction_pct?: string | null;
  cost?: string | null;
  assay_no?: string | null;
  sale_wage_type?: string | null;
  sale_wage_value?: string | null;
  stone_desc?: string | null;
  /** consigned pieces picked by tag: who owns them */
  supplier_id?: string | null;
}

interface SectionDef {
  title: string;
  kind: LineKind;
  direction: Direction;
  add: string;
}

const SECTIONS: Record<Exclude<DocKind, "sale">, SectionDef[]> = {
  purchase: [
    { title: "اجناس اتیکت‌دار", kind: "piece", direction: "in", add: "جنس" },
    { title: "طلای وزنی (آبشده / مستعمل)", kind: "bulk", direction: "in", add: "طلای وزنی" },
    { title: "سکه", kind: "coin", direction: "in", add: "سکه" },
  ],
  buyback: [{ title: "طلای مستعمل خریداری‌شده", kind: "old", direction: "in", add: "ردیف" }],
  consign_in: [{ title: "اجناس امانی دریافتی", kind: "piece", direction: "in", add: "جنس امانی" }],
  consign_return: [{ title: "اجناس امانی برگشتی", kind: "piece", direction: "out", add: "" }],
  workshop_out: [{ title: "طلای ارسالی به کارگاه", kind: "bulk", direction: "out", add: "ردیف" }],
  workshop_in: [
    { title: "مصنوعات ساخته‌شده", kind: "piece", direction: "in", add: "جنس" },
    { title: "طلای برگشتی (استفاده‌نشده)", kind: "bulk", direction: "in", add: "طلای برگشتی" },
  ],
  melt: [
    { title: "ورودی ذوب: طلای مستعمل / وزنی", kind: "bulk", direction: "out", add: "طلای ورودی" },
    { title: "ورودی ذوب: اجناس اتیکت‌دار", kind: "piece", direction: "out", add: "" },
    { title: "آبشده‌ی حاصل (ری‌گیری)", kind: "bulk", direction: "in", add: "آبشده" },
  ],
  bullion_sale: [{ title: "آبشده / طلای وزنی فروخته‌شده", kind: "bulk", direction: "out", add: "ردیف" }],
  opening: [
    { title: "اجناس اتیکت‌دار", kind: "piece", direction: "in", add: "جنس" },
    { title: "طلای وزنی", kind: "bulk", direction: "in", add: "طلای وزنی" },
    { title: "سکه", kind: "coin", direction: "in", add: "سکه" },
  ],
};

const WAGE_LABEL: Partial<Record<DocKind, string>> = { purchase: "اجرت خرید", consign_in: "اجرت همکار", workshop_in: "اجرت سازنده" };

function defaultForm(kind: DocKind, direction: Direction) {
  if (kind === "melt") return direction === "in" ? "bullion" : "old";
  if (kind === "workshop_out" || kind === "workshop_in") return "old";
  return "bullion";
}

export function DocEditorRoute({ kind }: { kind: Exclude<DocKind, "sale"> }) {
  const { id } = useParams();
  return <DocEditor key={`${kind}-${id ?? "new"}`} kind={kind} id={id && id !== "new" ? id : null} />;
}

function DocEditor({ kind, id }: { kind: Exclude<DocKind, "sale">; id: string | null }) {
  const { api, org, orgId, can } = useOrg();
  const nav = useNavigate();
  const qc = useQueryClient();
  const n = useNotify();
  const rule = KINDS[kind];
  const settings = useGoldSettings();
  const latest = useLatestRate();
  const coins = useCoins();
  const existing = useQuery({ queryKey: ["gold-doc", id], queryFn: () => api.get(`/gold/docs/${id}`).then((r) => r.doc), enabled: !!id });
  const boxes = useQuery({ queryKey: ["options", "cash_box", "", {}], queryFn: () => api.get("/data/cash_box/options").then((r) => r.options as any[]), staleTime: 60_000 });

  const [sp] = useSearchParams();
  const [date, setDate] = useState<string | null>(todayISO((org.settings?.timezone as string) || "Asia/Tehran"));
  const [partyId, setPartyId] = useState<string | null>(sp.get("party"));
  const [gram18, setGram18] = useState<string | null>(null);
  const [mazaneh, setMazaneh] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<"rial" | "weight">("rial");
  const [cash, setCash] = useState<{ id: string | null; amount: string | null }>({ id: null, amount: null });
  const [pos, setPos] = useState<{ id: string | null; amount: string | null }>({ id: null, amount: null });
  const [bank, setBank] = useState<{ id: string | null; amount: string | null; ref_no?: string }>({ id: null, amount: null });
  const [consumption, setConsumption] = useState<"returned" | "close" | "manual">("returned");
  const [consumed, setConsumed] = useState<string | null>(null);
  const [lines, setLines] = useState<ELine[]>([]);
  const [saving, setSaving] = useState(false);

  const partyBalances = useQuery({
    queryKey: ["gold-party-balances", orgId],
    queryFn: () => api.get("/gold/reports/parties").then((r) => r.rows as any[]),
    enabled: !!partyId && rule.party !== "none",
    staleTime: 15_000,
  });
  const pb = partyBalances.data?.find((r) => r.party_id === partyId);

  useEffect(() => {
    if (id || gram18 || !latest.data?.rate || rule.price === "none") return;
    setGram18(latest.data.rate.gram18);
    setMazaneh(latest.data.rate.mazaneh);
  }, [latest.data, id, gram18, rule.price]);
  useEffect(() => {
    if (!cash.id && boxes.data?.length) setCash((c) => ({ ...c, id: boxes.data![0].id }));
  }, [boxes.data, cash.id]);
  useEffect(() => {
    const d = existing.data;
    if (!d) return;
    setDate(d.date);
    setPartyId(d.party_id);
    setGram18(d.gram18);
    setMazaneh(d.mazaneh);
    setDescription(d.description ?? "");
    const s = d.settle ?? {};
    setMode(s.mode === "weight" ? "weight" : "rial");
    setCash({ id: s.cash?.cash_box_id ?? null, amount: s.cash?.amount ?? null });
    setPos({ id: s.pos?.pos_id ?? null, amount: s.pos?.amount ?? null });
    setBank({ id: s.bank?.bank_account_id ?? null, amount: s.bank?.amount ?? null, ref_no: s.bank?.ref_no ?? "" });
    setConsumption(s.close_workshop ? "close" : s.consumed_weight750 ? "manual" : "returned");
    setConsumed(s.consumed_weight750 ?? null);
    setLines(
      d.lines.map((l: any): ELine => ({
        key: l.id, kind: l.kind, direction: l.direction, gold_item_id: l.gold_item_id, item_id: l.item_id, category_id: l.category_id, title: l.title, tag_no: l.tag_no,
        form: l.form, qty: l.qty, fineness: l.fineness, weight: l.weight, stone_weight: l.stone_weight, gram_price: l.gram_price && l.gram_price !== d.gram18 ? l.gram_price : null,
        wage_type: l.wage_type, wage_value: l.wage_value, stone: D(l.stone).isZero() ? null : l.stone, deduction_pct: l.deduction_pct,
        cost: kind === "opening" ? l.cost : null, assay_no: l.assay_no, sale_wage_type: l.extra?.sale_wage_type ?? null, sale_wage_value: l.extra?.sale_wage_value ?? null,
        stone_desc: l.extra?.stone_desc ?? null, supplier_id: l.supplier_id ?? null,
      })),
    );
  }, [existing.data, kind]);

  const env = useMemo(() => envOf(settings.data, org.money_decimals, gram18 ?? 0, mazaneh), [settings.data, org.money_decimals, gram18, mazaneh]);
  const toIn = (l: ELine): LineIn => ({
    kind: l.kind, direction: l.direction, form: l.form, qty: l.qty, fineness: l.fineness, weight: l.weight, gram_price: l.gram_price,
    wage_type: l.wage_type, wage_value: l.wage_value, stone: l.stone, deduction_pct: l.deduction_pct, cost: l.cost,
  });
  const priced = useMemo(() => lines.map((l) => ({ l, p: priceLine(kind, toIn(l), env) })), [lines, env, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const totals = useMemo(() => docTotals(kind, priced.map(({ l, p }) => ({ ...p, kind: l.kind, direction: l.direction }))), [priced, kind]);
  // rial amount settled now (purchase by weight: only wage, stones, tax and coins)
  const due = useMemo(() => {
    if (kind === "purchase" && mode === "weight") return D(totals.total).minus(D(totals.gold_value)).toString();
    if (kind === "bullion_sale" && mode === "weight") return "0";
    if (rule.cash === "none") return "0";
    return totals.total;
  }, [kind, mode, totals, rule.cash]);
  const split = settleSplit(due, { cash: { amount: cash.amount }, pos: { amount: pos.amount }, bank: { amount: bank.amount } });
  const readOnly = !can("gold", "edit") || existing.data?.status === "cancelled";

  const set = (key: string, patch: Partial<ELine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));
  const add = (sec: SectionDef) =>
    setLines((ls) => [
      ...ls,
      {
        key: uuidv7(), kind: sec.kind, direction: sec.direction, fineness: sec.kind === "coin" ? "900" : "750",
        form: sec.kind === "bulk" ? defaultForm(kind, sec.direction) : null, qty: sec.kind === "coin" ? "1" : null,
        wage_type: sec.kind === "piece" ? "percent" : sec.kind === "bulk" ? "fixed" : null,
        deduction_pct: sec.kind === "old" ? settings.data?.old_deduction_pct ?? null : null,
        item_id: sec.kind === "coin" ? coins.data?.[0]?.id ?? null : null,
        gram_price: sec.kind === "coin" && kind !== "opening" ? coins.data?.[0]?.price ?? null : null,
      },
    ]);

  const addTag = async (raw: string, direction: Direction) => {
    const t = raw.trim();
    if (!t) return false;
    try {
      const r = await api.get(`/gold/items/by-tag/${encodeURIComponent(t)}`);
      if (!r.available) {
        n.warn(`اتیکت ${faDigits(r.item.tag_no)} «${r.status_title}» است`);
        return false;
      }
      if (lines.some((l) => l.gold_item_id === r.item.id)) {
        n.warn("این جنس قبلاً اضافه شده است");
        return false;
      }
      if (kind === "consign_return" && r.item.ownership !== "consignment") {
        n.warn("این جنس امانی نیست");
        return false;
      }
      if (kind === "melt" && r.item.ownership !== "own") {
        n.warn("جنس امانی ذوب نمی‌شود");
        return false;
      }
      if (kind === "consign_return" && !partyId && r.item.supplier_id) setPartyId(r.item.supplier_id);
      setLines((ls) => [
        ...ls,
        { key: uuidv7(), kind: "piece", direction, gold_item_id: r.item.id, tag_no: r.item.tag_no, title: r.line.title, weight: r.item.net_weight, fineness: r.item.fineness, supplier_id: r.item.supplier_id },
      ]);
      return true;
    } catch (e) {
      n.error(e);
      return false;
    }
  };

  const payload = (status: "posted" | "draft") => ({
    kind,
    date,
    status,
    party_id: rule.party === "none" ? null : partyId,
    gram18: rule.price === "none" ? null : gram18,
    mazaneh: rule.price === "none" ? null : mazaneh,
    description: description || null,
    settle: {
      mode: rule.modes ? mode : null,
      cash: cash.id && cash.amount ? { cash_box_id: cash.id, amount: cash.amount } : null,
      pos: pos.id && pos.amount ? { pos_id: pos.id, amount: pos.amount } : null,
      bank: bank.id && bank.amount ? { bank_account_id: bank.id, amount: bank.amount, ref_no: bank.ref_no || null } : null,
      close_workshop: kind === "workshop_in" && consumption === "close",
      consumed_weight750: kind === "workshop_in" && consumption === "manual" ? consumed : null,
    },
    lines: lines.map((l) => ({
      kind: l.kind, direction: l.direction, gold_item_id: l.gold_item_id ?? null, item_id: l.item_id ?? null, category_id: l.category_id ?? null,
      title: l.title || null, tag_no: l.kind === "piece" && l.direction === "in" ? l.tag_no || null : null, form: l.kind === "bulk" ? l.form : null,
      qty: l.kind === "coin" ? l.qty : null, fineness: l.kind === "piece" && l.direction === "out" ? null : l.fineness, weight: l.kind === "coin" || (l.kind === "piece" && l.direction === "out") ? null : l.weight,
      stone_weight: l.stone_weight ?? null, gram_price: l.gram_price ?? null, wage_type: l.wage_type ?? null, wage_value: l.wage_value ?? null, stone: l.stone ?? null,
      deduction_pct: l.deduction_pct ?? null, cost: kind === "opening" ? l.cost ?? null : null, assay_no: l.assay_no || null,
      extra: l.kind === "piece" && l.direction === "in" ? { sale_wage_type: l.sale_wage_type ?? null, sale_wage_value: l.sale_wage_value ?? null, stone_desc: l.stone_desc ?? null } : null,
    })),
  });

  const save = async (status: "posted" | "draft" = "posted") => {
    if (readOnly || saving) return;
    if (!lines.length) return n.warn("سند ردیفی ندارد");
    if (rule.party === "required" && !partyId) return n.warn(`${rule.partyLabel} را انتخاب کنید`);
    setSaving(true);
    try {
      const r = id ? await api.put(`/gold/docs/${id}`, payload(status)) : await api.post("/gold/docs", payload(status));
      n.ok(`${rule.title} شماره‌ی ${faDigits(r.doc.no)} ${status === "draft" ? "به‌صورت پیش‌نویس " : ""}ثبت شد`);
      qc.invalidateQueries({ queryKey: ["table"] });
      qc.invalidateQueries({ queryKey: ["gold-coins"] });
      qc.invalidateQueries({ queryKey: ["gold-party-balances"] });
      qc.setQueryData(["gold-doc", r.doc.id], r.doc);
      nav(`/${orgId}/gold/docs/${r.doc.id}`, { replace: !!id });
    } catch (e) {
      n.error(e);
    } finally {
      setSaving(false);
    }
  };
  useHotkey("f2", () => save("posted"), [lines, date, partyId, gram18, mazaneh, description, mode, cash, pos, bank, consumption, consumed, saving]);

  if (id && existing.isLoading) return <div className="grid h-64 place-content-center"><Loader /></div>;
  if (id && existing.error) return <Alert type="error" title={errorText(existing.error)} />;
  const d = existing.data;

  return (
    <div className="sf-doc">
      <PageHeader
        back={`/${orgId}/gold/docs?kind=${kind}`}
        title={d ? `${rule.title} ${faDigits(d.no)}` : `${rule.title}، جدید`}
        subtitle={d ? <span className="sf-doc-meta"><StatusOf s={d.status} /></span> : null}
        actions={
          !readOnly ? (
            <>
              {!d || d.status === "draft" ? <Button onClick={() => save("draft")} disabled={saving}>پیش‌نویس</Button> : null}
              <Button type="primary" loading={saving} onClick={() => save("posted")}>
                ثبت<span className="sf-kw" aria-hidden><bdi dir="ltr"><kbd>F2</kbd></bdi></span>
              </Button>
            </>
          ) : null
        }
      />
      {d?.status === "posted" ? <div className="sf-inline"><i className="sf-nuqta" aria-hidden /><span>این سند ثبت شده است؛ ذخیره‌ی تغییرات آن را دوباره ثبت می‌کند (اتیکت‌ها و شماره‌ی سند حسابداری حفظ می‌شوند).</span></div> : null}
      {d?.status === "cancelled" ? <div className="sf-inline" data-tone="danger"><i className="sf-nuqta" aria-hidden /><span><b>باطل شده.</b> این سند اثری در موجودی و حساب‌ها ندارد.</span></div> : null}

      <div className="sf-doc-card sf-doc-pad grid gap-4 md:grid-cols-[156px_minmax(0,1fr)_172px_172px]">
        <div>
          <div className="sf-field-l mb-1.5">تاریخ</div>
          <DateInput value={date} onChange={setDate} disabled={readOnly} />
        </div>
        {rule.party !== "none" ? (
          <div>
            <div className="sf-field-l mb-1.5">
              {rule.partyLabel}
              {rule.party === "optional" ? <span className="font-normal text-ink-3">(اختیاری)</span> : null}
              {pb ? (
                <span className="sf-field-x">
                  {!D(pb.gold_w).isZero() ? <span>حساب وزنی: <WBalance v={pb.gold_w} /></span> : null}
                  {!D(pb.workshop_w).isZero() ? <span>نزد کارگاه: <WBalance v={pb.workshop_w} /></span> : null}
                  {!D(pb.consign_w).isZero() ? <span>امانی: <WBalance v={pb.consign_w} /></span> : null}
                </span>
              ) : null}
            </div>
            <PartySelect value={partyId} onChange={setPartyId} disabled={readOnly} allowClear placeholder={`${rule.partyLabel}…`} className="w-full" />
          </div>
        ) : (
          <div />
        )}
        {rule.price !== "none" ? (
          <>
            <div>
              <div className="sf-field-l mb-1.5">گرم ۱۸ عیار{rule.price === "optional" ? " (اختیاری)" : ""}</div>
              <MoneyInput value={gram18} disabled={readOnly} onChange={(v) => { setGram18(v); setMazaneh(v ? mazanehFromGram18(v) : null); }} />
            </div>
            <div>
              <div className="sf-field-l mb-1.5">مظنه</div>
              <MoneyInput value={mazaneh} disabled={readOnly} onChange={(v) => { setMazaneh(v); setGram18(v ? gram18FromMazaneh(v) : null); }} />
            </div>
          </>
        ) : (
          <div className="md:col-span-2" />
        )}
        <div className="md:col-span-4">
          <Input value={description} disabled={readOnly} onChange={(e) => setDescription(e.target.value)} placeholder="شرح سند (اختیاری)" />
        </div>
      </div>

      <div className="grid items-start gap-4 min-[90rem]:grid-cols-[minmax(0,1fr)_360px]">
        <div className="sf-doc">
          {SECTIONS[kind].map((sec) => (
            <LinesSection
              key={`${sec.kind}-${sec.direction}`}
              kind={kind}
              sec={sec}
              rows={priced.filter(({ l }) => l.kind === sec.kind && l.direction === sec.direction)}
              readOnly={readOnly}
              onAdd={() => add(sec)}
              onScan={(t) => addTag(t, sec.direction)}
              onChange={set}
              onRemove={remove}
              coins={coins.data ?? []}
              partyId={partyId}
            />
          ))}
        </div>

        <div className="grid content-start gap-4 lg:grid-cols-3 min-[90rem]:grid-cols-1">
          <div className="sf-doc-card sf-doc-pad">
            <div className="sf-sec-t mb-2">جمع سند</div>
            <div className="sf-sums">
            {!D(totals.weight_out).isZero() ? <Sum k={kind === "melt" ? "وزن ۷۵۰ ورودی ذوب" : "وزن ۷۵۰ خروجی"} w={totals.weight_out} /> : null}
            {!D(totals.weight_in).isZero() ? <Sum k={kind === "melt" ? "وزن ۷۵۰ آبشده‌ی حاصل" : "وزن ۷۵۰ ورودی"} w={totals.weight_in} /> : null}
            {kind === "melt" && !D(totals.weight_out).isZero() && !D(totals.weight_in).isZero() ? (
              <Sum k={D(totals.weight_out).gte(D(totals.weight_in)) ? "افت ذوب" : "اضافه‌ی ری‌گیری"} w={D(totals.weight_out).minus(D(totals.weight_in)).abs().toString()} strong />
            ) : null}
            {totals.pieces ? <div className="r"><span>تعداد جنس</span><span className="n">{faDigits(totals.pieces)}</span></div> : null}
            {!D(totals.gold_value).isZero() ? <Sum k="ارزش طلا" m={totals.gold_value} /> : null}
            {!D(totals.wage).isZero() ? <Sum k={WAGE_LABEL[kind] ?? "اجرت"} m={totals.wage} /> : null}
            {!D(totals.stone).isZero() ? <Sum k="سنگ" m={totals.stone} /> : null}
            {!D(totals.tax).isZero() ? <Sum k="مالیات" m={totals.tax} /> : null}
            {!D(totals.old_value).isZero() && kind === "buyback" ? <Sum k="کسر کهنگی" m={priced.reduce((a, { p }) => a.plus(D(p.discount)), D(0)).toString()} /> : null}
            {!D(totals.coins).isZero() ? <Sum k="سکه" m={totals.coins} /> : null}
            {!D(totals.total).isZero() ? <Sum k={kind === "workshop_in" ? "اجرت قابل پرداخت" : "جمع کل"} m={totals.total} strong /> : null}
            {D(totals.weight_out).isZero() && D(totals.weight_in).isZero() && D(totals.total).isZero() ? <div className="r is-sub"><span>هنوز ردیفی نیست</span><span className="n">—</span></div> : null}
            </div>
            {["workshop_out", "melt", "consign_return"].includes(kind) ? <div className="sf-field-h mt-2">بهای ریالی از میانگین دفتری حساب‌ها هنگام ثبت محاسبه می‌شود.</div> : null}
          </div>

          {rule.modes ? (
            <div className="sf-doc-card sf-doc-pad">
              <div className="sf-sec-t mb-2">{kind === "consign_in" ? "تسویه با امانت‌گذار هنگام فروش" : "نوع تسویه"}</div>
              <Segmented block value={mode} disabled={readOnly} onChange={(v) => setMode(v as "rial" | "weight")} options={[{ value: "rial", label: "ریالی" }, { value: "weight", label: "وزنی (طلا به طلا)" }]} />
              <div className="sf-field-h mt-2">
                {mode === "weight"
                  ? kind === "bullion_sale"
                    ? "وزن آبشده از بدهی وزنی ما به خریدار کم می‌شود."
                    : kind === "consign_in"
                      ? "با فروش هر جنس، معادل ۷۵۰ آن به حساب وزنی همکار و اجرت او به‌صورت ریالی بستانکار می‌شود."
                      : "وزن ۷۵۰ طلا به حساب وزنی همکار و اجرت (و سکه) به‌صورت ریالی بستانکار می‌شود."
                  : kind === "consign_in"
                    ? "با فروش هر جنس، ارزش طلا به نرخ روز فروش به‌اضافه‌ی اجرت همکار بستانکار می‌شود."
                    : "کل مبلغ به‌صورت ریالی تسویه یا به حساب طرف منظور می‌شود."}
              </div>
            </div>
          ) : null}

          {kind === "workshop_in" ? (
            <div className="sf-doc-card sf-doc-pad">
              <div className="sf-sec-t mb-2">طلای مصرف‌شده از حساب کارگاه</div>
              <Radio.Group value={consumption} disabled={readOnly} onChange={(e) => setConsumption(e.target.value)} className="!flex !flex-col gap-1">
                <Radio value="returned">به اندازه‌ی وزن دریافتی (بدون افت)</Radio>
                <Radio value="close">تسویه‌ی کامل مانده‌ی کارگاه (مابقی = افت)</Radio>
                <Radio value="manual">وزن مصرفی اعلام‌شده:</Radio>
              </Radio.Group>
              {consumption === "manual" ? <WeightInput className="!mt-2" value={consumed} disabled={readOnly} onChange={setConsumed} placeholder="معادل ۷۵۰" /> : null}
              {pb ? <div className="sf-field-h mt-2">مانده‌ی نزد کارگاه <WBalance v={pb.workshop_w} /></div> : null}
            </div>
          ) : null}

          {rule.cash !== "none" && !(kind === "bullion_sale" && mode === "weight") ? (
            <div className="sf-doc-card sf-doc-pad">
              <div className="sf-sec-t">
                <span>{rule.cash === "receive" ? "دریافت" : "پرداخت"}</span>
                <span className="sf-sec-x text-[12px] text-ink-3">قابل تسویه <Money v={due} /></span>
              </div>
              <div className="sf-pay" style={{ ["--sum-col" as string]: "132px" }}>
                <Pay icon={Banknote} label="نقد" entity="cash_box" v={cash} set={setCash} readOnly={readOnly} />
                {rule.cash === "receive" ? <Pay icon={CreditCard} label="کارتخوان" entity="pos_terminal" v={pos} set={setPos} readOnly={readOnly} /> : null}
                <Pay icon={Landmark} label="بانک" entity="bank_account" v={bank} set={setBank} readOnly={readOnly} />
              </div>
              {D(due).isZero() ? null : D(split.remaining).isZero() ? (
                <div className="sf-settle" data-state="in" style={{ ["--sum-col" as string]: "132px" }}><span className="k">تسویه شد</span></div>
              ) : (
                <div className="sf-settle" data-state={D(split.remaining).isNeg() ? "over" : "due"} style={{ ["--sum-col" as string]: "132px" }}>
                  <span className="k">{D(split.remaining).isNeg() ? "بیش از مبلغ قابل تسویه" : rule.cash === "receive" ? "مانده به حساب طرف (بدهکار)" : "مانده به حساب طرف (بستانکار)"}</span>
                  <span className="n"><Money v={D(split.remaining).abs().toString()} /></span>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Sum({ k, w, m, strong }: { k: string; w?: string; m?: string; strong?: boolean }) {
  return (
    <div className={`r ${strong ? "is-total" : ""}`}>
      <span>{k}</span>
      <span className="n">{w !== undefined ? <>{gw(w)}<span className="sf-unit">{"\u00a0"}گرم</span></> : <Money v={m ?? 0} />}</span>
    </div>
  );
}

function Pay({ icon, label, entity, v, set, readOnly }: { icon: typeof Banknote; label: string; entity: string; v: { id: string | null; amount: string | null; ref_no?: string }; set: (x: any) => void; readOnly: boolean }) {
  return (
    <div className="r">
      <span className="ic"><Ic icon={icon} /></span>
      <span className="m">
        <span className="k">{label}</span>
        <RefSelect entity={entity} size="small" variant="borderless" className="acct" showCode={false} value={v.id} disabled={readOnly} onChange={(id) => set({ ...v, id })} placeholder="انتخاب…" />
      </span>
      <span className="n"><MoneyInput size="small" value={v.amount} disabled={readOnly} onChange={(amount) => set({ ...v, amount })} placeholder="—" /></span>
    </div>
  );
}

function LinesSection({ kind, sec, rows, readOnly, onAdd, onScan, onChange, onRemove, coins, partyId }: {
  kind: DocKind;
  sec: SectionDef;
  rows: { l: ELine; p: PricedLine }[];
  readOnly: boolean;
  onAdd: () => void;
  onScan: (tag: string) => Promise<boolean>;
  onChange: (key: string, patch: Partial<ELine>) => void;
  onRemove: (key: string) => void;
  coins: { id: string; name: string; price: string | null }[];
  partyId: string | null;
}) {
  const [tag, setTag] = useState("");
  const ref = useRef<InputRef>(null);
  const scanned = sec.kind === "piece" && sec.direction === "out";
  const money = ["purchase", "opening", "workshop_in", "bullion_sale", "buyback"].includes(kind);
  const wageLabel = WAGE_LABEL[kind] ?? "اجرت";
  const h = (x: string) => <th>{x}</th>;
  return (
    <section className="sf-doc-card">
      <div className="sf-doc-h flex-wrap">
        <h2>{sec.title}</h2>
        <span className="sf-doc-hm">{rows.length ? <><span className="sf-num">{faDigits(rows.length)}</span> ردیف<span className="sf-sep" aria-hidden /><span className="sf-num">{gw(rows.reduce((a, { p }) => a.plus(D(p.weight750)), D(0)))}</span> گرم ۷۵۰</> : null}</span>
        <span className="sf-doc-hx">
        {!readOnly && scanned ? (
          <Input
            ref={ref}
            size="small"
            dir="ltr"
            className="sf-scan-in !w-60"
            prefix={<Ic icon={ScanBarcode} className="text-ink-3" />}
            placeholder="اسکن اتیکت، Enter"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            onPressEnter={async () => {
              if (await onScan(tag)) setTag("");
              ref.current?.focus();
            }}
          />
        ) : null}
        {!readOnly && scanned && kind === "consign_return" && partyId ? (
          <RefSelect entity="gold_item" size="small" className="!w-56" filters={{ ownership: "consignment", status: "in_stock", supplier_id: partyId }} value={null} placeholder="انتخاب از امانی‌های همکار…" onChange={(_, o) => o?.sub && onScan(String(o.sub))} />
        ) : null}
        {!readOnly && !scanned && sec.add ? <Button size="small" type="text" icon={<Ic icon={Plus} />} onClick={onAdd}>{sec.add}</Button> : null}
        </span>
      </div>
      {rows.length ? (
        <div className="sf-grid-wrap">
          <table className="sf-grid" style={{ minWidth: sec.kind === "piece" && sec.direction === "in" ? (kind === "purchase" || kind === "workshop_in" ? 1150 : 980) : sec.kind === "old" ? 900 : 720 }}>
            <thead>
              <tr>
                {sec.kind === "piece" && sec.direction === "in" ? (
                  <>
                    {h("دسته")}{h("شرح")}{h("اتیکت")}{h("عیار")}{h("وزن خالص")}{h("وزن سنگ")}
                    {kind === "opening" ? h("بهای تمام‌شده") : <>{h(wageLabel)}{kind !== "consign_in" ? h("ارزش سنگ") : null}</>}
                    {h("اجرت فروش (اتیکت)")}
                    {kind === "purchase" ? h("ارزش طلا") : null}
                    {money ? h("جمع") : null}
                  </>
                ) : sec.kind === "piece" ? (
                  <>{h("اتیکت")}{h("شرح")}{h("عیار")}{h("وزن خالص")}{h("معادل ۷۵۰")}</>
                ) : sec.kind === "bulk" ? (
                  <>
                    {h("نوع")}{h("شرح")}{h("وزن (گرم)")}{h(kind === "melt" && sec.direction === "in" ? "عیار ری‌گیری" : "عیار")}{h("معادل ۷۵۰")}
                    {kind === "melt" || kind === "bullion_sale" || kind === "purchase" ? h("انگ / کد آزمایشگاه") : null}
                    {kind === "purchase" ? <>{h("اجرت")}{h("ارزش طلا")}</> : null}
                    {kind === "opening" ? h("بهای تمام‌شده") : null}
                    {money && kind !== "workshop_in" ? h("جمع") : null}
                  </>
                ) : sec.kind === "old" ? (
                  <>{h("شرح")}{h("وزن (گرم)")}{h("عیار")}{h("کسر ٪")}{h("قیمت گرم ۱۸")}{h("معادل ۷۵۰")}{h("ارزش")}{h("کسر")}{h("قابل پرداخت")}</>
                ) : (
                  <>{h("سکه")}{h("تعداد")}{kind === "opening" ? h("بهای کل") : h("قیمت هر سکه")}{h("جمع")}</>
                )}
                {!readOnly ? <th className="w-8" /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ l, p }) => {
                const c = (patch: Partial<ELine>) => onChange(l.key, patch);
                return (
                  <tr key={l.key}>
                    {sec.kind === "piece" && sec.direction === "in" ? (
                      <>
                        <td className="min-w-[110px]"><RefSelect entity="gold_category" variant="borderless" showCode={false} value={l.category_id ?? null} disabled={readOnly} onChange={(v) => c({ category_id: v })} placeholder="دسته" /></td>
                        <td className="min-w-[110px]"><Input variant="borderless" value={l.title ?? ""} disabled={readOnly} onChange={(e) => c({ title: e.target.value })} placeholder="شرح" /></td>
                        <td className="w-[80px]">
                          {l.gold_item_id && l.tag_no ? <span className="sf-num px-2">{faDigits(l.tag_no)}</span> : <Input variant="borderless" dir="ltr" className="sf-num" value={l.tag_no ?? ""} disabled={readOnly} onChange={(e) => c({ tag_no: e.target.value })} placeholder="خودکار" />}
                        </td>
                        <td className="min-w-[64px]"><NumberInput variant="borderless" decimals={1} value={l.fineness} disabled={readOnly} onChange={(v) => c({ fineness: v })} /></td>
                        <td className="min-w-[100px]"><WeightInput variant="borderless" value={l.weight} disabled={readOnly} onChange={(v) => c({ weight: v })} /></td>
                        <td className="min-w-[90px]"><WeightInput variant="borderless" value={l.stone_weight} disabled={readOnly} onChange={(v) => c({ stone_weight: v })} /></td>
                        {kind === "opening" ? (
                          <td className="min-w-[130px]"><MoneyInput variant="borderless" value={l.cost} disabled={readOnly} onChange={(v) => c({ cost: v })} placeholder="خالی = به نرخ روز" /></td>
                        ) : (
                          <>
                            <td className="min-w-[150px]"><WageCell type={l.wage_type} value={l.wage_value} readOnly={readOnly} onChange={(t, v) => c({ wage_type: t, wage_value: v })} amount={p.wage} /></td>
                            {kind !== "consign_in" ? <td className="min-w-[100px]"><MoneyInput variant="borderless" value={l.stone} disabled={readOnly} onChange={(v) => c({ stone: v })} placeholder="۰" /></td> : null}
                          </>
                        )}
                        <td className="min-w-[140px]"><WageCell type={l.sale_wage_type} value={l.sale_wage_value} readOnly={readOnly} placeholder="پیش‌فرض دسته" onChange={(t, v) => c({ sale_wage_type: t, sale_wage_value: v })} /></td>
                        {kind === "purchase" ? <td className="sf-gn"><Money v={p.gold_value} /></td> : null}
                        {money ? <td className="sf-gn font-medium"><Money v={p.total} /></td> : null}
                      </>
                    ) : sec.kind === "piece" ? (
                      <>
                        <td className="sf-gn"><span className="sf-docno">{faDigits(l.tag_no ?? "")}</span></td>
                        <td className="px-2">{l.title}</td>
                        <td className="sf-num px-2">{faDigits(D(l.fineness ?? 750).toString())}</td>
                        <td className="sf-num px-2">{gw(l.weight ?? 0)}</td>
                        <td className="sf-num px-2">{gw(p.weight750)}</td>
                      </>
                    ) : sec.kind === "bulk" ? (
                      <>
                        <td className="w-[130px]"><Select variant="borderless" className="w-full" value={l.form ?? "bullion"} disabled={readOnly} options={formOptions} onChange={(v) => c({ form: v })} /></td>
                        <td className="min-w-[120px]"><Input variant="borderless" value={l.title ?? ""} disabled={readOnly} onChange={(e) => c({ title: e.target.value })} placeholder="شرح" /></td>
                        <td className="w-[110px]"><WeightInput variant="borderless" value={l.weight} disabled={readOnly} onChange={(v) => c({ weight: v })} /></td>
                        <td className="w-[90px]"><NumberInput variant="borderless" decimals={1} value={l.fineness} disabled={readOnly} onChange={(v) => c({ fineness: v })} /></td>
                        <td className="sf-num w-[90px] px-2">{gw(p.weight750)}</td>
                        {kind === "melt" || kind === "bullion_sale" || kind === "purchase" ? <td className="w-[120px]"><Input variant="borderless" dir="ltr" value={l.assay_no ?? ""} disabled={readOnly} onChange={(e) => c({ assay_no: e.target.value })} /></td> : null}
                        {kind === "purchase" ? (
                          <>
                            <td className="min-w-[160px]"><WageCell type={l.wage_type} value={l.wage_value} readOnly={readOnly} onChange={(t, v) => c({ wage_type: t, wage_value: v })} amount={p.wage} /></td>
                            <td><Money v={p.gold_value} /></td>
                          </>
                        ) : null}
                        {kind === "opening" ? <td className="min-w-[130px]"><MoneyInput variant="borderless" value={l.cost} disabled={readOnly} onChange={(v) => c({ cost: v })} placeholder="خالی = به نرخ روز" /></td> : null}
                        {money && kind !== "workshop_in" ? <td className="sf-gn font-medium"><Money v={p.total} /></td> : null}
                      </>
                    ) : sec.kind === "old" ? (
                      <>
                        <td className="min-w-[110px]"><Input variant="borderless" value={l.title ?? ""} disabled={readOnly} onChange={(e) => c({ title: e.target.value })} placeholder="طلای مستعمل" /></td>
                        <td className="w-[110px]"><WeightInput variant="borderless" value={l.weight} disabled={readOnly} onChange={(v) => c({ weight: v })} /></td>
                        <td className="w-[86px]"><NumberInput variant="borderless" decimals={1} value={l.fineness} disabled={readOnly} onChange={(v) => c({ fineness: v })} /></td>
                        <td className="w-[86px]"><PctInput variant="borderless" value={l.deduction_pct} disabled={readOnly} onChange={(v) => c({ deduction_pct: v })} /></td>
                        <td className="w-[140px]"><MoneyInput variant="borderless" value={l.gram_price} disabled={readOnly} onChange={(v) => c({ gram_price: v })} placeholder="قیمت سند" /></td>
                        <td className="sf-num px-2">{gw(p.weight750)}</td>
                        <td><Money v={p.gold_value} /></td>
                        <td><Money v={p.discount} zero="—" /></td>
                        <td className="sf-gn font-medium"><Money v={p.total} /></td>
                      </>
                    ) : (
                      <>
                        <td className="min-w-[160px]">
                          <Select
                            variant="borderless"
                            className="w-full"
                            value={l.item_id ?? undefined}
                            disabled={readOnly}
                            options={coins.map((x) => ({ value: x.id, label: x.name }))}
                            onChange={(v) => {
                              const coin = coins.find((x) => x.id === v);
                              c({ item_id: v, title: coin?.name ?? null, gram_price: kind === "opening" ? l.gram_price : coin?.price ?? l.gram_price });
                            }}
                          />
                        </td>
                        <td className="w-[100px]"><NumberInput variant="borderless" value={l.qty} disabled={readOnly} onChange={(v) => c({ qty: v })} /></td>
                        <td className="w-[160px]">
                          {kind === "opening" ? (
                            <MoneyInput variant="borderless" value={l.cost} disabled={readOnly} onChange={(v) => c({ cost: v })} />
                          ) : (
                            <MoneyInput variant="borderless" value={l.gram_price} disabled={readOnly} onChange={(v) => c({ gram_price: v })} />
                          )}
                        </td>
                        <td className="sf-gn font-medium"><Money v={p.total} /></td>
                      </>
                    )}
                    {!readOnly ? <td><span className="sf-row-x"><Button type="text" size="small" icon={<Ic icon={X} />} tabIndex={-1} onClick={() => onRemove(l.key)} aria-label="حذف ردیف" /></span></td> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-5 py-5 text-center text-[13px] text-ink-3">
          {scanned ? "اتیکت جنس را اسکن کنید." : "ردیفی وارد نشده است."}
          {sec.kind === "piece" && sec.direction === "out" && kind === "consign_return" && !partyId ? <span className="ms-2 text-ink-2">ابتدا امانت‌گذار را انتخاب کنید یا اسکن کنید.</span> : null}
        </div>
      )}
      {kind === "bullion_sale" && rows.length ? <div className="sf-field-h px-5 pb-3 pt-2">قیمت با مظنه: وزن × عیار ÷ ۷۰۵ ÷ ۴٫۶۰۸۳ × مظنه</div> : null}
    </section>
  );
}

function WageCell({ type, value, readOnly, onChange, amount, placeholder }: { type?: string | null; value?: string | null; readOnly: boolean; onChange: (type: string, value: string | null) => void; amount?: string; placeholder?: string }) {
  return (
    <div>
      <div className="flex items-center gap-1">
        <Select size="small" variant="borderless" className="!w-[74px]" value={type ?? "percent"} disabled={readOnly} options={wageTypeOptions} onChange={(t) => onChange(t, value ?? null)} />
        <NumberInput size="small" variant="borderless" decimals={type === "percent" || !type ? 3 : 0} value={value} disabled={readOnly} placeholder={placeholder} onChange={(v) => onChange(type ?? "percent", v)} />
      </div>
      {amount !== undefined && !D(amount).isZero() ? <span className="sf-gsub"><Money v={amount} /></span> : null}
    </div>
  );
}

