import type { Metadata } from "next";
import { ContactPage } from "@/components/pages/contact-page";
import { contactCopy } from "@/content/copy/contact";
import { pageMetadata } from "@/lib/seo";

const m = contactCopy.fa.meta;
export const metadata: Metadata = pageMetadata("fa", { path: "/contact", title: m.title, description: m.description });

export default function Page() {
  return <ContactPage lang="fa" />;
}
