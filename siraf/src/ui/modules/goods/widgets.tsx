// Dashboard widget of the goods module: today's and this month's sales, gross profit of the
// month, low-stock items and the month's best-selling items.
import type { ReactNode } from "react";
import { Button, Spin, Table } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { registerWidget } from "../dashboard/widgets";
import { useOrg } from "../../lib/org";
import { Section } from "../../components/layout";
import { Money } from "../../components/display";
import { faDigits } from "@shared/format";
import { Qty } from "./components";

function Mini({ title, value, hint, onClick, tone }: { title: string; value: ReactNode; hint?: ReactNode; onClick?: () => void; tone?: "bad" }) {
  return (
    <div className={`tz-soft p-3 ${onClick ? "cursor-pointer hover:border-brand" : ""}`} onClick={onClick}>
      <div className="text-[11px] text-muted">{title}</div>
      <div className={`mt-1 truncate text-base font-bold ${tone === "bad" ? "text-bad" : ""}`}>{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-muted">{hint}</div> : null}
    </div>
  );
}

function GoodsWidget() {
  const { api, orgId, can } = useOrg();
  const nav = useNavigate();
  const allowed = can("sales", "view");
  const q = useQuery({ queryKey: ["goods-summary", orgId], queryFn: () => api.get("/goods/summary"), refetchInterval: 60_000, enabled: allowed });
  if (!allowed) return null;
  const d = q.data;
  return (
    <Section
      title="فروش کالا"
      extra={
        <span className="flex gap-1">
          {can("sales", "edit") ? <Button size="small" type="link" onClick={() => nav(`/${orgId}/sales/invoices/new`)}>فاکتور جدید</Button> : null}
          {can("reports", "view") ? <Button size="small" type="link" onClick={() => nav(`/${orgId}/sales/reports`)}>گزارش فروش</Button> : null}
        </span>
      }
    >
      {!d ? (
        <div className="grid h-32 place-content-center"><Spin /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Mini title="فروش امروز" value={<Money v={d.today_sales} />} hint={`${faDigits(d.today_count)} فاکتور`} onClick={() => nav(`/${orgId}/sales/invoices`)} />
            <Mini title={`فروش ${d.month.title}`} value={<Money v={d.month_sales} />} hint={`${faDigits(d.month_count)} فاکتور`} />
            <Mini title="سود ناخالص ماه" value={d.month_profit !== null ? <Money v={d.month_profit} colored /> : "—"} />
            <Mini
              title="کالاهای کم‌موجود"
              value={d.low_stock === null ? "—" : faDigits(d.low_stock)}
              tone={d.low_stock ? "bad" : undefined}
              hint={d.open_quotes ? `${faDigits(d.open_quotes)} پیش‌فاکتور/سفارش باز` : undefined}
              onClick={d.low_stock !== null ? () => nav(`/${orgId}/inventory/stock?low=1`) : undefined}
            />
          </div>
          {d.top_items.length ? (
            <Table
              className="tz-table mt-3"
              size="small"
              rowKey="item_id"
              pagination={false}
              dataSource={d.top_items}
              columns={[
                { key: "name", dataIndex: "name", title: "پرفروش‌های این ماه", ellipsis: true },
                { key: "qty", dataIndex: "qty", title: "مقدار", align: "left", render: (v) => <Qty v={v} /> },
                { key: "amount", dataIndex: "amount", title: "فروش", align: "left", render: (v) => <Money v={v} /> },
                { key: "profit", dataIndex: "profit", title: "سود", align: "left", render: (v) => (v === null ? "—" : <Money v={v} colored />) },
              ]}
            />
          ) : null}
        </>
      )}
    </Section>
  );
}

registerWidget({ key: "goods-sales", module: "goods", order: 20, render: () => <GoodsWidget /> });
