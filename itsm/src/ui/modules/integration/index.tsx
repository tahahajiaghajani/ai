// The integration hub's screens (docs/modules/integration_FA.md), a group «اتصال‌ها و یکپارچه‌سازی» of the settings space:
//   pages         «مرکز اتصال‌ها» (every connector, health, the day's calls), «مستندات API» (an integration user's
//                 OpenAPI document)
//   lists         integration users, outbound webhooks, inbound endpoints, LDAP/AD and SCIM sources, Jira/GitHub
//                 connections and their issue links, scheduled exports
//   record pages  roles and keys; secrets shown once; test sends, deliveries and dead letters; inbound deliveries;
//                 directory test / preview / approve / apply; run an export now
//   elsewhere     the side panel «Jira و GitHub» on task records (their issues, «ساخت issue»)
import { type ComponentType, type ReactNode } from "react";
import { lazy, Suspense } from "@ui/lib/lazy";
import { Bot, Send, Inbox, FolderSync, GitPullRequestArrow, ExternalLink, CalendarClock, LayoutGrid, FileJson } from "lucide-react";
import type { ModuleUi } from "../registry";
import { recordModule } from "../../records/module";
import { registerRecordExtensions, type RecordContext } from "../../records/extensions";
import { Loader } from "../../components/display";

const Hub = lazy(() => import("./Hub"));
const ApiDocs = lazy(() => import("./Hub").then((m) => ({ default: m.ApiDocs })));
const UserAccess = lazy(() => import("./Panels").then((m) => ({ default: m.UserAccess })));
const WebhookActions = lazy(() => import("./Panels").then((m) => ({ default: m.WebhookActions })));
const WebhookDeliveries = lazy(() => import("./Panels").then((m) => ({ default: m.WebhookDeliveries })));
const SecretButton = lazy(() => import("./Panels").then((m) => ({ default: m.SecretButton })));
const InboundEvents = lazy(() => import("./Panels").then((m) => ({ default: m.InboundEvents })));
const DirectoryActions = lazy(() => import("./Panels").then((m) => ({ default: m.DirectoryActions })));
const DirectoryUrls = lazy(() => import("./Panels").then((m) => ({ default: m.DirectoryUrls })));
const DirectoryLogin = lazy(() => import("./DirectoryLogin").then((m) => ({ default: m.DirectoryLogin })));
const IssueConnectionUrls = lazy(() => import("./Panels").then((m) => ({ default: m.IssueConnectionUrls })));
const ExportActions = lazy(() => import("./Panels").then((m) => ({ default: m.ExportActions })));
const IssuesPanel = lazy(() => import("./Panels").then((m) => ({ default: m.IssuesPanel })));

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
const page = (node: ReactNode) => <Suspense fallback={<Loader />}>{node}</Suspense>;

const S = "اتصال‌ها و یکپارچه‌سازی";

const module = recordModule({
  key: "integration",
  spaceKey: "settings",
  group: { key: "integration", label: S },
  tables: [
    {
      table: "integration_user", path: "integrations/users", label: "کاربران یکپارچه‌سازی", noun: "کاربر یکپارچه‌سازی", icon: Bot, section: S, area: "integrations", keywords: "API کلید توکن برنامه سامانهٔ دیگر حساب خدمت REST",
      extensions: { tabs: [{ key: "integration:access", label: "نقش‌ها و کلیدها", order: 1, render: widget(UserAccess) }] },
    },
    {
      table: "webhook_subscription", path: "integrations/webhooks", label: "وب‌هوک‌های خروجی", noun: "وب‌هوک خروجی", icon: Send, section: S, area: "integrations", keywords: "وب‌هوک webhook رویداد امضا HMAC اشتراک",
      extensions: { headerActions: action("integration:webhook", WebhookActions), tabs: [{ key: "integration:deliveries", label: "ارسال‌ها", order: 1, render: widget(WebhookDeliveries) }] },
    },
    {
      table: "inbound_endpoint", path: "integrations/inbound", label: "نقطه‌های دریافت", noun: "نقطهٔ دریافت", icon: Inbox, section: S, area: "integrations", keywords: "وب‌هوک ورودی دریافت پایش هشدار زبیکس alertmanager",
      extensions: { headerActions: action("integration:inbound", SecretButton), tabs: [{ key: "integration:inbound-events", label: "دریافتی‌ها", order: 1, render: widget(InboundEvents) }] },
    },
    {
      table: "directory_source", path: "integrations/directory", label: "فهرست کاربران (LDAP و SCIM)", noun: "منبع فهرست کاربران", icon: FolderSync, section: S, area: "integrations", keywords: "اکتیو دایرکتوری Active Directory LDAP SCIM Entra Azure AD همگام‌سازی کاربران",
      extensions: {
        headerActions: action("integration:directory", DirectoryActions),
        sidePanels: [{ key: "integration:scim-url", title: "نشانی SCIM", order: 1, when: (ctx) => ctx.row.kind === "scim", render: widget(DirectoryUrls) }],
        // «ورود با حساب سازمانی» and Windows SSO: login test, mapping preview, the SSO checklist, the source's sign-ins
        tabs: [{ key: "integration:login", label: "ورود و SSO", order: 1, when: (ctx) => ctx.row.kind === "ldap", render: widget(DirectoryLogin) }],
      },
    },
    {
      table: "issue_connection", path: "integrations/issues", label: "Jira و GitHub", noun: "اتصال Jira یا GitHub", icon: GitPullRequestArrow, section: S, area: "integrations", keywords: "جیرا گیت‌هاب issue همگام‌سازی",
      extensions: { headerActions: action("integration:issues", SecretButton), sidePanels: [{ key: "integration:issue-url", title: "نشانی وب‌هوک", order: 1, render: widget(IssueConnectionUrls) }] },
    },
    { table: "external_ref", path: "integrations/issue-links", label: "پیوندهای issue", icon: ExternalLink, section: S, area: "integrations", newAction: false, search: false, keywords: "issue پیوند بیرونی" },
    {
      table: "export_schedule", path: "integrations/exports", label: "خروجی‌های زمان‌بندی‌شده", noun: "خروجی زمان‌بندی‌شده", icon: CalendarClock, section: S, area: "integrations", keywords: "خروجی دوره‌ای انبار داده BI",
      extensions: { headerActions: action("integration:export", ExportActions) },
    },
  ],
  nav: [
    { key: "integration:hub", label: "مرکز اتصال‌ها", path: "integrations/hub", icon: LayoutGrid, section: S, area: "integrations", keywords: "اتصال یکپارچه‌سازی رابط سلامت" },
    { key: "integration:api", label: "مستندات API", path: "integrations/api", icon: FileJson, section: S, area: "integrations", keywords: "OpenAPI Swagger مستندات REST" },
  ],
  routes: [
    { path: "integrations/hub", element: page(<Hub />) },
    { path: "integrations/api", element: page(<ApiDocs />) },
  ],
  segments: { integrations: "settings" },
});

// the Jira/GitHub side panel on records people work (shown when the table has links)
for (const table of ["incident", "problem", "change_request", "known_error", "todo"]) {
  registerRecordExtensions(table, { sidePanels: [{ key: "integration:issues", title: "Jira و GitHub", order: 40, render: widget(IssuesPanel) }] });
}

export const integrationUi: ModuleUi = module;
