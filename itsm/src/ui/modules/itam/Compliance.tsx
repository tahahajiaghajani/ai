// «انطباق مجوزها» (catalogue ITAM-058/059/061/062/066): the effective licence position of every software model — licensed
// against installed (per device, user, core, subscription…), the under-licensing risk and the savings from unused
// installs and surplus licences (money only with the financial field group) — true-ups and renewals ahead with their
// projected shortfall, prohibited software found installed and discovered names no model matched, and the licence
// optimisation narrative (AI, or rule-based without a model). Asset managers sync installs from the CMDB and run the
// reconciliation again.
import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Segmented, Space, Table } from "antd";
import { RefreshCw, Scale, Sparkles } from "lucide-react";
import type { CompliancePosition, TrueUpRow } from "@shared/itam/api";
import { LICENSE_METRICS, POSITION_STATUS } from "@shared/tables/itam";
import { formatJalali, formatJalaliDateTime } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Card } from "../../components/blocks";
import { Chip, EmptyState, Loader, StatCard } from "../../components/display";
import { RecordMarkdown } from "../../records";
import { itamApi, ITAM_KEYS, type AiText } from "./api";
import { AiLabel, ICON, Money } from "./parts";

const TONE: Record<string, "in" | "warning" | "danger" | "neutral" | "accent"> = { compliant: "in", unlimited: "in", free: "neutral", over_licensed: "warning", under_licensed: "danger", unlicensed: "danger" };
const label = (opts: { value: string; label: string }[], v: string) => opts.find((o) => o.value === v)?.label ?? v;

