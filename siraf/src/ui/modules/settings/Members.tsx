// Users and permissions (کاربران و دسترسی‌ها): members with their role, last sign-in and status; per-area overrides of
// a role in the side sheet; temporary passwords shown once.
import { useState } from "react";
import { Button, Table, Modal, Form, Input, Select, Switch, Drawer, Tooltip, message } from "antd";
import { Plus, KeyRound, ShieldCheck, Copy, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { useSession } from "../../lib/session";
import { useAction, useNotify } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, JDateTime } from "../../components/display";
import { AREAS, ROLES, LEVEL_ORDER, levelOf, type Role, type Area } from "@shared/permissions";
import { faDigits } from "@shared/format";
import { Avatar, ICON, ICON14, Note } from "../reports/kit";

const LEVELS: Record<string, string> = { none: "بدون دسترسی", view: "مشاهده", edit: "ثبت و ویرایش", full: "کامل (حذف و تأیید)" };

export default function Members() {
  const { api, can } = useOrg();
  const { me } = useSession();
  const n = useNotify();
  const q = useQuery({ queryKey: ["members"], queryFn: () => api.get("/members") });
  const [add, setAdd] = useState(false);
  const [perm, setPerm] = useState<any | null>(null);
  const [temp, setTemp] = useState<string | null>(null);
  const create = useAction((v: any) => api.post("/members", v), {
    invalidate: [["members"]],
    onSuccess: (r: any) => {
      setAdd(false);
      if (r.temp_password) setTemp(r.temp_password);
      else n.ok("کاربر افزوده شد.");
    },
  });
  const update = useAction(({ id, ...v }: any) => api.patch(`/members/${id}`, v), { success: "ذخیره شد.", invalidate: [["members"]] });
  const reset = useAction((id: string) => api.post(`/members/${id}/password`, {}), { onSuccess: (r: any) => setTemp(r.temp_password) });
  const roles = Object.entries(ROLES).map(([value, r]) => ({ value, label: r.title }));
  const editable = can("users", "edit");
  const members = (q.data?.members ?? []) as any[];
  return (
    <div>
      <PageHeader
        title="کاربران و دسترسی‌ها"
        subtitle={members.length ? `${faDigits(members.length)} کاربر` : undefined}
        actions={
          editable ? (
            <Button type="primary" icon={<Plus {...ICON} />} onClick={() => setAdd(true)}>
              افزودن کاربر
            </Button>
          ) : null
        }
      />
      <div className="bk-card">
        <Table
          className="bk-tbl"
          size="middle"
          rowKey="id"
          loading={q.isLoading}
          dataSource={members}
          pagination={false}
          scroll={{ x: 900 }}
          locale={{ emptyText: <EmptyState icon={Users} title="کاربری نیست" /> }}
          columns={[
            {
              key: "name",
              title: "کاربر",
              render: (_, r: any) => (
                <span className="flex min-w-0 items-center gap-3">
                  <Avatar name={r.full_name} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 font-medium">
                      {r.full_name}
                      {me?.user?.id === r.user_id || me?.user?.email === r.email ? <span className="bk-plain">(شما)</span> : null}
                    </span>
                    <bdi dir="ltr" className="sf-latin bk-3 block truncate" style={{ fontSize: 12 }}>{r.email}</bdi>
                  </span>
                </span>
              ),
            },
            { key: "title", dataIndex: "title", title: "سمت", width: 160, render: (v) => (v ? <span className="bk-2">{v}</span> : <span className="sf-zero">—</span>) },
            {
              key: "role",
              dataIndex: "role",
              title: "نقش",
              width: 180,
              render: (v, r: any) =>
                editable ? (
                  <Select size="small" variant="borderless" value={v} options={roles} popupMatchSelectWidth={false} style={{ width: "auto" }} onChange={(role) => update.mutate({ id: r.id, role })} />
                ) : (
                  <span>{ROLES[v as Role]?.title}</span>
                ),
            },
            {
              key: "ov",
              title: "دسترسی ویژه",
              width: 120,
              render: (_, r: any) => {
                const k = Object.keys(r.overrides ?? {}).length;
                return k ? <Chip tone="neutral" fig>{faDigits(k)} بخش</Chip> : <span className="sf-zero">—</span>;
              },
            },
            { key: "login", dataIndex: "last_login_at", title: "آخرین ورود", width: 168, render: (v) => <span className="bk-2"><JDateTime v={v} /></span> },
            { key: "active", dataIndex: "is_active", title: "فعال", width: 72, render: (v, r: any) => <Switch size="small" checked={v} disabled={!editable} onChange={(is_active) => update.mutate({ id: r.id, is_active })} aria-label="فعال" /> },
            {
              key: "a",
              width: 96,
              render: (_, r: any) =>
                editable ? (
                  <span className="bk-ra">
                    <Tooltip title="دسترسی‌ها">
                      <Button size="small" type="text" icon={<ShieldCheck {...ICON14} />} onClick={() => setPerm(r)} aria-label="دسترسی‌ها" />
                    </Tooltip>
                    {can("users", "full") ? (
                      <Tooltip title="رمز تازه">
                        <Button
                          size="small"
                          type="text"
                          icon={<KeyRound {...ICON14} />}
                          aria-label="رمز تازه"
                          onClick={async () => {
                            if (await n.confirm(`رمز تازه برای ${r.full_name}؟`, "همهٔ ورودهای فعلی این کاربر بسته می‌شود.")) reset.mutate(r.id);
                          }}
                        />
                      </Tooltip>
                    ) : null}
                  </span>
                ) : null,
            },
          ]}
        />
      </div>

      <Modal open={add} onCancel={() => setAdd(false)} title="افزودن کاربر" footer={null} destroyOnHidden width={480}>
        <Form layout="vertical" requiredMark={false} onFinish={(v) => create.mutate(v)} initialValues={{ role: "accountant" }}>
          <Form.Item name="full_name" label="نام" rules={[{ required: true, message: "نام را بنویسید." }]}><Input autoFocus /></Form.Item>
          <Form.Item name="email" label="ایمیل (نام کاربری)" rules={[{ required: true, type: "email", message: "ایمیل درست نیست." }]}><Input dir="ltr" className="sf-latin" /></Form.Item>
          <div className="bk-grid2">
            <Form.Item name="role" label="نقش"><Select options={roles} /></Form.Item>
            <Form.Item name="title" label="سمت (اختیاری)"><Input /></Form.Item>
          </div>
          <Form.Item name="password" label="رمز اولیه (اختیاری)" extra="خالی بماند تا رمز تصادفی ساخته و یک بار نمایش داده شود. اگر این ایمیل حساب دارد، همان حساب عضو می‌شود.">
            <Input.Password dir="ltr" />
          </Form.Item>
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setAdd(false)}>انصراف</Button>
            <Button type="primary" htmlType="submit" loading={create.isPending}>افزودن</Button>
          </div>
        </Form>
      </Modal>

      <Modal open={!!temp} onCancel={() => setTemp(null)} onOk={() => setTemp(null)} title="رمز موقت" cancelButtonProps={{ style: { display: "none" } }} okText="یادداشت کردم" width={440}>
        <Note tone="warning" className="mb-4"><b>این رمز دوباره نمایش داده نمی‌شود.</b> آن را به کاربر بدهید؛ پس از ورود می‌تواند رمز را عوض کند.</Note>
        <div className="bk-copy">
          <code style={{ fontSize: 18, letterSpacing: ".04em" }}>{temp}</code>
          <Tooltip title="رونوشت">
            <Button
              type="text"
              icon={<Copy {...ICON} />}
              aria-label="رونوشت"
              onClick={() => {
                void navigator.clipboard?.writeText(temp ?? "");
                message.success("رونوشت شد.");
              }}
            />
          </Tooltip>
        </div>
      </Modal>

      <Drawer open={!!perm} onClose={() => setPerm(null)} size={480} title={`دسترسی‌های ${perm?.full_name ?? ""}`} destroyOnHidden>
        {perm ? (
          <div className="sf-form">
            <Form
              layout="vertical"
              initialValues={Object.fromEntries((Object.keys(AREAS) as Area[]).map((a) => [a, perm.overrides?.[a] ?? ""]))}
              onFinish={(v) => {
                const overrides = Object.fromEntries(Object.entries(v).filter(([, x]) => x));
                update.mutate({ id: perm.id, overrides });
                setPerm(null);
              }}
            >
              <Note className="mb-4">نقش «{ROLES[perm.role as Role]?.title}» پیش‌فرض‌ها را تعیین می‌کند؛ هر بخش را جداگانه می‌توانید تغییر دهید.</Note>
              <div className="sf-form-grid">
                {(Object.keys(AREAS) as Area[]).map((a) => (
                  <Form.Item key={a} name={a} label={AREAS[a]} style={{ ["--span" as string]: 12 }}>
                    <Select options={[{ value: "", label: `پیش‌فرض (${LEVELS[levelOf(perm.role, a)]})` }, ...LEVEL_ORDER.map((l) => ({ value: l, label: LEVELS[l] }))]} />
                  </Form.Item>
                ))}
              </div>
              <div className="sf-form-foot">
                <Button onClick={() => setPerm(null)}>انصراف</Button>
                <Button type="primary" htmlType="submit">ذخیره</Button>
              </div>
            </Form>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
