import type { Metadata } from "next";
import { pageAlternates } from "@/lib/seo";
import { HomePage } from "@/components/pages/home-page";

export const metadata: Metadata = { alternates: pageAlternates("fa", "/") };

export default function Page() {
  return <HomePage lang="fa" />;
}
