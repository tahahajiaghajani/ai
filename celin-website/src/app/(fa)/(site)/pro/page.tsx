import type { Metadata } from "next";
import { ProPage } from "@/components/account/pro-page";
import { accountCopy } from "@/content/copy/account";
import { pageMetadata } from "@/lib/seo";

const m = accountCopy("fa").meta.pro;
export const metadata: Metadata = pageMetadata("fa", { path: "/pro", title: m.title, description: m.description });

export default function Page() {
  return <ProPage lang="fa" />;
}
