// Goods module: menu groups «خرید و فروش» and «انبار و کالا» and their routes.
import { lazy } from "react";
import { useNavigate } from "react-router";
import { Receipt, FilePlus2, Undo2, Redo2, ClipboardList, ClipboardCheck, ShoppingCart, Truck, ChartColumn, Tags, FileStack, Boxes, History, ListChecks, Package, FolderTree, Ruler, Warehouse, type LucideIcon } from "lucide-react";
import type { NavGroup, AppRoute } from "../registry";
import { EntityPage } from "../../components/data";
import { useOrg } from "../../lib/org";
import { INVOICE_KINDS, INVOICE_META, type InvoiceKind } from "./labels";

const InvoiceList = lazy(() => import("./InvoiceList"));
const InvoiceEditor = lazy(() => import("./InvoiceEditor"));
const StockDocs = lazy(() => import("./StockDocs"));
const StockDocEditor = lazy(() => import("./StockDocEditor"));
const StockReport = lazy(() => import("./StockReport"));
const Kardex = lazy(() => import("./Kardex"));
const SalesReports = lazy(() => import("./SalesReports"));
const PriceListItems = lazy(() => import("./PriceListItems"));

function PriceListsPage() {
  const nav = useNavigate();
  const { orgId } = useOrg();
  return (
    <EntityPage
      entity="price_list"
      onOpen={(r) => nav(`/${orgId}/sales/price-lists/${r.id}`)}
      rowActions={(r) => [{ key: "items", label: "قیمت کالاها", onClick: () => nav(`/${orgId}/sales/price-lists/${r.id}`) }]}
    />
  );
}

const inv = (kind: InvoiceKind, icon: LucideIcon, section: string, keywords: string) => ({ key: `inv-${kind}`, label: INVOICE_META[kind].plural, path: INVOICE_META[kind].path, area: INVOICE_META[kind].area, icon, section, keywords });

export const commerceNav: Omit<NavGroup, "icon" | "space"> = {
  key: "commerce",
  label: "خرید و فروش",
  module: "goods",
  items: [
    inv("sale", Receipt, "فروش", "فروش صورتحساب فاکتور"),
    { key: "inv-sale-new", label: "فاکتور فروش جدید", path: "sales/invoices/new", area: "sales", level: "edit", icon: FilePlus2, section: "فروش", action: true, keywords: "صدور فاکتور فروش" },
    inv("sale_return", Undo2, "فروش", "مرجوعی برگشتی"),
    inv("quote", ClipboardList, "فروش", "پیش فاکتور استعلام قیمت"),
    inv("sale_order", ClipboardCheck, "فروش", "سفارش مشتری"),
    inv("purchase", ShoppingCart, "خرید", "خرید"),
    inv("purchase_return", Redo2, "خرید", "مرجوعی خرید"),
    inv("purchase_order", Truck, "خرید", "سفارش به تأمین‌کننده"),
    { key: "sales-reports", label: "گزارش فروش و سود", path: "sales/reports", area: "reports", icon: ChartColumn, section: "گزارش‌ها", keywords: "سود ناخالص تحلیل فروش خرید" },
    { key: "price-lists", label: "فهرست‌های قیمت", path: "sales/price-lists", area: "sales", icon: Tags, section: "تعریف‌ها" },
  ],
};

export const inventoryNav: Omit<NavGroup, "icon" | "space"> = {
  key: "inventory",
  label: "انبار و کالا",
  module: "goods",
  items: [
    { key: "stock-docs", label: "اسناد انبار", path: "inventory/docs", area: "inventory", icon: FileStack, section: "انبار", keywords: "رسید حواله انتقال تعدیل" },
    { key: "stock", label: "موجودی کالا", path: "inventory/stock", area: "inventory", icon: Boxes, section: "انبار", keywords: "گزارش موجودی کم‌موجود" },
    { key: "kardex", label: "کاردکس", path: "inventory/kardex", area: "inventory", icon: History, section: "انبار", keywords: "گردش کالا" },
    { key: "stock-count", label: "انبارگردانی", path: "inventory/count", area: "inventory", icon: ListChecks, section: "انبار", keywords: "شمارش موجودی" },
    { key: "items", label: "کالاها و خدمات", path: "inventory/items", area: "inventory", icon: Package, section: "تعریف‌ها" },
    { key: "item-categories", label: "گروه‌های کالا", path: "inventory/categories", area: "inventory", icon: FolderTree, section: "تعریف‌ها" },
    { key: "units", label: "واحدهای اندازه‌گیری", path: "inventory/units", area: "inventory", icon: Ruler, section: "تعریف‌ها" },
    { key: "warehouses", label: "انبارها", path: "inventory/warehouses", area: "inventory", icon: Warehouse, section: "تعریف‌ها" },
  ],
};

export const goodsRoutes: AppRoute[] = [
  { path: "sales/price-lists", element: <PriceListsPage /> },
  { path: "sales/price-lists/:id", element: <PriceListItems /> },
  { path: "inventory/items", element: <EntityPage entity="item" drawerWidth={860} /> },
  { path: "inventory/categories", element: <EntityPage entity="item_category" /> },
  { path: "inventory/units", element: <EntityPage entity="unit" /> },
  { path: "inventory/warehouses", element: <EntityPage entity="warehouse" /> },
  // commercial documents: list, new (?kind= ?ref= ?copy=) and editor for every kind
  ...INVOICE_KINDS.flatMap((k) => [
    { path: INVOICE_META[k].path, element: <InvoiceList kind={k} /> },
    { path: `${INVOICE_META[k].path}/new`, element: <InvoiceEditor /> },
    { path: `${INVOICE_META[k].path}/:id`, element: <InvoiceEditor /> },
  ]),
  { path: "sales/reports", element: <SalesReports /> },
  { path: "inventory/docs", element: <StockDocs /> },
  { path: "inventory/docs/new", element: <StockDocEditor /> },
  { path: "inventory/docs/:id", element: <StockDocEditor /> },
  { path: "inventory/count", element: <StockDocs countOnly /> },
  { path: "inventory/count/new", element: <StockDocEditor /> },
  { path: "inventory/count/:id", element: <StockDocEditor /> },
  { path: "inventory/stock", element: <StockReport /> },
  { path: "inventory/kardex", element: <Kardex /> },
];
