// Cash & bank book (دفتر صندوق و بانک): balances of every cash box and bank account, and the movements of the
// chosen one with its opening balance and a running «مانده» with «تشخیص». Rows open the treasury document, the
// cheque or the voucher behind them.
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Segmented, Table } from "antd";
import { Landmark, Wallet } from "lucide-react";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Balance, EmptyState, JDate, Money, StatCard } from "../../components/display";
import { ChequeIcon } from "../../components/shell/icons";
import { exportExcel } from "../../lib/excel";
import { ReportFilters, useRange } from "../reports/Filters";
import { Amt, Card, ICON, ICON14, Note, Period, PrintFoot, PrintHead, cx, docNo } from "../reports/kit";
import { faDigits, formatNumber } from "@shared/format";
import { formatJalali } from "@shared/jalali";
import { D } from "@shared/money";
import { KIND_TITLE, type DocKind } from "./labels";

type Kind = "cash" | "bank";

/** A KPI figure in «ریال» (`.sf-unit`); its side (بدهکار / بستانکار) goes in the caption, never as a «بد» suffix. */
function KpiMoney({ v }: { v: string | number | null | undefined }) {
  const d = D(v ?? 0);
  return d.isZero() ? <span className="sf-zero">—</span> : <Money v={d.abs().toString()} unit />;
}
const sideWord = (v: string | number | null | undefined) => {
  const d = D(v ?? 0);
  return d.isZero() ? "" : d.gt(0) ? "، بدهکار" : "، بستانکار";
};

