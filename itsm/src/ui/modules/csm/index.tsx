// Customer service management's screens (docs/modules/csm_FA.md): the sidebar space «خدمات مشتریان» with the group
// «مشتریان»:
//   queues        «پرونده‌های مشتری من» (live count), «بی‌کارشناس در گروه‌های من» (with «پروندهٔ بعدی»), «مشتریان
//                 ناخرسند», «تشدیدشده و شکایت», «حساب‌های من»
//   pages         «نمای ۳۶۰ مشتری» (signature screen), «داشبورد خدمات مشتریان»
//   record page   case: 360, internal raise, major-case broadcast; account: 360 (header and tab); notice: send;
//                 review: pack
//   lists         cases, accounts, contacts, products, installed base, contracts, entitlements and their ledger,
//                 escalations, plans, stakeholders, reviews, notices, experiences
//   elsewhere     «پرونده‌های پیش‌دستانه» on incidents
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import {
  Headphones, Building, Contact, Package, Server, FileSignature, BadgePercent, Receipt, TrendingUp, Target, UsersRound, Presentation, Palette, Megaphone, LayoutDashboard, User, Inbox, Frown, Flame, Briefcase, Settings,
} from "lucide-react";
import type { AccessGate } from "@shared/access";
import type { ModuleUi, NavItem } from "../registry";
import { recordModule, RecordListRoute } from "../../records/module";
import { registerRecordExtensions, type RecordContext } from "../../records/extensions";
import { recordsApi } from "../../records/data/api";
import { Loader } from "../../components/display";
import type { OrgApi } from "../../lib/api";
import { QUEUES, type Queue } from "./model";

const Customer360Page = lazy(() => import("./Customer360"));
const Account360 = lazy(() => import("./Customer360").then((m) => ({ default: m.Account360 })));
const Dashboard = lazy(() => import("./Panels").then((m) => ({ default: m.Dashboard })));
const CaseActions = lazy(() => import("./Panels").then((m) => ({ default: m.CaseActions })));
const AccountActions = lazy(() => import("./Panels").then((m) => ({ default: m.AccountActions })));
const NoticeSend = lazy(() => import("./Panels").then((m) => ({ default: m.NoticeSend })));
const ReviewPack = lazy(() => import("./Panels").then((m) => ({ default: m.ReviewPack })));
const ProactiveCases = lazy(() => import("./Panels").then((m) => ({ default: m.ProactiveCases })));
const NextCase = lazy(() => import("./Panels").then((m) => ({ default: m.NextCase })));

const action = (key: string, C: ComponentType<{ ctx: RecordContext }>) => (ctx: RecordContext): ReactNode => (
  <Suspense key={key} fallback={null}>
    <C ctx={ctx} />
  </Suspense>
);
const lazyPage = (node: ReactNode) => <Suspense fallback={<Loader />}>{node}</Suspense>;

const READS: AccessGate = { area: "csm" };
const TEAM: AccessGate = { area: "csm", scope: "group" };
const ADMIN: AccessGate = { area: "csm", op: "admin" };

export const CSM_SPACE = { key: "csm", label: "مشتریان", title: "خدمات مشتریان", icon: Headphones, access: READS };

const QUEUE_ICONS: Record<string, typeof Inbox> = { mine: User, unassigned: Inbox, unhappy: Frown, escalated: Flame, accounts: Briefcase };
const myCount = async (api: OrgApi) => (await recordsApi.list(api, "customer_case", { filter: QUEUES[0].filter, size: 1, fields: ["number"], total: true })).total ?? 0;

const queueNav = (q: Queue, i: number): NavItem => ({
  key: `csm:q:${q.key}`, label: q.label, path: q.path, icon: QUEUE_ICONS[q.key] ?? Inbox, area: "work", access: q.key === "mine" || q.key === "accounts" ? READS : TEAM,
  workspace: i < 2, keywords: "مشتری پرونده صف حساب",
  ...(i === 0 ? { count: { key: "csm:mine", hint: "پروندهٔ باز مشتری که به شما سپرده شده", load: myCount } } : {}),
});

