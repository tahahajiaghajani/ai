import Link from "next/link";
import type { CSSProperties } from "react";
import { getSettings } from "@/lib/settings";
import { getSlots, type ResolvedSlot } from "@/lib/slots";
import { href, type Lang } from "@/lib/i18n";
import { contactCopy } from "@/content/copy/contact";
import { ArchLines } from "@/components/fx/arch-lines";
import { Magnetic } from "@/components/fx/magnetic";
import { Melt, Settle } from "@/components/fx/melt";
import { Icon, type IconName } from "@/components/ui/icons";
import { SectionHead } from "@/components/home/sections";
import { diamond } from "@/components/house/bits";
import { storeChannels } from "@/components/house/contact-links";
import { HouseHero } from "@/components/house/hero";
import { slotReader } from "@/components/house/slot-reader";

interface Row {
  key: string;
  icon: IconName;
  label: string;
  value: string;
  action: string;
  href: string;
  external?: boolean;
  latin?: boolean;
}

/**
 * /contact — the store's own ways in (Admin → Settings → Contact; an empty field renders nothing): espresso
 * hero with the two quickest (WhatsApp, a call), a concierge list of every channel, the hours and address in
 * an arch, and three common destinations.
 */
export async function ContactPage({ lang }: { lang: Lang }) {
  const [slots, settings] = await Promise.all([getSlots(), getSettings()]);
  const s = (key: string) => slots[key] as ResolvedSlot;
  const txt = slotReader(slots, lang);
  const c = contactCopy[lang];
  const ch = storeChannels(settings.contact, lang);

  const rows: Row[] = [
    ch.wa && { key: "wa", icon: "whatsapp", label: c.whatsapp.label, value: ch.waText, action: c.whatsapp.action, href: ch.wa, external: true, latin: true },
    ch.tel && { key: "tel", icon: "phone", label: c.phone.label, value: ch.phoneText, action: c.phone.action, href: ch.tel, latin: true },
    ch.instagram && { key: "ig", icon: "instagram", label: c.instagram.label, value: `@${ch.instagram}`, action: c.instagram.action, href: `https://instagram.com/${ch.instagram}`, external: true, latin: true },
    ch.telegram && { key: "tg", icon: "telegram", label: c.telegram.label, value: `@${ch.telegram}`, action: c.telegram.action, href: `https://t.me/${ch.telegram}`, external: true, latin: true },
    ch.email && { key: "mail", icon: "mail", label: c.email.label, value: ch.email, action: c.email.action, href: `mailto:${ch.email}`, latin: true },
  ].filter(Boolean) as Row[];

  const quick = (
    <>
      {ch.wa && (
        <Magnetic>
          <a href={ch.wa} target="_blank" rel="noreferrer" className="btn btn-metal h-13 px-8">
            <Icon name="whatsapp" className="size-4" />
            {c.whatsapp.action}
          </a>
        </Magnetic>
      )}
      {ch.tel && (
        <a href={ch.tel} className="btn btn-line-light h-13">
          <Icon name="phone" className="size-4" />
          {c.phone.action}
        </a>
      )}
    </>
  );

  return (
    <main>
      <HouseHero
        lang={lang}
        palette="espresso"
        flip
        sparkle={12}
        d={{ eyebrow: txt("contact.hero", "eyebrow"), title: txt("contact.hero", "title"), subtitle: txt("contact.hero", "subtitle"), media: s("contact.hero").media, mobile: s("contact.hero").mobile }}
        actions={ch.wa || ch.tel ? quick : undefined}
      />

      <section className="relative isolate overflow-clip bg-mesh-porcelain pt-[max(5rem,calc(var(--melt-h)*0.85))] pb-20 sm:py-28">
        {/* the hero's night melts into the porcelain; the porcelain settles into the plain ground above the bone band */}
        <Melt at="top" />
        <Settle at="bottom" />
        <div className="container-lux grid gap-14 lg:grid-cols-12 lg:gap-10">
          {rows.length > 0 && (
            <div className="lg:col-span-7">
              <SectionHead eyebrow={c.channels.eyebrow} title={c.channels.title} />
              <ul className="mt-10 border-t border-line">
                {rows.map((r, i) => (
                  <li key={r.key} className="border-b border-line" data-reveal style={{ "--d": i } as CSSProperties}>
                    <a
                      href={r.href}
                      {...(r.external ? { target: "_blank", rel: "noreferrer" } : {})}
                      className="group relative flex min-h-24 items-center gap-5 py-5 transition-colors duration-500 hover:bg-gold-mist/60 sm:gap-7 sm:px-4"
                    >
                      <span className="arch-full relative grid size-14 shrink-0 place-items-center border border-gold/30 bg-porcelain text-gold-text transition-colors duration-500 group-hover:border-gold group-hover:bg-gold-soft/60">
                        <Icon name={r.icon} className="size-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="label block text-muted!">{r.label}</span>
                        <span className="mt-1 block">
                          <span className={`inline-block max-w-full truncate align-top text-ink ${r.latin ? "ltr font-ui text-lg tabular-nums sm:text-xl" : "title-card"}`}>{r.value}</span>
                        </span>
                      </span>
                      <span className="hidden items-center gap-2 text-sm text-ink-2 sm:inline-flex">
                        {r.action}
                        <Icon name={r.external ? "external" : "arrow"} className={`size-4 transition-transform duration-500 ${r.external ? "" : "rtl:-scale-x-100 group-hover:translate-x-1 rtl:group-hover:-translate-x-1"}`} />
                      </span>
                      <Icon name="arrow" className="size-4 text-ink-2 sm:hidden rtl:-scale-x-100" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(ch.hours || ch.address) && (
            <aside className={rows.length > 0 ? "lg:col-span-4 lg:col-start-9" : "mx-auto w-full max-w-md lg:col-span-6 lg:col-start-4"}>
              <div className="frame-metal arch relative overflow-hidden bg-porcelain px-7 pt-24 pb-12 text-center [--frame:var(--metal-copper)] sm:px-10">
                <span aria-hidden className="arch absolute inset-0 bg-[radial-gradient(80%_50%_at_50%_0%,rgb(230_208_171/0.55),transparent_75%)]" />
                <ArchLines count={3} className="pointer-events-none absolute inset-x-0 bottom-0 mx-auto h-full w-[86%] opacity-50 [mask-image:linear-gradient(to_bottom,black_22%,transparent_38%)]" />
                <svg aria-hidden viewBox="0 0 10 10" className="absolute left-1/2 top-0 size-2.5 -translate-x-1/2 -translate-y-1/2 text-gold-bright">
                  <path d="M5 0 10 5 5 10 0 5Z" fill="currentColor" />
                </svg>
                <div className="relative space-y-10">
                  {ch.hours && (
                    <div>
                      <Icon name="clock" className="mx-auto size-6 text-gold-text" />
                      <p className="label mt-4 text-gold-text!">{c.hours}</p>
                      <p className="title-card mt-3 text-ink">{ch.hours}</p>
                    </div>
                  )}
                  {ch.hours && ch.address && <span aria-hidden className="mx-auto block h-px w-12 bg-gold/40" />}
                  {ch.address && (
                    <div>
                      <Icon name="map" className="mx-auto size-6 text-gold-text" />
                      <p className="label mt-4 text-gold-text!">{c.address}</p>
                      <p className="lede mt-3 text-ink">{ch.address}</p>
                      {ch.map && (
                        <a href={ch.map} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 text-sm text-gold-text underline-offset-8 hover:underline">
                          {c.map}
                          <Icon name="external" className="size-4" />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </aside>
          )}
        </div>
      </section>

      {/* where people usually go next */}
      <section className="relative isolate bg-mesh-bone py-20 sm:py-24">
        <Settle at="top" />
        <div className="container-lux">
          <SectionHead eyebrow={c.help.eyebrow} title={c.help.title} />
          <ul className="mt-12 grid gap-px border-y border-line bg-line sm:grid-cols-3">
            {c.help.items.map((it, i) => (
              <li key={it.path} className="bg-bone">
                {/* the cell's ground stays opaque (the list's rules are its gaps); only the content reveals */}
                <Link href={href(lang, it.path)} className="group flex h-full flex-col gap-3 px-1 py-8 transition-colors duration-500 hover:bg-porcelain sm:px-8" data-reveal style={{ "--d": i } as CSSProperties}>
                  {diamond("size-2 text-gold")}
                  <span className="title-card mt-2 text-ink">{it.title}</span>
                  <span className="text-sm leading-7 text-muted">{it.text}</span>
                  <Icon name="arrow" className="mt-2 size-4 text-ink transition-transform duration-500 group-hover:translate-x-1 rtl:-scale-x-100 rtl:group-hover:-translate-x-1" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
