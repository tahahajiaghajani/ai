import Link from "next/link";
import { listPosts } from "@/lib/blog";
import { href, type Lang } from "@/lib/i18n";
import type { Copy } from "@/content/fa";
import { SectionHead } from "@/components/home/section-head";
import { PostCard } from "@/components/blog/post-card";

/** The three newest articles (hidden while the blog is empty). */
export async function BlogTeaser({ lang, t }: { lang: Lang; t: Copy }) {
  const posts = await listPosts(lang, 3);
  if (!posts.length) return null;
  return (
    <section id="blog" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHead kicker={t.blog.kicker} title={t.blog.latest} />
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {posts.map((p, i) => (
            <PostCard key={p.id} post={p} lang={lang} t={t.blog} i={i} />
          ))}
        </div>
        <Link data-reveal href={href(lang, "/blog")} className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-violet hover:text-fg">
          {t.blog.all}
          <span aria-hidden>{lang === "fa" ? "←" : "→"}</span>
        </Link>
      </div>
    </section>
  );
}