const module = recordModule({
  key: "csm",
  space: CSM_SPACE,
  group: { key: "csm", label: "مشتریان" },
  tables: [
    {
      table: "customer_case", path: "customers/cases", label: "پرونده‌های مشتری", noun: "پروندهٔ مشتری", icon: Headphones, area: "work", access: READS, keywords: "پرونده مشتری CS شکایت پشتیبانی", search: { group: "پرونده‌های مشتری" },
      list: { preset: { emptyText: "هنوز پرونده‌ای از مشتریان ثبت نشده است", board: { cardFields: ["account_id", "priority", "assigned_to"] } } },
      extensions: { headerActions: action("csm-case", CaseActions), cardFields: ["account_id", "priority", "assigned_to"] },
    },
    {
      table: "customer_account", path: "customers/accounts", label: "حساب‌های مشتری", noun: "حساب مشتری", icon: Building, area: "work", access: READS, keywords: "حساب مشتری شرکت سازمان B2B", search: { group: "حساب‌های مشتری" },
      extensions: {
        headerActions: action("csm-account", AccountActions),
        tabs: [{ key: "csm:360", label: "نمای ۳۶۰", order: 1, render: (ctx) => <Suspense fallback={<Loader />}><Account360 id={ctx.row.id} inline /></Suspense> }],
      },
    },
    { table: "customer_contact", path: "customers/contacts", label: "مخاطبان", noun: "مخاطب مشتری", icon: Contact, area: "work", access: READS, keywords: "مخاطب مشتری تماس B2C" },
    { table: "entitlement", path: "customers/entitlements", label: "استحقاق‌ها", noun: "استحقاق", icon: BadgePercent, area: "work", access: READS, keywords: "استحقاق پشتیبانی سهمیه SLA" },
    { table: "customer_contract", path: "customers/contracts", label: "قراردادها", noun: "قرارداد مشتری", icon: FileSignature, area: "work", access: READS, keywords: "قرارداد مشتری" },
    { table: "install_base_item", path: "customers/install-base", label: "پایگاه نصب", noun: "قلم پایگاه نصب", icon: Server, area: "work", access: READS, keywords: "پایگاه نصب محصول سریال" },
    { table: "case_escalation", path: "customers/escalations", label: "تشدیدها", noun: "تشدید", icon: TrendingUp, area: "work", access: READS, keywords: "تشدید مدیریتی اسکالیشن" },
    { table: "customer_notice", path: "customers/notices", label: "اطلاع‌رسانی‌ها", noun: "اطلاع‌رسانی به مشتریان", icon: Megaphone, area: "work", access: TEAM, keywords: "اطلاع‌رسانی نقض داده ناظر", extensions: { headerActions: action("csm-notice", NoticeSend) } },
    { table: "account_review", path: "customers/reviews", label: "بازبینی‌های خدمت", noun: "بازبینی خدمت", icon: Presentation, section: "حساب‌ها", area: "work", access: READS, keywords: "بازبینی فصلی QBR", extensions: { headerActions: action("csm-review", ReviewPack) } },
    { table: "account_plan", path: "customers/plans", label: "برنامه‌های حساب", noun: "برنامهٔ حساب", icon: Target, section: "حساب‌ها", area: "work", access: READS, keywords: "برنامه حساب هدف" },
    { table: "account_stakeholder", path: "customers/stakeholders", label: "نقشهٔ ذی‌نفعان", noun: "ذی‌نفع", icon: UsersRound, section: "حساب‌ها", area: "work", access: READS, keywords: "ذی‌نفع نفوذ" },
    { table: "entitlement_ledger", path: "customers/ledger", label: "دفتر مصرف", icon: Receipt, section: "حساب‌ها", area: "work", access: READS, keywords: "مصرف سهمیه", newAction: false, search: false },
    { table: "customer_product", path: "customers/products", label: "محصولات", noun: "محصول", icon: Package, section: "تعریف‌ها", area: "work", access: READS, keywords: "محصول نسخه" },
    { table: "customer_experience", path: "customers/experiences", label: "تجربه‌های مشتری", noun: "تجربهٔ مشتری", icon: Palette, section: "تعریف‌ها", area: "work", access: ADMIN, keywords: "برند درگاه مشتری" },
    { table: "csm_config", path: "customers/settings", label: "تنظیمات خدمات مشتریان", icon: Settings, section: "تعریف‌ها", area: "work", access: ADMIN, search: false, newAction: false },
    { table: "account_health", path: "customers/health", label: "سلامت روزانه", hidden: true, search: false, newAction: false },
  ],
  nav: [{ key: "csm:dashboard", label: "داشبورد خدمات مشتریان", path: "customers/dashboard", icon: LayoutDashboard, section: "گزارش‌ها", area: "work", access: READS, keywords: "داشبورد شکایت رضایت پذیرش" }],
  routes: [
    ...QUEUES.map((q) => ({
      path: q.path,
      element: <RecordListRoute table={q.table} title={q.label} preset={{ filter: q.filter, sort: q.sort, emptyText: q.empty }} actions={q.key === "unassigned" ? <Suspense fallback={null}><NextCase /></Suspense> : undefined} />,
    })),
    { path: "customers/accounts/:id/360", element: lazyPage(<Customer360Page />) },
    { path: "customers/dashboard", element: lazyPage(<Dashboard />) },
  ],
  segments: { customers: "csm" },
});

// «پرونده‌های پیش‌دستانه» on incidents (the accounts its configuration item serves)
registerRecordExtensions("incident", { headerActions: action("csm-proactive", ProactiveCases) });

const [group] = module.nav;
export const csmUi: ModuleUi = {
  ...module,
  nav: [{ ...group, items: [...QUEUES.map(queueNav), ...group.items] }],
};
