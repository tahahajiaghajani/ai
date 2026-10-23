import { requireAdminPage } from "@/lib/admin-auth";
import { listAdminProducts, listTaxa } from "@/lib/admin-catalog";
import { getSettingsFresh } from "@/lib/settings";
import { SEED_CATEGORIES, SEED_COLLECTIONS, SEED_PRODUCTS } from "@/content/seed-catalog";
import { DbMissing, LinkButton, PageHeader } from "@/components/admin/ui";
import { ProductList } from "@/components/admin/product-list";

export const metadata = { title: "محصولات" };

export default async function ProductsPage() {
  await requireAdminPage();
  const [items, categories, collections, settings] = await Promise.all([listAdminProducts(), listTaxa("categories"), listTaxa("collections"), getSettingsFresh()]);
  return (
    <>
      <PageHeader
        title="محصولات"
        actions={
          <LinkButton href="/admin/products/new" variant="primary" icon="plus">
            محصول تازه
          </LinkButton>
        }
      />
      {items === null ? (
        <DbMissing />
      ) : (
        <ProductList
          items={items}
          categories={(categories ?? []).map(({ id, name_fa }) => ({ id, name_fa }))}
          collections={(collections ?? []).map(({ id, name_fa }) => ({ id, name_fa }))}
          initialized={settings.catalog.initialized}
          starter={{ products: SEED_PRODUCTS.length, categories: SEED_CATEGORIES.length, collections: SEED_COLLECTIONS.length }}
        />
      )}
    </>
  );
}
