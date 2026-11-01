// Stock balance (موجودی کالا): quantity, average cost and value per item (or item × warehouse)
// at a date, with low-stock filter, Excel export and printing. Click a row for its kardex.
import { useState } from "react";
import { Button, Input, Segmented, Space, Switch, Table, Tag, Tooltip } from "antd";
import { CalculatorOutlined, FileExcelOutlined, PrinterOutlined, SearchOutlined, WarningOutlined } from "@ant-design/icons";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { useAction, useDebounced, useNotify } from "../../lib/hooks";
import { exportExcel } from "../../lib/excel";
import { PageHeader } from "../../components/layout";
import { Money, StatCard } from "../../components/display";
import { DateInput, RefSelect } from "../../components/inputs";
import { faDigits, formatNumber } from "@shared/format";
import { formatJalali } from "@shared/jalali";
import { Qty } from "./components";

export default function StockReport() {
  const { api, orgId, org, can } = useOrg();
  const nav = useNavigate();
  const n = useNotify();
  const [sp] = useSearchParams();
  const [q, setQ] = useState("");
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [by, setBy] = useState<"item" | "warehouse">("item");
  const [low, setLow] = useState(sp.get("low") === "1");
  const [zero, setZero] = useState(false);
  const dq = useDebounced(q);
  const params = { q: dq, warehouse_id: warehouseId, category_id: categoryId, date, by, low: low ? 1 : 0, zero: zero ? 1 : 0 };
  const r = useQuery({ queryKey: ["goods-stock", params], queryFn: () => api.get("/goods/reports/stock", params) });
  const rows = (r.data?.rows ?? []) as any[];
  const recompute = useAction(() => api.post("/goods/costing/recompute", {}), {
    success: (d: any) => `بهای تمام‌شده بازسازی شد (${faDigits(d.items)} کالا، ${faDigits(d.documents)} سند اصلاح شد)`,
    invalidate: [["goods-stock"], ["table"]],
  });
  const exportRows = async () => {
    try {
      await exportExcel("موجودی کالا", [
        { title: "کد", value: (x: any) => x.code },
        { title: "نام کالا", value: (x: any) => x.name },
        { title: "گروه", value: (x: any) => x.category_name },
        ...(by === "warehouse" ? [{ title: "انبار", value: (x: any) => x.warehouse_name }] : []),
        { title: "موجودی", value: (x: any) => x.qty, type: "number" as const },
        { title: "واحد", value: (x: any) => x.unit_name },
        { title: "میانگین بها", value: (x: any) => x.avg_cost, type: "number" as const },
        { title: "ارزش", value: (x: any) => x.value, type: "number" as const },
        { title: "نقطه‌ی سفارش", value: (x: any) => x.reorder_point ?? x.min_stock, type: "number" as const },
      ], rows);
    } catch (e) {
      n.error(e);
    }
  };
  return (
    <div>
      <PageHeader
        title="موجودی کالا"
        subtitle={date ? `تا تاریخ ${formatJalali(date)}` : "موجودی و ارزش کالاها به روش میانگین موزون"}
        actions={
          <>
            {can("inventory", "full") ? (
              <Tooltip title="محاسبه‌ی دوباره‌ی بهای تمام‌شده‌ی همه‌ی کالاها و اصلاح اسناد مربوط">
                <Button icon={<CalculatorOutlined />} loading={recompute.isPending} onClick={async () => { if (await n.confirm("بهای تمام‌شده‌ی همه‌ی کالاها دوباره محاسبه شود؟", "اسناد حسابداری فاکتورها و اسناد انبار در صورت تغییر اصلاح می‌شوند.")) recompute.mutate(undefined); }}>
                  بازسازی بهای تمام‌شده
                </Button>
              </Tooltip>
            ) : null}
            <Button icon={<FileExcelOutlined />} onClick={exportRows} disabled={!rows.length}>اکسل</Button>
            <Button icon={<PrinterOutlined />} onClick={() => window.print()}>چاپ</Button>
          </>
        }
      />
      <div className="no-print mb-3 grid gap-3 sm:grid-cols-3">
        <StatCard title="ارزش موجودی" value={<Money v={r.data?.totals.value ?? 0} />} />
        <StatCard title="تعداد ردیف" value={faDigits(r.data?.totals.items ?? 0)} tone="muted" />
        <StatCard title="کالاهای کم‌موجود" value={faDigits(r.data?.totals.low ?? 0)} tone={r.data?.totals.low ? "bad" : "ok"} icon={<WarningOutlined />} onClick={() => setLow(true)} />
      </div>
      <div className="tz-card print-sheet p-3 md:p-4">
        <div className="mb-3 hidden text-center print:block">
          <div className="text-lg font-bold">{org.name}</div>
          <div className="text-base font-semibold">گزارش موجودی کالا{date ? ` تا ${formatJalali(date)}` : ""}</div>
        </div>
        <div className="no-print mb-3 flex flex-wrap items-center gap-2">
          <Input allowClear prefix={<SearchOutlined className="text-muted" />} placeholder="نام، کد یا بارکد" value={q} onChange={(e) => setQ(e.target.value)} className="!w-56" />
          <RefSelect entity="warehouse" value={warehouseId} onChange={setWarehouseId} allowClear placeholder="همه‌ی انبارها" className="!w-44" showCode={false} />
          <RefSelect entity="item_category" value={categoryId} onChange={setCategoryId} allowClear placeholder="همه‌ی گروه‌ها" className="!w-44" showCode={false} />
          <DateInput value={date} onChange={setDate} allowClear placeholder="تا تاریخ (امروز)" className="!w-40" />
          <Segmented size="small" value={by} onChange={(v) => setBy(v as "item" | "warehouse")} options={[{ value: "item", label: "به تفکیک کالا" }, { value: "warehouse", label: "کالا و انبار" }]} />
          <Space>
            <label className="flex items-center gap-1.5 text-xs text-muted"><Switch size="small" checked={low} onChange={setLow} /> فقط کم‌موجود</label>
            <label className="flex items-center gap-1.5 text-xs text-muted"><Switch size="small" checked={zero} onChange={setZero} /> با اقلام بدون موجودی</label>
          </Space>
        </div>
        <Table
          className="tz-table"
          size="small"
          rowKey="key"
          loading={r.isLoading}
          dataSource={rows}
          pagination={{ pageSize: 100, hideOnSinglePage: true, size: "small", showTotal: (t) => `${faDigits(t)} ردیف` }}
          scroll={{ x: "max-content" }}
          onRow={(x: any) => ({ onClick: () => nav(`/${orgId}/inventory/kardex?item_id=${x.item_id}${x.warehouse_id ? `&warehouse_id=${x.warehouse_id}` : ""}`), style: { cursor: "pointer" } })}
          columns={[
            { key: "code", dataIndex: "code", title: "کد", width: 90, render: (v) => <span className="num">{faDigits(v)}</span> },
            { key: "name", dataIndex: "name", title: "نام کالا", render: (v, x: any) => <span>{v}{x.low ? <Tag color="error" variant="filled" className="!ms-2">کم‌موجود</Tag> : null}</span> },
            { key: "cat", dataIndex: "category_name", title: "گروه", render: (v) => v ?? <span className="text-muted">—</span> },
            ...(by === "warehouse" ? [{ key: "wh", dataIndex: "warehouse_name", title: "انبار" }] : []),
            { key: "qty", dataIndex: "qty", title: "موجودی", align: "left" as const, sorter: (a: any, b: any) => Number(a.qty) - Number(b.qty), render: (v: string, x: any) => <Qty v={v} unit={x.unit_name} /> },
            { key: "avg", dataIndex: "avg_cost", title: "میانگین بها", align: "left" as const, render: (v: string | null) => (v ? <Money v={v} /> : <span className="text-muted">—</span>) },
            { key: "value", dataIndex: "value", title: "ارزش", align: "left" as const, sorter: (a: any, b: any) => Number(a.value) - Number(b.value), render: (v: string) => <Money v={v} /> },
            { key: "rp", title: "نقطه‌ی سفارش", align: "left" as const, render: (_: unknown, x: any) => (x.reorder_point ?? x.min_stock ? <span className="num text-muted">{formatNumber(x.reorder_point ?? x.min_stock, { dp: 3 })}</span> : <span className="text-muted">—</span>) },
          ]}
          summary={() =>
            rows.length ? (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={by === "warehouse" ? 6 : 5}>جمع ارزش موجودی</Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="left"><Money v={r.data?.totals.value ?? 0} /></Table.Summary.Cell>
                <Table.Summary.Cell index={2} />
              </Table.Summary.Row>
            ) : null
          }
        />
      </div>
    </div>
  );
}
