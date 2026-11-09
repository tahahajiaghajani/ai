// Analytics' screens (docs/modules/analytics_FA.md). The module adds the sidebar space «گزارش‌ها» (for those who read
// the reports area) with:
//   pages         «داشبورد خانه» (the member's workspace's home dashboard, else one marked for everyone), «داشبوردها»,
//                 «گزارش‌ها» (the designer with live preview and chart gallery at analytics/reports/:id), «کارت امتیاز
//                 شاخص‌ها» (sparklines and targets; the KPI hub at analytics/indicators/:id), «پرسش از داده‌ها», the
//                 print view (analytics/print/:kind/:id), «تنظیمات گزارش‌ها» (report administrators)
//   records       indicators (with a live check), scheduled deliveries (timing editor, «ارسال اکنون»), deliveries
//                 received (the recipient's evidence, the Excel file attached), the settings row
// Only light modules are imported here; every page loads with its route.
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { BarChart3, CalendarClock, ChartColumn, Gauge, House, Inbox, LayoutDashboard, MessageSquareText, Settings2 } from "lucide-react";
import type { AccessGate } from "@shared/access";
import type { ModuleUi } from "../registry";
import { recordModule, RecordPageRoute } from "../../records/module";
import { registerRecordExtensions, type RecordContext } from "../../records/extensions";
import { recordsApi } from "../../records/data/api";
import { Loader } from "../../components/display";
import type { OrgApi } from "../../lib/api";

const Designer = lazy(() => import("./Designer"));
const DashboardPage = lazy(() => import("./DashboardPage"));
const Library = lazy(() => import("./Library"));
const Scorecard = lazy(() => import("./Scorecard").then((m) => ({ default: m.Scorecard })));
const IndicatorHub = lazy(() => import("./Scorecard").then((m) => ({ default: m.IndicatorHub })));
const Ask = lazy(() => import("./Ask"));
const Print = lazy(() => import("./Print"));
const Admin = lazy(() => import("./Admin"));
const ScheduleTab = lazy(() => import("./RecordParts").then((m) => ({ default: m.ScheduleTab })));
const SendNow = lazy(() => import("./RecordParts").then((m) => ({ default: m.SendNow })));
const IndicatorPanel = lazy(() => import("./RecordParts").then((m) => ({ default: m.IndicatorPanel })));

const page = (node: ReactNode) => <Suspense fallback={<Loader />}>{node}</Suspense>;
const widget = (C: ComponentType<{ ctx: RecordContext }>) => (ctx: RecordContext): ReactNode => (
  <Suspense fallback={<Loader />}>
    <C ctx={ctx} />
  </Suspense>
);

/** Who is offered the screens (the server checks every route again): readers of the reports area; the settings for
 *  its administrators. */
const READS: AccessGate = { area: "reports" };
const ADMIN: AccessGate = { area: "reports", op: "admin" };

export const ANALYTICS_SPACE = { key: "analytics", label: "گزارش‌ها", title: "گزارش‌ها و شاخص‌ها", icon: BarChart3, access: READS };

const DEFS = "تعریف‌ها";

/** Deliveries the member received and has not opened (the nav count of «گزارش‌های دریافتی»). */
const received = async (api: OrgApi) => (await recordsApi.list(api, "analytics_delivery", { filter: { and: [{ f: "recipient_id", op: "is_me" }, { f: "status", op: "eq", v: "sent" }, { f: "delivered_at", op: "relative", v: { unit: "day", from: -6, to: 0 } }] }, size: 1, fields: ["title"], total: true })).total ?? 0;

