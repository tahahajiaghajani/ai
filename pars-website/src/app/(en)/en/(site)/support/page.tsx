import type { Metadata } from "next";
import { SupportPage } from "@/components/support/support-page";
import { copy } from "@/lib/i18n";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata("en", { path: "/support", title: copy("en").support.title, description: copy("en").support.lead });

export default function Page() {
  return <SupportPage lang="en" />;
}
