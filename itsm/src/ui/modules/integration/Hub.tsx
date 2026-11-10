// «مرکز اتصال‌ها»: every way the organisation connects to other systems — the record API, webhooks, directories, issue
// trackers, scheduled exports and the notification connectors — with counts, health and the last day's calls; and
// «مستندات API»: the OpenAPI document of an integration user (what its keys may do), browsable and downloadable.
import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Select, Table, Tag } from "antd";
import { Bot, Download, FileJson, Inbox, MessageSquare, Network, PlugZap, Send, Webhook, GitPullRequestArrow, CalendarClock } from "lucide-react";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Skeleton } from "../../components/display";
import { Card, ICON, Note } from "../../components/blocks";

interface Card_ {
  key: string;
  label: string;
  group: string;
  count: number;
  failing: number;
  calls_24h: number;
  errors_24h: number;
  path: string;
  feature: { on: boolean; reason: string } | null;
}

const ICONS: Record<string, typeof Bot> = { api: Bot, webhooks: Send, inbound: Inbox, ldap: Network, scim: Network, issues: GitPullRequestArrow, exports: CalendarClock, legacy_hooks: Webhook };

export default function Hub() {
  const { api, orgId } = useOrg();
  const q = useQuery({ queryKey: ["integration", "hub"], queryFn: () => api.get<{ connectors: Card_[]; channels: { kind: string; label: string; count: number }[] }>("/integration/hub") });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="مرکز اتصال‌ها" />
      {!q.data ? (
        <Skeleton rows={6} />
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="رابط‌ها">
            {q.data.connectors.map((c) => {
              const Icon = ICONS[c.key] ?? PlugZap;
              return (
                <Link key={c.key} to={`/${orgId}/${c.path}`} className="ds-card flex flex-col gap-2 p-4 no-underline">
                  <span className="flex items-center gap-2 font-medium text-ink">
                    <Icon {...ICON} aria-hidden />
                    {c.label}
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
                    <span className="ds-num">{fa(c.count)}</span> تعریف
                    {c.failing ? <Chip tone="danger">{fa(c.failing)} با خطا</Chip> : null}
                    {c.calls_24h ? <Chip tone={c.errors_24h ? "warning" : "in"}>{fa(c.calls_24h)} فراخوانی امروز{c.errors_24h ? ` · ${fa(c.errors_24h)} خطا` : ""}</Chip> : null}
                  </span>
                  {c.feature && !c.feature.on ? <span className="text-[12px] text-ink-3">{c.feature.reason}</span> : null}
                </Link>
              );
            })}
          </section>
          <Card title="رابط‌های اعلان (سرویس اعلان‌ها)" tools={<Link to={`/${orgId}/notify/channels`}>مدیریت کانال‌ها</Link>}>
            <div className="flex flex-wrap gap-2">
              {q.data.channels.map((ch) => (
                <Tag key={ch.kind} icon={<MessageSquare size={12} strokeWidth={1.4} absoluteStrokeWidth />}>
                  {ch.label}: <span className="ds-num">{fa(ch.count)}</span>
                </Tag>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

interface OpenApiDoc {
  paths: Record<string, Record<string, { summary?: string; tags?: string[] }>>;
  tags?: { name: string; description: string }[];
}

const METHOD_TONE: Record<string, "in" | "accent" | "warning" | "danger" | "neutral"> = { get: "neutral", post: "in", patch: "warning", delete: "danger" };

export function ApiDocs() {
  const { api } = useOrg();
  const users = useQuery({ queryKey: ["integration", "users-list"], queryFn: () => api.get<{ rows: { id: string; name: string }[] }>("/r/integration_user", { size: "100", total: "false" }) });
  const [user, setUser] = useState<string | null>(null);
  const doc = useQuery({ queryKey: ["integration", "openapi", user], queryFn: () => api.get<OpenApiDoc>("/integration/openapi", { user: user! }), enabled: !!user, retry: false });
  const rows = Object.entries(doc.data?.paths ?? {}).flatMap(([path, ops]) => Object.entries(ops).map(([method, op]) => ({ key: `${method} ${path}`, method, path, summary: op.summary ?? "", tag: op.tags?.[0] ?? "" })));
  const download = () => {
    const blob = new Blob([JSON.stringify(doc.data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "openapi.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="مستندات API" actions={doc.data ? <Button icon={<Download {...ICON} />} onClick={download}>دریافت openapi.json</Button> : undefined} />
      <section className="ds-card flex flex-col gap-2 p-4" aria-label="کاربر یکپارچه‌سازی">
        <span className="text-[13px] text-ink-2">سند API را آن‌گونه که کلیدهای این کاربر می‌بینند نشان بده</span>
        <Select value={user ?? undefined} onChange={setUser} placeholder="کاربر یکپارچه‌سازی" options={(users.data?.rows ?? []).map((u) => ({ value: u.id, label: u.name }))} className="max-w-md" />
      </section>
      {!user ? (
        <EmptyState icon={FileJson} title="یک کاربر یکپارچه‌سازی انتخاب کنید" />
      ) : doc.isError ? (
        <Note tone="warning">{(doc.error as Error).message}</Note>
      ) : !doc.data ? (
        <Skeleton rows={6} />
      ) : (
        <Table
          size="small"
          rowKey="key"
          dataSource={rows}
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          scroll={{ x: true }}
          columns={[
            { title: "روش", dataIndex: "method", render: (v: string) => <Chip tone={METHOD_TONE[v] ?? "neutral"}>{v.toUpperCase()}</Chip>, width: 90 },
            { title: "مسیر", dataIndex: "path", render: (v: string) => <span className="ltr ds-mono">/api/v1{v}</span> },
            { title: "کار", dataIndex: "summary" },
            { title: "جدول", dataIndex: "tag", render: (v: string) => <span className="ltr ds-mono text-ink-3">{v}</span> },
          ]}
        />
      )}
    </div>
  );
}
