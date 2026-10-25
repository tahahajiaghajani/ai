import { notFound } from "next/navigation";
import { formatDate } from "@/lib/i18n";
import { ui } from "@/content/ui";
import { requireAdmin } from "@/lib/admin-auth";
import { getRequest, listMessages } from "@/lib/requests";
import { getRuntime } from "@/lib/ai/runtime";
import { PRIORITY_LABEL, STATUSES, isPriority } from "@/lib/request-meta";
import { changeStatus, retriage } from "@/app/actions/admin";
import { ReplyBox } from "@/components/admin/reply-box";
import { NotConnected } from "@/components/admin/not-connected";
import type { Message, RequestRow } from "@/lib/requests";

export default async function RequestDetail({ params }: PageProps<"/admin/requests/[n]">) {
  await requireAdmin(); // the layout check alone does not stop this page from rendering
  const n = Number((await params).n);
  if (!Number.isInteger(n) || n < 1) notFound();
  let r: RequestRow | null;
  let msgs: Message[];
  try {
    r = await getRequest(n);
    msgs = r ? await listMessages(r.number) : [];
  } catch (e) {
    return <NotConnected error={e instanceof Error ? e.message : String(e)} />;
  }
  if (!r) notFound();
  const rt = await getRuntime();
  const t = r.ai_triage;
  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_360px]">
      <div>
        <p className="flex flex-wrap items-center gap-3 text-sm text-muted">
          <span className="font-mono" dir="ltr">{r.code}</span>
          <a href={r.url} target="_blank" rel="noreferrer" className="link-draw">در GitHub ↗</a>
        </p>
        <h1 className="mt-2 text-3xl font-bold">{r.subject}</h1>
        <p className="mt-3 text-sm text-muted">{formatDate(r.created_at, "fa")} · {r.lang === "en" ? "انگلیسی" : "فارسی"} · {r.source}</p>
        <article className="mt-8 whitespace-pre-wrap rounded-[8px] border border-line p-6 leading-relaxed">{r.body}</article>
        <div className="mt-6 grid gap-4">
          {msgs.map((m) => (
            <article key={m.id} className={`rounded-[8px] border p-5 ${m.author === "owner" ? "border-fg" : m.author === "note" ? "border-dashed border-line" : "border-line"}`}>
              <p className="mb-2 text-xs text-muted">{m.author === "owner" ? "طاها" : m.author === "visitor" ? r.name : "یادداشت خصوصی در GitHub (بازدیدکننده نمی‌بیند)"} · {formatDate(m.created_at, "fa")}</p>
              <p className="whitespace-pre-wrap text-start leading-relaxed">{m.body}</p>
            </article>
          ))}
        </div>
        <ReplyBox n={r.number} draft={r.ai_reply ?? ""} />
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
            <p className="text-muted">{rt ? "هنوز تحلیل نشده." : "کلید هوش مصنوعی تنظیم نشده یا دستیار خاموش است (اتصالات)."}</p>
          )}
          {rt ? (
            <form action={retriage} className="mt-4">
              <input type="hidden" name="n" value={r.number} />
              <button className="rounded-full border border-line px-4 py-1.5 text-xs hover:border-fg">تحلیل دوباره</button>
            </form>
          ) : null}
        </section>
        <section className="rounded-[8px] border border-line p-5 text-sm">
          <h2 className="mb-3 font-bold">وضعیت</h2>
          <form action={changeStatus} className="flex flex-wrap gap-2">
            <input type="hidden" name="n" value={r.number} />
            {STATUSES.map((s) => (
              <button key={s} name="status" value={s} className={`rounded-full border px-3 py-1 text-xs ${r.status === s ? "border-fg bg-fg text-bg" : "border-line"}`}>{ui.track.status[s].fa}</button>
            ))}
          </form>
        </section>
      </aside>
    </div>
  );
}
