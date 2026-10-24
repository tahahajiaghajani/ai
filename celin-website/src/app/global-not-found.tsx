import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Document } from "@/components/site/document";
import { FONT_VARS } from "@/lib/fonts";
import { siteViewport } from "@/lib/seo";
import { errorCopy } from "@/content/copy/errors";
import { NightDoor } from "@/components/house/night-door";
import "./globals.css";

export const metadata: Metadata = {
  title: `${errorCopy.fa.notFound.eyebrow} — سلین · ${errorCopy.en.notFound.eyebrow} — CELIN`,
  robots: { index: false, follow: true },
};
export const viewport: Viewport = siteViewport;

/**
 * Any URL that matches no route (both languages): Next skips the layouts and renders this document, so it
 * brings its own styles and fonts. Persian first, English beneath; the night doorway plays in pure CSS.
 */
export default function GlobalNotFound() {
  const fa = errorCopy.fa.notFound;
  const en = errorCopy.en.notFound;
  return (
    <Document lang="fa" fonts={FONT_VARS}>
      <main>
        <NightDoor
          lang="fa"
          code={fa.code}
          eyebrow={fa.eyebrow}
          title={fa.title}
          body={fa.body}
          top={
            <Link href="/" className="mb-10 block" aria-label="سلین — CELIN">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/celin-logo-reverse.svg" alt="" width={794} height={379} className="h-16 w-auto sm:h-20" />
            </Link>
          }
        >
          <Link href="/" className="btn btn-metal h-13 px-8">
            {fa.home}
          </Link>
          <Link href="/shop" className="btn btn-line-light h-13">
            {fa.shop}
          </Link>
          <div lang="en" dir="ltr" className="mt-10 basis-full border-t border-night-line pt-8">
            <p className="title-section text-on-night">{en.title}</p>
            <p className="mx-auto mt-3 max-w-md text-base leading-7 text-on-night-muted">{en.body}</p>
            <p className="mt-5 flex items-center justify-center gap-6 text-sm">
              <Link href="/en" className="border-b border-on-night/40 pb-1 text-on-night transition-colors hover:border-gold-on-dark">
                {en.home}
              </Link>
              <Link href="/en/shop" className="border-b border-on-night/40 pb-1 text-on-night transition-colors hover:border-gold-on-dark">
                {en.shop}
              </Link>
            </p>
          </div>
        </NightDoor>
      </main>
    </Document>
  );
}
