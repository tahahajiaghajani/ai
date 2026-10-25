import type { Lang } from "@/lib/i18n";
import { ui } from "@/content/ui";
import { JOURNEY } from "@/content/journey";
import { ORGS } from "@/content/orgs";
import { SectionHead } from "@/components/home/section-head";

/** Career and education as a ledger: period, role, place, one line of what it meant. */
export function Journey({ lang }: { lang: Lang }) {
  const fa = lang === "fa";
  return (
    <section id="journey" className="mx-auto max-w-[1800px] px-5 py-24 md:px-10 md:py-36">
      <SectionHead
        lang={lang}
        index="05"
        eyebrow={ui.sections.journey[lang]}
        title={fa ? <>مهندس مکانیک، معمار هوش مصنوعی، <span className="font-light">سازنده.</span></> : <>Mechanical engineer, AI architect, <span className="font-serif font-normal italic">builder.</span></>}
      />
      <ol className="mt-16 border-t border-line md:mt-24">
        {JOURNEY.map((r, i) => {
          const org = ORGS.find((o) => o.key === r.org);
          return (
            <li key={i} data-fade className="group grid grid-cols-12 gap-x-4 gap-y-3 border-b border-line py-8 transition-colors duration-500 hover:bg-fg/[0.03] md:py-10">
              <p className="col-span-12 flex items-center gap-3 font-mono text-[0.7rem] uppercase tracking-[0.16em] text-muted md:col-span-2">
                {r.current ? <span className="size-1.5 animate-pulse-dot rounded-full bg-fg" /> : null}
                <span className={fa ? "font-fa text-[0.85rem] normal-case tracking-normal" : ""}>{r.period[lang]}</span>
              </p>
              <div className="col-span-12 md:col-span-6">
                <h3 className={`text-[clamp(1.4rem,2.6vw,2.4rem)] leading-tight ${fa ? "font-bold" : "font-semibold tracking-[-0.03em]"}`}>{r.title[lang]}</h3>
                <p className="mt-2 text-muted">{org ? org.name[lang] : r.org === "msc" ? (fa ? "مهندسی صنایع" : "Industrial engineering") : fa ? "مستقل" : "Independent"}</p>
              </div>
              <p className="col-span-12 leading-relaxed text-fg-2 md:col-span-3">{r.body[lang]}</p>
              <div className="col-span-12 hidden items-start justify-end md:col-span-1 md:flex">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {org?.logo ? <img src={org.logo} alt="" className="org-logo h-10 w-auto max-w-full object-contain opacity-40 group-hover:opacity-100" /> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
