import Link from "next/link";
import type { CSSProperties } from "react";
import type { Post } from "@/lib/blog-shared";
import { listPosts } from "@/lib/blog";
import { env } from "@/lib/env";
import { copy, href, type Lang } from "@/lib/i18n";
import { ArticleBody, headings } from "@/components/blog/article-body";
import { textDir } from "@/components/chat/markdown";
import { AskButton } from "@/components/blog/ask-button";
import { PostCard, PostMeta } from "@/components/blog/post-card";
import { RevealObserver } from "@/components/site/reveal-observer";

function postJsonLd(post: Post, lang: Lang): string {
  const url = `${env.siteUrl}${href(lang, `/blog/${post.slug}`)}`;
  const data = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt,
    inLanguage: lang === "fa" ? "fa-IR" : "en",
    datePublished: post.published_at ?? undefined,
    dateModified: post.updated_at,
    mainEntityOfPage: url,
    url,
    keywords: post.tags.join(", ") || undefined,
    image: post.cover_url || undefined,
    author: { "@type": "Organization", "@id": `${env.siteUrl}/#org`, name: "Pars Project Management" },
    publisher: { "@id": `${env.siteUrl}/#org` },
  };
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export async function PostView({ post, lang }: { post: Post; lang: Lang }) {
  const t = copy(lang).blog;
  const toc = headings(post.body).filter((h) => h.level === 2);
  const more = (await listPosts(lang)).filter((p) => p.id !== post.id).slice(0, 3);
  return (
    <article className="relative isolate overflow-hidden pb-24 pt-[calc(var(--header-h)+3rem)]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: postJsonLd(post, lang) }} />
      <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-[460px] bg-[radial-gradient(60%_70%_at_50%_0%,rgb(143_134_255/0.14),transparent_70%)]" />
      <div className="mx-auto max-w-3xl px-5 sm:px-8">
        <div className="hero-in">
          <Link style={{ "--d": 0 } as CSSProperties} href={href(lang, "/blog")} className="kicker hover:text-fg">
            {t.back}
          </Link>
          <h1 style={{ "--d": 1 } as CSSProperties} dir={textDir(post.title)} className="display mt-5 text-[clamp(1.45rem,2.9vw,2.1rem)] text-balance">
            {post.title}
          </h1>
          <div style={{ "--d": 2 } as CSSProperties} className="mt-4">
            <PostMeta post={post} lang={lang} t={t} />
          </div>
          {post.excerpt && (
            <p style={{ "--d": 3 } as CSSProperties} className="mt-6 text-[1.05rem] leading-9 text-fg/80">
              {post.excerpt}
            </p>
          )}
        </div>

        {post.cover_url && (
          // eslint-disable-next-line @next/next/no-img-element -- admin-provided remote image of unknown size
          <img src={post.cover_url} alt="" className="mt-10 w-full rounded-3xl border border-line" />
        )}

        {toc.length >= 3 && (
          <nav aria-label={t.contents} className="mt-10 rounded-2xl border border-line bg-white/[0.02] p-5">
            <div className="text-xs font-semibold text-violet">{t.contents}</div>
            <ol className="mt-3 space-y-1.5 text-sm">
              {toc.map((h) => (
                <li key={h.id}>
                  <a href={`#${h.id}`} dir={textDir(h.text)} className="text-muted hover:text-fg">
                    {h.text}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        )}

        <div className="mt-8 text-[1.02rem] leading-9 text-fg/85 [html[lang=en]_&]:leading-8">
          <ArticleBody text={post.body} />
        </div>

        {post.tags.length > 0 && (
          <ul className="mt-10 flex flex-wrap gap-2">
            {post.tags.map((tag, j) => (
              <li key={`${j}-${tag}`} className="rounded-full border border-line px-3 py-1 text-xs text-muted">
                {tag}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-14 rounded-3xl border border-line-strong bg-[radial-gradient(120%_120%_at_100%_0%,rgb(223_17_115/0.12),transparent_60%)] p-7 sm:p-9">
          <h2 className="text-xl font-semibold">{t.ctaTitle}</h2>
          <p className="mt-2 text-[15px] leading-8 text-muted">{t.ctaLead}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <AskButton className="inline-flex h-11 items-center rounded-full bg-reverse px-5 text-sm font-semibold text-white">{t.ctaAsk}</AskButton>
            <Link href={`${href(lang, "/support")}?category=demo`} className="inline-flex h-11 items-center rounded-full border border-line-strong px-5 text-sm text-fg hover:bg-white/5">
              {t.ctaTicket}
            </Link>
          </div>
        </div>
      </div>

      {more.length > 0 && (
        <div className="mx-auto mt-20 max-w-6xl px-5 sm:px-8">
          <h2 className="kicker">
            {t.more}
          </h2>
          <div className="mt-6 grid gap-5 md:grid-cols-3">
            {more.map((p, i) => (
              <PostCard key={p.id} post={p} lang={lang} t={t} i={i} />
            ))}
          </div>
        </div>
      )}
      <RevealObserver />
    </article>
  );
}
