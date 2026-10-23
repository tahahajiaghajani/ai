import { requireAdminPage } from "@/lib/admin-auth";
import { listAdminProducts, listTaxa, type TaxonKind } from "@/lib/admin-catalog";
import { loadMedia } from "@/lib/catalog";
import { DbMissing, PageHeader } from "@/components/admin/ui";
import { TaxaManager } from "@/components/admin/taxa-manager";

export const metadata = { title: "دسته‌ها و مجموعه‌ها" };

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  await requireAdminPage();
  const kind: TaxonKind = (await searchParams).tab === "collections" ? "collections" : "categories";
  const [categories, collections, products] = await Promise.all([listTaxa("categories"), listTaxa("collections"), listAdminProducts()]);
  if (!categories || !collections)
    return (
      <>
        <PageHeader title="دسته‌ها و مجموعه‌ها" />
        <DbMissing />
      </>
    );
  const items = kind === "categories" ? categories : collections;
  const media = await loadMedia(items.map((t) => t.media_id ?? ""));
  const counts: Record<string, number> = {};
  for (const p of products ?? []) {
    const id = kind === "categories" ? p.category_id : p.collection_id;
    if (id) counts[id] = (counts[id] ?? 0) + 1;
  }
  return (
    <TaxaManager
      key={kind}
      kind={kind}
      items={items}
      media={Object.fromEntries(media)}
      counts={counts}
      totals={{ categories: categories.length, collections: collections.length }}
    />
  );
}
