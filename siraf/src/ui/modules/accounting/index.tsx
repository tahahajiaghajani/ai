import { lazy } from "react";
import type { NavGroup, AppRoute } from "../registry";
import { EntityPage } from "../../components/data";

const Vouchers = lazy(() => import("./Vouchers"));
const VoucherEditor = lazy(() => import("./VoucherEditor"));
const Accounts = lazy(() => import("./Accounts"));
const FiscalYears = lazy(() => import("./FiscalYears"));

export const accountingNav: Omit<NavGroup, "icon"> = {
  key: "accounting",
  label: "حسابداری",
  items: [
    { key: "vouchers", label: "اسناد حسابداری", path: "accounting/vouchers", area: "accounting", keywords: "سند دفتر روزنامه" },
    { key: "voucher-new", label: "سند جدید", path: "accounting/vouchers/new", area: "accounting", level: "edit", keywords: "ثبت سند" },
    { key: "accounts", label: "کدینگ حساب‌ها", path: "accounting/accounts", area: "accounting", keywords: "سرفصل کل معین" },
    { key: "details", label: "حساب‌های تفصیلی", path: "accounting/details", area: "accounting", keywords: "مرکز هزینه پروژه" },
    { key: "fiscal", label: "سال مالی و بستن حساب‌ها", path: "accounting/fiscal-years", area: "accounting", keywords: "افتتاحیه اختتامیه" },
  ],
};

export const accountingRoutes: AppRoute[] = [
  { path: "accounting/vouchers", element: <Vouchers /> },
  { path: "accounting/vouchers/new", element: <VoucherEditor /> },
  { path: "accounting/vouchers/:id", element: <VoucherEditor /> },
  { path: "accounting/accounts", element: <Accounts /> },
  { path: "accounting/details", element: <EntityPage entity="detail" defaultFilters={{}} /> },
  { path: "accounting/fiscal-years", element: <FiscalYears /> },
];
