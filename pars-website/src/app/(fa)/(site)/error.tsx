"use client";

import { Button } from "@/components/ui/field";

/** Unexpected errors below the site layout: the header and footer stay, the copy stays Persian. */
export default function SiteError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <section className="grid min-h-[80svh] place-items-center px-6 pt-[var(--header-h)] text-center">
      <div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/pars-mark-reverse.svg" alt="" className="mx-auto h-16 w-auto" />
        <h1 className="mt-6 text-2xl font-extrabold">مشکلی پیش آمد</h1>
        <p className="mx-auto mt-3 max-w-md leading-8 text-muted">این صفحه بارگذاری نشد. دوباره امتحان کنید یا به صفحه‌ی اصلی برگردید.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button onClick={() => retry()}>دوباره امتحان کنید</Button>
          <a href="/" className="inline-flex h-12 items-center rounded-full border border-line-strong px-6 font-semibold text-fg transition hover:border-pink/60">
            صفحه‌ی اصلی
          </a>
        </div>
      </div>
    </section>
  );
}
