// Service level management's screens (docs/modules/slm_FA.md): the sidebar space «سطح خدمت» (for everyone who reads the
// `sla` area) with the group «مدیریت سطح خدمت»:
//   pages         «نمای کلی سطح خدمت» (KPIs from analytics, attention, reviews, SLA at risk), «توافق ۳۶۰» of an
//                 agreement, «بستهٔ بازبینی» of a review, «توافق تازه از الگو»
//   queues        agreements in force, at risk, being drafted; reviews ahead
//   lists         reviews, the improvement register and plans, credits, compliance per period, XLA scores; definitions:
//                 targets, templates, XLA policies, settings
//   record pages  agreement (the portfolio's page): side panel «سطح خدمت»; target: «پیشنهاد هدف و شبیه‌سازی»; review:
//                 «بستهٔ بازبینی»; incidents and requested items: side panel «تجربه» (XLA)
// Agreements themselves stay the service portfolio's records (`service_agreement`, its pages at portfolio/agreements).
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { BadgePercent, CalendarCheck, ClipboardList, FilePlus2, FileStack, Gauge, Handshake, HeartPulse, Map as MapIcon, Settings2, Smile, Target, TrendingUp, TriangleAlert, PencilRuler, Inbox } from "lucide-react";
import type { AccessGate } from "@shared/access";
import type { ModuleUi, NavItem } from "../registry";
import { recordModule, RecordListRoute } from "../../records/module";
import { registerRecordExtensions, type RecordContext } from "../../records/extensions";
import { Loader } from "../../components/display";
import { QUEUES, type Queue } from "./model";

const Overview = lazy(() => import("./Overview"));
const Agreement360 = lazy(() => import("./Agreement360"));
const ReviewPack = lazy(() => import("./ReviewPack"));
const NewAgreement = lazy(() => import("./NewAgreement"));
const AgreementPanel = lazy(() => import("./Panels").then((m) => ({ default: m.AgreementPanel })));
const TargetPanel = lazy(() => import("./Panels").then((m) => ({ default: m.TargetPanel })));
const XlaPanel = lazy(() => import("./Panels").then((m) => ({ default: m.XlaPanel })));
const ReviewActions = lazy(() => import("./Panels").then((m) => ({ default: m.ReviewActions })));

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

const READS: AccessGate = { area: "sla" };
const DEFINES: AccessGate = { area: "sla", op: "create" };
const ADMIN: AccessGate = { area: "sla", op: "admin" };
const DEFS = "تعریف‌ها";
const REPORTS = "گزارش‌ها";

export const SLM_SPACE = { key: "service-levels", label: "سطح خدمت", title: "مدیریت سطح خدمت", icon: Handshake, access: READS };

const QUEUE_ICONS: Record<string, typeof Inbox> = { in_force: Handshake, risk: TriangleAlert, pipeline: PencilRuler, reviews: CalendarCheck };
// the agreement lists are the service area's; «در خطر» also filters and sorts on compliance, which the server shows
// only with the «internal» field group (a requester who reads services got 400 there) — the gate asks what it asks
const RISK_GATE: AccessGate = { area: "service", fieldGroup: "internal" };
const queueNav = (q: Queue): NavItem => ({ key: `slm:q:${q.key}`, label: q.label, path: q.path, icon: QUEUE_ICONS[q.key] ?? Inbox, area: "work", access: q.table !== "service_agreement" ? READS : q.key === "risk" ? RISK_GATE : { area: "service" }, keywords: "توافق سطح خدمت SLA OLA UC بازبینی" });

