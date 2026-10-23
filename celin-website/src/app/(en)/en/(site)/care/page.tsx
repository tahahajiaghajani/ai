import type { Metadata } from "next";
import { CarePage } from "@/components/pages/care-page";
import { careCopy } from "@/content/copy/care";
import { pageMetadata } from "@/lib/seo";

const m = careCopy.en.meta;
export const metadata: Metadata = pageMetadata("en", { path: "/care", title: m.title, description: m.description });

export default function Page() {
  return <CarePage lang="en" />;
}
