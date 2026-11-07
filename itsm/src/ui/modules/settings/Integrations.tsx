// «اتصال‌ها و API»: inbound webhooks (signed JSON events from other systems — monitoring, forms, chat tools, another
// service desk), the events they delivered, and API keys for other programs (/api/v1). A module that understands an
// event's topic turns it into its own records; until then events stay «دریافت شد» and can be processed later.
import { useState } from "react";
import { Button, Form, Input, Modal, Select, Switch, Table, Tabs, Tooltip, message } from "antd";
import { Plus, Webhook, RotateCw, Trash2, Copy, Inbox, KeyRound } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { useOrg } from "../../lib/org";
import { useSession } from "../../lib/session";
import { useAction, useNotify } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, JDateTime, StatusTag } from "../../components/display";
import { Card, Field, ICON, ICON14, Note } from "../../components/blocks";
import { faDigits } from "@shared/format";

const EV_STATUS: Record<string, [string, string]> = { processed: ["پردازش شد", "success"], failed: ["ناموفق", "error"], received: ["دریافت شد", "warning"], ignored: ["نادیده", "default"] };

interface IntegrationRow {
  id: string;
  name: string;
  config: { description?: string | null } | null;
  is_active: boolean;
  last_event_at: string | null;
  events: number;
  failed: number;
  webhook_path: string;
}
interface EventRow {
  id: string;
  received_at: string;
  integration_name: string | null;
  topic: string;
  external_id: string | null;
  status: string;
  result: Record<string, unknown> | null;
  error: string | null;
}
interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  last_used_at: string | null;
  revoked_at: string | null;
}

