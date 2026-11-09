// Field service's screens (docs/modules/field_service_FA.md): the sidebar space «خدمات میدانی» with the group
// «کار در محل»:
//   workspaces    «تابلوی توزیع» (timeline by technician, drag to assign), «کارهای امروز من» (the technician's phone view:
//                 route, steps, checklist, signature), queues of visits and work orders
//   pages         «داشبورد خدمات میدانی»
//   record page   visit: «پیشنهاد تکنسین» (dispatchers); work order: side panel «نوبت‌دهی»
//   lists         work orders, visits, templates, territories, technicians, parts, maintenance plans, time and costs
//   elsewhere     «ساخت دستور کار» on incidents, customer cases, facility requests and requested items
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { HardHat, Wrench, ClipboardList, Map, UserCog, Cog, CalendarCog, Timer, LayoutGrid, Smartphone, LayoutDashboard, Inbox, User, Clock } from "lucide-react";
import type { AccessGate } from "@shared/access";
import type { Cond } from "@shared/model/conditions";
import type { ModuleUi, NavItem } from "../registry";
import { recordModule, RecordListRoute } from "../../records/module";
import { registerRecordExtensions, type RecordContext } from "../../records/extensions";
import { recordsApi } from "../../records/data/api";
import { Loader } from "../../components/display";
import type { OrgApi } from "../../lib/api";
import { OPEN_VISIT } from "./model";

const DispatchBoard = lazy(() => import("./Board"));
const MyDay = lazy(() => import("./MyDay"));
const Dashboard = lazy(() => import("./Panels").then((m) => ({ default: m.Dashboard })));
const TaskAssign = lazy(() => import("./Panels").then((m) => ({ default: m.TaskAssign })));
const WorkOrderFrom = lazy(() => import("./Panels").then((m) => ({ default: m.WorkOrderFrom })));
const SlotsPanel = lazy(() => import("./Panels").then((m) => ({ default: m.SlotsPanel })));

const widget = (C: ComponentType<{ ctx: RecordContext }>) => (ctx: RecordContext): ReactNode => (
  <Suspense fallback={<Loader />}>
    <C ctx={ctx} />
  </Suspense>
);
const action = (key: string, C: ComponentType<{ ctx: RecordContext }>) => (ctx: RecordContext): ReactNode => (
  <Suspense key={key} fallback={null}>
    <C ctx={ctx} />
  </Suspense>
);
const lazyPage = (node: ReactNode) => <Suspense fallback={<Loader />}>{node}</Suspense>;

const READS: AccessGate = { area: "field_service" };
const DISPATCH: AccessGate = { area: "field_service", scope: "group" };
const ADMIN: AccessGate = { area: "field_service", op: "admin" };

export const FIELD_SPACE = { key: "field", label: "میدانی", title: "خدمات میدانی", icon: HardHat, access: READS };

interface Queue {
  key: string;
  label: string;
  path: string;
  table: string;
  filter: Cond;
  sort: string;
  empty: string;
  icon: typeof Inbox;
  access: AccessGate;
}

const QUEUES: Queue[] = [
  { key: "mine", table: "wo_task", label: "بازدیدهای من", path: "field/my-visits", icon: User, access: READS, sort: "scheduled_start", filter: { and: [{ f: "technician_id", op: "is_me" }, { f: "state", op: "in", v: OPEN_VISIT }] }, empty: "بازدید بازی به شما سپرده نشده است" },
  { key: "dispatch", table: "wo_task", label: "منتظر توزیع", path: "field/pending-dispatch", icon: Inbox, access: DISPATCH, sort: "priority,sla_due", filter: { f: "state", op: "eq", v: "pending_dispatch" }, empty: "وظیفه‌ای منتظر توزیع نیست" },
  { key: "parts", table: "wo_task", label: "منتظر قطعه", path: "field/pending-parts", icon: Clock, access: DISPATCH, sort: "updated_at", filter: { f: "state", op: "eq", v: "pending_parts" }, empty: "بازدیدی منتظر قطعه نیست" },
  { key: "open_wo", table: "work_order", label: "دستورهای کار باز گروه من", path: "field/open-work-orders", icon: HardHat, access: DISPATCH, sort: "priority,opened_at", filter: { and: [{ f: "assignment_group_id", op: "is_my_group" }, { f: "active", op: "eq", v: true }] }, empty: "دستور کار بازی در گروه‌های شما نیست" },
];

const myCount = async (api: OrgApi) => (await recordsApi.list(api, "wo_task", { filter: QUEUES[0].filter, size: 1, fields: ["number"], total: true })).total ?? 0;

const queueNav = (q: Queue, i: number): NavItem => ({
  key: `field:q:${q.key}`, label: q.label, path: q.path, icon: q.icon, area: "work", access: q.access, workspace: i < 2, keywords: "بازدید وظیفه تکنسین دستور کار صف",
  ...(i === 0 ? { count: { key: "field:mine", hint: "بازدید باز شما", load: myCount } } : {}),
});

