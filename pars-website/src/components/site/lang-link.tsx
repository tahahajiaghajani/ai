"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

/** The same path in the other language (/x ↔ /en/x). */
export function langPath(path: string, to: "fa" | "en"): string {
  return to === "en" ? (path === "/" ? "/en" : `/en${path}`) : path.replace(/^\/en(?=\/|$)/, "") || "/";
}

/** Link to the same page in the other language, keeping the query and hash (a ticket page needs its ?k=). */
export function LangLink({ to, className, title, children }: { to: "fa" | "en"; className?: string; title?: string; children: ReactNode }) {
  const path = usePathname() || "/";
  const target = langPath(path, to);
  // the prerendered href has no query; add it after mount (no useSearchParams, so no Suspense boundary needed)
  const [suffix, setSuffix] = useState("");
  useEffect(() => {
    const sync = () => setSuffix(window.location.search + window.location.hash);
    sync();
    window.addEventListener("hashchange", sync);
    window.addEventListener("pars:hash", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("pars:hash", sync);
    };
  }, [path]);
  return (
    <a href={target + suffix} hrefLang={to} lang={to} className={className} title={title}>
      {children}
    </a>
  );
}
