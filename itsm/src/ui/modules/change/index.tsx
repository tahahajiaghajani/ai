// Change enablement's screens (docs/modules/change_FA.md). The module adds the sidebar space «تغییر» with the group
// «تغییرها»:
//   queues        «تغییرهای من» (with a live count), «در انتظار تأیید», «اجرای هفتهٔ پیش رو», «در حال اجرا»,
//                 «دارای تداخل», «تغییرهای اضطراری», «در بازبینی», and every change (list, board by state, calendar)
//   pages         «تقویم تغییرات» (timeline and Jalali month with windows, holidays and conflicts), «میز کار CAB»,
//                 «تغییرهای استاندارد» (the catalogue), «داشبورد تغییرات», «تنظیمات تغییر»
//   record page   header actions (hold / resume, backout, conflict check, copy, child changes, PIR, evidence), side
//                 panels (lifecycle and readiness, risk, conflicts, similar changes), tabs (risk questionnaire,
//                 scheduling and impact), UI policies of the form
//   lists         tasks, reviews, conflicts, outages, CAB meetings, lockdowns; definitions: templates and standard
//                 changes, models, windows, CABs, the risk questionnaire; the teams' success scores
//   elsewhere     «ثبت تغییر» on incidents, problems, known errors and requested items; «تغییرهای مشکوک» on incidents
// Only light modules are imported here; every component loads with its page.
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import {
  GitPullRequestArrow, ListChecks, ClipboardCheck, TriangleAlert, PowerOff, Presentation, ShieldBan, LayoutTemplate, Workflow, CalendarRange, UsersRound, ListOrdered, Gauge,
  CalendarDays, Gavel, Zap, ChartColumn, Settings2, User, Stamp, CalendarClock, Hammer, Siren, Eye, Inbox,
} from "lucide-react";
import type { AccessGate } from "@shared/access";
import { addDays } from "@shared/jalali";
import type { ModuleUi, NavItem } from "../registry";
import { recordModule, RecordListRoute } from "../../records/module";
import { registerCalendarDecor, registerRecordExtensions, type RecordContext } from "../../records/extensions";
import { recordsApi } from "../../records/data/api";
import type { UiPolicy } from "../../records/model/policies";
import { Loader } from "../../components/display";
import type { OrgApi } from "../../lib/api";
import { QUEUES, changeTone, windowBandsOf, type Queue, type WindowOcc } from "./model";
import { changeApi } from "./api";

const ChangeActions = lazy(() => import("./ChangeActions"));
const ChangeCalendar = lazy(() => import("./ChangeCalendar"));
const CabWorkbench = lazy(() => import("./CabWorkbench"));
const Catalogue = lazy(() => import("./Catalogue"));
const Dashboard = lazy(() => import("./Dashboard"));
const Settings = lazy(() => import("./Settings"));
const RiskPanel = lazy(() => import("./RiskPanel").then((m) => ({ default: m.RiskPanel })));
const RiskTab = lazy(() => import("./RiskPanel").then((m) => ({ default: m.RiskTab })));
const ReadinessPanel = lazy(() => import("./Panels").then((m) => ({ default: m.ReadinessPanel })));
const ConflictsPanel = lazy(() => import("./Panels").then((m) => ({ default: m.ConflictsPanel })));
const SimilarPanel = lazy(() => import("./Panels").then((m) => ({ default: m.SimilarPanel })));
const ScheduleTab = lazy(() => import("./Panels").then((m) => ({ default: m.ScheduleTab })));
const SuspectsPanel = lazy(() => import("./Panels").then((m) => ({ default: m.SuspectsPanel })));
const ChangeFromButton = lazy(() => import("./Panels").then((m) => ({ default: m.ChangeFromButton })));

/** A record-page widget that loads with first use. */
const widget = (C: ComponentType<{ ctx: RecordContext }>) => (ctx: RecordContext): ReactNode => (
  <Suspense fallback={<Loader />}>
    <C ctx={ctx} />
  </Suspense>
);
const lazyPage = (node: ReactNode) => <Suspense fallback={<Loader />}>{node}</Suspense>;

