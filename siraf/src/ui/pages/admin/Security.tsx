// «رویدادهای امنیتی»: sign-ins (failed ones too), password changes, role and access changes, platform-admin
// grants, support sessions and AI key changes — and, in the second tab, what the platform admins did
// (console changes and support sessions). Filters live in the address so the overview can link here.
import { useState } from "react";
import { Button, Input, Segmented, Select, Table, Tooltip } from "antd";
import { Search, ShieldAlert } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState } from "../../components/display";
import { api } from "../../lib/api";
import { useDebounced, useIsPhone } from "../../lib/hooks";
import { ICON, EVENT_KIND, When, eventDetail, type SecurityEvent } from "./ui";

interface AuditRow {
  id: string;
  at: string;
  action: string;
  summary: string;
  actor_kind: "platform" | "support";
  actor_name: string | null;
  org_name: string | null;
  target_org_id: string | null;
  target_user_id: string | null;
  target_name: string | null;
}

function usePaged<T extends { at: string }>(key: unknown[], path: string, field: string, query: Record<string, string | undefined>) {
  return useInfiniteQuery({
    queryKey: ["admin", ...key],
    initialPageParam: "",
    queryFn: ({ pageParam }) => api.get<Record<string, T[]>>(path, { ...query, before: pageParam || undefined }).then((r) => r[field]),
    getNextPageParam: (last: T[]) => (last.length >= 100 ? last[last.length - 1].at : undefined),
  });
}

