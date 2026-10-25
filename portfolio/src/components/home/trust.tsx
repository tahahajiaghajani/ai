import type { Lang } from "@/lib/i18n";
import { ui } from "@/content/ui";
import { ORGS } from "@/content/orgs";

/** The organisations behind the work, as quiet single-colour marks. */
export function Trust({ lang }: { lang: Lang }) {
  const orgs = ORGS.filter((o) => o.logo);
  return (
    <section aria-label={ui.sections.trust[lang]} className="border-y border-line">
      <div className="mx-auto max-w-[1800px] px-5 md:px-10">
        <div className="grid grid-cols-2 md:grid-cols-[1fr_repeat(4,minmax(0,1fr))]">
          <p className="col-span-2 flex items-center py-8 font-mono text-[0.65rem] uppercase tracking-[0.22em] text-muted md:col-span-1 md:py-0">
            <span className={lang === "fa" ? "font-fa text-[0.85rem] normal-case tracking-normal" : ""}>{ui.sections.trust[lang]}</span>
          </p>
          {orgs.map((o) => (
            <div key={o.key} className="group relative flex aspect-[3/2] flex-col items-center justify-center gap-4 border-s border-line p-6 md:aspect-[4/3]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={o.logo} alt={o.name[lang]} className="org-logo h-14 w-auto max-w-[70%] object-contain group-hover:scale-105 md:h-16" />
              <p className="absolute inset-x-4 bottom-4 text-center text-[0.72rem] leading-snug text-muted opacity-0 transition-opacity duration-500 group-hover:opacity-100">{o.relation[lang]}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
