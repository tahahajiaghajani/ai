import Link from "next/link";
import type { AnnouncementSettings } from "@/lib/settings-types";
import type { Lang } from "@/lib/format";
import { href } from "@/lib/i18n";

export function Announcement({ lang, a }: { lang: Lang; a: AnnouncementSettings }) {
  const text = lang === "fa" ? a.text_fa : a.text_en || a.text_fa;
  if (!a.enabled || !text) return null;
  const inner = <span className="block truncate">{text}</span>;
  return (
    <div data-announcement className="relative z-[51] h-8 border-b border-night-line bg-night text-center font-ui text-xs leading-8 text-on-night">
      <div className="container-lux">
        {a.link ? (
          a.link.startsWith("/") ? (
            <Link href={href(lang, a.link)} className="block transition-colors hover:text-gold-on-dark">{inner}</Link>
          ) : (
            <a href={a.link} className="block hover:underline" target="_blank" rel="noreferrer">{inner}</a>
          )
        ) : (
          inner
        )}
      </div>
    </div>
  );
}
