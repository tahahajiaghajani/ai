import type { Copy } from "@/content/fa";
import { href, num, type Lang } from "@/lib/i18n";
import type { SiteContent } from "@/lib/settings-types";
import { DemosButton } from "@/components/site/demo-sheet";
import { Icon, type IconName } from "@/components/site/icons";
import { MotionToggle } from "@/components/site/motion-toggle";

export function Footer({ lang, t, site }: { lang: Lang; t: Copy; site: SiteContent }) {
  const home = href(lang, "/");
  const year = new Intl.DateTimeFormat(lang === "fa" ? "fa-IR-u-ca-persian" : "en", { year: "numeric", timeZone: "Asia/Tehran" }).format(new Date());
  const social = (
    [
      ["linkedin", site.social.linkedin, "LinkedIn"],
      ["telegram", site.social.telegram, "Telegram"],
      ["instagram", site.social.instagram, "Instagram"],
    ] as [IconName, string, string][]
  ).filter(([, url]) => url);
  return (
    <footer className="relative overflow-hidden border-t border-line">
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-72 bg-[radial-gradient(60%_80%_at_50%_100%,rgb(223_17_115/0.16),transparent_70%)]" />
      <div className="relative mx-auto max-w-7xl px-5 pt-16 sm:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/pars-mark-reverse.svg" alt="" width={44} height={46} className="h-11 w-auto" />
            <p className="mt-5 max-w-sm text-lg font-bold leading-8">{t.footer.tagline}</p>
            <p className="mt-2 text-sm text-muted">{t.footer.company}</p>
            {social.length > 0 && (
              <div className="mt-5 flex gap-2">
                {social.map(([icon, url, label]) => (
                  <a key={icon} href={url} target="_blank" rel="noopener noreferrer" aria-label={label} className="grid size-10 place-items-center rounded-full border border-line text-muted transition hover:border-pink/50 hover:text-fg">
                    <Icon name={icon} className="size-4.5" />
                  </a>
                ))}
              </div>
            )}
          </div>
          <div>
            <h2 className="text-sm font-semibold text-faint">{t.footer.explore}</h2>
            <ul className="mt-4 space-y-2.5 text-[15px]">
              <li><a className="text-muted hover:text-fg" href={`${home}#services`}>{t.nav.services}</a></li>
              <li><a className="text-muted hover:text-fg" href={`${home}#ai`}>{t.nav.ai}</a></li>
              <li><a className="text-muted hover:text-fg" href={`${home}#work`}>{t.nav.work}</a></li>
              <li><a className="text-muted hover:text-fg" href={`${home}#ceo`}>{t.nav.ceo}</a></li>
              <li><DemosButton className="text-muted hover:text-fg">{t.nav.demos}</DemosButton></li>
            </ul>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-faint">{t.footer.help}</h2>
            <ul className="mt-4 space-y-2.5 text-[15px]">
              <li><a className="text-muted hover:text-fg" href={href(lang, "/support")}>{t.supportCta.cta}</a></li>
              <li><a className="text-muted hover:text-fg" href={`${href(lang, "/support")}?tab=track`}>{t.supportCta.track}</a></li>
              {site.contact.phones.map((p) => (
                <li key={p}><a className="ltr inline-block text-muted hover:text-fg" href={`tel:${p.replace(/[^\d+]/g, "")}`}>{num(p, lang)}</a></li>
              ))}
              <li><a className="ltr inline-block text-muted hover:text-fg" href={`mailto:${site.contact.email}`}>{site.contact.email}</a></li>
            </ul>
          </div>
        </div>
        <div className="mt-14 flex flex-col-reverse items-start justify-between gap-4 border-t border-line py-6 text-sm text-faint sm:flex-row sm:items-center">
          <p>© {year} {t.footer.company} — {t.footer.rights}</p>
          <MotionToggle reduceLabel={t.footer.motion} fullLabel={t.footer.motionOn} />
        </div>
      </div>
      <div aria-hidden className="relative mx-auto max-w-7xl px-5 pb-6 sm:px-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/pars-wordmark-white.svg" alt="" width={1008} height={99} loading="lazy" className="w-full opacity-[0.07]" />
      </div>
    </footer>
  );
}
