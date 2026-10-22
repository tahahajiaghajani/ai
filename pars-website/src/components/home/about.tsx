import type { CSSProperties } from "react";
import type { Copy } from "@/content/fa";
import { num, type Lang } from "@/lib/i18n";
import { SectionHead } from "@/components/home/section-head";

/** Company story (from the official profile): timeline, mission, vision and core values. */
export function About({ lang, t }: { lang: Lang; t: Copy }) {
  const a = t.about;
  return (
    <section id="about" className="relative py-28 sm:py-36">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHead kicker={a.kicker} title={a.title} lead={a.lead} />

        <div className="mt-16 grid gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
          <ol data-reveal="line" className="timeline relative">
            <span aria-hidden className="tl-line absolute bottom-3 start-[7px] top-3 w-px bg-gradient-to-b from-violet via-pink to-pink/0" />
            {a.timeline.map((s, i) => (
              <li key={s.title} className="tl-step relative pb-11 ps-10 last:pb-0" style={{ "--i": i } as CSSProperties}>
                <span aria-hidden className="absolute start-0 top-1 grid size-[15px] place-items-center rounded-full border border-pink/60 bg-ink shadow-[0_0_0_5px_var(--color-ink)]">
                  <span className="size-[5px] rounded-full bg-pink" />
                </span>
                <div className="text-sm font-bold text-pink">{s.mark}</div>
                <h3 className="mt-1.5 text-xl font-bold">{s.title}</h3>
                <p className="justified mt-2 max-w-xl text-[15px] leading-7 text-muted">{s.body}</p>
              </li>
            ))}
          </ol>

          <div data-reveal style={{ "--d": 1 } as CSSProperties} className="card relative self-start overflow-hidden p-7 sm:p-10">
            <div aria-hidden className="absolute -end-24 -top-24 size-64 rounded-full bg-[radial-gradient(closest-side,rgb(223_17_115/0.22),transparent)]" />
            <div className="relative">
              <span className="kicker">
                {a.missionLabel}
              </span>
              <h3 className="display mt-4 text-[clamp(1.3rem,2.1vw,1.75rem)]">{a.missionTitle}</h3>
              {lang === "fa" && (
                <div className="mt-1">
                  <span className="ltr inline-block font-brand text-sm text-faint">{a.missionEn}</span>
                </div>
              )}
              <p className="justified-fa mt-5 text-[15px] leading-8 text-muted">{a.mission}</p>
              <ul className="mt-6 grid grid-cols-2 gap-2">
                {a.modules.map((m) => (
                  <li key={m} className="rounded-xl border border-line bg-white/[0.03] px-3 py-2.5 text-center text-sm font-semibold">
                    {m}
                  </li>
                ))}
              </ul>
              <div className="hairline mt-8" />
              <div className="mt-6">
                <span className="kicker">
                  {a.visionLabel}
                </span>
              </div>
              <p className="mt-3 text-lg font-bold leading-8">{a.vision}</p>
            </div>
          </div>
        </div>

        <div data-reveal className="mt-24">
          <h3 className="kicker">
            {a.valuesTitle}
          </h3>
        </div>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {a.values.map((v, i) => (
            <li key={v.title} data-reveal style={{ "--d": i } as CSSProperties} className="card p-6">
              <span className="font-brand text-sm font-bold text-gradient" dir="ltr">
                {num(String(i + 1).padStart(2, "0"), lang)}
              </span>
              <h4 className="mt-3 text-lg font-bold">{v.title}</h4>
              <ul className="mt-3 space-y-1.5 text-[13px] leading-6 text-muted">
                {v.items.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
