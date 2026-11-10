// «ورود و SSO» on an LDAP directory source (docs/AD_FA.md):
//   · آزمایش ورود — bind with the service account, find a person by login name, their account state, resolved groups
//     (nested ones too) and what the approved mappings would grant; never the person's password
//   · نگاشت‌ها — each mapping's directory group and how many people it reaches; whether the approval still covers it
//   · ورود خودکار ویندوز — the checklist, the exact SPN commands for the host and the service's account, the browser
//     policies, the IIS front option, and the organisation's own sign-in link
//   · ورودها — the source's latest sign-ins
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Input, Segmented, Table, Typography } from "antd";
import { CircleCheck, CircleX, ScanSearch, ListChecks } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { Chip, Loader } from "../../components/display";
import { Card, ICON, ICON14, Note } from "../../components/blocks";
import type { RecordContext } from "../../records/extensions";
import { Signins } from "../settings/Security";

type Row = Record<string, any>;
const origin = () => (typeof window !== "undefined" ? window.location.origin : "");
const Ok = ({ ok }: { ok: boolean }) => (ok ? <CircleCheck {...ICON14} className="text-[var(--ds-success)]" aria-label="بله" /> : <CircleX {...ICON14} className="text-[var(--ds-danger)]" aria-label="نه" />);
const Code = ({ children }: { children: string }) => (
  <Typography.Paragraph copyable className="ltr ds-mono m-0 break-all text-[12px]">
    {children}
  </Typography.Paragraph>
);

export function DirectoryLogin({ ctx }: { ctx: RecordContext }) {
  const [part, setPart] = useState<"test" | "mappings" | "sso" | "signins">("test");
  if (ctx.row.kind !== "ldap") return <Note>ورود با حساب سازمانی برای منبع LDAP / Active Directory است؛ SCIM فقط کاربران را تأمین می‌کند.</Note>;
  return (
    <div className="flex flex-col gap-4">
      <Segmented
        value={part}
        onChange={(v) => setPart(v as typeof part)}
        options={[
          { value: "test", label: "آزمایش ورود" },
          { value: "mappings", label: "نگاشت‌ها" },
          { value: "sso", label: "ورود خودکار ویندوز" },
          { value: "signins", label: "ورودها" },
        ]}
      />
      {part === "test" ? <LoginTest ctx={ctx} /> : part === "mappings" ? <Mappings ctx={ctx} /> : part === "sso" ? <SsoSetup ctx={ctx} /> : <Signins source={String(ctx.row.id)} />}
    </div>
  );
}

const STATE_LABELS: [string, string][] = [
  ["disabled", "غیرفعال"],
  ["locked", "قفل"],
  ["expired", "اعتبار حساب تمام شده"],
  ["passwordExpired", "گذرواژه منقضی"],
  ["mustChange", "باید گذرواژه عوض شود"],
];

