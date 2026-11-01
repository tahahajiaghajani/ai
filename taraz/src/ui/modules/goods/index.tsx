import type { NavGroup, AppRoute } from "../registry";
import { EntityPage } from "../../components/data";

export const commerceNav: Omit<NavGroup, "icon"> = {
  key: "commerce",
  label: "خرید و فروش",
  module: "goods",
  items: [{ key: "price-lists", label: "فهرست‌های قیمت", path: "sales/price-lists", area: "sales" }],
};

export const inventoryNav: Omit<NavGroup, "icon"> = {
  key: "inventory",
  label: "انبار و کالا",
  module: "goods",
  items: [
    { key: "items", label: "کالاها و خدمات", path: "inventory/items", area: "inventory" },
    { key: "item-categories", label: "گروه‌های کالا", path: "inventory/categories", area: "inventory" },
    { key: "units", label: "واحدهای اندازه‌گیری", path: "inventory/units", area: "inventory" },
    { key: "warehouses", label: "انبارها", path: "inventory/warehouses", area: "inventory" },
  ],
};

export const goodsRoutes: AppRoute[] = [
  { path: "sales/price-lists", element: <EntityPage entity="price_list" /> },
  { path: "inventory/items", element: <EntityPage entity="item" drawerWidth={860} /> },
  { path: "inventory/categories", element: <EntityPage entity="item_category" /> },
  { path: "inventory/units", element: <EntityPage entity="unit" /> },
  { path: "inventory/warehouses", element: <EntityPage entity="warehouse" /> },
];
