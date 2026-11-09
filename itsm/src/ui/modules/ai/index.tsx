// The AI layer's pages outside the settings (docs/spec/AI.md §11.8–11.9): «پیشنهادهای هوش مصنوعی» — the proposals of
// agents and skills routed to the member — in the home space, and the virtual agent's test page for AI administrators
// (the requester UI comes with the portal module).
import { lazy } from "react";
import { Inbox, MessagesSquare } from "lucide-react";
import type { ModuleUi } from "../registry";
import { agentsApi } from "../../ai/agents/api";

const ProposalsInbox = lazy(() => import("../../ai/agents/Inbox"));
const VirtualAgentTestPage = lazy(() => import("../../ai/va/TestPage"));

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
        { key: "ai:virtual-agent", label: "دستیار مجازی (آزمایش)", path: "ai/virtual-agent", icon: MessagesSquare, area: "ai", level: "full", keywords: "دستیار مجازی گفتگو درخواست‌کننده ربات چت" },
      ],
    },
  ],
  routes: [
    { path: "ai/proposals", element: <ProposalsInbox /> },
    { path: "ai/virtual-agent", element: <VirtualAgentTestPage /> },
  ],
  segments: { ai: "home" },
};
