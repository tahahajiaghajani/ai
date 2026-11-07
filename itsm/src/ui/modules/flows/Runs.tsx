// «اجراهای گردش‌کار»: the run history of the flows the member may read — newest first, by flow and state — and a
// compact table of one flow's runs for its record page.
import { useNavigate, useSearchParams } from "react-router";
import { Select, Table } from "antd";
import { History } from "lucide-react";
import type { FlowRunView, RunState } from "@shared/flows";
import { RUN_STATES } from "@shared/flows";
import { faDigits } from "@shared/format";
import { formatJalaliDateTime } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { EmptyState } from "../../components/display";
import { RecordSelect } from "../../records";
import { useRuns } from "./api";
import { RunStateChip, durationText, triggerLabel } from "./RunSteps";

export function RunsTable({ flow, size = 25, compact }: { flow?: string; size?: number; compact?: boolean }) {
  const { orgId } = useOrg();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const state = (compact ? undefined : (sp.get("state") as RunState | null)) ?? undefined;
  const page = compact ? 1 : Number(sp.get("page") ?? 1) || 1;
  const q = useRuns({ flow: flow ?? (compact ? undefined : sp.get("flow") ?? undefined), state, page, size });
  const rows = q.data?.runs ?? [];
  const columns = [
    ...(flow ? [] : [{ title: "گردش‌کار", key: "flow", render: (_: unknown, r: FlowRunView) => <span>{r.flow_name}</span> }]),
    { title: "وضعیت", key: "state", render: (_: unknown, r: FlowRunView) => <RunStateChip state={r.state} /> },
    { title: "آغازگر", key: "trigger", render: (_: unknown, r: FlowRunView) => triggerLabel(r.test ? "test" : r.trigger_kind) },
    { title: "نسخه", key: "version", render: (_: unknown, r: FlowRunView) => (r.version_no ? <span className="ds-num">{faDigits(r.version_no)}</span> : "پیش‌نویس") },
    { title: "آغاز", key: "started", render: (_: unknown, r: FlowRunView) => <span className="ds-num">{formatJalaliDateTime(r.started_at)}</span> },
    {
      title: "مدت",
      key: "duration",
      render: (_: unknown, r: FlowRunView) => (r.ended_at ? durationText(Date.parse(r.ended_at) - Date.parse(r.started_at)) : ""),
    },
    { title: "گام‌ها", key: "steps", render: (_: unknown, r: FlowRunView) => <span className="ds-num">{faDigits(r.steps_count)}</span> },
  ];
  if (!q.isLoading && !rows.length && (compact || (!state && !sp.get("flow")))) {
    return <EmptyState compact={compact} icon={History} title="هنوز اجرایی ثبت نشده است" />;
  }
  return (
    <Table<FlowRunView>
      rowKey="id"
      size="small"
      loading={q.isLoading}
      dataSource={rows}
      columns={columns}
      scroll={{ x: true }}
      onRow={(r) => ({ onClick: () => nav(`/${orgId}/flows/runs/${r.id}`), style: { cursor: "pointer" } })}
      pagination={
        compact
          ? false
          : {
              current: page,
              pageSize: size,
              total: q.data?.total ?? 0,
              showSizeChanger: false,
              onChange: (p) => {
                const next = new URLSearchParams(sp);
                next.set("page", String(p));
                setSp(next, { replace: true });
              },
            }
      }
    />
  );
}

export default function Runs() {
  const [sp, setSp] = useSearchParams();
  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(sp);
    if (v) next.set(k, v);
    else next.delete(k);
    next.delete("page");
    setSp(next, { replace: true });
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="اجراهای گردش‌کار" />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <div style={{ width: 260, maxWidth: "100%" }}>
          <RecordSelect table="flow" value={sp.get("flow")} onChange={(v) => set("flow", (v as string | null) ?? null)} placeholder="همهٔ گردش‌کارها" allowClear />
        </div>
        <Select
          style={{ width: 180 }}
          allowClear
          placeholder="همهٔ وضعیت‌ها"
          value={sp.get("state") ?? undefined}
          options={Object.entries(RUN_STATES).map(([value, s]) => ({ value, label: s.label }))}
          onChange={(v) => set("state", v ?? null)}
        />
      </div>
      <RunsTable />
    </div>
  );
}