function LoginTest({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const [login, setLogin] = useState("");
  const run = useAction((v: string) => api.post<Row>(`/integration/directory/${ctx.row.id}/login-test`, { login: v }));
  const r = run.data;
  return (
    <Card title="آزمایش ورود (بی‌گذرواژه)">
      <div className="mb-3 flex flex-wrap gap-2">
        <Input className="ltr" style={{ maxWidth: 320 }} placeholder="CORP\ali یا ali@corp.example" value={login} onChange={(e) => setLogin(e.target.value)} onPressEnter={() => login.trim() && run.mutate(login.trim())} />
        <Button type="primary" icon={<ScanSearch {...ICON} />} disabled={!login.trim()} loading={run.isPending} onClick={() => run.mutate(login.trim())}>
          آزمایش
        </Button>
      </div>
      {r ? (
        <div className="flex flex-col gap-3">
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {(r.steps as Row[]).map((s) => (
              <li key={s.key} className="flex items-start gap-2">
                <Ok ok={s.ok} />
                <span>{s.label}</span>
                {s.detail ? <bdi dir="auto" className="blk-3 text-[12px]">{s.detail}</bdi> : null}
              </li>
            ))}
          </ul>
          {r.person ? (
            <div className="grid gap-1 text-[13px]">
              <div>
                <b>{r.person.name}</b> · <bdi dir="ltr" className="ds-latin">{r.person.email ?? "بی‌ایمیل"}</bdi>
                {r.person.title ? ` · ${r.person.title}` : ""}
                {r.person.department ? ` · ${r.person.department}` : ""}
              </div>
              <div className="flex flex-wrap gap-1">
                {STATE_LABELS.filter(([k]) => r.state?.[k]).map(([k, label]) => (
                  <Chip key={k} tone="danger">{label}</Chip>
                ))}
                {STATE_LABELS.every(([k]) => !r.state?.[k]) ? <Chip tone="in">حساب فعال است</Chip> : null}
                {r.member ? <Chip tone={r.member.active ? "in" : "warning"}>{r.member.linked ? "عضو پیوندخورده" : "عضو با همین ایمیل"}{r.member.active ? "" : " (غیرفعال)"}</Chip> : <Chip>در نخستین ورود ساخته می‌شود</Chip>}
                {r.member && !r.member.linked && r.member.local_password ? <Chip tone="warning">رمز محلی دارد: با همگام‌سازی پیوند بزنید</Chip> : null}
              </div>
            </div>
          ) : null}
          {r.access ? (
            <div className="text-[13px]">
              <div className="mb-1">
                نقش‌ها: {[r.access.default_role, ...r.access.roles.map((x: Row) => x.role)].filter(Boolean).join("، ") || "—"}
                {r.access.roles.length && !r.access.approved ? <Chip tone="warning" className="ms-2">در انتظار تأیید نگاشت‌ها</Chip> : null}
              </div>
              <div>گروه‌ها: {r.groups.filter((g: Row) => g.mapped).map((g: Row) => g.name).join("، ") || "—"} <span className="blk-3">({r.groups.length.toLocaleString("fa-IR")} گروه در فهرست)</span></div>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="blk-3 m-0">با حساب خدمت به کنترل‌کنندهٔ دامنه وصل می‌شود، کاربر را پیدا می‌کند و گروه‌ها و نقش‌هایی را که می‌گیرد نشان می‌دهد.</p>
      )}
    </Card>
  );
}

function Mappings({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const q = useQuery({ queryKey: ["directory", "mappings", ctx.row.id], queryFn: () => api.get<{ approved: boolean; changed: boolean; rows: Row[] }>(`/integration/directory/${ctx.row.id}/mappings`), retry: false });
  if (q.isLoading) return <Loader />;
  if (q.error || !q.data) return <Note tone="danger">{String((q.error as Error | null)?.message ?? "نگاشت‌ها خوانده نشد")}</Note>;
  const d = q.data;
  return (
    <Card title="پیش‌نمایش نگاشت‌ها" flush>
      <div className="p-3">
        {d.changed ? (
          <Note tone="warning">نگاشت‌ها پس از تأیید تغییر کرده‌اند؛ تا منبع دوباره تأیید نشود، نقش‌ها و فضاهای کاری در ورود داده نمی‌شوند.</Note>
        ) : d.approved ? (
          <Note>نگاشت‌ها تأیید شده‌اند و نقش‌خودکار روشن است: در هر ورود اعمال می‌شوند.</Note>
        ) : (
          <Note tone="warning">نقش‌های نگاشت‌شده در ورود داده نمی‌شوند (نقش خودکار خاموش است یا منبع تأیید نشده)؛ با «اعمال» همگام‌سازی و تأیید نقش‌ها داده می‌شوند.</Note>
        )}
      </div>
      <Table
        className="blk-tbl"
        size="middle"
        rowKey={(r) => r.source}
        pagination={false}
        dataSource={d.rows}
        columns={[
          { key: "source", dataIndex: "source", title: "گروه دامنه", render: (v) => <bdi dir="ltr" className="ds-latin text-[12px]">{v}</bdi> },
          { key: "found", dataIndex: "found", title: "در دامنه", width: 90, render: (v) => <Ok ok={!!v} /> },
          { key: "members", dataIndex: "members", title: "افراد", width: 90, render: (v) => Number(v).toLocaleString("fa-IR") },
          { key: "sample", dataIndex: "sample", title: "نمونه", render: (v: string[]) => v.join("، ") },
          { key: "to", title: "نتیجه", render: (_, r) => [r.role ? `نقش ${r.role}` : null, r.group_id ? "گروه" : null, r.unit_id ? "واحد" : null, r.workspace_id ? "فضای کاری" : null].filter(Boolean).join("، ") },
        ]}
      />
    </Card>
  );
}

function SsoSetup({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const q = useQuery({ queryKey: ["directory", "sso", ctx.row.id], queryFn: () => api.get<Row>(`/integration/directory/${ctx.row.id}/sso`), retry: false });
  if (q.isLoading) return <Loader />;
  if (q.error || !q.data) return <Note tone="danger">{String((q.error as Error | null)?.message ?? "فهرست راه‌اندازی خوانده نشد")}</Note>;
  const d = q.data;
  const link = `${origin()}/login?dir=${ctx.row.id}`;
  const host = d.host || "kariz.bank.example";
  return (
    <div className="flex flex-col gap-4">
      <Card title="پیوند ورود سازمان">
        <Code>{link}</Code>
        <p className="blk-3 m-0 text-[13px]">در نصب چندسازمانی، ورود با حساب سازمانی فقط از همین پیوند انجام می‌شود.</p>
      </Card>
      <Card title={<span className="flex items-center gap-2"><ListChecks {...ICON} />فهرست راه‌اندازی</span>}>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {(d.checks as Row[]).map((c) => (
            <li key={c.key} className="flex items-center gap-2">
              <Ok ok={c.ok} />
              {c.label}
            </li>
          ))}
        </ul>
        {d.mode === "off" ? <Note className="mt-3">ورود خودکار خاموش است؛ در فرم منبع، «ورود خودکار ویندوز» را روی Kerberos یا IIS بگذارید.</Note> : null}
        {d.mode === "negotiate" && d.negotiate.problem ? <Note tone="warning" className="mt-3">{d.negotiate.problem}</Note> : null}
      </Card>
      {d.mode !== "proxy" ? (
        <Card title="۱. نام اصلی سرویس (SPN) — در کنترل‌کنندهٔ دامنه، با حساب Domain Admin">
          {(d.spn as string[]).map((c) => (
            <Code key={c}>{c}</Code>
          ))}
          <p className="blk-3 m-0 text-[13px]">نخستین فرمان SPN تکراری را پیدا می‌کند (SPN تکراری Kerberos همه را از کار می‌اندازد). اگر سرویس با Network Service اجرا می‌شود، به‌جای حساب سرویس نام رایانه با $ را بنویسید.</p>
        </Card>
      ) : (
        <Card title="۱. IIS با Windows Authentication">
          <p className="m-0 text-[13px]">در IIS فقط برای مسیر <bdi dir="ltr" className="ds-mono">/api/auth/sso</bdi>، Windows Authentication را روشن و Anonymous را خاموش کنید و با URL Rewrite (ARR) به سامانه بفرستید. دو متغیر سرور را تنظیم کنید:</p>
          <Code>{`HTTP_${d.proxy.header.toUpperCase().replace(/-/g, "_")} = {LOGON_USER}`}</Code>
          <Code>{`HTTP_${d.proxy.secret_header.toUpperCase().replace(/-/g, "_")} = <راز مشترک پراکسی>`}</Code>
          <p className="blk-3 m-0 text-[13px]">نشانی IIS باید در «نشانی‌های پراکسی معتمد» باشد ({d.proxy.ips.length ? <bdi dir="ltr">{d.proxy.ips.join(", ")}</bdi> : "هنوز خالی"})؛ راز مشترک {d.proxy.secret ? "ساخته شده است" : "هنوز ساخته نشده است"}.</p>
        </Card>
      )}
      <Card title="۲. مرورگرها (Group Policy)">
        <p className="m-0 text-[13px]">Edge و Chrome — «Configure list of allowed authentication servers» (AuthServerAllowlist):</p>
        <Code>{host}</Code>
        <p className="m-0 text-[13px]">Internet Options — «Site to Zone Assignment List» (منطقهٔ ۱، Local intranet):</p>
        <Code>{`https://${host}  →  1`}</Code>
        <p className="blk-3 m-0 text-[13px]">Firefox: network.negotiate-auth.trusted-uris = <bdi dir="ltr">{`https://${host}`}</bdi>. کاربران سامانه را فقط با همین نام باز کنند (نه با IP).</p>
      </Card>
    </div>
  );
}
