import type { Metadata } from "next";
import { DashboardPage } from "@/components/account/dashboard-page";
import { accountCopy } from "@/content/copy/account";
import { memberMetadata } from "@/lib/member";

export const metadata: Metadata = memberMetadata(accountCopy("fa").meta.account);

export default function Page() {
  return <DashboardPage lang="fa" />;
}
