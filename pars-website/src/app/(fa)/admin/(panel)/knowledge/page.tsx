import { num } from "@/lib/i18n";
import { requireAdminPage } from "@/lib/admin-auth";
import { listKnowledgeRows } from "@/lib/knowledge";
import { DEFAULT_KNOWLEDGE } from "@/lib/knowledge-default";
import { DbMissing, PageTitle } from "@/components/admin/ui";
import { KnowledgeManager } from "@/components/admin/knowledge-manager";

export default async function Knowledge({ searchParams }: { searchParams: Promise<{ title?: string; body?: string }> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const rows = await listKnowledgeRows();
  return (
    <>
      <PageTitle title="دانش پارس" sub="دستیار فقط از همین دانش پاسخ می‌دهد. هر چه اینجا دقیق‌تر باشد، پاسخ‌ها دقیق‌تر است؛ اطلاعاتی که اینجا نیست، به مشتری گفته نمی‌شود." />
      {rows === null ? (
        <>
          <DbMissing />
          <p className="mt-4 text-sm text-muted">تا اتصال پایگاه داده، دستیار از دانش اولیه‌ی زیر ({num(DEFAULT_KNOWLEDGE.length, "fa")} مدخل) استفاده می‌کند.</p>
        </>
      ) : (
        <KnowledgeManager
          rows={rows.map((r) => ({ id: r.id, title: r.title, body: r.body, tags: r.tags ?? [], pinned: r.pinned, enabled: r.enabled, sort: r.sort, updated_at: r.updated_at }))}
          defaultsCount={DEFAULT_KNOWLEDGE.length}
          prefill={sp.title || sp.body ? { title: sp.title ?? "", body: sp.body ?? "" } : null}
        />
      )}
    </>
  );
}
