import { Button, Form, Input, Table } from "antd";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { useAction } from "../../lib/hooks";
import { PageHeader, Section } from "../../components/layout";
import { JDateTime } from "../../components/display";

export default function Account() {
  const { me, refresh } = useSession();
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => api.get("/auth/sessions") });
  const profile = useAction((v: any) => api.patch("/auth/me", v), { success: "ذخیره شد", onSuccess: () => refresh() });
  const pw = useAction((v: any) => api.post("/auth/password", v), { success: "رمز عبور تغییر کرد؛ ورودهای دیگر بسته شد" });
  const revoke = useAction((id: string) => api.del(`/auth/sessions/${id}`), { success: "خارج شد", invalidate: [["sessions"]] });
  return (
    <div>
      <PageHeader title="حساب کاربری من" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="مشخصات">
          <Form layout="vertical" initialValues={me?.user} onFinish={(v) => profile.mutate(v)}>
            <Form.Item name="full_name" label="نام" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item label="ایمیل"><Input value={me?.user.email} disabled dir="ltr" /></Form.Item>
            <Form.Item name="mobile" label="موبایل"><Input dir="ltr" /></Form.Item>
            <Button type="primary" htmlType="submit" loading={profile.isPending}>ذخیره</Button>
          </Form>
        </Section>
        <Section title="تغییر رمز عبور">
          <Form layout="vertical" onFinish={(v) => pw.mutate(v)}>
            <Form.Item name="current" label="رمز فعلی" rules={[{ required: true }]}><Input.Password dir="ltr" /></Form.Item>
            <Form.Item name="next" label="رمز تازه" rules={[{ required: true, min: 8 }]}><Input.Password dir="ltr" /></Form.Item>
            <Button type="primary" htmlType="submit" loading={pw.isPending}>تغییر رمز</Button>
          </Form>
        </Section>
        <Section title="دستگاه‌های واردشده" className="lg:col-span-2" bodyClass="p-0">
          <Table
            className="tz-table"
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={sessions.data?.sessions ?? []}
            columns={[
              { key: "kind", dataIndex: "kind", title: "نوع", render: (v, r: any) => (v === "device" ? `برنامه‌ی ویندوز — ${r.device_name ?? ""}` : "مرورگر") + (r.id === sessions.data?.current ? " (همین دستگاه)" : "") },
              { key: "ua", dataIndex: "user_agent", title: "مشخصات", ellipsis: true, render: (v) => <span className="ltr text-xs text-muted">{v}</span> },
              { key: "ip", dataIndex: "ip", title: "IP", render: (v) => <span className="ltr text-xs">{v}</span> },
              { key: "seen", dataIndex: "last_seen_at", title: "آخرین فعالیت", render: (v) => <JDateTime v={v} /> },
              { key: "a", render: (_, r: any) => (r.id !== sessions.data?.current ? <Button size="small" danger onClick={() => revoke.mutate(r.id)}>خروج</Button> : null) },
            ]}
          />
        </Section>
      </div>
    </div>
  );
}
