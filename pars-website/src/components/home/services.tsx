import type { CSSProperties } from "react";
import type { Copy } from "@/content/fa";
import { Icon, type IconName } from "@/components/site/icons";
import { SectionHead } from "@/components/home/section-head";
import { SpotlightGroup } from "@/components/home/spotlight";

const LAYOUT: Record<string, { icon: IconName; span: string }> = {
  epm: { icon: "epm", span: "lg:col-span-4 lg:row-span-2" },
  migration: { icon: "migration", span: "lg:col-span-2 lg:row-span-2" },
  ai: { icon: "ai", span: "lg:col-span-2" },
  custom: { icon: "custom", span: "lg:col-span-2" },
  data: { icon: "data", span: "lg:col-span-2" },
  training: { icon: "training", span: "lg:col-span-3" },
  consulting: { icon: "consulting", span: "lg:col-span-3" },
};

/** Decorative portfolio timeline for the EPM card. */
function GanttArt() {
  const rows = [
    [4, 38, "bg-violet/70"],
    [18, 46, "bg-orchid/70"],
    [30, 34, "bg-pink/80"],
    [10, 26, "bg-violet/50"],
    [44, 40, "bg-pink/60"],
  ] as const;
  return (
    <div aria-hidden className="gantt mt-8 space-y-2.5 rounded-2xl border border-line bg-ink/40 p-4" dir="ltr">
      {rows.map(([start, width, color], i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="h-1.5 w-10 rounded-full bg-white/10" />
          <div className="relative h-3.5 flex-1 rounded-full bg-white/[0.04]">
            <span className={`gantt-bar absolute inset-y-0 rounded-full ${color}`} style={{ left: `${start}%`, width: `${width}%`, "--i": i } as CSSProperties} />
          </div>
        </div>
      ))}
      <div className="relative h-px bg-white/10">
        <span className="absolute -top-1 left-[62%] size-2 rounded-full bg-pink shadow-[0_0_14px_3px_rgb(255_79_163/0.7)]" />
      </div>
    </div>
  );
}

export function Services({ t }: { t: Copy }) {
  const s = t.services;
  return (
    <section id="services" className="relative py-28 sm:py-36">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHead kicker={s.kicker} title={s.title} lead={s.lead} />
        <SpotlightGroup className="mt-14 grid gap-4 sm:grid-cols-2 lg:auto-rows-[minmax(220px,auto)] lg:grid-cols-6">
          {s.items.map((item, i) => {
            const l = LAYOUT[item.key];
            const featured = item.key === "epm";
            return (
              <article key={item.key} data-reveal style={{ "--d": i % 3 } as CSSProperties} className={`card spotlight group relative flex flex-col overflow-hidden p-7 sm:p-8 ${l.span} ${featured ? "sm:col-span-2" : ""}`}>
                {featured && <div aria-hidden className="absolute -end-24 -top-24 size-72 rounded-full bg-magenta/15 blur-3xl" />}
                <div className="relative flex items-start justify-between gap-4">
                  <span className="grid size-12 place-items-center rounded-2xl bg-reverse text-white shadow-[0_12px_30px_-12px_rgb(223_17_115/0.8)]">
                    <Icon name={l.icon} className="size-6" />
                  </span>
                  {"badge" in item && item.badge ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-[11px] font-semibold text-warning">
                      <span className="size-1.5 rounded-full bg-warning animate-pulse" />
                      {s.urgent}
                    </span>
                  ) : (
                    <span className="ltr font-brand text-xs text-faint">{item.en}</span>
                  )}
                </div>
                <h3 className={`relative mt-6 font-bold ${featured ? "text-2xl sm:text-3xl" : "text-xl"}`}>{item.title}</h3>
                <p className={`relative mt-3 text-muted ${featured ? "max-w-xl text-base leading-8" : "text-[15px] leading-7"}`}>{item.body}</p>
                {featured && <GanttArt />}
                <div className="relative mt-auto flex flex-wrap gap-1.5 pt-6">
                  {item.tags.map((tag) => (
                    <span key={tag} className="ltr rounded-full border border-line px-2.5 py-1 font-brand text-[11px] text-muted">
                      {tag}
                    </span>
                  ))}
                </div>
              </article>
            );
          })}
        </SpotlightGroup>
      </div>
    </section>
  );
}
