import type { Metadata } from "next";
import { interFa, vazirFa } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = { title: "404 · Taha Aghajani", robots: { index: false } };

export default function GlobalNotFound() {
  return (
    <html lang="fa" dir="rtl" className={`${vazirFa.variable} ${interFa.variable}`}>
      <body className="grain">
        <main className="grid min-h-[100dvh] place-items-center px-6 text-center">
          <div>
            <p className="latin text-[clamp(6rem,24vw,16rem)] font-semibold leading-none tracking-[-0.06em]">404</p>
            <h1 className="mt-4 text-2xl font-bold">این صفحه پیدا نشد</h1>
            <p className="latin mt-2 text-muted" lang="en" dir="ltr">This page could not be found.</p>
            <div className="mt-10 flex justify-center gap-3">
              <a href="/" className="rounded-full bg-fg px-6 py-3 font-semibold text-bg">بازگشت به خانه</a>
              <a href="/en" className="latin rounded-full border border-line-strong px-6 py-3 font-semibold" lang="en">Home</a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
