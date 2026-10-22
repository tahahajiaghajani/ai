import type { Copy } from "@/content/fa";
import { href, num, type Lang } from "@/lib/i18n";
import type { SiteContent } from "@/lib/settings-types";
import { Icon, type IconName } from "@/components/site/icons";

function Row({ icon, label, children }: { icon: IconName; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 border-b border-line py-5 last:border-0">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-line bg-ink-2 text-violet">
        <Icon name={icon} />
      </span>
      <div className="min-w-0">
        <div className="text-xs text-faint">{label}</div>
        <div className="mt-1 text-[15px] font-semibold">{children}</div>
      </div>
    </div>
  );
}

export function SupportContact({ lang, t, site }: { lang: Lang; t: Copy; site: SiteContent }) {
  const s = t.supportCta;
  const c = site.contact;
  return (
    <section id="contact" className="relative py-24 sm:py-32">
      <div className="mx-auto grid max-w-7xl gap-5 px-5 sm:px-8 lg:grid-cols-2">
        <div data-reveal className="card relative flex flex-col overflow-hidden p-8 sm:p-12">
          <div aria-hidden className="absolute -end-20 -top-20 size-72 rounded-full bg-violet/15 blur-3xl" />
          <span className="kicker">
            <Icon name="ticket" className="size-4" />
            {s.kicker}
          </span>
          <h2 className="display mt-5 text-[clamp(1.7rem,3vw,2.5rem)]">{s.title}</h2>
          <p className="mt-4 text-[15px] leading-8 text-muted">{s.lead}</p>
          <div className="mt-auto flex flex-wrap gap-3 pt-10">
            <a href={href(lang, "/support")} className="inline-flex h-12 items-center gap-2 rounded-full bg-magenta px-6 font-semibold text-white transition hover:bg-magenta-deep">
              {s.cta}
              <Icon name="arrow" className="size-4 rtl:-scale-x-100" />
            </a>
            <a href={`${href(lang, "/support")}?tab=track`} className="inline-flex h-12 items-center rounded-full border border-line-strong px-6 font-semibold transition hover:border-pink/60">
              {s.track}
            </a>
          </div>
        </div>
        <div data-reveal style={{ "--d": 1 } as React.CSSProperties} className="card p-8 sm:p-12">
          <span className="kicker">
            <span className="h-px w-8 bg-violet/60" />
            {t.contact.kicker}
          </span>
          <h2 className="display mt-5 text-[clamp(1.7rem,3vw,2.5rem)]">{t.contact.title}</h2>
          <div className="mt-6">
            <Row icon="phone" label={t.contact.phone}>
              <span className="flex flex-wrap gap-x-4">
                {c.phones.map((p) => (
                  <a key={p} href={`tel:${p.replace(/[^\d+]/g, "")}`} className="ltr hover:text-pink">
                    {num(p, lang)}
                  </a>
                ))}
              </span>
            </Row>
            <Row icon="mail" label={t.contact.email}>
              <a href={`mailto:${c.email}`} className="ltr hover:text-pink">
                {c.email}
              </a>
            </Row>
            <Row icon="pin" label={t.contact.address}>
              <span className="flex flex-wrap items-center gap-x-3">
                {lang === "fa" ? c.addressFa : c.addressEn}
                {c.mapUrl && (
                  <a href={c.mapUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-normal text-violet hover:text-pink">
                    {t.contact.map} ↗
                  </a>
                )}
              </span>
            </Row>
            {(lang === "fa" ? c.hoursFa : c.hoursEn) && (
              <Row icon="clock" label={t.contact.hours}>
                {lang === "fa" ? c.hoursFa : c.hoursEn}
              </Row>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
