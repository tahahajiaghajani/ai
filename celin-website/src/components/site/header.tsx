"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { commonCopy } from "@/content/copy/common";
import type { Lang } from "@/lib/format";
import { href, otherLangPath } from "@/lib/i18n";
import type { Media } from "@/lib/media";
import { Icon } from "@/components/ui/icons";
import { Picture } from "@/components/ui/picture";
import { Overlay } from "@/components/ui/overlay";
import { openProSheet, openSearch } from "@/components/pro/events";
import { useMe } from "@/components/pro/session";
import { useCartCount } from "@/components/cart/cart-store";
import { num } from "@/lib/format";

export interface MenuData {
  categories: { slug: string; name: string; media: Media | null }[];
  collections: { slug: string; name: string; tagline: string }[];
  promo: { media: Media; title: string; cta: string; href: string } | null;
}

const TONES = ["gold", "silver", "rose"] as const;

function Wordmark({ lang, className, light }: { lang: Lang; className: string; light: boolean }) {
  return (
    <Link href={href(lang, "/")} className={`relative block ${className}`} aria-label={lang === "fa" ? "سلین — صفحه‌ی اصلی" : "CELIN — home"}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/celin-wordmark.svg" alt="CELIN" className={`h-full w-auto transition-opacity duration-500 ${light ? "opacity-0" : "opacity-100"}`} width={582} height={260} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/celin-wordmark-reverse.svg" alt="" aria-hidden className={`absolute inset-0 h-full w-auto transition-opacity duration-500 ${light ? "opacity-100" : "opacity-0"}`} width={582} height={260} />
    </Link>
  );
}

/** Account entry: «ورود» for visitors, the account for members (with an unread dot), quiet while checking. */
function AccountLink({ lang, compact }: { lang: Lang; compact?: boolean }) {
  const c = commonCopy(lang).nav;
  const me = useMe();
  const path = usePathname();
  if (me === undefined) return <span className={compact ? "size-11" : "h-11 w-14"} aria-hidden />;
  if (!me) {
    return (
      <Link href={`${href(lang, "/account/login")}?next=${encodeURIComponent(path)}`} className="grid h-11 min-w-11 place-items-center px-1 text-sm opacity-80 transition-opacity hover:opacity-100" aria-label={c.signIn}>
        {compact ? <Icon name="user" className="size-[22px]" /> : c.signIn}
      </Link>
    );
  }
  return (
    <Link href={href(lang, "/account")} className="relative grid size-11 place-items-center opacity-80 transition-opacity hover:opacity-100" aria-label={c.account}>
      <Icon name="user" className="size-[22px]" />
      {me.unread > 0 && <span className="absolute top-2.5 end-2.5 size-1.5 rounded-full bg-gold" aria-hidden />}
    </Link>
  );
}

/** «Pro» opens the Pro sheet; for members it is a quiet gold chip. */
function ProButton({ lang }: { lang: Lang }) {
  const me = useMe();
  const c = commonCopy(lang);
  if (me?.pro.active) {
    return (
      <Link href={href(lang, "/account/pro")} className="hidden h-7 items-center border border-gold/60 px-2.5 font-label text-[11px] tracking-[0.16em] text-gold-text group-data-light/header:border-gold-on-dark/60 group-data-light/header:text-gold-on-dark sm:inline-flex ltr" title={c.proBar.active}>
        PRO
      </Link>
    );
  }
  return (
    <button type="button" onClick={() => openProSheet("code")} className="hidden h-11 items-center px-2 font-label text-xs tracking-[0.14em] opacity-80 transition-opacity hover:opacity-100 sm:inline-flex ltr" aria-label={c.proSheet.title}>
      PRO
    </button>
  );
}

