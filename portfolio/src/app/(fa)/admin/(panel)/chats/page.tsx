import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { formatDate } from "@/lib/i18n";

export default async function Chats() {
  await requireAdmin(); // the layout check alone does not stop this page from rendering
  const c = db();
  if (!c) return <p className="text-fg-2">پایگاه داده تنظیم نشده است.</p>;
  const { data } = await c.from("portfolio_chat_logs").select("*").order("created_at", { ascending: false }).limit(150);
  const rows = (data ?? []) as { id: string; lang: string; question: string; answer: string; unknown: boolean; model: string; created_at: string }[];
  return (
    <>
      <h1 className="mb-8 text-3xl font-bold">گفت‌وگوهای دستیار</h1>
      <p className="mb-6 text-sm text-muted">پرسش‌هایی که دستیار پاسخشان را نداشت با «بی‌پاسخ» مشخص شده‌اند؛ آن‌ها را به دانش دستیار اضافه کنید.</p>
      <div className="grid gap-4">
        {rows.map((r) => (
          <article key={r.id} className={`rounded-[8px] border p-5 ${r.unknown ? "border-fg" : "border-line"}`}>
            <p className="mb-2 text-xs text-muted">{formatDate(r.created_at, "fa")} · {r.lang} · <span dir="ltr">{r.model}</span>{r.unknown ? " · بی‌پاسخ" : ""}</p>
            <p className="font-semibold">{r.question}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-fg-2">{r.answer}</p>
          </article>
        ))}
        {rows.length === 0 ? <p className="text-muted">هنوز گفت‌وگویی ثبت نشده.</p> : null}
      </div>
    </>
  );
}
