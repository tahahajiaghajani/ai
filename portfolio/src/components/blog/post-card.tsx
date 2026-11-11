import Link from "next/link";
import type { Post } from "@/content/types";
import type { Lang } from "@/lib/i18n";
import { formatDate, href, num } from "@/lib/i18n";
import { ui } from "@/content/ui";
import { Media } from "@/components/work/media";

/** Minutes to read a post's words, at about 200 a minute. */
export function readingMinutes(p: Post, lang: Lang): number {
  const text = [p.dek[lang], ...p.blocks.flatMap((b) => (b.kind === "text" ? [b.text[lang]] : b.kind === "list" ? b.items[lang] : b.kind === "quote" ? [b.text[lang]] : []))].join(" ");
  return Math.max(1, Math.round(text.split(/\s+/).filter(Boolean).length / 200));
}

/** The date line of a post: its publication day and reading time. */
export function PostMeta({ p, lang, className = "" }: { p: Post; lang: Lang; className?: string }) {
  return (
    <p className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-muted ${lang === "fa" ? "font-fa text-[0.8rem] normal-case tracking-normal" : "font-mono text-[0.65rem] uppercase tracking-[0.18em]"} ${className}`}>
      <time dateTime={p.date}>{formatDate(p.date, lang, false)}</time>
      <span className="h-px w-4 bg-line-strong" aria-hidden />
      <span>
        {num(lang, readingMinutes(p, lang))} {ui.blog.minutes[lang]}
      </span>
    </p>
  );
}

/** A post in a list: its cover, date, title and standfirst, the whole card one link. */
export function PostCard({ p, lang, priority = false, headingLevel = 2 }: { p: Post; lang: Lang; priority?: boolean; headingLevel?: 2 | 3 }) {
  const fa = lang === "fa";
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <Link href={href(lang, `/blog/${p.slug}`)} className="group grid grid-cols-12 gap-x-4 gap-y-8 border-t border-line py-10 md:py-14" data-cursor-label={ui.blog.read[lang]}>
      <div className="col-span-12 md:col-span-6 lg:col-span-5">
        <div data-reveal className="relative aspect-[4/3] overflow-hidden rounded-[6px] border border-line">
          <div data-reveal-inner className="absolute inset-0 transition-transform duration-1000 ease-[var(--ease-out-expo)] group-hover:scale-[1.04]">
            <Media m={p.cover} lang={lang} fill priority={priority} sizes="(min-width: 1024px) 40vw, (min-width: 768px) 50vw, 100vw" />
          </div>
        </div>
      </div>
      <div className="col-span-12 flex flex-col gap-6 md:col-span-6 lg:col-span-6 lg:col-start-7">
        <PostMeta p={p} lang={lang} />
        <p className="text-sm text-muted">{p.kicker[lang]}</p>
        <H className={`text-title transition-transform duration-700 ease-[var(--ease-out-expo)] group-hover:translate-x-2 rtl:group-hover:-translate-x-2 ${fa ? "font-bold leading-[1.35]" : "font-semibold leading-[1.02] tracking-[-0.035em]"}`}>{p.title[lang]}</H>
        <p className="max-w-[58ch] leading-relaxed text-fg-2">{p.dek[lang]}</p>
        <span className="mt-auto inline-flex items-center gap-3 pt-4 text-[0.9rem] font-medium">
          <span className="link-draw pb-0.5">{ui.blog.read[lang]}</span>
          <span aria-hidden>{fa ? "←" : "→"}</span>
        </span>
      </div>
    </Link>
  );
}
