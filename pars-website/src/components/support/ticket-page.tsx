import { notFound } from "next/navigation";
import { copy, formatDate, href, type Lang } from "@/lib/i18n";
import { canAccess, getTicket, listMessages } from "@/lib/tickets";
import { CATEGORY_LABEL, PRODUCT_LABEL, STATUS_LABEL } from "@/lib/ticket-meta";
import { Markdown } from "@/components/chat/markdown";
import { TicketActions } from "@/components/support/ticket-thread";
import { Icon } from "@/components/site/icons";
import { STATUS_STYLE } from "@/components/support/status-style";


function Bubble({ who, team, at, children }: { who: "customer" | "staff"; team: string; at: string; children: React.ReactNode }) {
  const staff = who === "staff";
  return (
    <li className={`flex gap-3 ${staff ? "" : "flex-row-reverse"}`}>
      <span className={`grid size-9 shrink-0 place-items-center rounded-xl border ${staff ? "border-pink/30 bg-ink-3" : "border-line bg-ink-4"}`}>
        {staff ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/brand/pars-mark-reverse.svg" alt="" className="h-5 w-auto" />
        ) : (
          <Icon name="human" className="size-4.5 text-muted" />
        )}
      </span>
      <div className={`max-w-[85%] rounded-3xl px-5 py-4 ${staff ? "rounded-ss-md border border-pink/20 bg-pink/[0.05]" : "rounded-se-md bg-ink-4"}`}>
        <div className="mb-1.5 flex items-center gap-2 text-xs text-faint">
          <span className={staff ? "font-semibold text-pink" : "font-semibold text-fg/80"}>{team}</span>
          <span>·</span>
          <span>{at}</span>
        </div>
        <div className="text-[15px] text-fg/95">{children}</div>
      </div>
    </li>
  );
}

export async function TicketPage({ lang, code, k }: { lang: Lang; code: string; k: string }) {
  const t = copy(lang);
  const ticket = await getTicket(code.toUpperCase());
  if (!ticket || !canAccess(ticket, k)) notFound();
  const messages = await listMessages(ticket.id, false);
  const L = (x: { fa: string; en: string }) => x[lang];
  return (
    <section className="relative isolate min-h-[100svh] pb-24 pt-[calc(var(--header-h)+3rem)]">
      <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(60%_70%_at_50%_0%,rgb(223_17_115/0.14),transparent_70%)]" />
      <div className="mx-auto max-w-3xl px-5 sm:px-8">
        <a href={href(lang, "/support")} className="inline-flex items-center gap-2 text-sm text-muted hover:text-fg">
          <Icon name="arrow" className="size-4 -scale-x-100 rtl:scale-x-100" />
          {t.ticket.back}
        </a>
        <header className="card mt-5 p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="ltr font-brand text-sm font-bold tracking-wider text-gradient">{ticket.code}</span>
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${STATUS_STYLE[ticket.status]}`}>{L(STATUS_LABEL[ticket.status])}</span>
          </div>
          <h1 className="mt-4 text-2xl font-extrabold leading-10" dir="auto">
            {ticket.subject}
          </h1>
          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
            <div>{L(CATEGORY_LABEL[ticket.category])}</div>
            <div>{L(PRODUCT_LABEL[ticket.product])}</div>
            <div>
              {t.ticket.created}: {formatDate(ticket.created_at, lang)}
            </div>
          </dl>
        </header>

        <ol className="mt-8 space-y-5">
          <Bubble who="customer" team={ticket.name} at={formatDate(ticket.created_at, lang)}>
            <p className="whitespace-pre-wrap leading-8" dir="auto">
              {ticket.body}
            </p>
          </Bubble>
          {messages.map((m) => (
            <Bubble key={m.id} who={m.author === "staff" ? "staff" : "customer"} team={m.author === "staff" ? t.ticket.team : ticket.name} at={formatDate(m.created_at, lang)}>
              {m.author === "staff" ? (
                <Markdown text={m.body} />
              ) : (
                <p className="whitespace-pre-wrap leading-8" dir="auto">
                  {m.body}
                </p>
              )}
            </Bubble>
          ))}
        </ol>

        <div className="mt-8">
          <TicketActions lang={lang} t={t.ticket} code={ticket.code} k={k} status={ticket.status} rating={ticket.rating} />
        </div>
      </div>
    </section>
  );
}
