// «امنیت ورود و نشست‌ها»: the organisation's session policy (idle timeout, lifetime, one session per person,
// re-authentication, browser-only cookies), local sign-in closed to break-glass accounts, the local lockout that keeps
// password spraying away from the domain controllers; the sessions open now (end one, a member's or everyone's), the
// sign-in audit (every attempt: method, source, address, result, reason) and the login names held back.
// Explanations live in «راهنما» and docs/AD_FA.md.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Form, InputNumber, Radio, Segmented, Select, Switch, Table, Tabs, Tooltip, Input } from "antd";
import { LogOut, ShieldCheck, Unlock, Landmark, Search } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useAction, useDebounced } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Chip, JDateTime } from "../../components/display";
import { Card, ICON, ICON14, Note } from "../../components/blocks";
import { BANK_POLICY, type AuthPolicy } from "@shared/auth/policy";
import { METHOD_LABELS, REASON_LABELS } from "@shared/auth/login";

type Row = Record<string, any>;

interface PolicyView {
  policy: AuthPolicy;
  sources: { id: string; name: string; login_enabled: boolean; approved: boolean; sso_mode: string | null; active: boolean }[];
  breakglass: { id: string; full_name: string; email: string }[];
  cookie: { secure: boolean; https: boolean; mode: string };
  session: { method: string; org_scoped: boolean };
}

const methodLabel = (m: string | null | undefined) => METHOD_LABELS[m ?? "password"] ?? m ?? "";

export default function Security() {
  const { can } = useOrg();
  const full = can("users", "full");
  return (
    <div>
      <PageHeader title="امنیت ورود و نشست‌ها" />
      <Tabs
        items={[
          { key: "policy", label: "سیاست", children: <Policy /> },
          ...(full
            ? [
                { key: "sessions", label: "نشست‌های باز", children: <Sessions /> },
                { key: "signins", label: "گزارش ورودها", children: <Signins /> },
                { key: "locks", label: "قفل‌ها", children: <Locks /> },
              ]
            : []),
        ]}
      />
    </div>
  );
}

