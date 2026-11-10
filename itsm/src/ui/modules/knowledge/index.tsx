// Knowledge management's screens (docs/modules/knowledge_FA.md). The module adds the sidebar space «دانش»:
//   pages        «مرکز دانش» (search with type-ahead, «پرسش از دانش», bases and categories, what waits for the member),
//                search results, the reading view (kb/a/:id), the editor (kb/edit/:version), a new article, version
//                comparison, «خواندن و تأیید», the knowledge manager's workspace and the dashboard
//   queues       «پیش‌نویس‌های من», «بازبینی‌های من» (with a live count), «کارهای دانش»
//   lists        every article, bases, categories, templates, short answers, blocks, decision trees, campaigns,
//                feedback, gaps, duplicates, AQI reviews, glossary, search rules, KCS licences, domains, settings
//   records      header actions on articles, versions and known errors; the panel «دانش» beside every task-like
//                record with links (incidents, problems, requests, changes…): links, suggestions, short answers,
//                «حل شد با این مقاله», sharing with the requester, «نوشتن مقاله از این رکورد»
//   palette      articles open in the reading view
// Only light modules are imported here; every page loads with its route.
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import {
  BookOpenText, BookMarked, ChartColumn, ClipboardCheck, FileCheck2, FilePen, FolderTree, Gauge, GitBranch, Layers, LayoutTemplate, Library, ListTodo, MessageSquareQuote, MessagesSquare, Puzzle, Search, Settings2, ShieldCheck,
  Signpost, SpellCheck, Star, TriangleAlert, Copy, BellRing, Award, Network, ListFilter,
} from "lucide-react";
import type { AccessGate } from "@shared/access";
import type { ModuleUi, NavItem } from "../registry";
import { recordModule, RecordListRoute } from "../../records/module";
import { registerRecordExtensions, type RecordContext } from "../../records/extensions";
import { recordsApi } from "../../records/data/api";
import { Loader } from "../../components/display";
import type { OrgApi } from "../../lib/api";
import { kbApi } from "./api";
import { registerOrderAssist } from "../request/slots";
import { takesKnowledge } from "./model";

const Home = lazy(() => import("./Home"));
const Deflection = lazy(() => import("./Deflection"));
const SearchPage = lazy(() => import("./SearchPage"));
const Reader = lazy(() => import("./Reader"));
const Editor = lazy(() => import("./Editor"));
const NewArticle = lazy(() => import("./NewArticle"));
const DiffPage = lazy(() => import("./DiffPage"));
const Workspace = lazy(() => import("./Workspace"));
const Dashboard = lazy(() => import("./Dashboard"));
const Acknowledge = lazy(() => import("./Acknowledge"));
const TreePlayer = lazy(() => import("./TreePlayer"));
const TreeRecordActions = lazy(() => import("./ArticleActions").then((m) => ({ default: m.TreeRecordActions })));
const ByNumber = lazy(() => import("./Acknowledge").then((m) => ({ default: m.ByNumber })));
const ToArticles = lazy(() => import("./Acknowledge").then((m) => ({ default: m.ToArticles })));
const RecordPanel = lazy(() => import("./RecordPanel"));
const ArticleRecordActions = lazy(() => import("./ArticleActions").then((m) => ({ default: m.ArticleRecordActions })));
const VersionRecordActions = lazy(() => import("./ArticleActions").then((m) => ({ default: m.VersionRecordActions })));
const KnownErrorActions = lazy(() => import("./ArticleActions").then((m) => ({ default: m.KnownErrorActions })));

const widget = (C: ComponentType<{ ctx: RecordContext }>) => (ctx: RecordContext): ReactNode => (
  <Suspense fallback={<Loader />}>
    <C ctx={ctx} />
  </Suspense>
);
const header = (key: string, C: ComponentType<{ ctx: RecordContext }>) => (ctx: RecordContext): ReactNode => (
  <Suspense key={key} fallback={null}>
    <C ctx={ctx} />
  </Suspense>
);
const page = (node: ReactNode) => <Suspense fallback={<Loader />}>{node}</Suspense>;

export const KNOWLEDGE_SPACE = { key: "knowledge", label: "دانش", title: "مدیریت دانش", icon: BookOpenText };

/** Who is offered what (the server checks every route again): reading for everyone; drafts, reviews and knowledge
 *  tasks, snippets, blocks and decision trees for authors; curation (campaigns, quality, the manager's desk and
 *  dashboard) for those who change all knowledge;
 *  the definitions for its administrators. */
const AUTHORS: AccessGate = { area: "knowledge", op: "create" };
const CURATES: AccessGate = { area: "knowledge", op: "write", scope: "all" };
const ADMINISTERS: AccessGate = { area: "knowledge", op: "admin" };

