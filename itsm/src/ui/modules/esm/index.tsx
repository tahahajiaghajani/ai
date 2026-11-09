// Enterprise service management's screens (docs/modules/esm_FA.md): the sidebar space «خدمات سازمانی» with the group
// «واحدها»:
//   workspaces    «میز واحدها» (my departments, «کجا بپرسم؟», my open cases), «کارهای من در واحدها» (HR tasks and
//                 journeys), the HR and facilities queues, «مراجعه‌کنندگان امروز» (reception), «رزرو فضا»
//   pages         a department's home (esm/d/:key, signature screen), «آغاز سفر کارمند», the journey tracker
//                 (hr/journeys/:id/tracker, signature screen; also the tab «ردیاب سفر» of a journey)
//   record page   every department case: «انتقال به واحد دیگر», «کار از واحد دیگر»; a new case opened from a service
//                 starts with that service (…/new?service=<id>)
//   lists         HR cases, tasks, journeys, profiles; facility requests, safety events, spaces, reservations, visits;
//                 finance, legal, purchase and other department cases; departments, services, journey templates
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import {
  Building2, UserRoundCog, ClipboardCheck, Route, IdCard, Wrench, HardHat, DoorOpen, CalendarCheck, BadgeCheck, Landmark, Scale, ShoppingCart, Briefcase, ConciergeBell, ListChecks, Settings, ListTodo, CalendarRange, User, Inbox, UserCheck,
} from "lucide-react";
import type { AccessGate } from "@shared/access";
import type { ModuleUi, NavItem } from "../registry";
import { recordModule, RecordListRoute } from "../../records/module";
import type { RecordContext, RecordExtensions } from "../../records/extensions";
import { Loader } from "../../components/display";
import { QUEUES, type Queue } from "./model";

const Departments = lazy(() => import("./Departments").then((m) => ({ default: m.Departments })));
const DepartmentHome = lazy(() => import("./Departments").then((m) => ({ default: m.DepartmentHome })));
const MyCases = lazy(() => import("./Departments").then((m) => ({ default: m.MyCases })));
const TrackerPage = lazy(() => import("./JourneyTracker"));
const JourneyTracker = lazy(() => import("./JourneyTracker").then((m) => ({ default: m.JourneyTracker })));
const StartJourney = lazy(() => import("./StartJourney"));
const MyTodos = lazy(() => import("./MyTodos"));
const Booking = lazy(() => import("./Booking"));
const CaseActions = lazy(() => import("./Panels").then((m) => ({ default: m.CaseActions })));

const action = (key: string, C: ComponentType<{ ctx: RecordContext }>) => (ctx: RecordContext): ReactNode => (
  <Suspense key={key} fallback={null}>
    <C ctx={ctx} />
  </Suspense>
);
const lazyPage = (node: ReactNode) => <Suspense fallback={<Loader />}>{node}</Suspense>;

const HR: AccessGate = { area: "hr" };
const HR_TEAM: AccessGate = { area: "hr", scope: "group" };
const FAC: AccessGate = { area: "facilities" };
const FAC_TEAM: AccessGate = { area: "facilities", scope: "group" };
const DEPT: AccessGate = { area: "request" };
const ESM_ADMIN: AccessGate = { area: "esm" };

export const ESM_SPACE = { key: "esm", label: "واحدها", title: "خدمات سازمانی", icon: Building2 };

/** A department case table: the transfer and child actions, and the service a new case starts with. */
const caseExt = (extra: RecordExtensions = {}): RecordExtensions => ({
  headerActions: action("esm-case", CaseActions),
  defaults: (s) => (s.get("service") ? { dept_service_id: s.get("service") } : {}),
  ...extra,
});

const QUEUE_ICONS: Record<string, typeof Inbox> = { hr_mine: User, hr_group: Inbox, fac_group: Wrench, visits_today: UserCheck };
const QUEUE_ACCESS: Record<string, AccessGate> = { hr_mine: HR, hr_group: HR_TEAM, fac_group: FAC_TEAM, visits_today: FAC_TEAM };
const queueNav = (q: Queue): NavItem => ({ key: `esm:q:${q.key}`, label: q.label, path: q.path, icon: QUEUE_ICONS[q.key] ?? Inbox, area: "work", access: QUEUE_ACCESS[q.key], workspace: true, keywords: "صف پرونده واحد" });

