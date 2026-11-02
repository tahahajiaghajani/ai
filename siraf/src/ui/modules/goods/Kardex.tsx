// Kardex (کاردکس کالا): every move of an item in date order with running quantity, unit cost,
// value and average; optional warehouse and date range; Excel export and printing.
import { useState } from "react";
import { Button, Table } from "antd";
import { FileSpreadsheet, History, Printer } from "lucide-react";
import { Ic } from "../../components/shell/icons";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { exportExcel } from "../../lib/excel";
import { PageHeader } from "../../components/layout";
import { EmptyState, JDate, Money } from "../../components/display";
import { DateInput, RefSelect } from "../../components/inputs";
import { faDigits } from "@shared/format";
import { formatJalali } from "@shared/jalali";
import { D } from "@shared/money";
import { ItemSelect, Qty, type ItemOpt } from "./components";
import { SOURCE_PATH } from "./labels";

export default function Kardex() {
  const { api, orgId, org, fy } = useOrg();
  const nav = useNavigate();
  const n = useNotify();
  const [sp, setSp] = useSearchParams();
  const itemId = sp.get("item_id");
  const [item, setItem] = useState<ItemOpt | null>(null);
  const [warehouseId, setWarehouseId] = useState<string | null>(sp.get("warehouse_id"));
  const [from, setFrom] = useState<string | null>(fy?.start_date ?? null);
  const [to, setTo] = useState<string | null>(null);
  const r = useQuery({
    queryKey: ["goods-kardex", itemId, warehouseId, from, to],
    queryFn: () => api.get("/goods/reports/kardex", { item_id: itemId, warehouse_id: warehouseId, from, to }),
    enabled: !!itemId,
  });
  const data = r.data;
  const rows = (data?.rows ?? []) as any[];
  const unit = data?.item?.unit_name ?? "";
  const shownItem: ItemOpt | null = item ?? (data?.item ? ({ id: data.item.id, code: data.item.code, name: data.item.name, kind: "goods", unit_name: data.item.unit_name } as ItemOpt) : null);
  const exportRows = async () => {
    try {
      await exportExcel(`کاردکس ${data?.item?.name ?? ""}`, [
        { title: "تاریخ", value: (x: any) => formatJalali(x.date, { latin: true }) },
        { title: "سند", value: (x: any) => `${x.doc_title} ${x.doc_no ?? ""}` },
        { title: "طرف حساب / شرح", value: (x: any) => x.party_name ?? x.description },
        { title: "انبار", value: (x: any) => x.warehouse_name },
        { title: "وارده", value: (x: any) => x.in_qty, type: "number" },
        { title: "صادره", value: (x: any) => x.out_qty, type: "number" },
        { title: "مانده", value: (x: any) => x.balance_qty, type: "number" },
        { title: "فی", value: (x: any) => x.unit_cost, type: "number" },
        { title: "مبلغ وارده", value: (x: any) => x.in_value, type: "number" },
        { title: "مبلغ صادره", value: (x: any) => x.out_value, type: "number" },
        { title: "مانده‌ی ریالی", value: (x: any) => x.balance_value, type: "number" },
      ], rows);
    } catch (e) {
      n.error(e);
    }
  };
  return (
    <div>
      <PageHeader
        title="کاردکس کالا"
        actions={
          <>
            <Button icon={<Ic icon={FileSpreadsheet} />} onClick={exportRows} disabled={!rows.length}>اکسل</Button>
            <Button icon={<Ic icon={Printer} />} onClick={() => window.print()}>چاپ</Button>
          </>
        }
      />
      <div className="sf-filters no-print">
        <ItemSelect
          className="!w-80"
          value={itemId}
          item={shownItem}
          ctx={{ kinds: "goods" }}
          onChange={(it) => {
            setItem(it);
            const next = new URLSearchParams(sp);
            if (it) next.set("item_id", it.id);
            else next.delete("item_id");
            setSp(next, { replace: true });
          }}
          placeholder="کالا را انتخاب کنید…"
        />
        <RefSelect entity="warehouse" value={warehouseId} onChange={setWarehouseId} allowClear placeholder="همه‌ی انبارها" showCode={false} className="!w-44" />
        <DateInput value={from} onChange={setFrom} allowClear placeholder="از تاریخ" className="!w-36" />
        <DateInput value={to} onChange={setTo} allowClear placeholder="تا تاریخ" className="!w-36" />
      </div>
      <div className="sf-card print-sheet">
        <div className="mb-3 hidden text-center print:block">
          <div className="text-lg font-semibold">{org.name}</div>
          <div className="text-base font-semibold">کاردکس {data?.item ? `${data.item.name} (${faDigits(data.item.code)})` : ""}</div>
          <div className="text-xs">{from ? `از ${formatJalali(from)}` : ""} {to ? `تا ${formatJalali(to)}` : ""}</div>
        </div>
        {!itemId ? (
          <EmptyState icon={History} title="کالایی انتخاب نشده" description="کالا را از فهرست بالا انتخاب کنید تا گردش آن نمایش داده شود." />
        ) : (
          <>
            {data ? (
              <div className="sf-strip is-compact border-b border-line">
                <div><span className="l">مانده‌ی ابتدای دوره</span><span className="v"><Qty v={data.opening.qty} unit={unit} /></span></div>
                <div><span className="l">وارده</span><span className="v"><Qty v={data.totals.in_qty} unit={unit} /></span></div>
                <div><span className="l">صادره</span><span className="v"><Qty v={data.totals.out_qty} unit={unit} /></span></div>
                <div><span className="l">مانده‌ی پایان دوره</span><span className="v"><Qty v={data.totals.qty} unit={unit} /></span></div>
                <div><span className="l">ارزش مانده</span><span className="v"><Money v={data.totals.value} unit /></span></div>
              </div>
            ) : null}
            <Table
              className=""
              size="small"
              rowKey="id"
              loading={r.isLoading}
              dataSource={rows}
              pagination={{ pageSize: 200, hideOnSinglePage: true, size: "small" }}
              scroll={{ x: "max-content" }}
              onRow={(x: any) => {
                const path = SOURCE_PATH[x.source_type]?.(x.doc_kind);
                return path ? { onClick: () => nav(`/${orgId}/${path}/${x.source_id}`), style: { cursor: "pointer" } } : {};
              }}
              columns={[
                { key: "date", dataIndex: "date", title: "تاریخ", width: 100, render: (v) => <JDate v={v} /> },
                { key: "doc", title: "سند", render: (_, x: any) => <span>{x.doc_title} <span className="sf-docno">{x.doc_no ? faDigits(x.doc_no) : ""}</span></span> },
                { key: "party", title: "طرف حساب / شرح", ellipsis: true, render: (_, x: any) => x.party_name ?? x.description ?? <span className="sf-zero">—</span> },
                ...(!warehouseId ? [{ key: "wh", dataIndex: "warehouse_name", title: "انبار" }] : []),
                { key: "in", dataIndex: "in_qty", title: "وارده", className: "sf-num", render: (v: string) => (D(v).isZero() ? null : <Qty v={v} />) },
                { key: "out", dataIndex: "out_qty", title: "صادره", className: "sf-num", render: (v: string) => (D(v).isZero() ? null : <Qty v={v} />) },
                { key: "bal", dataIndex: "balance_qty", title: "مانده", className: "sf-num", render: (v: string) => <Qty v={v} className="font-medium" /> },
                { key: "uc", dataIndex: "unit_cost", title: "فی", className: "sf-num", render: (v: string) => <Money v={v} /> },
                { key: "inv", dataIndex: "in_value", title: "مبلغ وارده", className: "sf-num", render: (v: string) => <Money v={v} zero="" /> },
                { key: "outv", dataIndex: "out_value", title: "مبلغ صادره", className: "sf-num", render: (v: string) => <Money v={v} zero="" /> },
                { key: "balv", dataIndex: "balance_value", title: "مانده‌ی ریالی", className: "sf-num", render: (v: string) => <Money v={v} /> },
                { key: "avg", dataIndex: "avg_cost", title: "میانگین", className: "sf-num", render: (v: string | null) => (v ? <Money v={v} /> : <span className="sf-zero">—</span>) },
              ]}
              summary={() =>
                data ? (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={warehouseId ? 3 : 4}>جمع دوره</Table.Summary.Cell>
                    <Table.Summary.Cell index={1} className="sf-num"><Qty v={data.totals.in_qty} /></Table.Summary.Cell>
                    <Table.Summary.Cell index={2} className="sf-num"><Qty v={data.totals.out_qty} /></Table.Summary.Cell>
                    <Table.Summary.Cell index={3} className="sf-num"><Qty v={data.totals.qty} /></Table.Summary.Cell>
                    <Table.Summary.Cell index={4} />
                    <Table.Summary.Cell index={5} className="sf-num"><Money v={data.totals.in_value} /></Table.Summary.Cell>
                    <Table.Summary.Cell index={6} className="sf-num"><Money v={data.totals.out_value} /></Table.Summary.Cell>
                    <Table.Summary.Cell index={7} className="sf-num"><Money v={data.totals.value} /></Table.Summary.Cell>
                    <Table.Summary.Cell index={8} />
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
