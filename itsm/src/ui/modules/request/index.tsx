// Service requests and the catalogue's screens (docs/modules/request_FA.md). The module adds the sidebar space «خدمات»
// (service requests now; department catalogues of ESM later) with the group «درخواست‌ها»:
//   ordering      «سفارش از کاتالوگ» (the agent and administrator side; the requester portal embeds OrderForm later)
//                 and «سبد سفارش» (with a live count)
//   queues        «اقلام من», «بی‌مسئول در گروه‌های من», «وظایف من», «وظایف گروه‌های من», «در انتظار تأیید»,
//                 «منتظر درخواست‌کننده», «گذشته از موعد», and every order, requested item and task (lists, boards)
//   record pages  requested items: header actions (درخواست اطلاعات، بازخورد، سفارش دوباره، تغییر قلم، تبدیل به رخداد),
//                 «پیشرفت» side panel, «پاسخ‌ها» tab; tasks: «پاسخ‌های قلم» tab and «فهرست وارسی»; catalogue items:
//                 «سازندهٔ کاتالوگ» and «سفارش»; UI policies hiding fields that do not apply
//   catalogue     catalogues, categories, items (with the builder: questions, policies, approval, fulfilment,
//                 audiences, versions and a live preview), question sets, audiences, order-guide rules
//   reports       «داشبورد درخواست‌ها»; settings «تنظیمات درخواست خدمت»
// Only light modules are imported here; every page loads with its route.
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import {
  ShoppingBag, ShoppingCart, PackageCheck, ListTodo, Repeat, LibraryBig, FolderTree, Package, ListChecks, UsersRound, ListTree, ChartColumn, Settings2, User, Users, Stamp,
  Hourglass, AlarmClock, ClipboardList, Inbox,
} from "lucide-react";
import type { AccessGate } from "@shared/access";
import type { ModuleUi, NavItem } from "../registry";
import { recordModule } from "../../records/module";
import type { RecordContext } from "../../records/extensions";
import { Loader } from "../../components/display";
import { cartCount } from "./api";
import { recordsApi } from "../../records/data/api";
import type { OrgApi } from "../../lib/api";
import { QUEUES, rowTone, type Queue } from "./model";

const ItemActions = lazy(() => import("./ItemPanels").then((m) => ({ default: m.ItemActions })));
const ProgressPanel = lazy(() => import("./ItemPanels").then((m) => ({ default: m.ProgressPanel })));
const AnswersTab = lazy(() => import("./ItemPanels").then((m) => ({ default: m.AnswersTab })));
const TaskChecklist = lazy(() => import("./ItemPanels").then((m) => ({ default: m.TaskChecklist })));
const CatalogItemActions = lazy(() => import("./ItemPanels").then((m) => ({ default: m.CatalogItemActions })));
const Catalog = lazy(() => import("./Catalog"));
const Cart = lazy(() => import("./Cart"));
const Builder = lazy(() => import("./Builder"));
const Dashboard = lazy(() => import("./Dashboard"));
const Settings = lazy(() => import("./Settings"));
const QueuePage = lazy(() => import("./QueuePage"));

const widget = (C: ComponentType<{ ctx: RecordContext }>) => (ctx: RecordContext): ReactNode => (
  <Suspense fallback={<Loader />}>
    <C ctx={ctx} />
  </Suspense>
);
const header = (C: ComponentType<{ ctx: RecordContext }>, key: string) => (ctx: RecordContext): ReactNode => (
  <Suspense key={key} fallback={null}>
    <C ctx={ctx} />
  </Suspense>
);
const lazyPage = (node: ReactNode) => <Suspense fallback={<Loader />}>{node}</Suspense>;

export const SERVICE_SPACE = { key: "service", label: "خدمات", title: "درخواست‌های خدمت و کاتالوگ", icon: ShoppingBag };

/** Who is offered what (the server checks every route again): ordering and one's own orders for everyone; the
 *  fulfilment queues, lists and dashboard for those who read beyond their own requests; the catalogue's definitions
 *  for its managers (create in the catalogue area). */
const FULFILS: AccessGate = { area: "request", scope: "group" };
const MANAGES_CATALOG: AccessGate = { area: "catalog", op: "create" };

const CATALOG = "کاتالوگ";
const ICONS: Record<string, typeof ShoppingBag> = { mine: User, unassigned: Users, "my-tasks": ClipboardList, "group-tasks": ListTodo, approval: Stamp, info: Hourglass, overdue: AlarmClock };
const DONE_ITEM = ["delivered", "closed_complete", "closed_incomplete"];

/**
 * The group queues' counts (items and tasks of the caller's groups nobody took yet): a large group hears of new work
 * here and through its leads (notify.md «گروه‌های بزرگ»), not through a bell for every member.
 */
const queueCount = (q: Queue) => async (api: OrgApi) =>
  (await recordsApi.list(api, q.table, { filter: q.filter(Date.now()), size: 1, fields: ["number"], total: true })).total ?? 0;
const COUNTED: Record<string, string> = { unassigned: "قلم بی‌مسئول در گروه‌های شما", "group-tasks": "وظیفهٔ بی‌مسئول در گروه‌های شما" };