const module = recordModule({
  key: "field",
  space: FIELD_SPACE,
  group: { key: "field", label: "کار در محل" },
  tables: [
    {
      table: "work_order", path: "field/work-orders", label: "دستورهای کار", noun: "دستور کار", icon: HardHat, area: "work", access: READS, keywords: "دستور کار WO میدانی نصب تعمیر", search: { group: "دستورهای کار" },
      list: { preset: { emptyText: "هنوز دستور کاری ثبت نشده است", board: { cardFields: ["priority", "work_type", "territory_id"] } } },
      extensions: { sidePanels: [{ key: "field:slots", title: "نوبت‌دهی", order: 2, render: widget(SlotsPanel) }], cardFields: ["priority", "work_type", "territory_id"] },
    },
    {
      table: "wo_task", path: "field/tasks", label: "وظیفه‌ها و بازدیدها", noun: "وظیفهٔ میدانی", icon: Wrench, area: "work", access: READS, keywords: "وظیفه بازدید WOT تکنسین", search: { group: "بازدیدها" },
      list: { preset: { emptyText: "وظیفه‌ای ثبت نشده است", calendar: { start: "scheduled_start", end: "scheduled_end" }, board: { cardFields: ["technician_id", "scheduled_start", "priority"] } } },
      extensions: { headerActions: action("field-assign", TaskAssign), cardFields: ["technician_id", "scheduled_start", "priority"] },
    },
    { table: "maintenance_plan", path: "field/maintenance-plans", label: "برنامه‌های نگهداری", noun: "برنامهٔ نگهداری", icon: CalendarCog, area: "work", access: READS, keywords: "نگهداری پیشگیرانه دوره‌ای PM" },
    { table: "parts_requirement", path: "field/parts", label: "قطعه‌های لازم", noun: "قطعهٔ لازم", icon: Cog, area: "work", access: READS, keywords: "قطعه انبار مصرف", newAction: false },
    { table: "field_time_entry", path: "field/time", label: "زمان و هزینه", noun: "ثبت زمان میدانی", icon: Timer, area: "work", access: READS, keywords: "زمان سفر کار هزینه" },
    { table: "technician", path: "field/technicians", label: "تکنسین‌ها", noun: "تکنسین", icon: UserCog, section: "تعریف‌ها", area: "work", access: READS, keywords: "تکنسین مهارت گواهی شیفت" },
    { table: "territory", path: "field/territories", label: "قلمروها", noun: "قلمرو", icon: Map, section: "تعریف‌ها", area: "work", access: READS, keywords: "قلمرو منطقه حوزه" },
    { table: "wo_task_template", path: "field/templates", label: "الگوهای وظیفه", noun: "الگوی وظیفه", icon: ClipboardList, section: "تعریف‌ها", area: "work", access: READS, keywords: "الگو چک‌لیست" },
    { table: "fsm_config", path: "field/settings", label: "تنظیمات خدمات میدانی", icon: Cog, section: "تعریف‌ها", area: "work", access: ADMIN, search: false, newAction: false },
  ],
  nav: [
    { key: "field:board", label: "تابلوی توزیع", path: "field/board", icon: LayoutGrid, area: "work", access: DISPATCH, workspace: true, keywords: "توزیع واگذاری تقویم تکنسین dispatch" },
    { key: "field:my-day", label: "کارهای امروز من", path: "field/my-day", icon: Smartphone, area: "work", access: READS, workspace: true, keywords: "امروز مسیر بازدید تکنسین امضا" },
    { key: "field:dashboard", label: "داشبورد خدمات میدانی", path: "field/dashboard", icon: LayoutDashboard, section: "گزارش‌ها", area: "work", access: READS, keywords: "شاخص حل در نخستین بازدید رسیدن به‌موقع" },
  ],
  routes: [
    ...QUEUES.map((q) => ({ path: q.path, element: <RecordListRoute table={q.table} title={q.label} preset={{ filter: q.filter, sort: q.sort, emptyText: q.empty }} /> })),
    { path: "field/board", element: lazyPage(<DispatchBoard />) },
    { path: "field/my-day", element: lazyPage(<MyDay />) },
    { path: "field/dashboard", element: lazyPage(<Dashboard />) },
  ],
  segments: { field: "field" },
});

// «ساخت دستور کار» on the records on-site work often starts from (each only where the table exists in the build)
for (const table of ["incident", "customer_case", "facility_request", "request_item"]) registerRecordExtensions(table, { headerActions: action("field-from", WorkOrderFrom) });

const [group] = module.nav;
export const fieldServiceUi: ModuleUi = {
  ...module,
  nav: [{ ...group, items: [...QUEUES.map(queueNav), ...group.items] }],
};
