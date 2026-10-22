"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Copy } from "@/content/fa";
import type { Lang } from "@/lib/i18n";
import { Icon } from "@/components/site/icons";

interface Demo {
  id: string;
  title_fa: string;
  title_en: string;
  description_fa: string;
  description_en: string;
  url: string;
  tag: string;
}

export function openDemos() {
  window.dispatchEvent(new CustomEvent("pars:demos"));
}

/** Button that opens the demo list (works from server components). */
export function DemosButton({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={openDemos} className={className}>
      {children}
    </button>
  );
}

/** Side sheet with the demo links managed in /admin/demos (fetched on first open). */
export function DemoSheet({ lang, t, customHref }: { lang: Lang; t: Copy["demos"]; customHref: string }) {
  const [open, setOpen] = useState(false);
  const [demos, setDemos] = useState<Demo[] | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/demos");
      const j = (await res.json()) as { demos: Demo[] };
      setDemos(j.demos ?? []);
    } catch {
      setDemos([]);
    }
  }, []);

  useEffect(() => {
    const onOpen = () => {
      setOpen(true);
      if (demos === null) void load();
    };
    window.addEventListener("pars:demos", onOpen);
    return () => window.removeEventListener("pars:demos", onOpen);
  }, [demos, load]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    document.documentElement.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = "";
    };
  }, [open]);

  return (
    <div data-open={open || undefined} inert={!open} className="pointer-events-none fixed inset-0 z-[70] data-[open]:pointer-events-auto" role="dialog" aria-modal="true" aria-label={t.sheetTitle}>
      <div className="absolute inset-0 bg-ink/70 opacity-0 backdrop-blur-sm transition-opacity duration-500 [[data-open]>&]:opacity-100" onClick={() => setOpen(false)} />
      <aside className="absolute inset-y-0 end-0 flex w-full max-w-md translate-x-full flex-col border-s border-line bg-ink-2 shadow-2xl transition-transform duration-700 ease-[var(--ease-out-expo)] rtl:-translate-x-full [[data-open]>&]:translate-x-0">
        <div className="relative overflow-hidden px-6 pb-6 pt-7">
          <div aria-hidden className="absolute -top-24 end-[-30%] size-72 rounded-full bg-magenta/25 blur-3xl" />
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-extrabold">{t.sheetTitle}</h2>
              <p className="mt-1 text-sm text-muted">{t.sheetLead}</p>
            </div>
            <button ref={closeRef} type="button" onClick={() => setOpen(false)} aria-label="close" className="grid size-10 shrink-0 place-items-center rounded-full border border-line text-muted hover:text-fg">
              <Icon name="close" />
            </button>
          </div>
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto px-4 pb-4">
          {demos === null ? (
            <div className="space-y-3 px-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton h-20 rounded-2xl" />
              ))}
            </div>
          ) : demos.length === 0 ? (
            <p className="px-2 py-10 text-center text-muted">{t.empty}</p>
          ) : (
            <ul className="space-y-2.5">
              {demos.map((d, i) => {
                const title = lang === "en" ? d.title_en || d.title_fa : d.title_fa;
                const desc = lang === "en" ? d.description_en || d.description_fa : d.description_fa;
                return (
                  <li key={d.id} style={{ animationDelay: `${i * 60}ms` }} className="animate-[fade-in_.6s_both]">
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="group card spotlight flex items-center gap-4 rounded-2xl p-4 transition hover:border-pink/40">
                      <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-reverse text-white shadow-[0_10px_30px_-10px_rgb(223_17_115/0.7)]">
                        <Icon name="play" className="size-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate font-bold">{title}</span>
                          {d.tag && <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] text-violet">{d.tag}</span>}
                        </span>
                        {desc && <span className="mt-0.5 line-clamp-2 block text-sm leading-6 text-muted">{desc}</span>}
                        <span className="ltr mt-1 block truncate text-start text-[11px] text-faint">{d.url.replace(/^https?:\/\//, "")}</span>
                      </span>
                      <Icon name="external" className="size-4.5 shrink-0 text-faint transition group-hover:text-pink" />
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="border-t border-line p-4">
          <a href={customHref} className="flex items-center justify-center gap-2 rounded-full border border-line-strong px-5 py-3 text-sm font-semibold transition hover:border-pink/60">
            {t.custom}
            <Icon name="arrow" className="size-4 rtl:-scale-x-100" />
          </a>
        </div>
      </aside>
    </div>
  );
}
