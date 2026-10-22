import Link from "next/link";
import { notFound } from "next/navigation";
import { accessKeyOf, getTicket, listMessages, ticketLink } from "@/lib/tickets";
import { formatDate } from "@/lib/i18n";
import { CATEGORY_LABEL, PRODUCT_LABEL, SLA_HOURS } from "@/lib/ticket-meta";
import { Markdown } from "@/components/chat/markdown";
import { Panel } from "@/components/admin/ui";
import { TicketControls, TicketReply } from "@/components/admin/ticket-admin";

export default async function TicketAdmin({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const t = await getTicket(decodeURIComponent(code));
  if (!t) notFound();
  const messages = await listMessages(t.id, true);
  const key = accessKeyOf(t);
  const triage = (t.ai_triage ?? {}) as { tags?: string[]; confidence?: number; needs_human?: boolean; model?: string };
  return (
    <>
      <Link href="/admin/tickets" className="text-sm text-muted hover:text-fg">
        → تیکت‌ها
      </Link>
      <div className="mt-4 grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          <Panel>
            <div className="flex flex-wrap items-center gap-3">
              <span className="ltr font-brand text-sm font-bold text-gradient">{t.code}</span>
              <span className="text-xs text-faint">{formatDate(t.created_at, "fa")}</span>
              <span className="text-xs text-faint">· {t.lang === "en" ? "English" : "فارسی"}</span>
            </div>
            <h1 className="mt-3 text-xl font-extrabold leading-9" dir="auto">
              {t.subject}
            </h1>
            <p className="mt-4 whitespace-pre-wrap rounded-2xl bg-ink-4/70 p-4 text-[15px] leading-8" dir="auto">
              {t.body}
            </p>
          </Panel>

          {(t.ai_summary || t.ai_reply) && (
            <Panel title="تحلیل هوش مصنوعی" sub={triage.model ? `مدل: ${triage.model}` : undefined}>
              {t.ai_summary && <p className="text-[15px] leading-8">{t.ai_summary}</p>}
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {t.sentiment && <span className="rounded-full bg-white/5 px-2.5 py-1">لحن: {{ positive: "مثبت", neutral: "خنثی", negative: "ناراضی", angry: "عصبانی" }[t.sentiment] ?? t.sentiment}</span>}
                {typeof triage.confidence === "number" && <span className="rounded-full bg-white/5 px-2.5 py-1">اطمینان: {Math.round(triage.confidence * 100)}٪</span>}
                {triage.needs_human && <span className="rounded-full bg-warning/15 px-2.5 py-1 text-warning">نیاز به کارشناس</span>}
                {triage.tags?.map((x) => (
                  <span key={x} className="rounded-full border border-line px-2.5 py-1 text-muted">
                    {x}
                  </span>
                ))}
              </div>
            </Panel>
          )}

          <Panel title="گفتگو">
            {messages.length === 0 ? (
              <p className="text-sm text-muted">هنوز پاسخی ثبت نشده است.</p>
            ) : (
              <ol className="space-y-4">
                {messages.map((m) => (
                  <li key={m.id} className={`rounded-2xl p-4 ${m.internal ? "border border-dashed border-warning/40 bg-warning/[0.05]" : m.author === "staff" ? "border border-pink/20 bg-pink/[0.05]" : "bg-ink-4/70"}`}>
                    <div className="mb-2 flex items-center gap-2 text-xs text-faint">
                      <span className="font-semibold text-fg/80">{m.internal ? "یادداشت داخلی" : m.author === "staff" ? "تیم پشتیبانی" : t.name}</span>
                      <span>·</span>
                      <span>{formatDate(m.created_at, "fa")}</span>
                    </div>
                    {m.author === "staff" ? <Markdown text={m.body} /> : <p className="whitespace-pre-wrap leading-8" dir="auto">{m.body}</p>}
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <TicketReply code={t.code} draft={t.ai_reply ?? ""} closed={t.status === "closed"} />
        </div>

        <div className="space-y-6">
          <TicketControls code={t.code} status={t.status} priority={t.priority} category={t.category} link={key ? ticketLink(t.code, key, t.lang) : ""} />
          <Panel title="مشتری">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-faint">نام</dt>
                <dd>{t.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-faint">ایمیل</dt>
                <dd>
                  <a className="ltr text-violet hover:text-pink" href={`mailto:${t.email}`}>
                    {t.email}
                  </a>
                </dd>
              </div>
              {t.phone && (
                <div>
                  <dt className="text-xs text-faint">تلفن</dt>
                  <dd>
                    <a className="ltr text-violet hover:text-pink" href={`tel:${t.phone}`}>
                      {t.phone}
                    </a>
                  </dd>
                </div>
              )}
              {t.organization && (
                <div>
                  <dt className="text-xs text-faint">سازمان</dt>
                  <dd>{t.organization}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-faint">محصول / نوع</dt>
                <dd>
                  {PRODUCT_LABEL[t.product].fa} · {CATEGORY_LABEL[t.category].fa}
                </dd>
              </div>
              {t.source && (
                <div>
                  <dt className="text-xs text-faint">آشنایی از طریق</dt>
                  <dd>{t.source}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-faint">مهلت اولین پاسخ ({SLA_HOURS[t.priority]} ساعت)</dt>
                <dd>{t.first_response_at ? `پاسخ داده شد: ${formatDate(t.first_response_at, "fa")}` : t.due_at ? formatDate(t.due_at, "fa") : "—"}</dd>
              </div>
              {t.rating && (
                <div>
                  <dt className="text-xs text-faint">امتیاز مشتری</dt>
                  <dd className="text-warning">
                    {"★".repeat(t.rating)}
                    <span className="text-white/15">{"★".repeat(5 - t.rating)}</span>
                    {t.rating_note && <span className="mt-1 block text-fg/80">{t.rating_note}</span>}
                  </dd>
                </div>
              )}
            </dl>
          </Panel>
        </div>
      </div>
    </>
  );
}
