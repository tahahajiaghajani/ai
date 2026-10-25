"use client";

import { useState } from "react";
import type { Lang } from "@/lib/i18n";
import { num } from "@/lib/i18n";
import { EXPERTISE } from "@/content/profile";
import { ui } from "@/content/ui";
import { SectionHead } from "@/components/home/section-head";
import { Glyph } from "@/components/home/glyphs";
import { PlusIcon } from "@/components/brand/icons";

/** Disciplines as a list that opens on hover or tap; a live diagram of the open one stays pinned beside it. */
export function Expertise({ lang }: { lang: Lang }) {
  const [active, setActive] = useState(0);
  const fa = lang === "fa";
  return (
    <section id="expertise" className="mx-auto max-w-[1800px] px-5 py-24 md:px-10 md:py-36">
      <SectionHead
        lang={lang}
        index="02"
        eyebrow={ui.sections.expertise[lang]}
        title={
          fa ? (
            <>از تحلیل سیستم تا <span className="font-light">استقرار هوش مصنوعی</span></>
          ) : (
            <>
              From systems analysis to <span className="font-serif font-normal italic">deployed intelligence</span>
            </>
          )
        }
      />
      <div className="mt-16 grid grid-cols-12 gap-x-4 md:mt-24">
        <div className="col-span-12 hidden md:col-span-4 md:block">
          <div className="sticky top-28">
            <div className="relative aspect-square w-full max-w-[420px] border border-line p-8 text-fg">
              <span className="absolute start-3 top-3 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-faint">fig. {num(lang, `0${active + 2}`)}</span>
              <span className="absolute end-3 top-3 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-faint" dir="ltr">{EXPERTISE[active].key}</span>
              <div key={active} className="size-full animate-[fade-in_0.6s_ease-out]">
                <Glyph kind={EXPERTISE[active].key} />
              </div>
            </div>
          </div>
        </div>
        <ol className="col-span-12 md:col-span-8">
          {EXPERTISE.map((x, i) => {
            const open = i === active;
            return (
              <li key={x.key} className="border-b border-line first:border-t" onPointerEnter={(e) => e.pointerType === "mouse" && setActive(i)}>
                <button type="button" onClick={() => setActive(i)} aria-expanded={open} className="flex w-full items-baseline gap-5 py-7 text-start md:py-9">
                  <span className="w-10 shrink-0 font-mono text-xs text-faint">{num(lang, `0${i + 1}`)}</span>
                  <span className={`flex-1 text-[clamp(1.5rem,3.2vw,3rem)] leading-[1.15] transition-colors duration-500 ${open ? "text-fg" : "text-muted"} ${fa ? "font-semibold" : "font-medium tracking-[-0.03em]"}`}>{x.title[lang]}</span>
                  <span aria-hidden className={`grid size-9 shrink-0 place-items-center rounded-full border transition-all duration-500 ${open ? "rotate-45 border-fg bg-fg text-bg" : "border-line-strong"}`}>
                    <PlusIcon className="size-3.5" strokeWidth={1.4} />
                  </span>
                </button>
                <div className="grid transition-[grid-template-rows] duration-700 ease-[var(--ease-out-expo)]" style={{ gridTemplateRows: open ? "1fr" : "0fr" }}>
                  <div className="overflow-hidden">
                    <div className="flex flex-col gap-6 pb-9 ps-15 md:flex-row md:items-end md:justify-between">
                      <p className="max-w-[56ch] text-[1.05rem] leading-relaxed text-fg-2">{x.body[lang]}</p>
                      <ul className="flex flex-wrap gap-2 md:max-w-[40%] md:justify-end" dir="ltr">
                        {x.tags.map((t) => (
                          <li key={t} className="rounded-full border border-line px-3 py-1 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted">{t}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="mb-8 aspect-[2/1] max-w-sm border border-line p-4 md:hidden">
                      <Glyph kind={x.key} />
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
