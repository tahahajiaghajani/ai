import type { Metadata } from "next";
import { CollectionPage } from "@/components/pages/collection-page";
import { getCatalog } from "@/lib/catalog";
import { t } from "@/lib/i18n";
import { mediaUrl } from "@/lib/media";
import { pageMetadata } from "@/lib/seo";

export const revalidate = 600;

export async function generateStaticParams() {
  return (await getCatalog()).collections.filter((c) => c.visible !== false).map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const col = (await getCatalog()).collections.find((c) => c.slug === slug && c.visible !== false);
  if (!col) return {};
  const tagline = t(col, "tagline", "fa");
  return pageMetadata("fa", {
    path: `/collections/${col.slug}`,
    title: t(col, "name", "fa"),
    description: [tagline, t(col, "story", "fa")].filter(Boolean).join(" — ").slice(0, 200),
    image: col.media ? mediaUrl(col.media, 1280) : undefined,
  });
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <CollectionPage lang="fa" slug={slug} />;
}
