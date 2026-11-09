// The self-service portal's screens (docs/modules/portal_FA.md). The module adds:
//   «درگاه خدمات»  the requester's portal (portal/*) in its own light shell — home, search with an AI answer, the
//                  catalogue and ordering, «گزارش مشکل», «درخواست‌های من» and each ticket's page, «کارهای من» and
//                  approvals, knowledge, surveys, the profile (notifications, messengers, delegation), the assistant,
//                  service status, feedback and topics; a nav item at the top of every space
//   space «درگاه»  for those who run it: «تنظیم درگاه» (home page layout, public knowledge, defaults), portals, quick
//                  links, topics, feedback, surveys and their triggers, responses and results, messaging connectors,
//                  linked accounts, the website widget, public knowledge publications and «آمار درگاه»
//   records        header actions on connectors, widgets and surveys; «نظرسنجی‌ها» beside incidents, requested items
//                  and feedback; survey invitations open in the portal
//   public pages   /p/kb/:token (knowledge without sign-in) and /p/survey/:token (a survey by its signed link)
// Only light modules are imported here; every page loads with its route.
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { BarChart3, Code2, Globe, KeyRound, LayoutTemplate, LifeBuoy, Link2, ListTree, MessageSquareHeart, MessageSquareText, MessagesSquare, PieChart, Settings2, Workflow, Inbox } from "lucide-react";
import type { AccessGate } from "@shared/access/evaluate";
import type { ModuleUi, NavItem } from "../registry";
import { recordModule } from "../../records/module";
import { registerRecordExtensions, type RecordContext } from "../../records/extensions";
import { Loader } from "../../components/display";

const Shell = lazy(() => import("./Shell"));
const Admin = lazy(() => import("./Admin"));
const Results = lazy(() => import("./Results"));
const Analytics = lazy(() => import("./Analytics"));
const PublicKbHome = lazy(() => import("./PublicKb"));
const PublicKbArticle = lazy(() => import("./PublicKb").then((m) => ({ default: m.PublicKbArticle })));
const PublicSurvey = lazy(() => import("./PublicSurvey"));
const ChannelActions = lazy(() => import("./RecordActions").then((m) => ({ default: m.ChannelActions })));
const WidgetActions = lazy(() => import("./RecordActions").then((m) => ({ default: m.WidgetActions })));
const SurveyActions = lazy(() => import("./RecordActions").then((m) => ({ default: m.SurveyActions })));
const RecordSurveys = lazy(() => import("./RecordActions").then((m) => ({ default: m.RecordSurveys })));

const page = (node: ReactNode) => <Suspense fallback={<Loader />}>{node}</Suspense>;
const header = (key: string, C: ComponentType<{ ctx: RecordContext }>) => (ctx: RecordContext): ReactNode => (
  <Suspense key={key} fallback={null}>
    <C ctx={ctx} />
  </Suspense>
);
const widget = (C: ComponentType<{ ctx: RecordContext }>) => (ctx: RecordContext): ReactNode => (
  <Suspense fallback={<Loader />}>
    <C ctx={ctx} />
  </Suspense>
);

export const PORTAL_SPACE = { key: "portal", label: "درگاه", title: "درگاه خدمات، نظرسنجی و مجراها", icon: LifeBuoy };

/** Who is offered what (the server checks every route again): the portal for everyone; its look, links and topics for
 *  the catalogue's administrators; the feedback queue for those who work requests in groups; surveys for those who
 *  change every survey; connectors and the widget for the integrations' administrators; public knowledge for those
 *  who approve knowledge. */
const RUNS_PORTAL: AccessGate = { area: "catalog", op: "admin" };
const WORKS_FEEDBACK: AccessGate = { area: "request", scope: "group" };
const RUNS_SURVEYS: AccessGate = { area: "survey", op: "write", scope: "all" };
const READS_SURVEYS: AccessGate = { area: "survey", scope: "group" };
const RUNS_CHANNELS: AccessGate = { area: "integrations", op: "write", scope: "all" };
const PUBLISHES_KB: AccessGate = { area: "knowledge", op: "approve" };

const S_PORTAL = "درگاه";
const S_SURVEYS = "نظرسنجی";
const S_CHANNELS = "مجراها";
const S_REPORTS = "گزارش‌ها";

// the record pages of the portal's tables in the desk, and the survey answers beside the records they are about
registerRecordExtensions("incident", { sidePanels: [{ key: "portal:surveys", title: "نظرسنجی‌ها", order: 60, render: widget(RecordSurveys) }] });
registerRecordExtensions("request_item", { sidePanels: [{ key: "portal:surveys", title: "نظرسنجی‌ها", order: 60, render: widget(RecordSurveys) }] });

const NAV: NavItem[] = [
  { key: "portal:home", label: "درگاه خدمات", path: "portal", icon: LifeBuoy, common: true, keywords: "درگاه خودیاری پرتال درخواست خدمت گزارش مشکل پیگیری دستیار" },
  { key: "portal:admin", label: "تنظیم درگاه", path: "portal-admin", icon: Settings2, section: S_PORTAL, access: RUNS_PORTAL, keywords: "درگاه صفحهٔ اول چیدمان نشان رنگ انتشار پیش‌نمایش" },
  { key: "portal:results", label: "نتیجهٔ نظرسنجی‌ها", path: "portal-admin/results", icon: PieChart, section: S_SURVEYS, access: RUNS_SURVEYS, keywords: "نظرسنجی رضایت CSAT NPS CES نتیجه" },
  { key: "portal:analytics", label: "آمار درگاه", path: "portal-admin/analytics", icon: BarChart3, section: S_REPORTS, access: RUNS_PORTAL, keywords: "آمار درگاه جست‌وجو پیشگیری دستیار گفتگو" },
];

