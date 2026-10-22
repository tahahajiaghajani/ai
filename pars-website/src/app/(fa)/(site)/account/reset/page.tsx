import type { Metadata } from "next";
import { ResetView } from "@/components/account/account-pages";
import { copy } from "@/lib/i18n";

export const metadata: Metadata = { title: copy("fa").account.resetTitle, robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ResetView lang="fa" token={(await searchParams).t} />;
}
