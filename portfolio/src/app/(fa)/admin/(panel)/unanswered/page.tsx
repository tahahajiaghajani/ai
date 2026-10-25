import { requireAdmin } from "@/lib/admin-auth";
import { ghConfigured } from "@/lib/github";
import { listUnanswered } from "@/lib/chat-log";
import { formatDate } from "@/lib/i18n";
import { NotConnected } from "@/components/admin/not-connected";

export default async function Unanswered() {
  await requireAdmin(); // the layout check alone does not stop this page from rendering
  if (!ghConfigured()) return <NotConnected />;
  let data: Awaited<ReturnType<typeof listUnanswered>>;
  try {
    data = await listUnanswered();
  } catch (e) {
    return <NotConnected error={e instanceof Error ? e.message : String(e)} />;
  }
  return (
    <>
      <h1 className="mb-3 text-3xl font-bold">پرسش‌های بی‌پاسخ</h1>
      <p className="mb-8 max-w-[70ch] text-sm leading-relaxed text-muted">
        فقط پرسش‌هایی نگه داشته می‌شوند که دستیار پاسخشان را نداشت؛ پاسخ درست را در «دانش دستیار» اضافه کنید.
        {data.url ? (
          <>
            {" "}
            تازه‌ترین ۱۰۰ مورد اینجاست؛ همه در <a href={data.url} target="_blank" rel="noreferrer" className="link-draw">issue فعلی در GitHub ↗</a>
            {data.previousUrl ? (
              <>
                {" "}و <a href={data.previousUrl} target="_blank" rel="noreferrer" className="link-draw">issue قبلی ↗</a>
              </>
            ) : null}
            .
          </>
        ) : null}
      </p>
      <div className="grid gap-4">
        {data.items.map((r, i) => (
          <article key={i} className="rounded-[8px] border border-line p-5">
            <p className="mb-2 text-xs text-muted">{r.at ? formatDate(r.at, "fa") : ""} · {r.lang} · <span dir="ltr">{r.model}</span></p>
            <p className="font-semibold" dir="auto">{r.question}</p>
            <p className="mt-2 whitespace-pre-wrap text-start text-sm leading-relaxed text-fg-2" dir="auto">{r.answer}</p>
          </article>
        ))}
        {data.items.length === 0 ? <p className="text-muted">هنوز پرسش بی‌پاسخی ثبت نشده.</p> : null}
      </div>
    </>
  );
}
