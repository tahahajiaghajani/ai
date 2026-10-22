import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";

const fa = IBM_Plex_Sans_Arabic({ subsets: ["arabic"], weight: ["300", "500", "600"], variable: "--font-fa", display: "swap", preload: false });

export const metadata: Metadata = { title: "۴۰۴ | مدیریت پروژه پارس", robots: { index: false } };

export default function GlobalNotFound() {
  return (
    <html lang="fa" dir="rtl" className={fa.variable}>
      <body className="font-sans">
        <main className="grain relative grid min-h-[100dvh] place-items-center overflow-hidden px-6 text-center">
          <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_100%,rgb(223_17_115/0.25),transparent_70%)]" />
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/pars-mark-reverse.svg" alt="" className="mx-auto h-20 w-auto animate-float" />
            <p className="mt-8 font-brand text-7xl font-bold text-gradient">404</p>
            <h1 className="mt-4 text-2xl font-extrabold">این صفحه پیدا نشد</h1>
            <p className="mt-2 text-muted" lang="en" dir="ltr">This page could not be found.</p>
            <div className="mt-8 flex justify-center gap-3">
              <a href="/" className="rounded-full bg-magenta px-6 py-3 font-semibold text-white">بازگشت به خانه</a>
              <a href="/en" className="rounded-full border border-line-strong px-6 py-3 font-semibold" lang="en">Home</a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