export default function Book() {
  const { api, orgId, unit } = useOrg();
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
    return [{ key: "opening", opening: true, description: "ماندهٔ ابتدای دوره", balance: d.opening }, ...d.rows.map((r: any) => ({ ...r, key: `${r.voucher_id}-${r.line_no}` }))];
  }, [d]);
  const name = d?.account?.name ?? list.find((x) => x.id === id)?.name ?? "";

  const open = (r: any) => {
    if (r.opening) return;
    if (r.doc) nav(`/${orgId}/treasury/docs/${r.doc.id}`);
    else if (r.cheque) nav(`/${orgId}/treasury/cheques${r.cheque.direction === "issued" ? "/issued" : ""}?open=${r.cheque.id}`);
    else nav(`/${orgId}/accounting/vouchers/${r.voucher_id}`);
  };

  const side = (v: string | null | undefined) => {
    const x = D(v ?? 0);
    return x.isZero() ? "—" : x.gt(0) ? "بد" : "بس";
  };
  const inCollection = (bal.data?.banks ?? []).reduce((a: any, b: any) => a.plus(D(b.in_collection)), D(0));

  return (
    <div>
      <PageHeader title="دفتر صندوق و بانک" />
      <div className="no-print mb-4 grid sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          title="جمع صندوق‌ها"
          icon={<Wallet {...ICON} />}
          value={bal.data ? <KpiMoney v={bal.data.cash_total} /> : "…"}
          hint={`${faDigits((bal.data?.boxes ?? []).length)} صندوق${sideWord(bal.data?.cash_total)}`}
        />
        <StatCard
          title="جمع بانک‌ها"
          icon={<Landmark {...ICON} />}
          value={bal.data ? <KpiMoney v={bal.data.bank_total} /> : "…"}
          hint={`${faDigits((bal.data?.banks ?? []).length)} حساب بانکی${sideWord(bal.data?.bank_total)}`}
        />
        <StatCard title="چک‌های در جریان وصول" icon={<ChequeIcon {...ICON} />} value={bal.data ? <KpiMoney v={inCollection.toString()} /> : "…"} hint="واگذارشده به بانک" />
      </div>

      <div className="bk-filters no-print">
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
      </div>
      {list.length ? (
        <div className="bk-tiles is-cards no-print mb-4" role="group" aria-label={kind === "cash" ? "صندوق‌ها" : "حساب‌های بانکی"}>
          {list.map((x) => (
            <button key={x.id} type="button" className={cx("bk-tile", !x.is_active && "is-empty")} aria-pressed={x.id === id} onClick={() => setId(x.id)}>
              <small>
                {kind === "cash" ? <Wallet {...ICON14} aria-hidden /> : <Landmark {...ICON14} aria-hidden />}
                <span className="truncate">{x.name}</span>
              </small>
              <b><Balance v={x.balance} /></b>
              <span>{kind === "bank" && D(x.in_collection).gt(0) ? <>در جریان وصول <Amt v={x.in_collection} /></> : x.is_active ? " " : "غیرفعال"}</span>
            </button>
          ))}
        </div>
      ) : null}

      <ReportFilters
        range={range}
        setRange={setRange}
        onExport={
          d
            ? () =>
                exportExcel(`${kind === "cash" ? "دفتر صندوق" : "دفتر بانک"} ${name}`, [
                  { title: "تاریخ", value: (r: any) => (r.opening ? "" : formatJalali(r.date, { latin: true })) },
                  { title: "سند", value: (r: any) => r.no ?? "", type: "number" },
                  { title: "مرجع", value: (r: any) => (r.doc ? `${KIND_TITLE[r.doc.kind as DocKind] ?? ""} ${r.doc.no}` : "") },
                  { title: "شرح", value: (r: any) => r.description },
                  { title: "دریافت", value: (r: any) => r.debit ?? "", type: "number" },
                  { title: "پرداخت", value: (r: any) => r.credit ?? "", type: "number" },
                  { title: "مانده", value: (r: any) => r.balance, type: "number" },
                ], rows)
            : undefined
        }
      />

      {!id ? (
        <Card>
          <EmptyState icon={kind === "cash" ? Wallet : Landmark} title={kind === "cash" ? "صندوقی انتخاب نشده" : "حساب بانکی انتخاب نشده"} description={list.length ? "یکی را از بالا انتخاب کنید." : kind === "cash" ? "هنوز صندوقی تعریف نشده است." : "هنوز حساب بانکی تعریف نشده است."} />
        </Card>
      ) : (
        <Card
          title={name || (kind === "cash" ? "دفتر صندوق" : "دفتر بانک")}
          meta={
            <>
              <Period from={range.from} to={range.to} />
              <span className="bk-cap">مبالغ به {unit}</span>
            </>
          }
          flush
        >
          <PrintHead title={`${kind === "cash" ? "دفتر صندوق" : "دفتر بانک"}، ${name}`} lines={[`${range.from ? `از ${formatJalali(range.from)} ` : ""}${range.to ? `تا ${formatJalali(range.to)}` : ""}`]} />
          {d ? (
            <div className="bk-strip">
              <div>
                <small>ماندهٔ ابتدای دوره</small>
                <b><Balance v={d.opening} /></b>
              </div>
              <div>
                <small>دریافت</small>
                <b><Amt v={d.totals.debit} colored /></b>
              </div>
              <div>
                <small>پرداخت</small>
                <b><Amt v={d.totals.credit} /></b>
              </div>
              <div>
                <small>ماندهٔ پایان دوره</small>
                <b><Balance v={d.totals.balance} /></b>
              </div>
              {kind === "bank" && d.in_collection?.count ? (
                <div>
                  <small>{faDigits(d.in_collection.count)} چک در جریان وصول</small>
                  <b><Amt v={d.in_collection.sum} /></b>
                </div>
              ) : null}
              {kind === "bank" && d.issued_open?.count ? (
                <div>
                  <small>{faDigits(d.issued_open.count)} چک صادرهٔ پاس‌نشده</small>
                  <b><Amt v={d.issued_open.sum} /></b>
                </div>
              ) : null}
            </div>
          ) : null}
          {d?.truncated ? (
            <div className="px-5 pb-3">
              <Note tone="warning">
                <b>فقط {formatNumber(d.rows.length)} ردیف نخست</b> آمده است؛ جمع دوره و ماندهٔ پایان آن کامل است. برای دیدن بقیه، بازهٔ تاریخ را کوتاه‌تر کنید.
              </Note>
            </div>
          ) : null}
          <Table
            className="bk-tbl"
            size="small"
            rowKey="key"
            loading={q.isLoading}
            dataSource={rows}
            pagination={{ pageSize: 200, hideOnSinglePage: true, size: "small", showSizeChanger: false }}
            scroll={{ x: 104 + 64 + 128 + 240 + 136 * 3 + 80 }}
            tableLayout="fixed"
            sticky={{ offsetHeader: 56 }}
            onRow={(r: any) => (r.opening ? {} : { onClick: () => open(r), onKeyDown: (e) => e.key === "Enter" && open(r), tabIndex: 0 })}
            rowClassName={(r: any) => (r.opening ? "bk-open" : "bk-click")}
            columns={[
              { key: "date", dataIndex: "date", title: "تاریخ", width: 104, render: (v, r: any) => (r.opening ? null : <JDate v={v} />) },
              { key: "no", dataIndex: "no", title: "سند", width: 64, render: (v) => (v ? <span className="bk-3 sf-num">{faDigits(v)}</span> : null) },
              {
                key: "ref",
                title: "مرجع",
                width: 128,
                render: (_, r: any) =>
                  r.doc ? (
                    <span className="bk-docno">{KIND_TITLE[r.doc.kind as DocKind] ?? "سند"} {docNo(r.doc.no)}</span>
                  ) : r.cheque ? (
                    <span className="bk-docno">چک {docNo(r.cheque.serial_no ?? "")}</span>
                  ) : r.opening ? null : (
                    <span className="bk-plain">سند دستی</span>
                  ),
              },
              { key: "desc", dataIndex: "description", title: "شرح", ellipsis: true, render: (v, r: any) => (r.opening ? v : <span className="bk-2">{v}</span>) },
              { key: "dr", dataIndex: "debit", title: "دریافت", className: "sf-num", width: 136, render: (v) => (v ? <Amt v={v} zero="" colored /> : null) },
              { key: "cr", dataIndex: "credit", title: "پرداخت", className: "sf-num", width: 136, render: (v) => (v ? <Amt v={v} zero="" /> : null) },
              { key: "bal", dataIndex: "balance", title: "مانده", className: "sf-num", width: 136, render: (v) => <Amt v={D(v ?? 0).abs().toString()} /> },
              { key: "side", dataIndex: "balance", title: "تشخیص", width: 80, render: (v) => <span className="bk-plain">{side(v)}</span> },
            ]}
            summary={() =>
              d ? (
                <Table.Summary fixed>
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={4} className="bk-sum-l">
                      جمع دوره<small>{faDigits(d.rows.length)} ردیف</small>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={1} className="sf-num"><Amt v={d.totals.debit} /></Table.Summary.Cell>
                    <Table.Summary.Cell index={2} className="sf-num"><Amt v={d.totals.credit} /></Table.Summary.Cell>
                    <Table.Summary.Cell index={3} className="sf-num"><Amt v={D(d.totals.balance).abs().toString()} /></Table.Summary.Cell>
                    <Table.Summary.Cell index={4}><span className="bk-plain">{side(d.totals.balance)}</span></Table.Summary.Cell>
                  </Table.Summary.Row>
                </Table.Summary>
              ) : null
            }
          />
          <PrintFoot sign={["صندوقدار", "حسابدار"]} />
        </Card>
      )}
    </div>
  );
}
