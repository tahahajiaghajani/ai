// Treasury (خزانه‌داری): receipts, payments, transfers, cheques, the cash & bank book and the
// master data of cash boxes, bank accounts, POS terminals and cheque books.
import { lazy } from "react";
import { ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight, Signature, Wallet, Vault, Landmark, CreditCard, BookCopy } from "lucide-react";
import { ChequeIcon } from "../../components/shell/icons";
import type { NavGroup, AppRoute } from "../registry";
import { EntityPage } from "../../components/data";

const Docs = lazy(() => import("./Docs"));
const DocEditor = lazy(() => import("./DocEditor"));
const Cheques = lazy(() => import("./Cheques"));
const Book = lazy(() => import("./Book"));
const ChequeOpRedirect = lazy(() => import("./ChequeOpRedirect"));

export const treasuryNav: Omit<NavGroup, "icon" | "space"> = {
  key: "treasury",
  label: "خزانه‌داری",
  items: [
    { key: "receipts", label: "دریافت‌ها", path: "treasury/receipts", area: "treasury", icon: ArrowDownToLine, keywords: "دریافت وجه رسید نقد کارتخوان واریز" },
    { key: "payments", label: "پرداخت‌ها", path: "treasury/payments", area: "treasury", icon: ArrowUpFromLine, keywords: "پرداخت وجه حواله هزینه" },
    { key: "transfers", label: "انتقال وجه", path: "treasury/transfers", area: "treasury", icon: ArrowLeftRight, keywords: "انتقال بین بانک و صندوق برداشت واریز" },
    { key: "cheques-received", label: "چک‌های دریافتی", path: "treasury/cheques", area: "treasury", icon: ChequeIcon, count: "overdue-cheques", keywords: "چک مشتری وصول واگذاری برگشتی خرج سررسید" },
    { key: "cheques-issued", label: "چک‌های پرداختی", path: "treasury/cheques/issued", area: "treasury", icon: Signature, keywords: "چک صادره پاس دسته چک" },
    { key: "book", label: "دفتر صندوق و بانک", path: "treasury/book", area: "treasury", icon: Wallet, keywords: "موجودی صندوق موجودی بانک گردش" },
    { key: "cash-boxes", label: "صندوق‌ها", path: "treasury/cash-boxes", area: "treasury", icon: Vault, section: "تعریف‌ها" },
    { key: "bank-accounts", label: "حساب‌های بانکی", path: "treasury/bank-accounts", area: "treasury", icon: Landmark, section: "تعریف‌ها" },
    { key: "pos", label: "کارتخوان‌ها", path: "treasury/pos", area: "treasury", icon: CreditCard, section: "تعریف‌ها" },
    { key: "cheque-books", label: "دسته‌چک‌ها", path: "treasury/cheque-books", area: "treasury", icon: BookCopy, section: "تعریف‌ها" },
  ],
};

export const treasuryRoutes: AppRoute[] = [
  { path: "treasury/receipts", element: <Docs kind="receipt" /> },
  { path: "treasury/payments", element: <Docs kind="payment" /> },
  { path: "treasury/transfers", element: <Docs kind="transfer" /> },
  { path: "treasury/docs/new", element: <DocEditor /> },
  { path: "treasury/docs/:id", element: <DocEditor /> },
  { path: "treasury/cheques", element: <Cheques /> },
  { path: "treasury/cheques/:tab", element: <Cheques /> },
  { path: "treasury/cheque-ops/:opId", element: <ChequeOpRedirect /> },
  { path: "treasury/book", element: <Book /> },
  { path: "treasury/cash-boxes", element: <EntityPage entity="cash_box" /> },
  { path: "treasury/bank-accounts", element: <EntityPage entity="bank_account" /> },
  { path: "treasury/pos", element: <EntityPage entity="pos_terminal" /> },
  { path: "treasury/cheque-books", element: <EntityPage entity="cheque_book" /> },
];
