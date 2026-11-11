import Link from "next/link";
import type { Lang } from "@/lib/i18n";
import { href, num } from "@/lib/i18n";
import { ui } from "@/content/ui";
import { POSTS } from "@/content/blog";
import { PostCard } from "@/components/blog/post-card";

/** The blog: every post, newest first, one card each. */
export function BlogIndex({ lang }: { lang: Lang }) {
  const fa = lang === "fa";
  return (
    <section className="mx-auto max-w-[1800px] px-5 pb-24 pt-32 md:px-10 md:pb-36 md:pt-40">
      <div className="flex items-center justify-between gap-4 border-b border-line pb-4 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted">
        <Link href={href(lang, "/")} className={`link-draw ${fa ? "font-fa text-[0.8rem] normal-case tracking-normal" : ""}`}>
          {fa ? "→" : "←"} {ui.nav.home[lang]}
        </Link>
        <span>
          {num(lang, String(POSTS.length).padStart(2, "0"))} {fa ? <span className="font-fa text-[0.8rem] normal-case tracking-normal">نوشته</span> : POSTS.length === 1 ? "post" : "posts"}
        </span>
      </div>
      <div className="grid grid-cols-12 gap-x-4 gap-y-8 pb-16 pt-12 md:pb-24 md:pt-16">
        <h1 data-split className={`col-span-12 text-giant md:col-span-8 ${fa ? "font-black leading-[1.2]" : "font-semibold leading-[0.92] tracking-[-0.05em]"}`}>{ui.blog.title[lang]}</h1>
        <p data-fade className="col-span-12 self-end text-lead leading-[1.45] text-fg-2 md:col-span-4">{ui.blog.lead[lang]}</p>
      </div>
      <div className="border-b border-line">
        {POSTS.map((p, i) => (
          <PostCard key={p.slug} p={p} lang={lang} priority={i === 0} />
        ))}
      </div>
    </section>
  );
}
