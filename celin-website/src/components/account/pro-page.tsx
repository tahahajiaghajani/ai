import { accountCopy } from "@/content/copy/account";
import { num, type Lang } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { getSlots, slotText } from "@/lib/slots";
import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/icons";
import { LuxFrame } from "@/components/ui/lux-frame";
import { Arch } from "@/components/fx/arch";
import { ArchLines } from "@/components/fx/arch-lines";
import { Aura } from "@/components/fx/aura";
import { Grain } from "@/components/fx/grain";
import { Magnetic } from "@/components/fx/magnetic";
import { SplitWords } from "@/components/fx/split-words";
import { ProHallmark } from "@/components/pro/seal";
import { Membership } from "@/components/account/membership";
import { HaveCodeButton } from "@/components/account/have-code";

/** A quiet section head of the inner pages: a rhombus eyebrow, then the section title. */
function Head({ id, eyebrow, title, center = false }: { id: string; eyebrow: string; title: ReactNode; center?: boolean }) {
  return (
    <div className={center ? "text-center" : ""}>
      <p className={`label flex items-center gap-2.5 text-gold-text! ${center ? "justify-center" : ""}`}>
        <span aria-hidden className="size-1.5 rotate-45 bg-[image:var(--metal-copper)]" />
        {eyebrow}
      </p>
      <h2 id={id} className="title-section mt-3 text-ink">
        {title}
      </h2>
    </div>
  );
}

const BENEFIT_ICONS: IconName[] = ["tag", "box", "users"];

