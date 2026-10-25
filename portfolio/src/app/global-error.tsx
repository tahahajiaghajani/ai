"use client";

import { useEffect, useState } from "react";
import { inter, vazir } from "@/lib/fonts";
import "./globals.css";

/** The same address is reloaded automatically at most once a minute, so a lasting error never loops. */
const ONCE_PER_MS = 60_000;

/**
 * The last resort when a page breaks in the browser (for example after a new deployment while a tab stayed open):
 * reload once by itself, which is what fixes it, and only show this page if that did not help.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string }; retry: () => void }) {
  const [en, setEn] = useState(false);
  const [reloading, setReloading] = useState(true);

  useEffect(() => {
    setEn(location.pathname === "/en" || location.pathname.startsWith("/en/"));
    console.error("[global-error]", error);
    try {
      const key = `auto-reload:${location.pathname}`;
      const last = Number(sessionStorage.getItem(key) || 0);
      if (Date.now() - last > ONCE_PER_MS) {
        sessionStorage.setItem(key, String(Date.now()));
        location.reload();
        return;
      }
    } catch {
      // storage blocked: never reload automatically, the buttons below still work
    }
    setReloading(false);
  }, [error]);

  return (
    <html lang={en ? "en" : "fa"} dir={en ? "ltr" : "rtl"} className={`${vazir.variable} ${inter.variable}`}>
      <body className="grain">
        <title>{en ? "Something went wrong · Taha Aghajani" : "مشکلی پیش آمد · طاها آقاجانی"}</title>
        <main className="grid min-h-[100dvh] place-items-center px-6 text-center">
          {reloading ? (
            <p className="text-muted">{en ? "Reloading…" : "در حال بارگذاری دوباره…"}</p>
          ) : (
            <div className="max-w-md">
              <h1 className="text-center text-2xl font-bold">{en ? "This page couldn’t load" : "این صفحه بار نشد"}</h1>
              <p className="mt-3 text-center leading-relaxed text-fg-2">
                {en ? "Please reload the page. If it happens again, go back to the home page." : "لطفاً صفحه را دوباره بارگذاری کنید. اگر باز هم پیش آمد، به صفحه‌ی اصلی بروید."}
              </p>
              <div className="mt-8 flex justify-center gap-3">
                <button type="button" onClick={() => location.reload()} className="rounded-full bg-fg px-6 py-2.5 text-sm font-semibold text-bg">
                  {en ? "Reload" : "بارگذاری دوباره"}
                </button>
                <button type="button" onClick={() => (location.href = en ? "/en" : "/")} className="rounded-full border border-line-strong px-6 py-2.5 text-sm">
                  {en ? "Home" : "صفحه‌ی اصلی"}
                </button>
              </div>
            </div>
          )}
        </main>
      </body>
    </html>
  );
}
