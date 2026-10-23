import type { Metadata } from "next";
import { LoginPage } from "@/components/account/login-page";
import { accountCopy } from "@/content/copy/account";
import { pageMetadata } from "@/lib/seo";

const m = accountCopy("fa").meta.login;
export const metadata: Metadata = pageMetadata("fa", { path: "/account/login", title: m.title, description: m.description });

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <LoginPage lang="fa" searchParams={searchParams} />;
}
