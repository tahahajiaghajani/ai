import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/admin-auth";
import { adminGetPost } from "@/lib/blog";
import { db } from "@/lib/db";
import { DbMissing, PageTitle } from "@/components/admin/ui";
import { BlogEditor } from "@/components/admin/blog-admin";

export default async function EditPost({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ lang?: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  if (!db()) return <DbMissing />;
  const post = id === "new" ? null : await adminGetPost(id);
  if (id !== "new" && !post) notFound();
  const lang = (await searchParams).lang === "en" ? "en" : "fa";
  return (
    <>
      <PageTitle title={post ? "ویرایش نوشته" : "نوشته‌ی تازه"} />
      <BlogEditor post={post} lang={post?.lang ?? lang} />
    </>
  );
}
