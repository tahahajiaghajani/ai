import type { Metadata } from "next";
import { ProfilePage } from "@/components/account/simple-pages";
import { accountCopy } from "@/content/copy/account";
import { memberMetadata } from "@/lib/member";

export const metadata: Metadata = memberMetadata(accountCopy("en").meta.profile);

export default function Page() {
  return <ProfilePage lang="en" />;
}