const module = recordModule({
  key: "slm",
  space: SLM_SPACE,
  group: { key: "slm", label: "مدیریت سطح خدمت" },
  tables: [
    {
      table: "slm_review", path: "slm/reviews", label: "بازبینی‌های خدمت", noun: "بازبینی خدمت", icon: ClipboardList, area: "work", access: READS, keywords: "بازبینی خدمت نشست مشتری REV QBR",
      search: { group: "بازبینی‌های خدمت" },
      list: { preset: { emptyText: "هنوز بازبینی‌ای ثبت نشده است" } },
      extensions: { headerActions: action("slm-review-pack", ReviewActions) },
    },
    {
      table: "slm_improvement", path: "slm/improvements", label: "ثبت بهبود مستمر", noun: "بهبود خدمت", icon: TrendingUp, area: "work", access: READS, keywords: "بهبود مستمر CSI اقدام پیشنهاد",
      search: { group: "بهبود خدمت" },
      list: { preset: { emptyText: "قلم بهبودی ثبت نشده است", board: { cardFields: ["score", "assigned_to", "due_at"] } } },
      extensions: { cardFields: ["score", "assigned_to", "due_at"] },
    },
    { table: "slm_csi_plan", path: "slm/plans", label: "برنامه‌های بهبود", noun: "برنامهٔ بهبود", icon: MapIcon, area: "work", access: READS, keywords: "برنامه بهبود مستمر" },
    { table: "slm_credit", path: "slm/credits", label: "جریمه‌های خدمت", noun: "جریمهٔ خدمت", icon: BadgePercent, area: "work", access: READS, newAction: false, keywords: "جریمه اعتبار خدمت اعتراض CRD" },
    { table: "slm_compliance", path: "slm/compliance", label: "انطباق دوره‌ها", noun: "انطباق دوره", icon: CalendarCheck, section: REPORTS, area: "work", access: READS, newAction: false, keywords: "انطباق دوره ماهانه" },
    // XLA scores are survey results (area «survey»): a service owner without it got «فهرست پیدا نشد»
    { table: "slm_xla_score", path: "slm/xla-scores", label: "امتیازهای تجربه", noun: "امتیاز تجربه", icon: Smile, section: REPORTS, area: "work", access: { area: "survey" }, newAction: false, keywords: "تجربه XLA امتیاز" },
    {
      table: "slm_target", path: "slm/targets", label: "اهداف توافق‌ها", noun: "هدف توافق", icon: Target, section: DEFS, area: "work", access: READS, keywords: "هدف توافق زمان پاسخ حل دسترس‌پذیری",
      extensions: { sidePanels: [{ key: "slm:recommend", title: "پیشنهاد هدف و شبیه‌سازی", order: 1, render: widget(TargetPanel) }] },
    },
    { table: "slm_template", path: "slm/templates", label: "الگوهای توافق", noun: "الگوی توافق", icon: FileStack, section: DEFS, area: "work", access: DEFINES, keywords: "الگو طلایی نقره‌ای برنزی" },
    { table: "slm_template_target", path: "slm/template-targets", label: "اهداف الگوها", noun: "هدف الگو", icon: Target, hidden: true, search: false },
    { table: "slm_xla_policy", path: "slm/xla-policies", label: "سیاست‌های تجربه", noun: "سیاست تجربه", icon: HeartPulse, section: DEFS, area: "work", access: DEFINES, keywords: "XLA تجربه سیاست" },
    { table: "slm_config", path: "slm/settings", label: "تنظیمات سطح خدمت", noun: "تنظیمات", icon: Settings2, section: DEFS, area: "work", access: ADMIN, newAction: false, search: false },
  ],
  nav: [
    { key: "slm:overview", label: "نمای کلی سطح خدمت", path: "slm", icon: Gauge, area: "work", access: READS, workspace: true, keywords: "سطح خدمت توافق انطباق داشبورد" },
    { key: "slm:new", label: "توافق تازه از الگو", path: "slm/new-agreement", icon: FilePlus2, area: "work", access: { area: "service", op: "create" }, action: true, keywords: "توافق تازه الگو" },
  ],
  routes: [
    { path: "slm", element: lazyPage(<Overview />) },
    { path: "slm/new-agreement", element: lazyPage(<NewAgreement />) },
    { path: "slm/agreements/:id/360", element: lazyPage(<Agreement360 />) },
    { path: "slm/reviews/:id/pack", element: lazyPage(<ReviewPack />) },
    ...QUEUES.map((q) => ({ path: q.path, element: <RecordListRoute table={q.table} title={q.label} preset={{ filter: q.filter, sort: q.sort, emptyText: q.empty }} /> })),
  ],
  segments: { slm: "service-levels" },
});

// the agreement (the portfolio's record page) gets the service-level panel
registerRecordExtensions("service_agreement", { sidePanels: [{ key: "slm:agreement", title: "سطح خدمت", order: 1, render: widget(AgreementPanel) }] });
// the experience score of the records XLA policies score
for (const table of ["incident", "request_item"]) registerRecordExtensions(table, { sidePanels: [{ key: "slm:xla", title: "تجربه (XLA)", order: 40, render: widget(XlaPanel) }] });

const [group] = module.nav;
const overview = group.items.filter((i) => i.key === "slm:overview");
export const slmUi: ModuleUi = {
  ...module,
  nav: [{ ...group, items: [...overview, ...QUEUES.map(queueNav), ...group.items.filter((i) => i.key !== "slm:overview")] }],
};