/** /pro — static and identical for everyone; only the request block (#request) reads the visitor's session. */
export async function ProPage({ lang }: { lang: Lang }) {
  const c = accountCopy(lang).proPage;
  const [slots, settings] = await Promise.all([getSlots(), getSettings()]);
  const hero = slots["pro.hero"];
  const faq = [...c.faq, { q: c.minQ, a: settings.shop.minOrder > 0 ? c.minYes : c.minNo }];
  return (
    <main>
      <section data-header="dark" data-tone="light" className="under-header relative isolate overflow-clip bg-night text-on-night">
        <Aura palette="cocoa" />
        <Grain />
        <div className="container-lux relative grid items-center gap-14 pt-[calc(var(--header-h)+3rem)] pb-20 lg:min-h-[calc(92svh-var(--announce-h,0px))] lg:grid-cols-12 lg:gap-10 lg:pb-16">
          <div className="text-center lg:col-span-6 lg:text-start xl:col-span-5 xl:col-start-2">
            <p className="fx-in flex items-center justify-center gap-3 font-label text-xs tracking-[0.36em] text-gold-on-dark lg:justify-start" style={{ "--in": 0 } as CSSProperties}>
              <span aria-hidden className="h-px w-8 bg-[image:var(--metal-champagne)]" />
              <span className="ltr">CELIN PRO</span>
            </p>
            <SplitWords as="h1" text={slotText(hero, "title", lang)} immediate delay={150} className="title-page mt-5" wordClassName="text-metal-light metal-live" />
            <p className="fx-in lede mx-auto mt-5 max-w-md text-on-night-muted lg:mx-0" style={{ "--in": 3 } as CSSProperties}>
              {slotText(hero, "subtitle", lang)}
            </p>
            <div className="fx-in mx-auto mt-9 flex w-full max-w-xs flex-col gap-3 sm:w-auto sm:max-w-none sm:flex-row sm:justify-center lg:mx-0 lg:justify-start" style={{ "--in": 4 } as CSSProperties}>
              <Magnetic className="w-full sm:w-auto">
                <a href="#request" className="btn btn-metal btn-lg w-full sm:w-auto">
                  {c.requestCta}
                </a>
              </Magnetic>
              <HaveCodeButton lang={lang} label={c.haveCode} className="btn btn-line-light btn-lg w-full sm:w-auto" />
            </div>
          </div>
          {hero && (
            <div className="relative mx-auto w-[min(72vw,400px)] lg:col-span-5 lg:col-start-8 lg:w-full lg:max-w-[420px]" data-cursor="view">
              <ArchLines count={4} tone="champagne" immediate className="pointer-events-none absolute inset-x-[-22%] bottom-0 top-[-12%] h-[112%] w-[144%]" />
              <Arch media={hero.media} mobile={hero.mobile} lang={lang} priority ring="champagne" keystone unveil afterIntro sparkle={12} sizes="(min-width: 1024px) 420px, 72vw" />
              <span aria-hidden className="absolute inset-x-[-12%] -bottom-px block h-px bg-[image:var(--metal-champagne)] opacity-60" />
              {/* the hallmark, stamped on the picture */}
              <span className="fx-in absolute -bottom-8 -start-6 block drop-shadow-[0_18px_30px_rgb(0_0_0/0.45)] sm:-start-10" style={{ "--in": 5 } as CSSProperties}>
                <ProHallmark className="size-24 sm:size-32" />
              </span>
            </div>
          )}
        </div>
      </section>

      {/* the FAQ sits on a copper sill */}
      <section aria-labelledby="pro-benefits" className="relative isolate bg-mesh-porcelain">
        <div className="container-lux pt-20 pb-20 lg:py-28">
          <Head id="pro-benefits" eyebrow={c.eyebrow} title={c.benefitsTitle} />
          <ul className="mt-12 grid gap-6 sm:grid-cols-3">
            {c.benefits.map((b, i) => (
              <li key={b.title} data-reveal style={{ "--d": i } as CSSProperties}>
                <LuxFrame className="h-full bg-porcelain/80 px-7 pt-8 pb-9 sm:px-8">
                  <span className="arch grid h-14 w-11 place-items-center border border-b-0 border-gold/45 text-gold" aria-hidden>
                    <Icon name={BENEFIT_ICONS[i] ?? "diamond"} className="mt-2 size-5" />
                  </span>
                  <p className="title-card mt-6 text-ink">{b.title}</p>
                  <p className="mt-2 font-ui text-sm leading-7 text-muted">{b.text}</p>
                </LuxFrame>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="pro-steps" className="relative isolate overflow-clip bg-mesh-bone">
        {/* the arcade fades in below the band's top edge (at 1/6 of the svg less 2.5rem) instead of being cut by it */}
        <ArchLines count={4} className="pointer-events-none absolute inset-x-0 -bottom-10 mx-auto h-[120%] w-[min(1100px,140vw)] opacity-50 [mask-image:linear-gradient(to_bottom,transparent_calc(100%/6_-_2.5rem),black_calc(100%/6_+_5rem),black_32%,transparent_50%)]" />
        <div className="container-lux relative py-20 lg:py-28">
          <Head id="pro-steps" eyebrow="PRO" title={c.stepsTitle} center />
          <ol className="mx-auto mt-14 grid max-w-5xl gap-12 sm:grid-cols-2 sm:gap-8 lg:grid-cols-4">
            {c.steps.map((st, i) => (
              <li key={st.title} className="text-center" data-reveal style={{ "--d": i } as CSSProperties}>
                <span className="relative mx-auto grid h-28 w-22 place-items-center" aria-hidden>
                  <span className="arch absolute inset-0 border border-b-0 border-gold/45" />
                  <span className="arch absolute inset-[5px] border border-b-0 border-gold/20" />
                  <span className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rotate-45 bg-gold-bright" />
                  <span className="title-section mt-3 text-metal tabular-nums">{num(i + 1, lang)}</span>
                </span>
                <span className="mx-auto block h-px w-32 bg-[image:var(--metal-copper)] opacity-70" aria-hidden />
                <p className="title-card mt-6 text-ink">{st.title}</p>
                <p className="mx-auto mt-2 max-w-xs font-ui text-sm leading-7 text-muted">{st.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="request" aria-labelledby="pro-request" className="relative isolate scroll-mt-24 bg-mesh-porcelain">
        <div className="container-lux grid gap-10 py-20 lg:grid-cols-12 lg:gap-16 lg:py-28">
          <div className="lg:col-span-4">
            <Head id="pro-request" eyebrow={c.eyebrow} title={c.requestTitle} />
            <span className="mt-6 block h-px w-16 bg-[image:var(--metal-copper)]" aria-hidden />
          </div>
          <div className="lg:col-span-8 xl:col-span-7">
            <Membership lang={lang} variant="page" />
          </div>
        </div>
      </section>

      <section aria-labelledby="pro-faq" className="border-t border-gold/20 bg-bone">
        <div className="container-lux grid gap-8 py-20 lg:grid-cols-12 lg:gap-16 lg:py-28">
          <div className="lg:col-span-4">
            <Head id="pro-faq" eyebrow="PRO" title={c.faqTitle} />
          </div>
          <div className="divide-y divide-gold/20 border-y border-gold/20 lg:col-span-8 xl:col-span-7">
            {faq.map((f) => (
              <details key={f.q} className="group">
                <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 py-4 font-ui text-md font-bold text-ink [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span className="arch-full grid size-9 shrink-0 place-items-center border border-gold/40 text-gold transition-transform duration-500 group-open:rotate-45">
                    <Icon name="plus" className="size-4" />
                  </span>
                </summary>
                <p className="max-w-xl pb-7 font-ui text-sm leading-8 text-ink-2">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