/** Who is offered the change screens (the server checks every route again): readers of the change area; the
 *  definitions (models, windows, CABs, the questionnaire, templates) for change managers (the area's approve right). */
const READS: AccessGate = { area: "change" };
const MANAGES: AccessGate = { area: "change", op: "approve" };

export const CHANGE_SPACE = { key: "change", label: "تغییر", title: "مدیریت تغییر", icon: GitPullRequestArrow, access: READS };

const PLANNING = ["new", "assess", "authorize", "scheduled"];
const DONE_FIELDS = ["close_code", "close_notes", "requester_confirmed", "implementation_rating", "lessons", "pir_required", "pir_id", "incidents_caused"];

/** The form's policies: fields that only matter in some states or types stay out of the way. */
export const CHANGE_POLICIES: UiPolicy[] = [
  { key: "change:hold", when: { f: "on_hold", op: "eq", v: false }, actions: [{ field: "on_hold_reason", visible: false }, { field: "on_hold_since", visible: false }] },
  { key: "change:blackout", when: { and: [{ f: "in_blackout", op: "eq", v: false }, { f: "blackout_override_reason", op: "empty" }] }, actions: [{ field: "blackout_override_reason", visible: false }] },
  { key: "change:manual-risk", when: { f: "risk_source", op: "ne", v: "manual" }, actions: [{ field: "risk_override_reason", visible: false }] },
  { key: "change:manual-risk-required", when: { f: "risk_source", op: "eq", v: "manual" }, actions: [{ field: "risk_override_reason", mandatory: true }], message: "ریسک دستی تعیین شده است؛ دلیل آن را بنویسید" },
  { key: "change:planning", when: { f: "state", op: "in", v: PLANNING }, actions: DONE_FIELDS.map((field) => ({ field, visible: false })) },
  { key: "change:actuals", when: { and: [{ f: "state", op: "in", v: ["new", "assess", "authorize", "scheduled"] }, { f: "type", op: "ne", v: "latent" }] }, actions: [{ field: "actual_start", visible: false }, { field: "actual_end", visible: false }, { field: "duration_actual", visible: false }] },
  { key: "change:latent", when: { f: "type", op: "ne", v: "latent" }, actions: [{ field: "discovered_by", visible: false }, { field: "retrospective", visible: false }] },
  { key: "change:cab", when: { f: "cab_meeting_id", op: "empty" }, actions: [{ field: "cab_meeting_id", visible: false }, { field: "cab_recommendation", visible: false }] },
  { key: "change:outage", when: { f: "outage_expected", op: "eq", v: false }, actions: [{ field: "outage_minutes", visible: false }] },
  { key: "change:emergency", when: { f: "type", op: "eq", v: "emergency" }, actions: [{ field: "justification", mandatory: true }], message: "تغییر اضطراری: دلیل فوریت را بنویسید", tone: "warning" },
];

const QUEUE_ICONS: Record<string, typeof Inbox> = { mine: User, approval: Stamp, week: CalendarClock, implementing: Hammer, conflicts: TriangleAlert, emergency: Siren, review: Eye };

/** Open changes the caller works on (the nav count of «تغییرهای من»). */
const myCount = async (api: OrgApi) => (await recordsApi.list(api, "change_request", { filter: QUEUES[0].filter, size: 1, fields: ["number"], total: true })).total ?? 0;

const queueNav = (q: Queue, i: number): NavItem => ({
  key: `change:q:${q.key}`,
  label: q.label,
  path: q.path,
  icon: QUEUE_ICONS[q.key] ?? Inbox,
  area: "work", access: READS,
  workspace: i === 0,
  keywords: "تغییر صف کارتابل RFC",
  ...(i === 0 ? { count: { key: "change:mine", hint: "تغییر باز شما", load: myCount } } : {}),
});

const rowTone = (r: Record<string, unknown>) => changeTone(r);

const DEFS = "تعریف‌ها";
const REPORTS = "گزارش‌ها";