function Policy() {
  const { api, can } = useOrg();
  const editable = can("settings", "full");
  const q = useQuery({ queryKey: ["auth", "policy"], queryFn: () => api.get<PolicyView>("/auth/policy") });
  const members = useQuery({ queryKey: ["members"], queryFn: () => api.get<{ members: { user_id: string; full_name: string; email: string; is_active: boolean }[] }>("/members"), enabled: editable });
  const [form] = Form.useForm();
  useEffect(() => {
    if (q.data) form.setFieldsValue(q.data.policy);
  }, [q.data, form]);
  const save = useAction((v: AuthPolicy) => api.put<{ tightened: number }>("/auth/policy", v), {
    success: (d) => (d.tightened ? `ذخیره شد؛ ${d.tightened.toLocaleString("fa-IR")} نشست باز با سیاست تازه هماهنگ شد` : "ذخیره شد"),
    invalidate: [["auth", "policy"]],
  });
  const directory = (q.data?.sources ?? []).some((s) => s.login_enabled && s.approved && s.active);
  const localLogin = Form.useWatch("local_login", form);
  return (
    <Form form={form} layout="vertical" requiredMark={false} disabled={!editable} onFinish={(v) => save.mutate(v)}>
      <div className="blk-cols grid items-start gap-4 lg:grid-cols-2">
        <Card
          title="نشست‌ها"
          tools={
            editable ? (
              <Tooltip title="زمان بیکاری ۱۵ دقیقه، عمر ۱۰ ساعت، یک نشست برای هر نفر، تأیید دوباره پس از ۱۰ دقیقه، کوکی تا بستن مرورگر">
                <Button size="small" icon={<Landmark {...ICON14} />} onClick={() => form.setFieldsValue({ session: BANK_POLICY.session, lockout: BANK_POLICY.lockout })}>
                  پیشنهاد بانک
                </Button>
              </Tooltip>
            ) : null
          }
        >
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Form.Item name={["session", "idle_minutes"]} label="پایان پس از بیکاری (دقیقه)" extra="۰: هرگز">
              <InputNumber min={0} max={1440} className="w-full" />
            </Form.Item>
            <Form.Item name={["session", "absolute_hours"]} label="عمر کامل نشست (ساعت)">
              <InputNumber min={1} max={2160} className="w-full" />
            </Form.Item>
            <Form.Item name={["session", "reauth_minutes"]} label="تأیید دوبارهٔ هویت برای کارهای حساس پس از (دقیقه)" extra="۰: هرگز">
              <InputNumber min={0} max={1440} className="w-full" />
            </Form.Item>
            <div />
            <Form.Item name={["session", "single_session"]} label="یک نشست فعال برای هر نفر" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name={["session", "browser_session"]} label="پایان نشست با بستن مرورگر" valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>
          {q.data ? (
            <Note tone={q.data.cookie.secure ? "neutral" : "warning"}>
              {q.data.cookie.secure ? "کوکی نشست امن است (HttpOnly، SameSite و Secure روی HTTPS)." : "این درخواست با HTTPS نرسیده است؛ کوکی نشست بدون Secure فرستاده می‌شود. سامانه را فقط با HTTPS در دسترس بگذارید."}
            </Note>
          ) : null}
        </Card>
        <Card title="ورود محلی (ایمیل و رمز عبور)">
          <Form.Item name="local_login">
            <Radio.Group
              options={[
                { value: "all", label: "همه می‌توانند با ایمیل و رمز عبور وارد شوند" },
                { value: "breakglass", label: "فقط حساب‌های اضطراری؛ بقیه با حساب سازمانی", disabled: !directory },
              ]}
            />
          </Form.Item>
          <Form.Item name="breakglass" label="حساب‌های اضطراری (ورود محلی اگر سرور دامنه در دسترس نبود)" hidden={localLogin !== "breakglass"}>
            <Select
              mode="multiple"
              optionFilterProp="label"
              options={(members.data?.members ?? []).filter((m) => m.is_active).map((m) => ({ value: m.user_id, label: m.full_name || m.email }))}
              placeholder="مدیرانی که با رمز محلی وارد می‌شوند"
            />
          </Form.Item>
          {!directory ? <Note>پیش از بستن ورود محلی، «ورود با حساب سازمانی» را در یک منبع «فهرست کاربران» روشن و تأیید کنید.</Note> : null}
        </Card>
        <Card title="قفل محلی در برابر حدس گذرواژه">
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Form.Item name={["lockout", "threshold"]} label="تلاش ناموفق یک نام کاربری" extra="کمتر از آستانهٔ قفل دامنه">
              <InputNumber min={3} max={50} className="w-full" />
            </Form.Item>
            <Form.Item name={["lockout", "window_minutes"]} label="در بازهٔ (دقیقه)">
              <InputNumber min={1} max={1440} className="w-full" />
            </Form.Item>
            <Form.Item name={["lockout", "lock_minutes"]} label="مدت قفل (دقیقه)">
              <InputNumber min={1} max={1440} className="w-full" />
            </Form.Item>
            <Form.Item name={["lockout", "ip_threshold"]} label="تلاش ناموفق از یک نشانی (همهٔ نام‌ها)">
              <InputNumber min={5} max={1000} className="w-full" />
            </Form.Item>
          </div>
        </Card>
      </div>
      {editable ? (
        <div className="mt-4 flex justify-end">
          <Button type="primary" htmlType="submit" icon={<ShieldCheck {...ICON} />} loading={save.isPending}>
            ذخیرهٔ سیاست
          </Button>
        </div>
      ) : null}
    </Form>
  );
}

