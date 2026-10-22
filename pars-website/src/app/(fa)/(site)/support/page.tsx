import type { Metadata } from "next";
import { SupportPage } from "@/components/support/support-page";
import { copy } from "@/lib/i18n";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata("fa", { path: "/support", title: copy("fa").support.title, description: copy("fa").support.lead });

export default function Page() {
  return <SupportPage lang="fa" />;
}
