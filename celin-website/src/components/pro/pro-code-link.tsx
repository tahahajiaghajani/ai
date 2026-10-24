"use client";

import type { ComponentProps } from "react";
import type { Lang } from "@/lib/format";
import { href } from "@/lib/i18n";
import { openProSheet } from "@/components/pro/events";

/**
 * «ورود با کد Pro»: a link to the code tab of the sign-in page that opens the Pro sheet in place once the page is
 * running. Until then — a slow network, a script that failed, an old page from before an update — and with a
 * modified click (new tab), it simply goes to that page, so the button always does something.
 */
export function ProCodeLink({ lang, onClick, ...props }: { lang: Lang } & Omit<ComponentProps<"a">, "href">) {
  return (
    <a
      {...props}
      href={`${href(lang, "/account/login")}?tab=code`}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        openProSheet("code");
      }}
    />
  );
}
