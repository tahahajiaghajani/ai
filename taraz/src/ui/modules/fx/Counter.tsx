// The exchange counter (باجه‌ی صرافی): what the customer gives and gets, the rate from the
// board, the other amount computed live in both directions, fee, legs, customer or walk-in KYC,
// crypto transfer details, and a live preview of the average cost, profit and voucher lines.
// F2 saves; the receipt opens (and prints) right after.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Input, Segmented, Select, Spin, Table, Tag, Tooltip } from "antd";
import { SwapOutlined, SaveOutlined, ReloadOutlined, UserOutlined, IdcardOutlined, RetweetOutlined, WarningOutlined } from "@ant-design/icons";
import { useOrg } from "../../lib/org";
import { useDebounced, useHotkey, useLocalState, useNotify } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { PageHeader, Section } from "../../components/layout";
import { DateInput, NumberInput, PartySelect } from "../../components/inputs";
import { Money } from "../../components/display";
import { D } from "@shared/money";
import { faDigits } from "@shared/format";
import { todayISO } from "@shared/jalali";
import { CHAINS } from "@shared/entities";
import { isNationalId, isCryptoAddress, type ChainId } from "@shared/validate";
import { numberToWords } from "@shared/words";
import { CurrencyChip, CurrencyPick, FxAmount, KIND_COLOR, KIND_FA, LegPicker, QuickCurrencies, rateLabel, useBoard, useCurrencyMap, type BoardCurrency, type LegValue } from "./shared";

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

  if (board.isLoading || (editing && existing.isLoading)) return <div className="grid h-64 place-content-center"><Spin /></div>;
  if (editing && existing.error) return <Alert type="error" title={errorText(existing.error)} />;
  if (editing && existing.data?.status === "cancelled") return <Alert type="warning" showIcon title="این معامله باطل شده است؛ برای ویرایش ابتدا آن را دوباره ثبت کنید." />;
  if (!can("fx", "edit")) return <Alert type="warning" showIcon title="برای ثبت معامله دسترسی ویرایش صرافی لازم است." />;

  const rateShown = kind === "exchange" && invert && rate && D(rate).gt(0) ? D(1).div(D(rate)).toSignificantDigits(12).toFixed() : rate;
  const boardHint =
    kind === "buy" && g?.rate ? <>تابلو: خرید <b className="num">{rateLabel(g.rate.buy ?? g.rate.mid, baseDp)}</b></>
    : kind === "sell" && t?.rate ? <>تابلو: فروش <b className="num">{rateLabel(t.rate.sell ?? t.rate.mid, baseDp)}</b></>
    : kind === "exchange" ? (
      <>
        {g?.rate ? <span className="block">خرید <span className="ltr">{g.code}</span>: <b className="num">{rateLabel(g.rate.buy ?? g.rate.mid, baseDp)}</b></span> : null}
        {t?.rate ? <span className="block">فروش <span className="ltr">{t.code}</span>: <b className="num">{rateLabel(t.rate.sell ?? t.rate.mid, baseDp)}</b></span> : null}
      </>
    )
    : foreign ? <span className="text-warn">نرخ {foreign.code} در تابلو ثبت نشده</span> : null;
  const walkinNidBad = !!walkin.national_id && (!walkin.nationality || /ایران/.test(walkin.nationality)) && !isNationalId(walkin.national_id);
  const addressBad = !!address.trim() && !!network && !isCryptoAddress(network as ChainId, address.trim());

  return (
    <div>
      <PageHeader
        back={`/${orgId}/fx/deals`}
        title={editing ? `ویرایش معامله‌ی ش ${faDigits(existing.data?.no ?? "")}` : "معامله‌ی جدید"}
        subtitle="مبلغ هر طرف را بنویسید؛ طرف دیگر با نرخ حساب می‌شود · F2: ثبت"
        extra={kind ? <Tag color={KIND_COLOR[kind]} variant="filled" className="!text-sm">{KIND_FA[kind]}</Tag> : null}
        actions={
          <>
            <Tooltip title="پاک کردن فرم"><Button icon={<ReloadOutlined />} onClick={reset} /></Tooltip>
            <Button onClick={() => submit("draft")} disabled={saving}>پیش‌نویس</Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => submit("posted")}>
              ثبت معامله <span className="tz-kbd ltr ms-1 !bg-transparent !text-white/80">F2</span>
            </Button>
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid min-w-0 content-start gap-4">
          {/* customer */}
          <Section
            title="مشتری"
            extra={
              <Segmented
                size="small"
                value={mode}
                onChange={(v) => setMode(v as "walkin" | "party")}
                options={[{ value: "walkin", label: <span><IdcardOutlined /> مشتری گذری</span> }, { value: "party", label: <span><UserOutlined /> مشتری ثبت‌شده</span> }]}
              />
            }
          >
            <div className="grid gap-3 md:grid-cols-[160px_1fr]">
              <div>
                <div className="mb-1 text-xs text-muted">تاریخ</div>
                <DateInput value={date} onChange={setDate} />
              </div>
              {mode === "party" ? (
                <div>
                  <div className="mb-1 text-xs text-muted">شخص</div>
                  <PartySelect value={partyId} onChange={(pid, o) => { setPartyId(pid); setPartyName(o?.label ?? null); }} allowClear />
                  {partyBal.data ? <PartyBadges data={partyBal.data} /> : null}
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  <Field label="نام و نام خانوادگی" required={p?.kyc_required} className="lg:col-span-2">
                    <Input value={walkin.name ?? ""} onChange={(e) => setWalkin({ ...walkin, name: e.target.value })} placeholder="اختیاری برای مبالغ کم" />
                  </Field>
                  <Field label="کد ملی" required={p?.kyc_required && !walkin.passport_no}>
                    <Input dir="ltr" className="num" value={walkin.national_id ?? ""} status={walkinNidBad ? "error" : undefined} onChange={(e) => setWalkin({ ...walkin, national_id: e.target.value })} />
                  </Field>
                  <Field label="موبایل">
                    <Input dir="ltr" className="num" value={walkin.mobile ?? ""} onChange={(e) => setWalkin({ ...walkin, mobile: e.target.value })} />
                  </Field>
                  <Field label="ملیت / گذرنامه">
                    <div className="flex gap-1">
                      <Input value={walkin.nationality ?? ""} onChange={(e) => setWalkin({ ...walkin, nationality: e.target.value })} className="!w-20" />
                      <Input dir="ltr" value={walkin.passport_no ?? ""} placeholder="گذرنامه" onChange={(e) => setWalkin({ ...walkin, passport_no: e.target.value })} />
                    </div>
                  </Field>
                </div>
              )}
            </div>
          </Section>

          {/* the two sides */}
          <div className="tz-card p-4">
            <div className="grid items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_200px_minmax(0,1fr)]">
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
              <div className="flex flex-col items-center justify-center gap-2 py-2">
                <Tooltip title="جابه‌جایی دو طرف">
                  <Button shape="circle" icon={<SwapOutlined />} onClick={swap} tabIndex={-1} />
                </Tooltip>
                <div className="w-full">
                  <div className="mb-1 flex items-center justify-between text-xs text-muted">
                    <span>{kind === "buy" ? "نرخ خرید" : kind === "sell" ? "نرخ فروش" : kind === "exchange" ? "نرخ تبدیل" : "نرخ"}</span>
                    {kind === "exchange" && g && t ? (
                      <Tooltip title="جهت نمایش نرخ">
                        <button type="button" tabIndex={-1} className="ltr text-[11px] text-brand" onClick={() => setInvert(!invert)}>
                          <RetweetOutlined /> 1 {invert ? t.code : g.code} = ? {invert ? g.code : t.code}
                        </button>
                      </Tooltip>
                    ) : null}
                  </div>
                  <NumberInput
                    size="large"
                    decimals={kind === "exchange" ? 12 : 8}
                    value={rateShown}
                    disabled={!kind}
                    status={kind && kind !== "exchange" && !D(rate).gt(0) ? "warning" : undefined}
                    onChange={(v) => {
                      setRateTouched(true);
                      if (kind === "exchange" && invert && v && D(v).gt(0)) setRate(D(1).div(D(v)).toSignificantDigits(14).toFixed());
                      else setRate(v);
                    }}
                  />
                  <div className="mt-1 text-center text-[11px] leading-5 text-muted">{boardHint}</div>
                  {rateTouched ? (
                    <button type="button" tabIndex={-1} className="mx-auto block text-[11px] text-brand" onClick={() => setRateTouched(false)}>
                      نرخ تابلو
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

            <div className="mt-4 grid gap-3 border-t border-line pt-4 md:grid-cols-3">
              <Field label="کارمزد (از مشتری)">
                <div className="flex gap-1">
                  <NumberInput value={fee} onChange={setFee} decimals={feeC ? dpOf(curMap.get(feeC) ?? null) : baseDp} />
                  <Select
                    className="!w-28"
                    value={feeC ?? "base"}
                    onChange={(v) => setFeeC(v === "base" ? null : v)}
                    popupMatchSelectWidth={false}
                    options={[{ value: "base", label: unit }, ...[g, t].filter((c): c is BoardCurrency => !!c && !c.is_base).map((c) => ({ value: c.id, label: c.code }))]}
                  />
                </div>
              </Field>
              {getLeg.method === "wallet" ? (
                <Field label={`کارمزد شبکه (${t?.code ?? ""}) — هزینه‌ی ما`}>
                  <NumberInput value={networkFee} onChange={setNetworkFee} decimals={dpOf(t)} />
                </Field>
              ) : null}
              <Field label="توضیحات" className={getLeg.method === "wallet" ? "" : "md:col-span-2"}>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="اختیاری" />
              </Field>
            </div>

            {hasCrypto ? (
              <div className="mt-3 grid gap-3 rounded-lg border border-dashed border-line p-3 md:grid-cols-[180px_1fr_1fr]">
                <Field label="شبکه‌ی انتقال">
                  <Select allowClear value={network ?? undefined} onChange={(v) => setNetwork(v ?? null)} options={CHAINS} placeholder="شبکه…" popupMatchSelectWidth={false} />
                </Field>
                <Field label={t?.kind === "crypto" ? "نشانی کیف‌پول مشتری (مقصد)" : "نشانی کیف‌پول مبدأ مشتری"}>
                  <Input dir="ltr" className="font-mono text-xs" value={address} status={addressBad ? "error" : undefined} onChange={(e) => setAddress(e.target.value)} />
                </Field>
                <Field label="شناسه‌ی تراکنش (TxID)">
                  <Input dir="ltr" className="font-mono text-xs" value={txHash} onChange={(e) => setTxHash(e.target.value)} />
                </Field>
              </div>
            ) : null}
          </div>
        </div>

        {/* summary */}
        <aside className="min-w-0">
          <div className="tz-card sticky top-16 p-4">
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
              fee={fee}
            />
            <div className="mt-4 grid gap-2">
              <Button type="primary" size="large" block icon={<SaveOutlined />} loading={saving} onClick={() => submit("posted")} disabled={!!p?.blocking?.length}>
                ثبت معامله (F2)
              </Button>
              <label className="flex items-center justify-center gap-2 text-xs text-muted">
                <Checkbox checked={printAfter} onChange={(e) => setPrintAfter(e.target.checked)} /> چاپ رسید پس از ثبت
              </label>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Field({ label, children, required, className }: { label: ReactNode; children: ReactNode; required?: boolean; className?: string }) {
  return (
    <label className={`block min-w-0 ${className ?? ""}`}>
      <div className="mb-1 text-xs text-muted">
        {label} {required ? <span className="text-bad">(الزامی)</span> : null}
      </div>
      {children}
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
    <div className={`min-w-0 rounded-xl border p-3 ${tone === "in" ? "border-[color-mix(in_srgb,var(--tz-success)_35%,transparent)] bg-[color-mix(in_srgb,var(--tz-success)_5%,transparent)]" : "border-[color-mix(in_srgb,var(--tz-gold)_40%,transparent)] bg-[color-mix(in_srgb,var(--tz-gold)_6%,transparent)]"}`}>
      <div className="mb-2 flex items-center justify-between">
        <b className="text-sm">{title}</b>
        <span className="text-[11px] text-muted">{hint}</span>
      </div>
      <CurrencyPick currencies={currencies} value={currency?.id ?? null} onChange={onCurrency} className="w-full" size="large" />
      <QuickCurrencies currencies={currencies} codes={[...QUICK, currencies.find((c) => c.is_base)?.code ?? ""]} value={currency?.id} onPick={(cid) => onCurrency(cid)} />
      <div className="mt-3">
        <NumberInput size="large" value={amount} onChange={onAmount} decimals={dp} placeholder={computed ? "خودکار" : "مبلغ"} suffix={<span className="ltr text-xs font-semibold text-muted">{currency?.code}</span>} className={computed ? "!bg-surface-2" : ""} />
        <div className="mt-1 min-h-4 text-[11px] leading-4 text-muted">{words}</div>
      </div>
      <div className="mt-2">
        <div className="mb-1 text-xs text-muted">{tone === "in" ? "دریافت در" : "پرداخت از"}</div>
        <LegPicker currency={currency} value={leg} onChange={onLeg} partyName={partyName} />
      </div>
    </div>
  );
}

function PartyBadges({ data }: { data: { party: any; balances: any[] } }) {
  const p = data.party;
  const bal = (data.balances ?? []).filter((b) => !D(b.currency_id ? b.fx : b.base).isZero());
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
      {p.is_blacklisted ? <Tag color="red" variant="filled"><WarningOutlined /> فهرست سیاه</Tag> : null}
      <Tag variant="filled" color={p.kyc_status === "verified" ? "green" : p.national_id || p.passport_no ? "blue" : "orange"}>
        {p.kyc_status === "verified" ? "احراز شده" : p.national_id || p.passport_no ? `مدرک: ${faDigits(p.national_id ?? p.passport_no)}` : "بدون مدرک هویتی"}
      </Tag>
      {bal.map((b, i) => {
        const v = D(b.currency_id ? b.fx : b.base);
        return (
          <Tag key={i} variant="filled" color={v.gt(0) ? "cyan" : "gold"} className="num">
            {b.code ?? "ریالی"}: {faDigits(v.abs().toFixed())} {v.gt(0) ? "بد" : "بس"}
          </Tag>
        );
      })}
    </div>
  );
}

function Summary({
  kind, g, t, giveAmt, getAmt, unit, baseDp, preview, loading, error, feeCurrency, fee,
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
  fee: string | null;
}) {
  const [lines, setLines] = useState(false);
  const p = preview;
  const dp = (c: BoardCurrency | null) => (c ? (c.is_base ? baseDp : c.decimals) : 2);
  const giveTotal = p ? D(p.in_amount).plus(feeCurrency?.id === g?.id ? D(p.fee) : 0) : D(giveAmt);
  const sold = kind === "buy" ? g : t;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <b>خلاصه‌ی معامله</b>
        {loading ? <Spin size="small" /> : null}
      </div>
      <div className="grid gap-2">
        <div className="rounded-lg bg-[color-mix(in_srgb,var(--tz-success)_8%,transparent)] p-3">
          <div className="text-[11px] text-muted">مشتری می‌پردازد</div>
          <div className="mt-0.5 text-xl font-extrabold"><FxAmount v={giveTotal.toFixed()} code={g?.is_base ? unit : g?.code} dp={dp(g)} /></div>
          {p && feeCurrency && !D(p.fee).isZero() && feeCurrency.id !== g?.id ? (
            <div className="text-xs text-muted">+ کارمزد <FxAmount v={p.fee} code={feeCurrency.is_base ? unit : feeCurrency.code} dp={dp(feeCurrency)} /></div>
          ) : null}
        </div>
        <div className="rounded-lg bg-[color-mix(in_srgb,var(--tz-gold)_10%,transparent)] p-3">
          <div className="text-[11px] text-muted">مشتری دریافت می‌کند</div>
          <div className="mt-0.5 text-xl font-extrabold"><FxAmount v={p ? p.out_amount : getAmt ?? 0} code={t?.is_base ? unit : t?.code} dp={dp(t)} /></div>
        </div>
      </div>
      {error ? <Alert className="!mt-3" type="error" showIcon title={error} /> : null}
      {p ? (
        <div className="mt-3 grid gap-1.5 text-sm">
          <Row label={kind === "exchange" ? "نرخ تبدیل" : "نرخ"} value={<span className="num">{kind === "exchange" && g && t ? <span className="ltr">1 {g.code} = {rateLabel(p.rate)} {t.code}</span> : rateLabel(p.rate, baseDp)}</span>} />
          <Row label="ارزش معامله" value={<Money v={p.base_value} unit />} />
          {kind !== "buy" ? <Row label={`میانگین بهای ${sold?.code ?? ""}`} value={p.avg_cost ? <span className="num">{rateLabel(p.avg_cost, baseDp)}</span> : "—"} /> : null}
          {kind !== "buy" ? <Row label="بهای تمام‌شده" value={<Money v={p.cost_value} />} /> : null}
          {kind !== "buy" ? <Row label="سود (زیان) معامله" value={<Money v={p.profit} colored />} strong /> : null}
          {!D(p.fee_base).isZero() ? <Row label="درآمد کارمزد" value={<Money v={p.fee_base} />} /> : null}
          {p.position && sold && !sold.is_base ? (
            <Row
              label={`موجودی فعلی ${sold.code}`}
              value={<span className="text-xs"><FxAmount v={p.position.fx} dp={sold.decimals} /> {p.position.avg ? <span className="text-muted">میانگین {rateLabel(p.position.avg, baseDp)}</span> : null}</span>}
            />
          ) : null}
          {p.kyc_required ? <div className="text-xs text-warn"><IdcardOutlined /> مبلغ بالای سقف احراز هویت است</div> : null}
          {(p.blocking ?? []).map((w: string, i: number) => <Alert key={`b${i}`} type="error" showIcon title={w} className="!mt-1" />)}
          {(p.warnings ?? []).map((w: string, i: number) => <Alert key={`w${i}`} type="warning" showIcon title={w} className="!mt-1" />)}
          <button type="button" className="mt-1 text-start text-xs text-brand" onClick={() => setLines(!lines)}>
            {lines ? "پنهان کردن سند" : `پیش‌نمایش سند (${faDigits(p.lines?.length ?? 0)} ردیف)`}
          </button>
          {lines ? (
            <Table
              className="tz-table"
              size="small"
              rowKey={(_, i) => String(i)}
              pagination={false}
              dataSource={p.lines ?? []}
              columns={[
                { key: "a", title: "حساب", render: (_: unknown, l: any) => <div className="leading-4"><div className="text-xs">{l.account_name}</div>{l.detail_name ? <div className="text-[10px] text-muted">{l.detail_name}</div> : null}</div> },
                { key: "d", title: "بد", align: "left", render: (_: unknown, l: any) => (D(l.debit).isZero() ? null : <Money v={l.debit} />) },
                { key: "c", title: "بس", align: "left", render: (_: unknown, l: any) => (D(l.credit).isZero() ? null : <Money v={l.credit} />) },
              ]}
            />
          ) : null}
        </div>
      ) : !error ? (
        <div className="mt-3 text-center text-xs text-muted">{kind ? "مبلغ و نرخ را وارد کنید تا سود و سند نمایش داده شود" : "دو ارز متفاوت انتخاب کنید"}</div>
      ) : null}
      {g && t ? (
        <div className="mt-3 flex items-center justify-center gap-2 text-xs text-muted">
          <CurrencyChip c={g} /> ← <CurrencyChip c={t} />
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value, strong }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-2 border-b border-dashed border-line pb-1.5 ${strong ? "font-bold" : ""}`}>
      <span className="text-xs text-muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}