const module = recordModule({
  key: "change",
  space: CHANGE_SPACE,
  group: { key: "change", label: "تغییرها" },
  tables: [
    {
      table: "change_request", path: "changes", label: "همهٔ تغییرها", noun: "تغییر", icon: GitPullRequestArrow, area: "work", access: READS,
      keywords: "تغییر درخواست تغییر RFC CHG استقرار ارتقا", search: { group: "تغییرها" },
      list: { preset: { rowTone, emptyText: "هنوز تغییری ثبت نشده است", board: { cardFields: ["risk", "planned_start", "assigned_to"] } } },
      extensions: {
        headerActions: (ctx) => (
          <Suspense key="change-actions" fallback={null}>
            <ChangeActions ctx={ctx} />
          </Suspense>
        ),
        sidePanels: [
          { key: "change:readiness", title: "مسیر و آمادگی", order: 1, render: widget(ReadinessPanel) },
          { key: "change:risk", title: "ریسک", order: 2, render: widget(RiskPanel) },
          { key: "change:conflicts", title: "تداخل‌ها", order: 3, when: (ctx) => ctx.row.conflict_status !== "not_checked" || !!ctx.row.planned_start, render: widget(ConflictsPanel) },
          { key: "change:similar", title: "تغییرهای مشابه", order: 6, render: widget(SimilarPanel) },
        ],
        tabs: [
          { key: "change:risk", label: "ارزیابی ریسک", order: 1, render: widget(RiskTab) },
          { key: "change:schedule", label: "زمان‌بندی و اثر", order: 2, render: widget(ScheduleTab) },
        ],
        policies: CHANGE_POLICIES,
        cardFields: ["risk", "planned_start", "assigned_to"],
      },
    },
    { table: "change_task", path: "change-tasks", label: "کارهای تغییر", noun: "کار تغییر", icon: ListChecks, area: "work", access: READS, keywords: "کار وظیفه تغییر CTASK", newAction: false },
    { table: "change_pir", path: "changes/reviews", label: "بازبینی‌های پس از اجرا", noun: "بازبینی پس از اجرا", icon: ClipboardCheck, area: "work", access: READS, keywords: "بازبینی PIR درس‌آموخته", newAction: false },
    { table: "cab_meeting", path: "changes/cab-meetings", label: "جلسه‌های CAB", noun: "جلسهٔ CAB", icon: Presentation, area: "work", access: READS, keywords: "جلسه CAB هیئت صورت‌جلسه" },
    { table: "change_conflict", path: "changes/conflicts", label: "تداخل‌ها", noun: "تداخل", icon: TriangleAlert, area: "work", access: READS, keywords: "تداخل برخورد هم‌پوشانی", newAction: false, search: false },
    { table: "change_outage", path: "changes/outages", label: "قطعی‌های برنامه‌ریزی‌شده", noun: "قطعی برنامه‌ریزی‌شده", icon: PowerOff, area: "work", access: READS, keywords: "قطعی افت خدمت" },
    { table: "change_lockdown", path: "changes/lockdowns", label: "قرنطینه‌های تغییرات", noun: "قرنطینهٔ تغییرات", icon: ShieldBan, area: "work", access: READS, keywords: "قرنطینه توقف تغییرات بحران" },
    { table: "change_template", path: "changes/templates", label: "الگوها و تغییرهای استاندارد", noun: "الگوی تغییر", icon: LayoutTemplate, section: DEFS, area: "work", access: MANAGES, keywords: "الگو تغییر استاندارد از پیش مجاز" },
    { table: "change_model", path: "changes/models", label: "مدل‌های تغییر", noun: "مدل تغییر", icon: Workflow, section: DEFS, area: "work", access: MANAGES, search: false, keywords: "مدل چرخه عمر مرحله" },
    { table: "change_window", path: "changes/windows", label: "پنجره‌های زمانی", noun: "پنجرهٔ زمانی", icon: CalendarRange, section: DEFS, area: "work", access: MANAGES, search: false, keywords: "پنجره نگهداری ممنوعیت انجماد blackout freeze" },
    { table: "cab", path: "changes/cabs", label: "هیئت‌های CAB", noun: "هیئت CAB", icon: UsersRound, section: DEFS, area: "work", access: MANAGES, search: false, keywords: "CAB ECAB هیئت مشاوران" },
    { table: "change_risk_question", path: "changes/risk-questions", label: "پرسش‌نامهٔ ریسک", noun: "پرسش ریسک", icon: ListOrdered, section: DEFS, area: "work", access: MANAGES, search: false, keywords: "ریسک پرسش‌نامه امتیاز" },
    { table: "change_success_score", path: "changes/scores", label: "امتیاز موفقیت تیم‌ها", icon: Gauge, section: REPORTS, area: "work", access: READS, search: false, newAction: false, keywords: "امتیاز موفقیت تیم" },
    { table: "cab_agenda_item", path: "changes/agenda-items", label: "موردهای دستور جلسه", hidden: true, search: false, newAction: false },
    { table: "change_config", path: "changes/settings/record", label: "تنظیمات تغییر", icon: Settings2, hidden: true, search: false, newAction: false },
  ],
  nav: [
    { key: "change:calendar", label: "تقویم تغییرات", path: "changes/calendar", icon: CalendarDays, area: "work", access: READS, workspace: true, keywords: "تقویم برنامهٔ تغییرات FSC زمان‌بندی" },
    { key: "change:cab", label: "میز کار CAB", path: "changes/cab", icon: Gavel, area: "work", access: READS, keywords: "CAB جلسه تأیید رأی دستور جلسه" },
    { key: "change:catalog", label: "تغییرهای استاندارد", path: "changes/catalog", icon: Zap, area: "work", access: READS, keywords: "تغییر استاندارد فهرست از پیش مجاز" },
    { key: "change:dashboard", label: "داشبورد تغییرات", path: "changes/dashboard", icon: ChartColumn, section: REPORTS, area: "work", access: READS, keywords: "داشبورد شاخص نرخ موفقیت تغییر" },
    { key: "change:settings", label: "تنظیمات تغییر", path: "changes/settings", icon: Settings2, section: DEFS, area: "settings", access: MANAGES, keywords: "تنظیمات ریسک مهلت CAB تغییر" },
  ],
  routes: [
    ...QUEUES.map((q) => ({ path: q.path, element: <RecordListRoute table="change_request" title={q.label} preset={{ filter: q.filter, sort: q.sort, emptyText: q.empty, rowTone }} /> })),
    { path: "changes/calendar", element: lazyPage(<ChangeCalendar />) },
    { path: "changes/cab", element: lazyPage(<CabWorkbench />) },
    { path: "changes/catalog", element: lazyPage(<Catalogue />) },
    { path: "changes/dashboard", element: lazyPage(<Dashboard />) },
    { path: "changes/settings", element: lazyPage(<Settings />) },
  ],
  segments: { changes: "change", "change-tasks": "change" },
});

