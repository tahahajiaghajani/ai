// «فعالیت دستیار»: what the assistant prepared (proposals, with who confirmed or rejected them and what was created)
// and which tools it ran for whom, newest first, with filters.
import { useState } from "react";
import { Link } from "react-router";
import { Button, Segmented, Table } from "antd";
import { CircleCheck, CircleX, History } from "lucide-react";
import type { AiProposalStatus } from "@shared/ai/types";
import { useOrg } from "../../lib/org";
import { Chip, EmptyState, JDateTime } from "../../components/display";
import { FilterChip } from "../../components/inputs";
import { Card } from "../../modules/reports/kit";
import { duration } from "../kit/model";
import { useAiActions, useAiToolCalls } from "../kit/hooks";
import type { AiActionView, AiToolCallView } from "../kit/types";

const STATUS: Record<AiProposalStatus, { label: string; tone: "warning" | "danger" | "neutral" | null }> = {
  proposed: { label: "در انتظار تأیید", tone: "warning" },
  executing: { label: "در حال ثبت", tone: "neutral" },
  executed: { label: "ثبت شد", tone: null },
  rejected: { label: "رد شد", tone: "neutral" },
  expired: { label: "منقضی شد", tone: "neutral" },
  failed: { label: "ناموفق", tone: "danger" },
};

export function ProposalStatus({ s }: { s: AiProposalStatus }) {
  const m = STATUS[s] ?? { label: s, tone: "neutral" as const };
  return m.tone ? <Chip tone={m.tone}>{m.label}</Chip> : <span className="sf-status">{m.label}</span>;
}

