import type { Metadata } from "next";
import { WishlistPage } from "@/components/account/simple-pages";
import { accountCopy } from "@/content/copy/account";
import { memberMetadata } from "@/lib/member";

export const metadata: Metadata = memberMetadata(accountCopy("fa").meta.wishlist);

export default function Page() {
  return <WishlistPage lang="fa" />;
}