// «ثبت تغییر» on the records a change is often initiated from, and the suspect-change finder on incidents (for those
// who read changes)
const fromButton = (ctx: RecordContext) => (
  <Suspense key="change-from" fallback={null}>
    <ChangeFromButton ctx={ctx} />
  </Suspense>
);
for (const table of ["incident", "problem", "known_error", "request_item"]) registerRecordExtensions(table, { headerActions: fromButton });
// the list's calendar and timeline modes: maintenance / blackout / freeze windows behind the changes, conflicts and
// blackouts outlined (the record kit's bands and tones)
registerCalendarDecor("change_request", {
  tone: (r) => changeTone(r),
  fields: ["conflict_status", "conflict_count", "in_blackout", "outside_window", "is_late", "on_hold"],
  bands: {
    key: "change:windows",
    load: async (api, w) => {
      // a day on each side covers the window in any time zone (the timeline clips what lies outside)
      const d = await changeApi.calendar(api, { from: `${addDays(w.from, -1)}T00:00:00Z`, to: `${addDays(w.to, 1)}T23:59:59Z` });
      return windowBandsOf((d.windows ?? []) as WindowOcc[]);
    },
  },
});
registerRecordExtensions("incident", {
  sidePanels: [{ key: "change:suspects", title: "تغییرهای مشکوک", order: 40, when: (ctx) => !!ctx.schema.def("change_request"), render: widget(SuspectsPanel) }],
});

// queues first, then every change and the rest of the group
const [group] = module.nav;
export const changeUi: ModuleUi = {
  ...module,
  nav: [{ ...group, items: [...QUEUES.map(queueNav), ...group.items] }],
};
