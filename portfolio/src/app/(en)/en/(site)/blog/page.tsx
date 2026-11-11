import type { Metadata } from "next";
import { BlogIndex } from "@/components/blog/blog-index";
import { ui } from "@/content/ui";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata("en", "/blog", ui.blog.title.en, ui.blog.lead.en, { type: "website" });

export default function Page() {
  return <BlogIndex lang="en" />;
}
