// Goods module: menu groups «خرید و فروش» and «انبار و کالا» and their routes.
import { lazy } from "react";
import { useNavigate } from "react-router";
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

const inv = (kind: InvoiceKind, keywords: string) => ({ key: `inv-${kind}`, label: INVOICE_META[kind].title, path: INVOICE_META[kind].path, area: INVOICE_META[kind].area, keywords });

export const commerceNav: Omit<NavGroup, "icon"> = {
  key: "commerce",
  label: "خرید و فروش",
  module: "goods",
  items: [
    inv("sale", "فروش صورتحساب فاکتور"),
    { key: "inv-sale-new", label: "فاکتور فروش جدید", path: "sales/invoices/new", area: "sales", level: "edit", keywords: "صدور فاکتور فروش" },
    inv("sale_return", "مرجوعی برگشتی"),
    inv("quote", "پیش فاکتور استعلام قیمت"),
    inv("sale_order", "سفارش مشتری"),
    inv("purchase", "خرید"),
    inv("purchase_return", "مرجوعی خرید"),
    inv("purchase_order", "سفارش به تأمین‌کننده"),
    { key: "sales-reports", label: "گزارش فروش و سود", path: "sales/reports", area: "reports", keywords: "سود ناخالص تحلیل فروش خرید" },
    { key: "price-lists", label: "فهرست‌های قیمت", path: "sales/price-lists", area: "sales" },
  ],
};

export const inventoryNav: Omit<NavGroup, "icon"> = {
  key: "inventory",
  label: "انبار و کالا",
  module: "goods",
  items: [
    { key: "stock-docs", label: "اسناد انبار", path: "inventory/docs", area: "inventory", keywords: "رسید حواله انتقال تعدیل" },
    { key: "stock", label: "موجودی کالا", path: "inventory/stock", area: "inventory", keywords: "گزارش موجودی کم‌موجود" },
    { key: "kardex", label: "کاردکس", path: "inventory/kardex", area: "inventory", keywords: "گردش کالا" },
    { key: "stock-count", label: "انبارگردانی", path: "inventory/count", area: "inventory", keywords: "شمارش موجودی" },
    { key: "items", label: "کالاها و خدمات", path: "inventory/items", area: "inventory" },
    { key: "item-categories", label: "گروه‌های کالا", path: "inventory/categories", area: "inventory" },
    { key: "units", label: "واحدهای اندازه‌گیری", path: "inventory/units", area: "inventory" },
    { key: "warehouses", label: "انبارها", path: "inventory/warehouses", area: "inventory" },
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
