import type { Metadata } from "next";
import { MessagesPage } from "@/components/account/simple-pages";
import { accountCopy } from "@/content/copy/account";
import { memberMetadata } from "@/lib/member";

export const metadata: Metadata = memberMetadata(accountCopy("en").meta.messages);

export default function Page() {
  return <MessagesPage lang="en" />;
}
