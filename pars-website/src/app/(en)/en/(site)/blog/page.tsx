import type { Metadata } from "next";
import { BlogIndex } from "@/components/blog/blog-index";
import { copy } from "@/lib/i18n";
import { pageMetadata } from "@/lib/seo";

export const revalidate = 300;
export const metadata: Metadata = pageMetadata("en", { path: "/blog", title: copy("en").blog.title, description: copy("en").blog.lead });

export default function Page() {
  return <BlogIndex lang="en" />;
}
