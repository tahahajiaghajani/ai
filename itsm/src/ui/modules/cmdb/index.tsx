// Configuration management's screens (docs/modules/cmdb_FA.md). The module adds the sidebar space «پیکربندی»
// (key "assets": IT asset management joins it later with `spaceKey: "assets"`) with the group «پایگاه پیکربندی»:
//   workspace     «پایگاه پیکربندی» (health scorecards, what needs attention, sources), «نقشهٔ وابستگی», «تحلیل اثر»
//   lists         every CI and the queues «پیکربندی‌های من»، «از کار افتاده»، «کهنه»، «بی‌مالک»; relationships, groups,
//                 findings, duplicates, drift, certification tasks, suggestions, saved maps and simulations
//   record pages  the CI 360 (header actions, data-health panel, tabs: class attributes, map, impact, provenance);
//                 merge on duplicate reviews, compare on baselines, accept/reject on suggestions, saved simulations
//   pages         the class manager, imports, the query builder, the Windows app's own inventory
//   definitions   classes, relationship types, identification and reconciliation rules, data-quality rules,
//                 relationship rules, sources, collectors, policies, certification campaigns, settings
// Every other module's record that names a CI gets the «پیکربندی و اثر» side panel (CiContextPanel). `CiPicker` is the
// CI field of other modules' custom screens. Only light modules are imported here; every component loads with its page.
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import {
  Boxes, GitFork, Zap, Activity, FileUp, Network, Shapes, Link2, ListTree, SearchCheck, Copy, GitCompareArrows, Camera, Lightbulb, Map as MapIcon,
  Workflow, Database, Radar, ScrollText, ShieldCheck, ClipboardCheck, Settings2, Search, MonitorSmartphone, User, OctagonAlert, Hourglass, UserX, Fingerprint, Scale, FlaskConical,
} from "lucide-react";
import type { ModuleUi, NavItem } from "../registry";
import { recordModule, RecordListRoute } from "../../records/module";
import { registerRecordExtensions, type RecordContext } from "../../records/extensions";
import { recordsApi } from "../../records/data/api";
import { Loader } from "../../components/display";
import type { OrgApi } from "../../lib/api";
import type { Cond } from "@shared/model/conditions";

const Workspace = lazy(() => import("./Workspace"));
const MapPage = lazy(() => import("./MapPage"));
const ImpactPage = lazy(() => import("./ImpactPage"));
const ImportPage = lazy(() => import("./ImportPage"));
const ClassManager = lazy(() => import("./ClassManager"));
const QueryPage = lazy(() => import("./QueryPage"));
const LocalInventory = lazy(() => import("./LocalInventory"));
const CiHeaderActions = lazy(() => import("./CiParts").then((m) => ({ default: m.CiHeaderActions })));
const CiHealthPanel = lazy(() => import("./CiParts").then((m) => ({ default: m.CiHealthPanel })));
const CiAttrsTab = lazy(() => import("./CiParts").then((m) => ({ default: m.CiAttrsTab })));
const CiMapTab = lazy(() => import("./CiParts").then((m) => ({ default: m.CiMapTab })));
const CiImpactTab = lazy(() => import("./CiParts").then((m) => ({ default: m.CiImpactTab })));
const CiProvenanceTab = lazy(() => import("./CiParts").then((m) => ({ default: m.CiProvenanceTab })));
const DedupMerge = lazy(() => import("./RecordParts").then((m) => ({ default: m.DedupMerge })));
const BaselineCompare = lazy(() => import("./RecordParts").then((m) => ({ default: m.BaselineCompare })));
const SuggestionActions = lazy(() => import("./RecordParts").then((m) => ({ default: m.SuggestionActions })));
const SimulationResult = lazy(() => import("./RecordParts").then((m) => ({ default: m.SimulationResult })));
const OpenSavedMap = lazy(() => import("./RecordParts").then((m) => ({ default: m.OpenSavedMap })));
const CiContextPanel = lazy(() => import("./CiContextPanel"));

/** A record-page widget that loads with first use. */
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

export const ASSETS_SPACE = { key: "assets", label: "پیکربندی", title: "پیکربندی و دارایی‌ها", icon: Boxes };

const LIVE: Cond = { f: "state", op: "nin", v: ["retired", "disposed", "canceled"] };
const CI_COLUMNS = ["number", "name", "class", "state", "operational_status", "environment", "criticality", "owned_by", "support_group_id", "health_score"];

interface CiQueue {
  key: string;
  label: string;
  path: string;
  icon: typeof Boxes;
  filter: Cond;
  emptyText: string;
}

