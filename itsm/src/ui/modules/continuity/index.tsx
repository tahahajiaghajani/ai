// Availability, capacity and continuity screens (docs/modules/continuity_FA.md), in the «عملیات» space with the
// group «دسترس‌پذیری و تداوم»:
//   «دسترس‌پذیری خدمت‌ها» (the availability dashboard), outages, capacity records, BIAs (with the template and the
//   impact matrix), continuity and DR plans with their steps, exercises (with the step sheet), «داشبورد تداوم»
// Elsewhere: «ثبت قطعی» on incident pages, the availability of a service on its page.
import { type ComponentType, type ReactNode } from "react";
import { lazy, Suspense } from "@ui/lib/lazy";
import { Activity, ChartColumn, Flag, Gauge, LifeBuoy, ListOrdered, PowerOff, Scale, Settings2 } from "lucide-react";
import type { ModuleUi } from "../registry";
import { recordModule } from "../../records/module";
import { registerCalendarDecor, registerRecordExtensions, type RecordContext } from "../../records/extensions";
import { Loader } from "../../components/display";

const Availability = lazy(() => import("./Availability"));
const Dashboard = lazy(() => import("./widgets").then((m) => ({ default: m.Dashboard })));
const BiaMatrix = lazy(() => import("./widgets").then((m) => ({ default: m.BiaMatrix })));
const BiaFromTemplate = lazy(() => import("./widgets").then((m) => ({ default: m.BiaFromTemplate })));
const ExerciseRun = lazy(() => import("./widgets").then((m) => ({ default: m.ExerciseRun })));
const ServiceAvailability = lazy(() => import("./widgets").then((m) => ({ default: m.ServiceAvailability })));
const OutageFromIncident = lazy(() => import("./widgets").then((m) => ({ default: m.OutageFromIncident })));

const widget = (C: ComponentType<{ ctx: RecordContext }>, key?: string) => (ctx: RecordContext): ReactNode => (
  <Suspense key={key} fallback={key ? null : <Loader />}>
    <C ctx={ctx} />
  </Suspense>
);
const lazyPage = (node: ReactNode) => <Suspense fallback={<Loader />}>{node}</Suspense>;

const SECTION = "دسترس‌پذیری و تداوم";
const GATE = { area: "continuity" } as const;

const module = recordModule({
  key: "continuity",
  spaceKey: "operations",
  group: { key: "continuity", label: "دسترس‌پذیری و تداوم" },
  tables: [
    {
      table: "outage", path: "continuity/outages", label: "قطعی‌ها", noun: "قطعی", icon: PowerOff, section: SECTION, access: GATE,
      keywords: "قطعی افت کیفیت دسترس‌پذیری خاموشی OUT", search: { group: "قطعی‌ها" },
      list: { preset: { rowTone: (r) => (r.state === "ongoing" ? "danger" : r.state === "proposed" ? "warning" : null), emptyText: "قطعی‌ای ثبت نشده است" } },
    },
    { table: "capacity_record", path: "continuity/capacity", label: "ظرفیت", noun: "رکورد ظرفیت", icon: Gauge, section: SECTION, access: GATE, keywords: "ظرفیت آستانه مصرف پیش‌بینی", list: { preset: { rowTone: (r) => (r.status === "critical" ? "danger" : r.status === "warning" ? "warning" : null) } } },
    {
      table: "bia", path: "continuity/bia", label: "تحلیل اثر کسب‌وکار", noun: "تحلیل اثر", icon: Scale, section: SECTION, access: GATE,
      keywords: "تحلیل اثر کسب‌وکار BIA RTO RPO MTPD", search: { group: "تحلیل‌های اثر" },
      list: { actions: <Suspense fallback={null}><BiaFromTemplate /></Suspense> },
      extensions: { tabs: [{ key: "bia:matrix", label: "ماتریس اثر", order: 1, render: widget(BiaMatrix) }] },
    },
    { table: "continuity_plan", path: "continuity/plans", label: "طرح‌های تداوم و بازیابی", noun: "طرح تداوم", icon: LifeBuoy, section: SECTION, access: GATE, keywords: "طرح تداوم بازیابی فاجعه DRP BCP", search: { group: "طرح‌های تداوم" } },
    {
      table: "exercise", path: "continuity/exercises", label: "مانورها", noun: "مانور", icon: Flag, section: SECTION, access: GATE, keywords: "مانور آزمون بازیابی تمرین DR",
      extensions: { tabs: [{ key: "exercise:run", label: "برگهٔ گام‌ها", order: 1, render: widget(ExerciseRun) }] },
    },
    { table: "plan_step", path: "continuity/steps", label: "گام‌های بازیابی", noun: "گام بازیابی", icon: ListOrdered, hidden: true, search: false },
    { table: "continuity_config", path: "continuity/settings", label: "تنظیمات تداوم", icon: Settings2, hidden: true, search: false, newAction: false },
  ],
  nav: [
    { key: "continuity:availability", label: "دسترس‌پذیری خدمت‌ها", path: "continuity/availability", icon: Activity, section: SECTION, access: GATE, keywords: "دسترس‌پذیری MTBF MTRS هدف بودجهٔ خطا" },
    { key: "continuity:dashboard", label: "داشبورد تداوم", path: "continuity/dashboard", icon: ChartColumn, section: "گزارش‌ها", access: GATE, keywords: "داشبورد تداوم پوشش BIA طرح مانور RTO" },
  ],
  routes: [
    { path: "continuity/availability", element: lazyPage(<Availability />) },
    { path: "continuity/dashboard", element: lazyPage(<Dashboard />) },
  ],
  segments: { continuity: "operations" },
});

// the availability dashboard first, then the rest of the group
const [group] = module.nav;
export const continuityUi: ModuleUi = {
  ...module,
  nav: [{ ...group, items: [...group.items.filter((i) => i.key === "continuity:availability"), ...group.items.filter((i) => i.key !== "continuity:availability")] }],
};

registerRecordExtensions("incident", { headerActions: widget(OutageFromIncident, "continuity-outage") });
// for those who look after the service and the continuity team (the outage register's readers)
registerRecordExtensions("service", { sidePanels: [{ key: "continuity:availability", title: "دسترس‌پذیری", order: 4, when: (ctx) => !!ctx.meta.canWrite || !!ctx.schema.def("outage"), render: widget(ServiceAvailability) }] });
registerCalendarDecor("outage", { tone: (row) => (row.outage_type === "outage" ? "danger" : row.outage_type === "degradation" ? "warning" : null), fields: ["outage_type"] });
