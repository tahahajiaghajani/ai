import type { Lang } from "@/lib/i18n";
import { num } from "@/lib/i18n";

/** Index, eyebrow and a big split-revealed title, the opening of every home section. */
export function SectionHead({ lang, index, eyebrow, title, aside, className = "" }: { lang: Lang; index: string; eyebrow: string; title: React.ReactNode; aside?: React.ReactNode; className?: string }) {
  return (
    <header className={`grid grid-cols-12 gap-x-4 gap-y-6 border-t border-line pt-6 ${className}`}>
      <p className="col-span-12 flex items-center gap-3 font-mono text-[0.65rem] uppercase tracking-[0.22em] text-muted md:col-span-3">
        <span className="text-fg">{num(lang, index)}</span>
        <span className="h-px w-6 bg-line-strong" />
        <span className={lang === "fa" ? "font-fa text-[0.8rem] normal-case tracking-normal" : ""}>{eyebrow}</span>
      </p>
      <h2 data-split className={`col-span-12 text-title leading-[1.04] md:col-span-9 ${lang === "fa" ? "font-bold leading-[1.3]" : "font-semibold tracking-[-0.035em]"}`}>
        {title}
      </h2>
      {aside ? <div className="col-span-12 md:col-span-9 md:col-start-4">{aside}</div> : null}
    </header>
  );
}
