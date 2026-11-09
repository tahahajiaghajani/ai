// Record-page parts of the integration hub:
//   UserAccess        on an integration user: its ITSM roles (an owner's choice) and its API keys — tables × operations,
//                     shown once when made, revocable
//   SecretActions     «راز تازه» for a row's signing secret or token (webhooks, inbound endpoints, Jira/GitHub, SCIM),
//                     shown once with the URL other systems call
//   WebhookActions    test with a real record, resume after a pause; WebhookDeliveries: the delivery log and dead letters
//   InboundEvents     what an inbound endpoint received, processed again on demand
//   DirectoryActions  test, preview (the plan), approve and apply — roles from directory groups only when confirmed
//   ExportActions     run a scheduled export now
//   IssuesPanel       side panel on records: their Jira/GitHub issues and «ساخت issue»
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Input, Modal, Select, Space, Table, Typography } from "antd";
import { KeyRound, PlugZap, Play, RotateCcw, Trash2, Eye, CheckCheck, BadgeCheck, Plus, ExternalLink, RefreshCw, Send } from "lucide-react";
import { API_OPS, API_OP_LABELS, type ApiOp, type TableScope } from "@shared/integration/scopes";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { fa } from "../../lib/fa";
import { Chip, EmptyState, JDateTime, Loader } from "../../components/display";
import { ICON, Note } from "../../components/blocks";
import type { RecordContext } from "../../records/extensions";

const origin = () => (typeof window !== "undefined" ? window.location.origin : "");
type Row = Record<string, any>;