export default function Integrations() {
  const { api, can, orgId } = useOrg();
  const { meta } = useSession();
  const n = useNotify();
  const list = useQuery({ queryKey: ["integrations"], queryFn: () => api.get("/integrations").then((r) => r.integrations as IntegrationRow[]) });
  const events = useQuery({ queryKey: ["integration-events"], queryFn: () => api.get("/integrations/events").then((r) => r.events as EventRow[]), refetchInterval: 15000 });
  const keys = useQuery({ queryKey: ["api-keys"], queryFn: () => api.get("/integrations/api-keys").then((r) => r.keys as KeyRow[]) });
  const [add, setAdd] = useState(false);
  const [shown, setShown] = useState<{ title: string; lines: [string, string][] } | null>(null);
  const [keyModal, setKeyModal] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const create = useAction((v: { name: string; description?: string; secret?: string }) => api.post("/integrations", v), {
    invalidate: [["integrations"]],
    onSuccess: (r: any) => {
      setAdd(false);
      setShown({ title: "وب‌هوک ساخته شد", lines: [["نشانی وب‌هوک", `${origin}${r.integration.webhook_path}`], ["کلید امضا (Secret)", r.integration.secret]] });
    },
  });
  const toggle = useAction(({ id, is_active }: { id: string; is_active: boolean }) => api.patch(`/integrations/${id}`, { is_active }), { invalidate: [["integrations"]] });
  const remove = useAction((id: string) => api.del(`/integrations/${id}`), { success: "حذف شد", invalidate: [["integrations"]] });
  const retry = useAction((id: string) => api.post(`/integrations/events/${id}/retry`), { success: "دوباره پردازش شد", invalidate: [["integration-events"]] });
  const newKey = useAction((v: { name: string; scopes: string[] }) => api.post("/integrations/api-keys", v), {
    invalidate: [["api-keys"]],
    onSuccess: (r: any) => {
      setKeyModal(false);
      setShown({ title: "کلید API ساخته شد", lines: [["کلید", r.key], ["نشانی API", `${origin}/api/v1`]] });
    },
  });
  const revoke = useAction((id: string) => api.del(`/integrations/api-keys/${id}`), { success: "کلید باطل شد", invalidate: [["api-keys"]] });
  const editable = can("integrations", "full");

  const [tab, setTab] = useState("hooks");
  const copyBtn = (v: string) => (
    <Tooltip title="رونوشت">
      <Button type="text" size="small" icon={<Copy {...ICON14} />} aria-label="رونوشت" onClick={(e) => { e.stopPropagation(); void navigator.clipboard?.writeText(v); message.success("رونوشت شد."); }} />
    </Tooltip>
  );

  return (
    <div>
      <PageHeader
        title="اتصال‌ها و API"
        subtitle={<Link className="ds-link blk-hlink" to={`/${orgId}/help#integrations`}>راهنما</Link>}
        actions={
          editable && tab !== "events" ? (
            <Button type="primary" icon={<Plus {...ICON} />} onClick={() => (tab === "api" ? setKeyModal(true) : setAdd(true))}>
              {tab === "api" ? "کلید تازه" : "وب‌هوک تازه"}
            </Button>
          ) : null
        }
      />
      {meta?.mode === "desktop" ? (
        <p className="blk-line mb-4">
          <i className="ds-nuqta" aria-hidden />
          سامانه‌های بیرونی به نسخهٔ وب وصل می‌شوند؛ وب‌هوک و کلید API را در نسخهٔ وب بسازید.
        </p>
      ) : null}
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: "hooks", label: "وب‌هوک‌ها" },
          { key: "events", label: "رویدادهای دریافتی" },
          { key: "api", label: "کلیدهای API" },
        ]}
      />
      {tab === "hooks" ? (
        <Card title="وب‌هوک‌ها" meta={<span className="blk-cap">رویدادهای امضاشده از سامانه‌های دیگر</span>} flush>
          <Table<IntegrationRow>
            className="blk-tbl"
            size="middle"
            rowKey="id"
            loading={list.isLoading}
            dataSource={list.data ?? []}
            pagination={false}
            scroll={{ x: 900 }}
            locale={{ emptyText: <EmptyState icon={Webhook} title="هنوز وب‌هوکی ساخته نشده" description="پایش، فرم‌ها، ابزارهای گفت‌وگو یا هر سامانه‌ای که رویداد را به‌صورت JSON بفرستد." action={editable ? <Button type="primary" icon={<Plus {...ICON} />} onClick={() => setAdd(true)}>وب‌هوک تازه</Button> : undefined} /> }}
            columns={[
              { key: "name", dataIndex: "name", title: "نام", width: 220, render: (v, r) => <div><div className="font-medium">{v}</div>{r.config?.description ? <div className="blk-3" style={{ fontSize: 12 }}>{r.config.description}</div> : null}</div> },
              {
                key: "url",
                title: "نشانی وب‌هوک",
                render: (_, r) => (
                  <span className="flex min-w-0 items-center gap-1">
                    <bdi dir="ltr" className="ds-mono blk-2 truncate">{`${origin}${r.webhook_path}`}</bdi>
                    {copyBtn(`${origin}${r.webhook_path}`)}
                  </span>
                ),
              },
              {
                key: "events",
                title: "رویدادها",
                width: 140,
                render: (_, r) => (
                  <span className="inline-flex items-center gap-2 ds-num">
                    {faDigits(r.events)}
                    {r.failed ? <Chip tone="danger" fig>{faDigits(r.failed)} ناموفق</Chip> : null}
                  </span>
                ),
              },
              { key: "last", dataIndex: "last_event_at", title: "آخرین رویداد", width: 160, render: (v) => <span className="blk-2"><JDateTime v={v} /></span> },
              { key: "active", dataIndex: "is_active", title: "فعال", width: 72, render: (v, r) => <Switch size="small" checked={v} disabled={!editable} onChange={(is_active) => toggle.mutate({ id: r.id, is_active })} aria-label="فعال" /> },
              {
                key: "a",
                width: 56,
                render: (_, r) =>
                  editable ? (
                    <span className="blk-ra">
                      <Tooltip title="حذف وب‌هوک">
                        <Button
                          size="small"
                          type="text"
                          danger
                          icon={<Trash2 {...ICON14} />}
                          aria-label="حذف وب‌هوک"
                          onClick={async () => {
                            if (await n.confirm(`حذف وب‌هوک «${r.name}»؟`, "رویدادهای تازهٔ این سامانه دیگر پذیرفته نمی‌شوند.", true)) remove.mutate(r.id);
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
          title="رویدادهای دریافتی"
          meta={<span className="blk-cap">۲۰۰ رویداد آخر</span>}
          tools={
            <Tooltip title="بازخوانی">
              <Button type="text" icon={<RotateCw {...ICON} className={events.isFetching ? "ds-spin" : undefined} />} onClick={() => events.refetch()} aria-label="بازخوانی" />
            </Tooltip>
          }
          flush
        >
          <Table<EventRow>
            className="blk-tbl"
            size="small"
            rowKey="id"
            loading={events.isLoading}
            dataSource={events.data ?? []}
            pagination={{ pageSize: 50, hideOnSinglePage: true, size: "small" }}
            scroll={{ x: 900 }}
            locale={{ emptyText: <EmptyState icon={Inbox} title="هنوز رویدادی نرسیده" /> }}
            columns={[
              { key: "at", dataIndex: "received_at", title: "زمان", width: 160, render: (v) => <span className="blk-2"><JDateTime v={v} /></span> },
              { key: "from", dataIndex: "integration_name", title: "وب‌هوک", width: 170, ellipsis: true },
              { key: "topic", dataIndex: "topic", title: "موضوع", width: 150, render: (v) => <bdi dir="ltr" className="ds-mono blk-2">{v}</bdi> },
              { key: "ext", dataIndex: "external_id", title: "شناسهٔ فرستنده", width: 150, render: (v) => (v ? <bdi dir="ltr" className="ds-mono blk-2">{v}</bdi> : <span className="ds-zero">—</span>) },
              { key: "st", dataIndex: "status", title: "وضعیت", width: 120, render: (v) => <StatusTag s={v} map={EV_STATUS} /> },
              {
                key: "res",
                title: "نتیجه",
                ellipsis: true,
                render: (_, r) => (r.error ? <span className="text-danger">{r.error}</span> : r.result ? <span className="blk-2">ثبت شد</span> : <span className="ds-zero">—</span>),
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
            <Table<KeyRow>
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
          <Card title="نمونهٔ درخواست از برنامهٔ دیگر">
            <pre className="blk-code">{`GET ${origin}/api/v1/ping
Authorization: Bearer sm_xxxxxxxx_...`}</pre>
            <div className="blk-f-h mt-3">پاسخ، سازمانی است که کلید به آن تعلق دارد. ماژول‌ها نشانی‌های خود را زیر همین <bdi dir="ltr" className="ds-mono">/api/v1</bdi> اضافه می‌کنند.</div>
          </Card>
        </div>
      )}
      <Modal open={add} onCancel={() => setAdd(false)} title="وب‌هوک تازه" footer={null} destroyOnHidden width={560}>
        <Form layout="vertical" requiredMark={false} onFinish={(v) => create.mutate(v)}>
          <Form.Item name="name" label="نام" rules={[{ required: true, min: 2, message: "نام وب‌هوک را وارد کنید." }]}><Input placeholder="مثلاً سامانهٔ پایش شبکه" /></Form.Item>
          <Form.Item name="description" label="چه چیزی می‌فرستد؟ (اختیاری)"><Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} maxLength={400} /></Form.Item>
          <Form.Item name="secret" label="کلید امضا (Secret)، اختیاری" extra="اگر سامانهٔ فرستنده کلید خودش را دارد اینجا بنویسید (دست‌کم ۱۶ نویسه)؛ وگرنه خالی بماند تا ساخته شود."><Input dir="ltr" className="ds-code" /></Form.Item>
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setAdd(false)}>انصراف</Button>
            <Button type="primary" htmlType="submit" loading={create.isPending}>ساخت وب‌هوک</Button>
          </div>
        </Form>
      </Modal>
      <Modal open={keyModal} onCancel={() => setKeyModal(false)} title="کلید API تازه" footer={null} destroyOnHidden>
        <Form layout="vertical" initialValues={{ scopes: ["read"] }} onFinish={(v) => newKey.mutate(v)}>
          <Form.Item name="name" label="برای چه برنامه‌ای؟" rules={[{ required: true, min: 2, message: "نام کلید را وارد کنید." }]}><Input /></Form.Item>
          <Form.Item name="scopes" label="اجازه‌ها"><Select mode="multiple" options={[{ value: "read", label: "خواندن" }, { value: "write", label: "ثبت" }]} /></Form.Item>
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
