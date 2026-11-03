// Balances of subsidiaries (ماندهٔ اشخاص و تفصیلی‌ها): debtors and creditors at a date, per currency and gold weight.
import { useMemo, useState } from "react";
import { Input, Segmented, Select, Table } from "antd";
import { Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Amount, Weight, JDate, EmptyState } from "../../components/display";
import { AccountSelect } from "../../components/inputs";
import { ReportFilters, ReportTitle, useRange } from "./Filters";
import { Amt, Card, ICON, PrintFoot, ScalePicker, ScaleProvider, Who, cx, unitCaption, useScale } from "./kit";
import { faDigits } from "@shared/format";
import { formatJalali } from "@shared/jalali";
import { D } from "@shared/money";
import { matchesFa } from "../../lib/fa";
import { DETAIL_KINDS } from "../accounting/labels";
import { exportExcel } from "../../lib/excel";
import { AiExplainButton } from "../../ai/explain/AiExplainButton";
import { usePrinting } from "../../lib/print";

export default function DetailBalances() {
  const printing = usePrinting(); // antd's sticky header would print as its own, misaligned table
  const { api, fy, orgId, unit, org } = useOrg();
  const base = org.base_currency ?? "IRR";
  const nav = useNavigate();
  const [range, setRange] = useRange();
  const [kind, setKind] = useState<string | undefined>("person");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [only, setOnly] = useState<"all" | "debtors" | "creditors">("all");
  const [search, setSearch] = useState("");
  const [scale, setScale] = useScale();
  const q = useQuery({
    queryKey: ["detail-bal", kind, accountId, range.to, range.drafts, fy?.id],
    queryFn: () => api.get("/accounting/reports/detail-balances", { kind, account_id: accountId, to: range.to, fiscal_year_id: fy?.id, drafts: range.drafts ? 1 : 0 }).then((r) => r.rows as any[]),
  });
  const rows = (q.data ?? []).filter((r) => {
    const b = D(r.balance);
    if (only === "debtors" && !b.gt(0)) return false;
    if (only === "creditors" && !b.lt(0)) return false;
    return !search || matchesFa(`${r.name} ${r.code}`, search);
  });
  const sums = useMemo(
    () =>
      rows.reduce((a, r) => {
          const b = D(r.balance);
          return b.gt(0) ? { ...a, dr: a.dr.plus(b) } : { ...a, cr: a.cr.plus(b.abs()) };
        }, { dr: D(0), cr: D(0) }),
    [rows],
  );
  // «ارز» and «ماندهٔ ارزی» only when a row is in a currency other than the base one; «وزنی» only when a row has weight
  const foreign = (r: any) => !!r.currency_code && r.currency_code !== base;
  const hasCur = rows.some(foreign);
  const hasFx = rows.some((r) => foreign(r) && !D(r.fx_balance).isZero());
  const hasW = rows.some((r) => !D(r.w_balance).isZero());

  return (
    <div>
      <PageHeader title="ماندهٔ اشخاص و تفصیلی‌ها" actions={<AiExplainButton report="detail_balances" params={{ to: range.to, kind, account_id: accountId, fiscal_year_id: fy?.id, drafts: range.drafts ? 1 : 0 }} title="ماندهٔ اشخاص و تفصیلی‌ها" />} />
      <ReportFilters
        range={range}
        setRange={setRange}
        noFrom
        onExport={() =>
          exportExcel("مانده تفصیلی ها", [
            { title: "کد", value: (r: any) => r.code },
            { title: "نام", value: (r: any) => r.name },
            { title: "ارز", value: (r: any) => r.currency_code ?? "" },
            { title: "مانده", value: (r: any) => r.balance, type: "number" },
            { title: "مانده ارزی", value: (r: any) => r.fx_balance, type: "number" },
            { title: "وزن", value: (r: any) => r.w_balance, type: "number" },
          ], rows)
        }
      >
        <Select value={kind} onChange={setKind} allowClear placeholder="نوع تفصیلی" className="!w-36" options={DETAIL_KINDS} />
        <AccountSelect value={accountId} onChange={setAccountId} allowClear placeholder="فقط زیر این حساب" className="!w-60" />
      </ReportFilters>
      <ScaleProvider scale={scale}>
        <Card
          title="مانده‌ها"
          meta={
            <>
              {range.to ? <span className="bk-period sf-num">تا {formatJalali(range.to)}</span> : null}
              <span className="bk-cap">{unitCaption(scale, unit)}</span>
            </>
          }
          tools={
            <>
              <Input allowClear prefix={<Search {...ICON} className="bk-3" />} placeholder="نام یا کد" className="!w-44" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Segmented
                value={only}
                onChange={(v) => setOnly(v as typeof only)}
                options={[
                  { value: "all", label: "همه" },
                  { value: "debtors", label: "بدهکاران" },
                  { value: "creditors", label: "بستانکاران" },
                ]}
              />
              <ScalePicker scale={scale} onChange={setScale} />
            </>
          }
          flush
        >
          <ReportTitle title="ماندهٔ حساب‌های تفصیلی" range={range} noFrom />
          {q.data ? (
            <div className="bk-strip">
              <div>
                <small>جمع بدهکاران</small>
                <b><Amt v={sums.dr.toString()} /></b>
              </div>
              <div>
                <small>جمع بستانکاران</small>
                <b><Amt v={sums.cr.toString()} /></b>
              </div>
              <div>
                <small>تعداد</small>
                <b>{faDigits(rows.length)}</b>
              </div>
            </div>
          ) : null}
          <Table
            className="bk-tbl"
            size="small"
            rowKey={(r: any) => `${r.detail_id}-${r.currency_id ?? "base"}`}
            loading={q.isFetching && !q.data}
            dataSource={rows}
            pagination={{ pageSize: 100, hideOnSinglePage: true, size: "small", showSizeChanger: false }}
            scroll={{ x: "max-content" }}
            sticky={printing ? undefined : { offsetHeader: 56 }}
            locale={{ emptyText: q.isLoading ? " " : <EmptyState title={search ? "چیزی پیدا نشد" : "مانده‌ای نیست"} description={search ? "عبارت جستجو یا پالایه‌ها را تغییر دهید." : undefined} /> }}
            rowClassName={() => cx("bk-click")}
            onRow={(r: any) => ({
              onClick: () => (r.kind === "person" && r.ref_id ? nav(`/${orgId}/parties/${r.ref_id}`) : nav(`/${orgId}/reports/ledger?detail=${r.detail_id}`)),
            })}
            columns={[
              { key: "code", dataIndex: "code", title: "کد", width: 88, render: (v) => <span className="sf-num bk-3">{faDigits(v)}</span> },
              { key: "name", dataIndex: "name", title: "نام", ellipsis: true, render: (v, r: any) => (r.kind === "person" ? <Who name={v} /> : v) },
              ...(hasCur ? [{ key: "cur", dataIndex: "currency_code", title: "ارز", width: 80, render: (v: string) => (v && v !== base ? <bdi dir="ltr" className="sf-latin bk-2">{v}</bdi> : <span className="sf-zero">—</span>) }] : []),
              { key: "dr", title: "بدهکار", className: "sf-num", width: 152, render: (_, r: any) => (D(r.balance).gt(0) ? <Amt v={r.balance} /> : null) },
              { key: "cr", title: "بستانکار", className: "sf-num", width: 152, render: (_, r: any) => (D(r.balance).lt(0) ? <Amt v={D(r.balance).abs().toString()} /> : null) },
              ...(hasFx ? [{ key: "fx", dataIndex: "fx_balance", title: "ماندهٔ ارزی", className: "sf-num", width: 152, render: (v: string, r: any) => (D(v).isZero() || !foreign(r) ? null : <Amount v={v} suffix={r.currency_code} />) }] : []),
              ...(hasW ? [{ key: "w", dataIndex: "w_balance", title: "ماندهٔ وزنی (گرم)", className: "sf-num", width: 136, render: (v: string) => (D(v).isZero() ? null : <Weight v={v} unit={false} />) }] : []),
              { key: "last", dataIndex: "last_date", title: "آخرین گردش", width: 112, render: (v) => <JDate v={v} /> },
            ]}
            summary={() =>
              rows.length ? (
                <Table.Summary fixed>
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={hasCur ? 3 : 2} className="bk-sum-l">
                      جمع<small>{faDigits(rows.length)} ردیف</small>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={1} className="sf-num"><Amt v={sums.dr.toString()} /></Table.Summary.Cell>
                    <Table.Summary.Cell index={2} className="sf-num"><Amt v={sums.cr.toString()} /></Table.Summary.Cell>
                    <Table.Summary.Cell index={3} colSpan={1 + (hasFx ? 1 : 0) + (hasW ? 1 : 0)} />
                  </Table.Summary.Row>
                </Table.Summary>
              ) : null
            }
          />
          <PrintFoot />
        </Card>
      </ScaleProvider>
    </div>
  );
}
