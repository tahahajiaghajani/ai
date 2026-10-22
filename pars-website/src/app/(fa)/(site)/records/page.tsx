import type { Metadata } from "next";
import { RecordsPage } from "@/components/records/records-page";
import { copy } from "@/lib/i18n";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata("fa", { path: "/records", title: copy("fa").records.title, description: copy("fa").records.lead });

export default function Page() {
  return <RecordsPage lang="fa" />;
}
