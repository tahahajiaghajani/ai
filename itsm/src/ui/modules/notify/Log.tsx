// «گزارش ارسال»: every delivery attempt (sent, failed, skipped with the reason — no access, opted out, quiet hours,
// in the digest…) and every e-mail sent or received (with why an incoming one was set aside). The server withholds
// subjects and recipients of records the caller may not read.
import { useState } from "react";
import { Link } from "react-router";
import { Button, Select, Tabs, Tooltip } from "antd";
import { useQuery } from "@tanstack/react-query";
import { NOTIFY_CHANNELS, type NotifyChannel } from "@shared/notify";
import { formatJalaliDateTime } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Card } from "../../components/blocks";
import { Chip, type ChipTone } from "../../components/display";
import { DataTable } from "../../components/data";
import { recordPath } from "../../records/extensions";
import { KEYS, type EmailLogEntry, type LogEntry } from "./api";
import "./notify.css";

const STATUS: Record<string, [string, ChipTone]> = {
  sent: ["فرستاده شد", "in"],
  failed: ["ناموفق", "danger"],
  skipped: ["فرستاده نشد", "neutral"],
  held: ["در انتظار", "warning"],
  processed: ["پردازش شد", "in"],
  rejected: ["کنار گذاشته شد", "neutral"],
};
const status = (s: string, why?: string | null) => {
  const [label, tone] = STATUS[s] ?? [s, "neutral" as ChipTone];
  const chip = <Chip tone={tone}>{label}</Chip>;
  return why ? <Tooltip title={why}>{chip}</Tooltip> : chip;
};
const STEP = 50;

