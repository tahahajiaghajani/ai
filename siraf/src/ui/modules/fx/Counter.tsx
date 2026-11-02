// The exchange counter (باجه‌ی صرافی): what the customer gives and gets, the rate from the
// board, the other amount computed live in both directions, fee, legs, customer or walk-in KYC,
// crypto transfer details, and a live preview of the average cost, profit and voucher lines.
// F2 saves; the receipt opens (and prints) right after.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Input, Segmented, Select, Table, Tooltip } from "antd";
import { ArrowDown, ArrowLeftRight, Lock, RefreshCw, Repeat } from "lucide-react";
import { Ic } from "../../components/shell/icons";
import { useOrg } from "../../lib/org";
import { useDebounced, useHotkey, useLocalState, useNotify } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { PageHeader } from "../../components/layout";
import { DateInput, NumberInput, PartySelect } from "../../components/inputs";
import { Chip, Loader, Money } from "../../components/display";
import { D } from "@shared/money";
import { faDigits, formatNumber } from "@shared/format";
import { todayISO } from "@shared/jalali";
import { CHAINS } from "@shared/entities";
import { isNationalId, isCryptoAddress, type ChainId } from "@shared/validate";
import { numberToWords } from "@shared/words";
import { CurrencyAvatar, CurrencyPick, FxAmount, KIND_FA, LegPicker, QuickCurrencies, rateLabel, useBoard, useCurrencyMap, type BoardCurrency, type LegValue } from "./shared";

const QUICK = ["USD", "EUR", "AED", "GBP", "TRY", "USDT", "BTC"];
type Side = "give" | "get";

interface Walkin {
  name?: string;
  national_id?: string;
  mobile?: string;
  passport_no?: string;
  nationality?: string;
}

