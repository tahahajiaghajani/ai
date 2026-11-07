// «تأییدهای من»: approvals waiting for me (also as an absent colleague's delegate) and those I decided. Approve or
// reject one, or select several and decide them together (a rejection asks for its reason, which the requester sees);
// every row opens its record. The server decides each approval on its own: those that fail are reported by name.
import { useMemo, useState } from "react";
import { Button, Segmented, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Check, X, UserRoundCheck, Stamp } from "lucide-react";
import { useNavigate } from "react-router";
import { faDigits } from "@shared/format";
import { formatJalaliDateTime } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useAction, useNotify } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Loader } from "../../components/display";
import { ICON, ICON14 } from "../../components/blocks";
import { UserChip } from "../../records";
import { approvalsApi, useMyApprovals, useSlaRefresh, type ApprovalView, type Decision } from "./api";
import { dueState } from "./model";
import { ApprovalState, DecisionDialog, RecordRef } from "./parts";

type Scope = "pending" | "decided";

export default function Approvals() {
  const { api, orgId, timezone } = useOrg();
  const navigate = useNavigate();
  const notify = useNotify();
  const refresh = useSlaRefresh();
  const [scope, setScope] = useState<Scope>("pending");
  const q = useMyApprovals(scope);
  const pendingCount = useMyApprovals("pending").data?.approvals.length;
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<{ ids: string[]; decision: Decision } | null>(null);
  const rows = useMemo(() => q.data?.approvals ?? [], [q.data]);
  const display = q.data?.display ?? {};

  const decide = useAction(
    async ({ ids, decision, comment }: { ids: string[]; decision: Decision; comment: string }) => {
      if (ids.length > 1) return approvalsApi.decideMany(api, ids, decision, comment);
      // one decision: its refusal (a closed approval, separation of duties…) is the error toast
      await approvalsApi.decide(api, ids[0], decision, comment);
      return { done: 1, failed: [] as { id: string; message: string }[] };
    },
    {
      onSuccess: (r, v) => {
        const verb = v.decision === "approved" ? "تأیید شد" : "رد شد";
        if (r.done) notify.ok(r.done === 1 ? `${verb}.` : `${faDigits(r.done)} مورد ${verb}.`);
        if (r.failed.length) {
          const title = (id: string) => rows.find((a) => a.id === id)?.record_number ?? "";
          notify.warn(`${faDigits(r.failed.length)} مورد انجام نشد`, { description: r.failed.map((f) => [title(f.id), f.message].filter(Boolean).join(": ")).join("\n") });
        }
        setDialog(null);
        setSelected([]);
        void refresh.approvals();
      },
    },
  );

  const tz = timezone;
  const columns: ColumnsType<ApprovalView> = [
    {
      title: "رکورد",
      key: "record",
      render: (_, a) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <RecordRef a={a} />
          <span className="text-[12px] text-ink-3">{a.table_label}</span>
        </div>
      ),
    },
    {
      title: "مرحله",
      key: "step",
      responsive: ["md"],
      render: (_, a) => (
        <div className="flex flex-col gap-0.5 text-[13px]">
          <span className="text-ink-2">{a.rule_name ?? "تأیید"}</span>
          {a.level_name || a.level > 1 ? <span className="text-ink-3">{a.level_name ?? `سطح ${faDigits(a.level)}`}</span> : null}
        </div>
      ),
    },
    scope === "pending"
      ? {
          title: "درخواست",
          key: "requested",
          responsive: ["lg"],
          render: (_, a) => (
            <div className="flex flex-col gap-0.5 text-[13px]">
              <span className="ds-num text-ink-2">{formatJalaliDateTime(a.requested_at, tz)}</span>
              {a.requested_by ? <UserChip id={a.requested_by} display={display} /> : <span className="text-ink-3">قاعدهٔ خودکار</span>}
            </div>
          ),
        }
      : {
          title: "تصمیم",
          key: "decision",
          render: (_, a) => (
            <div className="flex flex-col gap-1 text-[13px]">
              <span className="flex flex-wrap items-center gap-2">
                <ApprovalState state={a.state} />
                <span className="ds-num text-ink-3">{formatJalaliDateTime(a.decided_at, tz)}</span>
              </span>
              {a.comments ? <span className="line-clamp-2 text-ink-2">{a.comments}</span> : null}
            </div>
          ),
        },
    {
      title: "مهلت",
      key: "due",
      responsive: ["sm"],
      render: (_, a) => {
        if (!a.due_at) return <span className="text-ink-3">—</span>;
        const d = scope === "pending" ? dueState(a.due_at) : { tone: null, text: "" };
        return (
          <div className="flex flex-col items-start gap-1 text-[13px]">
            <span className="ds-num text-ink-2">{formatJalaliDateTime(a.due_at, tz)}</span>
            {d.tone ? <Chip tone={d.tone}>{d.text}</Chip> : null}
          </div>
        );
      },
    },
    {
      title: "",
      key: "act",
      width: 200,
      render: (_, a) => (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {a.on_behalf_of ? (
            <span className="me-auto text-[12px] text-ink-3">
              به جانشینی از <UserChip id={a.on_behalf_of} display={display} />
            </span>
          ) : null}
          {a.can_decide ? (
            <>
              <Button size="small" icon={<Check {...ICON14} />} onClick={() => setDialog({ ids: [a.id], decision: "approved" })}>
                تأیید
              </Button>
              <Button size="small" danger icon={<X {...ICON14} />} onClick={() => setDialog({ ids: [a.id], decision: "rejected" })}>
                رد
              </Button>
            </>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="تأییدهای من"
        actions={
          <Button icon={<UserRoundCheck {...ICON} />} onClick={() => navigate(`/${orgId}/approvals/delegations`)}>
            جانشینی‌ها
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <Segmented<Scope>
          value={scope}
          onChange={(v) => {
            setScope(v);
            setSelected([]);
          }}
          options={[
            { value: "pending", label: pendingCount ? `در انتظار من (${faDigits(pendingCount)})` : "در انتظار من" },
            { value: "decided", label: "تصمیم‌های من" },
          ]}
        />
        {q.data?.delegators.length ? (
          <span className="text-[13px] text-ink-3">
            جانشین{" "}
            {q.data.delegators.map((u, i) => (
              <span key={u}>
                {i ? "، " : ""}
                <UserChip id={u} display={display} />
              </span>
            ))}{" "}
            هستید
          </span>
        ) : null}
        {selected.length ? (
          <div className="ms-auto flex items-center gap-2" role="toolbar" aria-label="تصمیم دسته‌جمعی">
            <span className="text-[13px] text-ink-2">
              <span className="ds-num">{faDigits(selected.length)}</span> مورد برگزیده
            </span>
            <Button type="primary" icon={<Check {...ICON14} />} onClick={() => setDialog({ ids: selected, decision: "approved" })}>
              تأیید همه
            </Button>
            <Button danger icon={<X {...ICON14} />} onClick={() => setDialog({ ids: selected, decision: "rejected" })}>
              رد همه
            </Button>
          </div>
        ) : null}
      </div>
      {q.isLoading ? (
        <Loader />
      ) : !rows.length ? (
        <EmptyState icon={Stamp} title={scope === "pending" ? "تأییدی در انتظار شما نیست" : "هنوز تصمیمی نگرفته‌اید"} />
      ) : (
        <Table<ApprovalView>
          size="small"
          rowKey="id"
          columns={columns}
          dataSource={rows}
          pagination={rows.length > 50 ? { pageSize: 50, showSizeChanger: false } : false}
          rowSelection={
            scope === "pending"
              ? { selectedRowKeys: selected, onChange: (keys) => setSelected(keys.map(String)), getCheckboxProps: (a) => ({ disabled: !a.can_decide, "aria-label": `برگزیدن ${a.record_number ?? ""}` }) }
              : undefined
          }
        />
      )}
      <DecisionDialog
        decision={dialog?.decision ?? null}
        count={dialog?.ids.length ?? 0}
        loading={decide.isPending}
        onCancel={() => setDialog(null)}
        onConfirm={(comment) => dialog && decide.mutate({ ids: dialog.ids, decision: dialog.decision, comment })}
      />
    </div>
  );
}