export default function Compliance() {
  const { api, orgId } = useOrg();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const meta = useQuery({ queryKey: ITAM_KEYS.meta(orgId), queryFn: () => itamApi.meta(api), staleTime: 300_000 });
  const q = useQuery({ queryKey: ITAM_KEYS.compliance(orgId), queryFn: () => itamApi.compliance(api) });
  const [filter, setFilter] = useState<"all" | "risk" | "surplus">("all");
  const [story, setStory] = useState<AiText | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ITAM_KEYS.compliance(orgId) });
  const sync = useMutation({
    mutationFn: () => itamApi.softwareSync(api),
    onSuccess: (r) => {
      message.success(`${fa(r.sync.seen)} نصب دیده شد؛ ${fa(r.sync.created)} تازه، ${fa(r.sync.removed)} برچیده`);
      refresh();
    },
    onError: (e: Error) => message.error(e.message),
  });
  const run = useMutation({ mutationFn: () => itamApi.complianceRun(api), onSuccess: () => { message.success("تطبیق دوباره انجام شد"); refresh(); }, onError: (e: Error) => message.error(e.message) });
  const narrate = useMutation({ mutationFn: () => itamApi.narrative(api), onSuccess: setStory, onError: (e: Error) => message.error(e.message) });
  const d = q.data;
  const shown = (d?.positions ?? []).filter((p) => (filter === "risk" ? ["under_licensed", "unlicensed"].includes(p.status) : filter === "surplus" ? p.status === "over_licensed" || p.unused_installs > 0 : true));
  const cols = [
    { title: "نرم‌افزار", dataIndex: "model", key: "model", render: (v: string, r: CompliancePosition) => <Link className="ds-link" to={`/${orgId}/itam/software/${r.software_model_id}`}>{v}</Link> },
    { title: "ناشر", dataIndex: "publisher", key: "publisher", render: (v: string | null) => v ?? "—" },
    { title: "معیار", dataIndex: "metric", key: "metric", render: (v: string) => label(LICENSE_METRICS, v) },
    { title: "مجوز", dataIndex: "entitled", key: "entitled", width: 70, render: (v: number) => <span className="ds-num">{fa(v)}</span> },
    { title: "مصرف", dataIndex: "consumed", key: "consumed", width: 70, render: (v: number) => <span className="ds-num">{fa(v)}</span> },
    { title: "اختلاف", dataIndex: "delta", key: "delta", width: 80, render: (v: number) => <span className={`ds-num ${v < 0 ? "text-danger" : ""}`}>{v > 0 ? "+" : ""}{fa(v)}</span> },
    { title: "وضعیت", dataIndex: "status", key: "status", width: 130, render: (v: string) => <Chip tone={TONE[v] ?? "neutral"}>{label(POSITION_STATUS, v)}</Chip> },
    { title: "بی‌استفاده", dataIndex: "unused_installs", key: "unused", width: 80, render: (v: number) => <span className="ds-num">{fa(v)}</span> },
    ...(d?.financial ? [
      { title: "ریسک کمبود", dataIndex: "exposure", key: "exposure", render: (v: string) => <Money v={v} /> },
      { title: "صرفه‌جویی ممکن", dataIndex: "savings", key: "savings", render: (v: string) => <Money v={v} /> },
    ] : []),
  ];
  return (
    <div>
      <PageHeader
        title="انطباق مجوزهای نرم‌افزار"
        subtitle={d?.run?.finished_at ? `آخرین تطبیق ${formatJalaliDateTime(d.run.finished_at)}` : undefined}
        actions={
          <Space wrap>
            <Button icon={<Sparkles {...ICON} />} loading={narrate.isPending} onClick={() => narrate.mutate()}>روایت بهینه‌سازی</Button>
            {meta.data?.can_manage ? <Button icon={<RefreshCw {...ICON} />} loading={sync.isPending} onClick={() => sync.mutate()}>همگام‌سازی نصب‌ها</Button> : null}
            {meta.data?.can_manage ? <Button icon={<Scale {...ICON} />} loading={run.isPending} onClick={() => run.mutate()}>تطبیق دوباره</Button> : null}
          </Space>
        }
      />
      {q.isLoading ? (
        <Loader />
      ) : !d || !d.run ? (
        <EmptyState title="هنوز تطبیقی انجام نشده است" description="نصب‌ها از جمع‌آورندهٔ موجودی (پایگاه پیکربندی) گرفته و با مجوزهای فعال مقایسه می‌شوند." icon={Scale} action={meta.data?.can_manage ? <Button type="primary" loading={sync.isPending} onClick={() => sync.mutate()}>همگام‌سازی و تطبیق</Button> : undefined} />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="itam-tiles">
            <StatCard title="نرم‌افزار" value={fa(d.totals.products)} />
            <StatCard title="منطبق" value={fa(d.totals.compliant)} />
            <StatCard title="کمبود مجوز" value={fa(d.totals.under_licensed)} onClick={() => setFilter("risk")} />
            <StatCard title="مجوز مازاد" value={fa(d.totals.over_licensed)} onClick={() => setFilter("surplus")} />
            {d.totals.exposure !== null ? <StatCard title="ریسک کمبود" value={<Money v={d.totals.exposure} />} /> : null}
            {d.totals.savings !== null ? <StatCard title="صرفه‌جویی ممکن" value={<Money v={d.totals.savings} />} /> : null}
          </div>
          {story ? (
            <Card title="روایت بهینه‌سازی مجوزها">
              <RecordMarkdown text={story.text} />
              <AiLabel ai={story.ai} model={story.model} />
            </Card>
          ) : null}
          <Card title="وضعیت مؤثر مجوزها" flush tools={<Segmented size="small" value={filter} onChange={(v) => setFilter(v as typeof filter)} options={[{ value: "all", label: "همه" }, { value: "risk", label: "ریسک" }, { value: "surplus", label: "صرفه‌جویی" }]} />}>
            <Table rowKey="id" size="small" dataSource={shown} columns={cols} pagination={{ pageSize: 50, hideOnSinglePage: true }} scroll={{ x: 1000 }} />
          </Card>
          {d.trueups.length ? (
            <Card title="تعدیل‌ها و تمدیدهای پیش رو (۱۸۰ روز)" flush>
              <Table
                rowKey="entitlement_id"
                size="small"
                pagination={false}
                dataSource={d.trueups}
                columns={[
                  { title: "مجوز", dataIndex: "name", key: "name", render: (v: string, r: TrueUpRow) => <Link className="ds-link" to={`/${orgId}/itam/entitlements/${r.entitlement_id}`}>{r.number} {v}</Link> },
                  { title: "نرم‌افزار", dataIndex: "model", key: "model" },
                  { title: "موعد", dataIndex: "due", key: "due", render: (v: string, r: TrueUpRow) => `${formatJalali(v)} (${fa(r.days_left)} روز)` },
                  { title: "مجوز", dataIndex: "entitled", key: "entitled", render: (v: number) => <span className="ds-num">{fa(v)}</span> },
                  { title: "مصرف پیش‌بینی‌شده", dataIndex: "projected", key: "projected", render: (v: number) => <span className="ds-num">{fa(v)}</span> },
                  { title: "کمبود", dataIndex: "shortfall", key: "shortfall", render: (v: number) => (v ? <Chip tone="danger" fig>{fa(v)}</Chip> : "—") },
                  ...(d.financial ? [{ title: "هزینهٔ تعدیل", dataIndex: "cost", key: "cost", render: (v: string | null) => <Money v={v} /> }] : []),
                ]}
              />
            </Card>
          ) : null}
          <div className="itam-two">
            <Card title="نرم‌افزار ممنوع یا محدود نصب‌شده">
              {d.restricted.length ? (
                <ul className="itam-list">{d.restricted.map((r) => <li key={r.model}><span>{r.model} <Chip tone={r.status === "prohibited" ? "danger" : "warning"}>{r.status === "prohibited" ? "ممنوع" : "محدود"}</Chip></span><span className="ds-num">{fa(r.installs)}</span></li>)}</ul>
              ) : <div className="text-ink-3 text-[13px]">نرم‌افزار ممنوعی دیده نشد</div>}
            </Card>
            <Card title="نام‌های یکسان‌نشده" tools={<Link to={`/${orgId}/itam/software`}><Button size="small">مدل‌های نرم‌افزار</Button></Link>}>
              {d.unmatched.length ? (
                <ul className="itam-list">{d.unmatched.map((u) => <li key={u.raw_name}><span className="ltr">{u.raw_name}</span><span className="ds-num">{fa(u.installs)}</span></li>)}</ul>
              ) : <div className="text-ink-3 text-[13px]">همهٔ نصب‌ها به مدلی رسیده‌اند</div>}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