const queueNav = (q: Queue, i: number): NavItem => ({
  key: `request:q:${q.key}`,
  label: q.label,
  path: q.path,
  icon: ICONS[q.key] ?? Inbox,
  area: "work", access: FULFILS,
  workspace: i === 0,
  keywords: "درخواست خدمت قلم وظیفه صف کارتابل RITM RTSK",
  ...(COUNTED[q.key] ? { count: { key: `request:${q.key}`, hint: COUNTED[q.key], load: queueCount(q) } } : {}),
});

const module = recordModule({
  key: "request",
  space: SERVICE_SPACE,
  group: { key: "request", label: "درخواست‌ها" },
  tables: [
    {
      table: "request_item", path: "request-items", label: "همهٔ اقلام درخواست‌شده", noun: "قلم درخواست‌شده", icon: PackageCheck, area: "work", access: FULFILS, newAction: false,
      keywords: "قلم درخواست‌شده درخواست خدمت سفارش RITM", search: { group: "اقلام درخواست‌شده" },
      list: { preset: { rowTone: (r) => rowTone(r), emptyText: "هنوز قلمی سفارش داده نشده است" } },
      extensions: {
        headerActions: header(ItemActions, "request-item-actions"),
        sidePanels: [{ key: "request:progress", title: "پیشرفت", order: 1, render: widget(ProgressPanel) }],
        tabs: [{ key: "request:answers", label: "پاسخ‌ها", order: 1, render: widget(AnswersTab) }],
        cardFields: ["stage", "requested_for", "due_at"],
        policies: [
          { key: "request:feedback", when: { f: "state", op: "nin", v: DONE_ITEM }, actions: [{ field: "rating", visible: false }, { field: "feedback", visible: false }] },
          { key: "request:access", when: { f: "access_until", op: "empty" }, actions: [{ field: "access_until", visible: false }, { field: "revoked_at", visible: false }] },
          { key: "request:subscription", when: { f: "subscription_id", op: "empty" }, actions: [{ field: "subscription_id", visible: false }] },
        ],
      },
    },
    {
      table: "request", path: "requests", label: "سفارش‌ها", noun: "سفارش", icon: ShoppingBag, area: "work", newAction: false,
      keywords: "سفارش درخواست خدمت REQ", search: { group: "سفارش‌ها" },
      extensions: { cardFields: ["requested_for", "items_count", "stage"] },
    },
    {
      table: "request_task", path: "request-tasks", label: "همهٔ وظایف انجام", noun: "وظیفهٔ انجام", icon: ListTodo, area: "work", access: FULFILS,
      keywords: "وظیفه انجام درخواست RTSK", search: { group: "وظایف انجام" },
      list: { preset: { rowTone: (r) => rowTone(r) } },
      extensions: {
        tabs: [{ key: "request:task-answers", label: "پاسخ‌های قلم", order: 1, render: widget(AnswersTab) }],
        sidePanels: [{ key: "request:checklist", title: "فهرست وارسی", order: 1, when: (ctx) => Array.isArray(ctx.row.checklist) && ctx.row.checklist.length > 0, render: widget(TaskChecklist) }],
        cardFields: ["class_of_service", "assigned_to", "due_at"],
        policies: [
          { key: "request:blocked", when: { f: "blocked", op: "ne", v: true }, actions: [{ field: "blocked_reason", visible: false }] },
          { key: "request:deviation", when: { f: "deviation", op: "ne", v: true }, actions: [{ field: "deviation_note", visible: false }] },
        ],
      },
    },
    { table: "request_subscription", path: "subscriptions", label: "اشتراک‌های خدمت", noun: "اشتراک خدمت", icon: Repeat, section: "اشتراک‌ها", area: "work", keywords: "اشتراک هزینه دوره‌ای مصرف SUB" },
    { table: "catalog", path: "catalogs", label: "کاتالوگ‌ها", noun: "کاتالوگ", icon: LibraryBig, section: CATALOG, area: "work", access: MANAGES_CATALOG, keywords: "کاتالوگ خدمات" },
    { table: "catalog_category", path: "catalog-categories", label: "دسته‌های کاتالوگ", noun: "دستهٔ کاتالوگ", icon: FolderTree, section: CATALOG, area: "work", access: MANAGES_CATALOG, search: false },
    {
      table: "catalog_item", path: "catalog-items", label: "اقلام کاتالوگ", noun: "قلم کاتالوگ", icon: Package, section: CATALOG, area: "work", access: MANAGES_CATALOG,
      keywords: "قلم کاتالوگ مدل درخواست فرم سفارش ITM", search: { group: "اقلام کاتالوگ" },
      extensions: {
        headerActions: header(CatalogItemActions, "catalog-item-actions"),
        cardFields: ["type", "category_id", "version_no"],
        policies: [
          { key: "catalog:content", when: { f: "type", op: "ne", v: "content" }, actions: [{ field: "content_url", visible: false }] },
          { key: "catalog:producer", when: { f: "type", op: "nin", v: ["record_producer", "standard_change", "hardware", "software", "access", "standard", "loaner"] }, actions: [{ field: "target_table", visible: false }, { field: "field_map", visible: false }] },
          { key: "catalog:std-change", when: { f: "type", op: "ne", v: "standard_change" }, actions: [{ field: "std_change_template", visible: false }] },
          { key: "catalog:quantity", when: { f: "quantity_allowed", op: "ne", v: true }, actions: [{ field: "max_quantity", visible: false }] },
          { key: "catalog:recurring", when: { f: "recurring_price", op: "empty" }, actions: [{ field: "recurring_frequency", visible: false }, { field: "creates_subscription", visible: false }] },
        ],
      },
    },
    { table: "variable_set", path: "question-sets", label: "مجموعه‌پرسش‌ها", noun: "مجموعه‌پرسش", icon: ListChecks, section: CATALOG, area: "work", access: MANAGES_CATALOG, search: false, keywords: "مجموعه پرسش متغیر جدول چندسطری" },
    { table: "catalog_audience", path: "audiences", label: "مخاطبان کاتالوگ", noun: "مخاطب کاتالوگ", icon: UsersRound, section: CATALOG, area: "work", access: MANAGES_CATALOG, search: false, keywords: "مخاطب استحقاق دسترسی سفارش" },
    { table: "order_guide_rule", path: "order-guide-rules", label: "قاعده‌های راهنمای سفارش", noun: "قاعدهٔ راهنمای سفارش", icon: ListTree, section: CATALOG, area: "work", access: MANAGES_CATALOG, search: false, keywords: "راهنمای سفارش بسته" },
    { table: "catalog_variable", path: "catalog-questions", label: "پرسش‌های فرم", icon: ListChecks, hidden: true, search: false, newAction: false },
    { table: "catalog_ui_policy", path: "catalog-policies", label: "قاعده‌های فرم سفارش", icon: ListChecks, hidden: true, search: false, newAction: false },
    { table: "catalog_task_template", path: "catalog-tasks", label: "الگوهای وظیفه", icon: ListTodo, hidden: true, search: false, newAction: false },
    { table: "catalog_item_version", path: "catalog-item-versions", label: "نسخه‌های اقلام", icon: Package, hidden: true, search: false, newAction: false },
    { table: "request_answer", path: "request-answers", label: "پاسخ‌های سفارش", icon: ListChecks, hidden: true, search: false, newAction: false },
    { table: "request_config", path: "request-settings/record", label: "تنظیمات درخواست خدمت", icon: Settings2, hidden: true, search: false, newAction: false },
    { table: "request_cart", path: "request-carts", label: "سبدها", icon: ShoppingCart, hidden: true, search: false, newAction: false },
    { table: "request_cart_line", path: "request-cart-lines", label: "اقلام سبد", icon: ShoppingCart, hidden: true, search: false, newAction: false },
  ],
  nav: [
    { key: "request:dashboard", label: "داشبورد درخواست‌ها", path: "requests/dashboard", icon: ChartColumn, section: "گزارش‌ها", area: "work", access: FULFILS, keywords: "داشبورد شاخص زمان انجام رضایت درخواست" },
    { key: "request:settings", label: "تنظیمات درخواست خدمت", path: "request-settings", icon: Settings2, section: CATALOG, area: "work", access: MANAGES_CATALOG, keywords: "تنظیمات تأیید خودکار یادآوری پیش‌فرض کاتالوگ" },
  ],
  routes: [
    ...QUEUES.map((q) => ({ path: q.path, element: lazyPage(<QueuePage queue={q.key} />) })),
    { path: "catalog", element: lazyPage(<Catalog />) },
    { path: "catalog/cart", element: lazyPage(<Cart />) },
    { path: "requests/dashboard", element: lazyPage(<Dashboard />) },
    { path: "catalog-items/:id/builder", element: lazyPage(<Builder />) },
    { path: "request-settings", element: lazyPage(<Settings />) },
  ],
  segments: Object.fromEntries(
    ["requests", "request-items", "request-tasks", "subscriptions", "catalog", "catalogs", "catalog-categories", "catalog-items", "question-sets", "audiences", "order-guide-rules", "catalog-questions", "catalog-policies", "catalog-tasks", "catalog-item-versions", "request-answers", "request-settings", "request-carts", "request-cart-lines"].map((s) => [s, "service"]),
  ),
});

const ORDER_NAV: NavItem[] = [
  { key: "request:catalog", label: "سفارش از کاتالوگ", path: "catalog", icon: ShoppingBag, area: "work", workspace: true, keywords: "سفارش کاتالوگ خدمات درخواست تازه" },
  { key: "request:cart", label: "سبد سفارش", path: "catalog/cart", icon: ShoppingCart, area: "work", keywords: "سبد خرید سفارش", count: { key: "request:cart", hint: "قلم در سبد", load: cartCount } },
];

// ordering and the queues first, then every list and the rest of the group
const [group] = module.nav;
export const requestUi: ModuleUi = {
  ...module,
  nav: [{ ...group, items: [...ORDER_NAV, ...QUEUES.map(queueNav), ...group.items] }, ...module.nav.slice(1)],
};
