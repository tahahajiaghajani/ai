// Incident management's screens (docs/modules/incident_FA.md). The module adds the sidebar space «عملیات» (incident
// and problem management; later the event and continuity modules) with the group «رخدادها»:
//   queues        «رخدادهای من» (with a live count), «بی‌مسئول در گروه‌های من», «اولویت بالا», «نزدیک به نقض توافق»,
//                 «منتظر درخواست‌دهنده», «حل‌شده امروز», «رخدادهای عمده», and every incident (list, board, saved views)
//   record page   quick actions (assign to me, escalate, the major-incident overlay, child / copy / follow-up, merge,
//                 problems, the review), side panels (major incident, similar incidents, matching known errors),
//                 canned responses in the composer, UI policies (hold reason, major-incident fields, the rating)
//   pages         the major incident's war room (with «اطلاعیهٔ قطعی»), the dashboard, the module's settings
//   lists         interactions («ثبت رخداد»), tasks, post-incident reviews, outage announcements (on air above the
//                 queues), periodic reviews
//                 («محاسبهٔ آمار» and the «آمار دوره» tab, under «گزارش‌ها»); definitions: templates, canned responses
// Only light modules are imported here; every component loads with its page.
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { Siren, ListChecks, ClipboardCheck, LayoutTemplate, MessageSquareText, Settings2, ChartColumn, User, Users, Flame, Timer, Hourglass, CheckCheck, OctagonAlert, Inbox, Megaphone, CalendarCheck, PhoneCall } from "lucide-react";
import type { ModuleUi, NavItem } from "../registry";
import { recordModule, RecordListRoute } from "../../records/module";
import { registerRecordExtensions, type RecordContext, type ComposerContext } from "../../records/extensions";
import { recordsApi } from "../../records/data/api";
import { Loader } from "../../components/display";
import type { OrgApi } from "../../lib/api";
import { QUEUES, rowTone, type Queue } from "./model";

const IncidentActions = lazy(() => import("./IncidentActions"));
const SimilarPanel = lazy(() => import("./SimilarPanel"));
const KnownErrorPanel = lazy(() => import("./KnownErrorPanel"));
const MajorPanel = lazy(() => import("./MajorPanel"));
const CannedPicker = lazy(() => import("./CannedPicker"));
const WarRoom = lazy(() => import("./WarRoom"));
const Dashboard = lazy(() => import("./Dashboard"));
const Settings = lazy(() => import("./Settings"));
const QueuePage = lazy(() => import("./QueuePage"));
const TemplatePicker = lazy(() => import("./TemplatePicker"));
const PeriodActions = lazy(() => import("./PeriodReview").then((m) => ({ default: m.PeriodActions })));
const InteractionActions = lazy(() => import("./InteractionActions"));
const PeriodStatsTab = lazy(() => import("./PeriodReview").then((m) => ({ default: m.PeriodStatsTab })));

/** A record-page widget that loads with first use. */
const widget = (C: ComponentType<{ ctx: RecordContext }>) => (ctx: RecordContext): ReactNode => (
  <Suspense fallback={<Loader />}>
    <C ctx={ctx} />
  </Suspense>
);

const lazyPage = (node: ReactNode) => <Suspense fallback={<Loader />}>{node}</Suspense>;

export const OPERATIONS_SPACE = { key: "operations", label: "عملیات", title: "رخدادها و مشکلات", icon: Siren };

const MAJOR_FIELDS = ["mi_manager_id", "mi_comms_id", "mi_declared_at", "mi_declared_by", "mi_reason", "bridge_url", "chat_url", "comm_cadence", "last_update_at", "next_update_at", "stakeholders", "business_impact"];
const DONE = { f: "state", op: "in" as const, v: ["resolved", "closed"] };

const ICONS: Record<string, typeof Siren> = { mine: User, unassigned: Users, high: Flame, "at-risk": Timer, awaiting: Hourglass, "resolved-today": CheckCheck, major: OctagonAlert };

/** The number of open incidents assigned to the caller (the nav count of «رخدادهای من»). */
const myCount = async (api: OrgApi) =>
  (await recordsApi.list(api, "incident", { filter: QUEUES[0].filter(Date.now()), size: 1, fields: ["number"], total: true })).total ?? 0;

const queueNav = (q: Queue, i: number): NavItem => ({
  key: `incident:q:${q.key}`,
  label: q.label,
  path: q.path,
  icon: ICONS[q.key] ?? Inbox,
  area: "work",
  workspace: i === 0,
  keywords: "رخداد صف کارتابل",
  ...(i === 0 ? { count: { key: "incident:mine", hint: "رخداد باز شما", load: myCount } } : {}),
});