function Sessions() {
  const { api } = useOrg();
  const [q, setQ] = useState("");
  const [method, setMethod] = useState<string>("");
  const dq = useDebounced(q);
  const key = ["auth", "sessions", dq, method];
  const list = useQuery({ queryKey: key, queryFn: () => api.get<{ sessions: Row[]; current: string }>("/auth/sessions", { q: dq || undefined, method: method || undefined }) });
  const revoke = useAction((id: string) => api.del(`/auth/sessions/${id}`), { success: "نشست بسته شد", invalidate: [key] });
  const revokeUser = useAction((user_id: string) => api.post<{ sessions: number }>("/auth/sessions/revoke-all", { user_id }), { success: (d) => `${d.sessions.toLocaleString("fa-IR")} نشست بسته شد`, invalidate: [key] });
  const everyone = useAction(() => api.post<{ sessions: number }>("/auth/sessions/revoke-all", {}), { success: (d) => `${d.sessions.toLocaleString("fa-IR")} نشست بسته شد`, invalidate: [key] });
  return (
    <Card
      title="نشست‌های باز"
      flush
      tools={
        <div className="flex flex-wrap items-center gap-2">
          <Input allowClear prefix={<Search {...ICON14} />} placeholder="نام، ایمیل یا IP" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} />
          <Select value={method} onChange={setMethod} style={{ width: 170 }} options={[{ value: "", label: "همهٔ روش‌ها" }, ...Object.entries(METHOD_LABELS).map(([value, label]) => ({ value, label }))]} />
          <Button danger icon={<LogOut {...ICON14} />} loading={everyone.isPending} onClick={() => everyone.mutate(undefined)}>
            خروج همه
          </Button>
        </div>
      }
    >
      <Table
        className="blk-tbl"
        size="middle"
        rowKey="id"
        loading={list.isLoading}
        dataSource={list.data?.sessions ?? []}
        pagination={{ pageSize: 50, hideOnSinglePage: true }}
        scroll={{ x: 900 }}
        columns={[
          { key: "who", title: "کاربر", render: (_, r) => <span>{r.full_name || r.email}{r.id === list.data?.current ? <span className="blk-plain ms-2">نشست شما</span> : null}</span> },
          { key: "method", title: "روش ورود", width: 170, render: (_, r) => <Chip tone={r.org_id ? "accent" : "neutral"}>{methodLabel(r.auth_method)}</Chip> },
          { key: "ip", dataIndex: "ip", title: "IP", width: 136, render: (v) => <bdi dir="ltr" className="ds-mono blk-2">{v}</bdi> },
          { key: "ua", dataIndex: "user_agent", title: "مرورگر", ellipsis: true, render: (v) => <bdi dir="ltr" className="ds-latin blk-3" style={{ fontSize: 12 }}>{v}</bdi> },
          { key: "since", dataIndex: "created_at", title: "از", width: 160, render: (v) => <JDateTime v={v} /> },
          { key: "seen", dataIndex: "last_seen_at", title: "آخرین فعالیت", width: 160, render: (v) => <JDateTime v={v} /> },
          {
            key: "a",
            width: 96,
            render: (_, r) =>
              r.id !== list.data?.current ? (
                <span className="blk-ra flex gap-1">
                  <Tooltip title="بستن این نشست">
                    <Button size="small" type="text" danger icon={<LogOut {...ICON14} />} onClick={() => revoke.mutate(r.id)} aria-label="بستن این نشست" />
                  </Tooltip>
                  <Tooltip title="بستن همهٔ نشست‌های این نفر">
                    <Button size="small" type="text" danger onClick={() => revokeUser.mutate(r.user_id)} aria-label="بستن همهٔ نشست‌های این نفر">
                      همه
                    </Button>
                  </Tooltip>
                </span>
              ) : null,
          },
        ]}
      />
    </Card>
  );
}

const reasonLabel = (r: string | undefined) => (r ? (REASON_LABELS as Record<string, string>)[r] ?? r : "");
const KIND_LABELS: Record<string, string> = { sign_in: "ورود", reauth: "تأیید دوباره", sessions_revoked: "بستن نشست", auth_policy: "تغییر سیاست" };

