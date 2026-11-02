// One exchange deal: the customer's receipt (A5 or 80 mm thermal, amounts in words) and the
// accounting side (value, average cost, profit, voucher), with edit / post / cancel actions.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Dropdown, Input, Modal, Segmented } from "antd";
import { Ban, CircleCheck, Copy, Ellipsis, Pencil, Plus, Printer, Trash2 } from "lucide-react";
import { Ic } from "../../components/shell/icons";
import { useOrg } from "../../lib/org";
import { useLocalState, useNotify } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { PageHeader, Section } from "../../components/layout";
import { JDateTime, Loader, Money, StatusTag } from "../../components/display";
import { D } from "@shared/money";
import { faDigits, maskMiddle } from "@shared/format";
import { formatJalali, formatJalaliDateTime } from "@shared/jalali";
import { numberToWords } from "@shared/words";
import { CHAINS } from "@shared/entities";
import { DEAL_STATUS, EXPLORER, Facts, FxAmount, KIND_FA, rateLabel } from "./shared";
import { PrintColophon, PrintHead } from "../goods/print";

export default function DealView() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { api, orgId, can, unit, org } = useOrg();
  const nav = useNavigate();
  const qc = useQueryClient();
  const n = useNotify();
  const [paper, setPaper] = useLocalState<"a5" | "80mm">("taraz.fx.paper", "a5");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const printed = useRef(false);
  const q = useQuery({ queryKey: ["fx-deal", id], queryFn: () => api.get(`/fx/deals/${id}`).then((r) => r.deal) });
  const d = q.data;

  // «ثبت و چاپ»: print once when the receipt is on screen
  useEffect(() => {
    if (d && params.get("print") === "1" && !printed.current) {
      printed.current = true;
      setTimeout(() => window.print(), 350);
      setParams({}, { replace: true });
    }
  }, [d, params, setParams]);

  const refresh = () => {
    q.refetch();
    qc.invalidateQueries({ queryKey: ["table"] });
    qc.invalidateQueries({ queryKey: ["fx-summary"] });
  };
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      n.ok(ok);
      refresh();
    } catch (e) {
      n.error(e);
    }
  };

  if (q.isLoading) return <div className="grid h-64 place-content-center"><Loader /></div>;
  if (q.error || !d) return <Alert type="error" title={errorText(q.error)} />;

  const baseDp = org.money_decimals ?? 0;
  const dpIn = d.in_code === org.base_currency ? baseDp : Number(d.in_decimals ?? 2);
  const dpOut = d.out_code === org.base_currency ? baseDp : Number(d.out_decimals ?? 2);
  const nameOf = (code: string, name: string) => (code === org.base_currency ? unit : name);
  const chain = CHAINS.find((c) => c.value === d.network)?.label ?? d.network;
  const editable = can("fx", "edit") && d.status !== "cancelled";
  const customer = d.party_name ?? d.walkin?.name ?? "مشتری گذری";

  return (
    <div>
      <PageHeader
        back={`/${orgId}/fx/deals`}
        title={`معامله‌ی ${faDigits(d.no)}`}
        subtitle={
          <span className="sf-doc-meta">
            <span className="text-ink-2">{KIND_FA[d.kind]}</span>
            <span className="sf-sep" aria-hidden />
            <StatusTag s={d.status} map={DEAL_STATUS} />
            <span className="sf-sep" aria-hidden />
            <JDateTime v={d.created_at} />
            {d.created_by_name ? <><span className="sf-sep" aria-hidden /><span>{d.created_by_name}</span></> : null}
          </span>
        }
        actions={
          <>
            <Dropdown
              trigger={["click"]}
              placement="bottomLeft"
              menu={{
                items: [
                  ...(can("fx", "edit") ? [{ key: "next", icon: <Ic icon={Plus} />, label: "معامله‌ی بعدی", onClick: () => nav(`/${orgId}/fx/deals/new`) }] : []),
                  ...(editable ? [{ key: "edit", icon: <Ic icon={Pencil} />, label: "ویرایش معامله", onClick: () => nav(`/${orgId}/fx/deals/${d.id}/edit`) }] : []),
                  ...(d.status !== "posted" && can("fx", "edit") ? [{ key: "post", icon: <Ic icon={CircleCheck} />, label: d.status === "cancelled" ? "ثبت دوباره" : "ثبت قطعی معامله", onClick: () => act(() => api.post(`/fx/deals/${d.id}/post`), "معامله ثبت شد") }] : []),
                  ...(d.status !== "cancelled" && can("fx", "edit") ? [{ key: "cancel", icon: <Ic icon={Ban} />, danger: true, label: "ابطال معامله", onClick: () => setCancelOpen(true) }] : []),
                  { key: "copy", icon: <Ic icon={Copy} />, label: "معامله‌ی مشابه", onClick: () => nav(`/${orgId}/fx/deals/new?give=${d.in_code}&get=${d.out_code}`) },
                  ...(can("fx", "full")
                    ? [{
                        key: "del",
                        icon: <Ic icon={Trash2} />,
                        danger: true,
                        label: "حذف",
                        onClick: async () => {
                          if (!(await n.confirm("حذف این معامله و سند آن؟", undefined, true))) return;
                          try {
                            await api.del(`/fx/deals/${d.id}`);
                            n.ok("معامله حذف شد");
                            qc.invalidateQueries({ queryKey: ["table"] });
                            nav(`/${orgId}/fx/deals`);
                          } catch (e) {
                            n.error(e);
                          }
                        },
                      }]
                    : []),
                ],
              }}
            >
              <Button icon={<Ic icon={Ellipsis} />} aria-label="بیشتر" />
            </Dropdown>
            <Button type="primary" icon={<Ic icon={Printer} />} onClick={() => window.print()}>چاپ رسید</Button>
          </>
        }
      />
      {d.status === "cancelled" ? <div className="sf-inline no-print mb-4" data-tone="danger"><i className="sf-nuqta" aria-hidden /><span><b>باطل شده.</b>{d.cancel_reason ? ` ${d.cancel_reason}` : " سند حسابداری این معامله حذف شده است."}</span></div> : null}
      {d.status === "draft" ? <div className="sf-inline no-print mb-4" data-tone="warning"><i className="sf-nuqta" aria-hidden /><span><b>پیش‌نویس.</b> هنوز سند حسابداری ندارد.</span></div> : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px] print:block">
        <div className="min-w-0">
          <div className="no-print mb-3 flex items-center justify-center gap-3">
            <span className="text-[13px] text-ink-3">کاغذ رسید</span>
            <Segmented size="small" value={paper} onChange={(v) => setPaper(v as "a5" | "80mm")} options={[{ value: "a5", label: "A5" }, { value: "80mm", label: "۸۰ میلی‌متر" }]} />
          </div>
          <style>{paper === "80mm" ? "@media print { @page { size: 80mm auto; margin: 3mm; } }" : "@media print { @page { size: A5; margin: 8mm; } }"}</style>
          <div className={`print-sheet sf-card sf-rcpt mx-auto w-full shadow-e2 ${paper === "80mm" ? "max-w-[80mm] p-4 text-[12px]" : "max-w-[148mm] p-6 text-[13px]"}`}>
            {paper === "a5" ? (
              <div className="hidden print:block">
                <PrintHead title={`رسید ${KIND_FA[d.kind]}`} legal={false} rows={[<>شماره‌ی <b>{faDigits(d.no)}</b></>, <>تاریخ <b>{formatJalali(d.date)}</b></>]} badge={d.status === "cancelled" ? "باطل شده" : d.status === "draft" ? "پیش‌نویس" : null} />
              </div>
            ) : null}
            <div className={`mb-3 flex items-center gap-3 border-b border-line pb-3 ${paper === "a5" ? "print:hidden" : ""}`}>
              {org.logo ? <img src={org.logo} alt="" className={`${paper === "80mm" ? "h-8 w-8" : "h-12 w-12"} rounded object-cover`} /> : null}
              <div className="min-w-0 flex-1">
                <div className={`${paper === "80mm" ? "text-sm" : "text-lg"} font-semibold`}>{org.name}</div>
                {org.phone || org.address ? <div className="truncate text-[12px] text-ink-3">{[org.phone, org.address].filter(Boolean).map((x) => faDigits(String(x))).join("، ")}</div> : null}
              </div>
              <div className="text-end">
                <div className="font-semibold">رسید {KIND_FA[d.kind]}</div>
                <div className="text-[12px] text-ink-3">شماره‌ی <span className="sf-docno">{faDigits(d.no)}</span></div>
              </div>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-1 text-[12px]">
              <div className={paper === "a5" ? "print:invisible" : ""}>تاریخ: <b className="sf-num">{formatJalali(d.date)}</b></div>
              <div className="text-end">ساعت: <b className="sf-num">{formatJalaliDateTime(d.created_at).split(" ")[1] ?? ""}</b></div>
              <div className="col-span-2">مشتری: <b>{customer}</b>{d.party_mobile ? <span className="sf-num">، {faDigits(d.party_mobile)}</span> : d.walkin?.mobile ? <span className="sf-num">، {faDigits(d.walkin.mobile)}</span> : null}</div>
              {d.walkin?.national_id || d.party_national_id ? <div className="col-span-2">کد ملی: <b className="sf-num">{faDigits(d.walkin?.national_id ?? d.party_national_id)}</b></div> : null}
              {d.walkin?.passport_no ? <div className="col-span-2">گذرنامه: <bdi dir="ltr" className="sf-mono">{d.walkin.passport_no}</bdi> {d.walkin.nationality ? `(${d.walkin.nationality})` : ""}</div> : null}
            </div>

            <div className="grid gap-2">
              <div className="sf-rcpt-box rounded-lg p-3 shadow-[inset_0_0_0_1px_var(--sf-line-2)]">
                <div className="text-[12px] text-ink-3">دریافت از مشتری</div>
                <div className="flex items-baseline justify-between gap-2">
                  <b className={paper === "80mm" ? "text-base font-semibold" : "text-xl font-semibold"}><FxAmount v={d.in_amount} code={d.in_code === org.base_currency ? unit : d.in_code} dp={dpIn} /></b>
                  <span className="text-[12px] text-ink-3">{d.in_method_fa}{d.in_ref_name ? `: ${d.in_ref_name}` : ""}</span>
                </div>
                <div className="text-[12px] leading-5 text-ink-2">{numberToWords(d.in_amount)} {nameOf(d.in_code, d.in_name)}</div>
              </div>
              <div className="sf-rcpt-box rounded-lg p-3 shadow-[inset_0_0_0_1px_var(--sf-line-2)]">
                <div className="text-[12px] text-ink-3">پرداخت به مشتری</div>
                <div className="flex items-baseline justify-between gap-2">
                  <b className={paper === "80mm" ? "text-base font-semibold" : "text-xl font-semibold"}><FxAmount v={d.out_amount} code={d.out_code === org.base_currency ? unit : d.out_code} dp={dpOut} /></b>
                  <span className="text-[12px] text-ink-3">{d.out_method_fa}{d.out_ref_name ? `: ${d.out_ref_name}` : ""}</span>
                </div>
                <div className="text-[12px] leading-5 text-ink-2">{numberToWords(d.out_amount)} {nameOf(d.out_code, d.out_name)}</div>
              </div>
            </div>

            <div className="mt-3 grid gap-1.5 text-[13px]">
              <div className="flex justify-between">
                <span>نرخ</span>
                <b className="sf-num">{d.kind === "exchange" ? <span className="sf-ltr">1 {d.in_code} = {rateLabel(d.rate)} {d.out_code}</span> : `${rateLabel(d.rate, baseDp)} ${unit}`}</b>
              </div>
              {!D(d.fee).isZero() ? (
                <div className="flex justify-between">
                  <span>کارمزد</span>
                  <b><FxAmount v={d.fee} code={d.fee_code === org.base_currency || !d.fee_code ? unit : d.fee_code} dp={d.fee_code && d.fee_code !== org.base_currency ? Number(d.fee_decimals ?? 2) : baseDp} /></b>
                </div>
              ) : null}
              {!D(d.fee).isZero() && (d.fee_currency_id === d.in_currency_id) ? (
                <div className="flex justify-between border-t border-line-2 pt-1.5">
                  <span>جمع دریافتی</span>
                  <b><FxAmount v={D(d.in_amount).plus(D(d.fee)).toFixed()} code={d.in_code === org.base_currency ? unit : d.in_code} dp={dpIn} /></b>
                </div>
              ) : null}
              {d.network || d.address || d.tx_hash ? (
                <div className="sf-rcpt-box mt-1 grid gap-1 rounded-md p-2.5 shadow-[inset_0_0_0_1px_var(--sf-line)]">
                  {d.network ? <div>شبکه: <b className="sf-ltr">{chain}</b></div> : null}
                  {d.address ? <div className="break-all">نشانی: <bdi dir="ltr" className="sf-mono text-[12px]">{d.address}</bdi></div> : null}
                  {d.tx_hash ? <div className="break-all">TxID: <bdi dir="ltr" className="sf-mono text-[12px]">{d.tx_hash}</bdi></div> : null}
                  {!D(d.network_fee).isZero() ? <div>کارمزد شبکه: <FxAmount v={d.network_fee} code={d.out_code} dp={dpOut} /></div> : null}
                </div>
              ) : null}
              {d.description ? <div className="mt-1">توضیحات: {d.description}</div> : null}
            </div>
            <div className="mt-8 grid grid-cols-2 gap-8 text-center text-[12px] text-ink-3">
              <div className="border-t border-line-3 pt-1.5">امضای مشتری</div>
              <div className="border-t border-line-3 pt-1.5">مهر و امضای صرافی</div>
            </div>
            <div className="mt-4 text-center text-[12px] text-ink-3">{d.status === "cancelled" ? "باطل شده" : "از اعتماد شما سپاسگزاریم."}</div>
            {paper === "a5" ? <div className="hidden print:block"><PrintColophon /></div> : null}
          </div>
        </div>

        <div className="no-print grid content-start gap-4">
          <Section title="حسابداری معامله">
            <Facts
              cols={1}
              items={[
                ["ارزش معامله", <Money v={d.base_value ?? 0} unit />],
                ...(d.kind !== "buy" ? ([["میانگین بهای ارز", d.avg_cost ? <span className="sf-num">{rateLabel(d.avg_cost, baseDp)}</span> : "—"], ["بهای تمام‌شده", <Money v={d.cost_value ?? 0} />], ["سود (زیان) معامله", <Money v={d.profit ?? 0} colored />]] as [string, ReactNode][]) : []),
                ...(d.kind === "exchange" && d.market_rate ? ([["نرخ روز ارز دریافتی", <span className="sf-num">{rateLabel(d.market_rate, baseDp)}</span>]] as [string, ReactNode][]) : []),
                ["درآمد کارمزد", <Money v={d.fee_base ?? 0} zero="—" />],
                ["سند حسابداری", d.voucher_id ? <Link className="sf-link" to={`/${orgId}/accounting/vouchers/${d.voucher_id}`}>سند {faDigits(d.voucher_no ?? "")}</Link> : "—"],
              ]}
            />
          </Section>
          <Section title="طرف‌های معامله">
            <Facts
              cols={1}
              items={[
                ["مشتری", d.party_id ? <Link className="sf-link" to={`/${orgId}/parties/${d.party_id}`}>{d.party_name}</Link> : customer],
                ["دریافت در", `${d.in_method_fa}${d.in_ref_name ? `، ${d.in_ref_name}` : ""}`],
                ["پرداخت از", `${d.out_method_fa}${d.out_ref_name ? `، ${d.out_ref_name}` : ""}`],
                ["نشانی مقصد", d.address ? <a href={d.network && EXPLORER[d.network] ? `${EXPLORER[d.network].address}${d.address}` : undefined} target="_blank" rel="noreferrer" className="sf-mono sf-link">{maskMiddle(d.address, 8)}</a> : null],
                ["تراکنش", d.tx_hash ? <a href={d.network && EXPLORER[d.network] ? `${EXPLORER[d.network].tx}${d.tx_hash}` : undefined} target="_blank" rel="noreferrer" className="sf-mono sf-link">{maskMiddle(d.tx_hash, 8)}</a> : null],
              ]}
            />
          </Section>
        </div>
      </div>

      <Modal
        open={cancelOpen}
        onCancel={() => setCancelOpen(false)}
        title="ابطال معامله"
        okText="ابطال"
        okButtonProps={{ danger: true }}
        cancelText="انصراف"
        destroyOnHidden
        onOk={async () => {
          await act(() => api.post(`/fx/deals/${d.id}/cancel`, { reason: reason || null }), "معامله باطل شد");
          setCancelOpen(false);
          setReason("");
        }}
      >
        <div className="mb-3 text-[14px] text-ink-2">سند حسابداری این معامله حذف می‌شود.</div>
        <Input.TextArea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="دلیل ابطال (اختیاری)" autoSize={{ minRows: 2 }} />
      </Modal>
    </div>
  );
}
