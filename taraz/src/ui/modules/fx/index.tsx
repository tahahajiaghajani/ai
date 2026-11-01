import type { NavGroup, AppRoute } from "../registry";
import { EntityPage } from "../../components/data";

export const fxNav: Omit<NavGroup, "icon"> = {
  key: "fx",
  label: "صرافی و ارز دیجیتال",
  module: "fx",
  items: [
    { key: "currencies", label: "ارزها و رمزارزها", path: "fx/currencies", area: "fx" },
    { key: "wallets", label: "کیف‌پول‌ها", path: "fx/wallets", area: "fx" },
  ],
};

export const fxRoutes: AppRoute[] = [
  { path: "fx/currencies", element: <EntityPage entity="currency" /> },
  { path: "fx/wallets", element: <EntityPage entity="wallet" /> },
];
