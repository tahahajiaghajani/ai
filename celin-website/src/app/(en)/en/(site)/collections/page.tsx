import type { Metadata } from "next";
import { CollectionsPage } from "@/components/pages/collections-page";
import { collectionsCopy } from "@/content/copy/collections";
import { pageMetadata } from "@/lib/seo";

const m = collectionsCopy.en.meta;
export const metadata: Metadata = pageMetadata("en", { path: "/collections", title: m.title, description: m.description });

export default function Page() {
  return <CollectionsPage lang="en" />;
}
