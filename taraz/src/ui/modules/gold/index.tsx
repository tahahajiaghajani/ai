import type { NavGroup, AppRoute } from "../registry";
import { EntityPage } from "../../components/data";

export const goldNav: Omit<NavGroup, "icon"> = {
  key: "gold",
  label: "طلا و جواهر",
  module: "gold",
  items: [
    { key: "gold-items", label: "اجناس (اتیکت‌ها)", path: "gold/items", area: "gold" },
    { key: "gold-categories", label: "دسته‌های طلا", path: "gold/categories", area: "gold" },
  ],
};

export const goldRoutes: AppRoute[] = [
  { path: "gold/items", element: <EntityPage entity="gold_item" drawerWidth={820} /> },
  { path: "gold/categories", element: <EntityPage entity="gold_category" /> },
];