function Events() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const dq = useDebounced(q);
  const phone = useIsPhone();
  const kind = params.get("kind") ?? "";
  const ok = params.get("ok") ?? "";
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const query = { q: dq || undefined, kind: kind || undefined, ok: ok || undefined, user: params.get("user") ?? undefined, org: params.get("org") ?? undefined };
  const list = usePaged<SecurityEvent>(["security", query], "/admin/security-events", "events", query);
  const rows = list.data?.pages.flat() ?? [];
  const scoped = params.get("user") || params.get("org");
  return (
    <div className="bk-card">
      <div className="ad-filters">
        <Input allowClear prefix={<Search {...ICON} className="text-ink-3" />} placeholder="ایمیل، نام، کسب‌وکار یا IP" value={q} onChange={(e) => setQ(e.target.value)} aria-label="جست‌وجو" />
        <Select
          value={kind}
          onChange={(v) => set("kind", v)}
          style={{ minInlineSize: 190 }}
          aria-label="نوع رویداد"
          options={[{ value: "", label: "همهٔ رویدادها" }, ...Object.entries(EVENT_KIND).map(([value, label]) => ({ value, label }))]}
        />
        <Segmented
          value={ok}
          onChange={(v) => set("ok", String(v))}
          options={[
            { value: "", label: "همه" },
            { value: "false", label: "ناموفق" },
          ]}
        />
        {scoped ? (
          <Button
            type="link"
            onClick={() => {
              const next = new URLSearchParams(params);
              next.delete("user");
              next.delete("org");
              setParams(next, { replace: true });
            }}
          >
            نمایش همهٔ حساب‌ها و کسب‌وکارها
          </Button>
        ) : null}
      </div>
      <Table<SecurityEvent>
        className="bk-tbl"
        size="small"
        rowKey="id"
        loading={list.isLoading}
        dataSource={rows}
        pagination={false}
        scroll={phone ? undefined : { x: 960 }}
        tableLayout="fixed"
        locale={{ emptyText: list.isLoading ? " " : <EmptyState icon={ShieldAlert} title="رویدادی با این شرایط نیست" /> }}
        columns={[
          { key: "at", dataIndex: "at", title: "زمان", width: phone ? 92 : 150, render: (v) => <When v={v} block={phone} /> },
          {
            key: "k",
            title: "رویداد",
            width: phone ? undefined : 200,
            render: (_, e) => (
              <span className="flex flex-wrap items-center gap-1.5">
                {EVENT_KIND[e.kind] ?? e.kind}
                {e.ok ? null : <Chip tone="danger">ناموفق</Chip>}
                {phone ? <span className="ad-sub block w-full truncate">{e.user_name ?? e.email}</span> : null}
              </span>
            ),
          },
          ...(phone
            ? []
            : [
                {
                  key: "u",
                  title: "حساب",
                  width: 220,
                  render: (_: unknown, e: SecurityEvent) =>
                    e.user_id ? (
                      <Link to={`/admin/users/${e.user_id}`} className="block min-w-0">
                        <span className="sf-link block truncate">{e.user_name ?? e.email}</span>
                        <bdi dir="ltr" className="sf-latin ad-sub block truncate">
                          {e.email}
                        </bdi>
                      </Link>
                    ) : (
                      <bdi dir="ltr" className="sf-latin block truncate text-ink-2">
                        {e.email ?? "—"}
                      </bdi>
                    ),
                },
                {
                  key: "o",
                  title: "کسب‌وکار",
                  width: 160,
                  ellipsis: true,
                  render: (_: unknown, e: SecurityEvent) => (e.org_id ? <Link to={`/admin/orgs/${e.org_id}`} className="sf-link">{e.org_name}</Link> : <span className="text-ink-3">—</span>),
                },
                { key: "d", title: "شرح", ellipsis: { showTitle: false }, render: (_: unknown, e: SecurityEvent) => <Tooltip title={eventDetail(e)}><span className="text-ink-2">{eventDetail(e) || "—"}</span></Tooltip> },
                {
                  key: "ip",
                  dataIndex: "ip",
                  title: "IP",
                  width: 130,
                  render: (v: string | null, e: SecurityEvent) => (
                    <Tooltip title={e.user_agent}>
                      <bdi dir="ltr" className="sf-latin text-ink-2">
                        {v ?? "—"}
                      </bdi>
                    </Tooltip>
                  ),
                },
              ]),
        ]}
      />
      {list.hasNextPage ? (
        <div className="flex justify-center p-3">
          <Button onClick={() => list.fetchNextPage()} loading={list.isFetchingNextPage}>
            رویدادهای قدیمی‌تر
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function AdminAudit() {
  const [q, setQ] = useState("");
  const [actor, setActor] = useState("");
  const dq = useDebounced(q);
  const phone = useIsPhone();
  const query = { q: dq || undefined, actor: actor || undefined };
  const list = usePaged<AuditRow>(["audit", query], "/admin/audit", "rows", query);
  const rows = list.data?.pages.flat() ?? [];
  return (
    <div className="bk-card">
      <div className="ad-filters">
        <Input allowClear prefix={<Search {...ICON} className="text-ink-3" />} placeholder="شرح، مدیر یا کسب‌وکار" value={q} onChange={(e) => setQ(e.target.value)} aria-label="جست‌وجو" />
        <Segmented
          value={actor}
          onChange={(v) => setActor(String(v))}
          options={[
            { value: "", label: "همه" },
            { value: "platform", label: "مدیریت سامانه" },
            { value: "support", label: "حالت پشتیبانی" },
          ]}
        />
      </div>
      <Table<AuditRow>
        className="bk-tbl"
        size="small"
        rowKey="id"
        loading={list.isLoading}
        dataSource={rows}
        pagination={false}
        scroll={phone ? undefined : { x: 900 }}
        tableLayout="fixed"
        locale={{ emptyText: list.isLoading ? " " : <EmptyState icon={ShieldAlert} title="هنوز کاری از سوی مدیران سامانه ثبت نشده است" /> }}
        columns={[
          { key: "at", dataIndex: "at", title: "زمان", width: phone ? 92 : 150, render: (v) => <When v={v} block={phone} /> },
          ...(phone ? [] : [{ key: "a", dataIndex: "actor_name", title: "مدیر", width: 160, ellipsis: true }]),
          {
            key: "s",
            dataIndex: "summary",
            title: "شرح",
            ellipsis: { showTitle: false },
            render: (v: string, r: AuditRow) => (
              <Tooltip title={v}>
                <span className="flex min-w-0 items-center gap-2">
                  <Chip tone={r.actor_kind === "support" ? "warning" : "accent"}>{r.actor_kind === "support" ? "پشتیبانی" : "سامانه"}</Chip>
                  <span className="truncate">{v}</span>
                </span>
              </Tooltip>
            ),
          },
          ...(phone
            ? []
            : [
                {
                  key: "t",
                  title: "مربوط به",
                  width: 200,
                  ellipsis: true,
                  render: (_: unknown, r: AuditRow) =>
                    r.target_org_id ? (
                      <Link to={`/admin/orgs/${r.target_org_id}`} className="sf-link">
                        {r.org_name}
                      </Link>
                    ) : r.target_user_id ? (
                      <Link to={`/admin/users/${r.target_user_id}`} className="sf-link">
                        {r.target_name}
                      </Link>
                    ) : (
                      <span className="text-ink-3">—</span>
                    ),
                },
              ]),
        ]}
      />
      {list.hasNextPage ? (
        <div className="flex justify-center p-3">
          <Button onClick={() => list.fetchNextPage()} loading={list.isFetchingNextPage}>
            موارد قدیمی‌تر
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export default function Security() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "admin" ? "admin" : "events";
  return (
    <div>
      <PageHeader
        title="رویدادهای امنیتی"
        extra={
          <Segmented
            value={tab}
            onChange={(v) => setParams(v === "admin" ? { tab: "admin" } : {}, { replace: true })}
            options={[
              { value: "events", label: "رویدادها" },
              { value: "admin", label: "کارهای مدیران" },
            ]}
          />
        }
      />
      {tab === "admin" ? <AdminAudit /> : <Events />}
    </div>
  );
}
