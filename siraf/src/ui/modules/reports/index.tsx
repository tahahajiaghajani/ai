import { lazy } from "react";
import { Scale, BookOpenText, Contact, NotebookText, TrendingUp, ChartPie, ChartSpline } from "lucide-react";
import type { NavGroup, AppRoute } from "../registry";

const TrialBalance = lazy(() => import("./TrialBalance"));
const Ledger = lazy(() => import("./Ledger"));
const Journal = lazy(() => import("./Journal"));
const DetailBalances = lazy(() => import("./DetailBalances"));
const IncomeStatement = lazy(() => import("./IncomeStatement"));
const BalanceSheet = lazy(() => import("./BalanceSheet"));
const Forecast = lazy(() => import("../../ai/forecast/Forecast"));

export const reportsNav: Omit<NavGroup, "icon" | "space"> = {
  key: "reports",
  label: "گزارش‌ها",
  items: [
    { key: "trial", label: "تراز آزمایشی", path: "reports/trial-balance", area: "reports", icon: Scale, section: "گزارش‌ها" },
    { key: "ledger", label: "دفتر حساب", path: "reports/ledger", area: "reports", icon: BookOpenText, section: "گزارش‌ها", keywords: "دفتر کل معین تفصیلی گردش حساب" },
    { key: "detail-balances", label: "ماندهٔ اشخاص", path: "reports/detail-balances", area: "reports", icon: Contact, section: "گزارش‌ها", keywords: "مانده‌ی اشخاص و تفصیلی‌ها بدهکاران بستانکاران" },
    { key: "journal", label: "دفتر روزنامه", path: "reports/journal", area: "reports", icon: NotebookText, section: "گزارش‌ها" },
    { key: "income", label: "سود و زیان", path: "reports/income-statement", area: "reports", icon: TrendingUp, section: "گزارش‌ها", keywords: "صورت سود و زیان" },
    { key: "balance", label: "ترازنامه", path: "reports/balance-sheet", area: "reports", icon: ChartPie, section: "گزارش‌ها", keywords: "صورت وضعیت مالی" },
    { key: "forecast", label: "پیش‌بینی و برنامه‌ریزی", path: "reports/forecast", area: "reports", icon: ChartSpline, section: "گزارش‌ها", keywords: "جریان نقدی پیش بینی فروش تقاضا سفارش دوباره کالای راکد نرخ برنامه ماه هوش مصنوعی" },
  ],
};

export const reportsRoutes: AppRoute[] = [
  { path: "reports/trial-balance", element: <TrialBalance /> },
  { path: "reports/ledger", element: <Ledger /> },
  { path: "reports/journal", element: <Journal /> },
  { path: "reports/detail-balances", element: <DetailBalances /> },
  { path: "reports/income-statement", element: <IncomeStatement /> },
  { path: "reports/balance-sheet", element: <BalanceSheet /> },
  { path: "reports/forecast", element: <Forecast /> },
];
