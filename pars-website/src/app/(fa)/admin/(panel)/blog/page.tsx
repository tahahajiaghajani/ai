import Link from "next/link";
import { requireAdminPage } from "@/lib/admin-auth";
import { adminListPosts } from "@/lib/blog";
import { STARTER_POSTS } from "@/lib/blog-starter";
import { db } from "@/lib/db";
import { DbMissing, PageTitle } from "@/components/admin/ui";
import { BlogList } from "@/components/admin/blog-admin";

export default async function BlogAdmin() {
  await requireAdminPage();
  if (!db()) {
    return (
      <>
        <PageTitle title="وبلاگ" />
        <DbMissing />
      </>
    );
  }
  let rows = null;
  let error = "";
  try {
    rows = await adminListPosts();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return (
    <>
      <PageTitle
        title="وبلاگ"
        sub="نوشته‌ها با Markdown نوشته می‌شوند و پس از انتشار در /blog (فارسی) یا /en/blog (انگلیسی) دیده می‌شوند."
        actions={
          <Link href="/admin/blog/new" className="inline-flex h-10 items-center rounded-full bg-reverse px-5 text-sm font-semibold text-white">
            + نوشته‌ی تازه
          </Link>
        }
      />
      <BlogList rows={rows ?? []} error={error} starterCount={STARTER_POSTS.length} />
    </>
  );
}
