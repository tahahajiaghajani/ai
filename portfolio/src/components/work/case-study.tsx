import Link from "next/link";
import type { Project, Span } from "@/content/types";
import type { Lang } from "@/lib/i18n";
import { href, num } from "@/lib/i18n";
import { ui } from "@/content/ui";
import { PROJECTS, nextProject } from "@/content/projects";
import { ORGS } from "@/content/orgs";
import { Media, MediaFigure } from "@/components/work/media";
import { Diagram } from "@/components/work/diagram";
import { CodeBlock } from "@/components/work/code-block";
import { HoleInspector } from "@/components/work/hole-inspector";
import { DagPlayer } from "@/components/work/dag-player";
import { AuditCentre } from "@/components/work/audit-centre";
import { Prose } from "@/components/work/prose";

const SPAN: Record<Span, string> = {
  3: "md:col-span-3",
  4: "md:col-span-4",
  5: "md:col-span-5",
  6: "md:col-span-6",
  7: "md:col-span-7",
  8: "md:col-span-8",
  12: "md:col-span-12",
};

function Label({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow eyebrow-fa mb-6 md:sticky md:top-28">{children}</p>;
}

export function CaseStudy({ p, lang }: { p: Project; lang: Lang }) {
  const fa = lang === "fa";
  const index = PROJECTS.findIndex((x) => x.slug === p.slug) + 1;
  const next = nextProject(p.slug);
  const facts = [
    { k: ui.work.role[lang], v: p.role[lang] },
    { k: ui.work.period[lang], v: p.period[lang] },
    { k: ui.work.context[lang], v: p.context[lang] },
    { k: ui.work.status[lang], v: p.status[lang] },
  ];
  const orgs = (p.orgs ?? []).map((k) => ORGS.find((o) => o.key === k)).filter(Boolean);

  return (
    <article>
      {/* ---------------------------------------------------------------- opening */}
      <header className="mx-auto max-w-[1800px] px-5 pt-32 md:px-10 md:pt-40">
        <div className="flex items-center justify-between border-b border-line pb-4 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted">
          <Link href={`${href(lang, "/")}#work`} className="link-draw">
            {fa ? "→" : "←"} {ui.work.back[lang]}
          </Link>
          <span>
            {fa ? "پروژه" : "Case"} {num(lang, String(index).padStart(2, "0"))} / {num(lang, String(PROJECTS.length).padStart(2, "0"))}
          </span>
        </div>
        <p data-fade className="mt-12 text-sm text-muted md:mt-16">{p.kicker[lang]}</p>
        <h1 data-split className={`mt-5 max-w-[18ch] text-display ${fa ? "font-black leading-[1.25]" : "font-semibold leading-[0.95] tracking-[-0.045em]"}`}>
          {p.title[lang]}
        </h1>
        <p data-fade className="mt-10 max-w-[52ch] text-lead leading-[1.45] text-fg-2">{p.oneLiner[lang]}</p>
        <dl className="mt-14 grid grid-cols-2 border-t border-line md:grid-cols-4">
          {facts.map((f) => (
            <div key={f.k} data-fade className="border-b border-line py-5 pe-4 md:border-b-0">
              <dt className="eyebrow eyebrow-fa mb-2">{f.k}</dt>
              <dd className="text-[0.95rem] leading-snug">{f.v}</dd>
            </div>
          ))}
        </dl>
      </header>

      <div className="mx-auto mt-12 max-w-[1800px] px-5 md:px-10">
        <div className="relative aspect-[16/9] overflow-hidden rounded-[6px] border border-line md:aspect-[21/9]">
          <div data-parallax="0.12" className="absolute -inset-y-[8%] inset-x-0">
            <Media m={p.cover} lang={lang} fill priority sizes="100vw" />
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------------- story */}
      <section className="mx-auto grid max-w-[1800px] grid-cols-12 gap-x-4 gap-y-6 px-5 py-24 md:px-10 md:py-36">
        <div className="col-span-12 md:col-span-3"><Label>{ui.work.challenge[lang]}</Label></div>
        <div className="col-span-12 md:col-span-8 md:col-start-5"><Prose text={p.challenge[lang]} big /></div>
        <div className="col-span-12 mt-16 md:col-span-3"><Label>{ui.work.approach[lang]}</Label></div>
        <div className="col-span-12 md:col-span-8 md:col-start-5 md:mt-16"><Prose text={p.approach[lang]} big /></div>
      </section>

      {p.architecture ? (
        <section className="border-y border-line bg-bg-2">
          <div className="mx-auto max-w-[1800px] px-5 py-20 md:px-10 md:py-28">
            <Label>{ui.work.architecture[lang]}</Label>
            <Diagram data={p.architecture} lang={lang} />
          </div>
        </section>
      ) : null}

      {p.interactive === "hole-inspector" ? (
        <section className="mx-auto max-w-[1800px] px-5 pt-24 md:px-10 md:pt-32">
          <Label>{fa ? "بازپخش داده‌ی واقعی" : "Replay the real data"}</Label>
          <HoleInspector lang={lang} />
        </section>
      ) : null}

      {p.interactive === "audit-centre" ? (
        <section className="mx-auto max-w-[1800px] px-5 pt-24 md:px-10 md:pt-32">
          <Label>{fa ? "ایده‌ی مرکز حسابرسی" : "The audit-centre idea"}</Label>
          <AuditCentre lang={lang} />
        </section>
      ) : null}

      {p.interactive === "dag-player" ? (
        <section className="mx-auto max-w-[1800px] px-5 pt-24 md:px-10 md:pt-32">
          <Label>{fa ? "موتور ورکفلو، گام به گام" : "The workflow engine, step by step"}</Label>
          <DagPlayer lang={lang} />
        </section>
      ) : null}

      {/* ---------------------------------------------------------------- what it does + outcome */}
      <section className="mx-auto grid max-w-[1800px] grid-cols-12 gap-x-4 px-5 py-24 md:px-10 md:py-32">
        <div className="col-span-12 md:col-span-3"><Label>{ui.work.features[lang]}</Label></div>
        <ol className="col-span-12 grid gap-px border border-line bg-line md:col-span-9 md:grid-cols-2">
          {p.features[lang].map((f, i) => (
            <li key={i} data-fade className="flex gap-5 bg-bg p-6 md:p-8">
              <span className="font-mono text-xs text-faint">{num(lang, String(i + 1).padStart(2, "0"))}</span>
              <span className="leading-relaxed text-fg-2">{f}</span>
            </li>
          ))}
        </ol>
      </section>

      {p.outcomes.length ? (
        <section className="tone-invert">
          <div className="mx-auto max-w-[1800px] px-5 py-24 md:px-10 md:py-32">
            <Label>{ui.work.outcomes[lang]}</Label>
            <dl className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
              {p.outcomes.map((o, i) => (
                <div key={i} data-fade className="flex flex-col justify-between gap-10 bg-bg p-6 md:p-8">
                  <dd className="latin order-1 text-[clamp(2.6rem,5vw,4.6rem)] font-semibold leading-none tracking-[-0.05em]">{o.value[lang]}</dd>
                  <dt className="order-2 text-[0.92rem] leading-snug text-fg-2">{o.label[lang]}</dt>
                </div>
              ))}
            </dl>
          </div>
        </section>
      ) : null}

      {p.gallery.length ? (
        <section className="mx-auto max-w-[1800px] px-5 py-24 md:px-10 md:py-32">
          <Label>{ui.work.gallery[lang]}</Label>
          <div className="grid items-center gap-x-6 gap-y-14 md:grid-cols-12">
            {p.gallery.map((m, i) => {
              const span = (m.kind !== "art" && m.span) || (m.kind === "image" && m.h > m.w * 1.15 ? 4 : 12);
              return (
                <div key={i} className={SPAN[span]}>
                  <MediaFigure m={m} lang={lang} sizes={span === 12 ? "100vw" : `(min-width: 768px) ${Math.round((span / 12) * 100)}vw, 100vw`} />
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {p.code?.length ? (
        <section className="border-t border-line">
          <div className="mx-auto grid max-w-[1800px] grid-cols-12 gap-x-4 px-5 py-24 md:px-10 md:py-32">
            <div className="col-span-12 md:col-span-3"><Label>{ui.work.code[lang]}</Label></div>
            {/* min-w-0: long code lines scroll inside their block instead of widening the page */}
            <div className="col-span-12 grid min-w-0 grid-cols-1 gap-8 md:col-span-9">
              {p.code.map((c, i) => (
                <div key={i} data-fade className="min-w-0">
                  <CodeBlock code={c.code} lang={c.lang} file={c.file} title={c.title[lang]} />
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="mx-auto grid max-w-[1800px] grid-cols-12 gap-x-4 gap-y-10 border-t border-line px-5 py-20 md:px-10">
        <div className="col-span-12 md:col-span-3"><p className="eyebrow eyebrow-fa">{ui.work.stack[lang]}</p></div>
        <ul className="col-span-12 flex flex-wrap gap-2 md:col-span-9" dir="ltr">
          {p.stack.map((s) => (
            <li key={s} className="rounded-full border border-line px-4 py-2 font-mono text-[0.72rem] text-fg-2">{s}</li>
          ))}
        </ul>
        {orgs.length || p.links?.length ? (
          <>
            <div className="col-span-12 md:col-span-3"><p className="eyebrow eyebrow-fa">{ui.work.links[lang]}</p></div>
            <div className="col-span-12 flex flex-wrap items-center gap-6 md:col-span-9">
              {orgs.map((o) => (
                <span key={o!.key} className="text-sm text-fg-2">{o!.name[lang]}</span>
              ))}
              {p.links?.map((l) => (
                <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="link-draw text-sm">{l.label[lang]} ↗</a>
              ))}
            </div>
          </>
        ) : null}
        {p.note ? <p className="col-span-12 text-sm text-muted md:col-span-9 md:col-start-4">{p.note[lang]}</p> : null}
      </section>

      {/* ---------------------------------------------------------------- next */}
      <Link href={href(lang, `/work/${next.slug}`)} className="group block border-t border-line" data-cursor-label={ui.work.view[lang]}>
        <div className="mx-auto grid max-w-[1800px] items-end gap-8 px-5 py-20 md:grid-cols-12 md:px-10 md:py-28">
          <div className="md:col-span-8">
            <p className="eyebrow eyebrow-fa mb-6">{ui.work.next[lang]}</p>
            <p className={`text-giant transition-transform duration-700 ease-[var(--ease-out-expo)] group-hover:translate-x-3 rtl:group-hover:-translate-x-3 ${fa ? "font-black leading-[1.2]" : "font-semibold leading-[0.92] tracking-[-0.05em]"}`}>{next.title[lang]}</p>
          </div>
          <div className="relative aspect-[4/3] overflow-hidden rounded-[6px] border border-line md:col-span-4">
            <div className="absolute inset-0 transition-transform duration-1000 ease-[var(--ease-out-expo)] group-hover:scale-105">
              <Media m={next.cover} lang={lang} fill sizes="(min-width: 768px) 33vw, 100vw" />
            </div>
          </div>
        </div>
      </Link>
    </article>
  );
}