const ME = (f: string) => ({ f, op: "is_me" as const });
const OPEN_VERSION = { f: "state", op: "in" as const, v: ["draft", "in_review", "scheduled"] };
const MY_DRAFTS = { and: [ME("author_id"), OPEN_VERSION] };
const MY_REVIEWS = { and: [ME("reviewer_ids"), { f: "state", op: "eq" as const, v: "in_review" }] };
const OPEN_TASKS = { f: "active", op: "eq" as const, v: true };
const S_CONTENT = "محتوا";
const S_QUALITY = "کیفیت";
const S_REPORTS = "گزارش‌ها";
const S_DEFS = "تعریف‌ها";

/** Versions waiting for the caller's review (the nav count). */
const reviewCount = async (api: OrgApi) => (await recordsApi.list(api, "kb_version", { filter: MY_REVIEWS, size: 1, fields: ["version_label"], total: true })).total ?? 0;

// the knowledge panel beside every task-like record with links, and the known error's article
registerRecordExtensions("*", {
  sidePanels: [{ key: "knowledge:panel", title: "دانش", order: 20, when: (ctx) => takesKnowledge(ctx.def), render: widget(RecordPanel) }],
});
// ordering in the catalogue (and «گزارش مشکل»): articles for what the person types, «مشکلم حل شد» (KB-050)
registerOrderAssist((p) => (
  <Suspense fallback={null}>
    <Deflection {...p} />
  </Suspense>
));
registerRecordExtensions("known_error", { headerActions: header("kb-known-error", KnownErrorActions) });

const NAV: NavItem[] = [
  { key: "kb:home", label: "مرکز دانش", path: "kb", icon: BookOpenText, area: "work", workspace: true, keywords: "دانش مقاله راهنما پایگاه دانش خودیاری KB" },
  { key: "kb:drafts", label: "پیش‌نویس‌های من", path: "kb/drafts", icon: FilePen, area: "work", access: AUTHORS, workspace: true, keywords: "پیش‌نویس مقاله نسخه" },
  { key: "kb:reviews", label: "بازبینی‌های من", path: "kb/reviews", icon: ClipboardCheck, area: "work", access: AUTHORS, workspace: true, keywords: "بازبینی تأیید انتشار مقاله", count: { key: "kb:reviews", hint: "نسخهٔ منتظر بازبینی شما", load: reviewCount } },
  { key: "kb:acknowledge", label: "خواندن و تأیید", path: "kb/acknowledge", icon: FileCheck2, area: "work", keywords: "خط‌مشی بخشنامه تأیید مطالعه سند" },
  { key: "kb:workspace", label: "میز مدیر دانش", path: "kb/workspace", icon: Gauge, section: S_REPORTS, area: "work", access: CURATES, keywords: "مدیر دانش سلامت تکراری کمبود روال" },
  { key: "kb:dashboard", label: "داشبورد دانش", path: "kb/dashboard", icon: ChartColumn, section: S_REPORTS, area: "work", access: CURATES, keywords: "داشبورد جست‌وجو پیشگیری بازخورد استفادهٔ دوباره" },
  { key: "kb:search", label: "جست‌وجو در دانش", path: "kb/search", icon: Search, area: "work", action: true, keywords: "جست‌وجو دانش مقاله" },
  { key: "kb:new", label: "مقالهٔ تازه", path: "kb/new", icon: FilePen, area: "work", access: AUTHORS, action: true, keywords: "نوشتن مقاله دانش تازه" },
];

