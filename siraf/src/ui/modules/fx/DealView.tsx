// One exchange deal: the customer's receipt (A5 or 80 mm thermal, amounts in words) and the
// accounting side (value, average cost, profit, voucher), with edit / post / cancel actions.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Dropdown, Input, Modal, Segmented, Spin, Tag } from "antd";
import { PrinterOutlined, EditOutlined, StopOutlined, CheckCircleOutlined, DeleteOutlined, MoreOutlined, PlusOutlined, FileTextOutlined, CopyOutlined } from "@ant-design/icons";
import { useOrg } from "../../lib/org";
import { useLocalState, useNotify } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { PageHeader, Section } from "../../components/layout";
import { Money, StatusTag, JDateTime } from "../../components/display";
import { D } from "@shared/money";
import { faDigits, maskMiddle } from "@shared/format";
import { formatJalali, formatJalaliDateTime } from "@shared/jalali";
import { numberToWords } from "@shared/words";
import { CHAINS } from "@shared/entities";
import { DEAL_STATUS, EXPLORER, Facts, FxAmount, KIND_COLOR, KIND_FA, rateLabel } from "./shared";

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

  if (q.isLoading) return <div className="grid h-64 place-content-center"><Spin /></div>;
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
        title={`معامله‌ی ارز ش ${faDigits(d.no)}`}
        subtitle={<>ثبت: <JDateTime v={d.created_at} />{d.created_by_name ? ` · ${d.created_by_name}` : ""}</>}
        extra={
          <div className="flex gap-1">
            <Tag color={KIND_COLOR[d.kind]} variant="filled">{KIND_FA[d.kind]}</Tag>
            <StatusTag s={d.status} map={DEAL_STATUS} />
          </div>
        }
        actions={
          <>
            <Segmented size="small" value={paper} onChange={(v) => setPaper(v as "a5" | "80mm")} options={[{ value: "a5", label: "A5" }, { value: "80mm", label: "۸۰ میلی‌متر" }]} />
            <Button icon={<PrinterOutlined />} onClick={() => window.print()}>چاپ رسید</Button>
            {can("fx", "edit") ? <Button icon={<PlusOutlined />} onClick={() => nav(`/${orgId}/fx/deals/new`)}>معامله‌ی بعدی</Button> : null}
            {editable ? <Button type="primary" icon={<EditOutlined />} onClick={() => nav(`/${orgId}/fx/deals/${d.id}/edit`)}>ویرایش</Button> : null}
            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  ...(d.status !== "posted" && can("fx", "edit") ? [{ key: "post", icon: <CheckCircleOutlined />, label: d.status === "cancelled" ? "ثبت دوباره" : "ثبت قطعی معامله", onClick: () => act(() => api.post(`/fx/deals/${d.id}/post`), "معامله ثبت شد") }] : []),
                  ...(d.status !== "cancelled" && can("fx", "edit") ? [{ key: "cancel", icon: <StopOutlined />, danger: true, label: "ابطال معامله", onClick: () => setCancelOpen(true) }] : []),
                  { key: "copy", icon: <CopyOutlined />, label: "معامله‌ی مشابه", onClick: () => nav(`/${orgId}/fx/deals/new?give=${d.in_code}&get=${d.out_code}`) },
                  ...(can("fx", "full")
                    ? [{
                        key: "del",
                        icon: <DeleteOutlined />,
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
              <Button icon={<MoreOutlined />} aria-label="بیشتر" />
            </Dropdown>
          </>
        }
      />
      {d.status === "cancelled" ? <Alert className="!mb-4 no-print" type="error" showIcon title={`این معامله باطل شده است${d.cancel_reason ? `: ${d.cancel_reason}` : ""}`} /> : null}
      {d.status === "draft" ? <Alert className="!mb-4 no-print" type="warning" showIcon title="پیش‌نویس است و هنوز سند حسابداری ندارد" /> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] print:block">
        <div className="min-w-0">
          <style>{paper === "80mm" ? "@media print { @page { size: 80mm auto; margin: 3mm; } }" : "@media print { @page { size: A5; margin: 8mm; } }"}</style>
          <div className={`print-sheet tz-card mx-auto w-full p-5 ${paper === "80mm" ? "max-w-[80mm] text-[11px]" : "max-w-[148mm]"}`}>
            <div className="mb-3 flex items-center gap-3 border-b border-line pb-3">
              {org.logo ? <img src={org.logo} alt="" className={`${paper === "80mm" ? "h-8 w-8" : "h-12 w-12"} rounded object-cover`} /> : null}
              <div className="min-w-0 flex-1">
                <div className={`${paper === "80mm" ? "text-sm" : "text-lg"} font-extrabold`}>{org.name}</div>
                {org.phone || org.address ? <div className="truncate text-[10px] text-muted">{[org.phone, org.address].filter(Boolean).map((x) => faDigits(String(x))).join(" · ")}</div> : null}
              </div>
              <div className="text-end">
                <div className="font-bold">رسید {KIND_FA[d.kind]}</div>
                <div className="num text-xs text-muted">ش {faDigits(d.no)}</div>
              </div>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-1 text-xs">
              <div>تاریخ: <b className="num">{formatJalali(d.date)}</b></div>
              <div className="text-end">ساعت: <b className="num">{formatJalaliDateTime(d.created_at).split(" ")[1] ?? ""}</b></div>
              <div className="col-span-2">مشتری: <b>{customer}</b>{d.party_mobile ? <span className="num"> · {faDigits(d.party_mobile)}</span> : d.walkin?.mobile ? <span className="num"> · {faDigits(d.walkin.mobile)}</span> : null}</div>
              {d.walkin?.national_id || d.party_national_id ? <div className="col-span-2">کد ملی: <b className="num">{faDigits(d.walkin?.national_id ?? d.party_national_id)}</b></div> : null}
              {d.walkin?.passport_no ? <div className="col-span-2">گذرنامه: <b className="ltr">{d.walkin.passport_no}</b> {d.walkin.nationality ? `(${d.walkin.nationality})` : ""}</div> : null}
            </div>

            <div className="grid gap-2">
              <div className="rounded-lg border border-line p-2.5">
                <div className="text-[11px] text-muted">دریافت از مشتری</div>
                <div className="flex items-baseline justify-between gap-2">
                  <b className={paper === "80mm" ? "text-base" : "text-xl"}><FxAmount v={d.in_amount} code={d.in_code === org.base_currency ? unit : d.in_code} dp={dpIn} /></b>
                  <span className="text-[10px] text-muted">{d.in_method_fa}{d.in_ref_name ? `: ${d.in_ref_name}` : ""}</span>
                </div>
                <div className="text-[11px] leading-5">{numberToWords(d.in_amount)} {nameOf(d.in_code, d.in_name)}</div>
              </div>
              <div className="rounded-lg border border-line p-2.5">
                <div className="text-[11px] text-muted">پرداخت به مشتری</div>
                <div className="flex items-baseline justify-between gap-2">
                  <b className={paper === "80mm" ? "text-base" : "text-xl"}><FxAmount v={d.out_amount} code={d.out_code === org.base_currency ? unit : d.out_code} dp={dpOut} /></b>
                  <span className="text-[10px] text-muted">{d.out_method_fa}{d.out_ref_name ? `: ${d.out_ref_name}` : ""}</span>
                </div>
                <div className="text-[11px] leading-5">{numberToWords(d.out_amount)} {nameOf(d.out_code, d.out_name)}</div>
              </div>
            </div>

            <div className="mt-3 grid gap-1 text-xs">
              <div className="flex justify-between">
                <span>نرخ</span>
                <b className="num">{d.kind === "exchange" ? <span className="ltr">1 {d.in_code} = {rateLabel(d.rate)} {d.out_code}</span> : `${rateLabel(d.rate, baseDp)} ${unit}`}</b>
              </div>
              {!D(d.fee).isZero() ? (
                <div className="flex justify-between">
                  <span>کارمزد</span>
                  <b><FxAmount v={d.fee} code={d.fee_code === org.base_currency || !d.fee_code ? unit : d.fee_code} dp={d.fee_code && d.fee_code !== org.base_currency ? Number(d.fee_decimals ?? 2) : baseDp} /></b>
                </div>
              ) : null}
              {!D(d.fee).isZero() && (d.fee_currency_id === d.in_currency_id) ? (
                <div className="flex justify-between border-t border-dashed border-line pt-1">
                  <span>جمع دریافتی</span>
                  <b><FxAmount v={D(d.in_amount).plus(D(d.fee)).toFixed()} code={d.in_code === org.base_currency ? unit : d.in_code} dp={dpIn} /></b>
                </div>
              ) : null}
              {d.network || d.address || d.tx_hash ? (
                <div className="mt-1 grid gap-0.5 rounded-md bg-surface-2 p-2">
                  {d.network ? <div>شبکه: <b className="ltr">{chain}</b></div> : null}
                  {d.address ? <div className="break-all">نشانی: <span className="ltr font-mono text-[10px]">{d.address}</span></div> : null}
                  {d.tx_hash ? <div className="break-all">TxID: <span className="ltr font-mono text-[10px]">{d.tx_hash}</span></div> : null}
                  {!D(d.network_fee).isZero() ? <div>کارمزد شبکه: <FxAmount v={d.network_fee} code={d.out_code} dp={dpOut} /></div> : null}
                </div>
              ) : null}
              {d.description ? <div className="mt-1">توضیحات: {d.description}</div> : null}
            </div>
            <div className="mt-6 grid grid-cols-2 gap-6 text-center text-[11px] text-muted">
              <div className="border-t border-line pt-1">امضای مشتری</div>
              <div className="border-t border-line pt-1">مهر و امضای صرافی</div>
            </div>
            <div className="mt-3 text-center text-[10px] text-muted">{d.status === "cancelled" ? "— باطل شده —" : "از اعتماد شما سپاسگزاریم"}</div>
          </div>
        </div>

        <div className="no-print grid content-start gap-4">
          <Section title="حسابداری معامله">
            <Facts
              cols={1}
              items={[
                ["ارزش معامله", <Money v={d.base_value ?? 0} unit />],
                ...(d.kind !== "buy" ? ([["میانگین بهای ارز", d.avg_cost ? <span className="num">{rateLabel(d.avg_cost, baseDp)}</span> : "—"], ["بهای تمام‌شده", <Money v={d.cost_value ?? 0} />], ["سود (زیان) معامله", <Money v={d.profit ?? 0} colored />]] as [string, ReactNode][]) : []),
                ...(d.kind === "exchange" && d.market_rate ? ([["نرخ روز ارز دریافتی", <span className="num">{rateLabel(d.market_rate, baseDp)}</span>]] as [string, ReactNode][]) : []),
                ["درآمد کارمزد", <Money v={d.fee_base ?? 0} />],
                ["سند حسابداری", d.voucher_id ? <Link to={`/${orgId}/accounting/vouchers/${d.voucher_id}`}><FileTextOutlined /> سند ش {faDigits(d.voucher_no ?? "")}</Link> : "—"],
              ]}
            />
          </Section>
          <Section title="طرف‌های معامله">
            <Facts
              cols={1}
              items={[
                ["مشتری", d.party_id ? <Link to={`/${orgId}/parties/${d.party_id}`}>{d.party_name}</Link> : customer],
                ["دریافت در", `${d.in_method_fa}${d.in_ref_name ? ` — ${d.in_ref_name}` : ""}`],
                ["پرداخت از", `${d.out_method_fa}${d.out_ref_name ? ` — ${d.out_ref_name}` : ""}`],
                ["نشانی مقصد", d.address ? <a href={d.network && EXPLORER[d.network] ? `${EXPLORER[d.network].address}${d.address}` : undefined} target="_blank" rel="noreferrer" className="ltr font-mono text-xs">{maskMiddle(d.address, 8)}</a> : null],
                ["تراکنش", d.tx_hash ? <a href={d.network && EXPLORER[d.network] ? `${EXPLORER[d.network].tx}${d.tx_hash}` : undefined} target="_blank" rel="noreferrer" className="ltr font-mono text-xs">{maskMiddle(d.tx_hash, 8)}</a> : null],
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
        <div className="mb-2 text-sm">سند حسابداری این معامله حذف می‌شود.</div>
        <Input.TextArea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="دلیل ابطال (اختیاری)" autoSize={{ minRows: 2 }} />
      </Modal>
    </div>
  );
}