function ShownOnce({ title, secret, url, onClose }: { title: string; secret: string | null; url?: string | null; onClose: () => void }) {
  return (
    <Modal open={!!secret} title={title} onCancel={onClose} footer={<Button type="primary" onClick={onClose}>رونوشت گرفتم</Button>} destroyOnHidden>
      <div className="flex flex-col gap-3">
        <Note tone="warning">این مقدار فقط همین یک بار نمایش داده می‌شود و پس از این هیچ‌جا خوانده نمی‌شود.</Note>
        <Typography.Paragraph copyable={{ text: secret ?? "" }} className="ltr ds-mono m-0 break-all">{secret}</Typography.Paragraph>
        {url ? (
          <>
            <div className="text-[13px] text-ink-2">نشانی:</div>
            <Typography.Paragraph copyable className="ltr ds-mono m-0 break-all text-[12px]">{url}</Typography.Paragraph>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- integration users

interface KeyView {
  id: string;
  name: string;
  prefix: string;
  table_scopes: TableScope[] | null;
  rate_limit: number | null;
  expires_at: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  calls: number;
}

function ScopeEditor({ value, onChange, tables }: { value: TableScope[]; onChange: (v: TableScope[]) => void; tables: { value: string; label: string }[] }) {
  const set = (i: number, patch: Partial<TableScope>) => onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div className="flex flex-col gap-2">
      {value.map((s, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-center">
          <Select showSearch optionFilterProp="label" value={s.table} onChange={(t) => set(i, { table: t })} options={[{ value: "*", label: "همهٔ جدول‌ها" }, ...tables]} aria-label="جدول" />
          <Checkbox.Group value={s.ops} onChange={(ops) => set(i, { ops: ops as ApiOp[] })} options={API_OPS.map((o) => ({ value: o, label: API_OP_LABELS[o] }))} />
          <Button type="text" aria-label="حذف" icon={<Trash2 {...ICON} />} onClick={() => onChange(value.filter((_, j) => j !== i))} />
        </div>
      ))}
      <Button icon={<Plus {...ICON} />} onClick={() => onChange([...value, { table: "*", ops: ["read"] }])}>
        جدول دیگر
      </Button>
    </div>
  );
}

export function UserAccess({ ctx }: { ctx: RecordContext }) {
  const { api, can } = useOrg();
  const qc = useQueryClient();
  const id = String(ctx.row.id);
  const roles = useQuery({ queryKey: ["integration", "roles", id], queryFn: () => api.get<{ roles: string[] }>(`/integration/users/${id}/roles`) });
  const catalog = useQuery({ queryKey: ["access", "roles"], queryFn: () => api.get<{ roles: { key: string; name: string }[] }>("/access/roles"), staleTime: 60_000 });
  const keys = useQuery({ queryKey: ["integration", "keys", id], queryFn: () => api.get<{ keys: KeyView[] }>("/integration/keys", { user: id }) });
  const meta = useQuery({ queryKey: ["meta", "tables"], queryFn: () => api.get<{ tables: { key: string; plural: string; virtual?: boolean }[] }>("/meta/tables"), staleTime: 60_000 });
  const tableOptions = useMemo(() => (meta.data?.tables ?? []).filter((t) => !t.virtual).map((t) => ({ value: t.key, label: t.plural })), [meta.data]);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<TableScope[]>([{ table: "*", ops: ["read"] }]);
  const [secret, setSecret] = useState<string | null>(null);
  const saveRoles = useAction((r: string[]) => api.put(`/integration/users/${id}/roles`, { roles: r }), { success: "نقش‌ها ذخیره شد", invalidate: [["integration", "roles", id]] });
  const create = useAction(() => api.post<{ key: string }>(`/integration/users/${id}/keys`, { name, scopes }), {
    onSuccess: (d) => {
      setSecret(d.key);
      setOpen(false);
      setName("");
      qc.invalidateQueries({ queryKey: ["integration", "keys", id] });
    },
  });
  const revoke = useAction((k: string) => api.del(`/integration/keys/${k}`), { success: "کلید باطل شد", invalidate: [["integration", "keys", id]] });
  const current = chosen ?? roles.data?.roles ?? [];
  const full = can("integrations", "full");
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2" aria-label="نقش‌ها">
        <div className="text-[13px] text-ink-2">نقش‌های ITSM این کاربر (هر کلید فقط درون این دسترسی کار می‌کند)</div>
        <Select mode="multiple" value={current} onChange={setChosen} options={(catalog.data?.roles ?? []).map((r) => ({ value: r.key, label: r.name }))} placeholder="بدون نقش: هیچ درخواستی پذیرفته نمی‌شود" disabled={!full} aria-label="نقش‌ها" />
        {chosen ? (
          <Space>
            <Button type="primary" loading={saveRoles.isPending} onClick={() => saveRoles.mutate(chosen, { onSuccess: () => setChosen(null) })}>
              ذخیرهٔ نقش‌ها
            </Button>
            <Button onClick={() => setChosen(null)}>انصراف</Button>
          </Space>
        ) : null}
      </section>
      <section className="flex flex-col gap-2" aria-label="کلیدهای API">
        <div className="flex items-center justify-between">
          <span className="font-medium">کلیدهای API</span>
          {full ? (
            <Button icon={<KeyRound {...ICON} />} onClick={() => setOpen(true)}>
              کلید تازه
            </Button>
          ) : null}
        </div>
        {keys.isLoading ? (
          <Loader />
        ) : (keys.data?.keys ?? []).length ? (
          <Table<KeyView>
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={keys.data!.keys}
            scroll={{ x: true }}
            columns={[
              { title: "نام", dataIndex: "name" },
              { title: "پیشوند", dataIndex: "prefix", render: (v) => <span className="ltr ds-mono">sm_{v}_…</span> },
              { title: "دامنه", render: (_, k) => (k.table_scopes ?? []).map((s) => `${s.table === "*" ? "همه" : s.table}: ${s.ops.map((o) => API_OP_LABELS[o]).join("، ")}`).join(" | ") },
              { title: "فراخوانی", dataIndex: "calls", render: (v) => <span className="ds-num">{fa(v)}</span> },
              { title: "آخرین استفاده", dataIndex: "last_used_at", render: (v) => (v ? <JDateTime v={v} /> : "—") },
              { title: "وضعیت", render: (_, k) => (k.revoked_at ? <Chip tone="danger">باطل</Chip> : k.expires_at && Date.parse(k.expires_at) < Date.now() ? <Chip tone="warning">منقضی</Chip> : <Chip tone="in">فعال</Chip>) },
              { title: "", render: (_, k) => (!k.revoked_at && full ? <Button size="small" danger onClick={() => revoke.mutate(k.id)}>باطل کردن</Button> : null) },
            ]}
          />
        ) : (
          <EmptyState compact icon={KeyRound} title="هنوز کلیدی ساخته نشده است" />
        )}
      </section>
      <Modal open={open} title="کلید API تازه" onCancel={() => setOpen(false)} onOk={() => create.mutate(undefined)} okText="ساخت کلید" confirmLoading={create.isPending} destroyOnHidden>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[13px] text-ink-2">نام کلید</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً سامانهٔ پایش زبیکس" />
          </label>
          <div className="text-[13px] text-ink-2">جدول‌ها و کارها</div>
          <ScopeEditor value={scopes} onChange={setScopes} tables={tableOptions} />
        </div>
      </Modal>
      <ShownOnce title="کلید API" secret={secret} url={`${origin()}/api/v1/openapi.json`} onClose={() => setSecret(null)} />
    </div>
  );
}

// ---------------------------------------------------------------- secrets of a row

const SECRET_LABEL: Record<string, string> = {
  webhook_subscription: "راز امضای وب‌هوک",
  inbound_endpoint: "توکن نقطهٔ دریافت",
  issue_connection: "راز وب‌هوک Jira / GitHub",
  directory_source: "توکن SCIM",
  export_schedule: "راز امضای خروجی",
};

export function SecretButton({ ctx }: { ctx: RecordContext }) {
  const { api, can } = useOrg();
  const [shown, setShown] = useState<{ secret: string; path: string | null } | null>(null);
  const make = useAction(() => api.post<{ secret: string; path: string | null }>("/integration/secret", { table: ctx.table, id: ctx.row.id }), {
    onSuccess: (d) => {
      setShown(d);
      ctx.refresh();
    },
  });
  if (!can("integrations", "full") || (ctx.table === "directory_source" && ctx.row.kind !== "scim")) return null;
  return (
    <>
      <Button icon={<KeyRound {...ICON} />} onClick={() => make.mutate(undefined)} loading={make.isPending}>
        {SECRET_LABEL[ctx.table] ? `${SECRET_LABEL[ctx.table]} تازه` : "راز تازه"}
      </Button>
      <ShownOnce title={SECRET_LABEL[ctx.table] ?? "راز"} secret={shown?.secret ?? null} url={shown?.path ? `${origin()}${shown.path}` : null} onClose={() => setShown(null)} />
    </>
  );
}

// ---------------------------------------------------------------- webhooks

export function WebhookActions({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const test = useAction(() => api.post<{ ok: boolean; status: number; ms: number; skipped: string | null }>(`/integration/webhooks/${ctx.row.id}/test`, {}), {
    success: (d) => (d.ok ? `ارسال آزمایشی موفق بود (${fa(d.status)}، ${fa(d.ms)} میلی‌ثانیه)` : d.skipped ? `فرستاده نشد: ${d.skipped}` : `پاسخ ${fa(d.status)}`),
    onSuccess: () => ctx.refresh(),
  });
  const resume = useAction(() => api.post(`/integration/webhooks/${ctx.row.id}/resume`), { success: "اشتراک از سر گرفته شد", onSuccess: () => ctx.refresh() });
  return (
    <Space wrap>
      <SecretButton ctx={ctx} />
      <Button icon={<Send {...ICON} />} onClick={() => test.mutate(undefined)} loading={test.isPending}>
        ارسال آزمایشی
      </Button>
      {ctx.row.paused ? (
        <Button icon={<Play {...ICON} />} onClick={() => resume.mutate(undefined)} loading={resume.isPending}>
          از سر گرفتن
        </Button>
      ) : null}
    </Space>
  );
}

interface Delivery {
  id: string;
  event: string;
  record_number: string | null;
  status: string;
  attempts: number;
  response_code: number | null;
  latency_ms: number | null;
  error: string | null;
  created_at: string;
}

const DELIVERY: Record<string, [string, "in" | "warning" | "danger" | "neutral"]> = {
  delivered: ["رسید", "in"],
  pending: ["در صف", "neutral"],
  failed: ["تلاش دوباره", "warning"],
  dead: ["ناموفق نهایی", "danger"],
  skipped: ["فرستاده نشد", "neutral"],
};

export function WebhookDeliveries({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const q = useQuery({ queryKey: ["integration", "deliveries", ctx.row.id], queryFn: () => api.get<{ deliveries: Delivery[] }>("/integration/webhooks/deliveries", { subscription: String(ctx.row.id) }) });
  const replay = useAction((id: string) => api.post(`/integration/webhooks/deliveries/${id}/replay`), { success: "دوباره در صف ارسال قرار گرفت", invalidate: [["integration", "deliveries", ctx.row.id]] });
  if (q.isLoading) return <Loader />;
  const rows = q.data?.deliveries ?? [];
  if (!rows.length) return <EmptyState compact icon={Send} title="هنوز ارسالی نبوده است" />;
  return (
    <Table<Delivery>
      size="small"
      rowKey="id"
      dataSource={rows}
      pagination={{ pageSize: 20, hideOnSinglePage: true }}
      scroll={{ x: true }}
      columns={[
        { title: "زمان", dataIndex: "created_at", render: (v) => <JDateTime v={v} /> },
        { title: "رویداد", dataIndex: "event" },
        { title: "رکورد", dataIndex: "record_number", render: (v) => <span className="ltr ds-num">{v ?? "—"}</span> },
        { title: "نتیجه", dataIndex: "status", render: (v) => <Chip tone={DELIVERY[v]?.[1] ?? "neutral"}>{DELIVERY[v]?.[0] ?? v}</Chip> },
        { title: "پاسخ", render: (_, d) => (d.response_code ? <span className="ds-num">{fa(d.response_code)} · {fa(d.latency_ms ?? 0)} ms</span> : d.error ?? "—") },
        { title: "", render: (_, d) => (["dead", "failed", "skipped"].includes(d.status) ? <Button size="small" icon={<RotateCcw {...ICON} />} onClick={() => replay.mutate(d.id)}>تکرار</Button> : null) },
      ]}
    />
  );
}

// ---------------------------------------------------------------- inbound endpoints

export function InboundEvents({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const q = useQuery({ queryKey: ["integration", "inbound", ctx.row.id], queryFn: () => api.get<{ events: Row[] }>("/integration/inbound/events", { endpoint: String(ctx.row.id) }) });
  const retry = useAction((id: string) => api.post(`/integration/inbound/events/${id}/retry`), { success: "دوباره پردازش شد", invalidate: [["integration", "inbound", ctx.row.id]] });
  if (q.isLoading) return <Loader />;
  const rows = q.data?.events ?? [];
  if (!rows.length) return <EmptyState compact icon={PlugZap} title="هنوز پیامی نرسیده است" description={<span className="ltr ds-mono text-[12px]">{`${origin()}/api/v1/in/${ctx.row.id}`}</span>} />;
  return (
    <Table<Row>
      size="small"
      rowKey="id"
      dataSource={rows}
      pagination={{ pageSize: 20, hideOnSinglePage: true }}
      scroll={{ x: true }}
      columns={[
        { title: "زمان", dataIndex: "received_at", render: (v) => <JDateTime v={v} /> },
        { title: "شناسهٔ فرستنده", dataIndex: "external_id", render: (v) => <span className="ltr ds-mono">{v ?? "—"}</span> },
        { title: "نتیجه", dataIndex: "status", render: (v, r) => (v === "processed" ? <Chip tone="in">{r.result?.action === "updated" ? "به‌روز شد" : "ساخته شد"}</Chip> : v === "failed" ? <Chip tone="danger">ناموفق</Chip> : <Chip>{v}</Chip>) },
        { title: "خطا", dataIndex: "error", render: (v) => v ?? "" },
        { title: "", render: (_, r) => (r.status === "failed" ? <Button size="small" icon={<RotateCcw {...ICON} />} onClick={() => retry.mutate(String(r.id))}>پردازش دوباره</Button> : null) },
      ]}
    />
  );
}

// ---------------------------------------------------------------- directory sources

interface Plan {
  create: { email: string; name: string; roles: string[]; unit: string | null }[];
  update: { email: string; name: string; changes: Record<string, unknown> }[];
  deactivate: { email: string; name: string; reason: string }[];
  reactivate: { email: string; name: string }[];
  group_adds: { group_id: string; email: string }[];
  group_removes: { group_id: string; email: string }[];
  role_grants: { email: string; role: string; source: string }[];
  units: string[];
  skipped: { name: string; reason: string }[];
}

function PlanView({ plan }: { plan: Plan }) {
  const block = (title: string, items: string[], tone: "in" | "warning" | "danger" | "neutral" = "neutral") =>
    items.length ? (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Chip tone={tone}>{fa(items.length)}</Chip>
          <span className="font-medium">{title}</span>
        </div>
        <ul className="m-0 list-none p-0 text-[13px] text-ink-2">
          {items.slice(0, 50).map((t, i) => (
            <li key={i}>{t}</li>
          ))}
          {items.length > 50 ? <li>… و {fa(items.length - 50)} مورد دیگر</li> : null}
        </ul>
      </div>
    ) : null;
  return (
    <div className="flex flex-col gap-3">
      {block("عضو تازه", plan.create.map((c) => `${c.name} (${c.email})${c.roles.length ? ` — نقش: ${c.roles.join("، ")}` : ""}`), "in")}
      {block("به‌روزرسانی", plan.update.map((u) => `${u.name}: ${Object.keys(u.changes).join("، ")}`))}
      {block("غیرفعال شدن", plan.deactivate.map((d) => `${d.name} — ${d.reason}`), "danger")}
      {block("فعال شدن دوباره", plan.reactivate.map((d) => d.name), "in")}
      {block("نقش از گروه‌های فهرست (نیازمند تأیید)", plan.role_grants.map((g) => `${g.email} ← ${g.role} (${g.source})`), "warning")}
      {block("عضویت گروه", [...plan.group_adds.map((g) => `+ ${g.email}`), ...plan.group_removes.map((g) => `− ${g.email}`)])}
      {block("واحد تازه", plan.units)}
      {block("نادیده", plan.skipped.map((s) => `${s.name || "بی‌نام"} — ${s.reason}`))}
    </div>
  );
}

export function DirectoryActions({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const r = ctx.row;
  const [preview, setPreview] = useState<{ run_id: string; plan: Plan } | null>(null);
  const [roles, setRoles] = useState(false);
  const test = useAction(() => api.post<{ ok: boolean; message: string }>(`/integration/directory/${r.id}/test`), { success: (d) => d.message });
  const run = useAction(() => api.post<{ run_id: string; plan: Plan }>(`/integration/directory/${r.id}/preview`), { onSuccess: (d) => setPreview(d) });
  const approve = useAction(() => api.post(`/integration/directory/${r.id}/approve`), { success: "منبع با دسترسی شما تأیید شد", onSuccess: () => ctx.refresh() });
  const apply = useAction(() => api.post<{ created: number; deactivated: number; roles_pending: number }>(`/integration/directory/${r.id}/apply`, { run_id: preview!.run_id, roles }), {
    success: (d) => `اعمال شد: ${fa(d.created)} عضو تازه، ${fa(d.deactivated)} غیرفعال${d.roles_pending ? `، ${fa(d.roles_pending)} نقش در انتظار تأیید` : ""}`,
    onSuccess: () => {
      setPreview(null);
      ctx.refresh();
    },
  });
  return (
    <Space wrap>
      {r.kind === "ldap" ? (
        <>
          <Button icon={<PlugZap {...ICON} />} onClick={() => test.mutate(undefined)} loading={test.isPending}>
            آزمایش اتصال
          </Button>
          <Button icon={<Eye {...ICON} />} onClick={() => run.mutate(undefined)} loading={run.isPending}>
            پیش‌نمایش
          </Button>
        </>
      ) : (
        <SecretButton ctx={ctx} />
      )}
      <Button icon={<BadgeCheck {...ICON} />} onClick={() => approve.mutate(undefined)} loading={approve.isPending}>
        تأیید منبع با دسترسی من
      </Button>
      <Modal
        open={!!preview}
        title="پیش‌نمایش همگام‌سازی"
        width={720}
        onCancel={() => setPreview(null)}
        footer={
          <Space>
            <Checkbox checked={roles} onChange={(e) => setRoles(e.target.checked)}>
              نقش‌های گروه‌ها را هم بده
            </Checkbox>
            <Button onClick={() => setPreview(null)}>بستن</Button>
            <Button type="primary" icon={<CheckCheck {...ICON} />} disabled={r.mode !== "apply"} loading={apply.isPending} onClick={() => apply.mutate(undefined)}>
              اعمال همین پیش‌نمایش
            </Button>
          </Space>
        }
        destroyOnHidden
      >
        {r.mode !== "apply" ? <Note>این منبع در حالت «فقط پیش‌نمایش» است؛ برای اعمال، حالت آن را «اعمال» کنید.</Note> : null}
        {preview ? <PlanView plan={preview.plan} /> : null}
      </Modal>
    </Space>
  );
}

export function DirectoryUrls({ ctx }: { ctx: RecordContext }) {
  if (ctx.row.kind !== "scim") return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[13px] text-ink-2">نشانی SCIM (Tenant URL)</span>
      <Typography.Paragraph copyable className="ltr ds-mono m-0 break-all text-[12px]">{`${origin()}/api/v1/scim/${ctx.row.id}`}</Typography.Paragraph>
    </div>
  );
}

// ---------------------------------------------------------------- issue connections, exports

export function IssueConnectionUrls({ ctx }: { ctx: RecordContext }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[13px] text-ink-2">نشانی وب‌هوک برای {ctx.row.kind === "jira" ? "Jira" : "GitHub"}</span>
      <Typography.Paragraph copyable className="ltr ds-mono m-0 break-all text-[12px]">{`${origin()}/api/v1/issues/${ctx.row.id}/hook`}</Typography.Paragraph>
    </div>
  );
}

export function ExportActions({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const run = useAction(() => api.post<{ ok: boolean; message: string }>(`/integration/exports/${ctx.row.id}/run`), { success: (d) => d.message, onSuccess: () => ctx.refresh() });
  return (
    <Space wrap>
      <SecretButton ctx={ctx} />
      <Button icon={<Play {...ICON} />} onClick={() => run.mutate(undefined)} loading={run.isPending}>
        اجرای همین حالا
      </Button>
    </Space>
  );
}

// ---------------------------------------------------------------- the issues of a record (side panel)

export function IssuesPanel({ ctx }: { ctx: RecordContext }) {
  const { api, can } = useOrg();
  const qc = useQueryClient();
  const key = ["integration", "refs", ctx.table, ctx.row.id];
  const refs = useQuery({ queryKey: key, queryFn: () => api.get<{ refs: Row[] }>("/integration/issues/refs", { table: ctx.table, id: String(ctx.row.id) }) });
  const conns = useQuery({
    queryKey: ["integration", "issue-connections"],
    queryFn: () => api.get<{ rows: Row[] }>("/r/issue_connection", { size: "50", total: "false" }),
    enabled: can("integrations", "view"),
    staleTime: 60_000,
  });
  const usable = (conns.data?.rows ?? []).filter((c) => c.active !== false && (!c.tables?.length || c.tables.includes(ctx.table)));
  const [conn, setConn] = useState<string | null>(null);
  const [remote, setRemote] = useState("");
  const link = useAction(() => api.post("/integration/issues/link", { connection_id: conn ?? usable[0]?.id, table: ctx.table, record_id: ctx.row.id, remote_key: remote.trim() || null }), {
    success: "issue پیوند خورد",
    onSuccess: () => {
      setRemote("");
      qc.invalidateQueries({ queryKey: key });
      ctx.refresh();
    },
  });
  const refresh = useAction((id: string) => api.post(`/integration/issues/refs/${id}/refresh`), { invalidate: [key] });
  const rows = refs.data?.refs ?? [];
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-2">
          <a href={r.remote_url ?? undefined} target="_blank" rel="noreferrer" className="ltr ds-mono">
            {r.remote_key}
          </a>
          {r.remote_state ? <Chip>{r.remote_state}</Chip> : null}
          {r.sync_state === "error" ? <Chip tone="danger">خطا</Chip> : null}
          <Button size="small" type="text" aria-label="به‌روزرسانی" icon={<RefreshCw {...ICON} />} onClick={() => refresh.mutate(String(r.id))} />
          {r.remote_url ? <ExternalLink {...ICON} aria-hidden /> : null}
        </div>
      ))}
      {!rows.length ? <span className="text-[13px] text-ink-3">issue پیوندخورده‌ای نیست</span> : null}
      {usable.length && ctx.meta.canWrite ? (
        <div className="flex flex-col gap-2">
          {usable.length > 1 ? <Select size="small" value={conn ?? usable[0].id} onChange={setConn} options={usable.map((c) => ({ value: c.id, label: c.name }))} aria-label="اتصال" /> : null}
          <Input size="small" value={remote} onChange={(e) => setRemote(e.target.value)} placeholder="کلید issue موجود (خالی: ساخت issue تازه)" className="ltr" />
          <Button size="small" icon={<Plus {...ICON} />} loading={link.isPending} onClick={() => link.mutate(undefined)}>
            {remote.trim() ? "پیوند به issue" : "ساخت issue"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
