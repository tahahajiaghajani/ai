import type { Metadata } from "next";
import { AccountView } from "@/components/account/account-pages";
import { copy } from "@/lib/i18n";

export const metadata: Metadata = { title: copy("fa").account.myAccount, robots: { index: false } };

export default function Page() {
  return <AccountView lang="fa" />;
}
