// «خودکارسازی» (docs/spec/services/flows.md): flows, schedules and HTTP connections as record tables of the settings
// space (generic lists and forms), plus the visual designer (`flows/:id/design`), the run history (`flows/runs`) and a
// run's page (`flows/runs/:runId`). Record pages get «طراحی» / «اجرا» and the runs tab on a flow, and the «تکرار»
// panel on a schedule. Everything heavy is loaded lazily.
import { lazy, Suspense } from "react";
import { CalendarClock, History, Plug, Workflow } from "lucide-react";
import { recordModule } from "../../records/module";
import type { RecordContext } from "../../records/extensions";
import type { ModuleUi } from "../registry";

const Designer = lazy(() => import("./Designer"));
const Runs = lazy(() => import("./Runs"));
const RunDetail = lazy(() => import("./RunDetail"));
const FlowActions = lazy(() => import("./RecordParts").then((m) => ({ default: m.FlowActions })));
const FlowRunsTab = lazy(() => import("./RecordParts").then((m) => ({ default: m.FlowRunsTab })));
const ScheduleSide = lazy(() => import("./RecordParts").then((m) => ({ default: m.ScheduleSide })));

const lazily = (node: React.ReactNode) => <Suspense fallback={null}>{node}</Suspense>;
const SECTION = "خودکارسازی";

const ui = recordModule({
  key: "flows",
  spaceKey: "settings",
  group: { key: "flows", label: "خودکارسازی" },
  tables: [
    {
      table: "flow",
      path: "flows",
      label: "گردش‌کارها",
      noun: "گردش‌کار",
      icon: Workflow,
      section: SECTION,
      keywords: "گردش کار خودکارسازی اتوماسیون قاعده رویداد زمان‌بندی وب‌هوک تأیید flow workflow automation",
      extensions: {
        headerActions: (ctx: RecordContext) => lazily(<FlowActions key="flow-actions" ctx={ctx} />),
        tabs: [{ key: "runs", label: "اجراها", order: 20, render: (ctx: RecordContext) => lazily(<FlowRunsTab ctx={ctx} />) }],
      },
    },
    {
      table: "schedule",
      path: "schedules",
      label: "زمان‌بندی‌ها",
      noun: "زمان‌بندی",
      icon: CalendarClock,
      section: SECTION,
      keywords: "زمان‌بندی تکراری ماهانه هفتگی نگهداری دوره‌ای schedule cron",
      extensions: { sidePanels: [{ key: "schedule", title: "تکرار", order: 5, render: (ctx: RecordContext) => lazily(<ScheduleSide ctx={ctx} />) }] },
    },
    { table: "flow_connection", path: "flow-connections", label: "اتصال‌های HTTP", noun: "اتصال HTTP", icon: Plug, section: SECTION, keywords: "اتصال سرویس بیرونی API کلید میزبان مجاز http" },
    { table: "flow_version", path: "flow-versions", label: "نسخه‌های گردش‌کار", icon: History, hidden: true, newAction: false, search: false },
  ],
  nav: [{ key: "flows:runs", access: { area: "flows" }, label: "اجراهای گردش‌کار", path: "flows/runs", icon: History, section: SECTION, keywords: "اجرا تاریخچه گزارش گام خطا انتظار تأیید run" }],
  routes: [
    { path: "flows/:id/design", element: <Designer /> },
    { path: "flows/runs", element: <Runs /> },
    { path: "flows/runs/:runId", element: <RunDetail /> },
  ],
  segments: { flows: "settings", schedules: "settings", "flow-connections": "settings", "flow-versions": "settings" },
});

export const flowsUi: ModuleUi = ui;
