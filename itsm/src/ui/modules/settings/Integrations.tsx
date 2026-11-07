// Connections to online shops (webhooks → automatic sales invoices) and API keys.
import { useState } from "react";
import { Button, Form, Input, Modal, Select, Switch, Table, Tabs, Space, Tooltip, message } from "antd";
import { Plus, Store, RotateCw, Trash2, Copy, Inbox, KeyRound } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { useOrg } from "../../lib/org";
import { useSession } from "../../lib/session";
import { useAction, useNotify } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, JDateTime, StatusTag } from "../../components/display";
import { Card, Field, ICON, ICON14, Note, docNo } from "../../components/blocks";
import { RefSelect, PartySelect } from "../../components/inputs";
import { faDigits } from "@shared/format";

const KIND: Record<string, string> = { woocommerce: "ووکامرس (وردپرس)", shopify: "شاپیفای", generic: "سایت دیگر (JSON)" };
const EV_STATUS: Record<string, [string, string]> = { processed: ["ثبت شد", "success"], failed: ["ناموفق", "error"], received: ["دریافت شد", "warning"], ignored: ["نادیده", "default"] };

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

  const [tab, setTab] = useState("shops");
  const copyBtn = (v: string) => (
    <Tooltip title="رونوشت">
      <Button type="text" size="small" icon={<Copy {...ICON14} />} aria-label="رونوشت" onClick={(e) => { e.stopPropagation(); void navigator.clipboard?.writeText(v); message.success("رونوشت شد."); }} />
    </Tooltip>
  );

  return (
    <div>
      <PageHeader
        title="اتصال‌ها و API"
        subtitle={<Link className="ds-link blk-hlink" to={`/${orgId}/help#shop`}>راهنما</Link>}
        actions={
          editable && tab !== "events" ? (
            <Button type="primary" icon={<Plus {...ICON} />} onClick={() => (tab === "api" ? setKeyModal(true) : setAdd(true))}>
              {tab === "api" ? "کلید تازه" : "اتصال تازه"}
            </Button>
          ) : null
        }
      />
      {meta?.mode === "desktop" ? (
        <p className="blk-line mb-4">
          <i className="ds-nuqta" aria-hidden />
          اتصال فروشگاه در نسخهٔ وب ساخته می‌شود.
        </p>
      ) : null}
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: "shops", label: "فروشگاه‌ها" },
          { key: "events", label: "سفارش‌های دریافتی" },
          { key: "api", label: "کلیدهای API" },
        ]}
      />
      {tab === "shops" ? (
        <Card title="فروشگاه‌ها" meta={<span className="blk-cap">هر سفارش سایت، یک فاکتور فروش خودکار</span>} flush>
          <Table
            className="blk-tbl"
            size="middle"
            rowKey="id"
            loading={list.isLoading}
            dataSource={list.data ?? []}
            pagination={false}
            scroll={{ x: 980 }}
            locale={{ emptyText: <EmptyState icon={Store} title="هنوز فروشگاهی وصل نشده" description="ووکامرس، شاپیفای یا هر سایتی که سفارش را به‌صورت JSON بفرستد." action={editable ? <Button type="primary" icon={<Plus {...ICON} />} onClick={() => setAdd(true)}>اتصال تازه</Button> : undefined} /> }}
            columns={[
              { key: "name", dataIndex: "name", title: "نام", width: 200, render: (v, r) => <div><div className="font-medium">{v}</div><div className="blk-3" style={{ fontSize: 12 }}>{KIND[r.kind]}</div></div> },
              {
                key: "url",
                title: "نشانی Webhook",
                render: (_, r) => (
                  <span className="flex min-w-0 items-center gap-1">
                    <bdi dir="ltr" className="ds-mono blk-2 truncate">{`${origin}${r.webhook_path}`}</bdi>
                    {copyBtn(`${origin}${r.webhook_path}`)}
                  </span>
                ),
              },
              { key: "mode", title: "ثبت", width: 152, render: (_, r) => (r.config?.post ? <span>قطعی</span> : <Chip tone="neutral">پیش‌نویس برای بررسی</Chip>) },
              {
                key: "events",
                title: "سفارش‌ها",
                width: 140,
                render: (_, r) => (
                  <span className="inline-flex items-center gap-2 ds-num">
                    {faDigits(r.events)}
                    {r.failed ? <Chip tone="danger" fig>{faDigits(r.failed)} ناموفق</Chip> : null}
                  </span>
                ),
              },
              { key: "last", dataIndex: "last_event_at", title: "آخرین سفارش", width: 160, render: (v) => <span className="blk-2"><JDateTime v={v} /></span> },
              { key: "active", dataIndex: "is_active", title: "فعال", width: 72, render: (v, r) => <Switch size="small" checked={v} disabled={!editable} onChange={(is_active) => toggle.mutate({ id: r.id, is_active })} aria-label="فعال" /> },
              {
                key: "a",
                width: 56,
                render: (_, r) =>
                  editable ? (
                    <span className="blk-ra">
                      <Tooltip title="حذف اتصال">
                        <Button
                          size="small"
                          type="text"
                          danger
                          icon={<Trash2 {...ICON14} />}
                          aria-label="حذف اتصال"
                          onClick={async () => {
                            if (await n.confirm(`حذف اتصال «${r.name}»؟`, "سفارش‌های تازهٔ این فروشگاه دیگر ثبت نمی‌شوند.", true)) remove.mutate(r.id);
                          }}
                        />
                      </Tooltip>
                    </span>
                  ) : null,
              },
            ]}
          />
        </Card>
      ) : tab === "events" ? (
        <Card
          title="سفارش‌های دریافتی"
          meta={<span className="blk-cap">۲۰۰ رویداد آخر</span>}
          tools={
            <Tooltip title="بازخوانی">
              <Button type="text" icon={<RotateCw {...ICON} className={events.isFetching ? "ds-spin" : undefined} />} onClick={() => events.refetch()} aria-label="بازخوانی" />
            </Tooltip>
          }
          flush
        >
          <Table
            className="blk-tbl"
            size="small"
            rowKey="id"
            loading={events.isLoading}
            dataSource={events.data ?? []}
            pagination={{ pageSize: 50, hideOnSinglePage: true, size: "small" }}
            scroll={{ x: 900 }}
            locale={{ emptyText: <EmptyState icon={Inbox} title="هنوز سفارشی نرسیده" /> }}
            columns={[
              { key: "at", dataIndex: "received_at", title: "زمان", width: 160, render: (v) => <span className="blk-2"><JDateTime v={v} /></span> },
              { key: "from", dataIndex: "integration_name", title: "فروشگاه", width: 180, ellipsis: true },
              { key: "ext", dataIndex: "external_id", title: "سفارش", width: 104, render: (v) => (v ? <span className="blk-docno">{faDigits(v)}</span> : <span className="ds-zero">—</span>) },
              { key: "st", dataIndex: "status", title: "وضعیت", width: 120, render: (v) => <StatusTag s={v} map={EV_STATUS} /> },
              {
                key: "res",
                title: "نتیجه",
                ellipsis: true,
                render: (_, r) =>
                  r.result?.invoice_id ? (
                    <Link className="blk-lnk" to={`/${orgId}/sales/invoices/${r.result.invoice_id}`}>فاکتور {docNo(r.result.no ?? "")}</Link>
                  ) : r.error ? (
                    <span className="text-danger">{r.error}</span>
                  ) : (
                    <span className="ds-zero">—</span>
                  ),
              },
              {
                key: "a",
                width: 120,
                render: (_, r) =>
                  r.status === "failed" && can("integrations", "edit") ? (
                    <Button size="small" icon={<RotateCw {...ICON14} />} onClick={() => retry.mutate(r.id)}>
                      تلاش دوباره
                    </Button>
                  ) : null,
              },
            ]}
          />
        </Card>
      ) : (
        <div className="blk-stack">
          <Card title="کلیدهای API" meta={<span className="blk-cap">دسترسی برنامه‌های دیگر</span>} flush>
            <Table
              className="blk-tbl"
              size="middle"
              rowKey="id"
              dataSource={keys.data ?? []}
              loading={keys.isLoading}
              pagination={false}
              scroll={{ x: 760 }}
              locale={{ emptyText: <EmptyState icon={KeyRound} title="کلیدی ساخته نشده" action={editable ? <Button icon={<Plus {...ICON} />} onClick={() => setKeyModal(true)}>کلید تازه</Button> : undefined} /> }}
              columns={[
                { key: "name", dataIndex: "name", title: "نام", ellipsis: true },
                { key: "prefix", dataIndex: "prefix", title: "شناسه", width: 180, render: (v) => <bdi dir="ltr" className="ds-mono blk-2">sm_{v}_…</bdi> },
                { key: "scopes", dataIndex: "scopes", title: "اجازه", width: 160, render: (v: string[]) => <span className="blk-2">{v.map((x) => (x === "read" ? "خواندن" : "ثبت")).join("، ")}</span> },
                { key: "used", dataIndex: "last_used_at", title: "آخرین استفاده", width: 160, render: (v) => <span className="blk-2"><JDateTime v={v} /></span> },
                { key: "st", dataIndex: "revoked_at", title: "وضعیت", width: 96, render: (v) => (v ? <Chip tone="danger">باطل</Chip> : <span className="blk-plain">فعال</span>) },
                {
                  key: "a",
                  width: 88,
                  render: (_, r) =>
                    !r.revoked_at && editable ? (
                      <span className="blk-ra">
                        <Button
                          size="small"
                          type="text"
                          danger
                          onClick={async () => {
                            if (await n.confirm(`ابطال کلید «${r.name}»؟`, "برنامه‌ای که با این کلید کار می‌کند دیگر دسترسی ندارد.", true)) revoke.mutate(r.id);
                          }}
                        >
                          ابطال
                        </Button>
                      </span>
                    ) : null,
                },
              ]}
            />
          </Card>
          <Card title="نمونهٔ ثبت سفارش از برنامهٔ دیگر">
            <pre className="blk-code">{`POST ${origin}/api/v1/orders
Authorization: Bearer sm_xxxxxxxx_...
{ "id": "1043", "customer": { "name": "علی", "mobile": "09121234567" },
  "items": [ { "sku": "A-100", "name": "کالا", "qty": 2, "price": 1500000 } ],
  "shipping": 300000, "post": false }`}</pre>
            <div className="blk-f-h mt-3">
              نشانی‌های دیگر: <bdi dir="ltr" className="ds-mono">GET /api/v1/items?q=</bdi> (کالاها با موجودی)، <bdi dir="ltr" className="ds-mono">GET /api/v1/parties?mobile=</bdi>، <bdi dir="ltr" className="ds-mono">GET /api/v1/invoices/:id</bdi>، <bdi dir="ltr" className="ds-mono">GET /api/v1/ping</bdi>
            </div>
          </Card>
        </div>
      )}
      <Modal open={add} onCancel={() => setAdd(false)} title="اتصال فروشگاه اینترنتی" footer={null} destroyOnHidden width={560}>
        <Form layout="vertical" requiredMark={false} initialValues={{ kind: "woocommerce", config: { post: false, prices_include_vat: true, price_factor: "1" } }} onFinish={(v) => create.mutate(v)}>
          <Form.Item name="kind" label="نوع فروشگاه"><Select options={Object.entries(KIND).map(([value, label]) => ({ value, label }))} /></Form.Item>
          <Form.Item name="name" label="نام" rules={[{ required: true }]}><Input placeholder="مثلاً فروشگاه وردپرسی" /></Form.Item>
          <Form.Item name="secret" label="کلید امضا (Secret)، اختیاری" extra="برای شاپیفای کلید امضای Webhook همان پنل؛ برای بقیه خالی بماند تا ساخته شود."><Input dir="ltr" className="ds-code" /></Form.Item>
          <Form.Item name={["config", "warehouse_id"]} label="انبار"><RefSelect entity="warehouse" allowClear /></Form.Item>
          <Form.Item name={["config", "default_party_id"]} label="مشتری پیش‌فرض (سفارش بی‌نام)"><PartySelect allowClear /></Form.Item>
          <Space size="large" wrap>
            <Form.Item name={["config", "post"]} label="ثبت قطعی فاکتور (خروج از انبار و سند)" valuePropName="checked"><Switch /></Form.Item>
            <Form.Item name={["config", "prices_include_vat"]} label="قیمت‌های سایت با مالیات است" valuePropName="checked"><Switch /></Form.Item>
          </Space>
          <Form.Item name={["config", "price_factor"]} label="ضریب قیمت" extra="اگر سایت به تومان و حساب‌ها به ریال است: ۱۰"><Input dir="ltr" className="ds-num !w-32" /></Form.Item>
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setAdd(false)}>انصراف</Button>
            <Button type="primary" htmlType="submit" loading={create.isPending}>ساخت اتصال</Button>
          </div>
        </Form>
      </Modal>
      <Modal open={keyModal} onCancel={() => setKeyModal(false)} title="کلید API تازه" footer={null} destroyOnHidden>
        <Form layout="vertical" initialValues={{ scopes: ["read", "write"] }} onFinish={(v) => newKey.mutate(v)}>
          <Form.Item name="name" label="برای چه برنامه‌ای؟" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="scopes" label="اجازه‌ها"><Select mode="multiple" options={[{ value: "read", label: "خواندن" }, { value: "write", label: "ثبت سفارش" }]} /></Form.Item>
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setKeyModal(false)}>انصراف</Button>
            <Button type="primary" htmlType="submit" loading={newKey.isPending}>ساخت کلید</Button>
          </div>
        </Form>
      </Modal>
      <Modal open={!!shown} onCancel={() => setShown(null)} onOk={() => setShown(null)} title={shown?.title} okText="یادداشت کردم" cancelButtonProps={{ style: { display: "none" } }} width={600}>
        <Note tone="warning" className="mb-4"><b>کلید فقط همین یک بار نمایش داده می‌شود.</b> آن را جای امنی نگه دارید.</Note>
        <div className="grid gap-4">
          {shown?.lines.map(([label, value]) => (
            <Field key={label} label={label}>
              <div className="blk-copy">
                <code>{value}</code>
                {copyBtn(value)}
              </div>
            </Field>
          ))}
        </div>
      </Modal>
    </div>
  );
}
