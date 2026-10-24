import type { Metadata } from "next";
import { CollectionPage } from "@/components/pages/collection-page";
import { getCatalog } from "@/lib/catalog";
import { t } from "@/lib/i18n";
import { mediaUrl } from "@/lib/media";
import { collectionDescription, pageMetadata } from "@/lib/seo";

export const revalidate = 600;

export async function generateStaticParams() {
  return (await getCatalog()).collections.filter((c) => c.visible !== false).map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const col = (await getCatalog()).collections.find((c) => c.slug === slug && c.visible !== false);
  if (!col) return {};
  return pageMetadata("en", {
    path: `/collections/${col.slug}`,
    title: `The ${t(col, "name", "en")} collection`,
    description: collectionDescription(col, "en"),
    image: col.media ? mediaUrl(col.media, 1280) : undefined,
  });
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <CollectionPage lang="en" slug={slug} />;
}
