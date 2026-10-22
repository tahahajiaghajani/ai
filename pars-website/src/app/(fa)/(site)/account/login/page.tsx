import type { Metadata } from "next";
import { LoginView } from "@/components/account/account-pages";
import { copy } from "@/lib/i18n";

export const metadata: Metadata = { title: copy("fa").account.entry, robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  return <LoginView lang="fa" mode={q.mode} next={q.next} />;
}
