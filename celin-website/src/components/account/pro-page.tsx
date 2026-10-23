import { accountCopy } from "@/content/copy/account";
import { num, type Lang } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { getSlots, slotText } from "@/lib/slots";
import { Icon } from "@/components/ui/icons";
import { Picture } from "@/components/ui/picture";
import { Membership } from "@/components/account/membership";
import { HaveCodeButton } from "@/components/account/have-code";
import { btn } from "@/components/account/ui";

/** /pro — static and identical for everyone; only the request block (#request) reads the visitor's session. */
export async function ProPage({ lang }: { lang: Lang }) {
  const c = accountCopy(lang).proPage;
  const [slots, settings] = await Promise.all([getSlots(), getSettings()]);
  const hero = slots["pro.hero"];
  const faq = [...c.faq, { q: c.minQ, a: settings.shop.minOrder > 0 ? c.minYes : c.minNo }];
  return (
    <main>
      <section className="container-lux grid items-center gap-10 pt-8 pb-18 sm:pt-12 lg:grid-cols-12 lg:gap-16 lg:pt-16 lg:pb-28">
        <div className="lg:col-span-5 xl:col-span-4 xl:col-start-2">
          <p className="font-label text-xs tracking-[0.18em] text-gold-text ltr">PRO</p>
          <h1 className="display mt-4 text-4xl sm:text-5xl">{slotText(hero, "title", lang)}</h1>
          <p className="mt-5 max-w-md text-base leading-8 text-ink-2">{slotText(hero, "subtitle", lang)}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a href="#request" className={btn.primary}>
              {c.requestCta}
            </a>
            <HaveCodeButton label={c.haveCode} className={btn.outline} />
          </div>
        </div>
        {hero && (
          <div className="lg:col-span-6 lg:col-start-7">
            <Picture media={hero.media} mobile={hero.mobile} lang={lang} ratio="3/4" priority sizes="(min-width: 1440px) 640px, (min-width: 1024px) 48vw, 100vw" className="mx-auto max-w-[640px]" />
          </div>
        )}
      </section>

      <section aria-labelledby="pro-benefits" className="border-t border-line bg-bone">
        <div className="container-lux py-18 lg:py-24">
          <h2 id="pro-benefits" className="display text-3xl sm:text-4xl">
            {c.benefitsTitle}
          </h2>
          <ul className="mt-10 grid gap-10 sm:grid-cols-3 sm:gap-12">
            {c.benefits.map((b) => (
              <li key={b.title}>
                <span className="block h-px w-10 bg-gold/60" aria-hidden />
                <p className="mt-5 text-md text-ink">{b.title}</p>
                <p className="mt-2 text-sm leading-7 text-muted">{b.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="pro-steps" className="container-lux py-18 lg:py-24">
        <h2 id="pro-steps" className="display text-3xl sm:text-4xl">
          {c.stepsTitle}
        </h2>
        <ol className="mt-10 grid gap-px border-y border-line bg-line sm:grid-cols-3">
          {c.steps.map((s, i) => (
            <li key={s.title} className="bg-ground py-7 sm:px-8 sm:first:ps-0">
              <span className="display block text-3xl text-gold tabular-nums">{num(i + 1, lang)}</span>
              <p className="mt-4 text-md text-ink">{s.title}</p>
              <p className="mt-2 max-w-xs text-sm leading-7 text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="request" aria-labelledby="pro-request" className="container-lux scroll-mt-24 pb-18 lg:pb-24">
        <div className="grid gap-8 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-4">
            <h2 id="pro-request" className="display text-3xl sm:text-4xl">
              {c.requestTitle}
            </h2>
            <span className="mt-6 block h-px w-10 bg-gold/60" aria-hidden />
          </div>
          <div className="lg:col-span-8 xl:col-span-7">
            <Membership lang={lang} variant="page" />
          </div>
        </div>
      </section>

      <section aria-labelledby="pro-faq" className="border-t border-line">
        <div className="container-lux grid gap-8 py-18 lg:grid-cols-12 lg:gap-16 lg:py-24">
          <h2 id="pro-faq" className="display text-3xl sm:text-4xl lg:col-span-4">
            {c.faqTitle}
          </h2>
          <div className="divide-y divide-line border-y border-line lg:col-span-8 xl:col-span-7">
            {faq.map((f) => (
              <details key={f.q} className="group">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 text-md text-ink [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <Icon name="plus" className="size-4 shrink-0 text-muted transition-transform duration-300 group-open:rotate-45" />
                </summary>
                <p className="max-w-xl pb-6 text-sm leading-7 text-ink-2">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
