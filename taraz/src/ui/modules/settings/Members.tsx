import { useState } from "react";
import { Button, Table, Modal, Form, Input, Select, Tag, Switch, Alert, Typography, Drawer } from "antd";
import { PlusOutlined, KeyOutlined, SafetyOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { useAction, useNotify } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { JDateTime } from "../../components/display";
import { AREAS, ROLES, LEVEL_ORDER, levelOf, type Role, type Area } from "@shared/permissions";

const LEVELS: Record<string, string> = { none: "بدون دسترسی", view: "مشاهده", edit: "ثبت و ویرایش", full: "کامل (حذف و تأیید)" };

export default function Members() {
  const { api, can } = useOrg();
  const n = useNotify();
  const q = useQuery({ queryKey: ["members"], queryFn: () => api.get("/members") });
  const [add, setAdd] = useState(false);
  const [perm, setPerm] = useState<any | null>(null);
  const [temp, setTemp] = useState<string | null>(null);
  const create = useAction((v: any) => api.post("/members", v), { invalidate: [["members"]], onSuccess: (r: any) => { setAdd(false); if (r.temp_password) setTemp(r.temp_password); else n.ok("کاربر اضافه شد"); } });
  const update = useAction(({ id, ...v }: any) => api.patch(`/members/${id}`, v), { success: "ذخیره شد", invalidate: [["members"]] });
  const reset = useAction((id: string) => api.post(`/members/${id}/password`, {}), { onSuccess: (r: any) => setTemp(r.temp_password) });
  const roles = Object.entries(ROLES).map(([value, r]) => ({ value, label: r.title }));
  const editable = can("users", "edit");
  return (
    <div>
      <PageHeader title="کاربران و دسترسی‌ها" actions={editable ? <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdd(true)}>افزودن کاربر</Button> : null} />
      <div className="tz-card p-3">
        <Table
          className="tz-table"
          size="small"
          rowKey="id"
          loading={q.isLoading}
          dataSource={q.data?.members ?? []}
          pagination={false}
          columns={[
            { key: "name", title: "کاربر", render: (_, r: any) => <div><div className="font-semibold">{r.full_name}</div><div className="ltr text-xs text-muted">{r.email}</div></div> },
            { key: "title", dataIndex: "title", title: "سمت" },
            {
              key: "role",
              dataIndex: "role",
              title: "نقش",
              render: (v, r: any) => (editable ? <Select size="small" value={v} options={roles} className="!w-36" onChange={(role) => update.mutate({ id: r.id, role })} /> : <Tag>{ROLES[v as Role]?.title}</Tag>),
            },
            { key: "login", dataIndex: "last_login_at", title: "آخرین ورود", render: (v) => <JDateTime v={v} /> },
            { key: "active", dataIndex: "is_active", title: "فعال", render: (v, r: any) => <Switch size="small" checked={v} disabled={!editable} onChange={(is_active) => update.mutate({ id: r.id, is_active })} /> },
            {
              key: "a",
              render: (_, r: any) =>
                editable ? (
                  <div className="flex gap-1">
                    <Button size="small" icon={<SafetyOutlined />} onClick={() => setPerm(r)}>دسترسی‌ها</Button>
                    {can("users", "full") ? <Button size="small" icon={<KeyOutlined />} onClick={async () => { if (await n.confirm(`رمز تازه برای ${r.full_name}؟`, "همه‌ی ورودهای فعلی این کاربر بسته می‌شود.")) reset.mutate(r.id); }}>رمز تازه</Button> : null}
                  </div>
                ) : null,
            },
          ]}
        />
      </div>
      <Modal open={add} onCancel={() => setAdd(false)} title="افزودن کاربر" footer={null} destroyOnHidden>
        <Form layout="vertical" onFinish={(v) => create.mutate(v)} initialValues={{ role: "accountant" }}>
          <Form.Item name="full_name" label="نام" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="email" label="ایمیل (نام کاربری)" rules={[{ required: true, type: "email" }]}><Input dir="ltr" /></Form.Item>
          <Form.Item name="role" label="نقش"><Select options={roles} /></Form.Item>
          <Form.Item name="title" label="سمت (اختیاری)"><Input /></Form.Item>
          <Form.Item name="password" label="رمز اولیه (اختیاری)" extra="اگر خالی بماند رمز تصادفی ساخته و نمایش داده می‌شود. اگر این ایمیل از قبل حساب دارد، همان حساب عضو می‌شود."><Input.Password dir="ltr" /></Form.Item>
          <Button type="primary" htmlType="submit" loading={create.isPending}>افزودن</Button>
        </Form>
      </Modal>
      <Modal open={!!temp} onCancel={() => setTemp(null)} onOk={() => setTemp(null)} title="رمز موقت" cancelButtonProps={{ style: { display: "none" } }} okText="یادداشت کردم">
        <Alert type="warning" showIcon title="این رمز را به کاربر بدهید؛ دوباره نمایش داده نمی‌شود. کاربر بعد از ورود می‌تواند رمز را عوض کند." />
        <div className="my-4 text-center">
          <Typography.Text copyable className="ltr font-mono text-xl font-bold">{temp}</Typography.Text>
        </div>
      </Modal>
      <Drawer open={!!perm} onClose={() => setPerm(null)} size={520} title={`دسترسی‌های ${perm?.full_name ?? ""}`} destroyOnHidden>
        {perm ? (
          <Form
            layout="vertical"
            initialValues={Object.fromEntries((Object.keys(AREAS) as Area[]).map((a) => [a, perm.overrides?.[a] ?? ""]))}
            onFinish={(v) => {
              const overrides = Object.fromEntries(Object.entries(v).filter(([, x]) => x));
              update.mutate({ id: perm.id, overrides });
              setPerm(null);
            }}
          >
            <Alert className="!mb-4" type="info" showIcon title={`نقش «${ROLES[perm.role as Role]?.title}» پیش‌فرض‌ها را تعیین می‌کند؛ هر بخش را می‌توانید جداگانه تغییر دهید.`} />
            {(Object.keys(AREAS) as Area[]).map((a) => (
              <Form.Item key={a} name={a} label={AREAS[a]}>
                <Select
                  options={[{ value: "", label: `پیش‌فرض نقش (${LEVELS[levelOf(perm.role, a)]})` }, ...LEVEL_ORDER.map((l) => ({ value: l, label: LEVELS[l] }))]}
                />
              </Form.Item>
            ))}
            <Button type="primary" htmlType="submit">ذخیره</Button>
          </Form>
        ) : null}
      </Drawer>
    </div>
  );
}
