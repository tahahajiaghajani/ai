import type { Copy } from "@/content/fa";
import { href, type Lang } from "@/lib/i18n";
import { DemosButton } from "@/components/site/demo-sheet";
import { Icon } from "@/components/site/icons";

export function DemosCta({ lang, t }: { lang: Lang; t: Copy }) {
  const d = t.demos;
  return (
    <section id="demos" className="relative py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div data-reveal="scale" className="grain relative isolate overflow-hidden rounded-[2.5rem] border border-line-strong px-7 py-16 text-center sm:px-16 sm:py-24">
          <div aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(120deg,#1a183a_0%,#3a1d55_45%,#7b235a_75%,#b8115f_100%)]" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img aria-hidden src="/brand/pars-mark-white.svg" alt="" loading="lazy" className="absolute -bottom-24 -end-16 -z-10 w-[420px] opacity-[0.07] sm:w-[560px]" />
          <span className="kicker justify-center !text-white/80">
            {d.kicker}
          </span>
          <h2 className="display mx-auto mt-5 max-w-3xl text-[clamp(1.65rem,3.4vw,2.7rem)] text-balance">{d.title}</h2>
          <p className="justified-center mx-auto mt-5 max-w-xl text-base leading-8 text-white/75 sm:text-lg">{d.lead}</p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <DemosButton className="group inline-flex h-14 items-center gap-3 rounded-full bg-white px-8 font-bold text-midnight shadow-[0_20px_60px_-20px_rgb(255_255_255/0.6)] transition hover:scale-[1.03]">
              <span className="grid size-8 place-items-center rounded-full bg-magenta text-white">
                <Icon name="play" className="size-3.5" />
              </span>
              {d.button}
            </DemosButton>
            <a href={`${href(lang, "/support")}?category=demo`} className="inline-flex h-14 items-center gap-2 rounded-full border border-white/30 px-7 font-semibold text-white transition hover:bg-white/10">
              {d.custom}
              <Icon name="arrow" className="size-4 rtl:-scale-x-100" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
