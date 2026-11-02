// Cash & bank book (دفتر صندوق و بانک): balances of every cash box and bank account, and the
// movements of the chosen one with opening balance and running balance. Rows open the treasury
// document, the cheque or the voucher behind them.
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Alert, Segmented, Table, Tag } from "antd";
import { BankOutlined, WalletOutlined } from "@ant-design/icons";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { RefSelect } from "../../components/inputs";
import { Balance, JDate, Money } from "../../components/display";
import { exportExcel } from "../../lib/excel";
import { ReportFilters, useRange } from "../reports/Filters";
import { faDigits, formatNumber } from "@shared/format";
import { formatJalali } from "@shared/jalali";
import { D } from "@shared/money";
import { KIND_TITLE, type DocKind } from "./labels";

type Kind = "cash" | "bank";

export default function Book() {
  const { api, orgId, org } = useOrg();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [kind, setKind] = useState<Kind>(sp.has("bank") ? "bank" : "cash");
  const [id, setId] = useState<string | null>(sp.get("bank") || sp.get("box") || null);
  const [range, setRange] = useRange();
  const bal = useQuery({ queryKey: ["treasury-balances"], queryFn: () => api.get("/treasury/balances") });
  const list: any[] = (kind === "cash" ? bal.data?.boxes : bal.data?.banks) ?? [];

  // pick the first box/bank when nothing is chosen
  useEffect(() => {
    if (!id && list.length) setId(list[0].id);
  }, [id, list]);
  useEffect(() => {
    if (id) setSp(kind === "cash" ? { box: id } : { bank: id }, { replace: true });
  }, [id, kind, setSp]);

  const q = useQuery({
    queryKey: ["treasury-book", kind, id, range],
    queryFn: () => api.get("/treasury/book", { [kind === "cash" ? "cash_box_id" : "bank_account_id"]: id, from: range.from, to: range.to, drafts: range.drafts ? 1 : 0 }),
    enabled: !!id,
  });
  const d = q.data;
  const rows = useMemo(() => {
    if (!d) return [];
    return [{ key: "opening", opening: true, description: "مانده‌ی ابتدای دوره", balance: d.opening }, ...d.rows.map((r: any) => ({ ...r, key: `${r.voucher_id}-${r.line_no}` }))];
  }, [d]);
  const name = d?.account?.name ?? list.find((x) => x.id === id)?.name ?? "";

  const open = (r: any) => {
    if (r.opening) return;
    if (r.doc) nav(`/${orgId}/treasury/docs/${r.doc.id}`);
    else if (r.cheque) nav(`/${orgId}/treasury/cheques${r.cheque.direction === "issued" ? "/issued" : ""}?open=${r.cheque.id}`);
    else nav(`/${orgId}/accounting/vouchers/${r.voucher_id}`);
  };

  return (
    <div>
      <PageHeader title="دفتر صندوق و بانک" />
      <div className="no-print mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <BalanceCard title="جمع صندوق‌ها" icon={<WalletOutlined />} value={bal.data?.cash_total} />
        <BalanceCard title="جمع بانک‌ها" icon={<BankOutlined />} value={bal.data?.bank_total} />
        {(bal.data?.banks ?? []).some((b: any) => D(b.in_collection).gt(0)) ? (
          <BalanceCard
            title="چک‌های در جریان وصول"
            icon={<BankOutlined />}
            value={(bal.data.banks as any[]).reduce((a, b) => a.plus(D(b.in_collection)), D(0)).toString()}
          />
        ) : null}
      </div>
      <div className="no-print mb-4 flex flex-wrap gap-2">
        {list.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => setId(x.id)}
            className={`min-w-40 rounded-xl border px-3 py-2 text-start transition ${x.id === id ? "border-brand bg-brand-soft" : "border-line bg-surface hover:bg-surface-2"} ${x.is_active ? "" : "opacity-60"}`}
          >
            <div className="truncate text-xs text-muted">{x.name}</div>
            <div className="mt-0.5 text-sm font-bold"><Balance v={x.balance} /></div>
            {kind === "bank" && D(x.in_collection).gt(0) ? (
              <div className="text-[11px] text-muted">در جریان وصول: <Money v={x.in_collection} /></div>
            ) : null}
          </button>
        ))}
      </div>
      <div className="tz-card print-sheet p-3 md:p-4">
        <div className="mb-3 hidden text-center print:block">
          <div className="text-lg font-bold">{org.name}</div>
          <div className="text-base font-semibold">{kind === "cash" ? "دفتر صندوق" : "دفتر بانک"} — {name}</div>
          <div className="text-xs">{range.from ? `از ${formatJalali(range.from)}` : ""} {range.to ? `تا ${formatJalali(range.to)}` : ""}</div>
        </div>
        <div className="no-print mb-3 flex flex-wrap items-center gap-2">
          <Segmented
            value={kind}
            onChange={(v) => {
              setKind(v as Kind);
              setId(null);
            }}
            options={[
              { value: "cash", label: "صندوق" },
              { value: "bank", label: "بانک" },
            ]}
          />
          <RefSelect
            key={kind}
            entity={kind === "cash" ? "cash_box" : "bank_account"}
            value={id}
            onChange={(v) => setId(v)}
            className="!w-72"
            placeholder={kind === "cash" ? "صندوق" : "حساب بانکی"}
          />
        </div>
        <ReportFilters range={range} setRange={setRange}>
          {d ? (
            <a
              className="text-xs"
              onClick={() =>
                exportExcel(`${kind === "cash" ? "دفتر صندوق" : "دفتر بانک"} ${name}`, [
                  { title: "تاریخ", value: (r: any) => (r.opening ? "" : formatJalali(r.date, { latin: true })) },
                  { title: "سند", value: (r: any) => r.no ?? "", type: "number" },
                  { title: "مرجع", value: (r: any) => (r.doc ? `${KIND_TITLE[r.doc.kind as DocKind] ?? ""} ${r.doc.no}` : "") },
                  { title: "شرح", value: (r: any) => r.description },
                  { title: "دریافت", value: (r: any) => r.debit ?? "", type: "number" },
                  { title: "پرداخت", value: (r: any) => r.credit ?? "", type: "number" },
                  { title: "مانده", value: (r: any) => r.balance, type: "number" },
                ], rows)
              }
            >
              خروجی اکسل
            </a>
          ) : null}
        </ReportFilters>
        {!id ? (
          <Alert type="info" showIcon title={kind === "cash" ? "صندوق را انتخاب کنید" : "حساب بانکی را انتخاب کنید"} />
        ) : (
          <>
            {d && kind === "bank" && (d.in_collection?.count || d.issued_open?.count) ? (
              <div className="no-print mb-2 flex flex-wrap gap-2 text-xs">
                {d.in_collection?.count ? (
                  <Tag variant="filled" color="warning">
                    {faDigits(d.in_collection.count)} چک در جریان وصول: <Money v={d.in_collection.sum} />
                  </Tag>
                ) : null}
                {d.issued_open?.count ? (
                  <Tag variant="filled" color="gold">
                    {faDigits(d.issued_open.count)} چک صادره‌ی پاس‌نشده: <Money v={d.issued_open.sum} />
                  </Tag>
                ) : null}
              </div>
            ) : null}
            {d?.truncated ? (
              <Alert
                className="!mb-2"
                type="warning"
                showIcon
                title={`فقط ${formatNumber(d.rows.length)} ردیف نخست آمده است؛ جمع دوره و مانده‌ی پایان آن کامل است. برای دیدن بقیه، بازه‌ی تاریخ را کوتاه‌تر کنید.`}
              />
            ) : null}
            <Table
              className="tz-table"
              size="small"
              rowKey="key"
              loading={q.isLoading}
              dataSource={rows}
              pagination={{ pageSize: 200, hideOnSinglePage: true, size: "small" }}
              scroll={{ x: "max-content" }}
              onRow={(r: any) => ({ onClick: () => open(r), style: { cursor: r.opening ? "default" : "pointer" } })}
              rowClassName={(r: any) => (r.opening ? "row-level-2" : "")}
              columns={[
                { key: "date", dataIndex: "date", title: "تاریخ", width: 100, render: (v, r: any) => (r.opening ? null : <JDate v={v} />) },
                { key: "no", dataIndex: "no", title: "سند", width: 70, render: (v) => (v ? <span className="num text-muted">{faDigits(v)}</span> : null) },
                {
                  key: "ref",
                  title: "مرجع",
                  width: 130,
                  render: (_, r: any) =>
                    r.doc ? (
                      <Tag variant="filled" className="!m-0">{KIND_TITLE[r.doc.kind as DocKind] ?? "سند"} {faDigits(r.doc.no)}</Tag>
                    ) : r.cheque ? (
                      <Tag variant="filled" color="gold" className="!m-0">چک {faDigits(r.cheque.serial_no ?? "")}</Tag>
                    ) : r.opening ? null : (
                      <span className="text-xs text-muted">سند دستی</span>
                    ),
                },
                { key: "desc", dataIndex: "description", title: "شرح", ellipsis: true, render: (v, r: any) => (r.opening ? <b>{v}</b> : v) },
                { key: "dr", dataIndex: "debit", title: "دریافت (بدهکار)", align: "left", render: (v) => (v ? <Money v={v} zero="" /> : null) },
                { key: "cr", dataIndex: "credit", title: "پرداخت (بستانکار)", align: "left", render: (v) => (v ? <Money v={v} zero="" /> : null) },
                { key: "bal", dataIndex: "balance", title: "مانده", align: "left", render: (v) => <Balance v={v} /> },
              ]}
              summary={() =>
                d ? (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={4}>جمع دوره</Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="left"><Money v={d.totals.debit} /></Table.Summary.Cell>
                    <Table.Summary.Cell index={2} align="left"><Money v={d.totals.credit} /></Table.Summary.Cell>
                    <Table.Summary.Cell index={3} align="left"><Balance v={d.totals.balance} /></Table.Summary.Cell>
                  </Table.Summary.Row>
                ) : null
              }
            />
          </>
        )}
      </div>
    </div>
  );
}

function BalanceCard({ title, value, icon }: { title: string; value: string | undefined; icon: React.ReactNode }) {
  return (
    <div className="tz-card flex items-start gap-3 p-4">
      <div className="grid h-10 w-10 shrink-0 place-content-center rounded-xl bg-brand-soft text-lg text-brand">{icon}</div>
      <div className="min-w-0">
        <div className="text-xs text-muted">{title}</div>
        <div className="mt-1 text-lg font-bold">{value !== undefined ? <Balance v={value} /> : "…"}</div>
      </div>
    </div>
  );
}
