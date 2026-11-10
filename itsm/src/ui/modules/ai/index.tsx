// The AI layer's pages outside the settings (docs/spec/AI.md §11.8–16): «پیشنهادهای هوش مصنوعی» — the proposals of
// agents and skills routed to the member —, the insights, «پرسش تحلیلی», the volume forecast and the problem
// candidates in the home space, and the virtual agent's test page for AI administrators (the requester UI comes with
// the portal module). The command palette offers «پرسش تحلیلی» for any typed question.
import { lazy } from "react";
import { BarChart3, Inbox, Lightbulb, MessagesSquare, Network, TrendingUp } from "lucide-react";
import type { ModuleUi } from "../registry";
import { agentsApi } from "../../ai/agents/api";
import "../../ai/ml/register";

import type { AccessGate } from "@shared/access";

/** «پرسش تحلیلی» reads through the reports engine (askReport needs the reports area). */
export const REPORTS: AccessGate = { area: "reports" };

const ProposalsInbox = lazy(() => import("../../ai/agents/Inbox"));
const VirtualAgentTestPage = lazy(() => import("../../ai/va/TestPage"));
const InsightsPage = lazy(() => import("../../ai/insights/InsightsPage"));
const AskReportPage = lazy(() => import("../../ai/askreport/AskReportPage"));
const ForecastPage = lazy(() => import("../../ai/ml/ForecastPage"));
const ClustersPage = lazy(() => import("../../ai/ml/ClustersPage"));

export const aiUi: ModuleUi = {
  nav: [
    {
      key: "ai-work",
      label: "هوش مصنوعی",
      space: "home",
      items: [
        {
          key: "ai:proposals",
          label: "پیشنهادهای هوش مصنوعی",
          path: "ai/proposals",
          icon: Inbox,
          area: "ai",
          workspace: true,
          keywords: "پیشنهاد عامل هوش مصنوعی تأیید اعمال رد",
          count: { key: "ai:proposals", hint: "پیشنهاد در انتظار شما", load: agentsApi.inboxCount },
        },
        { key: "ai:insights", label: "بینش‌ها", path: "ai/insights", icon: Lightbulb, area: "ai", keywords: "بینش تغییر حجم ناهنجاری جهش روند خلاصه هفتگی روزانه" },
        // «پرسش تحلیلی» answers with the reports engine: only for members who read reports (the server refuses others)
        { key: "ai:ask-report", label: "پرسش تحلیلی", path: "ai/ask-report", icon: BarChart3, area: "ai", access: REPORTS, keywords: "پرسش گزارش نمودار آمار تعداد میانگین تحلیل" },
        { key: "ai:forecast", label: "پیش‌بینی حجم کار", path: "ai/forecast", icon: TrendingUp, area: "ai", keywords: "پیش‌بینی حجم کار نیرو تعطیلات هفته روند" },
        { key: "ai:clusters", label: "نامزدهای مسئله", path: "ai/clusters", icon: Network, area: "ai", keywords: "خوشه رخداد مشابه تکراری مسئله مشکل" },
        { key: "ai:virtual-agent", label: "دستیار مجازی (آزمایش)", path: "ai/virtual-agent", icon: MessagesSquare, area: "ai", level: "full", keywords: "دستیار مجازی گفتگو درخواست‌کننده ربات چت" },
      ],
    },
  ],
  routes: [
    { path: "ai/proposals", element: <ProposalsInbox /> },
    { path: "ai/virtual-agent", element: <VirtualAgentTestPage /> },
    { path: "ai/insights", element: <InsightsPage /> },
    { path: "ai/ask-report", element: <AskReportPage /> },
    { path: "ai/forecast", element: <ForecastPage /> },
    { path: "ai/clusters", element: <ClustersPage /> },
  ],
  searches: [
    {
      key: "ai:ask-report",
      group: "پرسش تحلیلی",
      icon: BarChart3,
      area: "ai",
      access: REPORTS,
      minLength: 4,
      async run(_api, q) {
        const text = q.trim().slice(0, 500);
        return [{ id: "ask-report", label: `پرسش تحلیلی: «${text.slice(0, 80)}»`, meta: "گزارش با دسترسی خود شما", path: `ai/ask-report?q=${encodeURIComponent(text)}` }];
      },
    },
  ],
  segments: { ai: "home" },
};
