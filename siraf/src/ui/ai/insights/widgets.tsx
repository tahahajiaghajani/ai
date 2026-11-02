// The AI cards of «پیشخوان», registered through the dashboard widget registry: the status strip (set-up, budget or a
// connection problem, ai:full only, full row), «خلاصهٔ امروز» and «بینش‌ها». Insights come from rules on the business's own
// data, so they show even with no model connected; only the business's «بینش‌ها و خلاصهٔ امروز» switch hides them.
import "./insights.css";
import { registerWidget } from "../../modules/dashboard/widgets";
import { useOrg } from "../../lib/org";
import { useAiStatus } from "../kit/hooks";
import { BriefCard } from "./BriefCard";
import { InsightsCard } from "./InsightsCard";
import { SetupStrip } from "./SetupStrip";

/** ai:view and the insights switch on (an unknown status counts as on: the cards show their own states). */
function useInsightsOn(): boolean {
  const { can } = useOrg();
  const allowed = can("ai", "view");
  const s = useAiStatus(allowed);
  return allowed && s.data?.features?.insights !== false;
}

function Brief() {
  return useInsightsOn() ? <BriefCard /> : null;
}

function Insights() {
  return useInsightsOn() ? <InsightsCard /> : null;
}

registerWidget({ key: "ai-setup", order: 1, span: 2, render: () => <SetupStrip /> });
registerWidget({ key: "ai-brief", order: 2, render: () => <Brief /> });
registerWidget({ key: "ai-insights", order: 3, render: () => <Insights /> });