const module = recordModule({
  key: "esm",
  space: ESM_SPACE,
  group: { key: "esm", label: "واحدها" },
  tables: [
    { table: "hr_case", path: "hr/cases", label: "پرونده‌های منابع انسانی", noun: "پروندهٔ منابع انسانی", icon: UserRoundCog, section: "منابع انسانی", area: "work", access: HR, keywords: "منابع انسانی HR حقوق مرخصی بیمه", search: { group: "پرونده‌های منابع انسانی" }, extensions: caseExt() },
    { table: "hr_task", path: "hr/tasks", label: "کارهای منابع انسانی", noun: "کار منابع انسانی", icon: ClipboardCheck, section: "منابع انسانی", area: "work", access: HR, keywords: "کار امضا فرم آموزش" },
    {
      table: "journey", path: "hr/journeys", label: "سفرهای کارکنان", noun: "سفر کارمند", icon: Route, section: "منابع انسانی", area: "work", access: HR, keywords: "سفر ورود خروج کارمند onboarding offboarding", newAction: false,
      list: { preset: { emptyText: "هنوز سفری آغاز نشده است" } },
      extensions: { tabs: [{ key: "esm:tracker", label: "ردیاب سفر", order: 1, render: (ctx) => <Suspense fallback={<Loader />}><JourneyTracker id={ctx.row.id} inline /></Suspense> }] },
    },
    { table: "journey_activity", path: "hr/activities", label: "فعالیت‌های سفر", noun: "فعالیت سفر", icon: ListChecks, section: "منابع انسانی", area: "work", access: HR, keywords: "فعالیت سفر", newAction: false, hidden: true },
    { table: "hr_profile", path: "hr/profiles", label: "نمایه‌های استخدامی", noun: "نمایهٔ استخدامی", icon: IdCard, section: "منابع انسانی", area: "work", access: HR_TEAM, keywords: "نمایه استخدام کارمند" },
    { table: "hr_case_note", path: "hr/notes", label: "یادداشت‌های روابط کار", hidden: true, search: false, newAction: false },
    { table: "facility_request", path: "facilities/requests", label: "درخواست‌های پشتیبانی", noun: "درخواست پشتیبانی و تأسیسات", icon: Wrench, section: "پشتیبانی و تدارکات", area: "work", access: FAC, keywords: "تأسیسات تعمیر نظافت جابه‌جایی", search: { group: "درخواست‌های پشتیبانی" }, extensions: caseExt() },
    { table: "reservation", path: "facilities/reservations", label: "رزروها", noun: "رزرو", icon: CalendarCheck, section: "پشتیبانی و تدارکات", area: "work", access: FAC, keywords: "رزرو اتاق جلسه میز", list: { preset: { calendar: { start: "start_at", end: "end_at" } } } },
    { table: "visit", path: "facilities/visits", label: "مراجعه‌کنندگان", noun: "مراجعه‌کننده", icon: BadgeCheck, section: "پشتیبانی و تدارکات", area: "work", access: FAC, keywords: "مهمان مراجعه پذیرش کارت" },
    { table: "space", path: "facilities/spaces", label: "فضاها و منابع", noun: "فضا", icon: DoorOpen, section: "پشتیبانی و تدارکات", area: "work", access: FAC, keywords: "فضا اتاق میز ساختمان" },
    { table: "hse_event", path: "facilities/hse", label: "ایمنی و بهداشت کار", noun: "رویداد ایمنی", icon: HardHat, section: "پشتیبانی و تدارکات", area: "work", access: FAC, keywords: "ایمنی حادثه HSE", extensions: caseExt() },
    { table: "finance_case", path: "finance/cases", label: "پرونده‌های مالی", noun: "پروندهٔ مالی", icon: Landmark, section: "مالی، حقوقی و خرید", area: "work", access: DEPT, keywords: "مالی هزینه پرداخت فاکتور", extensions: caseExt() },
    { table: "legal_request", path: "legal/requests", label: "درخواست‌های حقوقی", noun: "درخواست حقوقی", icon: Scale, section: "مالی، حقوقی و خرید", area: "work", access: DEPT, keywords: "حقوقی قرارداد بازبینی", extensions: caseExt() },
    { table: "purchase_request", path: "procurement/requests", label: "درخواست‌های خرید", noun: "درخواست خرید", icon: ShoppingCart, section: "مالی، حقوقی و خرید", area: "work", access: DEPT, keywords: "خرید تدارکات پیش‌فاکتور", extensions: caseExt() },
    { table: "service_case", path: "departments/cases", label: "پرونده‌های واحدهای دیگر", noun: "پروندهٔ واحد", icon: Briefcase, section: "مالی، حقوقی و خرید", area: "work", access: DEPT, keywords: "پرونده واحد", extensions: caseExt() },
    { table: "esm_department", path: "esm/departments", label: "واحدها", noun: "واحد خدمت‌دهنده", icon: Building2, section: "تعریف‌ها", area: "work", access: ESM_ADMIN, keywords: "واحد فضای کاری راه‌اندازی" },
    { table: "esm_service", path: "esm/services", label: "خدمت‌های واحدها", noun: "خدمت واحد", icon: ConciergeBell, section: "تعریف‌ها", area: "work", access: ESM_ADMIN, keywords: "خدمت واحد مخاطب" },
    { table: "journey_template", path: "esm/journey-templates", label: "الگوهای سفر", noun: "الگوی سفر", icon: Route, section: "تعریف‌ها", area: "work", access: ESM_ADMIN, keywords: "الگو سفر ورود خروج" },
    { table: "journey_template_activity", path: "esm/journey-template-activities", label: "فعالیت‌های الگوهای سفر", noun: "فعالیت الگو", hidden: true, search: false },
    { table: "esm_config", path: "esm/settings", label: "تنظیمات خدمات سازمانی", icon: Settings, section: "تعریف‌ها", area: "work", access: { area: "esm", op: "admin" }, search: false, newAction: false },
  ],
  nav: [
    { key: "esm:home", label: "میز واحدها", path: "esm", icon: Building2, area: "work", workspace: true, keywords: "واحد منابع انسانی مالی حقوقی پشتیبانی کجا بپرسم" },
    { key: "esm:todos", label: "کارهای من در واحدها", path: "esm/my-todos", icon: ListTodo, area: "work", workspace: true, keywords: "کار من امضا آموزش سفر" },
    { key: "esm:book", label: "رزرو فضا", path: "facilities/book", icon: CalendarRange, area: "work", access: FAC, workspace: true, keywords: "رزرو اتاق جلسه میز" },
    { key: "esm:journey:start", label: "آغاز سفر کارمند", path: "hr/journeys/start", icon: Route, area: "work", access: { area: "hr", op: "create" }, action: true, keywords: "سفر ورود کارمند تازه onboarding" },
  ],
  routes: [
    ...QUEUES.map((q) => ({ path: q.path, element: <RecordListRoute table={q.table} title={q.label} preset={{ filter: q.filter, sort: q.sort, emptyText: q.empty }} /> })),
    { path: "esm", element: lazyPage(<Departments />) },
    { path: "esm/d/:key", element: lazyPage(<DepartmentHome />) },
    { path: "esm/my-todos", element: lazyPage(<MyTodos />) },
    { path: "esm/my-cases", element: lazyPage(<MyCases />) },
    { path: "facilities/book", element: lazyPage(<Booking />) },
    { path: "hr/journeys/start", element: lazyPage(<StartJourney />) },
    { path: "hr/journeys/:id/tracker", element: lazyPage(<TrackerPage />) },
  ],
  segments: { esm: "esm", hr: "esm", facilities: "esm", finance: "esm", legal: "esm", procurement: "esm", departments: "esm" },
});

const [group] = module.nav;
const lead = group.items.filter((i) => i.workspace);
export const esmUi: ModuleUi = {
  ...module,
  nav: [{ ...group, items: [...lead, ...QUEUES.map(queueNav), ...group.items.filter((i) => !i.workspace)] }],
};
