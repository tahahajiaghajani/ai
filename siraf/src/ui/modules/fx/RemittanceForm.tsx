// Remittance form: outgoing (the customer pays here, a correspondent pays abroad) or incoming
// (a correspondent asks us to pay a beneficiary here). Used as the «new» page and, inside a
// drawer, to edit; after sending only the people's details and notes can change.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, Segmented, Spin } from "antd";
import { SaveOutlined, ExportOutlined, ImportOutlined } from "@ant-design/icons";
import { useOrg } from "../../lib/org";
import { useHotkey, useNotify } from "../../lib/hooks";
import { PageHeader, Section } from "../../components/layout";
import { DateInput, NumberInput, PartySelect } from "../../components/inputs";
import { Money } from "../../components/display";
import { D } from "@shared/money";
import { faDigits } from "@shared/format";
import { todayISO } from "@shared/jalali";
import { numberToWords } from "@shared/words";
import { CurrencyPick, FxAmount, LegPicker, rateLabel, useBoard, useCurrencyMap, type LegValue } from "./shared";

type Person = Record<string, string | undefined>;

export interface RemittanceFormProps {
  initial?: any;
  onSaved?: (r: any) => void;
  compact?: boolean;
}

export function RemittanceForm({ initial, onSaved, compact }: RemittanceFormProps) {
  const { api, org, unit } = useOrg();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const n = useNotify();
  const board = useBoard();
  const curMap = useCurrencyMap(board.data);
  const base = board.data?.base ?? null;
  const baseDp = org.money_decimals ?? 0;
  const editing = !!initial?.id;
  const locked = editing && initial.status !== "pending";
  const tz = (org.settings?.timezone as string) || "Asia/Tehran";

  const [direction, setDirection] = useState<"out" | "in">(initial?.direction ?? (params.get("direction") === "in" ? "in" : "out"));
  const [date, setDate] = useState<string | null>(initial?.date ?? todayISO(tz));
  const [corr, setCorr] = useState<string | null>(initial?.correspondent_id ?? params.get("correspondent") ?? null);
  const [currency, setCurrency] = useState<string | null>(initial?.currency_id ?? null);
  const [amount, setAmount] = useState<string | null>(initial?.amount ?? null);
  const [rate, setRate] = useState<string | null>(initial?.rate ?? null);
  const [rateTouched, setRateTouched] = useState(!!initial);
  const [fee, setFee] = useState<string | null>(initial && !D(initial.fee).isZero() ? initial.fee : null);
  const [corrFee, setCorrFee] = useState<string | null>(initial && !D(initial.correspondent_fee).isZero() ? initial.correspondent_fee : null);
  const [payCur, setPayCur] = useState<"base" | "same">(initial && initial.pay_currency_id && initial.pay_currency_id === initial.currency_id && base?.id !== initial.currency_id ? "same" : "base");
  const [leg, setLeg] = useState<LegValue>({ method: initial?.pay_method ?? "cash", ref_id: initial?.pay_ref_id ?? null });
  const [partyId, setPartyId] = useState<string | null>(initial?.party_id ?? null);
  const [partyName, setPartyName] = useState<string | null>(initial?.party_name ?? null);
  const [sender, setSender] = useState<Person>(initial?.sender ?? { nationality: "ایران" });
  const [beneficiary, setBeneficiary] = useState<Person>(initial?.beneficiary ?? {});
  const [tracking, setTracking] = useState<string>(initial?.tracking_code ?? "");
  const [description, setDescription] = useState<string>(initial?.description ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!currency && board.data) setCurrency(board.data.currencies.find((c) => c.code === "USD")?.id ?? board.data.currencies.find((c) => !c.is_base)?.id ?? null);
  }, [board.data, currency]);
  const X = currency ? curMap.get(currency) ?? null : null;
  const P = payCur === "same" && X ? X : base;
  // the board's rate: our sell rate for outgoing, buy rate for incoming
  useEffect(() => {
    if (rateTouched || !X || X.is_base) return;
    setRate((direction === "out" ? X.rate?.sell : X.rate?.buy) ?? X.rate?.mid ?? null);
  }, [X, direction, rateTouched]);

  const r = X?.is_base ? D(1) : D(rate);
  const baseAmount = D(amount).times(r).toDecimalPlaces(baseDp);
  const feeD = D(fee);
  const feeIn = direction === "out" ? P : X; // outgoing: in the pay currency; incoming: in the remittance currency
  const feeBase = feeIn?.is_base ? feeD : feeD.times(r).toDecimalPlaces(baseDp);
  const payAmount = direction === "out" ? (P?.is_base ? baseAmount : D(amount)).plus(feeD) : P?.is_base ? baseAmount : D(amount);
  const payDp = P?.is_base ? baseDp : P?.decimals ?? 2;

  const body = useMemo(
    () => ({
      date,
      direction,
      party_id: partyId,
      sender,
      beneficiary,
      correspondent_id: corr,
      currency_id: currency,
      amount,
      rate: X?.is_base ? "1" : rate,
      fee,
      correspondent_fee: direction === "out" ? corrFee : null,
      pay_method: leg.method,
      pay_ref_id: leg.method === "party" ? null : leg.ref_id,
      pay_currency_id: P?.id ?? null,
      tracking_code: tracking.trim() || null,
      description: description.trim() || null,
    }),
    [date, direction, partyId, sender, beneficiary, corr, currency, amount, X, rate, fee, corrFee, leg, P, tracking, description],
  );

  const save = async () => {
    if (saving) return;
    if (!corr) return n.warn("همکار را انتخاب کنید");
    if (!currency || !D(amount).gt(0)) return n.warn("ارز و مبلغ حواله را وارد کنید");
    if (!beneficiary.name?.trim()) return n.warn("نام ذی‌نفع را وارد کنید");
    setSaving(true);
    try {
      const res = editing ? await api.put(`/fx/remittances/${initial.id}`, body) : await api.post("/fx/remittances", body);
      n.ok(editing ? "حواله ذخیره شد" : `حواله‌ی ش ${faDigits(res.remittance.no)} ثبت شد — کد رهگیری ${faDigits(res.remittance.tracking_code)}`);
      qc.invalidateQueries({ queryKey: ["table"] });
      qc.invalidateQueries({ queryKey: ["fx-remittance", res.remittance.id] });
      qc.invalidateQueries({ queryKey: ["fx-correspondents"] });
      qc.invalidateQueries({ queryKey: ["fx-summary"] });
      onSaved?.(res.remittance);
    } catch (e) {
      n.error(e);
    } finally {
      setSaving(false);
    }
  };
  useHotkey("f2", () => save(), [body, saving]);

  if (board.isLoading) return <div className="grid h-40 place-content-center"><Spin /></div>;
  const person = (v: Person, set: (p: Person) => void, fields: [string, string, boolean?][]) => (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {fields.map(([k, label, ltr]) => (
        <Field key={k} label={label}>
          <Input dir={ltr ? "ltr" : undefined} className={ltr ? "num" : ""} value={v[k] ?? ""} onChange={(e) => set({ ...v, [k]: e.target.value })} />
        </Field>
      ))}
    </div>
  );

  return (
    <div className="grid gap-4">
      {locked ? <Alert type="info" showIcon title="حواله ارسال یا پرداخت شده است؛ فقط مشخصات افراد و توضیحات قابل تغییر است." /> : null}
      <Section
        title="حواله"
        extra={
          !editing ? (
            <Segmented
              value={direction}
              onChange={(v) => { setDirection(v as "out" | "in"); setRateTouched(false); }}
              options={[{ value: "out", label: <span><ExportOutlined /> صادره</span> }, { value: "in", label: <span><ImportOutlined /> وارده</span> }]}
            />
          ) : null
        }
      >
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="تاریخ"><DateInput value={date} onChange={setDate} disabled={locked} /></Field>
          <Field label={direction === "out" ? "همکار پرداخت‌کننده (مقصد)" : "همکار دستوردهنده"} className="md:col-span-2">
            <PartySelect role="correspondent" value={corr} onChange={(id) => setCorr(id)} disabled={locked} placeholder="همکار صرافی / کارگزار…" />
          </Field>
          <Field label="کد رهگیری (خالی = خودکار)"><Input dir="ltr" className="num" value={tracking} onChange={(e) => setTracking(e.target.value)} /></Field>
          <Field label="ارز حواله">
            <CurrencyPick currencies={board.data?.currencies ?? []} value={currency} onChange={(c) => { setCurrency(c); setRateTouched(false); }} disabled={locked} className="w-full" />
          </Field>
          <Field label="مبلغ حواله">
            <NumberInput value={amount} onChange={setAmount} decimals={X?.is_base ? baseDp : X?.decimals ?? 2} disabled={locked} suffix={<span className="ltr text-xs text-muted">{X?.code}</span>} words={X ? (X.is_base ? unit : X.name) : undefined} />
          </Field>
          {!X?.is_base ? (
            <Field label={direction === "out" ? "نرخ (فروش)" : "نرخ (خرید)"}>
              <NumberInput value={rate} onChange={(v) => { setRateTouched(true); setRate(v); }} decimals={8} disabled={locked} />
              {X?.rate ? <div className="mt-1 text-[11px] text-muted">تابلو: خرید {rateLabel(X.rate.buy ?? X.rate.mid, baseDp)} · فروش {rateLabel(X.rate.sell ?? X.rate.mid, baseDp)}</div> : null}
            </Field>
          ) : null}
          <Field label="معادل به ارز پایه"><div className="pt-1.5"><Money v={baseAmount.toFixed()} unit /></div></Field>
        </div>
      </Section>

      <Section title={direction === "out" ? "فرستنده (مشتری)" : "ذی‌نفع در اینجا"}>
        <div className="mb-3 grid gap-3 md:grid-cols-3">
          <Field label="مشتری ثبت‌شده (اختیاری)">
            <PartySelect value={partyId} onChange={(id, o) => { setPartyId(id); setPartyName(o?.label ?? null); if (o && direction === "out" && !sender.name) setSender({ ...sender, name: o.label, mobile: o.mobile ?? sender.mobile, national_id: o.national_id ?? sender.national_id }); if (o && direction === "in" && !beneficiary.name) setBeneficiary({ ...beneficiary, name: o.label, mobile: o.mobile ?? beneficiary.mobile }); }} allowClear />
          </Field>
        </div>
        {direction === "out"
          ? person(sender, setSender, [["name", "نام فرستنده"], ["national_id", "کد ملی", true], ["mobile", "موبایل", true], ["passport_no", "گذرنامه", true], ["nationality", "ملیت"], ["address", "نشانی"]])
          : person(beneficiary, setBeneficiary, [["name", "نام ذی‌نفع"], ["national_id", "کد ملی", true], ["mobile", "موبایل", true], ["passport_no", "گذرنامه", true], ["relation", "نسبت با فرستنده"], ["address", "نشانی"]])}
        {direction === "in" ? <div className="mt-3">{person(sender, setSender, [["name", "نام فرستنده (در مبدأ)"], ["country", "کشور مبدأ"], ["mobile", "تلفن فرستنده", true]])}</div> : null}
      </Section>

      {direction === "out" ? (
        <Section title="ذی‌نفع (گیرنده در مقصد)">
          {person(beneficiary, setBeneficiary, [["name", "نام ذی‌نفع"], ["country", "کشور"], ["city", "شهر"], ["bank", "بانک / صرافی مقصد"], ["account", "شماره حساب / IBAN", true], ["mobile", "تلفن", true], ["passport_no", "گذرنامه / مدرک", true], ["relation", "نسبت"]])}
        </Section>
      ) : null}

      <Section title={direction === "out" ? "دریافت وجه از مشتری" : "پرداخت به ذی‌نفع"}>
        <div className="grid gap-3 md:grid-cols-[220px_1fr]">
          <Field label="ارز پرداخت">
            <Segmented
              disabled={locked || !X || X.is_base}
              value={X?.is_base ? "base" : payCur}
              onChange={(v) => setPayCur(v as "base" | "same")}
              options={[{ value: "base", label: unit }, ...(X && !X.is_base ? [{ value: "same", label: X.code }] : [])]}
            />
          </Field>
          <Field label={direction === "out" ? "دریافت در" : "پرداخت از"}>
            <LegPicker currency={P} value={leg} onChange={setLeg} partyName={partyName} disabled={locked} />
          </Field>
          <Field label={direction === "out" ? `کارمزد مشتری (${P?.is_base ? unit : P?.code ?? ""})` : `کارمزد ما از همکار (${X?.code ?? ""})`}>
            <NumberInput value={fee} onChange={setFee} decimals={feeIn?.is_base ? baseDp : feeIn?.decimals ?? 2} disabled={locked} />
          </Field>
          {direction === "out" ? (
            <Field label={`کارمزد همکار (${X?.code ?? ""}) — هزینه‌ی ما`}>
              <NumberInput value={corrFee} onChange={setCorrFee} decimals={X?.decimals ?? 2} disabled={locked} />
            </Field>
          ) : <div />}
          <Field label="توضیحات" className="md:col-span-2">
            <Input.TextArea value={description} onChange={(e) => setDescription(e.target.value)} autoSize={{ minRows: 1, maxRows: 4 }} />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 rounded-lg bg-surface-2 p-3">
          <div>
            <div className="text-[11px] text-muted">{direction === "out" ? "مشتری می‌پردازد" : "به ذی‌نفع پرداخت می‌شود"}</div>
            <div className="text-xl font-extrabold"><FxAmount v={payAmount.toFixed()} code={P?.is_base ? unit : P?.code} dp={payDp} /></div>
            {payAmount.gt(0) ? <div className="text-[11px] text-muted">{numberToWords(payAmount.toFixed())} {P?.is_base ? unit : P?.name}</div> : null}
          </div>
          {feeD.gt(0) ? <div className="text-sm">درآمد کارمزد: <Money v={feeBase.toFixed()} unit /></div> : null}
          <div className="ms-auto">
            <Button type="primary" size={compact ? "middle" : "large"} icon={<SaveOutlined />} loading={saving} onClick={save}>
              {editing ? "ذخیره‌ی تغییرات" : "ثبت حواله"} <span className="tz-kbd ltr ms-1 !bg-transparent !text-white/80">F2</span>
            </Button>
          </div>
        </div>
      </Section>
    </div>
  );
}

function Field({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`block min-w-0 ${className ?? ""}`}>
      <div className="mb-1 text-xs text-muted">{label}</div>
      {children}
    </label>
  );
}

export default function RemittanceNew() {
  const { orgId } = useOrg();
  const nav = useNavigate();
  return (
    <div>
      <PageHeader back={`/${orgId}/fx/remittances`} title="حواله‌ی جدید" subtitle="صادره: مشتری اینجا می‌پردازد و همکار در مقصد پرداخت می‌کند · وارده: به دستور همکار اینجا پرداخت می‌کنیم · F2: ثبت" />
      <RemittanceForm onSaved={(r) => nav(`/${orgId}/fx/remittances/${r.id}`)} />
    </div>
  );
}