function Deliveries() {
  const { api, orgId, timezone } = useOrg();
  const [st, setSt] = useState<string | null>(null);
  const [channel, setChannel] = useState<NotifyChannel | null>(null);
  const [limit, setLimit] = useState(STEP);
  const q = useQuery({
    queryKey: [...KEYS.log(orgId), st, channel, limit],
    queryFn: () => api.get<{ entries: LogEntry[]; display: Record<string, string>; more: boolean }>("/notify/log", { status: st ?? undefined, channel: channel ?? undefined, limit: String(limit) }),
    placeholderData: (p) => p,
  });
  const display = q.data?.display ?? {};
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Select
          allowClear
          placeholder="همهٔ وضعیت‌ها"
          className="w-44"
          value={st ?? undefined}
          options={["sent", "failed", "skipped", "held"].map((k) => ({ value: k, label: STATUS[k][0] }))}
          onChange={(v) => setSt(v ?? null)}
          aria-label="وضعیت"
        />
        <Select
          allowClear
          placeholder="همهٔ راه‌ها"
          className="w-44"
          value={channel ?? undefined}
          options={(Object.keys(NOTIFY_CHANNELS) as NotifyChannel[]).map((k) => ({ value: k, label: NOTIFY_CHANNELS[k].label }))}
          onChange={(v) => setChannel(v ?? null)}
          aria-label="راه ارسال"
        />
      </div>
      <DataTable<LogEntry>
        rowKey="id"
        loading={q.isLoading}
        dataSource={q.data?.entries ?? []}
        pagination={false}
        locale={{ emptyText: "ارسالی ثبت نشده است" }}
        columns={[
          { title: "زمان", dataIndex: "created_at", width: 150, render: (v: string) => <span className="ds-num">{formatJalaliDateTime(v, timezone)}</span> },
          {
            title: "رکورد",
            dataIndex: "record_number",
            render: (_: unknown, r) =>
              r.record_id && r.table_key && r.subject !== null ? (
                <Link to={`/${orgId}/${recordPath(r.table_key, r.record_id)}`}>
                  <span className="ds-ltr">{r.record_number ?? r.table_label}</span>
                </Link>
              ) : r.record_id ? (
                <span className="text-ink-3">محدود</span>
              ) : (
                "—"
              ),
          },
          { title: "موضوع", dataIndex: "subject", ellipsis: true, render: (v: string | null, r) => v ?? (r.record_id ? <span className="text-ink-3">محدود</span> : r.event_label) },
          { title: "رویداد", dataIndex: "event_label", width: 150 },
          { title: "گیرنده", dataIndex: "recipient_id", render: (v: string | null, r) => (v ? (display[v] ?? "—") : r.target ? <span className="ds-ltr">{r.target}</span> : "—") },
          { title: "راه", dataIndex: "channel", width: 120, render: (v: NotifyChannel) => NOTIFY_CHANNELS[v]?.label ?? v },
          { title: "وضعیت", dataIndex: "status", width: 130, render: (v: string, r) => status(v, r.error ?? r.reason_label) },
          { title: "قانون", dataIndex: "rule_name", ellipsis: true },
        ]}
      />
      {q.data?.more && limit < 200 ? (
        <div className="nf-more">
          <Button size="small" loading={q.isFetching} onClick={() => setLimit(Math.min(200, limit + STEP))}>
            بیشتر
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Emails() {
  const { api, orgId, timezone } = useOrg();
  const [direction, setDirection] = useState<"in" | "out" | null>(null);
  const [limit, setLimit] = useState(STEP);
  const q = useQuery({
    queryKey: [...KEYS.emailLog(orgId), direction, limit],
    queryFn: () => api.get<{ messages: EmailLogEntry[]; more: boolean }>("/notify/email-log", { direction: direction ?? undefined, limit: String(limit) }),
    placeholderData: (p) => p,
  });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Select
          allowClear
          placeholder="رسیده و فرستاده"
          className="w-44"
          value={direction ?? undefined}
          options={[
            { value: "in", label: "رسیده" },
            { value: "out", label: "فرستاده" },
          ]}
          onChange={(v) => setDirection(v ?? null)}
          aria-label="جهت"
        />
      </div>
      <DataTable<EmailLogEntry>
        rowKey="id"
        loading={q.isLoading}
        dataSource={q.data?.messages ?? []}
        pagination={false}
        locale={{ emptyText: "ایمیلی ثبت نشده است" }}
        columns={[
          { title: "زمان", dataIndex: "created_at", width: 150, render: (v: string) => <span className="ds-num">{formatJalaliDateTime(v, timezone)}</span> },
          { title: "جهت", dataIndex: "direction", width: 90, render: (v: string) => (v === "in" ? "رسیده" : "فرستاده") },
          { title: "از", dataIndex: "from_addr", ellipsis: true, render: (v: string | null) => (v ? <span className="ds-ltr">{v}</span> : "—") },
          { title: "به", dataIndex: "to_addrs", ellipsis: true, render: (v: string | null) => (v ? <span className="ds-ltr">{v}</span> : "—") },
          { title: "موضوع", dataIndex: "subject", ellipsis: true, render: (v: string | null) => v ?? <span className="text-ink-3">محدود</span> },
          {
            title: "رکورد",
            dataIndex: "record_id",
            width: 110,
            render: (v: string | null, r) => (v && r.table_key ? <Link to={`/${orgId}/${recordPath(r.table_key, v)}`}>مشاهده</Link> : "—"),
          },
          { title: "وضعیت", dataIndex: "status", width: 140, render: (v: string, r) => status(v, r.reason_label) },
        ]}
      />
      {q.data?.more && limit < 200 ? (
        <div className="nf-more">
          <Button size="small" loading={q.isFetching} onClick={() => setLimit(Math.min(200, limit + STEP))}>
            بیشتر
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export default function Log() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="گزارش ارسال" />
      <Card>
        <Tabs
          destroyOnHidden
          items={[
            { key: "deliveries", label: "اعلان‌ها", children: <Deliveries /> },
            { key: "emails", label: "ایمیل‌ها", children: <Emails /> },
          ]}
        />
      </Card>
    </div>
  );
}
