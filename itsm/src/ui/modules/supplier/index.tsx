// Supplier and contract management's screens (docs/modules/supplier_FA.md). The module joins the «پیکربندی» space
// (key "assets") with the group «تأمین‌کنندگان و قراردادها»: suppliers (with the «نمای ۳۶۰» tab), contacts, contracts
// (calendar mode by end date; header actions «تمدید» and «استخراج بندها»), lines, coverage, obligations, reviews and
// scorecards, the «تقویم تمدید» page and the settings.
import { lazy } from "react";
import { Building2, CalendarRange, Contact, FileSignature, List, ShieldCheck, ListChecks, Gauge, MessagesSquare, Settings2 } from "lucide-react";
import type { AccessGate } from "@shared/access";
import type { ModuleUi } from "../registry";
import { recordModule } from "../../records/module";
import { action, lazyPage, widget } from "../itam/parts";

const Renewals = lazy(() => import("./Renewals"));
const ContractActions = lazy(() => import("./Parts").then((m) => ({ default: m.ContractActions })));
const Supplier360Tab = lazy(() => import("./Parts").then((m) => ({ default: m.Supplier360Tab })));

const VENDOR: AccessGate = { area: "vendor" };
const CONTRACT: AccessGate = { area: "contract" };
const SUP = "تأمین‌کنندگان";
const DEF = "تعریف‌ها";

const module = recordModule({
  key: "supplier",
  spaceKey: "assets",
  group: { key: "supplier", label: "تأمین‌کنندگان و قراردادها" },
  tables: [
    {
      table: "contract", path: "contracts", label: "قراردادها", noun: "قرارداد", icon: FileSignature, area: "work", access: CONTRACT, workspace: true,
      keywords: "قرارداد پشتیبانی ضمانت اجاره مجوز تمدید UC", search: { group: "قراردادها" },
      list: { preset: { columns: ["number", "name", "supplier_id", "contract_type", "state", "end_date", "notice_date", "owner_id"], emptyText: "هنوز قراردادی ثبت نشده است", rowTone: (r) => (r.state === "active" && r.notice_date && String(r.notice_date) < new Date().toISOString().slice(0, 10) ? "warning" : null) } },
      extensions: { headerActions: action("supplier-contract", ContractActions), cardFields: ["supplier_id", "end_date", "owner_id"] },
    },
    {
      table: "supplier", path: "supplier/suppliers", label: "تأمین‌کنندگان", noun: "تأمین‌کننده", icon: Building2, section: SUP, area: "work", access: VENDOR,
      keywords: "تأمین‌کننده فروشنده سازنده ناشر پیمانکار", search: { group: "تأمین‌کنندگان" },
      extensions: { tabs: [{ key: "supplier:360", label: "نمای ۳۶۰", order: 0, render: widget(Supplier360Tab) }] },
    },
    { table: "supplier_contact", path: "supplier/contacts", label: "مخاطبان", noun: "مخاطب", icon: Contact, section: SUP, area: "work", access: VENDOR, keywords: "مخاطب تشدید پشتیبانی" },
    { table: "supplier_review", path: "supplier/reviews", label: "بازبینی‌ها", noun: "بازبینی", icon: MessagesSquare, section: SUP, area: "work", access: VENDOR, search: false, keywords: "بازبینی QBR جلسه" },
    { table: "supplier_scorecard", path: "supplier/scorecards", label: "کارنامه‌ها", icon: Gauge, section: SUP, area: "work", access: VENDOR, search: false, newAction: false },
    { table: "contract_obligation", path: "supplier/obligations", label: "تعهدهای قراردادی", noun: "تعهد", icon: ListChecks, area: "work", access: CONTRACT, keywords: "تعهد موعد گزارش بیمه‌نامه" },
    { table: "contract_coverage", path: "supplier/coverage", label: "پوشش قراردادها", noun: "پوشش", icon: ShieldCheck, area: "work", access: CONTRACT, search: false },
    { table: "contract_line", path: "supplier/contract-lines", label: "سطرهای قرارداد", icon: List, hidden: true, search: false, newAction: false },
    { table: "supplier_config", path: "supplier/settings", label: "تنظیمات قراردادها", icon: Settings2, section: DEF, area: "settings", search: false, newAction: false },
  ],
  nav: [{ key: "supplier:renewals", label: "تقویم تمدید", path: "supplier/renewals", icon: CalendarRange, area: "work", access: CONTRACT, workspace: true, keywords: "تمدید مهلت اعلام پایان قرارداد تقویم" }],
  routes: [{ path: "supplier/renewals", element: lazyPage(<Renewals />) }],
  segments: { supplier: "assets", contracts: "assets" },
});

export const supplierUi: ModuleUi = module;
