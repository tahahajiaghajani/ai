// «تحلیل اثر» (catalogue CMDB-011/012/013, SPF-010): what breaks if these CIs go down, degrade or go into
// maintenance — every CI, service and offering the failure reaches, how badly (redundancy groups absorb, relationship
// weights soften), along which path, and the people behind it (users, subscribers, commitments, open incidents). The
// server computes the whole blast radius with system rights so the answer is right, then shows only what the person
// may read: hidden CIs are counted, never named. A what-if can be saved («شبیه‌سازی اثر») with its result, on its own
// or for a change. The address keeps the question (?ci=…&state=…&depth=…).
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { App, Button, Input, Modal, Segmented, Select, Space, Table, Tabs, Tooltip } from "antd";
import { GitFork, Save, ShieldAlert, Zap } from "lucide-react";
import type { ImpactedCi, ImpactedService } from "@shared/cmdb/api";
import { SIM_STATES, type SimState } from "@shared/cmdb/logic";
import { CI_CRITICALITY, CI_ENVIRONMENTS } from "@shared/cmdb/classes";
import { CI_TIERS } from "@shared/tables/cmdb";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Card, Note } from "../../components/blocks";
import { Chip, EmptyState, Loader, StatCard } from "../../components/display";
import { DateInput } from "../../components/inputs";
import { cmdbApi, CMDB_KEYS } from "./api";
import { CiPicker } from "./CiPicker";
import { ServiceMap } from "./ServiceMap";
import { severityStyle } from "./model";

const ICON = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const label = (opts: { value: string; label: string }[], v: unknown) => opts.find((o) => o.value === v)?.label ?? "—";

export function SeverityMeter({ value, absorbed }: { value: number; absorbed?: boolean }) {
  const s = severityStyle(value, absorbed);
  return (
    <Tooltip title={s.label}>
      <span className="flex items-center gap-2">
        <span className="cm-meter" aria-hidden>
          <span style={{ width: `${Math.max(4, Math.round(value * 100))}%`, background: s.color }} />
        </span>
        <span className="ds-num shrink-0 text-[12px] text-ink-2">{faDigits(Math.round(value * 100))}٪</span>
      </span>
    </Tooltip>
  );
}

export function ImpactPath({ path }: { path: ImpactedCi["path"] }) {
  return (
    <span className="cm-path">
      {path.map((p, i) => (
        <span key={`${p.id}-${i}`} className="inline-flex items-center gap-1">
          {i > 0 ? <span aria-hidden>←</span> : null}
          {p.type_label && i > 0 ? <span>{p.type_label}</span> : null}
          <b>{p.restricted ? "محدود" : p.name}</b>
        </span>
      ))}
    </span>
  );
}

