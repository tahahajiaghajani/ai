import { Suspense } from "react";
import { copy, type Lang } from "@/lib/i18n";
import { SupportCenter } from "@/components/support/support-center";

export function SupportPage({ lang }: { lang: Lang }) {
  const t = copy(lang);
  return (
    <section className="relative isolate min-h-[100svh] overflow-hidden pb-24 pt-[calc(var(--header-h)+3.5rem)]">
      <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(60%_70%_at_50%_0%,rgb(143_134_255/0.18),transparent_70%)]" />
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="hero-in mb-10 max-w-2xl">
          <span style={{ "--d": 0 } as React.CSSProperties} className="kicker">
            <span className="h-px w-8 bg-violet/60" />
            {t.supportCta.kicker}
          </span>
          <h1 style={{ "--d": 1 } as React.CSSProperties} className="display mt-4 text-[clamp(2rem,4.5vw,3.25rem)]">
            {t.support.title}
          </h1>
          <p style={{ "--d": 2 } as React.CSSProperties} className="mt-3 text-base leading-8 text-muted">
            {t.support.lead}
          </p>
        </div>
        <Suspense fallback={<div className="skeleton h-[520px] rounded-3xl" />}>
          <SupportCenter lang={lang} t={t.support} />
        </Suspense>
      </div>
    </section>
  );
}
