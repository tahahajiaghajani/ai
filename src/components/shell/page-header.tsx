"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

export interface SectionTab {
  href: string;
  label: string;
  /** more paths that belong to this tab */
  match?: string[];
}

/** The pages that share one menu item, shown as tabs under its title. */
export const SECTIONS = {
  tasks: [
    { href: "/inbox", label: "سپرده به من" },
    { href: "/given", label: "داده‌شده توسط من" },
  ],
  projects: [
    { href: "/projects", label: "پروژه‌ها" },
    { href: "/graph", label: "گراف دانش" },
  ],
  agents: [
    { href: "/agents", label: "ورکفلوها" },
    { href: "/agents?tab=agents", label: "ایجنت‌ها" },
    { href: "/learning", label: "یادگیری" },
  ],
  admin: [
    { href: "/system", label: "سیستم" },
    { href: "/users", label: "کاربران" },
    { href: "/banner", label: "اطلاعیه" },
    { href: "/upgrade", label: "ارتقا" },
  ],
} satisfies Record<string, SectionTab[]>;

export function SectionTabs({ tabs, className }: { tabs: SectionTab[]; className?: string }) {
  const path = usePathname();
  const sp = useSearchParams();
  // a tab with a query (/agents?tab=agents) beats its plain sibling (/agents) when the query matches
  const score = (t: SectionTab) => {
    const [base, query] = t.href.split("?");
    if (![base, ...(t.match ?? [])].some((m) => path === m || path.startsWith(`${m}/`))) return -1;
    if (!query) return 0;
    for (const [k, v] of new URLSearchParams(query)) if (sp.get(k) !== v) return -1;
    return 1;
  };
  const scores = tabs.map(score);
  const best = Math.max(...scores);
  return (
    <nav className={cn("flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl bg-surface-muted p-1", className)}>
      {tabs.map((t, i) => {
        const active = best >= 0 && scores[i] === best;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-lg px-3.5 py-1.5 text-[13px] font-bold transition",
              active ? "bg-surface-strong text-fg shadow-[0_1px_3px_rgba(11,18,34,0.08)]" : "text-muted hover:text-fg",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Title (no descriptions), optional section tabs and the page's main actions. */
export function PageHeader({ title, tabs, actions, className }: { title: React.ReactNode; tabs?: SectionTab[]; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-3", className)}>
      <h1 className="text-[22px] font-black tracking-tight">{title}</h1>
      {tabs ? <SectionTabs tabs={tabs} /> : null}
      {actions ? <div className="ms-auto flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
