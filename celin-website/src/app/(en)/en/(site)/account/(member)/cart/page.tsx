import type { Metadata } from "next";
import { CartPage } from "@/components/account/cart-page";
import { accountCopy } from "@/content/copy/account";
import { memberMetadata } from "@/lib/member";

export const metadata: Metadata = memberMetadata(accountCopy("en").meta.cart);

export default function Page() {
  return <CartPage lang="en" />;
}
