// «دارایی‌های من» (catalogue ITAM-009/010): the assets handed to the person — also a requester without any role in
// the asset area, through the module's holder grant — with their acknowledgements to accept (signed with their full
// name) or decline, reports of a lost, broken or wrong asset (an incident filed as them), and for line managers the
// count of their team's assets.
import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Dropdown, Input, Modal, Space } from "antd";
import { CircleAlert, MonitorSmartphone, Signature } from "lucide-react";
import type { ReportKind } from "@shared/itam/api";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Card } from "../../components/blocks";
import { Chip, EmptyState, JDate, Loader } from "../../components/display";
import { RecordMarkdown } from "../../records";
import { itamApi, ITAM_KEYS, type MyAssets as Data } from "./api";
import { ICON } from "./parts";

const REPORTS: { key: ReportKind; label: string }[] = [
  { key: "broken", label: "خراب شده است" },
  { key: "lost", label: "گم یا سرقت شده است" },
  { key: "not_mine", label: "این دارایی من نیست" },
];

export default function MyAssets() {
  const { api, orgId } = useOrg();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const q = useQuery({ queryKey: ITAM_KEYS.mine(orgId), queryFn: () => itamApi.myAssets(api) });
  const [ack, setAck] = useState<Data["acks"][number] | null>(null);
  const [decline, setDecline] = useState(false);
  const [signature, setSignature] = useState("");
  const [note, setNote] = useState("");
  const [report, setReport] = useState<{ id: string; kind: ReportKind } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ITAM_KEYS.mine(orgId) });
  const decide = useMutation({
    mutationFn: () => itamApi.decideAck(api, ack!.id, decline ? { decision: "decline", note } : { decision: "accept", signature_name: signature, note: note || null }),
    onSuccess: () => {
      message.success(decline ? "پاسخ شما ثبت شد" : "تعهدنامه پذیرفته شد");
      setAck(null);
      refresh();
    },
    onError: (e: Error) => message.error(e.message),
  });
  const send = useMutation({
    mutationFn: () => itamApi.report(api, report!.id, report!.kind, note || null),
    onSuccess: (r) => {
      message.success(`گزارش شما با شمارهٔ ${r.number ?? ""} ثبت شد`);
      setReport(null);
      setNote("");
      refresh();
    },
    onError: (e: Error) => message.error(e.message),
  });
  const d = q.data;
  return (
    <div>
      <PageHeader title="دارایی‌های من" />
      {q.isLoading ? (
        <Loader />
      ) : !d || (!d.assets.length && !d.acks.length && !d.team.length) ? (
        <EmptyState title="دارایی‌ای به شما تحویل نشده است" description="وقتی رایانه، تلفن یا لوازمی تحویل بگیرید، این‌جا می‌بینید." icon={MonitorSmartphone} />
      ) : (
        <div className="flex flex-col gap-3">
          {d.acks.length ? (
            <Card title="تعهدنامه‌های در انتظار پاسخ شما">
              <ul className="itam-list">
                {d.acks.map((k) => (
                  <li key={k.id}>
                    <span>
                      {k.asset_label} {k.requested_at ? <span className="text-ink-3 text-[12px]">— <JDate v={k.requested_at.slice(0, 10)} /></span> : null}
                    </span>
                    <Button size="small" type="primary" icon={<Signature {...ICON} />} onClick={() => { setAck(k); setDecline(false); setSignature(""); setNote(""); }}>بررسی و پاسخ</Button>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <div className="itam-cards">
            {d.assets.map((a) => (
              <Card key={a.id} title={a.name} meta={<span className="ltr ds-num">{a.asset_tag ?? a.number}</span>}>
                <dl className="itam-dl">
                  <dt>مدل</dt>
                  <dd>{a.model ?? "—"}</dd>
                  <dt>سریال</dt>
                  <dd className="ltr">{a.serial_number ?? "—"}</dd>
                  <dt>وضعیت</dt>
                  <dd>
                    <Chip tone={a.state === "in_use" ? "in" : "neutral"}>{a.state_label}</Chip> {a.usage_type === "loaner" ? <Chip tone="warning">امانی</Chip> : null}
                  </dd>
                  {a.expected_return_at ? (<><dt>موعد بازگشت</dt><dd><JDate v={a.expected_return_at} /></dd></>) : null}
                  <dt>تحویل</dt>
                  <dd>{a.assigned_at ? <JDate v={a.assigned_at.slice(0, 10)} /> : "—"}</dd>
                  <dt>پایان ضمانت</dt>
                  <dd>{a.warranty_end ? <JDate v={a.warranty_end} /> : "—"}</dd>
                </dl>
                <div className="mt-2">
                  <Dropdown menu={{ items: REPORTS.map((r) => ({ key: r.key, label: r.label })), onClick: (e) => { setNote(""); setReport({ id: a.id, kind: e.key as ReportKind }); } }}>
                    <Button size="small" icon={<CircleAlert {...ICON} />}>گزارش</Button>
                  </Dropdown>
                </div>
              </Card>
            ))}
          </div>
          {d.team.length ? (
            <Card title="دارایی‌های اعضای تیم من">
              <ul className="itam-list">
                {d.team.map((t) => (
                  <li key={t.user_id}>
                    <Link className="ds-link" to={`/${orgId}/assets?filter=${encodeURIComponent(JSON.stringify({ f: "assigned_to", op: "eq", v: t.user_id }))}`}>{t.name}</Link>
                    <span className="ds-num">{fa(t.count)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      )}
      <Modal
        open={!!ack}
        title="تعهدنامهٔ تحویل دارایی"
        onCancel={() => setAck(null)}
        destroyOnHidden
        footer={
          <Space>
            <Button onClick={() => setDecline(!decline)}>{decline ? "پذیرش" : "نمی‌پذیرم"}</Button>
            <Button type="primary" danger={decline} loading={decide.isPending} disabled={decline ? note.trim().length < 3 : signature.trim().length < 3} onClick={() => decide.mutate()}>
              {decline ? "ثبت عدم پذیرش" : "می‌پذیرم و امضا می‌کنم"}
            </Button>
          </Space>
        }
      >
        {ack ? (
          <div className="flex flex-col gap-3">
            <div className="font-medium">{ack.asset_label}</div>
            {ack.terms ? <div className="itam-terms"><RecordMarkdown text={ack.terms} /></div> : null}
            {decline ? (
              <Input.TextArea aria-label="علت" placeholder="علت نپذیرفتن (مثلاً این دارایی به من تحویل نشده است)" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
            ) : (
              <Input aria-label="امضا" placeholder="نام و نام خانوادگی خود را به‌عنوان امضا بنویسید" value={signature} onChange={(e) => setSignature(e.target.value)} maxLength={160} />
            )}
          </div>
        ) : null}
      </Modal>
      <Modal open={!!report} title={REPORTS.find((r) => r.key === report?.kind)?.label} onCancel={() => setReport(null)} onOk={() => send.mutate()} okText="ثبت گزارش" confirmLoading={send.isPending} destroyOnHidden>
        <Input.TextArea aria-label="توضیح" placeholder="چه اتفاقی افتاده است؟" rows={4} value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} />
      </Modal>
    </div>
  );
}
