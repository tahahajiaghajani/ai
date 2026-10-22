import type { ReactNode } from "react";
import type { CSSProperties } from "react";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { copy, formatDate, href, type Lang } from "@/lib/i18n";
import { STATUS_LABEL, type TicketStatus } from "@/lib/ticket-meta";
import { ticketPath } from "@/lib/tickets";
import { AuthForm, PasswordForm, ProfileForm, ResetPasswordForm, ResetRequestForm } from "@/components/account/auth-forms";
import { Icon } from "@/components/site/icons";
import { SignOutButton } from "@/components/account/sign-out-button";

function Shell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <section className="relative isolate min-h-[100svh] overflow-hidden pb-24 pt-[calc(var(--header-h)+3rem)]">
      <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-[480px] bg-[radial-gradient(60%_70%_at_50%_0%,rgb(143_134_255/0.16),transparent_70%)]" />
      <div className={`mx-auto px-5 sm:px-8 ${wide ? "max-w-5xl" : "max-w-6xl"}`}>{children}</div>
    </section>
  );
}

/** Only same-site paths survive the trip through the login page. */
function nextPath(v: string | string[] | undefined, lang: Lang): string {
  const s = typeof v === "string" ? v : "";
  return /^\/(?![/\\])[^\s]*$/.test(s) ? s : href(lang, "/account");
}

export async function LoginView({ lang, mode, next }: { lang: Lang; mode?: string | string[]; next?: string | string[] }) {
  const to = nextPath(next, lang);
  if (await currentUser()) redirect(to);
  return (
    <Shell>
      <AuthForm lang={lang} t={copy(lang).account} initialMode={mode === "signup" ? "signup" : "signin"} next={to} />
    </Shell>
  );
}

export function ResetView({ lang, token }: { lang: Lang; token?: string | string[] }) {
  const t = copy(lang).account;
  return <Shell>{typeof token === "string" && token ? <ResetPasswordForm lang={lang} t={t} token={token} /> : <ResetRequestForm lang={lang} t={t} />}</Shell>;
}

type TicketItem = { code: string; subject: string; status: TicketStatus; lang: "fa" | "en"; created_at: string; updated_at: string; access_enc: string | null };

export async function AccountView({ lang }: { lang: Lang }) {
  const me = await currentUser();
  if (!me) redirect(`${href(lang, "/account/login")}?next=${encodeURIComponent(href(lang, "/account"))}`);
  const t = copy(lang).account;
  const { data } = await db()!
    .from("pars_tickets")
    .select("code, subject, status, lang, created_at, updated_at, access_enc")
    .eq("user_id", me.id)
    .order("created_at", { ascending: false })
    .limit(50);
  const tickets = (data as TicketItem[] | null) ?? [];
  return (
    <Shell wide>
      <div className="hero-in mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <span style={{ "--d": 0 } as CSSProperties} className="kicker">
            {t.myAccount}
          </span>
          <h1 style={{ "--d": 1 } as CSSProperties} className="display mt-4 text-[clamp(1.6rem,3vw,2.2rem)]">
            {me.name || me.email}
          </h1>
        </div>
        <div style={{ "--d": 2 } as CSSProperties} className="flex flex-wrap gap-2">
          {me.role === "admin" && (
            <a href="/admin" className="inline-flex h-10 items-center gap-2 rounded-full border border-line-strong px-4 text-sm text-fg hover:border-violet/60">
              <Icon name="shield" className="size-4 text-violet" />
              {t.admin}
            </a>
          )}
          <SignOutButton to={href(lang, "/")} className="inline-flex h-10 items-center rounded-full px-4 text-sm text-muted hover:text-fg">
            {t.signOut}
          </SignOutButton>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <div className="card p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{t.ticketsTitle}</h2>
            <a href={href(lang, "/support")} className="inline-flex h-10 items-center gap-2 rounded-full bg-magenta px-4 text-sm font-semibold text-white hover:bg-magenta-deep">
              <Icon name="ticket" className="size-4" />
              {t.newTicket}
            </a>
          </div>
          {tickets.length === 0 ? (
            <p className="mt-6 text-sm text-muted">{t.noTickets}</p>
          ) : (
            <ul className="mt-6 space-y-2.5">
              {tickets.map((x) => {
                const key = decrypt(x.access_enc);
                return (
                  <li key={x.code}>
                    <a href={key ? ticketPath(x.code, key, lang) : href(lang, "/support")} className="flex items-center gap-4 rounded-2xl border border-line px-4 py-3 transition hover:border-pink/40">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] text-fg" dir="auto">
                          {x.subject}
                        </span>
                        <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-faint">
                          <span className="ltr font-brand text-pink">{x.code}</span>
                          <span>{formatDate(x.created_at, lang, false)}</span>
                        </span>
                      </span>
                      <span className="shrink-0 rounded-full bg-white/[0.06] px-2.5 py-1 text-xs text-muted">{STATUS_LABEL[x.status]?.[lang] ?? x.status}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="space-y-6">
          <div className="card p-6 sm:p-8">
            <h2 className="mb-5 text-lg font-semibold">{t.profileTitle}</h2>
            <ProfileForm lang={lang} t={t} initial={{ name: me.name, email: me.email, phone: me.phone, organization: me.organization }} />
          </div>
          <div className="card p-6 sm:p-8">
            <h2 className="mb-5 text-lg font-semibold">{t.passwordTitle}</h2>
            <PasswordForm lang={lang} t={t} />
          </div>
        </div>
      </div>
    </Shell>
  );
}
