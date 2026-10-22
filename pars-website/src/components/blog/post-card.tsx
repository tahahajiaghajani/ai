import Link from "next/link";
import type { CSSProperties } from "react";
import type { Post } from "@/lib/blog-shared";
import { readingMinutes } from "@/lib/blog-shared";
import { formatDate, href, num, type Lang } from "@/lib/i18n";
import type { Copy } from "@/content/fa";
import { textDir } from "@/components/chat/markdown";

export function PostMeta({ post, lang, t }: { post: Post; lang: Lang; t: Copy["blog"] }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
      {post.published_at && <time dateTime={post.published_at}>{formatDate(post.published_at, lang, false)}</time>}
      <span aria-hidden className="size-1 rounded-full bg-pink/60" />
      <span>
        {num(readingMinutes(post.body), lang)} {t.minutes}
      </span>
    </span>
  );
}

/** `heading` follows the page outline: h2 on the blog index (under its h1), h3 under a section heading. */
export function PostCard({ post, lang, t, i = 0, heading: Heading = "h3" }: { post: Post; lang: Lang; t: Copy["blog"]; i?: number; heading?: "h2" | "h3" }) {
  return (
    <article data-reveal style={{ "--d": i } as CSSProperties} className="card group relative flex flex-col p-6 transition duration-500 hover:-translate-y-1 hover:border-line-strong sm:p-7">
      <PostMeta post={post} lang={lang} t={t} />
      <Heading dir={textDir(post.title)} className="mt-4 text-lg font-semibold leading-8 text-fg">
        <Link href={href(lang, `/blog/${post.slug}`)} className="after:absolute after:inset-0 after:rounded-[1.5rem]">
          {post.title}
        </Link>
      </Heading>
      <p className="mt-3 line-clamp-3 text-[15px] leading-7 text-muted max-md:justified-fa lg:justified-fa">{post.excerpt}</p>
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-6">
        {post.tags.slice(0, 3).map((tag, j) => (
          <span key={`${j}-${tag}`} className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[11px] text-muted">
            {tag}
          </span>
        ))}
        <span aria-hidden className="ms-auto text-sm text-violet transition group-hover:translate-x-[-4px] ltr:group-hover:translate-x-1">
          {lang === "fa" ? "←" : "→"}
        </span>
      </div>
    </article>
  );
}
