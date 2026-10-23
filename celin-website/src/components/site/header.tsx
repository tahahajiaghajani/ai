"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
  categories: { slug: string; name: string }[];
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

export function Header({ lang, menu }: { lang: Lang; menu: MenuData }) {
  const c = commonCopy(lang);
  const path = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [away, setAway] = useState(false);
  const [overDark, setOverDark] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [drawer, setDrawer] = useState(false);
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
            className="absolute inset-x-0 top-full hidden animate-[rise_.35s_var(--ease-lux)_both] border-b border-line bg-ground lg:block"
          >
            <div className="container-lux grid grid-cols-[1fr_1fr_1fr_auto] gap-12 py-10">
              {panel === "jewellery" ? (
                <>
                  <div>
                    <p className="label mb-5">{c.nav.jewellery}</p>
                    <ul className="space-y-3">
                      {menu.categories.map((k) => (
                        <li key={k.slug}>
                          <Link href={href(lang, `/shop/${k.slug}`)} className="display text-xl text-ink-2 transition-colors hover:text-ink">
                            {k.name}
                          </Link>
                        </li>
                      ))}
                      <li className="pt-2">
                        <Link href={href(lang, "/shop")} className="text-sm text-gold-text underline-offset-8 hover:underline">
                          {c.nav.all}
                        </Link>
                      </li>
                    </ul>
                  </div>
                  <div>
                    <p className="label mb-5">{c.nav.byTone}</p>
                    <ul className="space-y-3 text-sm">
                      {TONES.map((t) => (
                        <li key={t}>
                          <Link href={`${href(lang, "/shop")}?metal=${t}`} className="flex items-center gap-3 text-ink-2 hover:text-ink">
                            <span className={`size-3.5 rounded-full ${t === "gold" ? "bg-swatch-gold" : t === "silver" ? "bg-swatch-silver" : "bg-swatch-rose"}`} aria-hidden />
                            {c.tones[t]}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="label mb-5">{c.nav.collections}</p>
                    <ul className="space-y-3 text-sm">
                      {menu.collections.slice(0, 6).map((k) => (
                        <li key={k.slug}>
                          <Link href={href(lang, `/collections/${k.slug}`)} className="text-ink-2 hover:text-ink">
                            {k.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              ) : (
                <div className="col-span-3 grid grid-cols-3 gap-x-12 gap-y-6">
                  {menu.collections.map((k) => (
                    <Link key={k.slug} href={href(lang, `/collections/${k.slug}`)} className="group block border-t border-line pt-4">
                      <span className="display block text-2xl text-ink-2 transition-colors group-hover:text-ink">{k.name}</span>
                      <span className="mt-1 block text-sm text-muted">{k.tagline}</span>
                    </Link>
                  ))}
                  <Link href={href(lang, "/collections")} className="self-end text-sm text-gold-text underline-offset-8 hover:underline">
                    {c.nav.allCollections}
                  </Link>
                </div>
              )}
              {menu.promo && (
                <Link href={href(lang, menu.promo.href)} className="group block w-52">
                  <Picture media={menu.promo.media} lang={lang} ratio="3/4" sizes="208px" imgClassName="transition-transform duration-700 ease-[var(--ease-lux)] group-hover:scale-[1.03]" />
                  <span className="mt-3 block text-sm text-ink">{menu.promo.title}</span>
                  <span className="mt-0.5 block text-xs text-muted">{menu.promo.cta}</span>
                </Link>
              )}
            </div>
          </div>
        )}
      </header>

      {/* phone menu */}
      <Overlay open={drawer} onClose={() => setDrawer(false)} label={c.nav.menu} variant="start" closeLabel={c.nav.close}>
        <div className="flex min-h-full flex-col px-6 pt-4 pb-8">
          <p className="label mt-2 mb-3">{c.nav.jewellery}</p>
          <ul className="divide-y divide-line border-y border-line">
            {menu.categories.map((k) => (
              <li key={k.slug}>
                <Link href={href(lang, `/shop/${k.slug}`)} className="flex h-14 items-center justify-between display text-xl">
                  {k.name}
                  <Icon name="chevron" className="size-4 text-faint rtl:-scale-x-100" />
                </Link>
              </li>
            ))}
            <li>
              <Link href={href(lang, "/shop")} className="flex h-14 items-center justify-between text-sm text-gold-text">
                {c.nav.all}
                <Icon name="chevron" className="size-4 rtl:-scale-x-100" />
              </Link>
            </li>
          </ul>
          <p className="label mt-8 mb-3">{c.nav.collections}</p>
          <div className="flex flex-wrap gap-2">
            {menu.collections.map((k) => (
              <Link key={k.slug} href={href(lang, `/collections/${k.slug}`)} className="border border-line px-3.5 py-2 text-sm text-ink-2">
                {k.name}
              </Link>
            ))}
          </div>
          <ul className="mt-8 space-y-1 text-sm">
            {[
              ["/craft", c.nav.craft],
              ["/maison", c.nav.maison],
              ["/care", c.nav.care],
              ["/contact", c.nav.contact],
            ].map(([to, label]) => (
              <li key={to}>
                <Link href={href(lang, to)} className="flex h-11 items-center text-ink-2">
                  {label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-auto space-y-3 pt-8">
            <button type="button" onClick={() => { setDrawer(false); openProSheet("code"); }} className="flex h-12 w-full items-center justify-center gap-2 border border-ink text-sm">
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
