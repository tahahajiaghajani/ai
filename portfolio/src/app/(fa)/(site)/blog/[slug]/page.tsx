import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Post } from "@/components/blog/post";
import { POSTS, getPost } from "@/content/blog";
import { pageMetadata } from "@/lib/seo";

// only the registered posts exist: any other slug is a 404 at routing, served by the global not-found page
export const dynamicParams = false;

export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps<"/blog/[slug]">): Promise<Metadata> {
  const p = getPost((await params).slug);
  if (!p) return {};
  return pageMetadata("fa", `/blog/${p.slug}`, p.title.fa, p.dek.fa, { image: { url: p.og, alt: p.title.fa }, publishedTime: p.date });
}

export default async function Page({ params }: PageProps<"/blog/[slug]">) {
  const p = getPost((await params).slug);
  if (!p) notFound();
  return <Post p={p} lang="fa" />;
}
