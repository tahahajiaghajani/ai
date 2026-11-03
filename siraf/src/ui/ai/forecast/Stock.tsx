// «سفارش دوباره و کالای راکد»: what to reorder (stock against the forecast demand over the lead time, with the
// suggested quantity) and what has not sold for a long time (value tied up, last sale), each with its reason.
import { Link } from "react-router";
import { Table } from "antd";
import { useOrg } from "../../lib/org";
import { EmptyState, Skeleton } from "../../components/display";
import { Card } from "../../modules/reports/kit";
import { pickScale, scaled } from "../../modules/dashboard/kit";
import { formatJalali } from "@shared/jalali";
import { faDigits, formatNumber } from "@shared/format";
import type { AiStockAdvice } from "../kit/types";
import { adviceOf } from "./data";
import { Disclaimer, ExplainForecast, LoadError, useForecast } from "./shared";

const qtyOf = (v: string | null | undefined, unit?: string | null) => (v === null || v === undefined ? <span className="sf-zero">—</span> : <span className="sf-num">{formatNumber(v, { dp: 3 })} {unit ? <span className="sf-unit">{unit}</span> : null}</span>);

function ItemCell({ r }: { r: AiStockAdvice }) {
  const { orgId } = useOrg();
  return (
    <div className="ai-fc-item">
      <Link className="sf-link" to={`/${orgId}/inventory/kardex?item_id=${encodeURIComponent(r.item_id)}`}>
        {r.name}
      </Link>
      {r.code ? <small className="sf-num">{faDigits(r.code)}</small> : null}
      {r.reason_fa ? <span>{faDigits(r.reason_fa)}</span> : null}
    </div>
  );
}

export function StockTab() {
  const { unit } = useOrg();
  const reorder = useForecast("reorder", {}, adviceOf);
  const dead = useForecast("dead_stock", {}, adviceOf);
  const s = pickScale((dead.data ?? []).map((d) => d.value), unit);

  return (
    <div className="bk-stack">
      <Card title="پیشنهاد سفارش دوباره" meta={reorder.data?.length ? <span className="bk-cap">{faDigits(reorder.data.length)} کالا</span> : null} flush>
        {reorder.isLoading ? (
          <div className="bk-card-b">
            <Skeleton rows={6} />
          </div>
        ) : reorder.error ? (
          <div className="bk-card-b">
            <LoadError error={reorder.error} onRetry={() => reorder.refetch()} />
          </div>
        ) : !reorder.data?.length ? (
          <EmptyState compact title="کالایی به سفارش دوباره نیاز ندارد." />
        ) : (
          <Table<AiStockAdvice>
            className="bk-tbl"
            size="small"
            rowKey="item_id"
            dataSource={reorder.data}
            pagination={reorder.data.length > 20 ? { pageSize: 20, showSizeChanger: false } : false}
            scroll={{ x: 640 }}
            columns={[
              { key: "item", title: "کالا", render: (_, r) => <ItemCell r={r} /> },
              { key: "stock", title: "موجودی", align: "end", width: 130, render: (_, r) => qtyOf(r.stock, r.unit) },
              { key: "cover", title: "کافی برای", align: "end", width: 110, render: (_, r) => (r.days_cover !== null ? <span className="sf-num">{faDigits(r.days_cover)} روز</span> : <span className="sf-zero">—</span>) },
              { key: "qty", title: "سفارش پیشنهادی", align: "end", width: 150, render: (_, r) => <b>{qtyOf(r.suggested_qty, r.unit)}</b> },
            ]}
          />
        )}
      </Card>
      <Card title="کالای راکد" meta={dead.data?.length ? <span className="bk-cap">مبالغ به {s.unit}</span> : null} flush>
        {dead.isLoading ? (
          <div className="bk-card-b">
            <Skeleton rows={6} />
          </div>
        ) : dead.error ? (
          <div className="bk-card-b">
            <LoadError error={dead.error} onRetry={() => dead.refetch()} />
          </div>
        ) : !dead.data?.length ? (
          <EmptyState compact title="کالای راکدی پیدا نشد." />
        ) : (
          <Table<AiStockAdvice>
            className="bk-tbl"
            size="small"
            rowKey="item_id"
            dataSource={dead.data}
            pagination={dead.data.length > 20 ? { pageSize: 20, showSizeChanger: false } : false}
            scroll={{ x: 640 }}
            columns={[
              { key: "item", title: "کالا", render: (_, r) => <ItemCell r={r} /> },
              { key: "stock", title: "موجودی", align: "end", width: 130, render: (_, r) => qtyOf(r.stock, r.unit) },
              { key: "value", title: "ارزش موجودی", align: "end", width: 140, render: (_, r) => (r.value ? <span className="sf-num">{scaled(r.value, s)}</span> : <span className="sf-zero">—</span>) },
              { key: "last", title: "آخرین فروش", width: 130, render: (_, r) => (r.last_sale ? <span className="sf-num">{formatJalali(r.last_sale)}</span> : <span className="text-ink-3">فروش نداشته</span>) },
            ]}
          />
        )}
      </Card>
      <Disclaimer>نیاز هر کالا از الگوی فروش خودش برآورد شده (برای فروش پراکنده با روش‌های کراستون و TSB)؛ پیش از سفارش، با تأمین‌کننده و فصل بسنجید.</Disclaimer>
      <ExplainForecast series={null} params={{}} title="سفارش دوباره و کالای راکد" />
    </div>
  );
}
