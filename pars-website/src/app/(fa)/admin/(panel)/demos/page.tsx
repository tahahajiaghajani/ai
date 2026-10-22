import { requireAdminPage } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { listDemos } from "@/lib/demos";
import { DbMissing, PageTitle } from "@/components/admin/ui";
import { DemosManager } from "@/components/admin/demos-manager";

export default async function Demos() {
  await requireAdminPage();
  return (
    <>
      <PageTitle title="دموها" sub="هر تعداد پیوند دمو که بخواهید؛ با دکمه‌ی «دموی محصولات» در سایت به‌ترتیب نمایش داده می‌شوند." />
      {db() ? <DemosManager rows={await listDemos()} /> : <DbMissing />}
    </>
  );
}
