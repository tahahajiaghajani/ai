// Dashboard widget of the gold module: today's price with its change, stock weight and sales.
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Spin } from "antd";
import { PlusOutlined, LineChartOutlined } from "@ant-design/icons";
import { registerWidget } from "../dashboard/widgets";
import { useOrg } from "../../lib/org";
import { Section } from "../../components/layout";
import { Money } from "../../components/display";
import { faDigits, formatNumber, formatWeight } from "@shared/format";
import { RateChange, RateStamp } from "./shared";

function GoldWidget() {
  const { api, orgId, can } = useOrg();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["gold-summary", orgId], queryFn: () => api.get("/gold/summary"), refetchInterval: 60_000, enabled: can("gold", "view") });
  if (!can("gold", "view")) return null;
  const d = q.data;
  const r = d?.rate?.rate;
  return (
    <Section
      title="طلا و جواهر"
      extra={
        <div className="flex gap-1">
          <Button size="small" type="link" icon={<LineChartOutlined />} onClick={() => nav(`/${orgId}/gold/rates`)}>تابلوی قیمت</Button>
          {can("gold", "edit") ? <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => nav(`/${orgId}/gold/sale/new`)}>فروش</Button> : null}
        </div>
      }
    >
      {q.isLoading || !d ? (
        <div className="grid h-24 place-content-center"><Spin /></div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-gold-soft p-3">
            <div className="text-xs text-muted">هر گرم ۱۸ عیار</div>
            <div className="num text-xl font-extrabold text-gold">{r?.gram18 ? formatNumber(r.gram18) : "—"}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <RateChange change={d.rate.change} pct={d.rate.change_pct} />
              <RateStamp rate={r} />
            </div>
            {r?.mazaneh ? <div className="mt-1 text-[11px] text-muted">مظنه: <span className="num">{formatNumber(r.mazaneh)}</span></div> : null}
          </div>
          <div className="rounded-lg bg-surface-2 p-3">
            <div className="text-xs text-muted">موجودی ویترین</div>
            <div className="num text-xl font-extrabold">{formatWeight(d.stock?.w750 ?? 0)} <span className="text-xs font-normal text-muted">گرم ۷۵۰</span></div>
            <div className="text-[11px] text-muted">
              {faDigits(d.stock?.pieces ?? 0)} جنس{d.stock?.consigned ? ` (${faDigits(d.stock.consigned)} امانی)` : ""}، مستعمل <span className="num">{formatWeight(d.ledger?.gold_old?.w ?? 0)}</span>، آبشده <span className="num">{formatWeight(d.ledger?.gold_bullion?.w ?? 0)}</span>
            </div>
          </div>
          <div className="rounded-lg bg-surface-2 p-3">
            <div className="text-xs text-muted">فروش امروز</div>
            <div className="text-lg font-bold"><Money v={d.sales_today?.total ?? 0} /></div>
            <div className="text-[11px] text-muted">{faDigits(d.sales_today?.count ?? 0)} فاکتور، <span className="num">{formatWeight(d.sales_today?.weight750 ?? 0)}</span> گرم</div>
          </div>
          <div className="rounded-lg bg-surface-2 p-3">
            <div className="text-xs text-muted">فروش این ماه</div>
            <div className="text-lg font-bold"><Money v={d.sales_month?.total ?? 0} /></div>
            <div className="text-[11px] text-muted">{faDigits(d.sales_month?.count ?? 0)} فاکتور، <span className="num">{formatWeight(d.sales_month?.weight750 ?? 0)}</span> گرم</div>
          </div>
        </div>
      )}
    </Section>
  );
}

registerWidget({ key: "gold", module: "gold", order: 20, render: () => <GoldWidget /> });
