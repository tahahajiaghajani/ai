import { requireAdminPage } from "@/lib/admin-auth";
import { listTaxa } from "@/lib/admin-catalog";
import { paletteOf } from "@/lib/options";
import { getSettingsFresh } from "@/lib/settings";
import { DbMissing, PageHeader } from "@/components/admin/ui";
import { ProductEditor } from "@/components/admin/product-editor";

export const metadata = { title: "محصول تازه" };

export default async function NewProductPage() {
  await requireAdminPage();
  const [categories, collections, settings] = await Promise.all([listTaxa("categories"), listTaxa("collections"), getSettingsFresh()]);
  if (!categories || !collections)
    return (
      <>
        <PageHeader title="محصول تازه" back={{ href: "/admin/products", label: "محصولات" }} />
        <DbMissing />
      </>
    );
  return <ProductEditor product={null} media={{}} categories={categories.map(({ id, name_fa }) => ({ id, name_fa }))} collections={collections.map(({ id, name_fa }) => ({ id, name_fa }))} palette={paletteOf(settings.options)} />;
}
