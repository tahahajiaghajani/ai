import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/admin-auth";
import { getAdminProduct, listTaxa } from "@/lib/admin-catalog";
import { db } from "@/lib/db";
import { DbMissing, PageHeader } from "@/components/admin/ui";
import { ProductEditor } from "@/components/admin/product-editor";

export const metadata = { title: "ویرایش محصول" };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  if (!db())
    return (
      <>
        <PageHeader title="ویرایش محصول" back={{ href: "/admin/products", label: "محصولات" }} />
        <DbMissing />
      </>
    );
  const [got, categories, collections] = await Promise.all([getAdminProduct(id), listTaxa("categories"), listTaxa("collections")]);
  if (!got) notFound();
  return (
    <ProductEditor
      // a save changes updated_at: the editor starts again from the stored product (new option ids included)
      key={`${got.product.id}:${got.product.updated_at ?? ""}`}
      product={got.product}
      media={got.media}
      categories={(categories ?? []).map(({ id, name_fa }) => ({ id, name_fa }))}
      collections={(collections ?? []).map(({ id, name_fa }) => ({ id, name_fa }))}
    />
  );
}
