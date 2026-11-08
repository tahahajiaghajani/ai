// The service portfolio's screens (docs/modules/service_portfolio_FA.md). The module adds the sidebar space «سبد خدمات»
// with the group «سبد و کاتالوگ خدمات»:
//   everyone      «وضعیت خدمات» (the status page, subscriptions) and «خدمت‌های من»
//   portfolio     the overview (pipeline, catalogue and retired views, reports, catalogue health, reviews due,
//                 technology risk), every service (list and the stage board), offerings, proposals, design packages
//   record pages  the service (status panel; header actions: map, impact, review done, subscribe; tabs: scorecard and
//                 the service model as a layered map from its CI); form policies of offerings, subscriptions, proposals
//   reports       rationalization (value × cost quadrant, overlaps), the capability map, daily scores
//   customers     relationships, reviews, agreements, subscriptions
//   architecture  application assessments (TIME), technology standards, capabilities
//   definitions   portfolio branches, commitments, deployed instances, settings
// Only light modules are imported here; every component loads with its page.
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import {
  BriefcaseBusiness, ConciergeBell, Tag, Handshake, ServerCog, BellRing, FileSignature, Gauge, Lightbulb, DraftingCompass, UsersRound, CalendarCheck, ClipboardList, ShieldCheck,
  Network, FolderTree, Settings2, Activity, Star, Scale, LayoutGrid,
} from "lucide-react";
import type { ModuleUi } from "../registry";
import { recordModule } from "../../records/module";
import type { RecordContext } from "../../records/extensions";
import { Loader } from "../../components/display";

const Portfolio = lazy(() => import("./Portfolio"));
const StatusPage = lazy(() => import("./StatusPage"));
const MyServices = lazy(() => import("./MyServices"));
const Rationalization = lazy(() => import("./Rationalization"));
const Capabilities = lazy(() => import("./Capabilities"));
const ServiceHeaderActions = lazy(() => import("./ServiceParts").then((m) => ({ default: m.ServiceHeaderActions })));
const ServiceStatusPanel = lazy(() => import("./ServiceParts").then((m) => ({ default: m.ServiceStatusPanel })));
const ScorecardTab = lazy(() => import("./ServiceParts").then((m) => ({ default: m.ScorecardTab })));
const ServiceModelTab = lazy(() => import("../cmdb/CiParts").then((m) => ({ default: m.CiMapTab })));

const widget = (C: ComponentType<{ ctx: RecordContext }>) => (ctx: RecordContext): ReactNode => (
  <Suspense fallback={<Loader />}>
    <C ctx={ctx} />
  </Suspense>
);
const lazyPage = (node: ReactNode) => <Suspense fallback={<Loader />}>{node}</Suspense>;

export const PORTFOLIO_SPACE = { key: "portfolio", label: "سبد خدمات", title: "سبد و کاتالوگ خدمات", icon: BriefcaseBusiness };

const REPORTS = "گزارش‌ها";
const CUSTOMERS = "مشتریان";
const ARCH = "معماری";
const DEF = "تعریف‌ها";