function CartLink({ lang }: { lang: Lang }) {
  const me = useMe();
  const count = useCartCount();
  if (!me?.pro.active) return null;
  return (
    <Link href={href(lang, "/account/cart")} className="relative grid size-11 place-items-center opacity-80 transition-opacity hover:opacity-100" aria-label={`${commonCopy(lang).nav.order}${count ? ` (${num(count, lang)})` : ""}`}>
      <Icon name="bag" className="size-[22px]" />
      {count > 0 && <span className="absolute top-1.5 end-1 grid min-w-4 place-items-center rounded-full bg-ink px-1 text-[10px] leading-4 text-bone group-data-light/header:bg-bone group-data-light/header:text-ink">{num(count, lang)}</span>}
    </Link>
  );
}

function LangLink({ lang }: { lang: Lang }) {
  const path = usePathname();
  const c = commonCopy(lang).nav;
  return (
    <a href={otherLangPath(lang, path)} hrefLang={lang === "fa" ? "en" : "fa"} lang={lang === "fa" ? "en" : "fa"} className="grid h-11 min-w-9 place-items-center font-label text-xs tracking-[0.12em] opacity-80 transition-opacity hover:opacity-100" aria-label={c.language}>
      {lang === "fa" ? "EN" : "فا"}
    </a>
  );
}

type Panel = "jewellery" | "collections" | null;

/** A small eyebrow with the copper diamond (menus). */
function MenuLabel({ children }: { children: string }) {
  return (
    <p className="label mb-4 flex items-center gap-2.5 text-gold-text!">
      <svg viewBox="0 0 10 10" className="size-1.5 text-gold" aria-hidden>
        <path d="M5 0 10 5 5 10 0 5Z" fill="currentColor" />
      </svg>
      {children}
    </p>
  );
}