const module = recordModule({
  key: "knowledge",
  space: KNOWLEDGE_SPACE,
  group: { key: "knowledge", label: "دانش" },
  tables: [
    {
      table: "kb_article", path: "kb/articles", label: "همهٔ مقاله‌ها", noun: "مقاله", icon: Library, area: "work", search: false, newAction: false,
      keywords: "مقاله دانش KB راهنما",
      list: { preset: { rowTone: (r) => (Number(r.open_flags ?? 0) > 0 ? "danger" : r.review_due ? "warning" : null), emptyText: "هنوز مقاله‌ای نوشته نشده است" } },
      extensions: {
        headerActions: header("kb-article-actions", ArticleRecordActions),
        cardFields: ["article_type", "owner_id", "review_at"],
        policies: [
          { key: "kb:narrow", when: { f: "audience_mode", op: "ne", v: "narrow" }, actions: ["read_users", "read_groups", "read_units", "units_tree"].map((field) => ({ field, visible: false })) },
          { key: "kb:access-list", when: { f: "visibility", op: "ne", v: "internal" }, actions: [{ field: "access_list", visible: false }] },
          { key: "kb:retired", when: { f: "state", op: "nin", v: ["retired", "pending_retirement"] }, actions: [{ field: "retire_reason", visible: false }, { field: "replaced_by", visible: false }] },
          { key: "kb:translation", when: { f: "translation_of", op: "empty" }, actions: ["translation_of", "master_version", "translation_stale", "machine_translated"].map((field) => ({ field, visible: false })) },
          { key: "kb:controlled", when: { f: "article_type", op: "ne", v: "policy" }, actions: ["doc_number", "issuing_authority", "effective_date"].map((field) => ({ field, visible: false })) },
          { key: "kb:link", when: { f: "article_type", op: "ne", v: "link" }, actions: [{ field: "external_url", visible: false }] },
        ],
      },
    },
    { table: "kb_version", path: "kb/versions", label: "نسخه‌های مقاله", noun: "نسخه", icon: GitBranch, area: "work", hidden: true, search: false, newAction: false, extensions: { headerActions: header("kb-version-actions", VersionRecordActions) } },
    { table: "kb_task", path: "kb/tasks", label: "کارهای دانش", noun: "کار دانش", icon: ListTodo, area: "work", access: AUTHORS, workspace: true, keywords: "کار دانش بازبینی ایراد کمبود KBT", list: { preset: { quick: ["open"], emptyText: "کار دانشی نیست" } } },
    { table: "kb_snippet", path: "kb/snippets", label: "پاسخ‌های کوتاه", noun: "پاسخ کوتاه", icon: MessageSquareQuote, section: S_CONTENT, area: "work", access: AUTHORS, keywords: "پاسخ کوتاه پرسش متداول FAQ" },
    { table: "kb_block", path: "kb/blocks", label: "بلوک‌های بازکاربرد", noun: "بلوک", icon: Puzzle, section: S_CONTENT, area: "work", access: AUTHORS, keywords: "بلوک متن مشترک تکرار" },
    { table: "kb_decision_tree", path: "kb/trees", label: "درخت‌های تصمیم", noun: "درخت تصمیم", icon: Signpost, section: S_CONTENT, area: "work", access: AUTHORS, keywords: "درخت تصمیم عیب‌یابی گام به گام", extensions: { headerActions: header("kb-tree-actions", TreeRecordActions) } },
    { table: "kb_attestation", path: "kb/attestations", label: "کارزارهای تأیید مطالعه", noun: "کارزار", icon: ShieldCheck, section: S_CONTENT, area: "work", access: CURATES, keywords: "خط‌مشی بخشنامه تأیید مطالعه" },
    { table: "kb_ack", path: "kb/acks", label: "تأییدهای مطالعه", noun: "تأیید مطالعه", icon: FileCheck2, area: "work", hidden: true, search: false, newAction: false },
    { table: "kb_subscription", path: "kb/subscriptions", label: "دنبال‌شده‌های من", noun: "اشتراک", icon: BellRing, area: "work", search: false, newAction: false, keywords: "دنبال کردن اشتراک اعلان مقاله" },
    { table: "kb_feedback", path: "kb/feedback", label: "بازخوردها", noun: "بازخورد", icon: MessagesSquare, section: S_QUALITY, area: "work", access: CURATES, search: false, newAction: false, keywords: "بازخورد رأی امتیاز گزارش ایراد" },
    { table: "kb_gap", path: "kb/gaps", label: "کمبودهای دانش", noun: "کمبود دانش", icon: TriangleAlert, section: S_QUALITY, area: "work", access: CURATES, keywords: "کمبود دانش جست‌وجوی بی‌نتیجه" },
    { table: "kb_duplicate", path: "kb/duplicates", label: "مقاله‌های تکراری", noun: "جفت تکراری", icon: Copy, section: S_QUALITY, area: "work", access: CURATES, search: false, newAction: false },
    { table: "kb_quality_review", path: "kb/quality-reviews", label: "بازبینی‌های کیفیت", noun: "بازبینی کیفیت", icon: Star, section: S_QUALITY, area: "work", access: CURATES, keywords: "AQI کیفیت محتوا چک‌لیست" },
    { table: "kb_base", path: "kb/bases", label: "پایگاه‌های دانش", noun: "پایگاه دانش", icon: BookMarked, section: S_DEFS, area: "work", access: ADMINISTERS, keywords: "پایگاه دانش مخاطبان مشارکت تأیید",
      extensions: {
        policies: [
          { key: "kb:base-audience", when: { f: "read_mode", op: "ne", v: "audience" }, actions: ["read_users", "read_groups", "read_units", "units_tree"].map((field) => ({ field, visible: false })) },
          { key: "kb:base-contrib", when: { f: "contrib_mode", op: "ne", v: "named" }, actions: [{ field: "contrib_users", visible: false }, { field: "contrib_groups", visible: false }] },
          { key: "kb:base-kcs", when: { f: "kcs_enabled", op: "eq", v: false }, actions: ["publishing_model", "external_after_reuses", "conveyor_days"].map((field) => ({ field, visible: false })) },
          { key: "kb:base-secret", when: { f: "classification", op: "eq", v: "secret" }, actions: [{ field: "ai_enabled", readonly: true }], message: "پایگاه «سری» در پاسخ‌های هوش مصنوعی به کار نمی‌رود.", tone: "info" },
        ],
      },
    },
    { table: "kb_category", path: "kb/categories", label: "دسته‌ها", noun: "دسته", icon: FolderTree, section: S_DEFS, area: "work", access: ADMINISTERS, keywords: "دسته پوشه درخت مقاله",
      extensions: { policies: [{ key: "kb:cat-audience", when: { f: "read_mode", op: "ne", v: "audience" }, actions: ["read_users", "read_groups", "read_units", "units_tree"].map((field) => ({ field, visible: false })) }] },
    },
    { table: "kb_template", path: "kb/templates", label: "قالب‌های مقاله", noun: "قالب", icon: LayoutTemplate, section: S_DEFS, area: "work", access: ADMINISTERS, keywords: "قالب KCS پرسش متداول راهنما بخش" },
    { table: "kb_glossary", path: "kb/glossary", label: "واژه‌نامه", noun: "واژه", icon: SpellCheck, section: S_DEFS, area: "work", access: ADMINISTERS, keywords: "واژه‌نامه هم‌معنی برابر مصوب فرهنگستان" },
    { table: "kb_search_rule", path: "kb/search-rules", label: "قاعده‌های جست‌وجو", noun: "قاعدهٔ جست‌وجو", icon: ListFilter, section: S_DEFS, area: "work", access: ADMINISTERS, search: false, keywords: "جست‌وجو سنجاق پنهان تقویت" },
    { table: "kb_licence", path: "kb/licences", label: "مجوزهای KCS", noun: "مجوز", icon: Award, section: S_DEFS, area: "work", access: ADMINISTERS, keywords: "KCS مجوز منتشرکننده مربی" },
    { table: "kb_domain", path: "kb/domains", label: "حوزه‌های دانش", noun: "حوزهٔ دانش", icon: Network, section: S_DEFS, area: "work", access: ADMINISTERS, keywords: "حوزه دانش متخصص روال" },
    { table: "kb_config", path: "kb/settings", label: "تنظیمات دانش", noun: "تنظیمات", icon: Settings2, section: S_DEFS, area: "settings", access: ADMINISTERS, search: false, newAction: false, keywords: "تنظیمات دانش بازبینی اعتبار سطل" },
  ],
  nav: NAV.filter((n) => n.section || n.action),
  routes: [
    { path: "kb", element: page(<Home />) },
    { path: "kb/search", element: page(<SearchPage />) },
    { path: "kb/new", element: page(<NewArticle />) },
    { path: "kb/a", element: page(<ToArticles />) },
    { path: "kb/a/:id", element: page(<Reader />) },
    { path: "kb/n/:number", element: page(<ByNumber />) },
    { path: "kb/edit/:versionId", element: page(<Editor />) },
    { path: "kb/diff", element: page(<DiffPage />) },
    { path: "kb/workspace", element: page(<Workspace />) },
    { path: "kb/dashboard", element: page(<Dashboard />) },
    { path: "kb/acknowledge", element: page(<Acknowledge />) },
    { path: "kb/tree/:id", element: page(<TreePlayer />) },
    { path: "kb/drafts", element: <RecordListRoute table="kb_version" title="پیش‌نویس‌های من" preset={{ filter: MY_DRAFTS, columns: ["title", "version_label", "state", "approval", "updated_at"], sort: "-updated_at", emptyText: "پیش‌نویس بازی ندارید" }} /> },
    { path: "kb/reviews", element: <RecordListRoute table="kb_version" title="بازبینی‌های من" preset={{ filter: MY_REVIEWS, columns: ["title", "version_label", "author_id", "submitted_at", "change_note"], sort: "submitted_at", emptyText: "نسخه‌ای منتظر بازبینی شما نیست" }} /> },
  ],
  searches: [
    {
      key: "kb:articles",
      group: "دانش",
      icon: Layers,
      area: "work",
      async run(api, q) {
        const r = await kbApi.search(api, { q, size: 6, log: false, channel: "palette" });
        return r.hits.map((h) => ({ id: h.id, label: h.title, meta: h.number ?? undefined, path: `kb/a/${h.id}` }));
      },
    },
  ],
  segments: { kb: "knowledge" },
});

// links to an article (notifications, references, lists, the palette) open the reading view; the record form stays
// at kb/articles/:id («نسخه‌ها و جزئیات» on the reading view)
registerRecordExtensions("kb_article", { path: "kb/a" });

// the pages first (the home, the member's own queues), then the tables and the rest of the group
const [group] = module.nav;
export const knowledgeUi: ModuleUi = {
  ...module,
  nav: [{ ...group, items: [...NAV.filter((n) => !n.section && !n.action), ...group.items] }],
};
