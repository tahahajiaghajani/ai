import Image from "next/image";
import type { CSSProperties } from "react";
import type { Copy } from "@/content/fa";
import { num, type Lang } from "@/lib/i18n";
import type { SiteContent } from "@/lib/settings-types";
import ceoPhoto from "@/assets/ceo.webp";
import { Tilt } from "@/components/home/tilt";

/** Flowing ribbon lines behind the portrait (the logo's waves as a motion system). */
function Ribbons() {
  const lines = Array.from({ length: 9 }, (_, i) => i);
  return (
    <svg aria-hidden viewBox="0 0 1200 600" preserveAspectRatio="none" className="absolute inset-0 -z-10 h-full w-full opacity-60">
      <defs>
        <linearGradient id="ceo-rb" x1="0" x2="1">
          <stop offset="0" stopColor="#8f86ff" stopOpacity="0" />
          <stop offset=".3" stopColor="#8f86ff" stopOpacity=".55" />
          <stop offset=".7" stopColor="#ff2b8f" stopOpacity=".55" />
          <stop offset="1" stopColor="#ff2b8f" stopOpacity="0" />
        </linearGradient>
      </defs>
      {lines.map((i) => {
        const y = 120 + i * 45;
        const a = 70 - i * 6;
        return (
          <path
            key={i}
            d={`M-50 ${y} C 250 ${y - a}, 450 ${y + a}, 600 ${300 + (i - 4) * 6} S 950 ${y - a}, 1250 ${y + (i - 4) * 10}`}
            fill="none"
            stroke="url(#ceo-rb)"
            strokeWidth={i === 4 ? 1.6 : 1}
            className="dash-flow"
            style={{ animationDuration: `${8 + i * 0.7}s` } as CSSProperties}
          />
        );
      })}
    </svg>
  );
}

export function Ceo({ lang, t, site }: { lang: Lang; t: Copy; site: SiteContent }) {
  const c = site.ceo;
  const realName = lang === "fa" ? c.nameFa : c.nameEn || c.nameFa;
  // without a name the title leads and the company name follows
  const name = realName || (lang === "fa" ? c.titleFa : c.titleEn) || t.ceo.fallbackName;
  const title = realName ? (lang === "fa" ? c.titleFa : c.titleEn) : t.ceo.company;
  const quote = lang === "fa" ? c.quoteFa : c.quoteEn;
  const bio = lang === "fa" ? c.bioFa : c.bioEn;
  const highlights = (lang === "fa" ? c.highlightsFa : c.highlightsEn).filter(Boolean);
  const hasName = Boolean(realName);
  return (
    <section id="ceo" className="relative isolate overflow-hidden py-28 sm:py-40">
      <Ribbons />
      <div aria-hidden className="absolute start-[10%] top-1/3 -z-10 size-[520px] rounded-full bg-[radial-gradient(closest-side,rgb(110_60_200/0.28),transparent)]" />
      <div className="mx-auto grid max-w-7xl items-center gap-14 px-5 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
        <div data-reveal="mask" className="ceo-photo relative mx-auto w-full max-w-[440px]">
          <Tilt>
            <div className="ring-border ring-spin rounded-[2.6rem] p-2 shadow-[0_40px_120px_-40px_rgb(223_17_115/0.6)]">
              <div className="relative aspect-[4/5] overflow-hidden rounded-[2.1rem] bg-ink-3">
                <Image src={ceoPhoto} alt={hasName ? name : t.ceo.photoAlt} fill sizes="(min-width: 1024px) 440px, 90vw" placeholder="blur" className="ceo-img object-cover object-top" />
                <div aria-hidden className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-ink via-ink/40 to-transparent" />
                <div aria-hidden className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_120%,rgb(223_17_115/0.35),transparent_60%)] mix-blend-soft-light" />
                <div className="absolute inset-x-6 bottom-6">
                  <div className="text-lg font-bold">{name}</div>
                  <div className="text-sm text-muted">{title}</div>
                </div>
              </div>
            </div>
            {c.years && (
              <div aria-hidden className="absolute -start-5 top-10 animate-float rounded-2xl border border-line-strong bg-ink-3/80 px-4 py-3 backdrop-blur-md [transform:translateZ(40px)]">
                <div className="font-brand text-2xl font-bold text-gradient" dir="ltr">{num(c.years, lang)}</div>
                <div className="text-[11px] text-muted">{t.ceo.years}</div>
              </div>
            )}
            <div aria-hidden className="absolute -end-4 bottom-24 animate-float rounded-full border border-line-strong bg-ink-3/80 px-4 py-2 text-xs font-semibold backdrop-blur-md [animation-delay:-3s]">
              <span className="ltr font-brand text-violet">AI-native</span>
            </div>
          </Tilt>
        </div>

        <div>
          <span data-reveal className="kicker">
            {t.ceo.kicker}
          </span>
          <blockquote data-reveal style={{ "--d": 1 } as CSSProperties} className="relative mt-8">
            <span aria-hidden className="absolute -top-10 -start-2 font-brand text-[7rem] leading-none text-pink/25">“</span>
            <p className="display justified-fa relative text-[clamp(1.18rem,2.05vw,1.7rem)] font-medium leading-[1.75] [html[lang=en]_&]:text-[clamp(1.12rem,1.75vw,1.45rem)] [html[lang=en]_&]:leading-[1.4]">{quote}</p>
          </blockquote>
          <div data-reveal style={{ "--d": 2 } as CSSProperties} className="mt-10 flex items-center gap-4">
            <span className="h-12 w-1 rounded-full bg-reverse" />
            <div>
              <div className="text-xl font-extrabold text-gradient">{name}</div>
              <div className="text-sm text-muted">{title}</div>
            </div>
          </div>
          {highlights.length > 0 && (
            <ul data-reveal style={{ "--d": 3 } as CSSProperties} className="mt-6 flex flex-wrap gap-2">
              {highlights.map((h) => (
                <li key={h} className="rounded-full border border-line-strong bg-white/[0.03] px-3.5 py-1.5 text-[13px] font-semibold text-fg/85">
                  {/^[\x00-\x7F]+$/.test(h) ? <span className="ltr font-brand">{h}</span> : num(h, lang)}
                </li>
              ))}
            </ul>
          )}
          {bio && (
            <p data-reveal style={{ "--d": 4 } as CSSProperties} className="justified mt-6 max-w-xl text-[15px] leading-8 text-muted">
              {bio}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
