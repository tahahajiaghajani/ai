import Link from "next/link";
import type { CSSProperties } from "react";
import type { Copy } from "@/content/fa";
import { href, type Lang } from "@/lib/i18n";
import { Clients } from "@/components/home/clients";
import { SectionHead } from "@/components/home/section-head";

function Visual({ kind }: { kind: string }) {
  if (kind === "gantt") {
    return (
      <div aria-hidden className="space-y-2" dir="ltr">
        {[[0, 55], [20, 45], [35, 50], [10, 30], [52, 40], [28, 36]].map(([s, w], i) => (
          <div key={i} className="relative h-3 rounded-full bg-white/[0.04]">
            <span className="gantt-bar absolute inset-y-0 rounded-full bg-gradient-to-r from-violet/80 to-pink/80" style={{ left: `${s}%`, width: `${w}%`, "--i": i } as CSSProperties} />
          </div>
        ))}
      </div>
    );
  }
  if (kind === "grid") {
    return (
      <div aria-hidden className="overflow-hidden rounded-xl border border-line" dir="ltr">
        {[0, 1, 2, 3, 4].map((r) => (
          <div key={r} className={`grid grid-cols-[1.4fr_1fr_1fr_0.6fr] gap-3 border-b border-line px-3 py-2.5 last:border-0 ${r === 2 ? "bg-pink/[0.08]" : ""}`}>
            <span className={`h-2 rounded-full ${r === 0 ? "bg-white/25" : "bg-white/10"}`} />
            <span className="h-2 rounded-full bg-white/10" />
            <span className="h-2 rounded-full bg-violet/30" />
            <span className={`h-2 rounded-full ${r === 2 ? "bg-pink/70" : "bg-success/40"}`} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div aria-hidden className="space-y-2.5">
      <div className="ms-auto w-3/4 rounded-2xl rounded-ee-md bg-ink-4 px-3 py-2.5">
        <span className="block h-2 w-4/5 rounded-full bg-white/20" />
      </div>
      <div className="flex gap-2">
        <span className="size-6 shrink-0 rounded-lg bg-reverse" />
        <div className="flex-1 space-y-2 rounded-2xl border border-line px-3 py-2.5">
          <span className="block h-2 w-full rounded-full bg-white/15" />
          <span className="block h-2 w-5/6 rounded-full bg-white/15" />
          <span className="block h-2 w-2/3 rounded-full bg-pink/50" />
        </div>
      </div>
      <div className="flex gap-1.5 ps-8">
        {["✓", "✓", "✓"].map((c, i) => (
          <span key={i} className="grid size-5 place-items-center rounded-full bg-success/15 text-[10px] text-success">
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Work({ lang, t }: { lang: Lang; t: Copy }) {
  const w = t.work;
  return (
    <section id="work" className="relative py-28 sm:py-36">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHead kicker={w.kicker} title={w.title} />
        <div className="mt-14 grid gap-5 lg:grid-cols-3">
          {w.items.map((item, i) => (
            <article key={item.client} data-reveal style={{ "--d": i } as CSSProperties} className="card group relative flex flex-col overflow-hidden transition duration-500 hover:-translate-y-1 hover:border-line-strong">
              <div className="relative h-56 overflow-hidden border-b border-line bg-[radial-gradient(80%_90%_at_50%_0%,rgb(143_134_255/0.14),transparent_70%)] p-7">
                <div className="transition duration-700 group-hover:scale-[1.03]">
                  <Visual kind={item.visual} />
                </div>
                <div aria-hidden className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-ink-2/80" />
              </div>
              <div className="flex flex-1 flex-col p-7">
                <span className="text-sm font-semibold text-pink">{item.client}</span>
                <h3 className="mt-2 text-xl font-bold">{item.title}</h3>
                <p className="justified-fa mt-3 text-[15px] leading-7 text-muted">{item.body}</p>
                <div className="mt-auto flex flex-wrap gap-1.5 pt-6">
                  {item.tags.map((tag) => (
                    <span key={tag} className="ltr rounded-full bg-white/[0.05] px-2.5 py-1 font-brand text-[11px] text-muted">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
        <p data-reveal className="mt-6 text-sm text-faint">{w.note}</p>

        <div data-reveal className="mt-24">
          <h3 className="kicker">
            {w.clientsTitle}
          </h3>
        </div>
        <Clients lang={lang} t={t} />
        <p data-reveal className="mt-6 text-sm leading-6 text-muted">{w.clientsMore}</p>
        <Link data-reveal href={href(lang, "/records")} className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-violet hover:text-fg">
          {t.records.all}
          <span aria-hidden>{lang === "fa" ? "←" : "→"}</span>
        </Link>
      </div>
    </section>
  );
}
