// «پیش‌بینی و برنامه‌ریزی» (reports group): 13-week cash flow with shortfall weeks, sales and demand fan charts with
// their measured accuracy, reorder and dead-stock lists, rate ranges, and the monthly plan. Every forecast is a range
// computed by the server from the business's own data (no model needed); a model only writes the explanations and the
// plan. Nothing here is buy/sell advice.
import "../kit/ai.css";
import "./forecast.css";
import { Tabs } from "antd";
import { useSearchParams } from "react-router";
import { useNavigate } from "react-router";
import { Button } from "antd";
import { TrendingUp } from "lucide-react";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { EmptyState } from "../../components/display";
import { useAiStatus } from "../kit/hooks";
import { CashTab } from "./Cash";
import { DemandTab } from "./Demand";
import { StockTab } from "./Stock";
import { RatesTab } from "./Rates";
import { PlanTab } from "./Plan";

type TabKey = "cash" | "demand" | "stock" | "rates" | "plan";

export default function Forecast() {
  const { has, can, orgId } = useOrg();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const status = useAiStatus(can("ai", "view"));
  const goods = has("goods");
  const rates = has("gold") || has("fx");
  const tabs: { key: TabKey; label: string }[] = [
    { key: "cash", label: "جریان نقدی ۱۳ هفته" },
    ...(goods ? [{ key: "demand" as const, label: "فروش و تقاضا" }, { key: "stock" as const, label: "سفارش دوباره و کالای راکد" }] : [{ key: "demand" as const, label: "فروش" }]),
    ...(rates ? [{ key: "rates" as const, label: "نرخ‌ها" }] : []),
    { key: "plan", label: "برنامهٔ ماه" },
  ];
  const tab = (tabs.find((t) => t.key === sp.get("tab"))?.key ?? "cash") as TabKey;
  const off = status.data && status.data.features?.forecast === false;

  return (
    <div className="ai-fc">
      <PageHeader title="پیش‌بینی و برنامه‌ریزی" />
      {off ? (
        <div className="bk-card">
          <EmptyState
            icon={TrendingUp}
            title="پیش‌بینی و برنامه‌ریزی در این کسب‌وکار خاموش است."
            action={can("ai", "full") ? <Button onClick={() => nav(`/${orgId}/settings/ai?tab=features`)}>قابلیت‌های هوش مصنوعی</Button> : undefined}
          />
        </div>
      ) : (
        <>
          <Tabs
            className="ai-tabs"
            activeKey={tab}
            onChange={(k) => {
              const next = new URLSearchParams(sp);
              if (k === "cash") next.delete("tab");
              else next.set("tab", k);
              setSp(next, { replace: true });
            }}
            items={tabs.map((t) => ({ key: t.key, label: t.label }))}
          />
          {tab === "cash" ? <CashTab /> : tab === "demand" ? <DemandTab goods={goods} /> : tab === "stock" ? <StockTab /> : tab === "rates" ? <RatesTab /> : <PlanTab />}
        </>
      )}
    </div>
  );
}