export const CI_QUEUES: CiQueue[] = [
  { key: "mine", label: "پیکربندی‌های من", path: "cmdb/mine", icon: User, filter: { and: [LIVE, { or: [{ f: "owned_by", op: "is_me" }, { f: "managed_by", op: "is_me" }, { f: "support_group_id", op: "is_my_group" }] }] }, emptyText: "پیکربندی‌ای به شما یا گروه‌هایتان سپرده نشده است" },
  { key: "down", label: "از کار افتاده", path: "cmdb/down", icon: OctagonAlert, filter: { and: [LIVE, { f: "operational_status", op: "in", v: ["non_operational", "repair"] }] }, emptyText: "همهٔ پیکربندی‌ها در حال کارند" },
  { key: "stale", label: "دادهٔ کهنه", path: "cmdb/stale", icon: Hourglass, filter: { and: [LIVE, { f: "is_stale", op: "eq", v: true }] }, emptyText: "پیکربندی کهنه‌ای نیست" },
  { key: "no-owner", label: "بی‌مالک", path: "cmdb/no-owner", icon: UserX, filter: { and: [LIVE, { f: "owned_by", op: "empty" }] }, emptyText: "همهٔ پیکربندی‌ها مالک دارند" },
];

const ciRowTone = (r: Record<string, unknown>): "danger" | "warning" | null =>
  r.operational_status === "non_operational" || r.operational_status === "repair" ? "danger" : r.is_stale ? "warning" : null;

const myCount = async (api: OrgApi) => (await recordsApi.list(api, "ci", { filter: CI_QUEUES[0].filter, size: 1, fields: ["number"], total: true })).total ?? 0;

const queueNav = (q: CiQueue, i: number): NavItem => ({
  key: `cmdb:q:${q.key}`,
  label: q.label,
  path: q.path,
  icon: q.icon,
  area: "work",
  keywords: "پیکربندی CI صف",
  ...(i === 0 ? { count: { key: "cmdb:mine", hint: "پیکربندی شما", load: myCount } } : {}),
});

const DEF = "تعریف‌ها";
const QUALITY = "کیفیت داده";
const DATA = "ورود و کشف";