export default function Counter() {
  const { id } = useParams();
  const editing = !!id;
  const [params] = useSearchParams();
  const { api, org, orgId, unit, can } = useOrg();
  const nav = useNavigate();
  const qc = useQueryClient();
  const n = useNotify();
  const board = useBoard();
  const curMap = useCurrencyMap(board.data);
  const currencies = board.data?.currencies ?? [];
  const base = board.data?.base ?? null;
  const baseDp = base?.decimals ?? org.money_decimals ?? 0;
  const tz = (org.settings?.timezone as string) || "Asia/Tehran";

  const [date, setDate] = useState<string | null>(todayISO(tz));
  const [giveC, setGiveC] = useState<string | null>(null);
  const [getC, setGetC] = useState<string | null>(null);
  const [giveAmt, setGiveAmt] = useState<string | null>(null);
  const [getAmt, setGetAmt] = useState<string | null>(null);
  const [edited, setEdited] = useState<Side>("give");
  const [rate, setRate] = useState<string | null>(null);
  const [rateTouched, setRateTouched] = useState(false);
  const [invert, setInvert] = useState(false);
  const [giveLeg, setGiveLeg] = useState<LegValue>({ method: "cash", ref_id: null });
  const [getLeg, setGetLeg] = useState<LegValue>({ method: "cash", ref_id: null });
  const [fee, setFee] = useState<string | null>(null);
  const [feeC, setFeeC] = useState<string | null>(null);
  const [networkFee, setNetworkFee] = useState<string | null>(null);
  const [mode, setMode] = useState<"walkin" | "party">("walkin");
  const [partyId, setPartyId] = useState<string | null>(null);
  const [partyName, setPartyName] = useState<string | null>(null);
  const [walkin, setWalkin] = useState<Walkin>({ nationality: "ایران" });
  const [network, setNetwork] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [txHash, setTxHash] = useState("");
  const [description, setDescription] = useState("");
  const [printAfter, setPrintAfter] = useLocalState("taraz.fx.printAfter", true);
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);

  const existing = useQuery({ queryKey: ["fx-deal", id], queryFn: () => api.get(`/fx/deals/${id}`).then((r) => r.deal), enabled: editing });

  // ---- first values: a new deal (query ?give=USD&get=IRR) or the deal being edited
  useEffect(() => {
    if (ready || !board.data) return;
    if (editing) {
      const d = existing.data;
      if (!d) return;
      setDate(d.date);
      setGiveC(d.in_currency_id);
      setGetC(d.out_currency_id);
      setGiveAmt(d.in_amount);
      setGetAmt(d.out_amount);
      setEdited(d.kind === "sell" ? "get" : "give");
      setRate(d.rate);
      setRateTouched(true);
      setInvert(d.kind === "exchange" && D(d.rate).lt(1));
      setGiveLeg({ method: d.in_method, ref_id: d.in_ref_id });
      setGetLeg({ method: d.out_method, ref_id: d.out_ref_id });
      setFee(D(d.fee).isZero() ? null : d.fee);
      setFeeC(d.fee_currency_id && d.fee_currency_id !== board.data.base.id ? d.fee_currency_id : null);
      setNetworkFee(D(d.network_fee).isZero() ? null : d.network_fee);
      if (d.party_id) {
        setMode("party");
        setPartyId(d.party_id);
        setPartyName(d.party_name);
      } else {
        setMode("walkin");
        setWalkin({ nationality: "ایران", ...(d.walkin ?? {}) });
      }
      setNetwork(d.network);
      setAddress(d.address ?? "");
      setTxHash(d.tx_hash ?? "");
      setDescription(d.description ?? "");
    } else {
      const byCode = (code: string | null) => (code ? board.data!.currencies.find((c) => c.code === code.toUpperCase())?.id ?? null : null);
      setGiveC(byCode(params.get("give")) ?? byCode("USD") ?? board.data.currencies.find((c) => !c.is_base && c.is_active)?.id ?? null);
      setGetC(byCode(params.get("get")) ?? board.data.base.id);
    }
    setReady(true);
  }, [board.data, existing.data, editing, ready, params]);

  const g = giveC ? curMap.get(giveC) ?? null : null;
  const t = getC ? curMap.get(getC) ?? null : null;
  const kind = !g || !t || g.id === t.id || (g.is_base && t.is_base) ? null : g.is_base ? "sell" : t.is_base ? "buy" : "exchange";
  const foreign = kind === "buy" ? g : kind === "sell" ? t : null;
  const dpOf = (c: BoardCurrency | null) => (c ? (c.is_base ? baseDp : c.decimals) : 2);
  const hasCrypto = g?.kind === "crypto" || t?.kind === "crypto";

  // ---- the board's rate whenever the currencies change (until the cashier types one)
  useEffect(() => {
    if (!ready || rateTouched || !g || !t || !kind) return;
    if (kind === "buy") setRate(g.rate?.buy ?? g.rate?.mid ?? null);
    else if (kind === "sell") setRate(t.rate?.sell ?? t.rate?.mid ?? null);
    else {
      const a = D(g.rate?.buy ?? g.rate?.mid);
      const b = D(t.rate?.sell ?? t.rate?.mid);
      setRate(a.gt(0) && b.gt(0) ? a.div(b).toSignificantDigits(12).toFixed() : null);
      setInvert(a.gt(0) && b.gt(0) && a.lt(b));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [giveC, getC, kind, ready, rateTouched, board.data]);

  // ---- the other amount, live in both directions
  useEffect(() => {
    if (!kind || !rate || D(rate).lte(0)) return;
    const r = D(rate);
    if (edited === "give") {
      if (!giveAmt) return setGetAmt(null);
      const v = kind === "sell" ? D(giveAmt).div(r) : D(giveAmt).times(r);
      setGetAmt(v.toDecimalPlaces(dpOf(t)).toFixed());
    } else {
      if (!getAmt) return setGiveAmt(null);
      const v = kind === "sell" ? D(getAmt).times(r) : D(getAmt).div(r);
      setGiveAmt(v.toDecimalPlaces(dpOf(g)).toFixed());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [giveAmt, getAmt, rate, kind, edited, g?.id, t?.id]);

  // ---- a wallet leg suggests the network of the transfer
  useEffect(() => {
    const chain = getLeg.chain ?? giveLeg.chain;
    if (chain && !network) setNetwork(chain);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getLeg.chain, giveLeg.chain]);

  const pickCurrency = (side: Side, cid: string | null) => {
    setRateTouched(false);
    if (side === "give") {
      if (cid && cid === getC) setGetC(giveC);
      setGiveC(cid);
    } else {
      if (cid && cid === giveC) setGiveC(getC);
      setGetC(cid);
    }
  };
  const swap = () => {
    setGiveC(getC);
    setGetC(giveC);
    setGiveLeg(getLeg);
    setGetLeg(giveLeg);
    setGiveAmt(getAmt);
    setGetAmt(giveAmt);
    setEdited(edited === "give" ? "get" : "give");
    setRateTouched(false);
  };
  const reset = () => {
    setGiveAmt(null);
    setGetAmt(null);
    setFee(null);
    setNetworkFee(null);
    setPartyId(null);
    setPartyName(null);
    setWalkin({ nationality: "ایران" });
    setAddress("");
    setTxHash("");
    setDescription("");
    setRateTouched(false);
  };

  // ---- request body
  const payload = useMemo(() => {
    if (!kind || !date || !giveC || !getC) return null;
    return {
      date,
      kind,
      party_id: mode === "party" ? partyId : null,
      walkin: mode === "walkin" ? walkin : null,
      in_currency_id: giveC,
      in_amount: kind === "sell" ? null : giveAmt,
      in_method: giveLeg.method,
      in_ref_id: giveLeg.method === "party" ? null : giveLeg.ref_id,
      out_currency_id: getC,
      out_amount: kind === "buy" ? null : getAmt,
      out_method: getLeg.method,
      out_ref_id: getLeg.method === "party" ? null : getLeg.ref_id,
      rate: kind === "exchange" ? null : rate,
      fee: fee || null,
      fee_currency_id: fee ? feeC ?? base?.id ?? null : null,
      network_fee: getLeg.method === "wallet" ? networkFee || null : null,
      network: hasCrypto ? network : null,
      address: hasCrypto ? address.trim() || null : null,
      tx_hash: hasCrypto ? txHash.trim() || null : null,
      description: description.trim() || null,
    };
  }, [kind, date, giveC, getC, mode, partyId, walkin, giveAmt, getAmt, giveLeg, getLeg, rate, fee, feeC, base?.id, networkFee, hasCrypto, network, address, txHash, description]);
  const amountsOk = !!payload && (kind === "sell" ? D(getAmt).gt(0) : D(giveAmt).gt(0)) && (kind !== "exchange" || D(getAmt).gt(0)) && (kind === "exchange" || D(rate).gt(0));
  const debounced = useDebounced(amountsOk ? JSON.stringify(payload) : "", 350);
  const preview = useQuery({
    queryKey: ["fx-preview", debounced, id],
    queryFn: () => api.post("/fx/deals/preview", { ...JSON.parse(debounced), id: id ?? null }),
    enabled: !!debounced,
    retry: false,
    placeholderData: keepPreviousData,
  });
  const p = debounced ? preview.data : null;

  const partyBal = useQuery({
    queryKey: ["fx-party-bal", partyId],
    queryFn: () => api.get(`/fx/parties/${partyId}/balances`),
    enabled: mode === "party" && !!partyId,
  });

  const submit = async (status: "posted" | "draft") => {
    if (saving) return;
    if (!payload || !amountsOk) return n.warn("ارزها، مبلغ و نرخ را کامل کنید");
    if (mode === "party" && !partyId) return n.warn("مشتری را انتخاب کنید یا «مشتری گذری» را بزنید");
    setSaving(true);
    try {
      const r = editing ? await api.put(`/fx/deals/${id}`, { ...payload, status }) : await api.post("/fx/deals", { ...payload, status });
      n.ok(`معامله‌ی ش ${faDigits(r.deal.no)} ${status === "draft" ? "به‌صورت پیش‌نویس " : ""}ثبت شد`);
      for (const w of r.warnings ?? []) n.warn(w);
      qc.invalidateQueries({ queryKey: ["table"] });
      qc.invalidateQueries({ queryKey: ["fx-summary"] });
      qc.invalidateQueries({ queryKey: ["fx-deal", r.deal.id] });
      nav(`/${orgId}/fx/deals/${r.deal.id}${printAfter && status === "posted" ? "?print=1" : ""}`);
    } catch (e) {
      n.error(e);
    } finally {
      setSaving(false);
    }
  };
  useHotkey("f2", () => submit("posted"), [payload, amountsOk, saving, printAfter, mode, partyId]);
  useHotkey("ctrl+enter", () => submit("posted"), [payload, amountsOk, saving, printAfter, mode, partyId]);

  if (board.isLoading || (editing && existing.isLoading)) return <div className="grid h-64 place-content-center"><Loader /></div>;
  if (editing && existing.error) return <Alert type="error" title={errorText(existing.error)} />;
  if (editing && existing.data?.status === "cancelled") return <Alert type="warning" showIcon title="این معامله باطل شده است؛ برای ویرایش ابتدا آن را دوباره ثبت کنید." />;
  if (!can("fx", "edit")) return <Alert type="warning" showIcon title="برای ثبت معامله دسترسی ویرایش صرافی لازم است." />;

  const rateShown = kind === "exchange" && invert && rate && D(rate).gt(0) ? D(1).div(D(rate)).toSignificantDigits(12).toFixed() : rate;
  const boardHint =
    kind === "buy" && g?.rate ? <>تابلو، خرید <b className="sf-num font-medium text-ink-2">{rateLabel(g.rate.buy ?? g.rate.mid, baseDp)}</b></>
    : kind === "sell" && t?.rate ? <>تابلو، فروش <b className="sf-num font-medium text-ink-2">{rateLabel(t.rate.sell ?? t.rate.mid, baseDp)}</b></>
    : kind === "exchange" ? (
      <>
        {g?.rate ? <span className="block">خرید <bdi dir="ltr" className="sf-latin">{g.code}</bdi> <b className="sf-num font-medium text-ink-2">{rateLabel(g.rate.buy ?? g.rate.mid, baseDp)}</b></span> : null}
        {t?.rate ? <span className="block">فروش <bdi dir="ltr" className="sf-latin">{t.code}</bdi> <b className="sf-num font-medium text-ink-2">{rateLabel(t.rate.sell ?? t.rate.mid, baseDp)}</b></span> : null}
      </>
    )
    : foreign ? <span className="text-warning">نرخ {foreign.code} در تابلو ثبت نشده</span> : null;
  const walkinNidBad = !!walkin.national_id && (!walkin.nationality || /ایران/.test(walkin.nationality)) && !isNationalId(walkin.national_id);
  const addressBad = !!address.trim() && !!network && !isCryptoAddress(network as ChainId, address.trim());

  return (
    <div className="sf-doc">
      <PageHeader
        back={`/${orgId}/fx/deals`}
        title={editing ? `ویرایش معامله‌ی ${faDigits(existing.data?.no ?? "")}` : "معامله‌ی جدید"}
        subtitle={<span className="sf-doc-meta">{kind ? <span className="text-ink-2">{KIND_FA[kind]}</span> : <span>دو ارز را انتخاب کنید</span>}</span>}
        actions={<Tooltip title="پاک کردن فرم"><Button icon={<Ic icon={RefreshCw} />} onClick={reset} aria-label="پاک کردن فرم" /></Tooltip>}
      />
      <div className="sf-dpage">
        <div className="sf-doc">
          {/* customer */}
          <section className="sf-doc-card" aria-label="مشتری">
            <div className="sf-doc-h">
              <h2>مشتری</h2>
              <div className="sf-doc-hx">
                <Segmented
                  size="small"
                  value={mode}
                  onChange={(v) => setMode(v as "walkin" | "party")}
                  options={[{ value: "walkin", label: "مشتری گذری" }, { value: "party", label: "مشتری ثبت‌شده" }]}
                />
              </div>
            </div>
            <div className="sf-doc-pad grid gap-3 md:grid-cols-[156px_minmax(0,1fr)]">
              <Field label="تاریخ">
                <DateInput value={date} onChange={setDate} />
              </Field>
              {mode === "party" ? (
                <Field label="شخص">
                  <PartySelect value={partyId} onChange={(pid, o) => { setPartyId(pid); setPartyName(o?.label ?? null); }} allowClear />
                  {partyBal.data ? <PartyBadges data={partyBal.data} /> : null}
                </Field>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="نام و نام خانوادگی" required={p?.kyc_required}>
                    <Input value={walkin.name ?? ""} onChange={(e) => setWalkin({ ...walkin, name: e.target.value })} placeholder={p?.kyc_required ? "" : "برای مبالغ کم اختیاری"} />
                  </Field>
                  <Field label="کد ملی" required={p?.kyc_required && !walkin.passport_no} error={walkinNidBad ? "کد ملی درست نیست." : null}>
                    <Input dir="ltr" inputMode="numeric" className="sf-numin" value={walkin.national_id ?? ""} status={walkinNidBad ? "error" : undefined} onChange={(e) => setWalkin({ ...walkin, national_id: e.target.value })} />
                  </Field>
                  <Field label="موبایل">
                    <Input dir="ltr" inputMode="tel" className="sf-numin" value={walkin.mobile ?? ""} onChange={(e) => setWalkin({ ...walkin, mobile: e.target.value })} />
                  </Field>
                  <Field label="ملیت">
                    <Input value={walkin.nationality ?? ""} onChange={(e) => setWalkin({ ...walkin, nationality: e.target.value })} />
                  </Field>
                  <Field label="شماره‌ی گذرنامه">
                    <Input dir="ltr" className="sf-code" value={walkin.passport_no ?? ""} onChange={(e) => setWalkin({ ...walkin, passport_no: e.target.value })} />
                  </Field>
                </div>
              )}
            </div>
          </section>

          {/* the two sides */}
          <section className="sf-doc-card" aria-label="معامله">
            <div className="sf-doc-h">
              <h2>معامله</h2>
              <span className="sf-doc-hm">مبلغ هر طرف را بنویسید؛ طرف دیگر با نرخ حساب می‌شود.</span>
            </div>
            <div className="sf-doc-pad">
              <div className="grid items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_188px_minmax(0,1fr)]">
                <SidePanel
                  title="مشتری می‌دهد"
                  hint="دریافت ما"
                  tone="in"
                  currencies={currencies}
                  currency={g}
                  onCurrency={(cid) => pickCurrency("give", cid)}
                  amount={giveAmt}
                  onAmount={(v) => { setEdited("give"); setGiveAmt(v); }}
                  leg={giveLeg}
                  onLeg={setGiveLeg}
                  partyName={mode === "party" ? partyName : null}
                  unit={unit}
                  dp={dpOf(g)}
                  computed={edited === "get"}
                />
                <div className="flex flex-col items-stretch justify-center gap-3 py-2">
                  <div className="sf-swap">
                    <Tooltip title="جابه‌جایی دو طرف">
                      <Button shape="circle" icon={<Ic icon={ArrowLeftRight} />} onClick={swap} tabIndex={-1} aria-label="جابه‌جایی دو طرف" />
                    </Tooltip>
                  </div>
                  <div className="sf-field">
                    <div className="sf-field-l">
                      {kind === "buy" ? "نرخ خرید" : kind === "sell" ? "نرخ فروش" : kind === "exchange" ? "نرخ تبدیل" : "نرخ"}
                      {kind === "exchange" && g && t ? (
                        <span className="sf-field-x">
                          <Tooltip title="جهت نمایش نرخ">
                            <button type="button" tabIndex={-1} className="sf-link inline-flex items-center gap-1 !text-[12px]" onClick={() => setInvert(!invert)}>
                              <Ic icon={Repeat} size={14} /><bdi dir="ltr" className="sf-latin">1 {invert ? t.code : g.code}</bdi>
                            </button>
                          </Tooltip>
                        </span>
                      ) : null}
                    </div>
                    <NumberInput
                      size="large"
                      decimals={kind === "exchange" ? 12 : 8}
                      value={rateShown}
                      disabled={!kind}
                      status={kind && kind !== "exchange" && !D(rate).gt(0) ? "warning" : undefined}
                      suffix={rateTouched ? undefined : kind ? <Tooltip title="نرخ تابلو"><Ic icon={Lock} size={14} /></Tooltip> : undefined}
                      onChange={(v) => {
                        setRateTouched(true);
                        if (kind === "exchange" && invert && v && D(v).gt(0)) setRate(D(1).div(D(v)).toSignificantDigits(14).toFixed());
                        else setRate(v);
                      }}
                    />
                    <div className="sf-field-h text-center leading-5">{boardHint}</div>
                    {rateTouched ? (
                      <button type="button" tabIndex={-1} className="sf-link mx-auto !text-[12px]" onClick={() => setRateTouched(false)}>
                        بازگشت به نرخ تابلو
                      </button>
                    ) : null}
                  </div>
                </div>
                <SidePanel
                  title="مشتری می‌گیرد"
                  hint="پرداخت ما"
                  tone="out"
                  currencies={currencies}
                  currency={t}
                  onCurrency={(cid) => pickCurrency("get", cid)}
                  amount={getAmt}
                  onAmount={(v) => { setEdited("get"); setGetAmt(v); }}
                  leg={getLeg}
                  onLeg={setGetLeg}
                  partyName={mode === "party" ? partyName : null}
                  unit={unit}
                  dp={dpOf(t)}
                  computed={edited === "give"}
                />
              </div>

              <div className="mt-5 grid gap-3 border-t border-line pt-4 md:grid-cols-3">
                <Field label="کارمزد (از مشتری)">
                  <div className="flex gap-1.5">
                    <NumberInput value={fee} onChange={setFee} decimals={feeC ? dpOf(curMap.get(feeC) ?? null) : baseDp} placeholder="—" />
                    <Select
                      className="!w-28 shrink-0"
                      value={feeC ?? "base"}
                      onChange={(v) => setFeeC(v === "base" ? null : v)}
                      popupMatchSelectWidth={false}
                      options={[{ value: "base", label: unit }, ...[g, t].filter((c): c is BoardCurrency => !!c && !c.is_base).map((c) => ({ value: c.id, label: c.code }))]}
                      aria-label="ارز کارمزد"
                    />
                  </div>
                </Field>
                {getLeg.method === "wallet" ? (
                  <Field label={`کارمزد شبکه (${t?.code ?? ""})، هزینه‌ی ما`}>
                    <NumberInput value={networkFee} onChange={setNetworkFee} decimals={dpOf(t)} placeholder="—" />
                  </Field>
                ) : null}
                <Field label="توضیحات" className={getLeg.method === "wallet" ? "" : "md:col-span-2"}>
                  <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="اختیاری" />
                </Field>
              </div>

              {hasCrypto ? (
                <div className="mt-4 grid gap-3 rounded-lg bg-well p-4 md:grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)]">
                  <Field label="شبکه‌ی انتقال">
                    <Select allowClear value={network ?? undefined} onChange={(v) => setNetwork(v ?? null)} options={CHAINS} placeholder="شبکه…" popupMatchSelectWidth={false} />
                  </Field>
                  <Field label={t?.kind === "crypto" ? "نشانی کیف‌پول مشتری (مقصد)" : "نشانی کیف‌پول مبدأ مشتری"} error={addressBad ? "این نشانی برای این شبکه درست نیست." : null}>
                    <Input dir="ltr" className="sf-code" value={address} status={addressBad ? "error" : undefined} onChange={(e) => setAddress(e.target.value)} />
                  </Field>
                  <Field label="شناسه‌ی تراکنش (TxID)">
                    <Input dir="ltr" className="sf-code" value={txHash} onChange={(e) => setTxHash(e.target.value)} />
                  </Field>
                </div>
              ) : null}
            </div>
          </section>
        </div>

        {/* the deal sheet */}
        <aside className="sf-dsheet" aria-label="خلاصه‌ی معامله">
          <div className="sf-dsheet-b">
            <Summary
              kind={kind}
              g={g}
              t={t}
              giveAmt={giveAmt}
              getAmt={getAmt}
              unit={unit}
              baseDp={baseDp}
              preview={p}
              loading={preview.isFetching}
              error={debounced && preview.error ? errorText(preview.error) : null}
              feeCurrency={feeC ? curMap.get(feeC) ?? null : base}
            />
            <label className="mt-auto flex items-center gap-2 text-[13px] text-ink-2">
              <Checkbox checked={printAfter} onChange={(e) => setPrintAfter(e.target.checked)} /> چاپ رسید پس از ثبت
            </label>
          </div>
          <div className="sf-dsheet-f">
            <div className="tot">
              <small>ارزش معامله</small>
              <b>{p ? <Money v={p.base_value} /> : <span className="sf-zero">—</span>}<span className="sf-unit">{"\u00a0"}{unit}</span></b>
            </div>
            <div className="act">
              <Button onClick={() => submit("draft")} disabled={saving}>پیش‌نویس</Button>
              <Button type="primary" loading={saving} onClick={() => submit("posted")} disabled={!!p?.blocking?.length}>
                ثبت معامله<span className="sf-kw" aria-hidden><bdi dir="ltr"><kbd>F2</kbd></bdi></span>
              </Button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Field({ label, children, required, className, error }: { label: ReactNode; children: ReactNode; required?: boolean; className?: string; error?: string | null }) {
  return (
    <label className={`sf-field ${className ?? ""}`}>
      <span className="sf-field-l">
        {label}
        {required ? <span className="sf-field-x text-warning">الزامی</span> : null}
      </span>
      {children}
      {error ? <span className="sf-field-err">{error}</span> : null}
    </label>
  );
}

function SidePanel(props: {
  title: string;
  hint: string;
  tone: "in" | "out";
  currencies: BoardCurrency[];
  currency: BoardCurrency | null;
  onCurrency: (id: string | null) => void;
  amount: string | null;
  onAmount: (v: string | null) => void;
  leg: LegValue;
  onLeg: (v: LegValue) => void;
  partyName: string | null;
  unit: string;
  dp: number;
  computed: boolean;
}) {
  const { title, hint, tone, currencies, currency, onCurrency, amount, onAmount, leg, onLeg, partyName, unit, dp, computed } = props;
  const words = currency && amount && D(amount).gt(0) ? `${numberToWords(amount)} ${currency.is_base ? unit : currency.name}` : "";
  return (
    <div className="sf-leg" data-dir={tone}>
      <div className="sf-leg-h">
        <i className="sf-dot" aria-hidden />
        <b>{title}</b>
        <span>{hint}</span>
      </div>
      <div>
        <CurrencyPick currencies={currencies} value={currency?.id ?? null} onChange={onCurrency} className="w-full" size="large" />
        <QuickCurrencies currencies={currencies} codes={[...QUICK, currencies.find((c) => c.is_base)?.code ?? ""]} value={currency?.id} onPick={(cid) => onCurrency(cid)} />
      </div>
      <div className="sf-amount">
        <NumberInput size="large" value={amount} onChange={onAmount} decimals={dp} placeholder={computed ? "خودکار" : "مبلغ"} suffix={currency ? <bdi dir="ltr" className="sf-latin text-[12px] font-semibold text-ink-3">{currency.code}</bdi> : undefined} />
        <div className="sf-words min-h-[18px]">{words}</div>
      </div>
      <div className="sf-field">
        <div className="sf-field-l">{tone === "in" ? "دریافت در" : "پرداخت از"}</div>
        <LegPicker currency={currency} value={leg} onChange={onLeg} partyName={partyName} />
      </div>
    </div>
  );
}

function PartyBadges({ data }: { data: { party: any; balances: any[] } }) {
  const p = data.party;
  const bal = (data.balances ?? []).filter((b) => !D(b.currency_id ? b.fx : b.base).isZero());
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-ink-3">
      {p.is_blacklisted ? <Chip tone="danger">فهرست سیاه</Chip> : null}
      {p.kyc_status === "verified" ? <span>احراز شده</span> : p.national_id || p.passport_no ? <span>مدرک <span className="sf-num">{faDigits(p.national_id ?? p.passport_no)}</span></span> : <Chip tone="warning">بدون مدرک هویتی</Chip>}
      {bal.map((b, i) => {
        const v = D(b.currency_id ? b.fx : b.base);
        return (
          <span key={i} className="inline-flex items-center gap-1">
            {b.code ? <bdi dir="ltr" className="sf-latin text-[12px]">{b.code}</bdi> : <span>ریالی</span>}
            <span className="sf-num text-ink-2">{faDigits(v.abs().toFixed())}</span>
            <span className="sf-bal-side">{v.gt(0) ? "بد" : "بس"}</span>
          </span>
        );
      })}
    </div>
  );
}

function Summary({
  kind, g, t, giveAmt, getAmt, unit, baseDp, preview, loading, error, feeCurrency,
}: {
  kind: string | null;
  g: BoardCurrency | null;
  t: BoardCurrency | null;
  giveAmt: string | null;
  getAmt: string | null;
  unit: string;
  baseDp: number;
  preview: any;
  loading: boolean;
  error: string | null;
  feeCurrency: BoardCurrency | null;
}) {
  const [lines, setLines] = useState(false);
  const p = preview;
  const dp = (c: BoardCurrency | null) => (c ? (c.is_base ? baseDp : c.decimals) : 2);
  const giveTotal = p ? D(p.in_amount).plus(feeCurrency?.id === g?.id ? D(p.fee) : 0) : D(giveAmt);
  const sold = kind === "buy" ? g : t;
  const amt = (c: BoardCurrency | null, v: string) => (c?.is_base ? <><Money v={v} /><span className="sf-unit">{"\u00a0"}{unit}</span></> : <FxAmount v={v} code={c?.code} dp={dp(c)} />);
  return (
    <>
      <div className="sf-sec-t">
        <span>خلاصه‌ی معامله</span>
        {loading ? <span className="sf-sec-x"><Loader /></span> : null}
      </div>
      <div className="sf-flow">
        <div className="r">
          {g ? <CurrencyAvatar code={g.code} size="lg" /> : null}
          <span className="t">
            <small>مشتری می‌پردازد</small>
            <b>{g ? amt(g, giveTotal.toFixed()) : <span className="sf-zero">—</span>}</b>
            {p && feeCurrency && !D(p.fee).isZero() && feeCurrency.id !== g?.id ? <small>به‌اضافه‌ی کارمزد {amt(feeCurrency, p.fee)}</small> : null}
          </span>
        </div>
        <div className="arrow" aria-hidden><Ic icon={ArrowDown} size={14} /></div>
        <div className="r">
          {t ? <CurrencyAvatar code={t.code} size="lg" /> : null}
          <span className="t">
            <small>مشتری دریافت می‌کند</small>
            <b>{t ? amt(t, p ? p.out_amount : getAmt ?? "0") : <span className="sf-zero">—</span>}</b>
          </span>
        </div>
      </div>
      {error ? <div className="sf-inline" data-tone="danger"><i className="sf-nuqta" aria-hidden /><span>{error}</span></div> : null}
      {p ? (
        <>
          <div className="sf-sums" role="group" aria-label="محاسبه‌ی معامله">
            <div className="r">
              <span>{kind === "exchange" ? "نرخ تبدیل" : "نرخ"}</span>
              <span className="n">{kind === "exchange" && g && t ? <bdi dir="ltr" className="sf-latin">1 {g.code} = {formatNumber(D(p.rate).toSignificantDigits(8), { dp: 8, fa: false })} {t.code}</bdi> : rateLabel(p.rate, baseDp)}</span>
            </div>
            <div className="r"><span>ارزش معامله</span><span className="n"><Money v={p.base_value} /></span></div>
            {kind !== "buy" ? <div className="r"><span>میانگین بهای <bdi dir="ltr" className="sf-latin">{sold?.code ?? ""}</bdi></span><span className="n">{p.avg_cost ? rateLabel(p.avg_cost, baseDp) : <span className="sf-zero">—</span>}</span></div> : null}
            {kind !== "buy" ? <div className="r"><span>بهای تمام‌شده</span><span className="n"><Money v={p.cost_value} /></span></div> : null}
            {!D(p.fee_base).isZero() ? <div className="r"><span>درآمد کارمزد</span><span className="n"><Money v={p.fee_base} /></span></div> : null}
            {kind !== "buy" ? <div className="r is-total"><span>سود (زیان) معامله</span><span className="n"><Money v={p.profit} colored /></span></div> : null}
            {p.position && sold && !sold.is_base ? (
              <div className="r is-sub">
                <span>موجودی فعلی <bdi dir="ltr" className="sf-latin">{sold.code}</bdi></span>
                <span className="n"><FxAmount v={p.position.fx} dp={sold.decimals} /></span>
              </div>
            ) : null}
          </div>
          {p.kyc_required ? <div className="sf-inline" data-tone="warning"><i className="sf-nuqta" aria-hidden /><span><b>احراز هویت لازم است.</b> مبلغ از سقف معامله‌ی بدون مدرک بیشتر است.</span></div> : null}
          {(p.blocking ?? []).map((w: string, i: number) => <div key={`b${i}`} className="sf-inline" data-tone="danger"><i className="sf-nuqta" aria-hidden /><span>{w}</span></div>)}
          {(p.warnings ?? []).map((w: string, i: number) => <div key={`w${i}`} className="sf-inline" data-tone="warning"><i className="sf-nuqta" aria-hidden /><span>{w}</span></div>)}
          <button type="button" className="sf-link self-start" onClick={() => setLines(!lines)}>
            {lines ? "پنهان کردن پیش‌نمایش سند" : `پیش‌نمایش سند (${faDigits(p.lines?.length ?? 0)} ردیف)`}
          </button>
          {lines ? (
            <Table
              size="small"
              rowKey={(_, i) => String(i)}
              pagination={false}
              dataSource={p.lines ?? []}
              columns={[
                { key: "a", title: "حساب", render: (_: unknown, l: any) => <div className="leading-5"><div className="text-[13px]">{l.account_name}</div>{l.detail_name ? <div className="text-[12px] text-ink-3">{l.detail_name}</div> : null}</div> },
                { key: "d", title: "بدهکار", className: "sf-num", render: (_: unknown, l: any) => (D(l.debit).isZero() ? null : <Money v={l.debit} />) },
                { key: "c", title: "بستانکار", className: "sf-num", render: (_: unknown, l: any) => (D(l.credit).isZero() ? null : <Money v={l.credit} />) },
              ]}
            />
          ) : null}
        </>
      ) : !error ? (
        <div className="py-2 text-center text-[13px] text-ink-3">{kind ? "مبلغ و نرخ را وارد کنید تا سود و سند نمایش داده شود." : "دو ارز متفاوت انتخاب کنید."}</div>
      ) : null}
    </>
  );
}
