import type { Metadata } from "next";
import { NotFoundPage } from "@/components/pages/not-found-page";
import { errorCopy } from "@/content/copy/errors";

export const metadata: Metadata = { title: errorCopy.fa.notFound.eyebrow, robots: { index: false, follow: true } };

/** notFound() inside the site (an unknown product, category or collection); unmatched URLs get app/global-not-found.tsx. */
export default function NotFound() {
  return <NotFoundPage lang="fa" />;
}
