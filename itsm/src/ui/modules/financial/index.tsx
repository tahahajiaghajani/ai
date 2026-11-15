// IT financial management's screens (docs/modules/financial_FA.md). The module adds the sidebar space «مالی» (for
// members whose roles read the financial area) with the group «مالی فناوری اطلاعات»: «بودجه و هزینهٔ واقعی», «هزینه‌های
// فناوری اطلاعات», the cost ledger (entries with «برگشت ثبت»), budgets and their lines, the cost model (allocation
// rules and targets, runs with «محاسبه»، «ثبت در دفتر» and the «صورت‌حساب» tab), fiscal years and periods, cost types,
// exchange rates and the settings. Services get the «هزینهٔ خدمت» side panel.
import { lazy } from "@ui/lib/lazy";
import { Wallet, ChartColumn, Receipt, ListTree, Split, Target, Calculator, PieChart, CalendarRange, CalendarDays, Tags, ArrowLeftRight, Settings2, List } from "lucide-react";
import type { AccessGate } from "@shared/access";
import type { ModuleUi } from "../registry";
import { recordModule } from "../../records/module";
import { registerRecordExtensions } from "../../records/extensions";
import { action, lazyPage, widget } from "../itam/parts";

const BudgetVsActual = lazy(() => import("./BudgetVsActual"));
const Spend = lazy(() => import("./Spend"));
const RunActions = lazy(() => import("./Parts").then((m) => ({ default: m.RunActions })));
const StatementTab = lazy(() => import("./Parts").then((m) => ({ default: m.StatementTab })));
const EntryActions = lazy(() => import("./Parts").then((m) => ({ default: m.EntryActions })));
const ServiceCostPanel = lazy(() => import("./Parts").then((m) => ({ default: m.ServiceCostPanel })));

const FIN: AccessGate = { area: "financial" };
const FIN_ADMIN: AccessGate = { area: "financial", op: "create" };
export const FINANCE_SPACE = { key: "finance", label: "مالی", title: "مالی فناوری اطلاعات", icon: Wallet, access: FIN };
const MODEL = "مدل هزینه";
const DEF = "تعریف‌ها";

const module = recordModule({
  key: "financial",
  space: FINANCE_SPACE,
  group: { key: "financial", label: "مالی فناوری اطلاعات" },
  tables: [
    { table: "cost_entry", path: "financial/entries", label: "دفتر هزینه", noun: "ثبت هزینه", icon: Receipt, area: "work", access: FIN, workspace: true, keywords: "هزینه دفتر ثبت سرمایه‌ای جاری", extensions: { headerActions: action("financial-entry", EntryActions) } },
    { table: "budget", path: "financial/budgets", label: "بودجه‌ها", noun: "بودجه", icon: Wallet, area: "work", access: FIN, keywords: "بودجه مرکز هزینه سال مالی" },
    { table: "budget_line", path: "financial/budget-lines", label: "سطرهای بودجه", icon: List, hidden: true, search: false, newAction: false },
    { table: "allocation_rule", path: "financial/allocation-rules", label: "قاعده‌های تسهیم", noun: "قاعدهٔ تسهیم", icon: Split, section: MODEL, area: "work", access: FIN, search: false, keywords: "تسهیم هزینه خدمت محرک" },
    { table: "allocation_target", path: "financial/allocation-targets", label: "مقصدهای تسهیم", icon: Target, hidden: true, search: false, newAction: false },
    { table: "allocation_run", path: "financial/allocation-runs", label: "اجراهای تسهیم", noun: "اجرای تسهیم", icon: Calculator, section: MODEL, area: "work", access: FIN, keywords: "تسهیم نمایش هزینه بازپرداخت Showback Chargeback", extensions: { headerActions: action("financial-run", RunActions), tabs: [{ key: "financial:statement", label: "صورت‌حساب", order: 0, render: widget(StatementTab) }] } },
    { table: "allocation_result", path: "financial/allocation-results", label: "نتیجه‌های تسهیم", icon: PieChart, hidden: true, search: false, newAction: false },
    { table: "fiscal_year", path: "financial/years", label: "سال‌های مالی", noun: "سال مالی", icon: CalendarRange, section: DEF, area: "work", access: FIN_ADMIN, search: false },
    { table: "fiscal_period", path: "financial/periods", label: "دوره‌های مالی", icon: CalendarDays, section: DEF, area: "work", access: FIN_ADMIN, search: false, newAction: false },
    { table: "cost_type", path: "financial/cost-types", label: "انواع هزینه", noun: "نوع هزینه", icon: Tags, section: DEF, area: "work", access: FIN_ADMIN, search: false },
    { table: "exchange_rate", path: "financial/rates", label: "نرخ‌های ارز", noun: "نرخ ارز", icon: ArrowLeftRight, section: DEF, area: "work", access: FIN, search: false },
    { table: "financial_config", path: "financial/settings", label: "تنظیمات مالی", icon: Settings2, section: DEF, area: "settings", search: false, newAction: false },
  ],
  nav: [
    { key: "financial:bva", label: "بودجه و هزینهٔ واقعی", path: "financial", icon: ChartColumn, area: "work", access: FIN, workspace: true, keywords: "بودجه هزینه واقعی انحراف" },
    { key: "financial:spend", label: "هزینه‌های فناوری اطلاعات", path: "financial/spend", icon: ListTree, area: "work", access: FIN, keywords: "هزینه سرمایه‌ای جاری تأمین‌کننده خدمت" },
  ],
  routes: [
    { path: "financial", element: lazyPage(<BudgetVsActual />) },
    { path: "financial/spend", element: lazyPage(<Spend />) },
  ],
  segments: { financial: "finance" },
});

// a service's cost of the year (direct and allocated; the panel says when the financial field group is missing)
registerRecordExtensions("service", { sidePanels: [{ key: "financial:cost", title: "هزینهٔ خدمت", order: 60, render: widget(ServiceCostPanel) }] });

export const financialUi: ModuleUi = module;
