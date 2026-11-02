// One remittance: printable slip (tracking code with QR), the people and amounts, the status
// actions allowed from here (send, paid, cancel, return, undo) and the history of changes.
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Drawer, Dropdown, Input, Modal } from "antd";
import { Ban, CircleCheck, Copy, Ellipsis, Pencil, Printer, Send, Trash2, Undo2 } from "lucide-react";
import { Ic } from "../../components/shell/icons";
import QRCode from "qrcode";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { PageHeader, Section } from "../../components/layout";
import { DateInput } from "../../components/inputs";
import { JDateTime, Loader, Money, StatusTag } from "../../components/display";
import { D } from "@shared/money";
import { faDigits, groupDigits } from "@shared/format";
import { formatJalali, todayISO } from "@shared/jalali";
import { numberToWords } from "@shared/words";
import { Facts, FxAmount, METHOD_FA, REM_STATUS, STATUS_ACTION, rateLabel, type Method } from "./shared";
import { RemittanceForm } from "./RemittanceForm";

const ICON: Record<string, React.ReactNode> = { sent: <Ic icon={Send} />, paid: <Ic icon={CircleCheck} />, cancelled: <Ic icon={Ban} />, returned: <Ic icon={Undo2} />, pending: <Ic icon={Undo2} /> };

