"use client";

import { errorCopy } from "@/content/copy/errors";
import { FONT_VARS_LAZY } from "@/fonts/lazy";
import "./globals.css";

/**
 * The last resort when even the site's frame fails: its own document (no layouts run), both languages,
 * «try again» and home. Kept free of effects so it always renders.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const fa = errorCopy.fa.error;
  const en = errorCopy.en.error;
  return (
    <html lang="fa" dir="rtl" className={FONT_VARS_LAZY}>
      <body className="font-sans antialiased">
        <title>{`${fa.title} — سلین`}</title>
        <main className="relative isolate flex min-h-[100svh] items-center overflow-clip bg-mesh-espresso text-on-night">
          <span aria-hidden className="grain" />
          <div className="container-lux relative py-16 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/celin-logo-reverse.svg" alt="سلین — CELIN" width={794} height={379} className="mx-auto h-16 w-auto sm:h-20" />
            <svg aria-hidden viewBox="0 0 10 14" className="mx-auto mt-12 h-16 w-auto text-gold-bright">
              <path d="M5 0 10 7 5 14 0 7Z" fill="currentColor" />
            </svg>
            <h1 className="title-page mt-8 text-metal-light">{fa.title}</h1>
            <p className="mx-auto mt-5 max-w-lg text-lg leading-9 text-on-night-muted">{fa.body}</p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
              <button type="button" onClick={() => retry()} className="btn btn-metal h-13 px-8">
                {fa.retry}
              </button>
              <a href="/" className="btn btn-line-light h-13">
                {fa.home}
              </a>
            </div>
            <div lang="en" dir="ltr" className="mx-auto mt-12 max-w-lg border-t border-night-line pt-8">
              <p className="title-section">{en.title}</p>
              <p className="mt-3 text-base leading-7 text-on-night-muted">{en.body}</p>
              <p className="mt-5 flex items-center justify-center gap-6 text-sm">
                <button type="button" onClick={() => retry()} className="border-b border-on-night/40 pb-1 hover:border-gold-on-dark">
                  {en.retry}
                </button>
                <a href="/en" className="border-b border-on-night/40 pb-1 hover:border-gold-on-dark">
                  {en.home}
                </a>
              </p>
            </div>
            {error.digest && (
              <p className="mt-10 text-xs text-on-night-muted">
                {fa.ref} · {en.ref}: <span className="ltr font-label">{error.digest}</span>
              </p>
            )}
          </div>
        </main>
      </body>
    </html>
  );
}
