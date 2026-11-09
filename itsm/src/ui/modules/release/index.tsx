// Release and deployment management's screens (docs/modules/release_FA.md). The module adds the sidebar space
// «انتشار» (DevOps joins it) with the group «انتشارها»:
//   queues        «انتشارهای من» (live count), «در انتظار تصمیم اجرا», «در حال استقرار», «پشتیبانی آغازین»,
//                 «انتشارهای پرریسک», «انتشارهای اضطراری»; deployments awaiting approval and failed ones
//   pages         «نقشهٔ راه انتشار» (timeline with release windows and freezes as bands), «تابلوی آمادگی» (checks,
//                 waivers, go/no-go), «داشبورد انتشار»
//   record page   release: header actions (checks, decision, briefing, notes), side panel «مسیر و آمادگی», tab
//                 «دامنه و ردیابی»; deployment: side panel «ریسک استقرار»
//   lists         releases, tasks, deployments, notes, defects, feature flags, artifacts (DML), environment bookings;
//                 definitions for release managers: templates, policies, the check library, environments, windows
// Only light modules are imported here; every component loads with its page.
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import {
  Rocket, ListChecks, ServerCog, Newspaper, Bug, Flag, Package, CalendarCheck, LayoutTemplate, ScrollText, ClipboardCheck, Layers, CalendarRange, Map as MapIcon, Gauge, ChartColumn,
  User, Gavel, Hammer, LifeBuoy, TriangleAlert, Siren, Stamp, OctagonX, Inbox,
} from "lucide-react";
import type { AccessGate } from "@shared/access";
import { addDays } from "@shared/jalali";
import type { ModuleUi, NavItem } from "../registry";
import { recordModule, RecordListRoute } from "../../records/module";
import { registerCalendarDecor, type RecordContext } from "../../records/extensions";
import { recordsApi } from "../../records/data/api";
import type { UiPolicy } from "../../records/model/policies";
import { Loader } from "../../components/display";
import type { OrgApi } from "../../lib/api";
import { DEPLOYMENT_QUEUES, QUEUES, rowTone, type Queue } from "./model";
import { releaseApi } from "./api";

const Roadmap = lazy(() => import("./Roadmap"));
const Readiness = lazy(() => import("./Readiness"));
const Dashboard = lazy(() => import("./Dashboard"));
const ReleaseActions = lazy(() => import("./Panels").then((m) => ({ default: m.ReleaseActions })));
const ReadinessPanel = lazy(() => import("./Panels").then((m) => ({ default: m.ReadinessPanel })));
const ScopeTab = lazy(() => import("./Panels").then((m) => ({ default: m.ScopeTab })));
const DeploymentRisk = lazy(() => import("./Panels").then((m) => ({ default: m.DeploymentRisk })));

const widget = (C: ComponentType<{ ctx: RecordContext }>) => (ctx: RecordContext): ReactNode => (
  <Suspense fallback={<Loader />}>
    <C ctx={ctx} />
  </Suspense>
);
const lazyPage = (node: ReactNode) => <Suspense fallback={<Loader />}>{node}</Suspense>;

/** Readers of the release area see the space; definitions are the release manager's (the area's approve right). */
const READS: AccessGate = { area: "release" };
const MANAGES: AccessGate = { area: "release", op: "approve" };

export const RELEASE_SPACE = { key: "release", label: "انتشار", title: "انتشار و دواپس", icon: Rocket, access: READS };

/** Fields of the release form that only matter in some states. */
export const RELEASE_POLICIES: UiPolicy[] = [
  { key: "release:hold", when: { f: "state", op: "ne", v: "on_hold" }, actions: [{ field: "hold_reason", visible: false }, { field: "frozen_until", visible: false }] },
  { key: "release:closure", when: { f: "state", op: "in", v: ["draft", "planning", "build", "test", "readiness", "on_hold"] }, actions: ["close_code", "close_notes", "lessons", "els_incidents", "rolled_back", "on_schedule"].map((field) => ({ field, visible: false })) },
  { key: "release:emergency", when: { f: "type", op: "eq", v: "emergency" }, actions: [{ field: "rollback_plan", mandatory: true }], message: "انتشار اضطراری: برنامهٔ بازگشت را پیش از تصمیم بنویسید", tone: "warning" },
];