export default function ImpactPage() {
  const { api, orgId } = useOrg();
  const { message } = App.useApp();
  const [sp, setSp] = useSearchParams();
  const cis = (sp.get("ci") ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 50);
  const state = (["down", "degraded", "maintenance"].includes(sp.get("state") ?? "") ? sp.get("state") : "down") as SimState;
  const depth = Math.min(20, Math.max(1, Number(sp.get("depth") ?? 8) || 8));
  const asOf = sp.get("as_of");
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setSp(next, { replace: true });
  };
  const q = { ci_ids: cis, state, depth, as_of: asOf || null };
  const impact = useQuery({ queryKey: CMDB_KEYS.impact(orgId, q), queryFn: () => cmdbApi.impact(api, q), enabled: cis.length > 0, staleTime: 30_000, placeholderData: (p) => p });
  const save = useMutation({
    mutationFn: () => cmdbApi.saveImpact(api, { ...q, name: name.trim() }),
    onSuccess: (r) => {
      message.success(`شبیه‌سازی ذخیره شد — ${r.summary}`);
      setSaveOpen(false);
    },
    onError: (e: Error) => message.error(e.message),
  });
  const r = impact.data;
  const services = useMemo(() => (r?.services ?? []).filter((s) => s.kind === "service"), [r]);
  const offerings = useMemo(() => (r?.services ?? []).filter((s) => s.kind === "offering"), [r]);
  const serviceCols = [
    {
      title: "خدمت", dataIndex: "name", key: "name",
      render: (_: unknown, s: ImpactedService) => (
        <span className="flex min-w-0 flex-col">
          <Link className="ds-link truncate" to={s.kind === "service" ? `/${orgId}/services/${s.id}` : `/${orgId}/service-offerings/${s.id}`}>{s.name}</Link>
          {s.number ? <span className="ds-ltr ds-num text-[12px] text-ink-3">{faDigits(s.number)}</span> : null}
        </span>
      ),
    },
    { title: "رده", dataIndex: "tier", key: "tier", width: 110, render: (v: string | null) => (v ? label(CI_TIERS, v) : "—") },
    { title: "شدت اثر", dataIndex: "severity", key: "severity", width: 170, render: (v: number) => <SeverityMeter value={v} /> },
    { title: "صفحهٔ وضعیت", dataIndex: "on_status_page", key: "page", width: 110, render: (v: boolean) => (v ? <Chip tone="neutral">منتشرشده</Chip> : <span className="text-ink-3">—</span>) },
  ];
  const ciCols = [
    {
      title: "پیکربندی", dataIndex: "name", key: "name",
      render: (_: unknown, c: ImpactedCi) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <Link className="ds-link truncate" to={`/${orgId}/cis/${c.id}`}>{c.name}</Link>
          <ImpactPath path={c.path} />
        </span>
      ),
    },
    { title: "کلاس", dataIndex: "class_label", key: "class", width: 140 },
    { title: "شدت اثر", dataIndex: "severity", key: "severity", width: 170, sorter: (a: ImpactedCi, b: ImpactedCi) => a.severity - b.severity, render: (v: number, c: ImpactedCi) => <SeverityMeter value={v} absorbed={c.absorbed} /> },
    { title: "فاصله", dataIndex: "depth", key: "depth", width: 80, sorter: (a: ImpactedCi, b: ImpactedCi) => a.depth - b.depth, render: (v: number) => <span className="ds-num">{fa(v)}</span> },
    { title: "اهمیت", dataIndex: "criticality", key: "crit", width: 100, render: (v: string | null) => (v ? label(CI_CRITICALITY, v) : "—") },
    { title: "محیط", dataIndex: "environment", key: "env", width: 100, render: (v: string | null) => (v ? label(CI_ENVIRONMENTS, v) : "—") },
  ];
  return (
    <div>
      <PageHeader
        title="تحلیل اثر"
        actions={
          <Space wrap>
            <Link to={`/${orgId}/cmdb/map?root=${cis.join(",")}&dir=dependents`}>
              <Button icon={<GitFork {...ICON} />} disabled={!cis.length}>نقشهٔ وابسته‌ها</Button>
            </Link>
            <Button icon={<Save {...ICON} />} disabled={!r} onClick={() => setSaveOpen(true)}>ذخیرهٔ شبیه‌سازی</Button>
          </Space>
        }
      />
      <div className="cm-toolbar">
        <CiPicker multiple value={cis} onChange={(v) => set({ ci: (Array.isArray(v) ? v : v ? [v] : []).join(",") || null })} placeholder="پیکربندی‌هایی که از کار می‌افتند" style={{ minWidth: 300, flex: "1 1 300px" }} aria-label="پیکربندی‌های منشأ" />
        <Segmented value={state} options={SIM_STATES.map((s) => ({ value: s.value, label: s.label }))} onChange={(v) => set({ state: String(v) === "down" ? null : String(v) })} aria-label="وضعیت فرضی" />
        <Select value={depth} onChange={(v) => set({ depth: String(v) })} options={[2, 4, 6, 8, 12, 20].map((d) => ({ value: d, label: `تا ${faDigits(d)} گام` }))} style={{ width: 120 }} aria-label="عمق" />
        <DateInput value={asOf ?? undefined} onChange={(v) => set({ as_of: v })} placeholder="امروز" allowClear aria-label="تاریخ نقشه" />
      </div>
      {!cis.length ? (
        <EmptyState title="پیکربندی‌ای انتخاب نشده" description="پیکربندی‌هایی را که از کار می‌افتند یا تغییر می‌کنند انتخاب کنید تا دامنهٔ اثر آن‌ها روی خدمت‌ها دیده شود." icon={Zap} />
      ) : impact.isLoading && !r ? (
        <Loader />
      ) : impact.isError ? (
        <EmptyState title="تحلیل اثر انجام نشد" description={(impact.error as Error).message} />
      ) : r ? (
        <div className="flex flex-col gap-3">
          <div className="cm-tiles ds-stagger">
            <StatCard title="خدمت متأثر" value={fa(r.counts.services)} icon={<ShieldAlert {...ICON} />} />
            <StatCard title="گزینهٔ خدمت" value={fa(r.counts.offerings)} />
            <StatCard title="پیکربندی متأثر" value={fa(r.counts.cis)} hint={r.counts.critical ? `${fa(r.counts.critical)} حیاتی` : undefined} />
            <StatCard title="کاربر و مشترک" value={fa(r.counts.users + r.counts.subscribers)} hint={`${fa(r.counts.users)} کاربر، ${fa(r.counts.subscribers)} مشترک`} />
            <StatCard title="تعهد در خطر" value={fa(r.counts.commitments)} />
            <StatCard title="رخداد باز روی آن‌ها" value={fa(r.counts.open_incidents)} />
          </div>
          {r.counts.restricted ? <Note>{`${fa(r.counts.restricted)} پیکربندی دیگر هم متأثر است که اجازهٔ دیدنش را ندارید؛ فقط شمرده شده است.`}</Note> : null}
          <Tabs
            items={[
              {
                key: "services", label: `خدمت‌ها (${fa(services.length)})`,
                children: services.length ? (
                  <Table rowKey="id" size="small" dataSource={services} columns={serviceCols} pagination={services.length > 20 ? { pageSize: 20 } : false} scroll={{ x: 600 }} />
                ) : (
                  <EmptyState compact title="خدمتی متأثر نمی‌شود" description="هیچ خدمتی که بتوانید ببینید از این پیکربندی‌ها اثر نمی‌گیرد." />
                ),
              },
              ...(offerings.length ? [{ key: "offerings", label: `گزینه‌ها (${fa(offerings.length)})`, children: <Table rowKey="id" size="small" dataSource={offerings} columns={serviceCols} pagination={offerings.length > 20 ? { pageSize: 20 } : false} scroll={{ x: 600 }} /> }] : []),
              { key: "map", label: "نقشهٔ دامنهٔ اثر", children: <ServiceMap map={r.map} severities height="min(68vh, 700px)" /> },
              {
                key: "cis", label: `پیکربندی‌ها (${fa(r.cis.length)})`,
                children: <Table rowKey="id" size="small" dataSource={r.cis} columns={ciCols} pagination={r.cis.length > 25 ? { pageSize: 25 } : false} scroll={{ x: 820 }} />,
              },
              {
                key: "classes", label: "بر پایهٔ کلاس",
                children: (
                  <Card>
                    <ul className="flex flex-col gap-1.5">
                      {r.counts.by_class.map((c) => (
                        <li key={c.class} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-2 text-[13px]">
                          <span className="truncate text-ink-2">{c.label}</span>
                          <span className="cm-meter" aria-hidden>
                            <span style={{ width: `${(c.count / Math.max(1, r.counts.by_class[0]?.count ?? 1)) * 100}%`, background: "var(--ds-chart-1)" }} />
                          </span>
                          <span className="ds-num">{fa(c.count)}</span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                ),
              },
            ]}
          />
        </div>
      ) : null}
      <Modal open={saveOpen} title="ذخیرهٔ شبیه‌سازی اثر" onCancel={() => setSaveOpen(false)} onOk={() => save.mutate()} okText="ذخیره" cancelText="انصراف" okButtonProps={{ disabled: !name.trim(), loading: save.isPending }} destroyOnHidden>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="عنوان (مثلاً «خاموشی سرور پایگاه داده برای ارتقا»)" maxLength={160} autoFocus onPressEnter={() => name.trim() && save.mutate()} />
      </Modal>
    </div>
  );
}
