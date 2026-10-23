import type { Metadata } from "next";
import { ShopPage } from "@/components/pages/shop-page";
import { getCatalog } from "@/lib/catalog";
import { t } from "@/lib/i18n";
import { pageMetadata } from "@/lib/seo";

export const revalidate = 600;

export async function generateStaticParams() {
  return (await getCatalog()).categories.map((c) => ({ category: c.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
  const { category } = await params;
  const cat = (await getCatalog()).categories.find((c) => c.slug === category);
  if (!cat) return {};
  return pageMetadata("fa", { path: `/shop/${cat.slug}`, title: t(cat, "name", "fa"), description: t(cat, "description", "fa") });
}

export default async function Page({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  return <ShopPage lang="fa" category={category} />;
}
