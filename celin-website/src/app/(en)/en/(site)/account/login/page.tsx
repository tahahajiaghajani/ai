import type { Metadata } from "next";
import { LoginPage } from "@/components/account/login-page";
import { accountCopy } from "@/content/copy/account";
import { pageMetadata } from "@/lib/seo";

const m = accountCopy("en").meta.login;
export const metadata: Metadata = pageMetadata("en", { path: "/account/login", title: m.title, description: m.description });

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <LoginPage lang="en" searchParams={searchParams} />;
}
