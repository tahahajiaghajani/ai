"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import type { Lang } from "@/lib/i18n";
import { href, num } from "@/lib/i18n";
import { ui } from "@/content/ui";
import { PROFILE } from "@/content/profile";
import { Mark } from "@/components/brand/logo";
import { CrossIcon } from "@/components/brand/icons";
import { useLenis } from "@/components/fx/motion";
import { ThemeToggle } from "@/components/site/theme-toggle";

// "home" has no section: it goes to the top of the home page
const LINKS = [
  { key: "home", hash: "" },
  { key: "work", hash: "#work" },
  { key: "expertise", hash: "#expertise" },
  { key: "journey", hash: "#journey" },
  { key: "ask", hash: "#ask" },
  { key: "contact", hash: "#contact" },
] as const;

/** The same page in the other language. */
export function otherLangPath(pathname: string, lang: Lang): string {
  if (lang === "fa") return pathname === "/" ? "/en" : `/en${pathname}`;
  const rest = pathname.replace(/^\/en(?=\/|$)/, "");
  return rest || "/";
}

export function Header({ lang }: { lang: Lang }) {
  const pathname = usePathname();
  const lenis = useLenis();
  const bar = useRef<HTMLElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const [open, setOpen] = useState(false);
  // usePathname has no query string: keep it (e.g. the ?k= key of a tracking page) when switching language
  const [search, setSearch] = useState("");
  const home = href(lang, "/");
  const onHome = pathname === home;

  // hide on the way down, show on the way up; a fixed bar cannot be scrolled to, so keyboard focus inside it keeps it in view
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    let last = window.scrollY;
    let hidden = false;
    const set = (hide: boolean) => {
      if (hide === hidden) return;
      hidden = hide;
      gsap.to(el, { yPercent: hide ? -110 : 0, duration: 0.6, ease: "expo.out" });
    };
    const onScroll = () => {
      const y = window.scrollY;
      set(y > last && y > 160 && !el.querySelector(":focus-visible"));
      last = y;
    };
    const onFocus = () => set(false);
    window.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("focusin", onFocus);
    return () => {
      window.removeEventListener("scroll", onScroll);
      el.removeEventListener("focusin", onFocus);
    };
  }, []);

  // the full-screen menu: lock the page, stagger the big links in, and hold keyboard focus inside it while open
  useEffect(() => {
    const p = panel.current;
    if (!p) return;
    if (open) {
      lenis?.stop();
      document.documentElement.style.overflow = "hidden";
      gsap.fromTo(p, { clipPath: "inset(0 0 100% 0)" }, { clipPath: "inset(0 0 0% 0)", duration: 0.9, ease: "expo.inOut" });
      gsap.fromTo(p.querySelectorAll("[data-menu-item]"), { yPercent: 120 }, { yPercent: 0, duration: 1, ease: "expo.out", stagger: 0.06, delay: 0.35 });
      closeBtn.current?.focus();
    } else {
      lenis?.start();
      document.documentElement.style.overflow = "";
      // closing hides whatever had focus: hand it back to the menu button, unless it already went elsewhere
      const a = document.activeElement;
      if (wasOpen.current && (!a || a === document.body || p.contains(a))) menuBtn.current?.focus();
    }
    wasOpen.current = open;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (!open || e.key !== "Tab") return;
      const items = p.querySelectorAll<HTMLElement>("a[href], button");
      const first = items[0];
      const last = items[items.length - 1];
      if (!p.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, lenis]);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => setSearch(window.location.search), [pathname]);

  const go = (hash: string) => (e: React.MouseEvent) => {
    setOpen(false);
    if (!onHome) return; // a normal navigation to the home page (or its section)
    e.preventDefault();
    const target = hash ? document.querySelector<HTMLElement>(hash) : null;
    if (hash && !target) return;
    if (lenis) {
      lenis.start(); // the open menu stopped it, and a stopped Lenis ignores scrollTo
      lenis.scrollTo(target ?? 0, { offset: target ? -40 : 0, duration: 1.6 });
    } else if (target) target.scrollIntoView({ behavior: "smooth" });
    else window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <>
      <header ref={bar} className="fixed inset-x-0 top-0 z-50 text-white mix-blend-difference">
        <div className="mx-auto flex h-20 max-w-[1800px] items-center justify-between gap-6 px-5 md:px-10">
          {/* on the home page a plain Link would do nothing (or let a running glide carry the page back down) */}
          <Link href={home} onClick={go("")} className="group flex items-center gap-3" aria-label={PROFILE.name[lang]}>
            <Mark className="size-8" />
            <span className="hidden flex-col leading-none sm:flex">
              <span className={lang === "fa" ? "text-[0.95rem] font-semibold" : "latin text-[0.78rem] font-semibold uppercase tracking-[0.24em]"}>{PROFILE.name[lang]}</span>
              <span className="mt-1 whitespace-nowrap font-mono text-[0.6rem] uppercase tracking-[0.2em] opacity-60 lg:max-xl:hidden">AI · Systems · Design</span>
            </span>
          </Link>

          <nav aria-label={lang === "fa" ? "بخش‌ها" : "Sections"} className="hidden items-center gap-5 lg:flex xl:gap-8">
            {LINKS.map((l, i) => (
              <a key={l.key} href={`${home}${l.hash}`} onClick={go(l.hash)} className="group flex items-baseline gap-1.5 whitespace-nowrap text-[0.82rem]">
                <span className="font-mono text-[0.6rem] opacity-50">{num(lang, `0${i + 1}`)}</span>
                <span className="link-draw pb-0.5">{ui.nav[l.key][lang]}</span>
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            <a href={otherLangPath(pathname, lang) + search} hrefLang={lang === "fa" ? "en" : "fa"} lang={lang === "fa" ? "en" : "fa"} className="grid h-10 min-w-10 place-items-center rounded-full border border-white/30 px-3 text-[0.78rem] font-medium transition-colors hover:bg-white hover:text-black" aria-label={ui.nav.lang[lang]}>
              {ui.nav.langShort[lang]}
            </a>
            <ThemeToggle label={ui.nav.theme[lang]} />
            <a href={`${home}#contact`} onClick={go("#contact")} className="hidden h-10 items-center whitespace-nowrap rounded-full bg-white px-5 text-[0.8rem] font-semibold text-black transition-transform hover:scale-[1.04] md:flex">
              {ui.nav.start[lang]}
            </a>
            <button ref={menuBtn} type="button" onClick={() => setOpen(true)} className="grid size-10 place-items-center rounded-full border border-white/30 lg:hidden" aria-label={ui.nav.menu[lang]} aria-expanded={open} aria-controls="site-menu">
              <span aria-hidden className="flex w-4 flex-col gap-[5px]">
                <span className="h-px w-full bg-current" />
                <span className="h-px w-2/3 bg-current" />
              </span>
            </button>
          </div>
        </div>
      </header>

      <div
        ref={panel}
        id="site-menu"
        role="dialog"
        aria-modal="true"
        aria-label={ui.nav.menu[lang]}
        hidden={!open}
        className="fixed inset-0 z-[80] flex flex-col overflow-y-auto bg-fg text-bg"
        data-lenis-prevent
      >
        <div className="flex h-20 items-center justify-between px-5">
          <Mark className="size-8" />
          <button ref={closeBtn} type="button" onClick={() => setOpen(false)} className="grid size-10 place-items-center rounded-full border border-current/30" aria-label={ui.nav.close[lang]}>
            <CrossIcon className="size-4" strokeWidth={1.3} />
          </button>
        </div>
        <nav className="flex flex-1 flex-col justify-center gap-2 px-6">
          {LINKS.map((l, i) => (
            <div key={l.key} className="overflow-hidden">
              <a data-menu-item href={`${home}${l.hash}`} onClick={go(l.hash)} className="flex items-baseline gap-4 py-1 text-[clamp(2rem,min(11vw,9svh),4.5rem)] font-semibold leading-[1.05] tracking-tight">
                <span className="font-mono text-sm opacity-50">{num(lang, `0${i + 1}`)}</span>
                {ui.nav[l.key][lang]}
              </a>
            </div>
          ))}
        </nav>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-current/15 px-6 py-6 text-sm">
          <a href={`mailto:${PROFILE.contact.email}`} className="latin" dir="ltr">{PROFILE.contact.email}</a>
          <a href={PROFILE.contact.telegram} className="opacity-70">Telegram</a>
        </div>
      </div>
    </>
  );
}
