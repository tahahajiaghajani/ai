// The tenant administration console (docs/modules/admin_FA.md), a group «کنسول مدیریت» of the settings space:
//   pages         «کنسول مدیریت» (set-up checklist, plan and limits, features, jobs, what is new), «برند و ظاهر»,
//                 «ورود گروهی اعضا», «ماتریس دسترسی» (who sees what, and why), «استودیو» (custom tables and fields,
//                 versions, packages between organisations, drafts from Persian), «گزارش‌های سامانه», «مجوزها و صندلی‌ها»
//   lists         import sets and transform maps (CSV/XLSX, scheduled), data exports, system notices, licence pools
//   record pages  analyse / suggest a mapping / dry run / run an import set; publish a notice
//   elsewhere     the platform owner's console sections (src/ui/pages/admin, lazy from ./platform)
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { LayoutDashboard, Palette, UserPlus, Grid3x3, Shapes, ScrollText, IdCard, FileInput, ArrowRightLeft, Download, Megaphone, FlaskConical } from "lucide-react";
import type { ModuleUi } from "../registry";
import { recordModule } from "../../records/module";
import type { RecordContext } from "../../records/extensions";
import { Loader } from "../../components/display";

const Home = lazy(() => import("./Home"));
const Branding = lazy(() => import("./Branding"));
const MemberImport = lazy(() => import("./MemberImport"));
const AccessMatrix = lazy(() => import("./AccessMatrix"));
const Studio = lazy(() => import("./Studio"));
const CustomTable = lazy(() => import("./Studio").then((m) => ({ default: m.CustomTable })));
const Logs = lazy(() => import("./Logs"));
const Licences = lazy(() => import("./Licences"));
const Demo = lazy(() => import("./Demo"));
const ImportActions = lazy(() => import("./Panels").then((m) => ({ default: m.ImportActions })));
const NoticeActions = lazy(() => import("./Panels").then((m) => ({ default: m.NoticeActions })));
const ExportButton = lazy(() => import("./Panels").then((m) => ({ default: m.ExportButton })));

const action = (key: string, C: ComponentType<{ ctx: RecordContext }>) => (ctx: RecordContext): ReactNode => (
  <Suspense key={key} fallback={null}>
    <C ctx={ctx} />
  </Suspense>
);
const page = (node: ReactNode) => <Suspense fallback={<Loader />}>{node}</Suspense>;

const S = "کنسول مدیریت";
const DATA = "ورود و خروج داده";

const module = recordModule({
  key: "admin",
  spaceKey: "settings",
  group: { key: "admin", label: S },
  tables: [
    { table: "import_set", path: "settings/imports", label: "ورود داده از فایل", noun: "مجموعهٔ ورود", icon: FileInput, section: DATA, area: "settings", keywords: "CSV اکسل XLSX ورود داده انتقال نقشهٔ تبدیل زمان‌بندی", extensions: { headerActions: action("admin:import", ImportActions) } },
    { table: "transform_map", path: "settings/transform-maps", label: "نقشه‌های تبدیل", noun: "نقشهٔ تبدیل", icon: ArrowRightLeft, section: DATA, area: "settings", keywords: "نگاشت ستون فیلد تبدیل ورود" },
    { table: "data_export", path: "settings/exports", label: "خروجی داده", noun: "خروجی داده", icon: Download, section: DATA, area: "settings", newAction: false, keywords: "خروجی JSON CSV اکسل پشتیبان داده‌ها", list: { actions: <Suspense fallback={null}><ExportButton /></Suspense> } },
    { table: "system_notice", path: "settings/notices", label: "اطلاعیه‌های سامانه", noun: "اطلاعیهٔ سامانه", icon: Megaphone, section: S, area: "settings", keywords: "اطلاعیه نگهداری اختلال پیام همگانی", extensions: { headerActions: action("admin:notice", NoticeActions) } },
    { table: "licence_pool", path: "settings/licence-pools", label: "مجوزها", noun: "مجوز", icon: IdCard, area: "settings", hidden: true, search: false },
    { table: "custom_table", path: "settings/studio/tables", label: "جدول‌های سفارشی", icon: Shapes, area: "settings", hidden: true, newAction: false, search: false },
    { table: "studio_version", path: "settings/studio/versions", label: "نسخه‌های استودیو", icon: Shapes, area: "settings", hidden: true, newAction: false, search: false },
  ],
  nav: [
    { key: "admin:home", label: "کنسول مدیریت", path: "settings/admin", icon: LayoutDashboard, section: S, area: "settings", keywords: "راه‌اندازی طرح محدودیت قابلیت مدیر سازمان" },
    { key: "admin:branding", label: "برند و ظاهر", path: "settings/branding", icon: Palette, section: S, area: "settings", keywords: "رنگ لوگو نشان پرتال پیام ورود پانویس ایمیل" },
    { key: "admin:member-import", label: "ورود گروهی اعضا", path: "settings/member-import", icon: UserPlus, section: S, area: "users", level: "edit", keywords: "اکسل CSV افزودن کاربران کارکنان" },
    { key: "admin:matrix", label: "ماتریس دسترسی", path: "access/matrix", icon: Grid3x3, section: S, area: "users", keywords: "چه کسی چه می‌بیند نقش جدول خواندن نوشتن توضیح" },
    { key: "admin:studio", label: "استودیو", path: "settings/studio", icon: Shapes, section: S, area: "settings", keywords: "جدول سفارشی فیلد سفارشی فرم فهرست نسخه بسته" },
    { key: "admin:logs", label: "گزارش‌های سامانه", path: "settings/logs", icon: ScrollText, section: S, area: "settings", level: "full", keywords: "کار پس‌زمینه اعلان جریان کار اتصال امنیت خطا" },
    { key: "admin:licences", label: "مجوزها و صندلی‌ها", path: "settings/licences", icon: IdCard, section: S, area: "settings", keywords: "لایسنس صندلی کارشناس کاربر بیکار" },
    { key: "admin:demo", label: "داده‌های نمایشی", path: "settings/demo", icon: FlaskConical, section: S, area: "settings", level: "full", keywords: "دمو نمایش بانک نمونه آفتاب آزمایشی بارگذاری حذف" },
  ],
  routes: [
    { path: "settings/admin", element: page(<Home />) },
    { path: "settings/branding", element: page(<Branding />) },
    { path: "settings/member-import", element: page(<MemberImport />) },
    { path: "access/matrix", element: page(<AccessMatrix />) },
    { path: "settings/studio", element: page(<Studio />) },
    { path: "studio/t/:slot", element: page(<CustomTable />) },
    { path: "settings/logs", element: page(<Logs />) },
    { path: "settings/licences", element: page(<Licences />) },
    { path: "settings/demo", element: page(<Demo />) },
  ],
  segments: { studio: "settings" },
});

export const adminUi: ModuleUi = module;
