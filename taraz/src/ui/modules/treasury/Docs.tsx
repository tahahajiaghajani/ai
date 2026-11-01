// Lists of receipts (دریافت‌ها), payments (پرداخت‌ها) and transfers (انتقال وجه) of the fiscal year.
import { useState } from "react";
import { Button, Input, Space, Tag, Tooltip } from "antd";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { useDebounced, useHotkey } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { ServerTable } from "../../components/data";
import { Money, JDate } from "../../components/display";
import { DateInput, PartySelect } from "../../components/inputs";
import { faDigits } from "@shared/format";
import { formatJalali, presetRange } from "@shared/jalali";
import { D } from "@shared/money";
import { KIND_PLURAL, KIND_TITLE, METHOD_COLOR, METHOD_SHORT, type DocKind, type Method } from "./labels";

export default function TreasuryDocs({ kind }: { kind: DocKind }) {
  const { fy, orgId, can, api } = useOrg();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [partyId, setPartyId] = useState<string | null>(null);
  const dq = useDebounced(q);
  const params = { kind, fiscal_year_id: fy?.id, q: dq, from, to, party_id: partyId };
  // the filter's count and total (the table itself pages)
  const head = useQuery({
    queryKey: ["table", "treasury-docs-sum", params],
    queryFn: () => api.get<{ total: number; sum: string }>("/treasury/docs", { ...params, size: 1 }),
  });
  const canEdit = can("treasury", "edit");
  const newDoc = () => nav(`/${orgId}/treasury/docs/new?kind=${kind}`);
  useHotkey("alt+n", () => canEdit && newDoc(), [canEdit, kind]);
  const transfer = kind === "transfer";
  const today = presetRange("today");

  return (
    <div>
      <PageHeader
        title={KIND_PLURAL[kind]}
        subtitle={fy ? `${fy.title} · از ${formatJalali(fy.start_date)} تا ${formatJalali(fy.end_date)}` : undefined}
        extra={
          head.data ? (
            <Tag variant="filled" color="cyan" className="!m-0">
              {faDigits(head.data.total)} سند · جمع <Money v={head.data.sum} />
            </Tag>
          ) : null
        }
        actions={
          canEdit ? (
            <Tooltip title="Alt+N">
              <Button type="primary" icon={<PlusOutlined />} onClick={newDoc}>
                {KIND_TITLE[kind]} جدید
              </Button>
            </Tooltip>
          ) : null
        }
      />
      <div className="tz-card p-3 md:p-4">
        <ServerTable
          path="/treasury/docs"
          queryKey={["table", "treasury-docs"]}
          params={params}
          onRowClick={(r: any) => nav(`/${orgId}/treasury/docs/${r.id}`)}
          exportName={KIND_PLURAL[kind]}
          exportColumns={[
            { title: "شماره", value: (r: any) => r.no, type: "number" },
            { title: "تاریخ", value: (r: any) => formatJalali(r.date, { latin: true }) },
            ...(transfer
              ? [{ title: "از", value: (r: any) => r.from_name }, { title: "به", value: (r: any) => r.to_name }]
              : [{ title: kind === "receipt" ? "دریافت از" : "پرداخت به", value: (r: any) => r.party_name ?? r.account_name }]),
            { title: "شرح", value: (r: any) => r.description },
            { title: "مبلغ", value: (r: any) => r.total, type: "number" as const },
            { title: "کارمزد", value: (r: any) => r.fees, type: "number" as const },
            { title: "سند حسابداری", value: (r: any) => r.voucher_no, type: "number" as const },
          ]}
          toolbar={
            <Space wrap>
              <Input
                allowClear
                prefix={<SearchOutlined className="text-muted" />}
                placeholder="شماره، شرح، شخص، پیگیری یا سریال چک"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="!w-64"
              />
              {!transfer ? <PartySelect value={partyId} onChange={setPartyId} allowClear placeholder="شخص" className="!w-56" /> : null}
              <DateInput value={from} onChange={setFrom} placeholder="از تاریخ" allowClear className="!w-36" />
              <DateInput value={to} onChange={setTo} placeholder="تا تاریخ" allowClear className="!w-36" />
              <Button
                type={from === today.from && to === today.to ? "primary" : "default"}
                ghost={from === today.from && to === today.to}
                onClick={() => {
                  setFrom(today.from);
                  setTo(today.to);
                }}
              >
                امروز
              </Button>
            </Space>
          }
          columns={[
            { key: "no", dataIndex: "no", title: "شماره", width: 80, sorter: true, render: (v) => <b className="num">{faDigits(v)}</b> },
            { key: "date", dataIndex: "date", title: "تاریخ", width: 110, sorter: true, render: (v) => <JDate v={v} /> },
            ...(transfer
              ? [
                  { key: "from", dataIndex: "from_name", title: "از", render: (v: string) => v ?? <span className="text-muted">—</span> },
                  { key: "to", dataIndex: "to_name", title: "به", render: (v: string) => v ?? <span className="text-muted">—</span> },
                ]
              : [
                  {
                    key: "party_name",
                    dataIndex: "party_name",
                    title: kind === "receipt" ? "دریافت از" : "پرداخت به",
                    sorter: true,
                    render: (_: unknown, r: any) => (
                      <span>
                        {r.party_name ?? r.account_name ?? "—"}
                        {r.party_name && r.account_name ? <span className="ms-1 text-xs text-muted">({r.account_name})</span> : null}
                      </span>
                    ),
                  },
                  {
                    key: "methods",
                    dataIndex: "methods",
                    title: "روش",
                    render: (v: Method[], r: any) => (
                      <span className="flex flex-wrap gap-1">
                        {(v ?? []).map((m) => (
                          <Tag key={m} variant="filled" color={METHOD_COLOR[m]} className="!m-0">
                            {METHOD_SHORT[m] ?? m}
                            {m === "cheque" && r.cheque_count > 1 ? ` ×${faDigits(r.cheque_count)}` : ""}
                          </Tag>
                        ))}
                      </span>
                    ),
                  },
                ]),
            { key: "description", dataIndex: "description", title: "شرح", ellipsis: true },
            { key: "total", dataIndex: "total", title: "مبلغ", align: "left", width: 160, sorter: true, render: (v) => <Money v={v} /> },
            {
              key: "fees",
              dataIndex: "fees",
              title: "کارمزد",
              align: "left",
              width: 110,
              render: (v) => (D(v).isZero() ? <span className="text-muted">—</span> : <Money v={v} />),
            },
            {
              key: "voucher",
              dataIndex: "voucher_no",
              title: "سند",
              width: 70,
              render: (v) => (v ? <span className="num text-muted">{faDigits(v)}</span> : <span className="text-muted">—</span>),
            },
            { key: "by", dataIndex: "created_by_name", title: "ثبت‌کننده", width: 130, render: (v) => <span className="text-muted">{v ?? "—"}</span> },
          ]}
        />
      </div>
    </div>
  );
}
