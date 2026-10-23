"use client";

import Link from "next/link";
import { commonCopy } from "@/content/copy/common";
import type { Lang } from "@/lib/format";
import { href } from "@/lib/i18n";
import { openProSheet } from "@/components/pro/events";

export function FooterProLinks({ lang, className }: { lang: Lang; className: string }) {
  const c = commonCopy(lang).footer;
  return (
    <ul className="space-y-2.5 text-sm">
      <li><Link className={className} href={href(lang, "/pro")}>{c.requestPro}</Link></li>
      <li><button type="button" className={className} onClick={() => openProSheet("code")}>{c.enterCode}</button></li>
      <li><Link className={className} href={href(lang, "/account/orders")}>{c.myOrders}</Link></li>
    </ul>
  );
}
