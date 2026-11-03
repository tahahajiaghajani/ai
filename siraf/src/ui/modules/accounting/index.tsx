import { lazy } from "react";
import { FileText, FilePlus2, ListTree, Layers, CalendarRange } from "lucide-react";
import type { NavGroup, AppRoute } from "../registry";
import { EntityPage } from "../../components/data";

const Vouchers = lazy(() => import("./Vouchers"));
const VoucherEditor = lazy(() => import("./VoucherEditor"));
const Accounts = lazy(() => import("./Accounts"));
const FiscalYears = lazy(() => import("./FiscalYears"));

export const accountingNav: Omit<NavGroup, "icon" | "space"> = {
  key: "accounting",
  label: "حسابداری",
  items: [
    { key: "vouchers", label: "اسناد حسابداری", path: "accounting/vouchers", area: "accounting", icon: FileText, count: "draft-vouchers", keywords: "سند دفتر روزنامه پیش‌نویس" },
    { key: "voucher-new", label: "سند جدید", path: "accounting/vouchers/new", area: "accounting", level: "edit", icon: FilePlus2, action: true, keywords: "ثبت سند" },
    { key: "accounts", label: "کدینگ حساب‌ها", path: "accounting/accounts", area: "accounting", icon: ListTree, section: "تعریف‌ها", keywords: "سرفصل کل معین" },
    { key: "details", label: "حساب‌های تفصیلی", path: "accounting/details", area: "accounting", icon: Layers, section: "تعریف‌ها", keywords: "مرکز هزینه پروژه" },
    { key: "fiscal", label: "سال مالی", path: "accounting/fiscal-years", area: "accounting", icon: CalendarRange, section: "تعریف‌ها", keywords: "سال مالی و بستن حساب‌ها افتتاحیه اختتامیه" },
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
