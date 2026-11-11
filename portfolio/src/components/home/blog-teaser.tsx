import Link from "next/link";
import type { Lang } from "@/lib/i18n";
import { href } from "@/lib/i18n";
import { ui } from "@/content/ui";
import { POSTS } from "@/content/blog";
import { SectionHead } from "@/components/home/section-head";
import { PostCard } from "@/components/blog/post-card";

/** The latest post on the home page, with a way into the blog. */
export function BlogTeaser({ lang, index }: { lang: Lang; index: string }) {
  const latest = POSTS[0];
  if (!latest) return null;
  const fa = lang === "fa";
  return (
    <section id="blog" className="mx-auto max-w-[1800px] px-5 py-24 md:px-10 md:py-36">
      <SectionHead
        lang={lang}
        index={index}
        eyebrow={ui.sections.blog[lang]}
        title={fa ? <>یادداشت‌ها <span className="font-light">و رویدادها</span></> : <>Notes <span className="font-serif font-normal italic">&amp; events</span></>}
        aside={
          <Link href={href(lang, "/blog")} className="inline-flex items-center gap-3 text-[0.95rem] font-medium">
            <span className="link-draw pb-0.5">{ui.blog.all[lang]}</span>
            <span aria-hidden>{fa ? "←" : "→"}</span>
          </Link>
        }
      />
      <div className="mt-14 border-b border-line md:mt-20">
        <PostCard p={latest} lang={lang} headingLevel={3} />
      </div>
    </section>
  );
}
