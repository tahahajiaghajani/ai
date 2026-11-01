// Cheques by due date (سررسید چک‌ها): open received cheques (in hand / in collection) and open
// issued cheques grouped by due date with the net cash flow and its running total — what comes
// in and goes out of the bank in the coming days.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Segmented, Space, Table, Tag } from "antd";
import { PrinterOutlined } from "@ant-design/icons";
import { useOrg } from "../../lib/org";
import { DateInput } from "../../components/inputs";
import { JDate, Money, StatusTag } from "../../components/display";
import { faDigits } from "@shared/format";
import { formatJalali } from "@shared/jalali";
import { D } from "@shared/money";
import { chequeStatusMap } from "./labels";

interface Agg {
  count: number;
  sum: string;
}

export function ChequesDue({ onOpen }: { onOpen: (id: string) => void }) {
  const { api, org } = useOrg();
  const [direction, setDirection] = useState<string>("");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["treasury-due", direction, from, to],
    queryFn: () => api.get("/treasury/reports/cheques-due", { direction, from, to }),
  });
  const d = q.data;
  const rows = (d?.rows ?? []) as any[];
  const cell = (a: Agg | undefined, tone: string) =>
    a && a.count ? (
      <span className={tone}>
        <Money v={a.sum} /> <span className="text-[11px] text-muted">({faDigits(a.count)})</span>
      </span>
    ) : (
      <span className="text-muted">—</span>
    );

  return (
    <div className="print-sheet tz-card p-3 md:p-4">
      <div className="mb-3 hidden text-center print:block">
        <div className="text-lg font-bold">{org.name}</div>
        <div className="text-base font-semibold">سررسید چک‌ها{d ? ` — ${formatJalali(d.today)}` : ""}</div>
      </div>
      <div className="no-print mb-3 flex flex-wrap items-center gap-2">
        <Segmented
          value={direction}
          onChange={(v) => setDirection(String(v))}
          options={[
            { value: "", label: "همه" },
            { value: "received", label: "دریافتی" },
            { value: "issued", label: "پرداختی" },
          ]}
        />
        <Space>
          <DateInput value={from} onChange={setFrom} placeholder="سررسید از" allowClear className="!w-36" />
          <DateInput value={to} onChange={setTo} placeholder="سررسید تا" allowClear className="!w-36" />
        </Space>
        <Button className="ms-auto" icon={<PrinterOutlined />} onClick={() => window.print()}>
          چاپ
        </Button>
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(d?.buckets ?? []).map((b: any) => (
          <div key={b.key} className={`tz-soft p-3 ${b.key === "overdue" && (b.received.count || b.issued.count) ? "!border-[var(--tz-danger)]" : ""}`}>
            <div className="mb-2 text-xs font-bold">{b.label}</div>
            <div className="flex justify-between text-xs">
              <span className="text-muted">دریافتنی</span>
              {cell(b.received, "text-ok")}
            </div>
            <div className="mt-1 flex justify-between text-xs">
              <span className="text-muted">پرداختنی</span>
              {cell(b.issued, "text-bad")}
            </div>
            <div className="mt-2 flex justify-between border-t border-line pt-1 text-xs">
              <span className="text-muted">خالص</span>
              <Money v={b.net} colored parens />
            </div>
          </div>
        ))}
      </div>
      <Table
        className="tz-table"
        size="small"
        rowKey="due_date"
        loading={q.isLoading}
        dataSource={d?.by_date ?? []}
        pagination={{ pageSize: 100, hideOnSinglePage: true, size: "small" }}
        scroll={{ x: "max-content" }}
        rowClassName={(r: any) => (d && r.due_date < d.today ? "tz-cheque-overdue" : "")}
        expandable={{
          expandedRowRender: (r: any) => (
            <div className="flex flex-col gap-1 py-1">
              {rows
                .filter((x) => x.due_date === r.due_date)
                .map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    onClick={() => onOpen(x.id)}
                    className="flex flex-wrap items-center gap-3 rounded-md px-2 py-1 text-start text-xs hover:bg-surface-2"
                  >
                    <Tag variant="filled" color={x.direction === "received" ? "cyan" : "gold"} className="!m-0">
                      {x.direction === "received" ? "دریافتی" : "پرداختی"}
                    </Tag>
                    <span className="num ltr">{faDigits(x.serial_no ?? x.sayad_no ?? "")}</span>
                    <span>{x.bank_name ?? ""}</span>
                    <span className="font-semibold">{x.party_name ?? "—"}</span>
                    <Money v={x.amount} />
                    <StatusTag s={x.status} map={chequeStatusMap(x.direction)} />
                    {x.bank_account_name ? <span className="text-muted">{x.bank_account_name}</span> : null}
                  </button>
                ))}
            </div>
          ),
        }}
        columns={[
          { key: "date", dataIndex: "due_date", title: "سررسید", render: (v) => <span className={d && v < d.today ? "font-bold text-bad" : ""}><JDate v={v} style="full" /></span> },
          { key: "in", title: "دریافتنی", align: "left", render: (_, r: any) => cell(r.received, "text-ok") },
          { key: "out", title: "پرداختنی", align: "left", render: (_, r: any) => cell(r.issued, "text-bad") },
          { key: "net", dataIndex: "net", title: "خالص روز", align: "left", render: (v) => <Money v={v} colored parens /> },
          { key: "cum", dataIndex: "cumulative", title: "خالص تجمعی", align: "left", render: (v) => (D(v).isZero() ? <span className="text-muted">—</span> : <Money v={v} colored parens />) },
        ]}
      />
    </div>
  );
}