const module = recordModule({
  key: "cmdb",
  space: ASSETS_SPACE,
  group: { key: "cmdb", label: "پایگاه پیکربندی" },
  tables: [
    {
      table: "ci", path: "cis", label: "همهٔ پیکربندی‌ها", noun: "پیکربندی", icon: Boxes, area: "work",
      keywords: "پیکربندی CI سرور رایانه برنامه پایگاه داده شبکه CMDB",
      search: { group: "پیکربندی‌ها" },
      list: { preset: { columns: CI_COLUMNS, rowTone: ciRowTone, emptyText: "هنوز پیکربندی‌ای ثبت نشده است" } },
      extensions: {
        headerActions: action("ci-actions", CiHeaderActions),
        sidePanels: [{ key: "cmdb:health", title: "سلامت داده", order: 1, render: widget(CiHealthPanel) }],
        tabs: [
          { key: "cmdb:attrs", label: "ویژگی‌های کلاس", order: 1, render: widget(CiAttrsTab) },
          { key: "cmdb:map", label: "نقشهٔ وابستگی", order: 2, render: widget(CiMapTab) },
          { key: "cmdb:impact", label: "اثر", order: 3, render: widget(CiImpactTab) },
          { key: "cmdb:provenance", label: "منشأ داده", order: 4, render: widget(CiProvenanceTab) },
        ],
        cardFields: ["class", "operational_status", "owned_by"],
        defaults: (sp) => (sp.get("class") ? { class: sp.get("class") } : {}),
      },
    },
    { table: "ci_rel", path: "cmdb/relationships", label: "رابطه‌ها", noun: "رابطه", icon: Link2, area: "work", keywords: "رابطه وابستگی اجرا روی میزبان اتصال" },
    { table: "ci_group", path: "cmdb/groups", label: "گروه‌های پیکربندی", noun: "گروه پیکربندی", icon: Shapes, area: "work", keywords: "گروه پویا خوشه افزونگی" },
    { table: "cmdb_finding", path: "cmdb/findings", label: "یافته‌های کیفیت داده", noun: "یافته", icon: SearchCheck, section: QUALITY, area: "work", keywords: "یافته کیفیت داده ممیزی انطباق" },
    { table: "cmdb_dedup_task", path: "cmdb/duplicates", label: "بررسی تکراری‌ها", noun: "بررسی تکراری", icon: Copy, section: QUALITY, area: "work", keywords: "تکراری ادغام یکسان‌سازی", extensions: { tabs: [{ key: "cmdb:merge", label: "ادغام", order: 0, render: widget(DedupMerge) }] } },
    { table: "ci_drift", path: "cmdb/drifts", label: "انحراف‌ها", noun: "انحراف", icon: GitCompareArrows, section: QUALITY, area: "work", keywords: "انحراف تغییر غیرمجاز خط مبنا" },
    { table: "ci_cert_task", path: "cmdb/cert-tasks", label: "تأیید داده", noun: "تأیید داده", icon: ClipboardCheck, section: QUALITY, area: "work", keywords: "تأیید داده بازبینی صحت مالک", newAction: false },
    { table: "ci_rel_suggestion", path: "cmdb/suggestions", label: "پیشنهاد رابطه", noun: "پیشنهاد رابطه", icon: Lightbulb, section: QUALITY, area: "work", keywords: "پیشنهاد رابطه هوشمند", newAction: false, extensions: { headerActions: action("suggestion-actions", SuggestionActions) } },
    { table: "ci_baseline", path: "cmdb/baselines", label: "خط‌های مبنا", noun: "خط مبنا", icon: Camera, section: QUALITY, area: "work", keywords: "خط مبنا عکس مقایسه", extensions: { tabs: [{ key: "cmdb:compare", label: "مقایسه", order: 0, render: widget(BaselineCompare) }] } },
    { table: "ci_cert_campaign", path: "cmdb/certification", label: "دوره‌های تأیید داده", noun: "دورهٔ تأیید", icon: ScrollText, section: QUALITY, area: "work", keywords: "دوره تأیید گواهی داده نمونه‌گیری" },
    { table: "ci_impact_sim", path: "cmdb/simulations", label: "شبیه‌سازی‌های اثر", noun: "شبیه‌سازی اثر", icon: FlaskConical, area: "work", keywords: "شبیه‌سازی اثر چه می‌شود اگر", newAction: false, extensions: { tabs: [{ key: "cmdb:sim", label: "نتیجه", order: 0, render: widget(SimulationResult) }] } },
    { table: "cmdb_map", path: "cmdb/maps", label: "نقشه‌های ذخیره‌شده", noun: "نقشه", icon: MapIcon, area: "work", keywords: "نقشه ذخیره نمای کسب‌وکار", newAction: false, extensions: { headerActions: action("map-open", OpenSavedMap) } },
    { table: "cmdb_query", path: "cmdb/queries", label: "پرس‌وجوهای ذخیره‌شده", noun: "پرس‌وجو", icon: Search, area: "work", search: false, keywords: "پرس‌وجو جست‌وجو", newAction: false },
    { table: "cmdb_import_run", path: "cmdb/import-runs", label: "اجراهای ورود داده", noun: "اجرای ورود", icon: Database, section: DATA, area: "work", newAction: false, keywords: "ورود داده اجرا نتیجه" },
    { table: "cmdb_data_source", path: "cmdb/sources", label: "منبع‌های داده", noun: "منبع داده", icon: Radar, section: DATA, area: "settings", keywords: "منبع داده اولویت کشف" },
    { table: "discovery_collector", path: "cmdb/collectors", label: "جمع‌آورنده‌های کشف", noun: "جمع‌آورنده", icon: Radar, section: DATA, area: "settings", keywords: "کشف جمع‌آورنده زمان‌بندی" },
    {
      table: "ci_class", path: "cmdb/classes", label: "کلاس‌ها", noun: "کلاس", icon: ListTree, section: DEF, area: "settings", keywords: "کلاس نوع پیکربندی ویژگی CSDM",
      extensions: { defaults: (sp) => Object.fromEntries([["parent_key", sp.get("parent_key")], ["family", sp.get("family")]].filter(([, v]) => v)) },
    },
    { table: "ci_rel_type", path: "cmdb/rel-types", label: "نوع‌های رابطه", noun: "نوع رابطه", icon: Network, section: DEF, area: "settings", search: false, keywords: "نوع رابطه انتقال اثر" },
    { table: "ci_identification_rule", path: "cmdb/identification-rules", label: "قاعده‌های شناسایی", noun: "قاعدهٔ شناسایی", icon: Fingerprint, section: DEF, area: "settings", search: false, keywords: "شناسایی آشتی IRE شناسه" },
    { table: "ci_reconciliation_rule", path: "cmdb/reconciliation-rules", label: "قاعده‌های آشتی داده", noun: "قاعدهٔ آشتی", icon: Scale, section: DEF, area: "settings", search: false, keywords: "آشتی اولویت منبع ویژگی" },
    { table: "cmdb_rule", path: "cmdb/rules", label: "قاعده‌های کیفیت داده", noun: "قاعدهٔ کیفیت", icon: ShieldCheck, section: DEF, area: "settings", search: false, keywords: "قاعده کیفیت ممیزی انطباق" },
    { table: "ci_rel_rule", path: "cmdb/rel-rules", label: "قاعده‌های رابطه‌سازی", noun: "قاعدهٔ رابطه‌سازی", icon: Workflow, section: DEF, area: "settings", search: false, keywords: "رابطه خودکار قاعده" },
    { table: "cmdb_policy", path: "cmdb/policies", label: "سیاست‌های داده", noun: "سیاست داده", icon: ScrollText, section: DEF, area: "settings", search: false, keywords: "سیاست بازنشستگی کهنه" },
    { table: "cmdb_health_fact", path: "cmdb/health-facts", label: "سلامت روزانه", icon: Activity, hidden: true, search: false, newAction: false },
    { table: "cmdb_config", path: "cmdb/settings", label: "تنظیمات پیکربندی", icon: Settings2, section: DEF, area: "settings", search: false, newAction: false, keywords: "تنظیمات وزن سلامت کنترل پیکربندی" },
  ],
  nav: [
    { key: "cmdb:workspace", label: "داشبورد پیکربندی", path: "cmdb", icon: Activity, area: "work", workspace: true, keywords: "داشبورد سلامت کیفیت داده CMDB" },
    { key: "cmdb:map", label: "نقشهٔ وابستگی", path: "cmdb/map", icon: GitFork, area: "work", workspace: true, keywords: "نقشه وابستگی خدمت گراف" },
    { key: "cmdb:impact", label: "تحلیل اثر", path: "cmdb/impact", icon: Zap, area: "work", workspace: true, keywords: "تحلیل اثر دامنه blast radius چه می‌شود اگر" },
    { key: "cmdb:query", label: "پرس‌وجو", path: "cmdb/query", icon: Search, area: "work", keywords: "پرس‌وجو جست‌وجوی پیشرفته رابطه" },
    { key: "cmdb:import", label: "ورود داده", path: "cmdb/import", icon: FileUp, section: DATA, area: "work", keywords: "ورود اکسل CSV JSON کشف" },
    { key: "cmdb:local", label: "موجودی این رایانه", path: "cmdb/local", icon: MonitorSmartphone, section: DATA, area: "work", desktopOnly: true, keywords: "موجودی رایانه کشف ویندوز" },
    { key: "cmdb:classes-manager", label: "مدیریت کلاس‌ها", path: "cmdb/class-manager", icon: ListTree, section: DEF, area: "settings", keywords: "کلاس ویژگی درخت CSDM" },
  ],
  routes: [
    ...CI_QUEUES.map((q) => ({ path: q.path, element: <RecordListRoute table="ci" title={q.label} preset={{ filter: q.filter, columns: CI_COLUMNS, rowTone: ciRowTone, emptyText: q.emptyText }} /> })),
    { path: "cmdb", element: lazyPage(<Workspace />) },
    { path: "cmdb/map", element: lazyPage(<MapPage />) },
    { path: "cmdb/impact", element: lazyPage(<ImpactPage />) },
    { path: "cmdb/import", element: lazyPage(<ImportPage />) },
    { path: "cmdb/class-manager", element: lazyPage(<ClassManager />) },
    { path: "cmdb/query", element: lazyPage(<QueryPage />) },
    { path: "cmdb/local", element: lazyPage(<LocalInventory />) },
  ],
  segments: { cmdb: "assets", cis: "assets" },
});

// every other module's record that names a CI: the CI, its health and impact, affected services, wrong-CI feedback
registerRecordExtensions("*", {
  sidePanels: [
    {
      key: "cmdb:context",
      title: "پیکربندی و اثر",
      order: 40,
      when: (ctx) => ctx.def.module !== "cmdb" && ctx.def.fields.some((f) => f.name === "ci_id" && f.type === "ref" && f.ref === "ci") && !!ctx.row.ci_id,
      render: widget(CiContextPanel),
    },
  ],
});

const [group] = module.nav;
export const cmdbUi: ModuleUi = {
  ...module,
  nav: [{ ...group, items: [...group.items.filter((i) => i.key === "cmdb:workspace"), ...CI_QUEUES.map(queueNav), ...group.items.filter((i) => i.key !== "cmdb:workspace")] }],
};

export { CiPicker } from "./CiPicker";
