// «گزارش رایانامهٔ مشکوک» (SEC-006, every member): the subject, sender, text and (optionally) the headers of a
// suspected phishing mail go to the security team as a security incident — or join the open one of the same sender or
// link. The reporter gets a receipt and, below, a redacted status of their reports (never the incident itself).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Collapse, Form, Input, Table } from "antd";
import { MailWarning } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Card, ICON14, Note } from "../../components/blocks";
import { JDateTime } from "../../components/display";
import { SEC_KEYS, securityApi, type MyReport } from "./api";

export default function ReportPhishing() {
  const { api, orgId } = useOrg();
  const [form] = Form.useForm();
  const [receipt, setReceipt] = useState<{ receipt: string | null; grouped: boolean } | null>(null);
  const mine = useQuery({ queryKey: SEC_KEYS.myReports(orgId), queryFn: () => securityApi.myReports(api) });
  const send = useAction((v: { subject: string; sender?: string; body?: string; headers?: string }) => securityApi.reportPhishing(api, v), {
    success: "گزارش شما به تیم امنیت رسید؛ از هوشیاری شما سپاسگزاریم.",
    onSuccess: (d) => {
      setReceipt(d);
      form.resetFields();
      void mine.refetch();
    },
  });
  return (
    <div>
      <PageHeader title="گزارش رایانامهٔ مشکوک" />
      <div className="flex max-w-3xl flex-col gap-4">
        {receipt ? (
          <Note>
            شمارهٔ پیگیری: <bdi className="ds-num">{receipt.receipt ?? "—"}</bdi>
            {receipt.grouped ? " — همین رایانامه پیش‌تر هم گزارش شده بود و گزارش شما به آن افزوده شد." : ""} روی پیوندهای آن رایانامه نزنید و آن را پاک کنید.
          </Note>
        ) : null}
        <Card>
          <Form form={form} layout="vertical" onFinish={(v) => send.mutate(v)} requiredMark={false}>
            <Form.Item name="subject" label="موضوع رایانامه" rules={[{ required: true, message: "موضوع را بنویسید" }]}>
              <Input maxLength={300} />
            </Form.Item>
            <Form.Item name="sender" label="فرستنده">
              <Input dir="ltr" maxLength={300} placeholder="name@example.com" />
            </Form.Item>
            <Form.Item name="body" label="متن رایانامه یا پیوندهای آن">
              <Input.TextArea rows={6} maxLength={50_000} />
            </Form.Item>
            <Collapse
              ghost
              items={[{ key: "h", label: "سرآیندهای رایانامه (اختیاری)", children: <Form.Item name="headers" noStyle><Input.TextArea dir="ltr" rows={5} maxLength={20_000} aria-label="سرآیندهای رایانامه" /></Form.Item> }]}
            />
            <Button type="primary" htmlType="submit" icon={<MailWarning {...ICON14} />} loading={send.isPending} className="mt-2">
              فرستادن به تیم امنیت
            </Button>
          </Form>
        </Card>
        <Card title="گزارش‌های من" flush>
          <Table<MyReport>
            size="small"
            rowKey={(r) => `${r.number}-${r.reported_at}`}
            pagination={false}
            dataSource={mine.data?.reports ?? []}
            loading={mine.isLoading}
            locale={{ emptyText: "هنوز گزارشی نفرستاده‌اید" }}
            columns={[
              { title: "شمارهٔ پیگیری", dataIndex: "number", render: (v: string | null) => (v ? <bdi className="ds-num">{v}</bdi> : "—") },
              { title: "زمان", dataIndex: "reported_at", render: (v: string | null) => <JDateTime v={v} /> },
              { title: "وضعیت", dataIndex: "status" },
              { title: "نتیجه", dataIndex: "outcome", render: (v: string | null) => v ?? "—" },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