const QUEUE_ICONS: Record<string, typeof Inbox> = { mine: User, decision: Gavel, deploying: Hammer, els: LifeBuoy, risky: TriangleAlert, emergency: Siren, approval: Stamp, failed: OctagonX };

const myCount = async (api: OrgApi) => (await recordsApi.list(api, "release", { filter: QUEUES[0].filter, size: 1, fields: ["number"], total: true })).total ?? 0;

const queueNav = (q: Queue, i: number, table: string): NavItem => ({
  key: `release:q:${table}:${q.key}`,
  label: q.label,
  path: q.path,
  icon: QUEUE_ICONS[q.key] ?? Inbox,
  area: "work", access: READS,
  workspace: i === 0 && table === "release",
  keywords: "انتشار استقرار صف",
  ...(i === 0 && table === "release" ? { count: { key: "release:mine", hint: "انتشار باز شما", load: myCount } } : {}),
});

const DEFS = "تعریف‌ها";
const REPORTS = "گزارش‌ها";

const module = recordModule({
  key: "release",
  space: RELEASE_SPACE,
  group: { key: "release", label: "انتشارها" },
  tables: [
    {
      table: "release", path: "releases", label: "همهٔ انتشارها", noun: "انتشار", icon: Rocket, area: "work", access: READS,
      keywords: "انتشار ریلیز نسخه REL عرضه قطار", search: { group: "انتشارها" },
      list: { preset: { rowTone, emptyText: "هنوز انتشاری ثبت نشده است", board: { cardFields: ["version_name", "planned_end", "risk_band"] }, timeline: { start: "planned_start", end: "planned_end" } } },
      extensions: {
        headerActions: (ctx) => (
          <Suspense key="release-actions" fallback={null}>
            <ReleaseActions ctx={ctx} />
          </Suspense>
        ),
        sidePanels: [{ key: "release:readiness", title: "مسیر و آمادگی", order: 1, render: widget(ReadinessPanel) }],
        tabs: [{ key: "release:scope", label: "دامنه و ردیابی", order: 1, render: widget(ScopeTab) }],
        policies: RELEASE_POLICIES,
        cardFields: ["version_name", "planned_end", "risk_band"],
      },
    },
    { table: "release_task", path: "release-tasks", label: "کارهای انتشار", noun: "کار انتشار", icon: ListChecks, area: "work", access: READS, keywords: "کار وظیفه انتشار RTASK" },
    {
      table: "deployment", path: "deployments", label: "استقرارها", noun: "استقرار", icon: ServerCog, area: "work", access: READS, keywords: "استقرار دیپلوی DEP محیط",
      extensions: { sidePanels: [{ key: "release:deployment-risk", title: "ریسک استقرار", order: 2, render: widget(DeploymentRisk) }] },
    },
    { table: "release_note", path: "releases/notes", label: "یادداشت‌های انتشار", noun: "یادداشت انتشار", icon: Newspaper, area: "work", access: READS, keywords: "یادداشت انتشار تغییرات نسخه" },
    { table: "defect", path: "defects", label: "نقص‌ها", noun: "نقص", icon: Bug, area: "work", access: READS, keywords: "نقص باگ اشکال آزمون DEF" },
    { table: "feature_flag", path: "releases/flags", label: "پرچم‌های ویژگی", noun: "پرچم ویژگی", icon: Flag, area: "work", access: READS, keywords: "پرچم ویژگی feature flag عرضهٔ تدریجی" },
    { table: "artifact", path: "releases/artifacts", label: "کتابخانهٔ نرم‌افزار (DML)", noun: "بستهٔ نرم‌افزاری", icon: Package, area: "work", access: READS, keywords: "بسته نسخه DML SBOM امضا" },
    { table: "environment_booking", path: "releases/bookings", label: "رزرو محیط‌ها", noun: "رزرو محیط", icon: CalendarCheck, area: "work", access: READS, keywords: "رزرو محیط آزمون" },
    { table: "release_template", path: "releases/templates", label: "الگوهای انتشار", noun: "الگوی انتشار", icon: LayoutTemplate, section: DEFS, area: "work", access: MANAGES, keywords: "الگو انتشار فهرست آمادگی" },
    { table: "release_policy", path: "releases/policies", label: "خط‌مشی‌های انتشار", noun: "خط‌مشی انتشار", icon: ScrollText, section: DEFS, area: "work", access: MANAGES, search: false, keywords: "خط‌مشی انتشار رویه اضطراری" },
    { table: "release_check", path: "releases/checks", label: "بررسی‌های آمادگی", noun: "بررسی آمادگی", icon: ClipboardCheck, section: DEFS, area: "work", access: MANAGES, search: false, keywords: "بررسی آمادگی قاعده" },
    { table: "release_environment", path: "releases/environments", label: "محیط‌ها", noun: "محیط", icon: Layers, section: DEFS, area: "work", access: MANAGES, keywords: "محیط آزمون پیش‌تولید عملیاتی" },
    { table: "release_window", path: "releases/windows", label: "پنجره‌ها و توقف‌ها", noun: "پنجرهٔ انتشار", icon: CalendarRange, section: DEFS, area: "work", access: MANAGES, search: false, keywords: "پنجره قطار انتشار توقف انجماد" },
    { table: "release_check_result", path: "releases/check-results", label: "نتیجه‌های بررسی", hidden: true, search: false, newAction: false },
    { table: "release_decision", path: "releases/decisions", label: "تصمیم‌های اجرا", hidden: true, search: false, newAction: false },
    { table: "release_config", path: "releases/settings", label: "تنظیمات انتشار", hidden: true, search: false, newAction: false },
  ],
  nav: [
    { key: "release:roadmap", label: "نقشهٔ راه انتشار", path: "releases/roadmap", icon: MapIcon, area: "work", access: READS, workspace: true, keywords: "نقشه راه تقویم انتشار قطار پنجره" },
    { key: "release:readiness", label: "تابلوی آمادگی", path: "releases/readiness", icon: Gauge, area: "work", access: READS, workspace: true, keywords: "آمادگی تصمیم اجرا go no-go بررسی" },
    { key: "release:dashboard", label: "داشبورد انتشار", path: "releases/dashboard", icon: ChartColumn, section: REPORTS, area: "work", access: READS, keywords: "داشبورد گزارش انتشار" },
  ],
  routes: [
    ...QUEUES.map((q) => ({ path: q.path, element: <RecordListRoute table="release" title={q.label} preset={{ filter: q.filter, sort: q.sort, emptyText: q.empty, rowTone }} /> })),
    ...DEPLOYMENT_QUEUES.map((q) => ({ path: q.path, element: <RecordListRoute table="deployment" title={q.label} preset={{ filter: q.filter, sort: q.sort, emptyText: q.empty }} /> })),
    { path: "releases/roadmap", element: lazyPage(<Roadmap />) },
    { path: "releases/readiness", element: lazyPage(<Readiness />) },
    { path: "releases/dashboard", element: lazyPage(<Dashboard />) },
  ],
  segments: { releases: "release", "release-tasks": "release", deployments: "release", defects: "release" },
});

// the list's calendar and timeline modes of releases: the release windows and freezes behind them
registerCalendarDecor("release", {
  tone: (r) => rowTone(r),
  fields: ["planned_end", "state", "risk_band", "rolled_back"],
  bands: {
    key: "release:windows",
    load: async (api, w) => {
      const d = await releaseApi.roadmap(api, { from: `${addDays(w.from, -1)}T00:00:00Z`, to: `${addDays(w.to, 1)}T23:59:59Z` });
      return d.bands;
    },
  },
});

const [group] = module.nav;
export const releaseUi: ModuleUi = {
  ...module,
  nav: [{ ...group, items: [...QUEUES.map((q, i) => queueNav(q, i, "release")), ...DEPLOYMENT_QUEUES.map((q, i) => queueNav(q, i + 1, "deployment")), ...group.items] }],
};