export default function RemittanceView() {
  const { id } = useParams();
  const { api, orgId, can, org, unit } = useOrg();
  const nav = useNavigate();
  const qc = useQueryClient();
  const n = useNotify();
  const [edit, setEdit] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [actDate, setActDate] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["fx-remittance", id], queryFn: () => api.get(`/fx/remittances/${id}`).then((r) => r.remittance) });
  const r = q.data;
  useEffect(() => {
    if (!r?.tracking_code) return;
    QRCode.toDataURL(String(r.tracking_code), { margin: 1, width: 132 }).then(setQr).catch(() => setQr(null));
  }, [r?.tracking_code]);

  if (q.isLoading) return <div className="grid h-64 place-content-center"><Loader /></div>;
  if (q.error || !r) return <Alert type="error" title={errorText(q.error)} />;

  const baseDp = org.money_decimals ?? 0;
  const isBase = (code: string) => code === org.base_currency;
  const dpX = isBase(r.currency_code) ? baseDp : Number(r.currency_decimals ?? 2);
  const dpP = isBase(r.pay_currency_code ?? org.base_currency) ? baseDp : Number(r.pay_currency_decimals ?? 2);
  const out = r.direction === "out";
  const live = r.status !== "cancelled" && r.status !== "returned";
  const tz = (org.settings?.timezone as string) || "Asia/Tehran";
  const primaryNext = can("fx", "edit") ? (r.next_statuses as string[]).find((x) => x === "sent" || x === "paid") ?? null : null;

  const change = async () => {
    if (!action) return;
    setBusy(true);
    try {
      await api.post(`/fx/remittances/${r.id}/status`, { status: action, date: actDate, note: note || null });
      n.ok(`وضعیت حواله «${REM_STATUS[action]?.[0] ?? action}» شد`);
      setAction(null);
      setNote("");
      q.refetch();
      qc.invalidateQueries({ queryKey: ["table"] });
      qc.invalidateQueries({ queryKey: ["fx-correspondents"] });
      qc.invalidateQueries({ queryKey: ["fx-summary"] });
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        back={`/${orgId}/fx/remittances`}
        title={`حواله‌ی ${out ? "صادره" : "وارده"} ${faDigits(r.no)}`}
        subtitle={
          <span className="sf-doc-meta">
            <RemStatus s={r.status} />
            <span className="sf-sep" aria-hidden />
            <span>کد رهگیری <bdi dir="ltr" className="sf-num text-ink-2">{faDigits(groupDigits(r.tracking_code ?? "", 4))}</bdi></span>
          </span>
        }
        actions={
          <>
            <Dropdown
              trigger={["click"]}
              placement="bottomLeft"
              menu={{
                items: [
                  ...(can("fx", "edit") && live ? [{ key: "edit", icon: <Ic icon={Pencil} />, label: "ویرایش حواله", onClick: () => setEdit(true) }] : []),
                  ...(can("fx", "edit") ? (r.next_statuses as string[]).filter((x) => x !== primaryNext).map((x) => ({ key: x, icon: ICON[x], danger: x === "cancelled" || x === "returned", label: STATUS_ACTION[x] ?? x, onClick: () => { setAction(x); setActDate(todayISO(tz)); } })) : []),
                  ...(can("fx", "full") && r.status !== "paid"
                    ? [{ type: "divider" as const }, {
                        key: "del",
                        icon: <Ic icon={Trash2} />,
                        danger: true,
                        label: "حذف حواله",
                        onClick: async () => {
                          if (!(await n.confirm("حذف این حواله و سندهای آن؟", undefined, true))) return;
                          try {
                            await api.del(`/fx/remittances/${r.id}`);
                            n.ok("حواله حذف شد");
                            qc.invalidateQueries({ queryKey: ["table"] });
                            nav(`/${orgId}/fx/remittances`);
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
            <Button type={primaryNext ? "default" : "primary"} icon={<Ic icon={Printer} />} onClick={() => window.print()}>چاپ رسید</Button>
            {primaryNext ? (
              <Button type="primary" icon={ICON[primaryNext]} onClick={() => { setAction(primaryNext); setActDate(todayISO(tz)); }}>
                {STATUS_ACTION[primaryNext] ?? primaryNext}
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] print:block">
        <div className="print-sheet sf-card p-6 shadow-e2">
          <div className="mb-4 flex items-start gap-4 border-b border-line pb-4">
            {org.logo ? <img src={org.logo} alt="" className="h-12 w-12 rounded object-cover" /> : null}
            <div className="min-w-0 flex-1">
              <div className="text-lg font-semibold">{org.name}</div>
              <div className="text-[13px] text-ink-2">رسید حواله‌ی {out ? "صادره" : "وارده"}، شماره‌ی <span className="sf-docno">{faDigits(r.no)}</span>، <span className="sf-num">{formatJalali(r.date)}</span></div>
              <div className="mt-3 text-[12px] text-ink-3">کد رهگیری</div>
              <div><bdi dir="ltr" className="sf-num text-2xl font-semibold">{faDigits(groupDigits(r.tracking_code ?? "", 4))}</bdi></div>
            </div>
            {qr ? <img src={qr} alt="" className="h-24 w-24" /> : null}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="sf-sec-t">فرستنده</div>
              <Facts cols={1} items={[["نام", r.sender?.name ?? r.party_name], ["کد ملی", r.sender?.national_id ? <span className="sf-num">{faDigits(r.sender.national_id)}</span> : null], ["گذرنامه", r.sender?.passport_no], ["موبایل", r.sender?.mobile ? <span className="sf-num">{faDigits(r.sender.mobile)}</span> : null], ["کشور", r.sender?.country], ["نشانی", r.sender?.address]]} />
            </div>
            <div>
              <div className="sf-sec-t">ذی‌نفع</div>
              <Facts cols={1} items={[["نام", r.beneficiary?.name], ["کشور و شهر", [r.beneficiary?.country, r.beneficiary?.city].filter(Boolean).join("، ")], ["بانک", r.beneficiary?.bank], ["حساب", r.beneficiary?.account ? <bdi dir="ltr" className="sf-mono">{r.beneficiary.account}</bdi> : null], ["کد ملی", r.beneficiary?.national_id ? <span className="sf-num">{faDigits(r.beneficiary.national_id)}</span> : null], ["گذرنامه", r.beneficiary?.passport_no], ["موبایل", r.beneficiary?.mobile ? <span className="sf-num">{faDigits(r.beneficiary.mobile)}</span> : null], ["نسبت", r.beneficiary?.relation]]} />
            </div>
          </div>
          <div className="mt-5 rounded-lg p-4 shadow-[inset_0_0_0_1px_var(--sf-line-2)]">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[13px] text-ink-3">مبلغ حواله</span>
              <b className="text-2xl font-semibold"><FxAmount v={r.amount} code={isBase(r.currency_code) ? unit : r.currency_code} dp={dpX} /></b>
            </div>
            <div className="mt-1 text-[12px] text-ink-3">{numberToWords(r.amount)} {isBase(r.currency_code) ? unit : r.currency_name}</div>
            <div className="sf-sums is-flat mt-3">
              {!isBase(r.currency_code) ? <div className="r"><span>نرخ</span><span className="n">{rateLabel(r.rate, baseDp)}<span className="sf-unit">{"\u00a0"}{unit}</span></span></div> : null}
              <div className="r"><span>معادل</span><span className="n"><Money v={r.base_amount ?? 0} unit /></span></div>
              {!D(r.fee).isZero() ? <div className="r"><span>{out ? "کارمزد" : "کارمزد (از همکار)"}</span><span className="n"><FxAmount v={r.fee} code={out ? (isBase(r.pay_currency_code ?? org.base_currency) ? unit : r.pay_currency_code) : r.currency_code} dp={out ? dpP : dpX} /></span></div> : null}
              <div className="r is-total">
                <span>{out ? "دریافتی از مشتری" : "پرداختی به ذی‌نفع"}</span>
                <span className="n"><FxAmount v={r.pay_amount ?? 0} code={isBase(r.pay_currency_code ?? org.base_currency) ? unit : r.pay_currency_code} dp={dpP} /></span>
              </div>
            </div>
          </div>
          <div className="mt-3 text-[13px] text-ink-2">همکار: <b className="font-semibold text-ink">{r.correspondent_name}</b>{r.description ? `، ${r.description}` : ""}</div>
          <div className="mt-10 grid grid-cols-2 gap-8 text-center text-[12px] text-ink-3">
            <div className="border-t border-line-3 pt-1.5">امضای {out ? "فرستنده" : "ذی‌نفع"}</div>
            <div className="border-t border-line-3 pt-1.5">مهر و امضای صرافی</div>
          </div>
        </div>

        <div className="no-print grid content-start gap-4">
          <Section title="مسیر حواله">
            <RemRoute
              from={out ? org.city || org.name : [r.sender?.country, r.sender?.city].filter(Boolean).join("، ") || r.correspondent_name}
              fromSub={out ? (r.sender?.name ?? r.party_name ?? "") : r.correspondent_name}
              to={out ? [r.beneficiary?.country, r.beneficiary?.city].filter(Boolean).join("، ") || r.correspondent_name : org.city || org.name}
              toSub={r.beneficiary?.name ?? ""}
              paid={r.status === "paid"}
              dead={!live}
            />
          </Section>
          <Section title="جزئیات">
            <Facts
              cols={1}
              items={[
                ["همکار", r.correspondent_id ? <Link className="sf-link" to={`/${orgId}/parties/${r.correspondent_id}`}>{r.correspondent_name}</Link> : "—"],
                ["مشتری", r.party_id ? <Link className="sf-link" to={`/${orgId}/parties/${r.party_id}`}>{r.party_name}</Link> : null],
                [out ? "دریافت در" : "پرداخت از", `${METHOD_FA[r.pay_method as Method] ?? r.pay_method}${r.pay_ref_name ? `، ${r.pay_ref_name}` : ""}`],
                ["کارمزد همکار", !D(r.correspondent_fee).isZero() ? <FxAmount v={r.correspondent_fee} code={r.currency_code} dp={dpX} /> : null],
                ["درآمد کارمزد", <Money v={r.fee_base ?? 0} />],
                ["تاریخ پرداخت", r.paid_date ? <span className="sf-num">{formatJalali(r.paid_date)}</span> : null],
                ["سند ثبت", r.voucher_id ? <Link className="sf-link" to={`/${orgId}/accounting/vouchers/${r.voucher_id}`}>سند {faDigits(r.voucher_no ?? "")}</Link> : null],
                ["سند پرداخت", r.paid_voucher_id ? <Link className="sf-link" to={`/${orgId}/accounting/vouchers/${r.paid_voucher_id}`}>سند {faDigits(r.paid_voucher_no ?? "")}</Link> : null],
                ["کد رهگیری", <button type="button" className="inline-flex items-center gap-1.5 border-0 bg-transparent p-0 text-ink-2" onClick={() => navigator.clipboard?.writeText(String(r.tracking_code ?? "")).then(() => n.note("رونوشت شد."))} aria-label="رونوشت کد رهگیری"><Ic icon={Copy} size={14} className="text-ink-3" /><bdi dir="ltr" className="sf-num">{faDigits(r.tracking_code ?? "")}</bdi></button>],
              ]}
            />
          </Section>
          <Section title="تاریخچه">
            <ol className="m-0 grid list-none gap-3 p-0">
              {[...(r.history ?? [])].reverse().map((h: any, i: number) => (
                <li key={i} className="flex gap-3">
                  <span className={`sf-dot mt-2 ${h.status === "paid" ? "text-in" : h.status === "cancelled" || h.status === "returned" ? "text-danger" : "text-ink-3"}`} aria-hidden />
                  <div className="min-w-0 text-[13px]">
                    <div className="flex items-center gap-2"><span className="font-medium text-ink">{REM_STATUS[h.status]?.[0] ?? h.status}</span>{h.date ? <span className="sf-num text-ink-3">{formatJalali(h.date)}</span> : null}</div>
                    {h.note ? <div className="mt-0.5 text-ink-2">{h.note}</div> : null}
                    <div className="mt-0.5 text-[12px] text-ink-3"><JDateTime v={h.at} />{h.user ? `، ${h.user}` : ""}</div>
                  </div>
                </li>
              ))}
            </ol>
          </Section>
        </div>
      </div>

      <Modal
        open={!!action}
        onCancel={() => setAction(null)}
        title={action ? STATUS_ACTION[action] : ""}
        okText="تأیید"
        cancelText="انصراف"
        confirmLoading={busy}
        okButtonProps={{ danger: action === "cancelled" || action === "returned" }}
        onOk={change}
        destroyOnHidden
      >
        <div className="grid gap-3">
          {action === "paid" ? <div className="text-[14px] text-ink-2">{out ? "همکار وجه را به ذی‌نفع پرداخت کرد؛ بدهی به همکار ثبت می‌شود." : "وجه به ذی‌نفع پرداخت می‌شود و طلب از همکار ثبت می‌شود."}</div> : null}
          {action === "cancelled" || action === "returned" ? <div className="text-[14px] text-danger">سندهای حسابداری این حواله حذف می‌شوند.</div> : null}
          <label className="block">
            <div className="sf-field-l mb-1.5">تاریخ</div>
            <DateInput value={actDate} onChange={setActDate} />
          </label>
          <Input.TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder="یادداشت (اختیاری)" autoSize={{ minRows: 2 }} />
        </div>
      </Modal>

      <Drawer open={edit} onClose={() => setEdit(false)} size={900} title={`ویرایش حواله‌ی ${faDigits(r.no)}`} destroyOnHidden>
        {edit ? <RemittanceForm initial={r} compact onSaved={() => { setEdit(false); q.refetch(); }} /> : null}
      </Drawer>
    </div>
  );
}

/** Status of a remittance: «در راه» (sent) is a neutral chip with a sea nuqta; the normal state is plain text. */
function RemStatus({ s }: { s: string }) {
  if (s === "sent") return <span className="sf-chip" data-tone="neutral"><i className="sf-nuqta is-sea" aria-hidden /><span>در راه</span></span>;
  return <StatusTag s={s} map={REM_STATUS} />;
}

/** The remittance route (components.md §4.8): origin and destination nuqtas joined by a sea line; until paid the
 *  destination is hollow; on paid the line draws and the end nuqta fills. */
function RemRoute({ from, fromSub, to, toSub, paid, dead }: { from: string; fromSub?: string; to: string; toSub?: string; paid: boolean; dead: boolean }) {
  return (
    <div className="sf-route" aria-label={`از ${from} به ${to}${paid ? "، پرداخت شد" : ""}`}>
      <div className="end">
        <small>مبدأ</small>
        <b>{from}</b>
        {fromSub ? <small>{fromSub}</small> : null}
      </div>
      <div className="sf-route-line" aria-hidden>
        <svg viewBox="0 0 100 12" preserveAspectRatio="none">
          <line className="ln" x1="96" y1="6" x2="4" y2="6" pathLength={100} style={dead ? { strokeDasharray: "3 3" } : undefined} />
          {paid ? <line className="ln is-drawn" x1="96" y1="6" x2="4" y2="6" pathLength={100} /> : null}
        </svg>
        <svg viewBox="0 0 12 12" className="nqs" style={{ insetInlineStart: -6 }}>
          <rect className="nq" x="3" y="3" width="6" height="6" transform="rotate(45 6 6)" />
        </svg>
        <svg viewBox="0 0 12 12" className="nqs" style={{ insetInlineEnd: -6 }}>
          <rect className={`nq ${paid ? "" : "is-hollow"}`} x="3" y="3" width="6" height="6" transform="rotate(45 6 6)" />
        </svg>
      </div>
      <div className="end">
        <small>مقصد</small>
        <b>{to}</b>
        {toSub ? <small>{toSub}</small> : null}
      </div>
    </div>
  );
}
