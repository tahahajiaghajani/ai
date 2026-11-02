import { lazy } from "react";
import { Activity, ShoppingBag, Handshake, Recycle, PackageOpen, Flame, Files, Tag, FolderTree, Weight, ChartColumn } from "lucide-react";
import type { NavGroup, AppRoute } from "../registry";
import { EntityPage } from "../../components/data";
import { KIND_PATH, type DocKind } from "./shared";

const RateBoard = lazy(() => import("./RateBoard"));
const SaleScreen = lazy(() => import("./SaleScreen"));
const DocEditor = lazy(() => import("./DocEditor").then((m) => ({ default: m.DocEditorRoute })));
const DocView = lazy(() => import("./DocView"));
const Docs = lazy(() => import("./Docs"));
const Items = lazy(() => import("./Items"));
const Consignment = lazy(() => import("./Consignment"));
const Workshop = lazy(() => import("./Workshop"));
const StockReport = lazy(() => import("./StockReport"));
const SalesReport = lazy(() => import("./SalesReport"));

export const goldNav: Omit<NavGroup, "icon" | "space"> = {
  key: "gold",
  label: "طلا و جواهر",
  module: "gold",
  items: [
    { key: "gold-rates", label: "تابلوی قیمت", path: "gold/rates", area: "gold", icon: Activity, keywords: "مظنه گرم ۱۸ سکه قیمت روز" },
    { key: "gold-sale", label: "فروش (صندوق)", path: "gold/sale", area: "gold", level: "edit", icon: ShoppingBag, action: true, keywords: "فاکتور فروش طلا اتیکت" },
    { key: "gold-purchase", label: "خرید از همکار", path: "gold/purchase", area: "gold", level: "edit", icon: Handshake, keywords: "بنکدار طلا به طلا" },
    { key: "gold-buyback", label: "خرید طلای مستعمل", path: "gold/buyback", area: "gold", level: "edit", icon: Recycle, keywords: "کهنه شکسته" },
    { key: "gold-docs", label: "اسناد طلا", path: "gold/docs", area: "gold", icon: Files },
    { key: "gold-items", label: "اجناس (اتیکت‌ها)", path: "gold/items", area: "gold", icon: Tag, keywords: "چاپ اتیکت بارکد" },
    { key: "gold-consignment", label: "امانی", path: "gold/consignment", area: "gold", icon: PackageOpen },
    { key: "gold-workshop", label: "کارگاه و ذوب", path: "gold/workshop", area: "gold", icon: Flame, keywords: "آبشده ری‌گیری انگ ذوب" },
    { key: "gold-stock", label: "موجودی و حساب وزنی", path: "gold/reports/stock", area: "gold", icon: Weight, section: "گزارش‌ها", keywords: "گزارش موجودی و وزنی تراز وزنی" },
    { key: "gold-sales", label: "گزارش فروش طلا", path: "gold/reports/sales", area: "gold", icon: ChartColumn, section: "گزارش‌ها" },
    { key: "gold-categories", label: "دسته‌های طلا", path: "gold/categories", area: "gold", icon: FolderTree, section: "تعریف‌ها" },
  ],
};

// document editors: «<path>» and «<path>/new» start a document, «<path>/:id» edits one
const EDITORS = (Object.entries(KIND_PATH) as [DocKind, string][]).filter((e): e is [Exclude<DocKind, "sale">, string] => e[0] !== "sale");

export const goldRoutes: AppRoute[] = [
  { path: "gold/items", element: <Items /> },
  { path: "gold/categories", element: <EntityPage entity="gold_category" /> },
  { path: "gold/rates", element: <RateBoard /> },
  { path: "gold/sale", element: <SaleScreen /> },
  { path: "gold/sale/new", element: <SaleScreen /> },
  { path: "gold/sale/:id", element: <SaleScreen /> },
  ...EDITORS.flatMap(([kind, path]) => [
    { path, element: <DocEditor kind={kind} /> },
    { path: `${path}/new`, element: <DocEditor kind={kind} /> },
    { path: `${path}/:id`, element: <DocEditor kind={kind} /> },
  ]),
  { path: "gold/docs", element: <Docs /> },
  { path: "gold/docs/:id", element: <DocView /> },
  { path: "gold/consignment", element: <Consignment /> },
  { path: "gold/workshop", element: <Workshop /> },
  { path: "gold/reports/stock", element: <StockReport /> },
  { path: "gold/reports/sales", element: <SalesReport /> },
];
