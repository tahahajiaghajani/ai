// The predictive AI and insights in the shell (docs/spec/AI.md §13–16): the «پیش‌بینی هوشمند» side panel of every task
// record (when the record meta says `ai_predictions`), suggestions while a record is created, the insight cards on the
// home page and the home dashboard, and the «پرسش تحلیلی» box on dashboards. Light: every part loads with its first use.
import { lazy, Suspense } from "react";
import { registerRecordExtensions } from "../../records/extensions";
import { registerHomeWidget } from "../../modules/home/widgets";
import { registerDashboardSlot } from "../../modules/analytics/slots";

const PredictionsPanel = lazy(() => import("./PredictionsPanel"));
const DraftAssist = lazy(() => import("./DraftAssist"));
const InsightsWidget = lazy(() => import("../insights/InsightsWidget"));
const AskReportBox = lazy(() => import("../askreport/AskReportBox"));

registerRecordExtensions("*", {
  sidePanels: [
    {
      key: "ai:predictions",
      title: "پیش‌بینی هوشمند",
      order: 14,
      when: (ctx) => !!(ctx.meta as Record<string, unknown>).ai_predictions,
      render: (ctx) => (
        <Suspense fallback={null}>
          <PredictionsPanel ctx={ctx} />
        </Suspense>
      ),
    },
  ],
  createAssist: (c) =>
    c.def.extends === "task" ? (
      <Suspense fallback={null}>
        <DraftAssist c={c} />
      </Suspense>
    ) : null,
});

registerHomeWidget({
  key: "ai:insights",
  order: 20,
  when: (can) => can("ai", "view"),
  render: () => (
    <Suspense fallback={null}>
      <InsightsWidget />
    </Suspense>
  ),
});

registerDashboardSlot({
  key: "ai:ask",
  order: 10,
  render: () => (
    <Suspense fallback={null}>
      <AskReportBox compact />
    </Suspense>
  ),
});

registerDashboardSlot({
  key: "ai:insights",
  order: 20,
  render: ({ home }) =>
    home ? (
      <Suspense fallback={null}>
        <InsightsWidget max={4} />
      </Suspense>
    ) : null,
});
