import type { Metadata } from "next";
import { SearchPage } from "@/components/pages/search-page";
import { searchCopy } from "@/content/copy/search";
import { pageMetadata } from "@/lib/seo";

const m = searchCopy.fa.meta;
export const metadata: Metadata = pageMetadata("fa", { path: "/search", title: m.title, description: m.description, noindex: true });

export default function Page() {
  return <SearchPage lang="fa" />;
}
