import { headers } from "next/headers";
import type { Lang } from "@/lib/i18n";
import { formatDate, href, num } from "@/lib/i18n";
import { ui } from "@/content/ui";
import { getRequestByKey, listMessages, visitorTriage } from "@/lib/requests";
import { normalizeCode, STATUSES, type RequestStatus } from "@/lib/request-meta";
import { ghConfigured } from "@/lib/github";
import { clientIp, hashIp, hasSecret } from "@/lib/crypto";
import { allow } from "@/lib/rate-limit";
import { Prose } from "@/components/work/prose";
import { ReplyForm } from "@/components/request/reply-form";

/** The visitor's view of one request: status, the AI's reading, the conversation, and a reply box. */
export async function Tracking({ lang, code, k }: { lang: Lang; code: string; k?: string }) {
  const fa = lang === "fa";
  const c = normalizeCode(code);
  const shell = (children: React.ReactNode) => (
    <section className="mx-auto max-w-[1100px] px-5 pb-32 pt-36 md:px-10 md:pt-44">
      <p className="eyebrow eyebrow-fa">{ui.track.title[lang]}</p>
      {children}
    </section>
  );
  if (!ghConfigured() || !hasSecret()) return shell(<p className="mt-8 text-lg text-fg-2">{ui.request.offline[lang]}</p>);
  // every view reads GitHub, so views are limited per visitor
  if (!(await allow(`track:${hashIp(clientIp(await headers()))}`, 600, 40))) return shell(<p className="mt-8 text-lg text-fg-2">{ui.request.rate[lang]}</p>);
  const r = await getRequestByKey(c, k).catch(() => null);
  if (!r) return shell(<p className="mt-8 text-lg text-fg-2">{ui.track.denied[lang]}</p>);
  // private notes written on GitHub never reach the visitor
  const msgs = (await listMessages(r.number).catch(() => [])).filter((m) => m.author !== "note");
  const triage = visitorTriage(r);
  // steps fill up to the current status, but a closed request only shows what really happened on the way
  const step = STATUSES.indexOf(r.status);
  const done = (s: RequestStatus, i: number) =>
    s === "scheduled" ? r.status === "scheduled" : s === "answered" && r.status === "closed" ? Boolean(r.last_owner_at) : i <= step;

  return shell(
    <>
      <h1 className="latin mt-4 text-[clamp(3rem,8vw,6rem)] font-semibold leading-none tracking-[-0.045em]" dir="ltr">{r.code}</h1>
      <p className="mt-4 text-lg text-fg-2">{r.subject}</p>
      <ol className="mt-12 grid grid-cols-5 gap-px border border-line bg-line text-center text-[0.72rem]">
        {STATUSES.map((s, i) => (
          <li key={s} className={`px-2 py-4 ${done(s, i) ? "bg-fg text-bg" : "bg-bg text-muted"}`}>
            <span className="block font-mono text-[0.6rem] opacity-60">{num(lang, `0${i + 1}`)}</span>
            {ui.track.status[s][lang]}
          </li>
        ))}
      </ol>
      {triage ? (
        <div className="mt-12 rounded-[8px] border border-line p-6">
          <p className="eyebrow eyebrow-fa mb-3">{ui.request.aiRead[lang]}</p>
          <p className="leading-relaxed">{triage.summary}</p>
        </div>
      ) : null}
      <div className="mt-12 grid gap-6">
        <article className="rounded-[8px] border border-line p-6">
          <header className="mb-3 flex justify-between text-[0.75rem] text-muted">
            <span>{ui.track.you[lang]} · {r.name}</span>
            <time dateTime={r.created_at}>{formatDate(r.created_at, lang)}</time>
          </header>
          <p className="whitespace-pre-wrap leading-relaxed text-fg-2">{r.body}</p>
        </article>
        {msgs.map((m) => (
          <article key={m.id} className={`rounded-[8px] border p-6 ${m.author === "owner" ? "border-fg bg-fg text-bg" : "border-line"}`}>
            <header className="mb-3 flex justify-between text-[0.75rem] opacity-70">
              <span>{m.author === "owner" ? ui.track.taha[lang] : ui.track.you[lang]}</span>
              <time dateTime={m.created_at}>{formatDate(m.created_at, lang)}</time>
            </header>
            <div className={m.author === "owner" ? "[&_*]:!text-bg" : ""}>
              <Prose text={m.body} />
            </div>
          </article>
        ))}
      </div>
      {r.status !== "closed" ? <ReplyForm lang={lang} code={r.code} k={k ?? ""} /> : null}
      <p className="mt-16 text-sm text-muted">
        <a href={href(lang, "/")} className="link-draw">{fa ? "بازگشت به سایت" : "Back to the site"}</a>
      </p>
    </>,
  );
}
