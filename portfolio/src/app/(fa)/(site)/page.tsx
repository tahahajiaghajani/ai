import type { Metadata } from "next";
import { HomePage } from "@/components/home/home-page";
import { pageAlternates } from "@/lib/seo";

export const metadata: Metadata = { alternates: pageAlternates("fa", "/") };

export default function Page() {
  return <HomePage lang="fa" />;
}
