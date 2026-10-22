import type { CSSProperties } from "react";
import { CONSULTING, OTHER_CLIENTS, SOFTWARE, TRAINING } from "@/content/records";
import { copy, num, type Lang } from "@/lib/i18n";
import { RevealObserver } from "@/components/site/reveal-observer";

function Head({ id, title, lead }: { id: string; title: string; lead: string }) {
  return (
    <div data-reveal className="max-w-2xl">
      <h2 id={id} className="scroll-mt-28 text-[clamp(1.2rem,2.1vw,1.55rem)] font-semibold">
        {title}
      </h2>
      <p className="mt-2 text-[15px] leading-8 text-muted">{lead}</p>
    </div>
  );
}

export function RecordsPage({ lang }: { lang: Lang }) {
  const t = copy(lang).records;
  const consulting = CONSULTING.reduce((n, g) => n + g.items.length, 0);
  const trained = new Set(TRAINING.flatMap((g) => g.items.map((i) => i.org.fa))).size;
  const stats = [
    { value: SOFTWARE.length, label: t.statSoftware, href: "#software" },
    { value: consulting, label: t.statConsulting, href: "#consulting" },
    { value: trained, label: t.statTraining, href: "#training" },
  ];
  return (
    <section className="relative isolate overflow-hidden pb-28 pt-[calc(var(--header-h)+3.5rem)]">
      <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(60%_70%_at_50%_0%,rgb(143_134_255/0.16),transparent_70%)]" />
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="hero-in max-w-2xl">
          <span style={{ "--d": 0 } as CSSProperties} className="kicker">
            {t.kicker}
          </span>
          <h1 style={{ "--d": 1 } as CSSProperties} className="display mt-4 text-[clamp(1.65rem,3.2vw,2.35rem)]">
            {t.title}
          </h1>
          <p style={{ "--d": 2 } as CSSProperties} className="mt-3 text-base leading-8 text-muted">
            {t.lead}
          </p>
        </div>

        <ul className="mt-12 grid gap-px overflow-hidden rounded-3xl border border-line bg-line sm:grid-cols-3">
          {stats.map((s) => (
            <li key={s.href} className="bg-ink-2">
              <a href={s.href} className="block px-6 py-6 transition-colors hover:bg-ink-3">
                <span className="font-brand text-3xl font-semibold text-gradient" dir="ltr">
                  {num(s.value, lang)}
                </span>
                <span className="mt-1 block text-sm text-muted">{s.label}</span>
              </a>
            </li>
          ))}
        </ul>

        <div className="mt-20 space-y-24">
          <div>
            <Head id="software" title={t.software} lead={t.softwareLead} />
            <ul className="mt-8 grid gap-4 md:grid-cols-2">
              {SOFTWARE.map((r, i) => (
                <li key={r.org.fa} data-reveal style={{ "--d": i % 4 } as CSSProperties} className="card p-6">
                  <h3 className="font-semibold text-fg">{r.org[lang]}</h3>
                  <ul className="mt-3 space-y-1.5 text-[14px] leading-7 text-muted">
                    {r.detail?.map((d) => (
                      <li key={d.fa} className="flex gap-2">
                        <span aria-hidden className="mt-[0.7em] size-1 shrink-0 rounded-full bg-pink/70" />
                        <span>{d[lang]}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <Head id="consulting" title={t.consulting} lead={t.consultingLead} />
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              {CONSULTING.map((g, i) => (
                <div key={g.title.fa} data-reveal style={{ "--d": i } as CSSProperties} className="card p-6">
                  <h3 className="font-semibold text-violet">{g.title[lang]}</h3>
                  <ul className="mt-4 grid gap-x-6 gap-y-2 text-[14px] text-fg/85 sm:grid-cols-2">
                    {g.items.map((it) => (
                      <li key={it.org.fa}>{it.org[lang]}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          <div>
            <Head id="training" title={t.training} lead={t.trainingLead} />
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              {TRAINING.map((g, i) => (
                <div key={g.title.fa} data-reveal style={{ "--d": i % 2 } as CSSProperties} className="card p-6">
                  <h3 className="font-semibold text-violet">{g.title[lang]}</h3>
                  <ul className="mt-4 space-y-2 text-[14px] text-fg/85">
                    {g.items.map((it) => (
                      <li key={it.org.fa} className="flex items-baseline justify-between gap-4">
                        <span>
                          {it.org[lang]}
                          {it.detail?.map((d) => (
                            <span key={d.fa} className="mt-0.5 block text-xs text-muted">
                              {d[lang]}
                            </span>
                          ))}
                        </span>
                        {it.count ? (
                          <span className="shrink-0 rounded-full bg-white/[0.05] px-2.5 py-0.5 text-xs text-muted">
                            {num(it.count, lang)} {it.count === 1 ? t.course : t.courses}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          <div data-reveal>
            <Head id="others" title={t.others} lead={t.othersLead} />
            <ul className="mt-6 flex flex-wrap gap-2">
              {OTHER_CLIENTS.map((c) => (
                <li key={c.fa} className="rounded-full border border-line px-3.5 py-1.5 text-sm text-fg/85">
                  {c[lang]}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <RevealObserver />
    </section>
  );
}
