// Event management and on-call screens (docs/modules/event_FA.md), in the «عملیات» space next to incidents and
// problems:
//   پایش و هشدار  «کنسول هشدارها» (the live console, with a live count), every alert, the correlated groups, raw events
//   کشیک          «کشیک» (who is on call now, the on-call calendar), schedules, overrides, escalation policies, pages
//   گزارش‌ها       «گزارش‌های عملیات» (alerts, alert quality, on-call load)
//   تعریف‌ها       sources (with their keys), processing rules (with the simulation), correlation rules, alert →
//                 incident rules, routing
// Record pages: the alert's actions and escalation timeline, the group's actions and causes; on incident pages the
// monitoring alerts and who is on call for the group, on CI pages the CI's open alerts. The sign-in-free
// acknowledgement page is /p/ack/:token. Only light modules are imported here; components load with their pages.
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { Activity, BellPlus, BellRing, CalendarClock, ChartColumn, ChevronsUp, GitMerge, Layers, ListFilter, MonitorDot, RadioTower, Repeat, Route, Siren, UserRoundCog, Settings2 } from "lucide-react";
import type { ModuleUi } from "../registry";
import { recordModule } from "../../records/module";
import { registerRecordExtensions, type RecordContext } from "../../records/extensions";
import { recordsApi } from "../../records/data/api";
import { Loader } from "../../components/display";
import type { OrgApi } from "../../lib/api";

const Console = lazy(() => import("./Console"));
const OnCall = lazy(() => import("./OnCall"));
const Reports = lazy(() => import("./Reports"));
const AckPage = lazy(() => import("./AckPage"));
const AlertActions = lazy(() => import("./widgets").then((m) => ({ default: m.AlertActions })));
const GroupActions = lazy(() => import("./widgets").then((m) => ({ default: m.GroupActions })));
const Timeline = lazy(() => import("./widgets").then((m) => ({ default: m.Timeline })));
const GroupInsightPanel = lazy(() => import("./widgets").then((m) => ({ default: m.GroupInsightPanel })));
const SourceKeyAction = lazy(() => import("./widgets").then((m) => ({ default: m.SourceKeyAction })));
const RuleSimulate = lazy(() => import("./widgets").then((m) => ({ default: m.RuleSimulate })));
const IncidentAlerts = lazy(() => import("./widgets").then((m) => ({ default: m.IncidentAlerts })));
const CiAlerts = lazy(() => import("./widgets").then((m) => ({ default: m.CiAlerts })));
const OnCallPanel = lazy(() => import("./widgets").then((m) => ({ default: m.OnCallPanel })));

const widget = (C: ComponentType<{ ctx: RecordContext }>, key?: string) => (ctx: RecordContext): ReactNode => (
  <Suspense key={key} fallback={key ? null : <Loader />}>
    <C ctx={ctx} />
  </Suspense>
);
const lazyPage = (node: ReactNode) => <Suspense fallback={<Loader />}>{node}</Suspense>;

const ALERTS = "پایش و هشدار";
const ONCALL = "کشیک";
const DEFS = "تعریف‌ها";
const OPEN = ["open", "acknowledged", "flapping", "snoozed", "maintenance"];
const EVENT = { area: "event" } as const;
const EVENT_DEFS = { area: "event", op: "create" } as const;
const ONCALL_GATE = { area: "oncall" } as const;

/** Open alerts not yet acknowledged (the console's live count). */
const openCount = async (api: OrgApi) => (await recordsApi.list(api, "alert", { filter: { f: "state", op: "eq", v: "open" }, size: 1, fields: ["number"], total: true })).total ?? 0;

