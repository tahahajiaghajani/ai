"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/site/icons";

const ITEMS: { href: string; label: string; icon: IconName }[] = [
  { href: "/admin", label: "پیشخوان", icon: "pattern" },
  { href: "/admin/tickets", label: "تیکت‌ها", icon: "ticket" },
  { href: "/admin/chats", label: "گفتگوهای دستیار", icon: "eye" },
  { href: "/admin/knowledge", label: "دانش پارس", icon: "rag" },
  { href: "/admin/blog", label: "وبلاگ", icon: "article" },
  { href: "/admin/ai", label: "هوش مصنوعی", icon: "ai" },
  { href: "/admin/demos", label: "دموها", icon: "play" },
  { href: "/admin/site", label: "محتوای سایت", icon: "globe" },
  { href: "/admin/connections", label: "اتصالات", icon: "link" },
];

export function AdminNav({ badges }: { badges: Record<string, number> }) {
  const path = usePathname();
  return (
    <nav className="scroll-thin flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
      {ITEMS.map((it) => {
        const active = it.href === "/admin" ? path === "/admin" : path.startsWith(it.href);
        const badge = badges[it.href];
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`flex shrink-0 items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm transition ${active ? "bg-white/[0.08] font-semibold text-fg" : "text-muted hover:bg-white/[0.04] hover:text-fg"}`}
          >
            <Icon name={it.icon} className={`size-[18px] ${active ? "text-pink" : ""}`} />
            <span className="flex-1">{it.label}</span>
            {badge ? <span className="rounded-full bg-magenta px-2 py-0.5 text-[11px] font-bold text-white">{new Intl.NumberFormat("fa-IR").format(badge)}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
