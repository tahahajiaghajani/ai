// The top insight cards a member may see (home page, dashboards), with a link to «بینش‌ها».
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { Card } from "../../components/blocks";
import { insightsApi, ML_KEYS } from "../ml/api";
import { InsightCard } from "./InsightCard";
import { orderInsights } from "./model";
import "./insights.css";

export default function InsightsWidget({ max = 3 }: { max?: number }) {
  const { api, orgId } = useOrg();
  const q = useQuery({ queryKey: ML_KEYS.insights(orgId, "daily"), queryFn: () => insightsApi.list(api, "daily"), staleTime: 300_000, retry: false });
  const list = orderInsights(q.data?.insights ?? []).slice(0, max);
  if (!list.length) return null;
  return (
    <Card
      title="بینش‌ها"
      tools={
        <Link className="ds-link" to={`/${orgId}/ai/insights`}>
          همه ({faDigits(q.data?.insights.length ?? 0)})
        </Link>
      }
    >
      <div className="in-stack">
        {list.map((v) => (
          <InsightCard key={v.id} v={v} compact />
        ))}
      </div>
    </Card>
  );
}
