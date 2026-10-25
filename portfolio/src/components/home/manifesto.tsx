import type { Lang } from "@/lib/i18n";
import { num } from "@/lib/i18n";
import { PROFILE } from "@/content/profile";
import { ui } from "@/content/ui";
import { Counter } from "@/components/fx/counter";

export interface Fact {
  value: number;
  suffix?: string;
  label: { fa: string; en: string };
}

/** The statement, lit word by word as it crosses the screen, and the numbers under it. */
export function Manifesto({ lang, facts }: { lang: Lang; facts: Fact[] }) {
  return (
    <section id="about" className="relative mx-auto max-w-[1800px] px-5 py-28 md:px-10 md:py-40">
      <div className="grid grid-cols-12 gap-x-4">
        <p className="col-span-12 mb-10 flex items-center gap-3 font-mono text-[0.65rem] uppercase tracking-[0.22em] text-muted md:col-span-3">
          <span className="text-fg">{num(lang, "01")}</span>
          <span className="h-px w-6 bg-line-strong" />
          <span className={lang === "fa" ? "font-fa text-[0.8rem] normal-case tracking-normal" : ""}>{ui.sections.manifesto[lang]}</span>
        </p>
        <p
          data-scrub-words
          className={`col-span-12 md:col-span-9 ${lang === "fa" ? "text-[clamp(1.6rem,3.6vw,3.4rem)] font-medium leading-[1.6]" : "text-[clamp(1.7rem,3.9vw,3.9rem)] font-medium leading-[1.18] tracking-[-0.025em]"}`}
        >
          {PROFILE.manifesto[lang]}
        </p>
      </div>
      <dl className="mt-24 grid grid-cols-2 border-t border-line md:mt-32 md:grid-cols-4">
        {facts.map((f, i) => (
          <div key={i} data-fade className="flex flex-col border-b border-line py-8 pe-4 md:border-b-0 md:border-e md:px-6 md:first:ps-0 md:last:border-e-0">
            <dt className="order-2 mt-3 text-sm text-muted">{f.label[lang]}</dt>
            <dd className="latin text-[clamp(3rem,6vw,5.5rem)] font-semibold leading-none tracking-[-0.05em]">
              <Counter to={f.value} lang={lang} />
              {f.suffix ? <span className="text-muted">{f.suffix}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
