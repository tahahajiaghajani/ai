// Dashboard widget of the goods module: today's and this month's sales, gross profit of the month, low-stock items,
// and the month's best sellers ranked with a bar (comparing values → bars, components.md §10.1).
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { Button } from "antd";
import { ChartColumn, Package, Plus, Receipt } from "lucide-react";
import { registerWidget } from "../dashboard/widgets";
import { useOrg } from "../../lib/org";
import { Ic } from "../../components/shell/icons";
import { pct, toPersianDigits } from "../../lib/fa";
import { Amt, Card, Count, Empty, HeadLink, Sk, SkStats, Stat, num, scaled, useScale } from "../dashboard/kit";

function GoodsWidget() {
  const { can } = useOrg();
  return can("sales", "view") ? <GoodsCard /> : null;
}

const qty = (v: unknown) => {
  const n = num(v);
  return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 3 }).format(n);
};

function GoodsCard() {
  const { api, orgId, can } = useOrg();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["goods-summary", orgId], queryFn: () => api.get("/goods/summary"), refetchInterval: 60_000 });
  const d = q.data;
  const go = (p: string) => () => nav(`/${orgId}/${p}`);
  const top: any[] = d?.top_items ?? [];
  const sc = useScale(d ? [d.today_sales, d.month_sales, d.month_profit, ...top.map((t) => t.amount)] : [], 5);
  const maxTop = Math.max(1, ...top.map((t) => Math.abs(num(t.amount))));
  const quiet = d && !num(d.month_sales) && !num(d.today_sales) && !top.length;

  return (
    <Card
      title="فروش کالا"
      caption={d && !quiet ? `مبالغ به ${sc.unit}` : undefined}
      end={
        <>
          {can("reports", "view") ? (
            <HeadLink icon={ChartColumn} onClick={go("sales/reports")}>
              گزارش فروش
            </HeadLink>
          ) : null}
          {can("sales", "edit") ? (
            <HeadLink icon={Plus} onClick={go("sales/invoices/new")}>
              فاکتور جدید
            </HeadLink>
          ) : null}
        </>
      }
      label="فروش کالا"
    >
      {!d ? (
        <>
          <SkStats n={4} />
          <div className="mt-6 flex flex-col gap-4">
            {[0.9, 0.7, 0.55, 0.4].map((w, i) => (
              <Sk key={i} w={`${w * 100}%`} h={10} />
            ))}
          </div>
        </>
      ) : quiet ? (
        <Empty
          icon={Receipt}
          title="این ماه هنوز فروشی ثبت نشده."
          text="فاکتورهای فروش ثبت‌شده، با پرفروش‌های ماه، اینجا می‌آیند."
          action={
            can("sales", "edit") ? (
              <Button type="primary" icon={<Ic icon={Plus} />} onClick={go("sales/invoices/new")}>
                فاکتور فروش
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <div className="db-strip" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(104px, 1fr))", columnGap: 20 }}>
            <Stat label="فروش امروز" onClick={go("sales/invoices")} foot={<><Count n={d.today_count} /> فاکتور</>}>
              <Amt v={d.today_sales} s={sc} />
            </Stat>
            <Stat label={`فروش ${toPersianDigits(String(d.month.title))}`} foot={<><Count n={d.month_count} /> فاکتور</>}>
              <Amt v={d.month_sales} s={sc} />
            </Stat>
            <Stat label="سود ناخالص ماه" foot={d.month_profit !== null && num(d.month_sales) ? <>حاشیه {pct(num(d.month_profit) / num(d.month_net_sales ?? d.month_sales))}</> : undefined}>
              {d.month_profit === null ? <span className="db-zero">—</span> : <Amt v={d.month_profit} s={sc} />}
            </Stat>
            <Stat
              label="کالاهای کم‌موجود"
              tone={d.low_stock ? "warning" : undefined}
              onClick={d.low_stock !== null ? go("inventory/stock?low=1") : undefined}
              foot={d.open_quotes ? <><Count n={d.open_quotes} /> سفارش باز</> : undefined}
            >
              {d.low_stock === null ? <span className="db-zero">—</span> : d.low_stock ? <Count n={d.low_stock} /> : <span className="db-zero">—</span>}
            </Stat>
          </div>
          {top.length ? (
            <>
              <div className="db-sub">
                <span>پرفروش‌های این ماه</span>
                <span className="db-caption">فروش و مقدار</span>
              </div>
              <div className="db-rank">
                {top.slice(0, 5).map((t, i) => (
                  <div key={t.item_id} className="db-rank-r">
                    <span className="db-rank-n" title={t.name}>
                      {t.name}
                    </span>
                    <span className="db-rank-v">
                      {scaled(t.amount, sc, 1)}
                      <small>مقدار {qty(t.qty)}</small>
                    </span>
                    <span className="db-rank-b" aria-hidden>
                      <i style={{ inlineSize: `${(Math.abs(num(t.amount)) / maxTop) * 100}%`, ["--i" as string]: i }} />
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="mt-4 flex items-center gap-3 rounded-md bg-sunken px-4 py-3 text-[13px] text-ink-2">
              <Package size={16} strokeWidth={1.4} absoluteStrokeWidth className="text-ink-3" aria-hidden />
              پرفروش‌های ماه پس از ثبت فروش اینجا می‌آیند.
            </div>
          )}
        </>
      )}
    </Card>
  );
}

registerWidget({ key: "goods-sales", module: "goods", order: 20, render: () => <GoodsWidget /> });
