"use client";

import Link from "next/link";
import { commonCopy } from "@/content/copy/common";
import type { Lang } from "@/lib/format";
import { href } from "@/lib/i18n";
import { ProCodeLink } from "@/components/pro/pro-code-link";
import { ProSeal } from "@/components/pro/seal";

/** The footer's Pro column: the seal with the members' line, then the ways in (request, code, orders). */
export function FooterProLinks({ lang, className }: { lang: Lang; className: string }) {
  const c = commonCopy(lang);
  return (
    <>
      <p className="mb-6 flex items-center gap-3.5 font-ui text-xs leading-6 text-on-night-muted">
        <ProSeal />
        {c.proBar.title}
      </p>
      <ul className="space-y-3 text-[0.9375rem]">
        <li>
          <Link className={className} href={href(lang, "/pro")}>
            {c.footer.requestPro}
          </Link>
        </li>
        <li>
          <ProCodeLink lang={lang} className={`font-sans text-start ${className}`}>
            {c.footer.enterCode}
          </ProCodeLink>
        </li>
        <li>
          <Link className={className} href={href(lang, "/account/orders")}>
            {c.footer.myOrders}
          </Link>
        </li>
      </ul>
    </>
  );
}
