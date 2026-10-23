import type { Metadata } from "next";
import { CraftPage } from "@/components/pages/craft-page";
import { craftCopy } from "@/content/copy/craft";
import { pageMetadata } from "@/lib/seo";

const m = craftCopy.en.meta;
export const metadata: Metadata = pageMetadata("en", { path: "/craft", title: m.title, description: m.description });

export default function Page() {
  return <CraftPage lang="en" />;
}
