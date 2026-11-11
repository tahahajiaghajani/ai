import Link from "next/link";
import type { Media as MediaData, Post as PostData, PostBlock, Span } from "@/content/types";
import type { Lang } from "@/lib/i18n";
import { href, num } from "@/lib/i18n";
import { ui } from "@/content/ui";
import { getProject } from "@/content/projects";
import { postImages } from "@/content/blog";
import { siteUrl } from "@/lib/seo";
import { Media, Caption } from "@/components/work/media";
import { Prose } from "@/components/work/prose";
import { LightboxProvider, LightboxTrigger } from "@/components/blog/lightbox";
import { PostMeta } from "@/components/blog/post-card";

const SPAN: Record<Span, string> = {
  3: "md:col-span-3",
  4: "md:col-span-4",
  5: "md:col-span-5",
  6: "md:col-span-6",
  7: "md:col-span-7",
  8: "md:col-span-8",
  12: "md:col-span-12",
};

// where a lone picture starts so that it ends with the text column (Tailwind needs the literal class names)
const ALONE: Partial<Record<Span, string>> = { 3: "md:col-start-10", 4: "md:col-start-9", 5: "md:col-start-8", 6: "md:col-start-7", 7: "md:col-start-6", 8: "md:col-start-5" };

function Label({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow eyebrow-fa mb-6 md:sticky md:top-28">{children}</p>;
}

/** A picture of the post: revealed from a mask as it enters, opening the viewer at its place when pressed. */
function Figure({ m, lang, index, sizes }: { m: MediaData; lang: Lang; index: number; sizes: string }) {
  if (m.kind !== "image") return null;
  return (
    <figure>
      <LightboxTrigger index={index} label={`${ui.blog.open[lang]}: ${m.alt[lang]}`} cue={ui.blog.open[lang]}>
        <div data-reveal className="overflow-hidden rounded-[6px] border border-line">
          <div data-reveal-inner>
            <Media m={m} lang={lang} sizes={sizes} />
          </div>
        </div>
      </LightboxTrigger>
      {m.caption ? <Caption lang={lang}>{m.caption[lang]}</Caption> : null}
    </figure>
  );
}

/**
 * A blog post, told like a case study: the title and standfirst, the cover beside the facts, then text, lists,
 * pictures and quotes, and finally its sources and related work. Every picture opens in one shared viewer.
 */
export function Post({ p, lang }: { p: PostData; lang: Lang }) {
  const fa = lang === "fa";
  const images = postImages(p);
  const at = (m: MediaData) => (m.kind === "image" ? images.indexOf(m) : -1);
  const related = (p.related ?? []).map(getProject).filter((x): x is NonNullable<typeof x> => x !== undefined);
  const cover = p.cover;
  const coverUrl = cover.kind === "image" ? cover.src : p.og;

  // what search engines read about the post (no visitor data; < escaped so the text cannot close the script)
  const ld = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: p.title[lang],
    description: p.dek[lang],
    datePublished: p.date,
    inLanguage: lang,
    image: [`${siteUrl}${coverUrl}`, `${siteUrl}${p.og}`],
    author: { "@type": "Person", name: fa ? "طاها آقاجانی" : "Taha Aghajani", url: `${siteUrl}${href(lang, "/")}` },
    mainEntityOfPage: `${siteUrl}${href(lang, `/blog/${p.slug}`)}`,
  }).replace(/</g, "\\u003c");

  return (
    <LightboxProvider
      lang={lang}
      images={images.map((m) => ({ src: m.src, w: m.w, h: m.h, alt: m.alt[lang], caption: m.caption?.[lang] }))}
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} />
      <article>
        {/* ---------------------------------------------------------------- opening */}
        <header className="mx-auto max-w-[1800px] px-5 pt-32 md:px-10 md:pt-40">
          <div className="flex items-center justify-between gap-4 border-b border-line pb-4 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted">
            <Link href={href(lang, "/blog")} className={`link-draw shrink-0 whitespace-nowrap ${fa ? "font-fa text-[0.8rem] normal-case tracking-normal" : ""}`}>
              {fa ? "→" : "←"} {ui.blog.back[lang]}
            </Link>
            <PostMeta p={p} lang={lang} className="justify-end" />
          </div>
          <p data-fade className="mt-12 text-sm text-muted md:mt-16">{p.kicker[lang]}</p>
          <h1 data-split className={`mt-5 max-w-[22ch] text-display ${fa ? "font-black leading-[1.3]" : "font-semibold leading-[0.98] tracking-[-0.045em]"}`}>{p.title[lang]}</h1>
          <p data-fade className="mt-10 max-w-[58ch] text-lead leading-[1.5] text-fg-2">{p.dek[lang]}</p>
        </header>

        {/* ---------------------------------------------------------------- cover + facts */}
        <div className="mx-auto mt-14 grid max-w-[1800px] grid-cols-12 gap-x-4 gap-y-10 px-5 md:mt-20 md:px-10">
          <figure className="col-span-12 lg:col-span-8">
            <LightboxTrigger index={at(cover)} label={`${ui.blog.open[lang]}: ${cover.alt[lang]}`} cue={ui.blog.open[lang]}>
              <div data-reveal className="relative aspect-[3/2] overflow-hidden rounded-[6px] border border-line">
                <div data-parallax="0.1" className="absolute -inset-y-[6%] inset-x-0">
                  <div data-reveal-inner className="absolute inset-0">
                    <Media m={cover} lang={lang} fill priority sizes="(min-width: 1024px) 64vw, 100vw" />
                  </div>
                </div>
              </div>
            </LightboxTrigger>
            {cover.caption ? <Caption lang={lang}>{cover.caption[lang]}</Caption> : null}
          </figure>
          <dl className="col-span-12 self-end border-t border-line lg:col-span-4">
            {p.facts.map((f) => (
              <div key={f.k.en} data-fade className="border-b border-line py-5">
                <dt className="eyebrow eyebrow-fa mb-2">{f.k[lang]}</dt>
                <dd className="text-[0.98rem] leading-snug">{f.v[lang]}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* ---------------------------------------------------------------- body */}
        <div className="mx-auto grid max-w-[1800px] gap-y-20 px-5 py-24 md:gap-y-28 md:px-10 md:py-36">
          {p.blocks.map((b, i) => (
            <Block key={i} b={b} lang={lang} at={at} />
          ))}
        </div>

        {/* ---------------------------------------------------------------- sources, related work */}
        <section className="mx-auto grid max-w-[1800px] grid-cols-12 gap-x-4 gap-y-10 border-t border-line px-5 py-20 md:px-10">
          {p.sources?.length ? (
            <>
              <div className="col-span-12 md:col-span-3"><p className="eyebrow eyebrow-fa">{ui.blog.sources[lang]}</p></div>
              <ol className="col-span-12 grid gap-3 md:col-span-9">
                {p.sources.map((s, i) => (
                  <li key={s.href} className="flex items-baseline gap-4">
                    <span className="font-mono text-xs text-faint">{num(lang, String(i + 1).padStart(2, "0"))}</span>
                    <a href={s.href} target="_blank" rel="noopener noreferrer" className="link-draw text-[0.95rem] leading-relaxed text-fg-2 hover:text-fg">
                      {s.label[lang]} ↗
                    </a>
                  </li>
                ))}
              </ol>
            </>
          ) : null}
          {related.length ? (
            <>
              <div className="col-span-12 md:col-span-3"><p className="eyebrow eyebrow-fa">{ui.blog.related[lang]}</p></div>
              <ul className="col-span-12 grid gap-px border border-line bg-line sm:grid-cols-2 md:col-span-9">
                {related.map((r) => (
                  <li key={r.slug} className="bg-bg">
                    <Link href={href(lang, `/work/${r.slug}`)} className="group flex h-full flex-col gap-3 p-6 md:p-8" data-cursor-label={ui.work.view[lang]}>
                      <span className="text-sm text-muted">{r.kicker[lang]}</span>
                      <span className={`text-[clamp(1.2rem,1.8vw,1.6rem)] transition-transform duration-700 ease-[var(--ease-out-expo)] group-hover:translate-x-1.5 rtl:group-hover:-translate-x-1.5 ${fa ? "font-bold leading-[1.4]" : "font-semibold leading-tight tracking-[-0.02em]"}`}>{r.title[lang]}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {p.note ? <p className="col-span-12 text-sm text-muted md:col-span-9 md:col-start-4">{p.note[lang]}</p> : null}
        </section>

        {/* ---------------------------------------------------------------- back to all posts */}
        <Link href={href(lang, "/blog")} className="group block border-t border-line" data-cursor-label={ui.blog.all[lang]}>
          <div className="mx-auto max-w-[1800px] px-5 py-20 md:px-10 md:py-28">
            <p className="eyebrow eyebrow-fa mb-6">{ui.blog.title[lang]}</p>
            <p className={`text-giant transition-transform duration-700 ease-[var(--ease-out-expo)] group-hover:translate-x-3 rtl:group-hover:-translate-x-3 ${fa ? "font-black leading-[1.2]" : "font-semibold leading-[0.92] tracking-[-0.05em]"}`}>
              {ui.blog.all[lang]} <span aria-hidden>{fa ? "←" : "→"}</span>
            </p>
          </div>
        </Link>
      </article>
    </LightboxProvider>
  );
}

function Block({ b, lang, at }: { b: PostBlock; lang: Lang; at: (m: MediaData) => number }) {
  const fa = lang === "fa";
  if (b.kind === "text") {
    return (
      <section className="grid grid-cols-12 gap-x-4 gap-y-4">
        <div className="col-span-12 md:col-span-3">{b.heading ? <Label>{b.heading[lang]}</Label> : null}</div>
        <div data-fade className="col-span-12 md:col-span-8 md:col-start-5">
          <Prose text={b.text[lang]} big />
        </div>
      </section>
    );
  }
  if (b.kind === "list") {
    return (
      <section className="grid grid-cols-12 gap-x-4 gap-y-4">
        <div className="col-span-12 md:col-span-3">{b.heading ? <Label>{b.heading[lang]}</Label> : null}</div>
        <ol className="col-span-12 grid gap-px border border-line bg-line sm:grid-cols-2 md:col-span-8 md:col-start-5">
          {b.items[lang].map((x, i) => (
            // an odd last item takes the whole row, so no empty cell shows the rule colour
            <li key={i} data-fade className="flex gap-5 bg-bg p-6 sm:last:odd:col-span-2 md:p-7">
              <span className="font-mono text-xs text-faint">{num(lang, String(i + 1).padStart(2, "0"))}</span>
              <span className="min-w-0 flex-1 text-start leading-relaxed text-fg-2">{x}</span>
            </li>
          ))}
        </ol>
      </section>
    );
  }
  if (b.kind === "quote") {
    return (
      <figure className="grid grid-cols-12 gap-x-4">
        <blockquote data-split className={`col-span-12 text-title md:col-span-8 md:col-start-5 ${fa ? "font-bold leading-[1.35]" : "font-serif italic leading-[1.1]"}`}>
          {fa ? `«${b.text[lang]}»` : `“${b.text[lang]}”`}
        </blockquote>
        {b.cite ? <Caption lang={lang} className="col-span-12 mt-6 md:col-span-8 md:col-start-5">{b.cite[lang]}</Caption> : null}
      </figure>
    );
  }
  const items = b.kind === "figure" ? [b.media] : b.items;
  // a picture alone that does not fill the row lines up with the text column
  const alone = items.length === 1;
  return (
    <div className="grid items-end gap-x-6 gap-y-14 md:grid-cols-12">
      {items.map((m) => {
        const span = (m.kind !== "art" && m.span) || (m.kind === "image" && m.h > m.w * 1.15 ? 4 : 12);
        return (
          <div key={m.kind === "image" ? m.src : at(m)} className={`${SPAN[span]} ${alone ? (ALONE[span] ?? "") : ""}`}>
            <Figure m={m} lang={lang} index={at(m)} sizes={span === 12 ? "(min-width: 1800px) 1720px, 100vw" : `(min-width: 768px) ${Math.round((span / 12) * 100)}vw, 100vw`} />
          </div>
        );
      })}
    </div>
  );
}
