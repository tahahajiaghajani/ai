import { lazy } from "react";
import type { NavGroup, AppRoute } from "../registry";
import { EntityPage } from "../../components/data";

const RatesBoard = lazy(() => import("./RatesBoard"));
const Counter = lazy(() => import("./Counter"));
const Deals = lazy(() => import("./Deals"));
const DealView = lazy(() => import("./DealView"));
const Remittances = lazy(() => import("./Remittances"));
const RemittanceNew = lazy(() => import("./RemittanceForm"));
const RemittanceView = lazy(() => import("./RemittanceView"));
const Wallets = lazy(() => import("./Wallets"));
const Positions = lazy(() => import("./Positions"));
const CashReport = lazy(() => import("./CashReport"));
const Revaluation = lazy(() => import("./Revaluation"));

export const fxNav: Omit<NavGroup, "icon"> = {
  key: "fx",
  label: "صرافی و ارز دیجیتال",
  module: "fx",
  items: [
    { key: "fx-rates", label: "تابلوی نرخ", path: "fx/rates", area: "fx", keywords: "نرخ ارز قیمت دلار بازار" },
    { key: "fx-new", label: "معامله‌ی جدید", path: "fx/deals/new", area: "fx", level: "edit", keywords: "خرید فروش تبدیل ارز باجه صندوق" },
    { key: "fx-deals", label: "معاملات", path: "fx/deals", area: "fx", keywords: "معاملات ارز رسید" },
    { key: "fx-remittances", label: "حواله‌ها", path: "fx/remittances", area: "fx", keywords: "حواله صادره وارده همکار رهگیری" },
    { key: "wallets", label: "کیف‌پول‌ها", path: "fx/wallets", area: "fx", keywords: "کیف پول رمزارز موجودی بلاک‌چین" },
    { key: "fx-positions", label: "موقعیت ارزی و سود", path: "fx/positions", area: "fx", keywords: "سود زیان میانگین بها موجودی ارز" },
    { key: "fx-cash", label: "گزارش صندوق روزانه", path: "fx/cash-report", area: "fx", keywords: "صندوق روزانه شمارش پایان روز" },
    { key: "fx-reval", label: "تسعیر ارز", path: "fx/revaluation", area: "fx", keywords: "تسعیر سود زیان ارزی" },
    { key: "currencies", label: "ارزها و رمزارزها", path: "fx/currencies", area: "fx" },
  ],
};

export const fxRoutes: AppRoute[] = [
  { path: "fx/rates", element: <RatesBoard /> },
  { path: "fx/deals", element: <Deals /> },
  { path: "fx/deals/new", element: <Counter /> },
  { path: "fx/deals/:id", element: <DealView /> },
  { path: "fx/deals/:id/edit", element: <Counter /> },
  { path: "fx/remittances", element: <Remittances /> },
  { path: "fx/remittances/new", element: <RemittanceNew /> },
  { path: "fx/remittances/:id", element: <RemittanceView /> },
  { path: "fx/wallets", element: <Wallets /> },
  { path: "fx/positions", element: <Positions /> },
  { path: "fx/cash-report", element: <CashReport /> },
  { path: "fx/revaluation", element: <Revaluation /> },
  { path: "fx/revaluation/:id", element: <Revaluation /> },
  { path: "fx/currencies", element: <EntityPage entity="currency" /> },
];
