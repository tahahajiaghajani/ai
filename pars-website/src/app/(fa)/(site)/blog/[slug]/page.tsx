import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PostView } from "@/components/blog/post-view";
import { getPost, listPosts } from "@/lib/blog";
import { pageMetadata } from "@/lib/seo";

export const revalidate = 300;

type Props = { params: Promise<{ slug: string }> };

export async function generateStaticParams() {
  return (await listPosts("fa")).map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = await getPost("fa", (await params).slug);
  if (!post) return {};
  return pageMetadata("fa", {
    path: `/blog/${post.slug}`,
    title: post.title,
    description: post.excerpt || post.title,
    image: post.cover_url || undefined,
    article: { publishedTime: post.published_at ?? undefined, modifiedTime: post.updated_at, tags: post.tags },
  });
}

export default async function Page({ params }: Props) {
  const post = await getPost("fa", (await params).slug);
  if (!post) notFound();
  return <PostView post={post} lang="fa" />;
}
