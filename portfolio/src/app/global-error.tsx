"use client";

import { useEffect, useState } from "react";
import { inter, vazir } from "@/lib/fonts";
import "./globals.css";

/** The same address is reloaded automatically at most once a minute, so a lasting error never loops. */
const ONCE_PER_MS = 60_000;

/** Whether this address may reload itself now (and remembers that it did). */
function mayReload(): boolean {
  try {
    const key = `auto-reload:${location.pathname}`;
    if (Date.now() - Number(sessionStorage.getItem(key) || 0) <= ONCE_PER_MS) return false;
    sessionStorage.setItem(key, String(Date.now()));
    return true;
  } catch {
    // storage blocked: never reload automatically, the buttons below still work
    return false;
  }
}

function lightTheme(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem("theme") === "light";
  } catch {
    return false;
  }
}

/**
 * The last resort when a page breaks in the browser (for example after a new deployment while a tab stayed open):
 * reload once by itself, which is what fixes it, and only show this page if that did not help.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string }; retry: () => void }) {
  // language and theme are read before the first paint (this boundary only renders in the browser), so an English or
  // light page never flashes Persian or dark; whether to reload is decided once, after mounting (it writes storage,
  // which a render must not do), and until then the page stays blank
  const [en] = useState(() => typeof window !== "undefined" && /^\/en(\/|$)/.test(location.pathname));
  const [light] = useState(lightTheme);
  const [show, setShow] = useState(false);

  useEffect(() => {
    console.error("[global-error]", error);
    if (mayReload()) location.reload();
    else setShow(true);
  }, [error]);

  return (
    <html lang={en ? "en" : "fa"} dir={en ? "ltr" : "rtl"} data-theme={light ? "light" : undefined} className={`${vazir.variable} ${inter.variable}`}>
      <body className="grain">
        <title>{en ? "Something went wrong · Taha Aghajani" : "مشکلی پیش آمد · طاها آقاجانی"}</title>
        <main className="grid min-h-[100dvh] place-items-center px-6 text-center">
          {!show ? null : (
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
