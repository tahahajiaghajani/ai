import Link from "next/link";
import type { Lang } from "@/lib/format";
import { href } from "@/lib/i18n";
import { Icon } from "@/components/ui/icons";

export function Breadcrumbs({ lang, items }: { lang: Lang; items: { label: string; path?: string }[] }) {
  return (
    <nav aria-label={lang === "fa" ? "مسیر صفحه" : "Breadcrumb"} className="text-xs text-muted">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {i > 0 && <Icon name="chevron" className="size-3 text-faint rtl:-scale-x-100" />}
            {it.path ? (
              <Link href={href(lang, it.path)} className="hover:text-ink">
                {it.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-ink-2">
                {it.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
