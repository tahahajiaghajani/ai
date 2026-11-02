// One remittance: printable slip (tracking code with QR), the people and amounts, the status
// actions allowed from here (send, paid, cancel, return, undo) and the history of changes.
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Drawer, Input, Modal, Spin, Tag } from "antd";
import { PrinterOutlined, EditOutlined, DeleteOutlined, SendOutlined, CheckCircleOutlined, StopOutlined, RollbackOutlined, UndoOutlined, FileTextOutlined, CopyOutlined } from "@ant-design/icons";
import QRCode from "qrcode";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { PageHeader, Section } from "../../components/layout";
import { DateInput } from "../../components/inputs";
import { Money, StatusTag, JDateTime } from "../../components/display";
import { D } from "@shared/money";
import { faDigits, groupDigits } from "@shared/format";
import { formatJalali, todayISO } from "@shared/jalali";
import { numberToWords } from "@shared/words";
import { Facts, FxAmount, METHOD_FA, REM_STATUS, STATUS_ACTION, rateLabel, type Method } from "./shared";
import { RemittanceForm } from "./RemittanceForm";

const ICON: Record<string, React.ReactNode> = { sent: <SendOutlined />, paid: <CheckCircleOutlined />, cancelled: <StopOutlined />, returned: <RollbackOutlined />, pending: <UndoOutlined /> };

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

  if (q.isLoading) return <div className="grid h-64 place-content-center"><Spin /></div>;
  if (q.error || !r) return <Alert type="error" title={errorText(q.error)} />;

  const baseDp = org.money_decimals ?? 0;
  const isBase = (code: string) => code === org.base_currency;
  const dpX = isBase(r.currency_code) ? baseDp : Number(r.currency_decimals ?? 2);
  const dpP = isBase(r.pay_currency_code ?? org.base_currency) ? baseDp : Number(r.pay_currency_decimals ?? 2);
  const out = r.direction === "out";
  const live = r.status !== "cancelled" && r.status !== "returned";
  const tz = (org.settings?.timezone as string) || "Asia/Tehran";

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
        title={`حواله‌ی ${out ? "صادره" : "وارده"} ش ${faDigits(r.no)}`}
        subtitle={<>کد رهگیری <b className="num ltr">{faDigits(groupDigits(r.tracking_code ?? "", 4))}</b></>}
        extra={<div className="flex gap-1"><StatusTag s={r.status} map={REM_STATUS} /><Tag variant="filled" color={out ? "gold" : "cyan"}>{out ? "صادره" : "وارده"}</Tag></div>}
        actions={
          <>
            {can("fx", "edit")
              ? (r.next_statuses as string[]).map((s) => (
                  <Button
                    key={s}
                    icon={ICON[s]}
                    type={s === "paid" || s === "sent" ? "primary" : "default"}
                    danger={s === "cancelled" || s === "returned"}
                    onClick={() => { setAction(s); setActDate(todayISO(tz)); }}
                  >
                    {STATUS_ACTION[s] ?? s}
                  </Button>
                ))
              : null}
            <Button icon={<PrinterOutlined />} onClick={() => window.print()}>چاپ</Button>
            {can("fx", "edit") && live ? <Button icon={<EditOutlined />} onClick={() => setEdit(true)}>ویرایش</Button> : null}
            {can("fx", "full") && r.status !== "paid" ? (
              <Button
                danger
                icon={<DeleteOutlined />}
                aria-label="حذف"
                onClick={async () => {
                  if (!(await n.confirm("حذف این حواله و سندهای آن؟", undefined, true))) return;
                  try {
                    await api.del(`/fx/remittances/${r.id}`);
                    n.ok("حواله حذف شد");
                    qc.invalidateQueries({ queryKey: ["table"] });
                    nav(`/${orgId}/fx/remittances`);
                  } catch (e) {
                    n.error(e);
                  }
                }}
              />
            ) : null}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] print:block">
        <div className="print-sheet tz-card p-5">
          <div className="mb-4 flex items-start gap-4 border-b border-line pb-4">
            {org.logo ? <img src={org.logo} alt="" className="h-12 w-12 rounded object-cover" /> : null}
            <div className="min-w-0 flex-1">
              <div className="text-lg font-extrabold">{org.name}</div>
              <div className="text-sm">رسید حواله‌ی {out ? "صادره" : "وارده"} — ش {faDigits(r.no)} — {formatJalali(r.date)}</div>
              <div className="mt-2 text-xs text-muted">کد رهگیری</div>
              <div className="num ltr text-start text-2xl font-extrabold tracking-wider">{faDigits(groupDigits(r.tracking_code ?? "", 4))}</div>
            </div>
            {qr ? <img src={qr} alt="" className="h-24 w-24" /> : null}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="mb-2 text-xs font-bold text-muted">فرستنده</div>
              <Facts cols={1} items={[["نام", r.sender?.name ?? r.party_name], ["کد ملی", r.sender?.national_id ? <span className="num">{faDigits(r.sender.national_id)}</span> : null], ["گذرنامه", r.sender?.passport_no], ["موبایل", r.sender?.mobile ? <span className="num">{faDigits(r.sender.mobile)}</span> : null], ["کشور", r.sender?.country], ["نشانی", r.sender?.address]]} />
            </div>
            <div>
              <div className="mb-2 text-xs font-bold text-muted">ذی‌نفع</div>
              <Facts cols={1} items={[["نام", r.beneficiary?.name], ["کشور / شهر", [r.beneficiary?.country, r.beneficiary?.city].filter(Boolean).join(" — ")], ["بانک", r.beneficiary?.bank], ["حساب", r.beneficiary?.account ? <span className="ltr font-mono text-xs">{r.beneficiary.account}</span> : null], ["کد ملی", r.beneficiary?.national_id ? <span className="num">{faDigits(r.beneficiary.national_id)}</span> : null], ["گذرنامه", r.beneficiary?.passport_no], ["موبایل", r.beneficiary?.mobile ? <span className="num">{faDigits(r.beneficiary.mobile)}</span> : null], ["نسبت", r.beneficiary?.relation]]} />
            </div>
          </div>
          <div className="mt-4 rounded-lg border border-line p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-xs text-muted">مبلغ حواله</span>
              <b className="text-2xl"><FxAmount v={r.amount} code={isBase(r.currency_code) ? unit : r.currency_code} dp={dpX} /></b>
            </div>
            <div className="text-xs">{numberToWords(r.amount)} {isBase(r.currency_code) ? unit : r.currency_name}</div>
            <div className="mt-3 grid gap-1 text-sm">
              {!isBase(r.currency_code) ? <div className="flex justify-between"><span className="text-muted">نرخ</span><b className="num">{rateLabel(r.rate, baseDp)} {unit}</b></div> : null}
              <div className="flex justify-between"><span className="text-muted">معادل</span><Money v={r.base_amount ?? 0} unit /></div>
              {!D(r.fee).isZero() ? <div className="flex justify-between"><span className="text-muted">{out ? "کارمزد" : "کارمزد (از همکار)"}</span><FxAmount v={r.fee} code={out ? (isBase(r.pay_currency_code ?? org.base_currency) ? unit : r.pay_currency_code) : r.currency_code} dp={out ? dpP : dpX} /></div> : null}
              <div className="flex justify-between border-t border-dashed border-line pt-1 font-bold">
                <span>{out ? "دریافتی از مشتری" : "پرداختی به ذی‌نفع"}</span>
                <FxAmount v={r.pay_amount ?? 0} code={isBase(r.pay_currency_code ?? org.base_currency) ? unit : r.pay_currency_code} dp={dpP} />
              </div>
            </div>
          </div>
          <div className="mt-3 text-xs">همکار: <b>{r.correspondent_name}</b>{r.description ? ` · ${r.description}` : ""}</div>
          <div className="mt-8 grid grid-cols-2 gap-6 text-center text-[11px] text-muted">
            <div className="border-t border-line pt-1">امضای {out ? "فرستنده" : "ذی‌نفع"}</div>
            <div className="border-t border-line pt-1">مهر و امضای صرافی</div>
          </div>
        </div>

        <div className="no-print grid content-start gap-4">
          <Section title="جزئیات">
            <Facts
              cols={1}
              items={[
                ["همکار", r.correspondent_id ? <Link to={`/${orgId}/parties/${r.correspondent_id}`}>{r.correspondent_name}</Link> : "—"],
                ["مشتری", r.party_id ? <Link to={`/${orgId}/parties/${r.party_id}`}>{r.party_name}</Link> : null],
                [out ? "دریافت در" : "پرداخت از", `${METHOD_FA[r.pay_method as Method] ?? r.pay_method}${r.pay_ref_name ? ` — ${r.pay_ref_name}` : ""}`],
                ["کارمزد همکار", !D(r.correspondent_fee).isZero() ? <FxAmount v={r.correspondent_fee} code={r.currency_code} dp={dpX} /> : null],
                ["درآمد کارمزد", <Money v={r.fee_base ?? 0} />],
                ["تاریخ پرداخت", r.paid_date ? <span className="num">{formatJalali(r.paid_date)}</span> : null],
                ["سند ثبت", r.voucher_id ? <Link to={`/${orgId}/accounting/vouchers/${r.voucher_id}`}><FileTextOutlined /> سند ش {faDigits(r.voucher_no ?? "")}</Link> : null],
                ["سند پرداخت", r.paid_voucher_id ? <Link to={`/${orgId}/accounting/vouchers/${r.paid_voucher_id}`}><FileTextOutlined /> سند ش {faDigits(r.paid_voucher_no ?? "")}</Link> : null],
                ["کد رهگیری", <button type="button" className="num ltr text-brand" onClick={() => navigator.clipboard?.writeText(String(r.tracking_code ?? "")).then(() => n.ok("کد رهگیری کپی شد"))}><CopyOutlined /> {faDigits(r.tracking_code ?? "")}</button>],
              ]}
            />
          </Section>
          <Section title="تاریخچه">
            <ol className="m-0 grid list-none gap-3 p-0">
              {[...(r.history ?? [])].reverse().map((h: any, i: number) => (
                <li key={i} className="flex gap-3">
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${h.status === "paid" ? "bg-ok" : h.status === "cancelled" || h.status === "returned" ? "bg-bad" : "bg-brand"}`} />
                  <div className="min-w-0 text-sm">
                    <div><StatusTag s={h.status} map={REM_STATUS} /> {h.date ? <span className="num text-xs text-muted">{formatJalali(h.date)}</span> : null}</div>
                    {h.note ? <div className="mt-0.5 text-xs">{h.note}</div> : null}
                    <div className="mt-0.5 text-[11px] text-muted"><JDateTime v={h.at} />{h.user ? ` · ${h.user}` : ""}</div>
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
          {action === "paid" ? <div className="text-sm">{out ? "همکار وجه را به ذی‌نفع پرداخت کرد؛ بدهی به همکار ثبت می‌شود." : "وجه به ذی‌نفع پرداخت می‌شود و طلب از همکار ثبت می‌شود."}</div> : null}
          {action === "cancelled" || action === "returned" ? <div className="text-sm text-bad">سندهای حسابداری این حواله حذف می‌شوند.</div> : null}
          <label className="block">
            <div className="mb-1 text-xs text-muted">تاریخ</div>
            <DateInput value={actDate} onChange={setActDate} />
          </label>
          <Input.TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder="یادداشت (اختیاری)" autoSize={{ minRows: 2 }} />
        </div>
      </Modal>

      <Drawer open={edit} onClose={() => setEdit(false)} size={900} title={`ویرایش حواله‌ی ش ${faDigits(r.no)}`} destroyOnHidden>
        {edit ? <RemittanceForm initial={r} compact onSaved={() => { setEdit(false); q.refetch(); }} /> : null}
      </Drawer>
    </div>
  );
}
