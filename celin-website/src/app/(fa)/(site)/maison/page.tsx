import type { Metadata } from "next";
import { MaisonPage } from "@/components/pages/maison-page";
import { maisonCopy } from "@/content/copy/maison";
import { pageMetadata } from "@/lib/seo";

const m = maisonCopy.fa.meta;
export const metadata: Metadata = pageMetadata("fa", { path: "/maison", title: m.title, description: m.description });

export default function Page() {
  return <MaisonPage lang="fa" />;
}
