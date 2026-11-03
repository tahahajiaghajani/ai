// Lists of receipts (دریافت‌ها), payments (پرداخت‌ها) and transfers (انتقال وجه) of the fiscal year.
// «شرح» has no width of its own: it takes what the fixed columns leave, at least 220 px (scrollX = their sum + 220).
import { useState } from "react";
import { Button, Input } from "antd";
import { Plus, Search, CalendarCheck, ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight } from "lucide-react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { useDebounced, useHotkey } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { ServerTable } from "../../components/data";
import { JDate, EmptyState } from "../../components/display";
import { DateInput, PartySelect } from "../../components/inputs";
import { faDigits } from "@shared/format";
import { formatJalali, presetRange } from "@shared/jalali";
import { D } from "@shared/money";
import { Amt, BtnKeys, DocNo, ICON, Who } from "../reports/kit";
import { KIND_PLURAL, KIND_TITLE, METHOD_SHORT, type DocKind, type Method } from "./labels";

const ICONS = { receipt: ArrowDownToLine, payment: ArrowUpFromLine, transfer: ArrowLeftRight };

export default function TreasuryDocs({ kind }: { kind: DocKind }) {
  const { fy, orgId, can, api, unit } = useOrg();
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
  const isToday = from === today.from && to === today.to;
  const filtered = !!(dq || from || to || partyId);
  const Icon = ICONS[kind];

  return (
    <div>
      <PageHeader
        title={KIND_PLURAL[kind]}
        subtitle={
          head.data ? (
            <span className="sf-num">
              {faDigits(head.data.total)} سند، جمع <Amt v={head.data.sum} /> {unit}
            </span>
          ) : fy ? (
            fy.title
          ) : undefined
        }
        actions={
          canEdit ? (
            <Button type="primary" icon={<Plus {...ICON} />} onClick={newDoc}>
              {KIND_TITLE[kind]} جدید
              <BtnKeys k={["Alt", "N"]} />
            </Button>
          ) : null
        }
      />
      <div className="sf-card">
        <ServerTable
          path="/treasury/docs"
          queryKey={["table", "treasury-docs"]}
          params={params}
          scrollX={transfer ? 1120 : 1116}
          onRowClick={(r: any) => nav(`/${orgId}/treasury/docs/${r.id}`)}
          filtered={filtered}
          onClearFilters={() => {
            setQ("");
            setFrom(null);
            setTo(null);
            setPartyId(null);
          }}
          empty={
            <EmptyState
              icon={Icon}
              title={kind === "receipt" ? "هنوز دریافتی ثبت نشده" : kind === "payment" ? "هنوز پرداختی ثبت نشده" : "هنوز انتقالی ثبت نشده"}
              description={transfer ? "جابه‌جایی وجه میان صندوق‌ها و حساب‌های بانکی اینجا می‌آید." : "نقد، کارتخوان، واریز بانکی و چک، با سند حسابداری خودکار."}
              action={canEdit ? <Button type="primary" icon={<Plus {...ICON} />} onClick={newDoc}>{KIND_TITLE[kind]} جدید</Button> : undefined}
            />
          }
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
            <>
              <Input allowClear prefix={<Search {...ICON} className="bk-3" />} placeholder="شماره، شرح، شخص، پیگیری یا سریال چک" value={q} onChange={(e) => setQ(e.target.value)} className="!w-72" />
              {!transfer ? <PartySelect value={partyId} onChange={setPartyId} allowClear placeholder="شخص" className="!w-52" /> : null}
              <span className="bk-range">
                <DateInput value={from} onChange={setFrom} placeholder="از تاریخ" allowClear />
                <span>تا</span>
                <DateInput value={to} onChange={setTo} placeholder="تا تاریخ" allowClear />
              </span>
              <button
                type="button"
                className="bk-tog"
                aria-pressed={isToday}
                onClick={() => {
                  if (isToday) {
                    setFrom(null);
                    setTo(null);
                  } else {
                    setFrom(today.from);
                    setTo(today.to);
                  }
                }}
              >
                <CalendarCheck {...ICON} aria-hidden />
                امروز
              </button>
            </>
          }
          columns={[
            { key: "no", dataIndex: "no", title: "شماره", width: 80, sorter: true, render: (v) => <DocNo n={v} /> },
            { key: "date", dataIndex: "date", title: "تاریخ", width: 104, sorter: true, render: (v) => <JDate v={v} /> },
            ...(transfer
              ? [
                  { key: "from", dataIndex: "from_name", title: "از", width: 160, ellipsis: true, render: (v: string) => v ?? <span className="sf-zero">—</span> },
                  { key: "to", dataIndex: "to_name", title: "به", width: 160, ellipsis: true, render: (v: string) => v ?? <span className="sf-zero">—</span> },
                ]
              : [
                  {
                    key: "party_name",
                    dataIndex: "party_name",
                    title: kind === "receipt" ? "دریافت از" : "پرداخت به",
                    sorter: true,
                    width: 200,
                    ellipsis: true,
                    render: (_: unknown, r: any) => (r.party_name ? <Who name={r.party_name} sub={r.account_name ? `(${r.account_name})` : undefined} /> : <span className="bk-2">{r.account_name ?? "—"}</span>),
                  },
                  {
                    key: "methods",
                    dataIndex: "methods",
                    title: "روش",
                    width: 104,
                    render: (v: Method[], r: any) => (
                      <span className="bk-2 whitespace-nowrap">
                        {(v ?? []).map((m) => `${METHOD_SHORT[m] ?? m}${m === "cheque" && r.cheque_count > 1 ? ` ×${faDigits(r.cheque_count)}` : ""}`).join("، ")}
                      </span>
                    ),
                  },
                ]),
            { key: "description", dataIndex: "description", title: "شرح", ellipsis: true, render: (v) => <span className="bk-2">{v}</span> },
            { key: "total", dataIndex: "total", title: `مبلغ (${unit})`, className: "sf-num", width: 136, sorter: true, render: (v) => <Amt v={v} colored={kind === "receipt"} /> },
            { key: "fees", dataIndex: "fees", title: "کارمزد", className: "sf-num", width: 104, render: (v) => (D(v).isZero() ? <span className="sf-zero">—</span> : <Amt v={v} />) },
            { key: "voucher", dataIndex: "voucher_no", title: "سند", width: 64, render: (v) => (v ? <span className="bk-3 sf-num">{faDigits(v)}</span> : <span className="sf-zero">—</span>) },
            { key: "by", dataIndex: "created_by_name", title: "ثبت‌کننده", width: 104, ellipsis: true, render: (v) => <span className="bk-3">{v ?? "—"}</span> },
          ]}
        />
      </div>
    </div>
  );
}
