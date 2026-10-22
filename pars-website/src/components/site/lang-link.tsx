"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Link to the same page in the other language (/x ↔ /en/x). */
export function LangLink({ to, className, title, children }: { to: "fa" | "en"; className?: string; title?: string; children: ReactNode }) {
  const path = usePathname() || "/";
  const target = to === "en" ? (path === "/" ? "/en" : `/en${path}`) : path.replace(/^\/en(?=\/|$)/, "") || "/";
  return (
    <a href={target} hrefLang={to} lang={to} className={className} title={title}>
      {children}
    </a>
  );
}
