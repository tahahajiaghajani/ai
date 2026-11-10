// IT asset management's screens (docs/modules/itam_FA.md). The module joins configuration management's sidebar space
// «پیکربندی» (key "assets") with the group «دارایی‌ها»:
//   workspace     «داشبورد دارایی‌ها», every asset (list, board by state), «موجودی انبارها» with reorder alerts,
//                 «انطباق مجوزها» (licensed against installed, risk, savings, true-ups, the optimisation narrative),
//                 «چاپ برچسب» (QR labels on A4 sheets), warranties ending
//   record pages  the asset 360 (lifecycle timeline, assignments, contracts and warranty, TCO, linked CI, summary) with
//                 hand-over and return; audits with their scanning tab; orders with receiving; requisitions with ordering
//   lists         stock (stockrooms, rules, movements), audits, repairs, disposals, reservations; procurement
//                 (requisitions, orders, receipts); software (models, installations, entitlements, allocations,
//                 reconciliation runs, SaaS subscriptions and accounts); definitions (models, hardware standards,
//                 depreciation rules, label templates, catalogue bindings, settings)
// «دارایی‌های من» sits in the home space for everyone (requesters included: the module's holder grant). Requested
// items get the «دارایی‌ها» panel (hand over from stock), member profiles «بازپس‌گیری دارایی‌ها».
import { lazy } from "react";
import {
  Activity, Boxes, MonitorSmartphone, Package, PackageSearch, ShieldCheck, QrCode, Warehouse, Gauge, ArrowLeftRight, ScanBarcode, Wrench, Recycle, CalendarClock, ShoppingCart, FileText,
  PackageCheck, AppWindow, HardDriveDownload, KeyRound, UserCheck, Scale, Cloud, UserRound, BadgeCheck, TrendingDown, Link2, Settings2, Signature, Hand, ShieldAlert,
  Building2, Landmark, BookText, Truck, Stamp, Timer, Link as LinkIcon, Activity as Pulse,
} from "lucide-react";
import type { AccessGate } from "@shared/access";
import type { Cond } from "@shared/model/conditions";
import type { ModuleUi, NavGroup } from "../registry";
import { recordModule, RecordListRoute } from "../../records/module";
import { registerRecordExtensions } from "../../records/extensions";
import { action, lazyPage, widget } from "./parts";
import "./itam.css";

const Dashboard = lazy(() => import("./Dashboard"));
const MyAssets = lazy(() => import("./MyAssets"));
const StockPage = lazy(() => import("./StockPage"));
const Compliance = lazy(() => import("./Compliance"));
const Labels = lazy(() => import("./Labels"));
const AssetActions = lazy(() => import("./AssetParts").then((m) => ({ default: m.AssetActions })));
const Asset360Tab = lazy(() => import("./AssetParts").then((m) => ({ default: m.Asset360Tab })));
const RequestAssetsPanel = lazy(() => import("./AssetParts").then((m) => ({ default: m.RequestAssetsPanel })));
const LeaverAction = lazy(() => import("./AssetParts").then((m) => ({ default: m.LeaverAction })));
const AuditScanTab = lazy(() => import("./WorkParts").then((m) => ({ default: m.AuditScanTab })));
const PoActions = lazy(() => import("./WorkParts").then((m) => ({ default: m.PoActions })));
const Branches = lazy(() => import("./Bank").then((m) => ({ default: m.Branches })));
const Fleet = lazy(() => import("./Bank").then((m) => ({ default: m.Fleet })));
const Register = lazy(() => import("./Bank").then((m) => ({ default: m.Register })));
const MobileScan = lazy(() => import("./MobileScan"));
const TransferActions = lazy(() => import("./BankParts").then((m) => ({ default: m.TransferActions })));
const TransferPrintTab = lazy(() => import("./BankParts").then((m) => ({ default: m.TransferPrintTab })));
const AuditReconcileTab = lazy(() => import("./BankParts").then((m) => ({ default: m.AuditReconcileTab })));
const AuditMobileAction = lazy(() => import("./BankParts").then((m) => ({ default: m.AuditMobileAction })));
const AttestAction = lazy(() => import("./BankParts").then((m) => ({ default: m.AttestAction })));
const AssetClassTab = lazy(() => import("./BankParts").then((m) => ({ default: m.AssetClassTab })));
const WipeCertificateAction = lazy(() => import("./BankParts").then((m) => ({ default: m.WipeCertificateAction })));
const RequisitionActions = lazy(() => import("./WorkParts").then((m) => ({ default: m.RequisitionActions })));