const module = recordModule({
  key: "analytics",
  space: ANALYTICS_SPACE,
  group: { key: "analytics", label: "گزارش‌ها و شاخص‌ها" },
  tables: [
    {
      table: "analytics_indicator", path: "analytics/kpis", label: "شاخص‌ها", noun: "شاخص", icon: Gauge, section: DEFS, area: "reports", access: READS,
      keywords: "شاخص KPI فرمول هدف آستانه MTTR MTTA", search: { group: "شاخص‌ها" },
      extensions: { sidePanels: [{ key: "analytics:check", title: "مقدار این دوره", order: 1, render: widget(IndicatorPanel) }] },
    },
    {
      table: "analytics_schedule", path: "analytics/schedules", label: "ارسال‌های زمان‌بندی‌شده", noun: "ارسال زمان‌بندی‌شده", icon: CalendarClock, section: DEFS, area: "reports", access: READS,
      keywords: "زمان‌بندی ارسال ایمیل گزارش دوره‌ای اشتراک", search: false,
      extensions: {
        headerActions: (ctx) => (
          <Suspense key="analytics-send" fallback={null}>
            <SendNow ctx={ctx} />
          </Suspense>
        ),
        tabs: [{ key: "analytics:schedule", label: "زمان‌بندی", order: 1, render: widget(ScheduleTab) }],
      },
    },
    {
      table: "analytics_delivery", path: "analytics/received", label: "گزارش‌های دریافتی", icon: Inbox, area: "reports", access: READS, newAction: false, search: false,
      keywords: "گزارش دریافتی ارسال‌شده اکسل", count: { key: "analytics:received", hint: "گزارش دریافتی هفتهٔ اخیر", load: received },
      list: { preset: { emptyText: "هنوز گزارشی برای شما فرستاده نشده است" } },
    },
    { table: "analytics_score", path: "analytics/scores", label: "امتیازهای ذخیره‌شده", icon: ChartColumn, hidden: true, newAction: false, search: false },
    { table: "analytics_config", path: "analytics/settings/record", label: "تنظیمات گزارش‌ها", icon: Settings2, hidden: true, newAction: false, search: false },
  ],
  nav: [
    { key: "analytics:home", label: "داشبورد خانه", path: "analytics", icon: House, area: "reports", access: READS, workspace: true, keywords: "داشبورد خانه صفحهٔ اصلی گزارش" },
    { key: "analytics:dashboards", label: "داشبوردها", path: "analytics/dashboards", icon: LayoutDashboard, area: "reports", access: READS, keywords: "داشبورد نمایشگر TV ابزارک" },
    { key: "analytics:reports", label: "گزارش‌ها", path: "analytics/reports", icon: ChartColumn, area: "reports", access: READS, keywords: "گزارش نمودار طراح گزارش جدول متقاطع" },
    { key: "analytics:scorecard", label: "کارت امتیاز شاخص‌ها", path: "analytics/scorecard", icon: Gauge, area: "reports", access: READS, keywords: "کارت امتیاز شاخص KPI هدف روند" },
    { key: "analytics:ask", label: "پرسش از داده‌ها", path: "analytics/ask", icon: MessageSquareText, area: "reports", access: READS, keywords: "پرسش سؤال زبان طبیعی چند تا" },
    { key: "analytics:new-report", label: "گزارش تازه", path: "analytics/reports/new", icon: ChartColumn, area: "reports", level: "edit", access: { area: "reports", op: "create" }, action: true, keywords: "گزارش تازه نمودار" },
    { key: "analytics:settings", label: "تنظیمات گزارش‌ها", path: "analytics/settings", icon: Settings2, section: DEFS, area: "reports", access: ADMIN, keywords: "تنظیمات گزارش کتابخانهٔ شاخص پیش‌فرض عکس" },
  ],
  routes: [
    { path: "analytics", element: page(<DashboardPage home />) },
    { path: "analytics/dashboards", element: page(<Library kind="dashboards" />) },
    { path: "analytics/dashboards/:id", element: page(<DashboardPage />) },
    { path: "analytics/dashboards/:id/settings", element: <RecordPageRoute table="analytics_dashboard" /> },
    { path: "analytics/reports", element: page(<Library kind="reports" />) },
    { path: "analytics/reports/:id", element: page(<Designer />) },
    { path: "analytics/scorecard", element: page(<Scorecard />) },
    { path: "analytics/indicators/:id", element: page(<IndicatorHub />) },
    { path: "analytics/ask", element: page(<Ask />) },
    { path: "analytics/print/:kind/:id", element: page(<Print />) },
    { path: "analytics/settings", element: page(<Admin />) },
  ],
  segments: { analytics: "analytics" },
});

// links to reports and dashboards (a delivery's, a schedule's) open the designer and the dashboard page
registerRecordExtensions("analytics_report", { path: "analytics/reports" });
registerRecordExtensions("analytics_dashboard", { path: "analytics/dashboards" });

export const analyticsUi: ModuleUi = {
  ...module,
  searches: [
    ...(module.searches ?? []),
    {
      key: "analytics:definitions",
      group: "گزارش‌ها و داشبوردها",
      icon: ChartColumn,
      area: "reports",
      access: READS,
      minLength: 2,
      async run(api, q) {
        const [r, d] = await Promise.all([
          recordsApi.list(api, "analytics_report", { q, filter: { f: "trashed", op: "eq", v: false }, size: 4, fields: ["name", "number"], total: false }).catch(() => ({ rows: [] })),
          recordsApi.list(api, "analytics_dashboard", { q, filter: { f: "trashed", op: "eq", v: false }, size: 4, fields: ["name", "number"], total: false }).catch(() => ({ rows: [] })),
        ]);
        return [
          ...d.rows.map((x) => ({ id: x.id, label: String(x.name), meta: "داشبورد", path: `analytics/dashboards/${x.id}` })),
          ...r.rows.map((x) => ({ id: x.id, label: String(x.name), meta: "گزارش", path: `analytics/reports/${x.id}` })),
        ];
      },
    },
  ],
};