const module = recordModule({
  key: "event",
  spaceKey: "operations",
  group: { key: "event", label: "پایش و کشیک" },
  tables: [
    {
      table: "alert", path: "alerts", label: "همهٔ هشدارها", noun: "هشدار", icon: BellRing, section: ALERTS, access: EVENT,
      keywords: "هشدار آلارم پایش رویداد ALR", search: { group: "هشدارها" },
      list: { preset: { rowTone: (r) => (r.state === "open" && (r.severity === "critical" || r.severity === "major") ? "danger" : r.state === "flapping" ? "warning" : null), emptyText: "هشداری نیست" } },
      extensions: {
        headerActions: widget(AlertActions, "alert-actions"),
        sidePanels: [{ key: "event:timeline", title: "زمان‌بندی ارتقا", order: 1, render: widget(Timeline) }],
        cardFields: ["severity", "assigned_to", "last_seen_at"],
        policies: [
          { key: "alert:close", when: { f: "state", op: "nin", v: ["closed"] }, actions: [{ field: "close_code", visible: false }, { field: "close_notes", visible: false }] },
          { key: "alert:snooze", when: { f: "state", op: "ne", v: "snoozed" }, actions: [{ field: "snoozed_until", visible: false }] },
        ],
      },
    },
    {
      table: "alert_group", path: "alert-groups", label: "گروه‌های هم‌بسته", noun: "گروه هم‌بسته", icon: Layers, section: ALERTS, access: EVENT, newAction: false,
      keywords: "گروه هم‌بسته موقعیت همبستگی SIT", search: { group: "گروه‌های هم‌بسته" },
      extensions: {
        headerActions: widget(GroupActions, "group-actions"),
        sidePanels: [{ key: "event:causes", title: "علت‌های محتمل", order: 1, render: widget(GroupInsightPanel) }],
      },
    },
    { table: "event", path: "events", label: "رویدادها", noun: "رویداد", icon: Activity, section: ALERTS, access: EVENT, newAction: false, search: false, keywords: "رویداد خام پایش ورودی" },
    { table: "oncall_schedule", path: "oncall/schedules", label: "برنامه‌های کشیک", noun: "برنامهٔ کشیک", icon: CalendarClock, section: ONCALL, access: ONCALL_GATE, keywords: "برنامه کشیک آنکال شیفت" },
    { table: "oncall_override", path: "oncall/overrides", label: "جایگزینی‌ها", noun: "جایگزینی کشیک", icon: UserRoundCog, section: ONCALL, access: ONCALL_GATE, keywords: "جایگزینی کشیک مرخصی جابه‌جایی شیفت" },
    { table: "escalation_policy", path: "oncall/policies", label: "سیاست‌های ارتقا", noun: "سیاست ارتقا", icon: ChevronsUp, section: ONCALL, access: ONCALL_GATE, keywords: "سیاست ارتقا اسکالیشن سطح" },
    { table: "page", path: "pages", label: "فراخوان‌ها", noun: "فراخوان", icon: BellPlus, section: ONCALL, access: ONCALL_GATE, newAction: false, keywords: "فراخوان پیج پیامک کشیک PG" },
    { table: "oncall_rotation", path: "oncall/rotations", label: "چرخش‌های کشیک", noun: "چرخش کشیک", icon: Repeat, hidden: true, search: false },
    { table: "escalation_level", path: "oncall/levels", label: "سطح‌های ارتقا", noun: "سطح ارتقا", icon: ChevronsUp, hidden: true, search: false },
    {
      table: "event_source", path: "event/sources", label: "منبع‌های رویداد", noun: "منبع رویداد", icon: RadioTower, section: DEFS, access: EVENT_DEFS, search: false,
      keywords: "منبع رویداد اتصال پایش Zabbix Prometheus Grafana Nagios Azure CloudWatch وب‌هوک کلید",
      extensions: { headerActions: widget(SourceKeyAction, "source-key") },
    },
    {
      table: "event_rule", path: "event/rules", label: "قاعده‌های پردازش رویداد", noun: "قاعدهٔ پردازش", icon: ListFilter, section: DEFS, access: EVENT_DEFS, search: false,
      keywords: "قاعده پالایش غنی‌سازی آستانه سرکوب رویداد",
      extensions: { headerActions: widget(RuleSimulate, "rule-simulate") },
    },
    { table: "correlation_rule", path: "event/correlation", label: "قاعده‌های هم‌بستگی", noun: "قاعدهٔ هم‌بستگی", icon: GitMerge, section: DEFS, access: EVENT_DEFS, search: false, keywords: "هم‌بستگی گروه‌بندی هشدار توپولوژی" },
    { table: "alert_incident_rule", path: "event/incident-rules", label: "هشدار به رخداد", noun: "قاعدهٔ ساخت رخداد", icon: Siren, section: DEFS, access: EVENT_DEFS, search: false, keywords: "قاعده ساخت رخداد از هشدار" },
    { table: "alert_route", path: "event/routes", label: "مسیریابی هشدار", noun: "قاعدهٔ مسیریابی", icon: Route, section: DEFS, access: EVENT_DEFS, search: false, keywords: "مسیریابی هشدار تیم سیاست ارتقا" },
    { table: "event_config", path: "event/settings", label: "تنظیمات رویداد و کشیک", icon: Settings2, hidden: true, search: false, newAction: false },
  ],
  nav: [
    { key: "event:console", label: "کنسول هشدارها", path: "event/console", icon: MonitorDot, section: ALERTS, access: EVENT, workspace: true, keywords: "کنسول هشدار مرکز عملیات NOC پایش", count: { key: "event:open", hint: "هشدار باز و تأییدنشده", load: openCount } },
    { key: "event:oncall", label: "کشیک", path: "oncall", icon: CalendarClock, section: ONCALL, access: ONCALL_GATE, workspace: true, keywords: "کشیک آنکال چه کسی کشیک است شیفت تقویم" },
    { key: "event:reports", label: "گزارش‌های عملیات", path: "event/reports", icon: ChartColumn, section: "گزارش‌ها", access: EVENT, keywords: "گزارش هشدار MTTA MTTR نویز کشیک بار" },
  ],
  routes: [
    { path: "event/console", element: lazyPage(<Console />) },
    { path: "oncall", element: lazyPage(<OnCall />) },
    { path: "event/reports", element: lazyPage(<Reports />) },
  ],
  segments: { alerts: "operations", "alert-groups": "operations", events: "operations", pages: "operations", oncall: "operations", event: "operations" },
});

// the console and on-call first, then every alert and the rest of the group
const [group] = module.nav;
const first = ["event:console", "event:oncall"];
export const eventUi: ModuleUi = {
  ...module,
  nav: [{ ...group, items: [...first.map((k) => group.items.find((i) => i.key === k)!).filter(Boolean), ...group.items.filter((i) => !first.includes(i.key))] }],
  publicRoutes: [{ path: "ack/:token", element: lazyPage(<AckPage />) }],
};

// incidents raised from monitoring show their alerts; open records show who is on call for their group; CIs their
// alerts — each only for those who may read alerts or schedules (the schema lists only readable tables)
registerRecordExtensions("incident", {
  sidePanels: [
    { key: "event:incident-alerts", title: "هشدارهای پایش", order: 6, when: (ctx) => ctx.row.channel === "monitoring" && !!ctx.schema.def("alert"), render: widget(IncidentAlerts) },
    { key: "event:incident-oncall", title: "کشیک گروه", order: 7, when: (ctx) => !!ctx.row.active && !!ctx.row.assignment_group_id && !!ctx.schema.def("oncall_schedule"), render: widget(OnCallPanel) },
  ],
});
registerRecordExtensions("ci", { sidePanels: [{ key: "event:ci-alerts", title: "هشدارهای باز", order: 8, when: (ctx) => !!ctx.schema.def("alert"), render: widget(CiAlerts) }] });
