"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "@/components/site/icons";

/** Adds the glass background once the page scrolls. */
export function HeaderShell({ children }: { children: ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header
      data-scrolled={scrolled || undefined}
      className="fixed inset-x-0 top-0 z-50 border-b border-transparent transition-[background,border-color,backdrop-filter] duration-500 data-[scrolled]:border-line data-[scrolled]:bg-ink/70 data-[scrolled]:backdrop-blur-xl"
    >
      {children}
    </header>
  );
}

export function MobileMenu({ label, closeLabel, links, footer }: { label: string; closeLabel: string; links: { href: string; label: string }[]; footer: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    document.documentElement.style.overflow = open ? "hidden" : "";
  }, [open]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={label} className="grid size-10 place-items-center rounded-full border border-line text-fg lg:hidden">
        <Icon name="menu" />
      </button>
      <div data-open={open || undefined} inert={!open} className="fixed inset-0 z-[80] bg-ink/95 opacity-0 backdrop-blur-xl transition-opacity duration-500 pointer-events-none data-[open]:pointer-events-auto data-[open]:opacity-100 lg:hidden">
        <div className="flex h-[var(--header-h)] items-center justify-end px-5">
          <button type="button" onClick={() => setOpen(false)} aria-label={closeLabel} className="grid size-10 place-items-center rounded-full border border-line">
            <Icon name="close" />
          </button>
        </div>
        <nav className="flex flex-col gap-1 px-6 pt-4">
          {links.map((l, i) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              style={{ transitionDelay: `${open ? 80 + i * 50 : 0}ms` }}
              className="translate-y-3 border-b border-line py-4 text-2xl font-bold opacity-0 transition duration-500 [[data-open]_&]:translate-y-0 [[data-open]_&]:opacity-100"
            >
              {l.label}
            </a>
          ))}
        </nav>
        <div className="px-6 pt-8" onClick={() => setOpen(false)}>
          {footer}
        </div>
      </div>
    </>
  );
}
