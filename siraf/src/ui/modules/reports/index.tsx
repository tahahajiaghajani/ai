import { lazy } from "react";
import type { NavGroup, AppRoute } from "../registry";

const TrialBalance = lazy(() => import("./TrialBalance"));
const Ledger = lazy(() => import("./Ledger"));
const Journal = lazy(() => import("./Journal"));
const DetailBalances = lazy(() => import("./DetailBalances"));
const IncomeStatement = lazy(() => import("./IncomeStatement"));
const BalanceSheet = lazy(() => import("./BalanceSheet"));

export const reportsNav: Omit<NavGroup, "icon"> = {
  key: "reports",
  label: "گزارش‌ها",
  items: [
    { key: "trial", label: "تراز آزمایشی", path: "reports/trial-balance", area: "reports" },
    { key: "ledger", label: "دفتر حساب (کل/معین/تفصیلی)", path: "reports/ledger", area: "reports", keywords: "گردش حساب" },
    { key: "detail-balances", label: "مانده‌ی اشخاص و تفصیلی‌ها", path: "reports/detail-balances", area: "reports", keywords: "بدهکاران بستانکاران" },
    { key: "journal", label: "دفتر روزنامه", path: "reports/journal", area: "reports" },
    { key: "income", label: "صورت سود و زیان", path: "reports/income-statement", area: "reports" },
    { key: "balance", label: "ترازنامه", path: "reports/balance-sheet", area: "reports", keywords: "صورت وضعیت مالی" },
  ],
};

export const reportsRoutes: AppRoute[] = [
  { path: "reports/trial-balance", element: <TrialBalance /> },
  { path: "reports/ledger", element: <Ledger /> },
  { path: "reports/journal", element: <Journal /> },
  { path: "reports/detail-balances", element: <DetailBalances /> },
  { path: "reports/income-statement", element: <IncomeStatement /> },
  { path: "reports/balance-sheet", element: <BalanceSheet /> },
];
