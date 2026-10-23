import type { Metadata } from "next";
import { AccountProPage } from "@/components/account/simple-pages";
import { accountCopy } from "@/content/copy/account";
import { memberMetadata } from "@/lib/member";

export const metadata: Metadata = memberMetadata(accountCopy("fa").meta.pro_);

export default function Page() {
  return <AccountProPage lang="fa" />;
}
