import { accountCopy } from "@/content/copy/account";
import { num, type Lang } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { getSlots, slotText } from "@/lib/slots";
import type { CSSProperties } from "react";
import { Icon } from "@/components/ui/icons";
import { Arch } from "@/components/fx/arch";
import { ArchLines } from "@/components/fx/arch-lines";
import { Aura } from "@/components/fx/aura";
import { Grain } from "@/components/fx/grain";
import { Magnetic } from "@/components/fx/magnetic";
import { SplitWords } from "@/components/fx/split-words";
import { SectionHead } from "@/components/home/sections";
import { Membership } from "@/components/account/membership";
import { HaveCodeButton } from "@/components/account/have-code";

/** /pro — static and identical for everyone; only the request block (#request) reads the visitor's session. */
export async function ProPage({ lang }: { lang: Lang }) {
  const c = accountCopy(lang).proPage;
  const [slots, settings] = await Promise.all([getSlots(), getSettings()]);
  const hero = slots["pro.hero"];
  const faq = [...c.faq, { q: c.minQ, a: settings.shop.minOrder > 0 ? c.minYes : c.minNo }];
  return (
    <main>
      <section data-header="dark" data-tone="light" className="relative isolate -mt-[var(--header-h)] overflow-clip bg-night text-on-night">
        <Aura palette="cocoa" />
        <Grain />
        <div className="container-lux relative grid items-center gap-12 pt-[calc(var(--header-h)+3rem)] pb-20 lg:min-h-[calc(100svh-var(--announce-h,0px))] lg:grid-cols-12 lg:gap-10 lg:pb-16">
          <div className="text-center lg:col-span-6 lg:text-start xl:col-span-5 xl:col-start-2">
            <p className="fx-in font-label text-xs tracking-[0.36em] text-gold-on-dark ltr" style={{ "--in": 0 } as CSSProperties}>
              PRO
            </p>
            <SplitWords as="h1" text={slotText(hero, "title", lang)} immediate delay={150} className="display mt-5 text-[clamp(2.75rem,8vw,3.75rem)] leading-[1.3]! font-bold lg:text-[clamp(3.5rem,5.2vw,5.5rem)]" wordClassName="text-metal-light metal-live" />
            <p className="fx-in mx-auto mt-6 max-w-md text-lg leading-9 text-on-night-muted lg:mx-0" style={{ "--in": 3 } as CSSProperties}>
              {slotText(hero, "subtitle", lang)}
            </p>
            <div className="fx-in mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start" style={{ "--in": 4 } as CSSProperties}>
              <Magnetic>
                <a href="#request" className="btn btn-metal h-13 px-8">
                  {c.requestCta}
                </a>
              </Magnetic>
              <HaveCodeButton label={c.haveCode} className="btn btn-line-light h-13" />
            </div>
          </div>
          {hero && (
            <div className="relative mx-auto w-[min(76vw,440px)] lg:col-span-5 lg:col-start-8 lg:w-full lg:max-w-[460px]" data-cursor="view">
              <ArchLines count={4} tone="champagne" immediate className="pointer-events-none absolute inset-x-[-22%] bottom-0 top-[-12%] h-[112%] w-[144%]" />
              <Arch media={hero.media} mobile={hero.mobile} lang={lang} priority ring="champagne" keystone unveil afterIntro sparkle={12} sizes="(min-width: 1024px) 460px, 76vw" />
              <span aria-hidden className="absolute inset-x-[-12%] -bottom-px block h-px bg-[image:var(--metal-champagne)] opacity-60" />
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="pro-benefits" className="relative isolate bg-mesh-porcelain">
        <div className="container-lux py-20 lg:py-28">
          <div id="pro-benefits">
            <SectionHead eyebrow={c.eyebrow} title={c.benefitsTitle} />
          </div>
          <ul className="mt-12 grid gap-6 sm:grid-cols-3">
            {c.benefits.map((b, i) => (
              <li key={b.title} className="frame-metal relative bg-porcelain p-7 [--frame:var(--metal-copper)] sm:p-8" data-reveal style={{ "--d": i } as CSSProperties}>
                <span className="arch-full grid size-12 place-items-center bg-bone text-gold" aria-hidden>
                  <svg viewBox="0 0 10 10" className="size-3">
                    <path d="M5 0 10 5 5 10 0 5Z" fill="currentColor" />
                  </svg>
                </span>
                <p className="display mt-6 text-2xl font-bold text-ink">{b.title}</p>
                <p className="mt-3 text-base leading-8 text-muted">{b.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="pro-steps" className="relative isolate overflow-clip bg-mesh-bone">
        <ArchLines count={4} className="pointer-events-none absolute inset-x-0 -bottom-10 mx-auto h-[120%] w-[min(1100px,140vw)] opacity-60" />
        <div className="container-lux relative py-20 lg:py-28">
          <div id="pro-steps">
            <SectionHead eyebrow="PRO" title={c.stepsTitle} />
          </div>
          <ol className="mt-12 grid gap-10 sm:grid-cols-3 sm:gap-8">
            {c.steps.map((st, i) => (
              <li key={st.title} data-reveal style={{ "--d": i } as CSSProperties}>
                <span className="display block text-6xl font-bold text-metal tabular-nums sm:text-7xl">{num(String(i + 1).padStart(2, "0"), lang)}</span>
                <span className="mt-4 block h-px w-16 bg-[image:var(--metal-copper)]" aria-hidden />
                <p className="display mt-5 text-2xl font-bold text-ink">{st.title}</p>
                <p className="mt-2 max-w-xs text-base leading-8 text-muted">{st.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="request" aria-labelledby="pro-request" className="relative isolate scroll-mt-24 bg-mesh-porcelain">
        <div className="container-lux grid gap-10 py-20 lg:grid-cols-12 lg:gap-16 lg:py-28">
          <div className="lg:col-span-4">
            <h2 id="pro-request" className="display text-4xl font-bold sm:text-5xl">
              {c.requestTitle}
            </h2>
            <span className="mt-6 block h-px w-16 bg-[image:var(--metal-copper)]" aria-hidden />
          </div>
          <div className="frame-metal relative bg-porcelain p-6 shadow-[0_40px_80px_-50px_rgb(26_19_16/0.4)] [--frame:var(--metal-copper)] sm:p-10 lg:col-span-8 xl:col-span-7">
            <Membership lang={lang} variant="page" />
          </div>
        </div>
      </section>

      <section aria-labelledby="pro-faq" className="border-t border-gold/20 bg-bone">
        <div className="container-lux grid gap-8 py-20 lg:grid-cols-12 lg:gap-16 lg:py-28">
          <h2 id="pro-faq" className="display text-4xl font-bold sm:text-5xl lg:col-span-4">
            {c.faqTitle}
          </h2>
          <div className="divide-y divide-gold/20 border-y border-gold/20 lg:col-span-8 xl:col-span-7">
            {faq.map((f) => (
              <details key={f.q} className="group">
                <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 py-4 text-lg font-semibold text-ink [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span className="arch-full grid size-9 shrink-0 place-items-center border border-gold/40 text-gold transition-transform duration-500 group-open:rotate-45">
                    <Icon name="plus" className="size-4" />
                  </span>
                </summary>
                <p className="max-w-xl pb-7 text-base leading-8 text-ink-2">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
