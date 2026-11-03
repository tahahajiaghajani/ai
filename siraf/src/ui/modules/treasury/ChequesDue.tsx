// Cheques by due date (سررسید چک‌ها): open received cheques (in hand / in collection) and open
// issued cheques grouped by due date with the net cash flow and its running total — what comes
// in and goes out of the bank in the coming days.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Segmented, Table, Tooltip } from "antd";
import { Printer } from "lucide-react";
import { useOrg } from "../../lib/org";
import { DateInput } from "../../components/inputs";
import { Chip, EmptyState, JDate, StatusTag } from "../../components/display";
import { ChequeIcon } from "../../components/shell/icons";
import { faDigits, formatNumber } from "@shared/format";
import { formatJalali } from "@shared/jalali";
import { D } from "@shared/money";
import { chequeStatusMap } from "./labels";
import { Amt, Card, ICON, Note, PrintFoot, PrintHead, Who, docNo } from "../reports/kit";
import { AiExplainButton } from "../../ai/explain/AiExplainButton";

interface Agg {
  count: number;
  sum: string;
}

export function ChequesDue({ onOpen }: { onOpen: (id: string) => void }) {
  const { api, unit } = useOrg();
  const [direction, setDirection] = useState<string>("");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["treasury-due", direction, from, to],
    queryFn: () => api.get("/treasury/reports/cheques-due", { direction, from, to }),
  });
  const d = q.data;
  const rows = (d?.rows ?? []) as any[];
  const cell = (a: Agg | undefined, colored?: boolean) =>
    a && a.count ? (
      <span className="sf-num">
        <Amt v={a.sum} colored={colored} /> <span className="bk-3">({faDigits(a.count)})</span>
      </span>
    ) : (
      <span className="sf-zero">—</span>
    );

  return (
    <div>
      <div className="bk-filters no-print">
        <Segmented
          value={direction}
          onChange={(v) => setDirection(String(v))}
          options={[
            { value: "", label: "همه" },
            { value: "received", label: "دریافتنی" },
            { value: "issued", label: "پرداختنی" },
          ]}
        />
        <span className="bk-range">
          <DateInput value={from} onChange={setFrom} placeholder="سررسید از" allowClear />
          <span>تا</span>
          <DateInput value={to} onChange={setTo} placeholder="سررسید تا" allowClear />
        </span>
        <div className="bk-end">
          <AiExplainButton report="cheques_due" params={{ direction, from, to }} title="سررسید چک‌ها" compact />
          <Tooltip title="چاپ">
            <Button type="text" icon={<Printer {...ICON} />} onClick={() => window.print()} aria-label="چاپ" />
          </Tooltip>
        </div>
      </div>
      <PrintHead title="سررسید چک‌ها" lines={d ? [`تا ${formatJalali(d.today)}`] : undefined} />
      <div className="bk-due no-print mb-4">
        {(d?.buckets ?? []).map((b: any) => {
          const hot = b.key === "overdue" && (b.received.count || b.issued.count);
          return (
            <div key={b.key} className="bk-due-t" data-tone={hot ? "danger" : undefined}>
              <div className="bk-due-h">
                <i className="sf-nuqta" aria-hidden />
                {b.label}
              </div>
              <div className="bk-due-r">
                <span>دریافتنی</span>
                {cell(b.received, true)}
              </div>
              <div className="bk-due-r">
                <span>پرداختنی</span>
                {cell(b.issued)}
              </div>
              <div className="bk-due-r is-net">
                <span>خالص</span>
                <Amt v={b.net} colored />
              </div>
            </div>
          );
        })}
      </div>
      {d?.truncated ? (
        <Note tone="warning" className="mb-3">
          <b>فقط {formatNumber(rows.length)} چک نخست</b> در جزئیات روزها آمده است؛ جمع‌ها همهٔ چک‌ها را در بر دارد. برای دیدن بقیه، بازهٔ سررسید را کوتاه‌تر کنید.
        </Note>
      ) : null}
      <Card title="به تفکیک روز" meta={<span className="bk-cap">مبالغ به {unit}</span>} flush>
        <Table
          className="bk-tbl"
          size="small"
          rowKey="due_date"
          loading={q.isLoading}
          dataSource={d?.by_date ?? []}
          pagination={{ pageSize: 100, hideOnSinglePage: true, size: "small" }}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: q.isLoading ? " " : <EmptyState icon={ChequeIcon} title="چک بازی با این سررسید نیست" /> }}
          expandable={{
            expandedRowRender: (r: any) => (
              <div className="bk-due-list">
                {rows
                  .filter((x) => x.due_date === r.due_date)
                  .map((x) => (
                    <button key={x.id} type="button" onClick={() => onOpen(x.id)} className="bk-due-i">
                      <span className="bk-plain">{x.direction === "received" ? "دریافتی" : "پرداختی"}</span>
                      <span className="bk-docno">{docNo(x.serial_no ?? x.sayad_no ?? "")}</span>
                      <span className="bk-2">{x.bank_name ?? ""}</span>
                      <Who name={x.party_name} />
                      <Amt v={x.amount} colored={x.direction === "received"} />
                      <StatusTag s={x.status} map={chequeStatusMap(x.direction)} />
                      {x.bank_account_name ? <span className="bk-3">{x.bank_account_name}</span> : null}
                    </button>
                  ))}
              </div>
            ),
          }}
          columns={[
            {
              key: "date",
              dataIndex: "due_date",
              title: "سررسید",
              render: (v) => (
                <span className="inline-flex items-center gap-2">
                  <JDate v={v} style="full" />
                  {d && v < d.today ? <Chip tone="danger">گذشته</Chip> : null}
                </span>
              ),
            },
            { key: "in", title: "دریافتنی", className: "sf-num", width: 192, render: (_, r: any) => cell(r.received, true) },
            { key: "out", title: "پرداختنی", className: "sf-num", width: 192, render: (_, r: any) => cell(r.issued) },
            { key: "net", dataIndex: "net", title: "خالص روز", className: "sf-num", width: 160, render: (v) => <Amt v={v} colored /> },
            { key: "cum", dataIndex: "cumulative", title: "خالص تجمعی", className: "sf-num", width: 160, render: (v) => (D(v).isZero() ? <span className="sf-zero">—</span> : <Amt v={v} />) },
          ]}
        />
        <PrintFoot />
      </Card>
    </div>
  );
}
