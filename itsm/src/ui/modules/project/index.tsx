// Project and portfolio management's screens (docs/modules/project_FA.md): the sidebar space «پروژه‌ها» with the
// group «پروژه و سبد»:
//   queues        «پروژه‌های من» (live count), «پروژه‌های در خطر», «کارهای پروژهٔ من», «ثبت زمان من»,
//                 «زمان‌های منتظر تأیید»
//   pages         «سبد پروژه‌ها» (health, progress, variance, money, demand pipeline), «تابلوی تقاضاها» (kanban by
//                 score), «بار منابع» (heat map), the full-width Gantt of a project
//   record page   project: header actions (status report, baseline, recalculation, copy as template), side panel
//                 «سلامت», tab «برنامهٔ زمانی» (Gantt); demand: side panel «امتیاز» with the conversion
//   lists         projects, tasks, demands, portfolios, RAID, status reports, allocations, time entries
//   elsewhere     «ساخت پروژه» on problems, changes and requested items
import { type ComponentType, type ReactNode } from "react";
import { lazy, Suspense } from "@ui/lib/lazy";
import {
  FolderKanban, ListTree, Lightbulb, Briefcase, ShieldAlert, FileChartColumn, UsersRound, Timer, User, TriangleAlert, ListTodo, Clock, Stamp, LayoutDashboard, Kanban, Grid3x3, Inbox,
} from "lucide-react";
import type { AccessGate } from "@shared/access";
import type { ModuleUi, NavItem } from "../registry";
import { recordModule, RecordListRoute } from "../../records/module";
import { registerRecordExtensions, type RecordContext } from "../../records/extensions";
import { recordsApi } from "../../records/data/api";
import { Loader } from "../../components/display";
import type { OrgApi } from "../../lib/api";
import { QUEUES, type Queue } from "./model";

const Demands = lazy(() => import("./Demands"));
const Portfolio = lazy(() => import("./Portfolio").then((m) => ({ default: m.Portfolio })));
const Resources = lazy(() => import("./Portfolio").then((m) => ({ default: m.Resources })));
const GanttPage = lazy(() => import("./GanttPage"));
const ProjectActions = lazy(() => import("./Panels").then((m) => ({ default: m.ProjectActions })));
const HealthPanel = lazy(() => import("./Panels").then((m) => ({ default: m.HealthPanel })));
const GanttTab = lazy(() => import("./Panels").then((m) => ({ default: m.GanttTab })));
const DemandScore = lazy(() => import("./Panels").then((m) => ({ default: m.DemandScore })));
const ProjectFrom = lazy(() => import("./Panels").then((m) => ({ default: m.ProjectFrom })));

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

const READS: AccessGate = { area: "project" };
const MANAGES: AccessGate = { area: "project", op: "approve" };

export const PROJECT_SPACE = { key: "project", label: "پروژه‌ها", title: "پروژه و سبد", icon: FolderKanban, access: READS };

const QUEUE_ICONS: Record<string, typeof Inbox> = { mine: User, at_risk: TriangleAlert, tasks: ListTodo, time: Clock, approve: Stamp };
const myCount = async (api: OrgApi) => (await recordsApi.list(api, "project", { filter: QUEUES[0].filter, size: 1, fields: ["number"], total: true })).total ?? 0;

const queueNav = (q: Queue, i: number): NavItem => ({
  key: `project:q:${q.key}`, label: q.label, path: q.path, icon: QUEUE_ICONS[q.key] ?? Inbox, area: "work", access: q.key === "approve" ? MANAGES : READS,
  workspace: i === 0, keywords: "پروژه صف کار زمان",
  ...(i === 0 ? { count: { key: "project:mine", hint: "پروژهٔ باز شما", load: myCount } } : {}),
});

