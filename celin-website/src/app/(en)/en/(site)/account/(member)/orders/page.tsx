import type { Metadata } from "next";
import { OrdersPage } from "@/components/account/orders-page";
import { accountCopy } from "@/content/copy/account";
import { memberMetadata } from "@/lib/member";

export const metadata: Metadata = memberMetadata(accountCopy("en").meta.orders);

export default function Page() {
  return <OrdersPage lang="en" />;
}
