// Workforce and agent experience's screens (docs/modules/workforce_FA.md): the sidebar space «نیروی کار» with the group
// «کارشناس و تیم»:
//   for every agent   «خانهٔ کارشناس» (agent home), «برنامهٔ تیم», «ظرفیت تیم‌ها» (heatmap), «کارنامه» (own numbers,
//                     coaching notes, teams, leaderboard), «مهارت‌ها» (own skills, suggestions, expert finder, team
//                     coverage), «مرخصی و غیبت»
//   for managers      lists of the skills catalogue, people's skills, certificates, skill needs, shift patterns,
//                     rosters, time off, capacity settings, kudos and the module's settings (the area's grants)
//   record pages      «پیشنهاد کارشناس» on incidents, requested items, problems and changes (skills routing)
// Agents reach their own rows and their teams' views through the module's routes; the generic lists need the area's
// grants (the module's roles «مدیر نیروی کار» and «سرپرست تیم (نیروی کار)»).
import { type ComponentType, type ReactNode } from "react";
import { lazy, Suspense } from "@ui/lib/lazy";
import { Award, CalendarClock, CalendarRange, Gauge, GraduationCap, HeartHandshake, House, LayoutGrid, Plane, Settings2, ShieldCheck, Trophy, UserRoundCheck, Users } from "lucide-react";
import type { AccessGate } from "@shared/access";
import type { ModuleUi } from "../registry";
import { recordModule } from "../../records/module";
import { registerRecordExtensions, type RecordContext } from "../../records/extensions";
import { Loader } from "../../components/display";

const AgentHome = lazy(() => import("./AgentHome"));
const TeamBoard = lazy(() => import("./TeamBoard"));
const Capacity = lazy(() => import("./Capacity"));
const Performance = lazy(() => import("./Performance"));
const MySkills = lazy(() => import("./MySkills"));
const TimeOff = lazy(() => import("./TimeOff"));
const RoutingPanel = lazy(() => import("./Panels").then((m) => ({ default: m.RoutingPanel })));

const widget = (C: ComponentType<{ ctx: RecordContext }>) => (ctx: RecordContext): ReactNode => (
  <Suspense fallback={<Loader />}>
    <C ctx={ctx} />
  </Suspense>
);
const lazyPage = (node: ReactNode) => <Suspense fallback={<Loader />}>{node}</Suspense>;

/** People who work records (an agent's group write scope in «کار»); requesters see nothing of this space. */
const AGENT: AccessGate = { area: "work", op: "write", scope: "group" };
const MANAGES: AccessGate = { area: "workforce" };
const DEFS = "تعریف‌ها";
const MANAGE = "مدیریت نیروی کار";

export const WORKFORCE_SPACE = { key: "workforce", label: "نیروی کار", title: "نیروی کار و تجربهٔ کارشناس", icon: Users, access: AGENT };

