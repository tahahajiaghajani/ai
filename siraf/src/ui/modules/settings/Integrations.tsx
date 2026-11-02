// Connections to online shops (webhooks → automatic sales invoices) and API keys.
import { useState } from "react";
import { Alert, Button, Form, Input, Modal, Select, Switch, Table, Tabs, Tag, Typography, Space } from "antd";
import { PlusOutlined, ApiOutlined, ShopOutlined, ReloadOutlined, DeleteOutlined, CopyOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { useOrg } from "../../lib/org";
import { useSession } from "../../lib/session";
import { useAction, useNotify } from "../../lib/hooks";
import { PageHeader, Section } from "../../components/layout";
import { JDateTime } from "../../components/display";
import { RefSelect, PartySelect } from "../../components/inputs";
import { faDigits } from "@shared/format";

const KIND: Record<string, string> = { woocommerce: "ووکامرس (وردپرس)", shopify: "شاپیفای", generic: "سایت دیگر (JSON)" };
const EV_STATUS: Record<string, [string, string]> = { processed: ["ثبت شد", "success"], failed: ["ناموفق", "error"], received: ["دریافت شد", "processing"], ignored: ["نادیده", "default"] };

export default function Integrations() {
  const { api, can, orgId } = useOrg();
  const { meta } = useSession();
  const n = useNotify();
  const list = useQuery({ queryKey: ["integrations"], queryFn: () => api.get("/integrations").then((r) => r.integrations as any[]) });
  const events = useQuery({ queryKey: ["integration-events"], queryFn: () => api.get("/integrations/events").then((r) => r.events as any[]), refetchInterval: 15000 });
  const keys = useQuery({ queryKey: ["api-keys"], queryFn: () => api.get("/integrations/api-keys").then((r) => r.keys as any[]) });
  const [add, setAdd] = useState(false);
  const [shown, setShown] = useState<{ title: string; lines: [string, string][] } | null>(null);
  const [keyModal, setKeyModal] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const create = useAction((v: any) => api.post("/integrations", v), {
    invalidate: [["integrations"]],
    onSuccess: (r: any) => {
      setAdd(false);
      setShown({ title: "اتصال ساخته شد", lines: [["نشانی Webhook", `${origin}${r.integration.webhook_path}`], ["کلید (Secret)", r.integration.secret]] });
    },
  });
  const toggle = useAction(({ id, is_active }: any) => api.patch(`/integrations/${id}`, { is_active }), { invalidate: [["integrations"]] });
  const remove = useAction((id: string) => api.del(`/integrations/${id}`), { success: "حذف شد", invalidate: [["integrations"]] });
  const retry = useAction((id: string) => api.post(`/integrations/events/${id}/retry`), { success: "دوباره پردازش شد", invalidate: [["integration-events"]] });
  const newKey = useAction((v: any) => api.post("/integrations/api-keys", v), {
    invalidate: [["api-keys"]],
    onSuccess: (r: any) => {
      setKeyModal(false);
      setShown({ title: "کلید API ساخته شد", lines: [["کلید", r.key], ["نشانی API", `${origin}/api/v1`]] });
    },
  });
  const revoke = useAction((id: string) => api.del(`/integrations/api-keys/${id}`), { success: "کلید باطل شد", invalidate: [["api-keys"]] });
  const editable = can("integrations", "full");

  return (
    <div>
      <PageHeader title="اتصال به فروشگاه اینترنتی و API" />
      {meta?.mode === "desktop" ? (
        <Alert className="!mb-4" type="info" showIcon title="فروشگاه اینترنتی به نسخه‌ی وب وصل می‌شود" description="سایت فروشگاه باید به یک نشانی اینترنتی سفارش بفرستد؛ این اتصال‌ها را در نسخه‌ی وب بسازید. فاکتورهای ساخته‌شده با همگام‌سازی به همین برنامه هم می‌رسند." />
      ) : null}
      <Tabs
        items={[
          {
            key: "shops",
            label: <span><ShopOutlined /> فروشگاه‌ها</span>,
            children: (
              <Section title="هر سفارش سایت ← فاکتور فروش خودکار" extra={editable ? <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdd(true)}>اتصال تازه</Button> : null} bodyClass="p-0">
                <Table
                  className="tz-table"
                  size="small"
                  rowKey="id"
                  loading={list.isLoading}
                  dataSource={list.data ?? []}
                  pagination={false}
                  locale={{ emptyText: "هنوز فروشگاهی وصل نشده است" }}
                  columns={[
                    { key: "name", dataIndex: "name", title: "نام", render: (v, r) => <div><b>{v}</b><div className="text-xs text-muted">{KIND[r.kind]}</div></div> },
                    { key: "url", title: "نشانی Webhook", render: (_, r) => <Typography.Text copyable className="ltr text-xs">{`${origin}${r.webhook_path}`}</Typography.Text> },
                    { key: "mode", title: "ثبت", render: (_, r) => (r.config?.post ? <Tag color="green" variant="filled">قطعی</Tag> : <Tag variant="filled">پیش‌نویس برای بررسی</Tag>) },
                    { key: "events", title: "سفارش‌ها", render: (_, r) => <span className="num">{faDigits(r.events)}{r.failed ? <span className="text-bad"> ({faDigits(r.failed)} ناموفق)</span> : null}</span> },
                    { key: "last", dataIndex: "last_event_at", title: "آخرین سفارش", render: (v) => <JDateTime v={v} /> },
                    { key: "active", dataIndex: "is_active", title: "فعال", render: (v, r) => <Switch size="small" checked={v} disabled={!editable} onChange={(is_active) => toggle.mutate({ id: r.id, is_active })} /> },
                    { key: "a", render: (_, r) => (editable ? <Button size="small" danger icon={<DeleteOutlined />} onClick={async () => { if (await n.confirm(`حذف اتصال «${r.name}»؟`, undefined, true)) remove.mutate(r.id); }} /> : null) },
                  ]}
                />
                <div className="border-t border-line p-4 text-xs leading-6 text-muted">
                  <b>ووکامرس:</b> پیشخوان وردپرس ← ووکامرس ← پیکربندی ← پیشرفته ← Webhooks ← افزودن: موضوع «Order created»، نشانی تحویل = نشانی بالا، کلید = Secret همین اتصال، نسخه‌ی API: WP REST API v3.{" "}
                  <b>شاپیفای:</b> Settings ← Notifications ← Webhooks ← Order creation (JSON) و کلید امضای همان صفحه را هنگام ساخت اتصال وارد کنید.{" "}
                  <b>سایت دیگر:</b> سفارش را به‌صورت JSON با سرآیند <span className="ltr">X-Taraz-Signature</span> (HMAC-SHA256 بدنه با کلید) یا <span className="ltr">X-Taraz-Secret</span> بفرستید.
                  {" "}کالاها با SKU، بارکد، کد یا نام دقیق پیدا می‌شوند؛ مشتری با موبایل یا ایمیل.
                </div>
              </Section>
            ),
          },
          {
            key: "events",
            label: "سفارش‌های دریافتی",
            children: (
              <Section bodyClass="p-0" extra={<Button size="small" icon={<ReloadOutlined />} onClick={() => events.refetch()} />} title="۲۰۰ رویداد آخر">
                <Table
                  className="tz-table"
                  size="small"
                  rowKey="id"
                  loading={events.isLoading}
                  dataSource={events.data ?? []}
                  pagination={{ pageSize: 50, hideOnSinglePage: true }}
                  columns={[
                    { key: "at", dataIndex: "received_at", title: "زمان", render: (v) => <JDateTime v={v} /> },
                    { key: "from", dataIndex: "integration_name", title: "فروشگاه" },
                    { key: "ext", dataIndex: "external_id", title: "شماره سفارش", render: (v) => <span className="num">{faDigits(v ?? "—")}</span> },
                    { key: "st", dataIndex: "status", title: "وضعیت", render: (v) => <Tag color={EV_STATUS[v]?.[1]} variant="filled">{EV_STATUS[v]?.[0] ?? v}</Tag> },
                    { key: "res", title: "نتیجه", render: (_, r) => (r.result?.invoice_id ? <Link to={`/${orgId}/sales/invoices/${r.result.invoice_id}`}>فاکتور {faDigits(r.result.no ?? "")}</Link> : <span className="text-xs text-bad">{r.error}</span>) },
                    { key: "a", render: (_, r) => (r.status === "failed" && can("integrations", "edit") ? <Button size="small" onClick={() => retry.mutate(r.id)}>تلاش دوباره</Button> : null) },
                  ]}
                />
              </Section>
            ),
          },
          {
            key: "api",
            label: <span><ApiOutlined /> کلیدهای API</span>,
            children: (
              <Section title="دسترسی برنامه‌های دیگر" extra={editable ? <Button type="primary" icon={<PlusOutlined />} onClick={() => setKeyModal(true)}>کلید تازه</Button> : null} bodyClass="p-0">
                <Table
                  className="tz-table"
                  size="small"
                  rowKey="id"
                  dataSource={keys.data ?? []}
                  pagination={false}
                  locale={{ emptyText: "کلیدی ساخته نشده است" }}
                  columns={[
                    { key: "name", dataIndex: "name", title: "نام" },
                    { key: "prefix", dataIndex: "prefix", title: "شناسه", render: (v) => <span className="ltr font-mono text-xs">tz_{v}_…</span> },
                    { key: "scopes", dataIndex: "scopes", title: "اجازه", render: (v: string[]) => v.map((s) => <Tag key={s} variant="filled">{s === "read" ? "خواندن" : "ثبت"}</Tag>) },
                    { key: "used", dataIndex: "last_used_at", title: "آخرین استفاده", render: (v) => <JDateTime v={v} /> },
                    { key: "st", dataIndex: "revoked_at", title: "وضعیت", render: (v) => (v ? <Tag color="error" variant="filled">باطل</Tag> : <Tag color="success" variant="filled">فعال</Tag>) },
                    { key: "a", render: (_, r) => (!r.revoked_at && editable ? <Button size="small" danger onClick={() => revoke.mutate(r.id)}>ابطال</Button> : null) },
                  ]}
                />
                <div className="border-t border-line p-4 text-xs leading-6 text-muted">
                  <div className="mb-1 font-semibold text-ink">نمونه‌ی ثبت سفارش از برنامه‌ی دیگر:</div>
                  <pre className="ltr m-0 overflow-x-auto rounded-lg bg-surface-2 p-3 text-[11px] leading-5">{`POST ${origin}/api/v1/orders
Authorization: Bearer tz_xxxxxxxx_...
{ "id": "1043", "customer": { "name": "علی", "mobile": "09121234567" },
  "items": [ { "sku": "A-100", "name": "کالا", "qty": 2, "price": 1500000 } ],
  "shipping": 300000, "post": false }`}</pre>
                  <div className="mt-2">نشانی‌های دیگر: <span className="ltr">GET /api/v1/items?q=</span> (کالاها با موجودی)، <span className="ltr">GET /api/v1/parties?mobile=</span>، <span className="ltr">GET /api/v1/invoices/:id</span>، <span className="ltr">GET /api/v1/ping</span>.</div>
                </div>
              </Section>
            ),
          },
        ]}
      />
      <Modal open={add} onCancel={() => setAdd(false)} title="اتصال فروشگاه اینترنتی" footer={null} destroyOnHidden width={560}>
        <Form layout="vertical" initialValues={{ kind: "woocommerce", config: { post: false, prices_include_vat: true, price_factor: "1" } }} onFinish={(v) => create.mutate(v)}>
          <Form.Item name="kind" label="نوع فروشگاه"><Select options={Object.entries(KIND).map(([value, label]) => ({ value, label }))} /></Form.Item>
          <Form.Item name="name" label="نام" rules={[{ required: true }]}><Input placeholder="مثلاً فروشگاه وردپرسی" /></Form.Item>
          <Form.Item name="secret" label="کلید امضا (Secret)" extra="برای شاپیفای کلید امضای Webhook همان پنل را بگذارید؛ برای بقیه خالی بگذارید تا ساخته شود."><Input dir="ltr" /></Form.Item>
          <Form.Item name={["config", "warehouse_id"]} label="انبار"><RefSelect entity="warehouse" allowClear /></Form.Item>
          <Form.Item name={["config", "default_party_id"]} label="مشتری پیش‌فرض (سفارش بی‌نام)"><PartySelect allowClear /></Form.Item>
          <Space size="large" wrap>
            <Form.Item name={["config", "post"]} label="ثبت قطعی فاکتور (خروج از انبار و سند)" valuePropName="checked"><Switch /></Form.Item>
            <Form.Item name={["config", "prices_include_vat"]} label="قیمت‌های سایت با مالیات است" valuePropName="checked"><Switch /></Form.Item>
          </Space>
          <Form.Item name={["config", "price_factor"]} label="ضریب قیمت" extra="اگر سایت به تومان و حساب‌ها به ریال است: ۱۰"><Input dir="ltr" className="!w-32" /></Form.Item>
          <Button type="primary" htmlType="submit" loading={create.isPending}>ساخت اتصال</Button>
        </Form>
      </Modal>
      <Modal open={keyModal} onCancel={() => setKeyModal(false)} title="کلید API تازه" footer={null} destroyOnHidden>
        <Form layout="vertical" initialValues={{ scopes: ["read", "write"] }} onFinish={(v) => newKey.mutate(v)}>
          <Form.Item name="name" label="برای چه برنامه‌ای؟" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="scopes" label="اجازه‌ها"><Select mode="multiple" options={[{ value: "read", label: "خواندن" }, { value: "write", label: "ثبت سفارش" }]} /></Form.Item>
          <Button type="primary" htmlType="submit" loading={newKey.isPending}>ساخت کلید</Button>
        </Form>
      </Modal>
      <Modal open={!!shown} onCancel={() => setShown(null)} onOk={() => setShown(null)} title={shown?.title} okText="یادداشت کردم" cancelButtonProps={{ style: { display: "none" } }} width={620}>
        <Alert className="!mb-3" type="warning" showIcon title="کلید فقط همین یک بار نمایش داده می‌شود" />
        {shown?.lines.map(([label, value]) => (
          <div key={label} className="mb-3">
            <div className="mb-1 text-xs text-muted">{label}</div>
            <Typography.Text copyable={{ icon: <CopyOutlined /> }} className="ltr block rounded-lg bg-surface-2 p-2 font-mono text-xs">{value}</Typography.Text>
          </div>
        ))}
      </Modal>
    </div>
  );
}