const module = recordModule({
  key: "incident",
  space: OPERATIONS_SPACE,
  group: { key: "incident", label: "رخدادها" },
  tables: [
    {
      table: "incident", path: "incidents", label: "همهٔ رخدادها", noun: "رخداد", icon: Siren, area: "work",
      keywords: "رخداد قطعی خرابی اختلال حادثه INC",
      search: { group: "رخدادها" },
      list: {
        preset: { rowTone: (r) => rowTone(r), emptyText: "هنوز رخدادی ثبت نشده است" },
        actions: (
          <Suspense fallback={null}>
            <TemplatePicker />
          </Suspense>
        ),
      },
      extensions: {
        headerActions: (ctx) => (
          <Suspense key="incident-actions" fallback={null}>
            <IncidentActions ctx={ctx} />
          </Suspense>
        ),
        sidePanels: [
          { key: "incident:major", title: "رخداد عمده", order: 1, when: (ctx) => !!ctx.row.major_state, render: widget(MajorPanel) },
          { key: "incident:known-errors", title: "خطاهای شناخته‌شدهٔ منطبق", order: 2, when: (ctx) => !!ctx.row.active, render: widget(KnownErrorPanel) },
          { key: "incident:similar", title: "رخدادهای مشابه", order: 3, render: widget(SimilarPanel) },
        ],
        cannedResponses: (c: ComposerContext) => (
          <Suspense fallback={null}>
            <CannedPicker c={c} />
          </Suspense>
        ),
        cardFields: ["priority", "assigned_to", "sla_due"],
        policies: [
          { key: "incident:hold", when: { f: "state", op: "ne", v: "on_hold" }, actions: [{ field: "hold_reason", visible: false }] },
          { key: "incident:major", when: { f: "major_state", op: "empty" }, actions: MAJOR_FIELDS.map((field) => ({ field, visible: false })) },
          { key: "incident:feedback", when: { not: DONE }, actions: [{ field: "satisfaction", visible: false }, { field: "satisfaction_comment", visible: false }] },
          { key: "incident:merged", when: { f: "merged_into", op: "empty" }, actions: [{ field: "merged_into", visible: false }] },
          { key: "incident:follow", when: { f: "follow_up_of", op: "empty" }, actions: [{ field: "follow_up_of", visible: false }] },
        ],
      },
    },
    {
      table: "interaction", path: "interactions", label: "تعامل‌ها", noun: "تعامل", icon: PhoneCall, area: "work",
      keywords: "تعامل تماس تلفن گفتگو مراجعه حضوری INT",
      list: { preset: { quick: ["open"], emptyText: "تعاملی ثبت نشده است" } },
      extensions: {
        headerActions: (ctx) => (
          <Suspense key="interaction-actions" fallback={null}>
            <InteractionActions ctx={ctx} />
          </Suspense>
        ),
        policies: [{ key: "interaction:open", when: { f: "state", op: "eq", v: "open" }, actions: [{ field: "duration", visible: false }] }],
      },
    },
    { table: "incident_task", path: "incident-tasks", label: "کارهای رخداد", noun: "کار رخداد", icon: ListChecks, area: "work", keywords: "کار وظیفه رخداد ITASK", newAction: false },
    { table: "incident_review", path: "incident-reviews", label: "بازبینی‌های پس از رخداد", noun: "بازبینی پس از رخداد", icon: ClipboardCheck, area: "work", keywords: "بازبینی PIR گزارش درس‌آموخته", newAction: false },
    {
      table: "incident_period_review", path: "incident-period-reviews", label: "بازبینی‌های دوره‌ای", noun: "بازبینی دوره‌ای", icon: CalendarCheck, section: "گزارش‌ها", area: "work",
      keywords: "بازبینی دوره‌ای فصلی گزارش بهبود رخداد IPR",
      extensions: {
        headerActions: (ctx) => (
          <Suspense key="period-actions" fallback={null}>
            <PeriodActions ctx={ctx} />
          </Suspense>
        ),
        tabs: [{ key: "period:stats", label: "آمار دوره", order: 1, render: widget(PeriodStatsTab) }],
      },
    },
    { table: "announcement", path: "announcements", label: "اطلاعیه‌ها", noun: "اطلاعیه", icon: Megaphone, area: "work", keywords: "اطلاعیه قطعی اختلال نگهداری بنر اعلان همگانی ANN" },
    { table: "incident_template", path: "incidents/templates", label: "الگوهای رخداد", noun: "الگوی رخداد", icon: LayoutTemplate, section: "تعریف‌ها", area: "work", search: false, keywords: "الگو مدل رخداد" },
    { table: "incident_response", path: "incidents/responses", label: "پاسخ‌های آماده", noun: "پاسخ آماده", icon: MessageSquareText, section: "تعریف‌ها", area: "work", search: false, keywords: "پاسخ آماده متن آماده ماکرو" },
    { table: "incident_config", path: "incidents/settings/record", label: "تنظیمات رخداد", icon: Settings2, hidden: true, search: false, newAction: false },
  ],
  nav: [
    { key: "incident:dashboard", label: "داشبورد رخدادها", path: "incidents/dashboard", icon: ChartColumn, section: "گزارش‌ها", area: "work", keywords: "داشبورد شاخص MTTR MTTA گزارش رخداد" },
    { key: "incident:settings", label: "تنظیمات رخداد و مشکل", path: "incidents/settings", icon: Settings2, section: "تعریف‌ها", area: "settings", keywords: "تنظیمات بستن خودکار بازگشایی رخداد عمده پیش‌فرض" },
  ],
  routes: [
    ...QUEUES.map((q) => ({ path: q.path, element: lazyPage(<QueuePage queue={q.key} />) })),
    { path: "incidents/dashboard", element: lazyPage(<Dashboard />) },
    { path: "incidents/settings", element: lazyPage(<Settings />) },
    { path: "incidents/:id/war-room", element: lazyPage(<WarRoom />) },
  ],
  segments: { incidents: "operations", "incident-tasks": "operations", "incident-reviews": "operations", "incident-period-reviews": "operations", announcements: "operations", interactions: "operations" },
});

// queues first, then every incident and the rest of the group
const [group] = module.nav;
export const incidentUi: ModuleUi = {
  ...module,
  nav: [{ ...group, items: [...QUEUES.map(queueNav), ...group.items] }],
};

/** «همهٔ رخدادها» is the table's list; queues are list pages of the same table with a fixed filter. */
export { RecordListRoute };