const ASSETS: AccessGate = { area: "asset" };
const SOFTWARE: AccessGate = { area: "software" };
/** The register «دفتر اموال» (amounts): asset managers of a region or above, not a branch's own staff. */
const REGION_ASSETS: AccessGate = { area: "asset", scope: "unit_tree" };
const PROCUREMENT: AccessGate = { area: "procurement" };
const MANAGE: AccessGate = { area: "asset", op: "create" };

const STOCK = "انبار و عملیات";
const BUY = "تدارکات";
const SW = "نرم‌افزار";
const DEF = "تعریف‌ها";
const BANK = "شعبه‌ها و ناوگان";

const ASSET_COLUMNS = ["number", "asset_tag", "name", "model_id", "branch_id", "state", "substate", "assigned_to", "warranty_end"];
const rowTone = (r: Record<string, unknown>): "danger" | "warning" | null => (r.state === "missing" ? "danger" : r.substate === "to_be_returned" || r.substate === "defective" ? "warning" : null);
const WARRANTY: Cond = { and: [{ f: "state", op: "nin", v: ["disposed", "canceled", "retired"] }, { f: "warranty_end", op: "relative", v: { unit: "day", n: 90, dir: "next" } }] };

const module = recordModule({
  key: "itam",
  spaceKey: "assets",
  group: { key: "itam", label: "دارایی‌ها" },
  tables: [
    {
      table: "asset", path: "assets", label: "همهٔ دارایی‌ها", noun: "دارایی", icon: Boxes, area: "work", access: ASSETS, workspace: true,
      keywords: "دارایی اموال لپ‌تاپ رایانه تلفن نمایشگر سرور برچسب سریال", search: { group: "دارایی‌ها" },
      list: { preset: { columns: ASSET_COLUMNS, rowTone, emptyText: "هنوز دارایی‌ای ثبت نشده است" } },
      extensions: {
        headerActions: action("itam-asset", AssetActions),
        tabs: [
          { key: "itam:360", label: "نمای ۳۶۰", order: 0, participants: true, render: widget(Asset360Tab) },
          { key: "itam:class", label: "ویژگی‌ها و نگهداری", order: 1, render: widget(AssetClassTab) },
        ],
        cardFields: ["model_id", "assigned_to", "substate"],
      },
    },
    { table: "stockroom", path: "itam/stockrooms", label: "انبارها", noun: "انبار", icon: Warehouse, section: STOCK, area: "work", access: ASSETS, keywords: "انبار انبارک محل" },
    { table: "stock_rule", path: "itam/stock-rules", label: "قاعده‌های موجودی", noun: "قاعدهٔ موجودی", icon: Gauge, section: STOCK, area: "work", access: ASSETS, search: false, keywords: "نقطهٔ سفارش کمینه بیشینه" },
    { table: "stock_movement", path: "itam/movements", label: "گردش موجودی", icon: ArrowLeftRight, section: STOCK, area: "work", access: ASSETS, search: false, newAction: false, keywords: "گردش ورود خروج انبار" },
    { table: "inventory_audit", path: "itam/audits", label: "شمارش و ممیزی", noun: "شمارش", icon: ScanBarcode, section: STOCK, area: "work", access: ASSETS, keywords: "شمارش انبارگردانی ممیزی اسکن بارکد QR", extensions: {
        headerActions: action("itam-audit-mobile", AuditMobileAction),
        tabs: [{ key: "itam:scan", label: "شمارش", order: 0, render: widget(AuditScanTab) }, { key: "itam:reconcile", label: "مغایرت‌ها", order: 1, render: widget(AuditReconcileTab) }],
      } },
    { table: "inventory_audit_item", path: "itam/audit-items", label: "اقلام شمارش", icon: ScanBarcode, hidden: true, search: false, newAction: false },
    { table: "repair_order", path: "itam/repairs", label: "تعمیرها", noun: "تعمیر", icon: Wrench, section: STOCK, area: "work", access: ASSETS, keywords: "تعمیر RMA گارانتی خرابی" },
    { table: "disposal_order", path: "itam/disposals", label: "اسقاط", noun: "دستور اسقاط", icon: Recycle, section: STOCK, area: "work", access: ASSETS, keywords: "اسقاط امحا بازیافت پاک‌سازی داده گواهی" },
    { table: "disposal_item", path: "itam/disposal-items", label: "اقلام اسقاط", icon: Recycle, hidden: true, search: false, newAction: false, extensions: { headerActions: action("itam-wipe-cert", WipeCertificateAction) } },
    {
      table: "asset_transfer", path: "itam/transfers", label: "حواله‌های انتقال", noun: "حوالهٔ انتقال", icon: Truck, section: BANK, area: "work", access: ASSETS,
      keywords: "حواله انتقال رسید شعبه جابه‌جایی",
      extensions: { headerActions: action("itam-transfer", TransferActions), tabs: [{ key: "itam:transfer", label: "حواله و رسید", order: 0, participants: true, render: widget(TransferPrintTab) }] },
    },
    { table: "asset_transfer_item", path: "itam/transfer-items", label: "اقلام حواله", icon: Truck, hidden: true, search: false, newAction: false },
    {
      table: "branch_attestation", path: "itam/attestations", label: "تأیید اموال شعبه", noun: "تأیید اموال شعبه", icon: Stamp, section: BANK, area: "work", access: ASSETS, newAction: false,
      keywords: "تأیید رئیس شعبه اموال دوره‌ای امضا", extensions: { headerActions: action("itam-attest", AttestAction) },
    },
    { table: "asset_custody", path: "itam/custody", label: "زنجیرهٔ نگهداری", icon: LinkIcon, section: BANK, area: "work", access: ASSETS, search: false, newAction: false, keywords: "زنجیره نگهداری ممیزی مسئولیت" },
    { table: "device_status_event", path: "itam/device-status", label: "تاریخچهٔ وضعیت دستگاه‌ها", icon: Pulse, hidden: true, search: false, newAction: false },
    { table: "maintenance_sla", path: "itam/maintenance-slas", label: "تعهدهای نگهداری دستگاه", noun: "تعهد نگهداری", icon: Timer, section: DEF, area: "work", access: MANAGE, search: false, keywords: "جریمه پیمانکار نگهداری خودپرداز SLA" },
    { table: "asset_reservation", path: "itam/reservations", label: "رزرو امانی", noun: "رزرو", icon: CalendarClock, section: STOCK, area: "work", access: ASSETS, keywords: "امانی رزرو قرض" },
    { table: "asset_assignment", path: "itam/assignments", label: "تاریخچهٔ تحویل", icon: Hand, section: STOCK, area: "work", access: ASSETS, search: false, newAction: false },
    { table: "asset_acknowledgement", path: "itam/acknowledgements", label: "تعهدنامه‌ها", noun: "تعهدنامه", icon: Signature, section: STOCK, area: "work", access: ASSETS, newAction: false, keywords: "تعهدنامه رسید امضا" },
    { table: "purchase_requisition", path: "itam/requisitions", label: "درخواست‌های خرید", noun: "درخواست خرید", icon: ShoppingCart, section: BUY, area: "work", access: PROCUREMENT, keywords: "خرید درخواست تدارکات", extensions: { headerActions: action("itam-prq", RequisitionActions) } },
    { table: "purchase_requisition_line", path: "itam/requisition-lines", label: "اقلام درخواست خرید", icon: ShoppingCart, hidden: true, search: false, newAction: false },
    { table: "purchase_order", path: "itam/orders", label: "سفارش‌های خرید", noun: "سفارش خرید", icon: FileText, section: BUY, area: "work", access: PROCUREMENT, keywords: "سفارش خرید PO تأمین‌کننده", extensions: { headerActions: action("itam-po", PoActions) } },
    { table: "purchase_order_line", path: "itam/order-lines", label: "سطرهای سفارش", icon: FileText, hidden: true, search: false, newAction: false },
    { table: "goods_receipt", path: "itam/receipts", label: "رسیدهای کالا", noun: "رسید کالا", icon: PackageCheck, section: BUY, area: "work", access: PROCUREMENT, keywords: "رسید دریافت کالا GRN" },
    { table: "goods_receipt_line", path: "itam/receipt-lines", label: "سطرهای رسید", icon: PackageCheck, hidden: true, search: false, newAction: false },
    { table: "software_model", path: "itam/software", label: "مدل‌های نرم‌افزار", noun: "مدل نرم‌افزار", icon: AppWindow, section: SW, area: "work", access: SOFTWARE, keywords: "نرم‌افزار ناشر یکسان‌سازی" },
    { table: "software_install", path: "itam/installs", label: "نصب‌ها", noun: "نصب", icon: HardDriveDownload, section: SW, area: "work", access: SOFTWARE, search: false, keywords: "نصب نرم‌افزار دستگاه" },
    { table: "license_entitlement", path: "itam/entitlements", label: "مجوزها", noun: "مجوز", icon: KeyRound, section: SW, area: "work", access: SOFTWARE, keywords: "مجوز لایسنس کلید اشتراک" },
    { table: "license_allocation", path: "itam/allocations", label: "تخصیص مجوز", noun: "تخصیص", icon: UserCheck, section: SW, area: "work", access: SOFTWARE, search: false },
    { table: "license_reconcile_run", path: "itam/reconcile-runs", label: "اجراهای تطبیق", icon: Scale, section: SW, area: "work", access: SOFTWARE, search: false, newAction: false },
    { table: "license_position", path: "itam/positions", label: "وضعیت مجوزها", icon: ShieldAlert, hidden: true, search: false, newAction: false },
    { table: "saas_subscription", path: "itam/saas", label: "اشتراک‌های SaaS", noun: "اشتراک SaaS", icon: Cloud, section: SW, area: "work", access: SOFTWARE, keywords: "SaaS اشتراک ابری صندلی" },
    { table: "saas_account", path: "itam/saas-accounts", label: "حساب‌های SaaS", noun: "حساب SaaS", icon: UserRound, section: SW, area: "work", access: SOFTWARE, search: false },
    { table: "asset_model", path: "itam/models", label: "مدل‌های کالا", noun: "مدل کالا", icon: Package, section: DEF, area: "work", access: ASSETS, keywords: "مدل کالا کاتالوگ سازنده" },
    { table: "hardware_standard", path: "itam/standards", label: "استانداردهای سخت‌افزار", noun: "استاندارد سخت‌افزار", icon: BadgeCheck, section: DEF, area: "work", access: MANAGE, search: false },
    { table: "depreciation_rule", path: "itam/depreciation", label: "قاعده‌های استهلاک", noun: "قاعدهٔ استهلاک", icon: TrendingDown, section: DEF, area: "work", access: MANAGE, search: false },
    { table: "label_template", path: "itam/label-templates", label: "الگوهای برچسب", noun: "الگوی برچسب", icon: QrCode, section: DEF, area: "work", access: MANAGE, search: false },
    { table: "catalog_item_model", path: "itam/catalog-models", label: "اقلام کاتالوگ و مدل‌ها", noun: "پیوند قلم و مدل", icon: Link2, section: DEF, area: "work", access: MANAGE, search: false },
    { table: "itam_config", path: "itam/settings", label: "تنظیمات دارایی‌ها", icon: Settings2, section: DEF, area: "settings", search: false, newAction: false },
  ],
  nav: [
    { key: "itam:dashboard", label: "داشبورد دارایی‌ها", path: "itam", icon: Activity, area: "work", access: ASSETS, workspace: true, keywords: "داشبورد دارایی" },
    { key: "itam:stock", label: "موجودی انبارها", path: "itam/stock", icon: PackageSearch, area: "work", access: ASSETS, workspace: true, keywords: "موجودی انبار نقطهٔ سفارش کمبود" },
    { key: "itam:compliance", label: "انطباق مجوزها", path: "itam/compliance", icon: ShieldCheck, area: "work", access: SOFTWARE, workspace: true, keywords: "انطباق مجوز لایسنس کمبود ممیزی True-up" },
    { key: "itam:labels", label: "چاپ برچسب", path: "itam/labels", icon: QrCode, area: "work", access: ASSETS, section: STOCK, keywords: "برچسب QR بارکد چاپ" },
    { key: "itam:warranty", label: "ضمانت رو به پایان", path: "itam/warranty", icon: ShieldAlert, area: "work", access: ASSETS, keywords: "ضمانت گارانتی پایان" },
    { key: "itam:branches", label: "اموال شعبه‌ها", path: "itam/branches", icon: Building2, area: "work", access: ASSETS, workspace: true, section: BANK, keywords: "شعبه منطقه اموال انتقال حواله" },
    { key: "itam:fleet", label: "ناوگان خودپرداز", path: "itam/fleet", icon: Landmark, area: "work", access: ASSETS, workspace: true, section: BANK, keywords: "خودپرداز ATM CRS کیوسک دسترس‌پذیری نگهداری" },
    { key: "itam:register", label: "دفتر اموال", path: "itam/register", icon: BookText, area: "work", access: REGION_ASSETS, section: BANK, keywords: "دفتر اموال استهلاک سال مالی دارایی ثابت" },
  ],
  routes: [
    { path: "itam", element: lazyPage(<Dashboard />) },
    { path: "itam/my-assets", element: lazyPage(<MyAssets />) },
    { path: "itam/stock", element: lazyPage(<StockPage />) },
    { path: "itam/compliance", element: lazyPage(<Compliance />) },
    { path: "itam/labels", element: lazyPage(<Labels />) },
    { path: "itam/branches", element: lazyPage(<Branches />) },
    { path: "itam/fleet", element: lazyPage(<Fleet />) },
    { path: "itam/register", element: lazyPage(<Register />) },
    { path: "itam/audits/:id/scan", element: lazyPage(<MobileScan />) },
    { path: "itam/warranty", element: <RecordListRoute table="asset" title="ضمانت رو به پایان (۹۰ روز)" preset={{ filter: WARRANTY, columns: ASSET_COLUMNS, sort: "warranty_end", emptyText: "ضمانت هیچ دارایی‌ای در ۹۰ روز آینده پایان نمی‌یابد" }} /> },
  ],
  segments: { assets: "assets", itam: "assets" },
});

// requested items: hand over a reserved or available asset; member profiles: a leaver's return
registerRecordExtensions("request_item", { sidePanels: [{ key: "itam:assets", title: "دارایی‌ها", order: 30, render: widget(RequestAssetsPanel) }] });
registerRecordExtensions("member_profile", { headerActions: action("itam-leaver", LeaverAction) });

const mine: NavGroup = {
  key: "itam:mine",
  label: "دارایی‌ها",
  space: "home",
  items: [{ key: "itam:my-assets", label: "دارایی‌های من", path: "itam/my-assets", icon: MonitorSmartphone, keywords: "دارایی من لپ‌تاپ تحویل تعهدنامه" }],
};

export const itamUi: ModuleUi = { ...module, nav: [...module.nav, mine] };
