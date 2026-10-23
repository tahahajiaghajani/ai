import Link from "next/link";
import { commonCopy } from "@/content/copy/common";
import { formatPhone, latinDigits, num, type Lang } from "@/lib/format";
import { href } from "@/lib/i18n";
import type { ContactSettings } from "@/lib/settings-types";
import { Icon } from "@/components/ui/icons";
import { MotionToggle } from "@/components/site/motion-toggle";
import { FooterProLinks } from "@/components/site/footer-pro";

export function ServicesStrip({ lang }: { lang: Lang }) {
  const c = commonCopy(lang);
  return (
    <section className="border-t border-line bg-bone">
      <ul className="container-lux grid gap-8 py-12 sm:grid-cols-3 sm:gap-10">
        {c.services.map((s, i) => (
          <li key={s.title} className="flex items-start gap-4">
            <span className="mt-1.5 font-label text-xs text-gold-text tabular-nums ltr">{`0${i + 1}`}</span>
            <span>
              <span className="block text-base text-ink">{s.title}</span>
              <span className="mt-1 block text-sm leading-7 text-muted">{s.text}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Footer({ lang, contact }: { lang: Lang; contact: ContactSettings }) {
  const c = commonCopy(lang);
  const year = new Intl.DateTimeFormat(lang === "fa" ? "fa-IR-u-ca-persian" : "en-GB", { year: "numeric", timeZone: "Asia/Tehran" }).format(new Date());
  const phone = latinDigits(contact.phone);
  const wa = contact.whatsapp ? `https://wa.me/98${latinDigits(contact.whatsapp).replace(/^0/, "")}` : "";
  const link = "text-on-night-muted transition-colors hover:text-on-night";
  return (
    <footer className="bg-night text-on-night">
      <div className="container-lux grid gap-12 py-16 md:grid-cols-[1.3fr_1fr_1fr_1fr] md:py-20">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/celin-logo-reverse.svg" alt={lang === "fa" ? "سلین — گالری اعتماد" : "CELIN — Etemad Gallery"} className="h-24 w-auto" width={794} height={379} />
          <p className="mt-6 max-w-xs text-sm leading-7 text-on-night-muted">{c.brand.about}</p>
        </div>
        <nav aria-label={c.footer.house}>
          <p className="mb-4 text-xs text-gold-on-dark">{c.footer.house}</p>
          <ul className="space-y-2.5 text-sm">
            <li><Link className={link} href={href(lang, "/shop")}>{c.nav.all}</Link></li>
            <li><Link className={link} href={href(lang, "/collections")}>{c.nav.collections}</Link></li>
            <li><Link className={link} href={href(lang, "/craft")}>{c.nav.craft}</Link></li>
            <li><Link className={link} href={href(lang, "/maison")}>{c.nav.maison}</Link></li>
          </ul>
        </nav>
        <nav aria-label={c.footer.service}>
          <p className="mb-4 text-xs text-gold-on-dark">{c.footer.service}</p>
          <ul className="space-y-2.5 text-sm">
            <li><Link className={link} href={href(lang, "/contact")}>{c.nav.contact}</Link></li>
            <li><Link className={link} href={href(lang, "/care")}>{c.nav.care}</Link></li>
            <li><Link className={link} href={href(lang, "/account/orders")}>{c.footer.orderHelp}</Link></li>
          </ul>
          <p className="mb-4 mt-8 text-xs text-gold-on-dark">{c.footer.pro}</p>
          <FooterProLinks lang={lang} className={link} />
        </nav>
        <div>
          <p className="mb-4 text-xs text-gold-on-dark">{c.footer.follow}</p>
          <ul className="space-y-2.5 text-sm">
            {phone && (
              <li>
                <a className={`${link} inline-flex items-center gap-2`} href={`tel:${phone.replace(/[^\d+]/g, "")}`}>
                  <Icon name="phone" className="size-4" />
                  <span className="ltr">{/^09\d{9}$/.test(phone) ? formatPhone(phone, lang) : num(phone, lang)}</span>
                </a>
              </li>
            )}
            {wa && (
              <li>
                <a className={`${link} inline-flex items-center gap-2`} href={wa} target="_blank" rel="noreferrer">
                  <Icon name="whatsapp" className="size-4" />
                  WhatsApp
                </a>
              </li>
            )}
            {contact.instagram && (
              <li>
                <a className={`${link} inline-flex items-center gap-2`} href={`https://instagram.com/${contact.instagram}`} target="_blank" rel="noreferrer">
                  <Icon name="instagram" className="size-4" />
                  <span className="ltr">@{contact.instagram}</span>
                </a>
              </li>
            )}
            {contact.telegram && (
              <li>
                <a className={`${link} inline-flex items-center gap-2`} href={`https://t.me/${contact.telegram}`} target="_blank" rel="noreferrer">
                  <Icon name="telegram" className="size-4" />
                  <span className="ltr">@{contact.telegram}</span>
                </a>
              </li>
            )}
          </ul>
          {(lang === "fa" ? contact.hours_fa : contact.hours_en || contact.hours_fa) && (
            <p className="mt-6 text-xs leading-6 text-on-night-muted">
              {c.footer.hours}: {lang === "fa" ? contact.hours_fa : contact.hours_en || contact.hours_fa}
            </p>
          )}
        </div>
      </div>
      <div className="border-t border-night-line">
        <div className="container-lux flex flex-wrap items-center justify-between gap-x-8 gap-y-3 py-6 text-xs text-on-night-muted">
          <span>
            © {year} — {c.footer.rights}
          </span>
          <span className="flex items-center gap-6">
            <MotionToggle labels={{ reduce: c.footer.reduceMotion, restore: c.footer.restoreMotion }} />
            <span className="font-label tracking-[0.3em] text-on-night-muted/70 ltr">{c.footer.handmade.toUpperCase()}</span>
          </span>
        </div>
      </div>
    </footer>
  );
}
