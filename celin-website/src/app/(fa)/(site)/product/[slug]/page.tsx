import type { Metadata } from "next";
import { ProductPage } from "@/components/pages/product-page";
import { getCatalog } from "@/lib/catalog";
import { t } from "@/lib/i18n";
import { mediaUrl } from "@/lib/media";
import { pageMetadata } from "@/lib/seo";

export const revalidate = 600;

export async function generateStaticParams() {
  return (await getCatalog()).products.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = (await getCatalog()).products.find((x) => x.slug === slug);
  if (!p) return {};
  const cover = p.images[0];
  return pageMetadata("fa", { path: `/product/${p.slug}`, title: t(p, "name", "fa"), description: t(p, "subtitle", "fa") || t(p, "description", "fa").slice(0, 160), image: cover ? mediaUrl(cover, 1280) : undefined });
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ProductPage lang="fa" slug={slug} />;
}
