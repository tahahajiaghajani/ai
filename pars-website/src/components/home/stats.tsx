import type { CSSProperties } from "react";
import type { Lang } from "@/lib/i18n";
import type { SiteContent } from "@/lib/settings-types";
import { Counter } from "@/components/home/counter";

export function Stats({ lang, site }: { lang: Lang; site: SiteContent }) {
  return (
    <section aria-label="stats" className="relative py-10">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="hairline" />
        <dl className="grid grid-cols-2 gap-y-10 py-14 lg:grid-cols-4">
          {site.stats.map((s, i) => (
            <div key={i} data-reveal style={{ "--d": i } as CSSProperties} className="relative px-4 text-center lg:border-s lg:border-line lg:first:border-s-0">
              <dt className="sr-only">{lang === "fa" ? s.labelFa : s.labelEn}</dt>
              <dd className="font-brand text-[clamp(2.6rem,5vw,4.2rem)] font-bold leading-none text-gradient">
                <Counter value={s.value} lang={lang} />
              </dd>
              <dd aria-hidden className="mx-auto mt-3 max-w-[16rem] text-sm leading-6 text-muted">
                {lang === "fa" ? s.labelFa : s.labelEn}
              </dd>
            </div>
          ))}
        </dl>
        <div className="hairline" />
      </div>
    </section>
  );
}
