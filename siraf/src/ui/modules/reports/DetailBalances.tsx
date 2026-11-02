import { useState } from "react";
import { Table, Select, Input } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Balance, Amount, Weight, JDate } from "../../components/display";
import { AccountSelect } from "../../components/inputs";
import { ReportFilters, ReportTitle, useRange } from "./Filters";
import { faDigits } from "@shared/format";
import { D } from "@shared/money";
import { DETAIL_KINDS } from "../accounting/labels";
import { exportExcel } from "../../lib/excel";

export default function DetailBalances() {
  const { api, fy, orgId } = useOrg();
  const nav = useNavigate();
  const [range, setRange] = useRange();
  const [kind, setKind] = useState<string | undefined>("person");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [only, setOnly] = useState<"all" | "debtors" | "creditors">("all");
  const [search, setSearch] = useState("");
  const q = useQuery({
    queryKey: ["detail-bal", kind, accountId, range.to, range.drafts, fy?.id],
    queryFn: () => api.get("/accounting/reports/detail-balances", { kind, account_id: accountId, to: range.to, fiscal_year_id: fy?.id, drafts: range.drafts ? 1 : 0 }).then((r) => r.rows as any[]),
  });
  const rows = (q.data ?? []).filter((r) => {
    const b = D(r.balance);
    if (only === "debtors" && !b.gt(0)) return false;
    if (only === "creditors" && !b.lt(0)) return false;
    return !search || String(r.name).includes(search) || String(r.code).includes(search);
  });
  return (
    <div>
      <PageHeader title="مانده‌ی اشخاص و تفصیلی‌ها" subtitle="بدهکاران و بستانکاران، به تفکیک ارز و وزن طلا" />
      <div className="tz-card print-sheet p-3 md:p-4">
        <ReportTitle title="مانده‌ی حساب‌های تفصیلی" range={range} />
        <div className="no-print mb-3 flex flex-wrap gap-2">
          <Select value={kind} onChange={setKind} allowClear placeholder="نوع تفصیلی" className="!w-40" options={DETAIL_KINDS} />
          <AccountSelect value={accountId} onChange={setAccountId} allowClear placeholder="فقط زیر این حساب" className="!w-72" />
          <Select value={only} onChange={setOnly} className="!w-36" options={[{ value: "all", label: "همه" }, { value: "debtors", label: "فقط بدهکاران" }, { value: "creditors", label: "فقط بستانکاران" }]} />
          <Input allowClear placeholder="جستجوی نام" className="!w-48" value={search} onChange={(e) => setSearch(e.target.value)} />
          <a className="self-center text-xs" onClick={() => exportExcel("مانده تفصیلی ها", [{ title: "کد", value: (r: any) => r.code }, { title: "نام", value: (r: any) => r.name }, { title: "ارز", value: (r: any) => r.currency_code ?? "" }, { title: "مانده", value: (r: any) => r.balance, type: "number" }, { title: "مانده ارزی", value: (r: any) => r.fx_balance, type: "number" }, { title: "وزن", value: (r: any) => r.w_balance, type: "number" }], rows)}>خروجی اکسل</a>
        </div>
        <ReportFilters range={range} setRange={setRange} noFrom />
        <Table
          className="tz-table"
          size="small"
          rowKey={(r: any) => `${r.detail_id}-${r.currency_id ?? "base"}`}
          loading={q.isLoading}
          dataSource={rows}
          pagination={{ pageSize: 100, hideOnSinglePage: true }}
          scroll={{ x: "max-content" }}
          onRow={(r: any) => ({ onClick: () => (r.kind === "person" && r.ref_id ? nav(`/${orgId}/parties/${r.ref_id}`) : nav(`/${orgId}/reports/ledger?detail=${r.detail_id}`)), style: { cursor: "pointer" } })}
          columns={[
            { key: "code", dataIndex: "code", title: "کد", render: (v) => <span className="num">{faDigits(v)}</span> },
            { key: "name", dataIndex: "name", title: "نام" },
            { key: "cur", dataIndex: "currency_code", title: "ارز", render: (v) => (v ? <span className="ltr">{v}</span> : <span className="text-muted">پایه</span>) },
            { key: "bal", dataIndex: "balance", title: "مانده", align: "left", render: (v) => <Balance v={v} /> },
            { key: "fx", dataIndex: "fx_balance", title: "مانده‌ی ارزی", align: "left", render: (v, r: any) => (D(v).isZero() ? null : <Amount v={v} suffix={r.currency_code} />) },
            { key: "w", dataIndex: "w_balance", title: "مانده‌ی وزنی", align: "left", render: (v) => (D(v).isZero() ? null : <Weight v={v} />) },
            { key: "last", dataIndex: "last_date", title: "آخرین گردش", render: (v) => <JDate v={v} /> },
          ]}
        />
      </div>
    </div>
  );
}
