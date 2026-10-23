import Link from "next/link";
import type { CSSProperties } from "react";
import { commonCopy } from "@/content/copy/common";
import { formatPhone, latinDigits, num, type Lang } from "@/lib/format";
import { href } from "@/lib/i18n";
import type { ContactSettings } from "@/lib/settings-types";
import { ArchLines } from "@/components/fx/arch-lines";
import { Grain } from "@/components/fx/grain";
import { SplitWords } from "@/components/fx/split-words";
import { Icon } from "@/components/ui/icons";
import { MotionToggle } from "@/components/site/motion-toggle";
import { FooterProLinks } from "@/components/site/footer-pro";

const diamond = (className: string) => (
  <svg viewBox="0 0 10 10" className={className} aria-hidden>
    <path d="M5 0 10 5 5 10 0 5Z" fill="currentColor" />
  </svg>
);

/** The house's three promises before the night band: each under a small copper arch with its numeral. */
export function ServicesStrip({ lang }: { lang: Lang }) {
  const c = commonCopy(lang);
  return (
    <section className="relative isolate overflow-clip bg-mesh-bone">
      <span aria-hidden className="hairline absolute inset-x-0 top-0" />
      <ul className="container-lux grid gap-10 py-14 sm:grid-cols-3 sm:gap-0 sm:py-16">
        {c.services.map((s, i) => (
          <li key={s.title} className="flex items-start gap-5 sm:border-s sm:border-gold/20 sm:px-8 sm:first:border-s-0 sm:first:ps-0 lg:px-12" data-reveal style={{ "--d": i } as CSSProperties}>
            <span aria-hidden className="relative grid h-16 w-12 shrink-0 place-items-center">
              <span className="arch absolute inset-0 border border-gold/45 border-b-0" />
              <svg viewBox="0 0 10 10" className="absolute left-1/2 top-0 size-1.5 -translate-x-1/2 -translate-y-1/2 text-gold">
                <path d="M5 0 10 5 5 10 0 5Z" fill="currentColor" />
              </svg>
              <span className="display mt-3 text-2xl font-bold text-metal">{num(String(i + 1).padStart(2, "0"), lang)}</span>
            </span>
            <span>
              <span className="display block text-xl font-bold text-ink">{s.title}</span>
              <span className="mt-1.5 block text-sm leading-7 text-muted">{s.text}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The night band that closes every page: espresso mesh with a slow drifting light (CSS — no WebGL here, the
 * pages already have theirs), film grain and an arcade drawn behind the motto in living champagne metal,
 * then the link columns on one sill and the quiet bottom line with the motion switch.
 */
export function Footer({ lang, contact }: { lang: Lang; contact: ContactSettings }) {
  const c = commonCopy(lang);
  const year = new Intl.DateTimeFormat(lang === "fa" ? "fa-IR-u-ca-persian" : "en-GB", { year: "numeric", timeZone: "Asia/Tehran" }).format(new Date());
  const phone = latinDigits(contact.phone);
  const wa = contact.whatsapp ? `https://wa.me/98${latinDigits(contact.whatsapp).replace(/^0/, "")}` : "";
  const link = "text-on-night-muted transition-colors duration-300 hover:text-gold-glow";
  const head = (label: string) => (
    <p className="label mb-5 flex items-center gap-2.5 text-gold-on-dark!">
      {diamond("size-1.5 text-gold-glow")}
      {label}
    </p>
  );
  const hours = lang === "fa" ? contact.hours_fa : contact.hours_en || contact.hours_fa;
  return (
    <footer data-tone="light" className="relative isolate overflow-clip bg-night text-on-night">
      <span aria-hidden className="absolute inset-0 -z-10 bg-mesh-espresso" />
      <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden opacity-60">
        <span className="fx-aura-css" />
      </span>
      <Grain />

      <div className="container-lux relative pt-20 sm:pt-28">
        {/* the brand under its arcade */}
        <div className="relative mx-auto max-w-4xl pb-14 text-center sm:pb-20">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-12 bottom-0 sm:-top-16">
            <ArchLines count={6} tone="champagne" className="size-full opacity-80" />
          </div>
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/celin-logo-reverse.svg" alt={lang === "fa" ? "سلین — گالری اعتماد" : "CELIN — Etemad Gallery"} className="mx-auto h-20 w-auto sm:h-24" width={794} height={379} loading="lazy" />
            <p className="label mt-9 flex items-center justify-center gap-2.5 text-gold-on-dark!">
              {diamond("size-1.5 text-gold-glow")}
              {c.brand.since}
              {diamond("size-1.5 text-gold-glow")}
            </p>
            <SplitWords as="p" text={c.brand.line} className="display mt-4 text-[2.35rem] leading-[1.35]! font-bold sm:text-6xl lg:text-7xl" wordClassName="text-metal-light metal-live" />
            <p className="mx-auto mt-6 max-w-xl text-base leading-8 text-on-night-muted sm:text-lg sm:leading-9" data-reveal>
              {c.brand.about}
            </p>
          </div>
        </div>
        <span aria-hidden className="hairline-light block" />

        <div className="grid grid-cols-2 gap-x-8 gap-y-12 py-14 sm:py-16 lg:grid-cols-4">
          <nav aria-label={c.footer.house}>
            {head(c.footer.house)}
            <ul className="space-y-3 text-[0.9375rem]">
              <li><Link className={link} href={href(lang, "/shop")}>{c.nav.all}</Link></li>
              <li><Link className={link} href={href(lang, "/collections")}>{c.nav.collections}</Link></li>
              <li><Link className={link} href={href(lang, "/craft")}>{c.nav.craft}</Link></li>
              <li><Link className={link} href={href(lang, "/maison")}>{c.nav.maison}</Link></li>
            </ul>
          </nav>
          <nav aria-label={c.footer.service}>
            {head(c.footer.service)}
            <ul className="space-y-3 text-[0.9375rem]">
              <li><Link className={link} href={href(lang, "/contact")}>{c.nav.contact}</Link></li>
              <li><Link className={link} href={href(lang, "/care")}>{c.nav.care}</Link></li>
              <li><Link className={link} href={href(lang, "/account/orders")}>{c.footer.orderHelp}</Link></li>
            </ul>
          </nav>
          <nav aria-label={c.footer.pro}>
            {head(c.footer.pro)}
            <FooterProLinks lang={lang} className={link} />
          </nav>
          <div>
            {head(c.footer.follow)}
            <ul className="space-y-3 text-[0.9375rem]">
              {phone && (
                <li>
                  <a className={`${link} inline-flex items-center gap-2.5`} href={`tel:${phone.replace(/[^\d+]/g, "")}`}>
                    <Icon name="phone" className="size-4 text-gold-on-dark" />
                    <span className="ltr font-ui">{/^09\d{9}$/.test(phone) ? formatPhone(phone, lang) : num(phone, lang)}</span>
                  </a>
                </li>
              )}
              {wa && (
                <li>
                  <a className={`${link} inline-flex items-center gap-2.5`} href={wa} target="_blank" rel="noreferrer">
                    <Icon name="whatsapp" className="size-4 text-gold-on-dark" />
                    <span className="ltr font-ui">WhatsApp</span>
                  </a>
                </li>
              )}
              {contact.instagram && (
                <li>
                  <a className={`${link} inline-flex items-center gap-2.5`} href={`https://instagram.com/${contact.instagram}`} target="_blank" rel="noreferrer">
                    <Icon name="instagram" className="size-4 text-gold-on-dark" />
                    <span className="ltr font-ui">@{contact.instagram}</span>
                  </a>
                </li>
              )}
              {contact.telegram && (
                <li>
                  <a className={`${link} inline-flex items-center gap-2.5`} href={`https://t.me/${contact.telegram}`} target="_blank" rel="noreferrer">
                    <Icon name="telegram" className="size-4 text-gold-on-dark" />
                    <span className="ltr font-ui">@{contact.telegram}</span>
                  </a>
                </li>
              )}
            </ul>
            {hours && (
              <p className="mt-6 font-ui text-xs leading-6 text-on-night-muted">
                <span className="text-gold-on-dark">{c.footer.hours}</span>
                <br />
                {hours}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="relative border-t border-night-line">
        <div className="container-lux flex flex-wrap items-center justify-between gap-x-8 gap-y-3 py-6 font-ui text-xs text-on-night-muted">
          <span>
            © {year} — {c.footer.rights}
          </span>
          <span className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <MotionToggle labels={{ reduce: c.footer.reduceMotion, restore: c.footer.restoreMotion }} />
            <span className="font-label text-[10px] tracking-[0.32em] text-on-night-muted/70 ltr">{c.footer.handmade.toUpperCase()}</span>
          </span>
        </div>
      </div>
    </footer>
  );
}
