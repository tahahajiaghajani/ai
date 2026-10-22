import type { CSSProperties } from "react";
import { listPosts } from "@/lib/blog";
import { copy, type Lang } from "@/lib/i18n";
import { PostCard } from "@/components/blog/post-card";
import { RevealObserver } from "@/components/site/reveal-observer";

export async function BlogIndex({ lang }: { lang: Lang }) {
  const t = copy(lang).blog;
  const posts = await listPosts(lang);
  return (
    <section className="relative isolate min-h-[100svh] overflow-hidden pb-28 pt-[calc(var(--header-h)+3.5rem)]">
      <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(60%_70%_at_50%_0%,rgb(143_134_255/0.16),transparent_70%)]" />
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="hero-in mb-12 max-w-2xl">
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
        {posts.length === 0 ? (
          <p className="rounded-3xl border border-dashed border-line-strong px-6 py-16 text-center text-muted">{t.empty}</p>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {posts.map((p, i) => (
              <PostCard key={p.id} post={p} lang={lang} t={t} i={i % 3} heading="h2" />
            ))}
          </div>
        )}
      </div>
      <RevealObserver />
    </section>
  );
}
