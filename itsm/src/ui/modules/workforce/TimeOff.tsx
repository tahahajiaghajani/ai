// «مرخصی و غیبت» (WFM-016/017): the person's own time off — a request (type, from–to, delegate, note) that goes to their
// manager or their team's lead through the approvals service, its state and working days, and cancelling it. While
// approved time off runs the person is out of office: the platform's assignment rules skip them and the delegate works
// their assigned records.
import { useState } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Popconfirm, Select } from "antd";
import { ABSENCE_TYPES } from "@shared/tables/workforce";
import { toFa } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, JDateTime, Loader } from "../../components/display";
import { Card, Field } from "../../components/blocks";
import { DateTimeInput, recordPath, UserSelect } from "../../records";
import { WFM_KEYS, wfmApi } from "./api";
import "./workforce.css";

const STATE: Record<string, { label: string; tone: "in" | "warning" | "danger" | "neutral" }> = {
  requested: { label: "در انتظار تأیید", tone: "warning" },
  approved: { label: "تأییدشده", tone: "in" },
  ended: { label: "پایان‌یافته", tone: "neutral" },
  rejected: { label: "ردشده", tone: "danger" },
  canceled: { label: "لغوشده", tone: "neutral" },
};

export default function TimeOff() {
  const { api, orgId, timezone } = useOrg();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: WFM_KEYS.absences(orgId), queryFn: () => wfmApi.absences(api) });
  const [type, setType] = useState("annual");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [delegate, setDelegate] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const refresh = () => {
    qc.invalidateQueries({ queryKey: WFM_KEYS.absences(orgId) });
    qc.invalidateQueries({ queryKey: WFM_KEYS.home(orgId) });
  };
  const send = useAction(() => wfmApi.requestAbsence(api, { type, start_at: from, end_at: to, delegate_id: delegate, note: note || null }), {
    success: (d) => `درخواست ${d.number ?? ""} برای تأیید فرستاده شد`,
    onSuccess: () => { setFrom(null); setTo(null); setNote(""); refresh(); },
  });
  const cancel = useAction((id: string) => wfmApi.cancelAbsence(api, id), { success: "لغو شد", onSuccess: refresh });
  const rows = q.data?.absences ?? [];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="مرخصی و غیبت" />
      <Card title="درخواست تازه">
        <div className="wfm-form">
          <Field label="نوع"><Select value={type} onChange={setType} options={ABSENCE_TYPES.map((o) => ({ value: o.value, label: o.label }))} /></Field>
          <Field label="از"><DateTimeInput value={from} onChange={setFrom} tz={timezone} /></Field>
          <Field label="تا"><DateTimeInput value={to} onChange={setTo} tz={timezone} /></Field>
          <Field label="جانشین" hint="در این بازه کارهای ارجاع‌شده به شما را می‌بیند و پیش می‌برد"><UserSelect value={delegate} onChange={(v) => setDelegate(v as string | null)} /></Field>
          <Field label="توضیح"><Input.TextArea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} autoSize={{ minRows: 1, maxRows: 4 }} /></Field>
        </div>
        <Button type="primary" disabled={!from || !to} loading={send.isPending} onClick={() => send.mutate(undefined)}>فرستادن برای تأیید</Button>
      </Card>
      <Card title="درخواست‌های من">
        {q.isLoading ? <Loader /> : !rows.length ? <EmptyState compact title="هنوز درخواستی نفرستاده‌اید" /> : (
          <table className="wfm-people">
            <thead><tr><th scope="col" className="text-start">مرخصی</th><th scope="col">از</th><th scope="col">تا</th><th scope="col">روز کاری</th><th scope="col">وضعیت</th><th scope="col" /></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <th scope="row" className="text-start font-normal"><Link className="ds-link" to={`/${orgId}/${recordPath("wfm_absence", a.id)}`}>{ABSENCE_TYPES.find((o) => o.value === a.type)?.label ?? a.type}</Link> <span className="ds-latin text-ink-3 text-[12px]">{a.number}</span></th>
                  <td><JDateTime v={a.start_at} /></td>
                  <td><JDateTime v={a.end_at} /></td>
                  <td className="ds-num">{a.days === null ? "—" : toFa(a.days)}</td>
                  <td><Chip tone={STATE[a.state]?.tone ?? "neutral"} title={a.reject_reason ?? undefined}>{STATE[a.state]?.label ?? a.state}</Chip></td>
                  <td>{["requested", "approved"].includes(a.state) ? <Popconfirm title="این مرخصی لغو شود؟" okText="لغو کن" cancelText="نه" onConfirm={() => cancel.mutate(a.id)}><Button size="small">لغو</Button></Popconfirm> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