const module = recordModule({
  key: "service_portfolio",
  space: PORTFOLIO_SPACE,
  group: { key: "service_portfolio", label: "سبد و کاتالوگ خدمات" },
  tables: [
    {
      table: "service", path: "services", label: "همهٔ خدمت‌ها", noun: "خدمت", icon: ConciergeBell, area: "work",
      keywords: "خدمت سرویس کاتالوگ سبد SVC",
      search: { group: "خدمت‌ها" },
      list: { preset: { columns: ["number", "name", "service_type", "state", "tier", "owner_id", "status", "score"], board: { field: "state", cardFields: ["tier", "owner_id", "status"] }, emptyText: "هنوز خدمتی ثبت نشده است" } },
      extensions: {
        headerActions: (ctx) => (
          <Suspense key="service-actions" fallback={null}>
            <ServiceHeaderActions ctx={ctx} />
          </Suspense>
        ),
        sidePanels: [{ key: "service:status", title: "وضعیت جاری", order: 1, when: (ctx) => ["live", "deprecated", "transition"].includes(String(ctx.row.state)), render: widget(ServiceStatusPanel) }],
        tabs: [
          { key: "service:scorecard", label: "کارنامه", order: 1, render: widget(ScorecardTab) },
          { key: "service:model", label: "مدل خدمت", order: 2, when: (ctx) => !!ctx.row.ci_id, render: widget(ServiceModelTab) },
        ],
        cardFields: ["tier", "owner_id", "status"],
        policies: [
          { key: "service:retire", when: { f: "state", op: "nin", v: ["live", "deprecated", "retired"] }, actions: [{ field: "retire_reason", visible: false }] },
          { key: "service:status", when: { f: "state", op: "nin", v: ["live", "deprecated", "transition"] }, actions: ["status", "status_override", "status_since", "status_reason", "status_note", "on_status_page"].map((field) => ({ field, visible: false })) },
        ],
      },
    },
    {
      table: "service_offering", path: "service-offerings", label: "گزینه‌های خدمت", noun: "گزینهٔ خدمت", icon: Tag, area: "work", keywords: "گزینه خدمت سطح طلایی نقره‌ای OFR",
      extensions: {
        policies: [{ key: "offering:everyone", when: { f: "entitled_everyone", op: "eq", v: true }, actions: ["entitled_units", "entitled_groups", "entitled_locations"].map((field) => ({ field, visible: false })) }],
      },
    },
    {
      table: "service_proposal", path: "portfolio/proposals", label: "پیشنهادهای خدمت", noun: "پیشنهاد خدمت", icon: Lightbulb, area: "work", keywords: "پیشنهاد تقاضا خدمت تازه منشور SPR",
      extensions: {
        policies: [
          { key: "proposal:new", when: { f: "kind", op: "eq", v: "new" }, actions: [{ field: "service_id", visible: false }] },
          { key: "proposal:existing", when: { f: "kind", op: "ne", v: "new" }, actions: [{ field: "service_type", visible: false }, { field: "portfolio_node_id", visible: false }] },
        ],
      },
    },
    { table: "service_design_package", path: "portfolio/design-packages", label: "بسته‌های طراحی و گذار", noun: "بستهٔ طراحی", icon: DraftingCompass, area: "work", keywords: "طراحی گذار آمادگی عملیاتی SDT" },
    { table: "service_score_fact", path: "portfolio/scores", label: "امتیازهای روزانه", noun: "امتیاز روزانه", icon: Gauge, section: REPORTS, area: "work", newAction: false, search: false, keywords: "امتیاز عملکرد خدمت روزانه" },
    { table: "customer_relationship", path: "portfolio/customers", label: "ارتباط با مشتریان", noun: "ارتباط با مشتری", icon: UsersRound, section: CUSTOMERS, area: "work", keywords: "مشتری مدیر ارتباط کسب‌وکار BRM" },
    { table: "customer_review", path: "portfolio/customer-reviews", label: "بازبینی‌های با مشتری", noun: "بازبینی با مشتری", icon: CalendarCheck, section: CUSTOMERS, area: "work", keywords: "بازبینی نشست مشتری صورت‌جلسه CRV" },
    { table: "service_agreement", path: "portfolio/agreements", label: "توافق‌های مشتری", noun: "توافق مشتری", icon: FileSignature, section: CUSTOMERS, area: "work", keywords: "توافق قرارداد سطح خدمت مشتری AGR" },
    {
      table: "service_subscription", path: "service-subscriptions", label: "اشتراک‌های اطلاع‌رسانی خدمت", noun: "اشتراک اطلاع‌رسانی خدمت", icon: BellRing, section: CUSTOMERS, area: "work", keywords: "اشتراک مشترک خدمت",
      extensions: {
        policies: [
          { key: "sub:user", when: { f: "subscriber_kind", op: "ne", v: "user" }, actions: [{ field: "user_id", visible: false }] },
          { key: "sub:group", when: { f: "subscriber_kind", op: "ne", v: "group" }, actions: [{ field: "group_id", visible: false }] },
          { key: "sub:unit", when: { f: "subscriber_kind", op: "ne", v: "unit" }, actions: [{ field: "org_unit_id", visible: false }] },
          { key: "sub:location", when: { f: "subscriber_kind", op: "ne", v: "location" }, actions: [{ field: "location_id", visible: false }] },
        ],
      },
    },
    { table: "app_assessment", path: "portfolio/app-assessments", label: "ارزیابی سامانه‌ها", noun: "ارزیابی سامانه", icon: ClipboardList, section: ARCH, area: "work", keywords: "ارزیابی سامانه TIME سبد نرم‌افزار ASM" },
    { table: "technology_standard", path: "portfolio/standards", label: "استانداردهای فناوری", noun: "استاندارد فناوری", icon: ShieldCheck, section: ARCH, area: "work", keywords: "استاندارد فناوری پایان پشتیبانی ممنوع مجاز" },
    { table: "business_capability", path: "portfolio/capabilities", label: "قابلیت‌های کسب‌وکار", noun: "قابلیت کسب‌وکار", icon: Network, section: ARCH, area: "work", keywords: "قابلیت کسب‌وکار نقشه" },
    { table: "portfolio_node", path: "portfolio/nodes", label: "شاخه‌های سبد", noun: "شاخهٔ سبد", icon: FolderTree, section: DEF, area: "settings", keywords: "شاخه دسته سبد طبقه‌بندی" },
    { table: "service_commitment", path: "portfolio/commitments", label: "تعهدهای خدمت", noun: "تعهد خدمت", icon: Handshake, section: DEF, area: "work", keywords: "تعهد دسترس‌پذیری زمان پاسخ حل توافق سطح خدمت" },
    { table: "service_instance", path: "portfolio/instances", label: "نمونه‌های استقرار", noun: "نمونهٔ استقرار", icon: ServerCog, section: DEF, area: "work", keywords: "نمونه استقرار محیط منطقه مرکز داده" },
    { table: "service_config", path: "portfolio/settings", label: "تنظیمات سبد خدمات", icon: Settings2, section: DEF, area: "settings", search: false, newAction: false, keywords: "تنظیمات صفحهٔ وضعیت وزن امتیاز" },
  ],
  nav: [
    { key: "portfolio:overview", label: "نمای سبد", path: "portfolio", icon: BriefcaseBusiness, area: "work", workspace: true, keywords: "سبد خدمات گزارش سلامت کاتالوگ" },
    { key: "portfolio:status", label: "وضعیت خدمات", path: "status", icon: Activity, workspace: true, keywords: "وضعیت خدمات قطعی اختلال صفحهٔ وضعیت" },
    { key: "portfolio:mine", label: "خدمت‌های من", path: "my-services", icon: Star, keywords: "خدمت‌های من اشتراک" },
    { key: "portfolio:rationalization", label: "بهینه‌سازی سبد", path: "portfolio/rationalization", icon: Scale, section: REPORTS, area: "work", keywords: "بهینه‌سازی همپوشانی کنارگذاری ادغام هزینه ارزش" },
    { key: "portfolio:capability-map", label: "نقشهٔ قابلیت‌ها", path: "portfolio/capability-map", icon: LayoutGrid, section: ARCH, area: "work", keywords: "نقشه قابلیت پوشش شکاف" },
  ],
  routes: [
    { path: "portfolio", element: lazyPage(<Portfolio />) },
    { path: "status", element: lazyPage(<StatusPage />) },
    { path: "my-services", element: lazyPage(<MyServices />) },
    { path: "portfolio/rationalization", element: lazyPage(<Rationalization />) },
    { path: "portfolio/capability-map", element: lazyPage(<Capabilities />) },
  ],
  segments: { portfolio: "portfolio", services: "portfolio", "service-offerings": "portfolio", "service-subscriptions": "portfolio", status: "portfolio", "my-services": "portfolio" },
});

// the status page and «my services» first, then the overview and the rest of the group
const [group] = module.nav;
const first = ["portfolio:status", "portfolio:mine", "portfolio:overview"];
export const servicePortfolioUi: ModuleUi = {
  ...module,
  nav: [{ ...group, items: [...first.map((k) => group.items.find((i) => i.key === k)!).filter(Boolean), ...group.items.filter((i) => !first.includes(i.key))] }],
};
