import type { Metadata } from "next";
import { RecordsPage } from "@/components/records/records-page";
import { copy } from "@/lib/i18n";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata("en", { path: "/records", title: copy("en").records.title, description: copy("en").records.lead });

export default function Page() {
  return <RecordsPage lang="en" />;
}
