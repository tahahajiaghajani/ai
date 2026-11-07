// My account (حساب کاربری من): profile, password and the devices signed in.
import { Button, Form, Input, Table, Tooltip } from "antd";
import { Monitor, Globe, LogOut } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { JDateTime } from "../../components/display";
import { Card, ICON, ICON14 } from "../../components/blocks";

export default function Account() {
  const { me, refresh } = useSession();
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => api.get("/auth/sessions") });
  const profile = useAction((v: any) => api.patch("/auth/me", v), { success: "مشخصات ذخیره شد.", onSuccess: () => refresh() });
  const pw = useAction((v: any) => api.post("/auth/password", v), { success: "رمز عبور تغییر کرد؛ ورودهای دیگر بسته شد." });
  const revoke = useAction((id: string) => api.del(`/auth/sessions/${id}`), { success: "از آن دستگاه خارج شد.", invalidate: [["sessions"]] });
  return (
    <div>
      <PageHeader title="حساب کاربری من" subtitle={me?.user.email ? <bdi dir="ltr" className="ds-latin">{me.user.email}</bdi> : undefined} />
      <div className="blk-cols grid items-start gap-4 lg:grid-cols-2">
        <Card title="مشخصات">
          <Form layout="vertical" requiredMark={false} initialValues={me?.user} onFinish={(v) => profile.mutate(v)}>
            <Form.Item name="full_name" label="نام" rules={[{ required: true, message: "نام را بنویسید." }]}><Input /></Form.Item>
            <Form.Item label="ایمیل"><Input value={me?.user.email} disabled dir="ltr" className="ds-latin" /></Form.Item>
            <Form.Item name="mobile" label="همراه"><Input dir="ltr" className="ds-num" style={{ textAlign: "right" }} inputMode="tel" /></Form.Item>
            <div className="flex justify-end"><Button type="primary" htmlType="submit" loading={profile.isPending}>ذخیره</Button></div>
          </Form>
        </Card>
        <Card title="تغییر رمز عبور">
          <Form layout="vertical" requiredMark={false} onFinish={(v) => pw.mutate(v)}>
            <Form.Item name="current" label="رمز فعلی" rules={[{ required: true, message: "رمز فعلی را بنویسید." }]}><Input.Password dir="ltr" autoComplete="current-password" /></Form.Item>
            <Form.Item name="next" label="رمز تازه" extra="دست‌کم ۸ نویسه" rules={[{ required: true, min: 8, message: "رمز تازه دست‌کم ۸ نویسه است." }]}><Input.Password dir="ltr" autoComplete="new-password" /></Form.Item>
            <div className="flex justify-end"><Button htmlType="submit" loading={pw.isPending}>تغییر رمز</Button></div>
          </Form>
        </Card>
        <Card title="دستگاه‌های واردشده" className="lg:col-span-2" flush>
          <Table
            className="blk-tbl"
            size="middle"
            rowKey="id"
            pagination={false}
            loading={sessions.isLoading}
            dataSource={sessions.data?.sessions ?? []}
            scroll={{ x: 760 }}
            tableLayout="fixed"
            columns={[
              {
                key: "kind",
                dataIndex: "kind",
                title: "دستگاه",
                width: 280,
                render: (v, r: any) => (
                  <span className="flex items-center gap-2">
                    <span className="blk-3 inline-grid">{v === "device" ? <Monitor {...ICON} /> : <Globe {...ICON} />}</span>
                    <span>{v === "device" ? `برنامهٔ ویندوز${r.device_name ? `، ${r.device_name}` : ""}` : "مرورگر"}</span>
                    {r.id === sessions.data?.current ? <span className="blk-plain">همین دستگاه</span> : null}
                  </span>
                ),
              },
              { key: "ua", dataIndex: "user_agent", title: "مشخصات", ellipsis: true, render: (v) => <bdi dir="ltr" className="ds-latin blk-3" style={{ fontSize: 12 }}>{v}</bdi> },
              { key: "ip", dataIndex: "ip", title: "IP", width: 136, render: (v) => <bdi dir="ltr" className="ds-mono blk-2">{v}</bdi> },
              { key: "seen", dataIndex: "last_seen_at", title: "آخرین فعالیت", width: 168, render: (v) => <span className="blk-2"><JDateTime v={v} /></span> },
              {
                key: "a",
                width: 72,
                render: (_, r: any) =>
                  r.id !== sessions.data?.current ? (
                    <span className="blk-ra">
                      <Tooltip title="خروج از این دستگاه">
                        <Button size="small" type="text" danger icon={<LogOut {...ICON14} />} onClick={() => revoke.mutate(r.id)} aria-label="خروج از این دستگاه" />
                      </Tooltip>
                    </span>
                  ) : null,
              },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
