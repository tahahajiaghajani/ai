import { notFound } from "next/navigation";
import { formatDate } from "@/lib/i18n";
import { ui } from "@/content/ui";
import { env } from "@/lib/env";
import { requireAdmin } from "@/lib/admin-auth";
import { getRequest, listMessages } from "@/lib/requests";
import { normalizeCode, PRIORITY_LABEL, STATUSES, isPriority } from "@/lib/request-meta";
import { changeStatus, ownerReply, retriage } from "@/app/actions/admin";

export default async function RequestDetail({ params }: PageProps<"/admin/requests/[code]">) {
  await requireAdmin(); // the layout check alone does not stop this page from rendering
  const r = await getRequest(normalizeCode((await params).code));
  if (!r) notFound();
  const msgs = await listMessages(r.id);
  const t = r.ai_triage;
  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_360px]">
      <div>
        <p className="font-mono text-sm text-muted" dir="ltr">{r.code}</p>
        <h1 className="mt-2 text-3xl font-bold">{r.subject}</h1>
        <p className="mt-3 text-sm text-muted">{formatDate(r.created_at, "fa")} · {r.lang === "en" ? "انگلیسی" : "فارسی"} · {r.source}</p>
        <article className="mt-8 whitespace-pre-wrap rounded-[8px] border border-line p-6 leading-relaxed">{r.body}</article>
        <div className="mt-6 grid gap-4">
          {msgs.map((m) => (
            <article key={m.id} className={`rounded-[8px] border p-5 ${m.author === "owner" ? "border-fg" : "border-line"}`}>
              <p className="mb-2 text-xs text-muted">{m.author === "owner" ? "طاها" : m.author === "visitor" ? r.name : "سامانه"} · {formatDate(m.created_at, "fa")}</p>
              <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
            </article>
          ))}
        </div>
        <form action={ownerReply} className="mt-8 grid gap-3">
          <input type="hidden" name="code" value={r.code} />
          <label className="grid gap-2">
            <span className="text-sm text-muted">پاسخ (در صفحه‌ی پیگیری بازدیدکننده نمایش داده می‌شود)</span>
            <textarea name="body" rows={8} defaultValue={r.ai_reply ?? ""} className="rounded-[8px] border border-line-strong bg-transparent p-4 leading-relaxed outline-none focus:border-fg" />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <select name="status" defaultValue="answered" className="rounded-full border border-line bg-bg px-4 py-2 text-sm">
              <option value="answered">{ui.track.status.answered.fa}</option>
              <option value="scheduled">{ui.track.status.scheduled.fa}</option>
              <option value="closed">{ui.track.status.closed.fa}</option>
            </select>
            <button className="rounded-full bg-fg px-6 py-2.5 text-sm font-semibold text-bg">ارسال پاسخ</button>
          </div>
        </form>
      </div>
      <aside className="grid content-start gap-6">
        <section className="rounded-[8px] border border-line p-5 text-sm">
          <h2 className="mb-3 font-bold">تماس</h2>
          <p>{r.name}{r.organization ? ` · ${r.organization}` : ""}</p>
          {r.email ? <a href={`mailto:${r.email}`} className="link-draw block" dir="ltr">{r.email}</a> : null}
          {r.phone ? <a href={`tel:${r.phone}`} className="link-draw block" dir="ltr">{r.phone}</a> : null}
          {r.telegram ? <a href={`https://t.me/${r.telegram.replace(/^@/, "")}`} className="link-draw block" dir="ltr">{r.telegram}</a> : null}
          {r.budget ? <p className="mt-3 text-muted">بودجه: {r.budget}</p> : null}
          {r.timeline ? <p className="text-muted">زمان‌بندی: {r.timeline}</p> : null}
        </section>
        <section className="rounded-[8px] border border-line p-5 text-sm">
          <h2 className="mb-3 font-bold">تحلیل هوش مصنوعی</h2>
          {t ? (
            <div className="grid gap-2 leading-relaxed">
              <p>نوع: {ui.request.kinds[r.kind]?.fa ?? r.kind} · اولویت: {isPriority(r.priority) ? PRIORITY_LABEL[r.priority].fa : r.priority}{t.fit ? ` · تناسب: ${t.fit}` : ""}</p>
              {t.summary_owner ? <p className="text-fg-2">{t.summary_owner}</p> : null}
              {t.tags?.length ? <p className="text-muted">{t.tags.join(" · ")}</p> : null}
              {t.questions?.length ? <ul className="list-inside list-disc text-fg-2">{t.questions.map((q, i) => <li key={i}>{q}</li>)}</ul> : null}
              <p className="text-xs text-faint" dir="ltr">{t.model}</p>
            </div>
          ) : (
            <p className="text-muted">{env.geminiKey ? "هنوز تحلیل نشده." : "GEMINI_API_KEY تنظیم نشده است."}</p>
          )}
          <form action={retriage} className="mt-4">
            <input type="hidden" name="code" value={r.code} />
            <button className="rounded-full border border-line px-4 py-1.5 text-xs hover:border-fg">تحلیل دوباره</button>
          </form>
        </section>
        <section className="rounded-[8px] border border-line p-5 text-sm">
          <h2 className="mb-3 font-bold">وضعیت</h2>
          <form action={changeStatus} className="flex flex-wrap gap-2">
            <input type="hidden" name="code" value={r.code} />
            {STATUSES.map((s) => (
              <button key={s} name="status" value={s} className={`rounded-full border px-3 py-1 text-xs ${r.status === s ? "border-fg bg-fg text-bg" : "border-line"}`}>{ui.track.status[s].fa}</button>
            ))}
          </form>
        </section>
      </aside>
    </div>
  );
}
