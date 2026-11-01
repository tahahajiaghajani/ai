import type { NavGroup, AppRoute } from "../registry";
import { EntityPage } from "../../components/data";

export const treasuryNav: Omit<NavGroup, "icon"> = {
  key: "treasury",
  label: "خزانه‌داری",
  items: [
    { key: "cash-boxes", label: "صندوق‌ها", path: "treasury/cash-boxes", area: "treasury" },
    { key: "bank-accounts", label: "حساب‌های بانکی", path: "treasury/bank-accounts", area: "treasury" },
    { key: "pos", label: "کارتخوان‌ها", path: "treasury/pos", area: "treasury" },
    { key: "cheque-books", label: "دسته‌چک‌ها", path: "treasury/cheque-books", area: "treasury" },
  ],
};

export const treasuryRoutes: AppRoute[] = [
  { path: "treasury/cash-boxes", element: <EntityPage entity="cash_box" /> },
  { path: "treasury/bank-accounts", element: <EntityPage entity="bank_account" /> },
  { path: "treasury/pos", element: <EntityPage entity="pos_terminal" /> },
  { path: "treasury/cheque-books", element: <EntityPage entity="cheque_book" /> },
];
