import type { Metadata } from "next";
import { SupportPage } from "@/components/support/support-page";
import { copy } from "@/lib/i18n";
import { pageAlternates } from "@/lib/seo";

export const metadata: Metadata = {
  title: copy("en").support.title,
  description: copy("en").support.lead,
  alternates: pageAlternates("en", "/support"),
};

export default function Page() {
  return <SupportPage lang="en" />;
}