function ProposalDetail({ a }: { a: AiActionView }) {
  const { orgId } = useOrg();
  return (
    <div className="grid gap-3 py-2">
      {a.summary_fa ? <div className="text-[13px] text-ink-2">{a.summary_fa}</div> : null}
      {a.preview.length ? (
        <dl className="ai-prev">
          {a.preview.map((p, i) => (
            <div key={i} style={{ display: "contents" }}>
              <dt>{p.label}</dt>
              <dd>{p.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {a.lines?.length ? (
        <div className="ai-md-wrap">
          <table className="ai-test-t">
            {a.line_headers?.length ? (
              <thead>
                <tr>
                  {a.line_headers.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
            ) : null}
            <tbody>
              {a.lines.map((l, i) => (
                <tr key={i}>
                  {l.cells.map((c, j) => (
                    <td key={j}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {a.warnings?.length ? (
        <ul className="ai-review-w">
          {a.warnings.map((w) => (
            <li key={w}>
              <i className="sf-nuqta" aria-hidden />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {a.error ? <div className="text-[13px] text-danger">{a.error}</div> : null}
      {a.result?.path ? (
        <div>
          <Link className="sf-link text-[13px]" to={`/${orgId}/${a.result.path.replace(/^\/+/, "")}`}>
            مشاهدهٔ {a.result.label}
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function Proposals() {
  const [status, setStatus] = useState<string | null>(null);
  const q = useAiActions({ status: status ?? undefined });
  const rows = (q.data ?? []).filter((a) => !status || a.status === status);
  return (
    <Card
      title="پیش‌نویس‌های دستیار"
      meta={<span className="bk-cap">هر پیش‌نویس فقط با تأیید کسی که دسترسی دارد ثبت می‌شود</span>}
      tools={
        <FilterChip
          label="وضعیت"
          value={status}
          onChange={setStatus}
          options={(Object.keys(STATUS) as AiProposalStatus[]).map((s) => ({ value: s, label: STATUS[s].label }))}
        />
      }
      flush
    >
      <Table<AiActionView>
        className="bk-tbl"
        size="small"
        rowKey="id"
        loading={q.isLoading}
        dataSource={rows}
        pagination={{ pageSize: 30, hideOnSinglePage: true, size: "small" }}
        scroll={{ x: 760 }}
        expandable={{ expandedRowRender: (a) => <ProposalDetail a={a} />, rowExpandable: () => true }}
        locale={{
          emptyText: q.error ? (
            <EmptyState compact title="فهرست بارگذاری نشد." description={(q.error as Error).message} action={<Button onClick={() => q.refetch()}>تلاش دوباره</Button>} />
          ) : (
            <EmptyState compact icon={History} title={status ? "پیش‌نویسی با این وضعیت نیست." : "دستیار هنوز پیش‌نویسی آماده نکرده."} />
          ),
        }}
        columns={[
          { key: "at", dataIndex: "created_at", title: "زمان", width: 150, render: (v) => <span className="bk-2"><JDateTime v={v} /></span> },
          { key: "user", dataIndex: ["user", "name"], title: "درخواست‌کننده", width: 150, ellipsis: true, render: (v) => v ?? <span className="sf-zero">—</span> },
          { key: "title", dataIndex: "title_fa", title: "پیش‌نویس", ellipsis: true },
          { key: "st", dataIndex: "status", title: "وضعیت", width: 136, render: (v: AiProposalStatus) => <ProposalStatus s={v} /> },
          { key: "by", dataIndex: ["confirmed_by", "name"], title: "تأیید یا رد", width: 150, ellipsis: true, render: (v) => v ?? <span className="sf-zero">—</span> },
        ]}
      />
    </Card>
  );
}

function ToolCalls() {
  const [result, setResult] = useState<string | null>(null);
  const q = useAiToolCalls({ ok: result ?? undefined });
  const rows = (q.data ?? []).filter((t) => (result === null ? true : result === "ok" ? t.ok : !t.ok));
  return (
    <Card
      title="ابزارهای اجراشده"
      meta={<span className="bk-cap">هر ابزار با دسترسی همان کاربر اجرا می‌شود</span>}
      tools={<FilterChip label="نتیجه" value={result} onChange={setResult} options={[{ value: "ok", label: "موفق" }, { value: "failed", label: "ناموفق" }]} />}
      flush
    >
      <Table<AiToolCallView>
        className="bk-tbl"
        size="small"
        rowKey="id"
        loading={q.isLoading}
        dataSource={rows}
        pagination={{ pageSize: 50, hideOnSinglePage: true, size: "small" }}
        scroll={{ x: 760 }}
        locale={{
          emptyText: q.error ? (
            <EmptyState compact title="فهرست بارگذاری نشد." description={(q.error as Error).message} action={<Button onClick={() => q.refetch()}>تلاش دوباره</Button>} />
          ) : (
            <EmptyState compact icon={History} title="دستیار هنوز ابزاری اجرا نکرده." />
          ),
        }}
        columns={[
          { key: "at", dataIndex: "created_at", title: "زمان", width: 150, render: (v) => <span className="bk-2"><JDateTime v={v} /></span> },
          { key: "user", dataIndex: ["user", "name"], title: "کاربر", width: 150, ellipsis: true, render: (v) => v ?? <span className="sf-zero">—</span> },
          { key: "tool", title: "ابزار", width: 200, ellipsis: true, render: (_, t) => t.title_fa ?? <bdi dir="ltr" className="sf-mono text-[12px]">{t.tool}</bdi> },
          {
            key: "ok",
            dataIndex: "ok",
            title: "نتیجه",
            width: 84,
            render: (ok: boolean) =>
              ok ? (
                <span className="inline-flex items-center gap-1 text-ink-3"><CircleCheck size={14} strokeWidth={1.4} absoluteStrokeWidth className="text-in" aria-hidden />موفق</span>
              ) : (
                <span className="inline-flex items-center gap-1 text-danger"><CircleX size={14} strokeWidth={1.4} absoluteStrokeWidth aria-hidden />ناموفق</span>
              ),
          },
          { key: "sum", dataIndex: "summary", title: "خلاصه", ellipsis: true, render: (v) => v ?? <span className="sf-zero">—</span> },
          { key: "ms", dataIndex: "ms", title: "مدت", width: 112, render: (v) => (v ? <span className="sf-num bk-2">{duration(v)}</span> : <span className="sf-zero">—</span>) },
        ]}
      />
    </Card>
  );
}

export function ActivityTab() {
  const [view, setView] = useState<"proposals" | "tools">("proposals");
  return (
    <>
      <div className="ai-act-filters">
        <Segmented<"proposals" | "tools">
          value={view}
          onChange={setView}
          options={[
            { value: "proposals", label: "پیش‌نویس‌ها" },
            { value: "tools", label: "ابزارها" },
          ]}
          aria-label="نوع فعالیت"
        />
      </div>
      {view === "proposals" ? <Proposals /> : <ToolCalls />}
    </>
  );
}