export function Header({ lang, menu }: { lang: Lang; menu: MenuData }) {
  const c = commonCopy(lang);
  const path = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [away, setAway] = useState(false);
  const [overDark, setOverDark] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [drawer, setDrawer] = useState(false);
  const [peek, setPeek] = useState<string | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerRef = useRef<HTMLElement>(null);
  const progress = useRef<HTMLSpanElement>(null);

  // glass after the first pixels, hidden while reading down, back on the way up; a copper reading line
  useEffect(() => {
    let last = window.scrollY;
    let raf = 0;
    const on = () => {
      raf = 0;
      const y = window.scrollY;
      setScrolled(y > 8);
      setAway(y > 320 && y > last + 2 ? true : y < last - 2 || y <= 320 ? false : (v) => v);
      last = y;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      progress.current?.style.setProperty("--p", max > 0 ? (y / max).toFixed(4) : "0");
    };
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(on);
    };
    on();
    window.addEventListener("scroll", queue, { passive: true });
    return () => {
      window.removeEventListener("scroll", queue);
      cancelAnimationFrame(raf);
    };
  }, []);
  // pages that open on a dark band mark it data-header="dark": the header turns light over it
  useEffect(() => {
    const band = document.querySelector("[data-header='dark']");
    if (!band) {
      setOverDark(false);
      return;
    }
    const io = new IntersectionObserver(([e]) => setOverDark(e.isIntersecting), { rootMargin: "0px 0px -96% 0px" });
    io.observe(band);
    return () => io.disconnect();
  }, [path]);
  useEffect(() => {
    setPanel(null);
    setDrawer(false);
  }, [path]);
  useEffect(() => {
    if (!panel) setPeek(null);
  }, [panel]);
  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPanel(null);
    const onDown = (e: PointerEvent) => !headerRef.current?.contains(e.target as Node) && setPanel(null);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [panel]);

  const hover = (p: Panel) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setPanel(p), p ? 120 : 200);
  };
  const light = overDark && !panel;
  const peekCat = panel === "jewellery" && peek ? menu.categories.find((k) => k.slug === peek && k.media) ?? null : null;
  const active = (to: string) => path === href(lang, to) || path.startsWith(`${href(lang, to)}/`);

  const navBtn = (p: Exclude<Panel, null>, label: string, to: string) => (
    <div onPointerEnter={(e) => e.pointerType === "mouse" && hover(p)} onPointerLeave={(e) => e.pointerType === "mouse" && hover(null)}>
      <button
        type="button"
        aria-expanded={panel === p}
        aria-controls={`menu-${p}`}
        onClick={() => setPanel((cur) => (cur === p ? null : p))}
        className={`relative flex h-[var(--header-h)] items-center gap-1 font-sans text-[15px] font-semibold transition-opacity ${panel === p || active(to) ? "opacity-100" : "opacity-75 hover:opacity-100"}`}
      >
        {label}
        <span className={`absolute inset-x-0 bottom-5 h-px origin-center bg-gold group-data-light/header:bg-gold-on-dark transition-transform duration-300 ${panel === p ? "scale-x-100" : "scale-x-0"}`} aria-hidden />
      </button>
    </div>
  );

  return (
    <>
      <a href="#main" className="sr-only z-[60] bg-ink px-4 py-2 text-bone focus:not-sr-only focus:fixed focus:top-2 focus:start-2">
        {c.skip}
      </a>
      <header
        ref={headerRef}
        data-light={light || undefined}
        data-tone={light ? "light" : undefined}
        className={`group/header sticky top-0 z-50 border-b transition-[background-color,border-color,color,translate] duration-500 ease-[var(--ease-lux)] ${
          away && !panel && !drawer ? "-translate-y-full" : ""
        } ${
          panel ? "border-line bg-ground text-ink" : light ? `text-on-night ${scrolled ? "glass-dark border-night-line" : "border-transparent bg-transparent"}` : scrolled ? "glass border-line text-ink" : "border-transparent bg-ground text-ink"
        }`}
      >
        <div className="container-lux grid h-[var(--header-h)] grid-cols-[1fr_auto_1fr] items-center gap-4">
          {/* start: menu (phones) / main navigation (desktop) */}
          <div className="flex items-center gap-7">
            <button type="button" onClick={() => setDrawer(true)} className="-ms-2.5 grid size-11 place-items-center lg:hidden" aria-label={c.nav.menu} aria-expanded={drawer}>
              <Icon name="menu" className="size-6" />
            </button>
            <nav className="hidden items-center gap-7 lg:flex" aria-label={c.nav.jewellery}>
              {navBtn("jewellery", c.nav.jewellery, "/shop")}
              {navBtn("collections", c.nav.collections, "/collections")}
              <Link href={href(lang, "/craft")} className={`text-[15px] font-semibold transition-opacity ${active("/craft") ? "opacity-100" : "opacity-75 hover:opacity-100"}`}>
                {c.nav.craft}
              </Link>
              <Link href={href(lang, "/maison")} className={`text-[15px] font-semibold transition-opacity ${active("/maison") ? "opacity-100" : "opacity-75 hover:opacity-100"}`}>
                {c.nav.maison}
              </Link>
            </nav>
          </div>
          <Wordmark lang={lang} className="h-8 lg:h-10" light={light} />
          {/* end: utilities */}
          <div className="-me-2.5 flex items-center justify-end gap-0.5 sm:gap-1">
            <button type="button" onClick={openSearch} className="grid size-11 place-items-center opacity-80 transition-opacity hover:opacity-100" aria-label={c.nav.search}>
              <Icon name="search" className="size-[22px]" />
            </button>
            <span className="hidden sm:block">
              <LangLink lang={lang} />
            </span>
            <ProButton lang={lang} />
            <AccountLink lang={lang} compact />
            <CartLink lang={lang} />
          </div>
        </div>

        <span aria-hidden className="absolute inset-x-0 -bottom-px h-px">
          <span ref={progress} className={`fx-progress block h-px ${light ? "bg-gold-on-dark/70" : "bg-gold/70"}`} />
        </span>

        {/* desktop mega panels */}
        {panel && (
          <div
            id={`menu-${panel}`}
            onPointerEnter={(e) => e.pointerType === "mouse" && hover(panel)}
            onPointerLeave={(e) => e.pointerType === "mouse" && hover(null)}
            className="absolute inset-x-0 top-full hidden animate-[rise_.35s_var(--ease-lux)_both] overflow-hidden border-b border-gold/20 bg-mesh-porcelain text-ink shadow-[0_40px_60px_-44px_rgb(26_19_16/0.4)] lg:block"
          >
            <div className="container-lux grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-12 py-11 xl:gap-16">
              {panel === "jewellery" ? (
                <>
                  <div>
                    <MenuLabel>{c.nav.jewellery}</MenuLabel>
                    <ul className="space-y-1.5">
                      {menu.categories.map((k) => (
                        <li key={k.slug}>
                          <Link
                            href={href(lang, `/shop/${k.slug}`)}
                            onPointerEnter={() => setPeek(k.slug)}
                            onFocus={() => setPeek(k.slug)}
                            className="group/item flex items-center gap-3 py-1 text-ink-2 transition-colors duration-300 hover:text-gold-deep focus-visible:text-gold-deep"
                          >
                            <svg viewBox="0 0 10 10" className={`size-1.5 shrink-0 text-gold transition-opacity duration-300 ${peek === k.slug ? "opacity-100" : "opacity-0"}`} aria-hidden>
                              <path d="M5 0 10 5 5 10 0 5Z" fill="currentColor" />
                            </svg>
                            <span className="display text-2xl leading-[1.5]! font-semibold">{k.name}</span>
                          </Link>
                        </li>
                      ))}
                      <li className="ps-[1.125rem] pt-3">
                        <Link href={href(lang, "/shop")} onPointerEnter={() => setPeek(null)} className="font-ui text-sm text-gold-text underline-offset-8 hover:underline">
                          {c.nav.all}
                        </Link>
                      </li>
                    </ul>
                  </div>
                  <div>
                    <MenuLabel>{c.nav.byTone}</MenuLabel>
                    <ul className="space-y-3.5 font-ui text-sm">
                      {TONES.map((t) => (
                        <li key={t}>
                          <Link href={`${href(lang, "/shop")}?metal=${t}`} className="flex items-center gap-3 text-ink-2 transition-colors hover:text-ink">
                            <span className={`size-3.5 rounded-full ring-1 ring-ink/10 ${t === "gold" ? "bg-swatch-gold" : t === "silver" ? "bg-swatch-silver" : "bg-swatch-rose"}`} aria-hidden />
                            {c.tones[t]}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <MenuLabel>{c.nav.collections}</MenuLabel>
                    <ul className="space-y-2.5">
                      {menu.collections.slice(0, 6).map((k) => (
                        <li key={k.slug}>
                          <Link href={href(lang, `/collections/${k.slug}`)} className="text-base text-ink-2 transition-colors hover:text-gold-deep">
                            {k.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              ) : (
                <div className="col-span-3 grid grid-cols-3 gap-x-12 gap-y-7">
                  {menu.collections.map((k) => (
                    <Link key={k.slug} href={href(lang, `/collections/${k.slug}`)} className="group block border-t border-gold/20 pt-4">
                      <span className="display block text-2xl leading-[1.5]! font-semibold text-ink-2 transition-colors duration-300 group-hover:text-gold-deep">{k.name}</span>
                      <span className="mt-1 block text-sm leading-7 text-muted">{k.tagline}</span>
                    </Link>
                  ))}
                  <Link href={href(lang, "/collections")} className="self-end font-ui text-sm text-gold-text underline-offset-8 hover:underline">
                    {c.nav.allCollections}
                  </Link>
                </div>
              )}
              {/* the arch window: the promo, or the category under the pointer */}
              {(menu.promo || peekCat) && (
                <Link href={peekCat ? href(lang, `/shop/${peekCat.slug}`) : href(lang, menu.promo!.href)} className="group block w-52 xl:w-56" tabIndex={-1}>
                  <span className="relative block aspect-[3/4] [--ring-gap:8px]">
                    <span className="arch-ring" style={{ "--ring": "rgb(156 94 52 / 0.5)" } as CSSProperties} aria-hidden />
                    <svg viewBox="0 0 10 10" className="absolute left-1/2 top-[-8px] z-[2] size-2 -translate-x-1/2 -translate-y-1/2 text-gold-bright" aria-hidden>
                      <path d="M5 0 10 5 5 10 0 5Z" fill="currentColor" />
                    </svg>
                    <span className="fx-sheen arch absolute inset-0 overflow-hidden bg-tile">
                      {menu.promo && (
                        <Picture media={menu.promo.media} lang={lang} sizes="224px" alt="" className={`absolute inset-0 transition-opacity duration-700 ${peekCat ? "opacity-0" : "opacity-100"}`} imgClassName="transition-transform duration-[1.2s] ease-[var(--ease-out-expo)] group-hover:scale-[1.04]" />
                      )}
                      {panel === "jewellery" &&
                        menu.categories.map((k) =>
                          k.media ? <Picture key={k.slug} media={k.media} lang={lang} sizes="224px" alt="" className={`absolute inset-0 transition-opacity duration-700 ${peekCat?.slug === k.slug ? "opacity-100" : "opacity-0"}`} /> : null,
                        )}
                    </span>
                  </span>
                  <span className="display mt-4 block text-center text-lg font-semibold text-ink">{peekCat ? peekCat.name : menu.promo?.title}</span>
                  <span className="mt-0.5 block text-center font-ui text-xs text-muted">{peekCat ? c.nav.discover : menu.promo?.cta}</span>
                </Link>
              )}
            </div>
          </div>
        )}
      </header>

      {/* phone menu */}
      <Overlay open={drawer} onClose={() => setDrawer(false)} label={c.nav.menu} variant="start" closeLabel={c.nav.close}>
        <div className="flex min-h-full flex-col bg-mesh-porcelain pt-6 pb-8">
          <div className="px-6">
            <MenuLabel>{c.nav.jewellery}</MenuLabel>
          </div>
          {/* the categories as a small arcade */}
          <ul className="relative flex gap-3.5 overflow-x-auto px-6 pt-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {menu.categories.map((k) => (
              <li key={k.slug} className="shrink-0">
                <Link href={href(lang, `/shop/${k.slug}`)} className="flex w-[5.25rem] flex-col items-center text-center">
                  <span className="arch block w-full overflow-hidden bg-tile">
                    <Picture media={k.media} lang={lang} ratio="3/4" sizes="84px" alt="" />
                  </span>
                  <span className="mt-1 block h-px w-[calc(100%+0.875rem)] bg-[image:var(--metal-copper)] opacity-40" aria-hidden />
                  <span className="display mt-2 text-base leading-[1.5]! font-bold text-ink">{k.name}</span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="px-6">
            <Link href={href(lang, "/shop")} className="mt-3 flex h-12 items-center justify-between border-b border-gold/20 font-ui text-sm text-gold-text">
              {c.nav.all}
              <Icon name="chevron" className="size-4 rtl:-scale-x-100" />
            </Link>

            <div className="mt-8">
              <MenuLabel>{c.nav.collections}</MenuLabel>
            </div>
            <ul className="grid grid-cols-2 gap-x-4">
              {menu.collections.map((k) => (
                <li key={k.slug}>
                  <Link href={href(lang, `/collections/${k.slug}`)} className="display flex h-11 items-center text-lg font-semibold text-ink-2">
                    {k.name}
                  </Link>
                </li>
              ))}
            </ul>

            <ul className="mt-6 divide-y divide-line border-y border-line">
              {[
                ["/craft", c.nav.craft],
                ["/maison", c.nav.maison],
                ["/care", c.nav.care],
                ["/contact", c.nav.contact],
              ].map(([to, label]) => (
                <li key={to}>
                  <Link href={href(lang, to)} className="flex h-12 items-center justify-between text-base text-ink-2">
                    {label}
                    <Icon name="chevron" className="size-4 text-faint rtl:-scale-x-100" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-auto space-y-4 px-6 pt-9">
            <button type="button" onClick={() => { setDrawer(false); openProSheet("code"); }} className="btn btn-metal w-full">
              <span className="font-label text-xs tracking-[0.16em] ltr">PRO</span>
              <span>{c.proSheet.title}</span>
            </button>
            <div className="flex items-center justify-between text-sm text-ink-2">
              <AccountLink lang={lang} />
              <LangLink lang={lang} />
            </div>
          </div>
        </div>
      </Overlay>
    </>
  );
}