const module = recordModule({
  key: "portal",
  space: PORTAL_SPACE,
  group: { key: "portal", label: "درگاه" },
  tables: [
    { table: "portal_feedback", path: "portal-admin/feedback", label: "بازخوردها", noun: "بازخورد", icon: MessageSquareHeart, access: WORKS_FEEDBACK, workspace: true, keywords: "شکایت قدردانی پیشنهاد حریم خصوصی داده شخصی بازخورد FBK", list: { preset: { quick: ["open"], emptyText: "بازخوردی نرسیده است" } } },
    { table: "portal", path: "portal-admin/portals", label: "درگاه‌ها", noun: "درگاه", icon: LayoutTemplate, section: S_PORTAL, access: RUNS_PORTAL, search: false, keywords: "درگاه نشان رنگ حریم خصوصی" },
    { table: "portal_link", path: "portal-admin/links", label: "پیوندهای سریع", noun: "پیوند", icon: Link2, section: S_PORTAL, access: RUNS_PORTAL, search: false, keywords: "پیوند سامانه برنامه میان‌بر" },
    { table: "portal_topic", path: "portal-admin/topics", label: "موضوع‌ها", noun: "موضوع", icon: ListTree, section: S_PORTAL, access: RUNS_PORTAL, search: false, keywords: "موضوع درخت خدمت دانش" },
    { table: "survey", path: "portal-admin/surveys", label: "نظرسنجی‌ها", noun: "نظرسنجی", icon: MessageSquareText, section: S_SURVEYS, access: RUNS_SURVEYS, keywords: "نظرسنجی رضایت CSAT NPS دوره‌ای", extensions: { headerActions: header("portal-survey-actions", SurveyActions) } },
    { table: "survey_question", path: "portal-admin/questions", label: "پرسش‌های نظرسنجی", noun: "پرسش", icon: MessageSquareText, access: RUNS_SURVEYS, hidden: true, search: false },
    { table: "survey_trigger", path: "portal-admin/triggers", label: "قاعده‌های ارسال", noun: "قاعدهٔ ارسال", icon: Workflow, section: S_SURVEYS, access: RUNS_SURVEYS, search: false, keywords: "ارسال خودکار نظرسنجی پس از حل نمونه" },
    { table: "survey_response", path: "portal-admin/responses", label: "پاسخ‌های نظرسنجی", noun: "پاسخ", icon: Inbox, section: S_SURVEYS, access: READS_SURVEYS, search: false, newAction: false, keywords: "پاسخ نظرسنجی نظر" },
    { table: "survey_invitation", path: "portal-admin/invitations", label: "دعوت‌های نظرسنجی", noun: "دعوت", icon: MessagesSquare, access: RUNS_SURVEYS, hidden: true, search: false, newAction: false },
    { table: "portal_channel", path: "portal-admin/channels", label: "پیام‌رسان‌ها", noun: "مجرا", icon: MessagesSquare, section: S_CHANNELS, access: RUNS_CHANNELS, search: false, keywords: "تلگرام بله بات وب‌هوک پیام‌رسان", extensions: { headerActions: header("portal-channel-actions", ChannelActions) } },
    { table: "portal_channel_identity", path: "portal-admin/identities", label: "حساب‌های وصل", noun: "حساب", icon: KeyRound, section: S_CHANNELS, access: RUNS_CHANNELS, search: false, newAction: false, keywords: "حساب پیام‌رسان اتصال" },
    { table: "portal_widget", path: "portal-admin/widgets", label: "ابزارک وب‌سایت", noun: "ابزارک", icon: Code2, section: S_CHANNELS, access: RUNS_CHANNELS, search: false, keywords: "ابزارک وب‌سایت جاسازی گفتگو", extensions: { headerActions: header("portal-widget-actions", WidgetActions) } },
    { table: "portal_kb_publication", path: "portal-admin/public-kb", label: "دانش بی‌ورود", noun: "انتشار دانش", icon: Globe, section: S_CHANNELS, access: PUBLISHES_KB, search: false, keywords: "دانش عمومی بی‌ورود انتشار راهنما" },
  ],
  nav: NAV.filter((n) => n.section),
  routes: [
    { path: "portal/*", element: page(<Shell />) },
    { path: "portal-admin", element: page(<Admin />) },
    { path: "portal-admin/results", element: page(<Results />) },
    { path: "portal-admin/analytics", element: page(<Analytics />) },
  ],
  segments: { portal: "portal", "portal-admin": "portal" },
});

// a survey invitation (its notification, «کارهای من») opens the survey in the portal
registerRecordExtensions("survey_invitation", { path: "portal/surveys" });
registerRecordExtensions("portal_feedback", { sidePanels: [{ key: "portal:surveys", title: "نظرسنجی‌ها", order: 60, render: widget(RecordSurveys) }] });

const [group] = module.nav;
export const portalUi: ModuleUi = {
  ...module,
  nav: [{ ...group, items: [...NAV.filter((n) => !n.section), ...group.items] }],
  publicRoutes: [
    { path: "kb/:token", element: page(<PublicKbHome />) },
    { path: "kb/:token/a/:slug", element: page(<PublicKbArticle />) },
    { path: "survey/:token", element: page(<PublicSurvey />) },
  ],
};

