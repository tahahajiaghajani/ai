import Link from "next/link";
import type { Copy } from "@/content/fa";
import { href, type Lang } from "@/lib/i18n";
import { LogoLockup } from "@/components/brand/logo";
import { AccountButton, AccountMenuLink } from "@/components/account/account-button";
import { DemosButton } from "@/components/site/demo-sheet";
import { HeaderShell, MobileMenu } from "@/components/site/header-client";
import { Icon } from "@/components/site/icons";
import { LangLink } from "@/components/site/lang-link";

export function Header({ lang, t }: { lang: Lang; t: Copy }) {
  const home = href(lang, "/");
  const links = [
    { href: `${home}#about`, label: t.nav.about },
    { href: `${home}#services`, label: t.nav.services },
    { href: `${home}#ai`, label: t.nav.ai },
    { href: `${home}#work`, label: t.nav.work },
    { href: href(lang, "/blog"), label: t.nav.blog },
    { href: href(lang, "/support"), label: t.nav.support },
  ];
  const other: Lang = lang === "fa" ? "en" : "fa";
  return (
    <HeaderShell>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-3 focus:z-50 focus:rounded-full focus:bg-magenta focus:px-4 focus:py-2 focus:text-white">
        {t.nav.skip}
      </a>
      <div className="mx-auto flex h-[var(--header-h)] max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link href={home} aria-label={t.meta.short} className="shrink-0">
          <LogoLockup />
        </Link>
        <nav className="hidden items-center gap-1 lg:flex" aria-label={t.nav.main}>
          {links.map((l) => (
            <a key={l.href} href={l.href} className="whitespace-nowrap rounded-full px-2.5 py-2 text-[14px] text-muted transition hover:bg-white/5 hover:text-fg xl:px-3.5 xl:text-[15px]">
              {l.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <LangLink to={other} className="hidden h-10 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm text-muted transition hover:text-fg sm:inline-flex" title={t.nav.langLabel}>
            <Icon name="globe" className="size-4" />
            <span className={other === "en" ? "font-brand" : ""}>{t.nav.langShort}</span>
          </LangLink>
          <AccountButton lang={lang} t={t.account} />
          <DemosButton className="hidden h-10 items-center gap-2 whitespace-nowrap rounded-full border border-line-strong bg-white/[0.03] px-4 text-sm font-semibold text-fg transition hover:border-pink/60 sm:inline-flex">
            <Icon name="play" className="size-3.5 text-pink" />
            {t.nav.demos}
          </DemosButton>
          <MobileMenu
            label={t.nav.menu}
            closeLabel={t.nav.close}
            links={[...links, { href: `${home}#contact`, label: t.nav.contact }]}
            footer={
              <div className="flex flex-col gap-3">
                <DemosButton className="flex h-12 items-center justify-center gap-2 rounded-full bg-magenta font-semibold text-white">
                  <Icon name="play" className="size-4" />
                  {t.nav.demos}
                </DemosButton>
                <AccountMenuLink lang={lang} t={t.account} className="flex h-12 items-center justify-center gap-2 rounded-full border border-line-strong" />
                <LangLink to={other} className="flex h-12 items-center justify-center gap-2 rounded-full border border-line-strong">
                  <Icon name="globe" className="size-4" />
                  {t.nav.langLabel}
                </LangLink>
              </div>
            }
          />
        </div>
      </div>
    </HeaderShell>
  );
}
