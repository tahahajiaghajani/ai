// «رویدادهای سازمان‌ها» of the platform owner's console: the audit log of every organisation in one list — who did
// what, where, and whether as a member, in support mode or as the platform — filtered by organisation, actor kind,
// action and text, with older rows on demand and a CSV of what the filters select. Summaries only: never record data.
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Button, Input, Select, Table } from "antd";
import { Download, Search } from "lucide-react";
import { api } from "../../../lib/api";
import { useDebounced } from "../../../lib/hooks";
import { PageHeader } from "../../../components/layout";
import { Chip } from "../../../components/display";
import { Card } from "../../../components/blocks";
import { ICON, When, useAdminQuery } from "../../../pages/admin/ui";

interface AuditRow {
  id: string;
  at: string;
  org_id: string | null;
  org_name: string | null;
  actor_name: string | null;
  actor_kind: "user" | "platform" | "support" | null;
  action: string;
  entity: string | null;
  summary: string | null;
}

const ACTOR: Record<string, [string, "neutral" | "warning" | "in"]> = { user: ["عضو", "neutral"], support: ["پشتیبانی", "warning"], platform: ["مدیر سامانه", "in"] };

export default function AuditAll() {
  const orgs = useAdminQuery<{ orgs: { id: string; name: string }[] }>(["console", "orgs"], "/admin/orgs");
  const [org, setOrg] = useState<string | null>(null);
  const [actor, setActor] = useState<string | null>(null);
  const [action, setAction] = useState("");
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 350);
  const act = useDebounced(action.trim(), 350);
  const filters = { org: org ?? undefined, actor: actor ?? undefined, q: q || undefined, action: act || undefined };
  const list = useInfiniteQuery({
    queryKey: ["admin", "console", "audit", filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<{ rows: AuditRow[] }>("/admin/audit-all", { ...filters, before: pageParam ?? undefined }),
    getNextPageParam: (last) => (last.rows.length < 100 ? undefined : last.rows[last.rows.length - 1].at),
  });
  const rows = list.data?.pages.flatMap((p) => p.rows) ?? [];
  const csv = `/api/admin/audit-all.csv?${new URLSearchParams(Object.entries(filters).filter((e): e is [string, string] => !!e[1])).toString()}`;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="رویدادهای سازمان‌ها"
        actions={
          <a href={csv} className="ant-btn ant-btn-default inline-flex items-center gap-2">
            <Download {...ICON} />
            CSV
          </a>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Select allowClear showSearch optionFilterProp="label" value={org ?? undefined} onChange={(v) => setOrg(v ?? null)} placeholder="همهٔ سازمان‌ها" className="min-w-52" options={(orgs.data?.orgs ?? []).map((o) => ({ value: o.id, label: o.name }))} />
        <Select allowClear value={actor ?? undefined} onChange={(v) => setActor(v ?? null)} placeholder="انجام‌دهنده" className="min-w-36" options={Object.entries(ACTOR).map(([k, [l]]) => ({ value: k, label: l }))} />
        <Input allowClear value={action} onChange={(e) => setAction(e.target.value)} placeholder="کار (مثلاً member_import)" className="ltr max-w-56" dir="ltr" />
        <Input allowClear prefix={<Search {...ICON} />} value={text} onChange={(e) => setText(e.target.value)} placeholder="جست‌وجو در شرح و نام" className="max-w-64" />
      </div>
      <Card flush>
        <Table
          size="small"
          rowKey="id"
          loading={list.isLoading}
          dataSource={rows}
          pagination={false}
          scroll={{ x: true }}
          columns={[
            { title: "زمان", dataIndex: "at", width: 150, render: (v: string) => <When v={v} /> },
            { title: "سازمان", dataIndex: "org_name", render: (v: string | null) => v ?? <span className="text-ink-3">—</span> },
            { title: "انجام‌دهنده", dataIndex: "actor_name", render: (v: string | null, r) => <span className="flex items-center gap-2">{v ?? "سامانه"}{r.actor_kind && r.actor_kind !== "user" ? <Chip tone={ACTOR[r.actor_kind][1]}>{ACTOR[r.actor_kind][0]}</Chip> : null}</span> },
            { title: "کار", dataIndex: "action", render: (v: string) => <span className="ltr ds-mono text-[12px]">{v}</span> },
            { title: "شرح", dataIndex: "summary", render: (v: string | null) => v ?? "—" },
          ]}
        />
        {list.hasNextPage ? (
          <div className="flex justify-center p-3">
            <Button loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
              بیشتر
            </Button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
