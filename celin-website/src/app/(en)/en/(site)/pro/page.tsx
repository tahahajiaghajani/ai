import type { Metadata } from "next";
import { ProPage } from "@/components/account/pro-page";
import { accountCopy } from "@/content/copy/account";
import { pageMetadata } from "@/lib/seo";

const m = accountCopy("en").meta.pro;
export const metadata: Metadata = pageMetadata("en", { path: "/pro", title: m.title, description: m.description });

export default function Page() {
  return <ProPage lang="en" />;
}