const module = recordModule({
  key: "workforce",
  space: WORKFORCE_SPACE,
  group: { key: "workforce", label: "کارشناس و تیم" },
  tables: [
    { table: "wfm_absence", path: "workforce/absences", label: "مرخصی‌ها", noun: "مرخصی", icon: Plane, section: MANAGE, area: "work", access: MANAGES, keywords: "مرخصی غیبت مأموریت ABS" },
    { table: "wfm_roster", path: "workforce/rosters", label: "برنامه‌های شیفت", noun: "برنامهٔ شیفت", icon: CalendarClock, section: MANAGE, area: "work", access: MANAGES, keywords: "شیفت برنامه نوبت کاری SCH" },
    { table: "wfm_person_skill", path: "workforce/person-skills", label: "مهارت‌های افراد", noun: "مهارت فرد", icon: UserRoundCheck, section: MANAGE, area: "work", access: MANAGES, keywords: "مهارت سطح تسلط تأیید" },
    { table: "wfm_certification", path: "workforce/certifications", label: "گواهینامه‌ها", noun: "گواهینامه", icon: Award, section: MANAGE, area: "work", access: MANAGES, keywords: "گواهینامه مدرک انقضا ITIL" },
    { table: "wfm_capacity", path: "workforce/capacity-settings", label: "تنظیم ظرفیت تیم‌ها", noun: "ظرفیت تیم", icon: Gauge, section: MANAGE, area: "work", access: MANAGES, keywords: "ظرفیت سقف کار توان حل" },
    { table: "wfm_kudos", path: "workforce/kudos", label: "قدردانی‌ها", noun: "قدردانی", icon: HeartHandshake, section: MANAGE, area: "work", access: MANAGES, keywords: "قدردانی تشکر" },
    { table: "wfm_skill", path: "workforce/skills-catalogue", label: "فهرست مهارت‌ها", noun: "مهارت", icon: GraduationCap, section: DEFS, area: "work", access: MANAGES, keywords: "مهارت SFIA دسته" },
    { table: "wfm_coverage", path: "workforce/coverage", label: "نیازهای مهارتی", noun: "نیاز مهارتی", icon: ShieldCheck, section: DEFS, area: "work", access: MANAGES, keywords: "نیاز مهارت پوشش فرد کلیدی" },
    { table: "wfm_shift_pattern", path: "workforce/shift-patterns", label: "الگوهای شیفت", noun: "الگوی شیفت", icon: CalendarRange, section: DEFS, area: "work", access: MANAGES, keywords: "الگوی شیفت صبح عصر شب" },
    { table: "wfm_points", path: "workforce/points", label: "دفتر امتیازها", noun: "امتیاز", icon: Trophy, hidden: true, search: false, newAction: false },
    { table: "wfm_agent", path: "workforce/agents", label: "وضعیت کارشناسان", noun: "وضعیت کارشناس", icon: UserRoundCheck, hidden: true, search: false, newAction: false },
    { table: "wfm_presence_log", path: "workforce/presence-log", label: "سابقهٔ حضور", noun: "سابقهٔ حضور", icon: CalendarClock, hidden: true, search: false, newAction: false },
    { table: "wfm_config", path: "workforce/settings", label: "تنظیمات نیروی کار", noun: "تنظیمات", icon: Settings2, section: DEFS, area: "work", access: { area: "workforce", op: "admin" }, newAction: false, search: false },
  ],
  nav: [
    { key: "workforce:home", label: "خانهٔ کارشناس", path: "workforce", icon: House, area: "work", access: AGENT, workspace: true, keywords: "خانه کارشناس کارهای من صف در خطر" },
    { key: "workforce:board", label: "برنامهٔ تیم", path: "workforce/team", icon: CalendarClock, area: "work", access: AGENT, keywords: "برنامه شیفت تیم تقویم" },
    { key: "workforce:capacity", label: "ظرفیت تیم‌ها", path: "workforce/capacity", icon: LayoutGrid, area: "work", access: AGENT, keywords: "ظرفیت بار پیش‌بینی نیرو" },
    { key: "workforce:performance", label: "کارنامه", path: "workforce/performance", icon: Trophy, area: "work", access: AGENT, keywords: "کارنامه عملکرد امتیاز مربی‌گری" },
    { key: "workforce:skills", label: "مهارت‌ها", path: "workforce/skills", icon: GraduationCap, area: "work", access: AGENT, keywords: "مهارت خبره پوشش" },
    { key: "workforce:timeoff", label: "مرخصی و غیبت", path: "workforce/time-off", icon: Plane, area: "work", access: AGENT, keywords: "مرخصی غیبت درخواست" },
  ],
  routes: [
    { path: "workforce", element: lazyPage(<AgentHome />) },
    { path: "workforce/team", element: lazyPage(<TeamBoard />) },
    { path: "workforce/capacity", element: lazyPage(<Capacity />) },
    { path: "workforce/performance", element: lazyPage(<Performance />) },
    { path: "workforce/skills", element: lazyPage(<MySkills />) },
    { path: "workforce/time-off", element: lazyPage(<TimeOff />) },
  ],
  segments: { workforce: "workforce" },
});

// «پیشنهاد کارشناس» on the work tables people are assigned
for (const table of ["incident", "request_item", "problem", "change_request"]) registerRecordExtensions(table, { sidePanels: [{ key: "workforce:routing", title: "پیشنهاد کارشناس", order: 45, render: widget(RoutingPanel) }] });

const PAGES = ["workforce:home", "workforce:board", "workforce:capacity", "workforce:performance", "workforce:skills", "workforce:timeoff"];
const [group] = module.nav;
export const workforceUi: ModuleUi = {
  ...module,
  nav: [{ ...group, items: [...group.items.filter((i) => PAGES.includes(i.key)), ...group.items.filter((i) => !PAGES.includes(i.key))] }],
};
