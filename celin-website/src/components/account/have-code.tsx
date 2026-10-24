"use client";

import type { Lang } from "@/lib/format";
import { ProCodeLink } from "@/components/pro/pro-code-link";

/** «کد دارید؟» — opens the site's Pro sheet on its code tab (the code sign-in page until the page runs). */
export function HaveCodeButton({ lang, label, className = "" }: { lang: Lang; label: string; className?: string }) {
  return (
    <ProCodeLink lang={lang} className={className}>
      {label}
    </ProCodeLink>
  );
}
