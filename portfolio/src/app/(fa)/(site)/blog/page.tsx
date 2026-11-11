import type { Metadata } from "next";
import { BlogIndex } from "@/components/blog/blog-index";
import { ui } from "@/content/ui";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata("fa", "/blog", ui.blog.title.fa, ui.blog.lead.fa);

export default function Page() {
  return <BlogIndex lang="fa" />;
}