const module = recordModule({
  key: "project",
  space: PROJECT_SPACE,
  group: { key: "project", label: "پروژه و سبد" },
  tables: [
    {
      table: "project", path: "projects", label: "همهٔ پروژه‌ها", noun: "پروژه", icon: FolderKanban, area: "work", access: READS, keywords: "پروژه PRJ برنامه گانت", search: { group: "پروژه‌ها" },
      list: { preset: { emptyText: "هنوز پروژه‌ای ثبت نشده است", board: { cardFields: ["health", "pct_complete", "planned_end"] }, timeline: { start: "planned_start", end: "planned_end" } } },
      extensions: {
        headerActions: action("project-actions", ProjectActions),
        sidePanels: [{ key: "project:health", title: "سلامت", order: 1, render: widget(HealthPanel) }],
        tabs: [{ key: "project:gantt", label: "برنامهٔ زمانی", order: 1, render: widget(GanttTab) }],
        cardFields: ["health", "pct_complete", "planned_end"],
      },
    },
    { table: "project_task", path: "project-tasks", label: "کارهای پروژه", noun: "کار پروژه", icon: ListTree, area: "work", access: READS, keywords: "کار نقطه عطف فاز PTASK" },
    {
      table: "demand", path: "demands", label: "تقاضاها", noun: "تقاضا", icon: Lightbulb, area: "work", access: READS, keywords: "تقاضا ایده پیشنهاد DMD",
      extensions: { sidePanels: [{ key: "project:score", title: "امتیاز", order: 1, render: widget(DemandScore) }], cardFields: ["score", "type", "needed_by"] },
    },
    { table: "portfolio", path: "portfolios", label: "سبدها", noun: "سبد پروژه", icon: Briefcase, area: "work", access: READS, keywords: "سبد برنامه portfolio" },
    { table: "raid_item", path: "projects/raid", label: "ریسک‌ها و مسئله‌ها", noun: "مورد RAID", icon: ShieldAlert, area: "work", access: READS, keywords: "ریسک مسئله تصمیم فرض RAID" },
    { table: "status_report", path: "projects/status-reports", label: "گزارش‌های وضعیت", noun: "گزارش وضعیت", icon: FileChartColumn, area: "work", access: READS, keywords: "گزارش وضعیت پروژه" },
    { table: "resource_allocation", path: "projects/allocations", label: "تخصیص منابع", noun: "تخصیص منبع", icon: UsersRound, area: "work", access: READS, keywords: "تخصیص منبع ظرفیت" },
    { table: "time_entry", path: "projects/time", label: "ثبت‌های زمان", noun: "ثبت زمان", icon: Timer, area: "work", access: READS, keywords: "زمان ساعت کارکرد timesheet" },
    { table: "project_config", path: "projects/settings", label: "تنظیمات پروژه‌ها", hidden: true, search: false, newAction: false },
  ],
  nav: [
    { key: "project:portfolio", label: "سبد پروژه‌ها", path: "projects/portfolio", icon: LayoutDashboard, area: "work", access: READS, workspace: true, keywords: "سبد داشبورد سلامت پروژه" },
    { key: "project:demands", label: "تابلوی تقاضاها", path: "projects/demand-board", icon: Kanban, area: "work", access: READS, workspace: true, keywords: "تقاضا کانبان امتیاز WSJF RICE" },
    { key: "project:resources", label: "بار منابع", path: "projects/resources", icon: Grid3x3, section: "گزارش‌ها", area: "work", access: READS, keywords: "منابع ظرفیت بار تخصیص" },
  ],
  routes: [
    ...QUEUES.map((q) => ({ path: q.path, element: <RecordListRoute table={q.table} title={q.label} preset={{ filter: q.filter, sort: q.sort, emptyText: q.empty }} /> })),
    { path: "projects/portfolio", element: lazyPage(<Portfolio />) },
    { path: "projects/demand-board", element: lazyPage(<Demands />) },
    { path: "projects/resources", element: lazyPage(<Resources />) },
    { path: "projects/:id/gantt", element: lazyPage(<GanttPage />) },
  ],
  segments: { projects: "project", "project-tasks": "project", demands: "project", portfolios: "project" },
});

// «ساخت پروژه» on the records a project often starts from
for (const table of ["problem", "change_request", "request_item"]) registerRecordExtensions(table, { headerActions: action("project-from", ProjectFrom) });

const [group] = module.nav;
export const projectUi: ModuleUi = {
  ...module,
  nav: [{ ...group, items: [...QUEUES.map(queueNav), ...group.items] }],
};
