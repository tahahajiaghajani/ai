"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "@/components/ui/icons";

export const ADMIN_NAV: { href: string; label: string; icon: IconName; group: string }[] = [
  { href: "/admin", label: "پیشخوان", icon: "dashboard", group: "" },
  { href: "/admin/orders", label: "سفارش‌ها", icon: "box", group: "فروش" },
  { href: "/admin/pro", label: "اشتراک Pro", icon: "diamond", group: "فروش" },
  { href: "/admin/users", label: "کاربران", icon: "users", group: "فروش" },
  { href: "/admin/products", label: "محصولات", icon: "tag", group: "کاتالوگ" },
  { href: "/admin/catalog", label: "دسته‌ها و مجموعه‌ها", icon: "filter", group: "کاتالوگ" },
  { href: "/admin/images", label: "تصاویر سایت", icon: "image", group: "کاتالوگ" },
  { href: "/admin/settings", label: "تنظیمات", icon: "settings", group: "سامانه" },
  { href: "/admin/connections", label: "اتصالات", icon: "link", group: "سامانه" },
];

export function AdminNav({ badges }: { badges: Record<string, number> }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  let lastGroup = "";
  const links = ADMIN_NAV.map((it) => {
    const active = it.href === "/admin" ? path === "/admin" : path === it.href || path.startsWith(`${it.href}/`);
    const badge = badges[it.href];
    const heading = it.group && it.group !== lastGroup ? it.group : "";
    lastGroup = it.group;
    return (
      <div key={it.href}>
        {heading && <div className="mt-5 mb-1.5 px-3 text-[11px] text-faint">{heading}</div>}
        <Link
          href={it.href}
          aria-current={active ? "page" : undefined}
          className={`relative flex items-center gap-3 px-3 py-2.5 text-sm transition-colors ${active ? "bg-white font-medium text-ink" : "text-ink-2 hover:bg-white/60 hover:text-ink"}`}
        >
          {active && <span className="absolute inset-y-2 start-0 w-px bg-gold" />}
          <Icon name={it.icon} className={`size-[18px] ${active ? "text-gold" : "text-muted"}`} />
          <span className="flex-1">{it.label}</span>
          {badge ? <span className="rounded-sm bg-ink px-1.5 text-[11px] leading-5 text-bone">{new Intl.NumberFormat("fa-IR").format(badge)}</span> : null}
        </Link>
      </div>
    );
  });
  return (
    <>
      <button type="button" onClick={() => setOpen((v) => !v)} className="grid size-10 place-items-center border border-line bg-white lg:hidden" aria-expanded={open} aria-label="منو">
        <Icon name={open ? "close" : "menu"} className="size-5" />
      </button>
      <nav className={`${open ? "block" : "hidden"} absolute inset-x-0 top-full z-40 max-h-[calc(100dvh-64px)] overflow-y-auto border-b border-line bg-bone px-3 pb-5 shadow-lg lg:static lg:block lg:max-h-none lg:overflow-visible lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none`}>
        {links}
      </nav>
    </>
  );
}