export function Signins({ source }: { source?: string }) {
  const { api } = useOrg();
  const [ok, setOk] = useState<string>("");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const key = ["auth", "signins", source ?? "", ok, dq];
  const list = useQuery({ queryKey: key, queryFn: () => api.get<{ events: Row[] }>("/auth/signins", { ok: ok || undefined, q: dq || undefined, source, limit: 200 }) });
  return (
    <Card
      title="گزارش ورودها"
      flush
      tools={
        <div className="flex flex-wrap items-center gap-2">
          <Input allowClear prefix={<Search {...ICON14} />} placeholder="نام کاربری، نام یا IP" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} />
          <Segmented value={ok} onChange={(v) => setOk(String(v))} options={[{ value: "", label: "همه" }, { value: "false", label: "ناموفق" }, { value: "true", label: "موفق" }]} />
        </div>
      }
    >
      <Table
        className="blk-tbl"
        size="middle"
        rowKey="id"
        loading={list.isLoading}
        dataSource={list.data?.events ?? []}
        pagination={{ pageSize: 50, hideOnSinglePage: true }}
        scroll={{ x: 900 }}
        columns={[
          { key: "at", dataIndex: "at", title: "زمان", width: 160, render: (v) => <JDateTime v={v} /> },
          { key: "kind", dataIndex: "kind", title: "رویداد", width: 110, render: (v) => KIND_LABELS[v] ?? v },
          { key: "ok", dataIndex: "ok", title: "نتیجه", width: 90, render: (v) => <Chip tone={v ? "in" : "danger"}>{v ? "موفق" : "ناموفق"}</Chip> },
          { key: "who", title: "نام کاربری", render: (_, r) => <span>{r.user_name ? `${r.user_name} · ` : ""}<bdi dir="ltr" className="ds-latin">{r.email}</bdi></span> },
          { key: "method", title: "روش", width: 150, render: (_, r) => methodLabel(r.data?.method) },
          { key: "reason", title: "علت", width: 200, render: (_, r) => (r.data?.reason ? <Tooltip title={r.data?.detail}>{reasonLabel(r.data.reason)}</Tooltip> : r.data?.pending_roles?.length ? <Tooltip title={r.data.pending_roles.join("، ")}>نقش در انتظار تأیید</Tooltip> : null) },
          { key: "ip", dataIndex: "ip", title: "IP", width: 136, render: (v) => <bdi dir="ltr" className="ds-mono blk-2">{v}</bdi> },
        ]}
      />
    </Card>
  );
}

function Locks() {
  const { api } = useOrg();
  const list = useQuery({ queryKey: ["auth", "locks"], queryFn: () => api.get<{ locks: Row[] }>("/auth/locks") });
  const unlock = useAction((key: string) => api.del(`/auth/locks/${encodeURIComponent(key)}`), { success: "قفل برداشته شد", invalidate: [["auth", "locks"]] });
  return (
    <Card title="نام‌ها و نشانی‌های قفل‌شده" flush>
      <Table
        className="blk-tbl"
        size="middle"
        rowKey="key"
        loading={list.isLoading}
        dataSource={list.data?.locks ?? []}
        pagination={false}
        locale={{ emptyText: "قفلی نیست" }}
        columns={[
          { key: "kind", dataIndex: "kind", title: "گونه", width: 120, render: (v) => (v === "ip" ? "نشانی" : "نام کاربری") },
          { key: "subject", dataIndex: "subject", title: "نام یا نشانی", render: (v) => <bdi dir="ltr" className="ds-latin">{v}</bdi> },
          { key: "failures", dataIndex: "failures", title: "تلاش ناموفق", width: 120, render: (v) => Number(v).toLocaleString("fa-IR") },
          { key: "until", dataIndex: "locked_until", title: "تا", width: 160, render: (v) => <JDateTime v={v} /> },
          {
            key: "a",
            width: 110,
            render: (_, r) => (
              <Button size="small" icon={<Unlock {...ICON14} />} onClick={() => unlock.mutate(r.key)}>
                رفع قفل
              </Button>
            ),
          },
        ]}
      />
    </Card>
  );
}
