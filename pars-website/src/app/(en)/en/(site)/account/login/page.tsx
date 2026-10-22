import type { Metadata } from "next";
import { LoginView } from "@/components/account/account-pages";
import { copy } from "@/lib/i18n";

export const metadata: Metadata = { title: copy("en").account.entry, robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  return <LoginView lang="en" mode={q.mode} next={q.next} />;
}
