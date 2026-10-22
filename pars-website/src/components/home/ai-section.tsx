import type { CSSProperties } from "react";
import type { Copy } from "@/content/fa";
import { num, type Lang } from "@/lib/i18n";
import { Icon, type IconName } from "@/components/site/icons";
import { SectionHead } from "@/components/home/section-head";
import { SpotlightGroup } from "@/components/home/spotlight";

const CARD_ICONS: IconName[] = ["agents", "rag", "predict", "pattern", "search", "execute"];

function Stream() {
  return (
    <div aria-hidden className="relative hidden h-px flex-1 lg:block">
      <div className="absolute inset-0 bg-gradient-to-r from-violet/10 via-pink/40 to-violet/10" />
      {[0, 1, 2].map((i) => (
        <span key={i} className="stream-track absolute inset-0" style={{ animationDelay: `${i * 0.9}s` } as CSSProperties}>
          <span className="absolute start-0 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-pink shadow-[0_0_12px_2px_rgb(255_79_163/0.8)]" />
        </span>
      ))}
    </div>
  );
}

export function AiSection({ lang, t }: { lang: Lang; t: Copy }) {
  const a = t.ai;
  const R = 84;
  const C = 2 * Math.PI * R;
  return (
    <section id="ai" className="relative overflow-hidden py-28 sm:py-36">
      <div aria-hidden className="absolute start-1/2 top-40 -z-10 h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(143_134_255/0.14),transparent)] rtl:translate-x-1/2" />
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHead kicker={a.kicker} title={a.title} lead={a.lead} center />

        {/* flow: inputs → agents → outcomes */}
        <div data-reveal="scale" className="card relative mt-16 overflow-hidden p-6 sm:p-10">
          <div aria-hidden className="absolute inset-0 bg-[radial-gradient(50%_70%_at_50%_50%,rgb(223_17_115/0.10),transparent_70%)]" />
          <div className="relative flex flex-col items-stretch gap-8 lg:flex-row lg:items-center lg:gap-6">
            <div className="lg:w-56">
              <div className="mb-3 text-xs font-semibold text-faint">{a.inputsTitle}</div>
              <ul className="grid grid-cols-2 gap-2 lg:grid-cols-1">
                {a.inputs.map((x, i) => (
                  <li key={x} className="flow-chip rounded-xl border border-line bg-ink-2/80 px-3.5 py-2.5 text-sm text-muted" style={{ "--i": i } as CSSProperties}>
                    {x}
                  </li>
                ))}
              </ul>
            </div>

            <Stream />

            {/* agent core with the 90/10 ring */}
            <div className="flex flex-col items-center">
              <div className="mb-3 text-xs font-semibold text-faint">{a.agentsTitle}</div>
              <div className="ring-wrap relative grid size-56 place-items-center">
                <svg viewBox="0 0 200 200" className="absolute inset-0 -rotate-90" aria-hidden>
                  <defs>
                    <linearGradient id="ai-ring" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0" stopColor="#8f86ff" />
                      <stop offset=".5" stopColor="#c2479f" />
                      <stop offset="1" stopColor="#ff2b8f" />
                    </linearGradient>
                  </defs>
                  <circle cx="100" cy="100" r={R} fill="none" stroke="rgb(255 255 255 / 0.06)" strokeWidth="12" />
                  <circle className="ring-auto" cx="100" cy="100" r={R} fill="none" stroke="url(#ai-ring)" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${C * 0.9 - 6} ${C}`} style={{ "--c": C } as CSSProperties} />
                  <circle className="ring-human" cx="100" cy="100" r={R} fill="none" stroke="#3ddc97" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${C * 0.1 - 6} ${C}`} strokeDashoffset={-(C * 0.9)} />
                </svg>
                <div className="text-center">
                  <div className="font-brand text-5xl font-bold text-gradient">{num("90%", lang)}</div>
                  <div className="mt-1 text-xs text-muted">{a.auto}</div>
                  <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-[11px] text-success">
                    <Icon name="human" className="size-3.5" />
                    {num("10%", lang)} {a.human}
                  </div>
                </div>
              </div>
              <ol className="mt-5 flex flex-wrap justify-center gap-1.5">
                {a.agents.map((x, i) => (
                  <li key={x} className="agent-step rounded-full border border-line px-3 py-1 text-xs text-muted" style={{ "--i": i } as CSSProperties}>
                    {x}
                  </li>
                ))}
              </ol>
            </div>

            <Stream />

            <div className="lg:w-60">
              <div className="mb-3 text-xs font-semibold text-faint">{a.outputsTitle}</div>
              <ul className="grid grid-cols-2 gap-2 lg:grid-cols-1">
                {a.outputs.map((x, i) => (
                  <li key={x} className="flex items-center gap-2 rounded-xl border border-pink/20 bg-pink/[0.06] px-3.5 py-2.5 text-sm text-fg/90" style={{ "--i": i } as CSSProperties}>
                    <Icon name="check" className="size-4 shrink-0 text-pink" />
                    {x}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* capabilities */}
        <SpotlightGroup className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {a.cards.map((c, i) => (
            <article key={c.title} data-reveal style={{ "--d": i % 3 } as CSSProperties} className="card spotlight group p-7">
              <div className="flex items-center justify-between">
                <span className="grid size-12 place-items-center rounded-2xl border border-line bg-ink-2 text-violet transition group-hover:border-pink/40 group-hover:text-pink">
                  <Icon name={CARD_ICONS[i]} className="size-6" />
                </span>
                <span className="ltr font-brand text-xs text-faint">{c.en}</span>
              </div>
              <h3 className="mt-6 text-xl font-bold">{c.title}</h3>
              <p className="justified-fa mt-2.5 text-[15px] leading-7 text-muted">{c.body}</p>
            </article>
          ))}
        </SpotlightGroup>

        <ul data-reveal className="mt-8 flex flex-wrap justify-center gap-x-8 gap-y-3 text-sm text-muted">
          {a.principles.map((p) => (
            <li key={p} className="flex items-center gap-2">
              <Icon name="shield" className="size-4.5 text-success" />
              {p}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
