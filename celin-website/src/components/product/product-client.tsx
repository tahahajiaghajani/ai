"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, ViewTransition, type CSSProperties, type ReactNode } from "react";
import { commonCopy } from "@/content/copy/common";
import { productCopy } from "@/content/copy/product";
import type { Product } from "@/lib/catalog-types";
import { num, type Lang } from "@/lib/format";
import { href, t } from "@/lib/i18n";
import { altOf, mediaUrl, srcSet, type Media } from "@/lib/media";
import { Picture } from "@/components/ui/picture";
import { Overlay } from "@/components/ui/overlay";
import { Icon } from "@/components/ui/icons";
import { ArchLines } from "@/components/fx/arch-lines";
import { SplitWords } from "@/components/fx/split-words";
import { Sparkles } from "@/components/fx/sparkles";
import { PriceSlot } from "@/components/pro/price-slot";
import { CodeInput } from "@/components/pro/code-input";
import { openProSheet } from "@/components/pro/events";
import { ProSeal } from "@/components/pro/pro-bar";
import { useMe, usePriceBook } from "@/components/pro/session";
import { cart, useCart } from "@/components/cart/cart-store";
import { Swatch } from "@/components/shop/swatch";
import { pieceName } from "@/components/shop/piece-name";
import { WishButton } from "@/components/shop/wish-button";

const same = (a: Media, b: Media) => a.src === b.src;
const diamond = (className: string) => (
  <svg viewBox="0 0 10 10" className={className} aria-hidden>
    <path d="M5 0 10 5 5 10 0 5Z" fill="currentColor" />
  </svg>
);

/**
 * Gallery: the pictures pass through one arch window (a niche on a bone ground, copper ring and keystone,
 * concentric arcade lines, live glints on the stones). Arch-topped thumbnails (never dots); swipe on phones
 * with the neighbouring arches in view; a full-screen viewer with zoom.
 */
function Gallery({ lang, product, images, index, setIndex }: { lang: Lang; product: Product; images: Media[]; index: number; setIndex: (i: number) => void }) {
  const tr = productCopy[lang];
  const strip = useRef<HTMLDivElement>(null);
  const auto = useRef(0);
  const [viewer, setViewer] = useState(false);
  const [zoom, setZoom] = useState(false);
  const name = t(product, "name", lang);

  // keep the swiper in step with the selected picture: centre its slide (both directions, RTL included)
  useEffect(() => {
    const el = strip.current;
    const slide = el?.children[index] as HTMLElement | undefined;
    if (!el || !slide) return;
    const a = el.getBoundingClientRect();
    const b = slide.getBoundingClientRect();
    const delta = b.left + b.width / 2 - (a.left + a.width / 2);
    if (Math.abs(delta) > 4) {
      auto.current = performance.now() + 800;
      el.scrollBy({ left: delta, behavior: "smooth" });
    }
  }, [index]);

  // a swipe picks the slide nearest the centre (ignored while the swiper moves on its own)
  const onScroll = () => {
    const el = strip.current;
    if (!el || performance.now() < auto.current) return;
    const a = el.getBoundingClientRect();
    const mid = a.left + a.width / 2;
    let best = 0;
    let dist = Number.POSITIVE_INFINITY;
    Array.from(el.children).forEach((c, i) => {
      const r = c.getBoundingClientRect();
      const d = Math.abs(r.left + r.width / 2 - mid);
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    if (best !== index) setIndex(best);
  };

  const main = images[index] ?? images[0];
  if (!main) return <div className="arch mx-auto aspect-[4/5] w-[76vw] bg-tile lg:w-full" />;
  return (
    <div className="relative isolate flex flex-col overflow-hidden bg-mesh-bone lg:flex-row lg:items-center lg:gap-6 lg:px-8 lg:py-10 xl:px-10">
      <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(55%_45%_at_50%_38%,var(--color-porcelain),transparent_75%)]" />

      {/* thumbnails: a row below on phones, a column beside the window on desktop */}
      {images.length > 1 && (
        <div className="order-2 flex justify-center gap-2.5 overflow-x-auto px-[var(--gutter)] pt-1.5 pb-7 [scrollbar-width:none] lg:order-none lg:w-16 lg:shrink-0 lg:flex-col lg:overflow-visible lg:px-0 lg:py-0" role="tablist" aria-label={`${name} — ${tr.gallery}`}>
          {images.map((m, i) => (
            <button
              key={m.src}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={tr.image(num(i + 1, lang), num(images.length, lang))}
              onClick={() => setIndex(i)}
              className={`relative w-12 shrink-0 transition-opacity duration-500 [--ring-gap:3px] lg:w-full ${i === index ? "opacity-100" : "opacity-55 hover:opacity-90"}`}
            >
              <span className={`arch-ring transition-opacity duration-500 ${i === index ? "opacity-100" : "opacity-0"}`} aria-hidden />
              <span className="arch relative block overflow-hidden">
                <Picture media={m} lang={lang} ratio="3/4" sizes="64px" alt="" />
              </span>
            </button>
          ))}
        </div>
      )}

      {/* the arch window */}
      <div className="relative min-w-0 flex-1 pt-9 pb-5 lg:py-0">
        <div className="relative mx-auto lg:w-[min(100%,calc((100svh-var(--header-h)-15rem)*0.8))]">
          <div aria-hidden className="pointer-events-none absolute inset-x-[3vw] -top-[7%] bottom-0 lg:inset-x-[-24%] lg:-top-[10%]">
            <ArchLines count={4} className="size-full opacity-80" />
          </div>
          {/* the ring and keystone stay put; the pictures pass beneath them */}
          <div aria-hidden className="pointer-events-none absolute inset-y-0 inset-x-[12vw] z-[2] lg:inset-x-0">
            <span className="arch-ring" style={{ "--ring": "color-mix(in srgb, var(--color-gold) 50%, transparent)" } as CSSProperties} />
            <svg viewBox="0 0 10 10" className="absolute left-1/2 top-[-12px] size-2.5 -translate-x-1/2 -translate-y-1/2 text-gold-bright">
              <path d="M5 0 10 5 5 10 0 5Z" fill="currentColor" />
            </svg>
          </div>
          <div
            ref={strip}
            onScroll={onScroll}
            onKeyDown={(e) => {
              const fwd = document.documentElement.dir === "rtl" ? "ArrowLeft" : "ArrowRight";
              const back = document.documentElement.dir === "rtl" ? "ArrowRight" : "ArrowLeft";
              if (e.key === fwd && index < images.length - 1) setIndex(index + 1);
              if (e.key === back && index > 0) setIndex(index - 1);
            }}
            className="relative flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain px-[12vw] [scrollbar-width:none] lg:gap-0 lg:px-0 [&::-webkit-scrollbar]:hidden"
          >
            {images.map((m, i) => (
              <button
                key={m.src}
                type="button"
                onClick={() => setViewer(true)}
                className="relative w-[76vw] shrink-0 snap-center cursor-zoom-in lg:w-full"
                aria-label={`${tr.zoom} — ${tr.image(num(i + 1, lang), num(images.length, lang))}`}
                data-cursor="view"
                data-cursor-label={tr.zoom}
              >
                <span className="arch relative block overflow-hidden bg-tile">
                  {i === 0 ? (
                    <ViewTransition name={`product-${product.id}`} share="morph" default="none">
                      <Picture media={m} lang={lang} ratio="4/5" sizes="(min-width: 1024px) 40vw, 76vw" priority alt={name} className="arch" />
                    </ViewTransition>
                  ) : (
                    <Picture media={m} lang={lang} ratio="4/5" sizes="(min-width: 1024px) 40vw, 76vw" alt={altOf(m, lang)} className="arch" />
                  )}
                  <Sparkles count={12} />
                </span>
              </button>
            ))}
          </div>
          {/* the sill */}
          <span aria-hidden className="hairline absolute inset-x-[7vw] -bottom-px block lg:inset-x-[-9%]" />
        </div>
        {images.length > 1 && (
          <p className="pointer-events-none mt-3 text-center font-ui text-xs text-muted tabular-nums" aria-hidden>
            {num(index + 1, lang)} <span className="text-faint">/</span> {num(images.length, lang)}
          </p>
        )}
        <WishButton slug={product.slug} lang={lang} className="absolute top-3 end-3 z-[3] rounded-full glass lg:top-0 lg:end-0" />
      </div>

      <Overlay open={viewer} onClose={() => { setViewer(false); setZoom(false); }} label={name} variant="top" closeLabel={tr.close} className="!max-h-[100dvh] h-[100dvh]">
        <div className="flex h-full flex-col bg-mesh-porcelain">
          <div className={`relative min-h-0 flex-1 ${zoom ? "overflow-auto" : "overflow-hidden"}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={mediaUrl(main, zoom ? 2400 : 1280)}
              srcSet={srcSet(main)}
              sizes={zoom ? "200vw" : "100vw"}
              alt={altOf(main, lang) || name}
              onClick={() => setZoom((z) => !z)}
              className={`mx-auto block select-none ${zoom ? "w-[200%] max-w-none cursor-zoom-out" : "h-full w-full cursor-zoom-in object-contain"}`}
              style={{ touchAction: "pinch-zoom" }}
            />
          </div>
          {images.length > 1 && (
            <div className="flex justify-center gap-2.5 border-t border-gold/20 p-3 [--ring-gap:3px]">
              {images.map((m, i) => (
                <button key={m.src} type="button" onClick={() => { setIndex(i); setZoom(false); }} className={`relative w-11 transition-opacity ${i === index ? "opacity-100" : "opacity-55 hover:opacity-90"}`} aria-label={tr.image(num(i + 1, lang), num(images.length, lang))}>
                  <span className={`arch-ring ${i === index ? "opacity-100" : "opacity-0"}`} aria-hidden />
                  <span className="arch relative block overflow-hidden">
                    <Picture media={m} lang={lang} ratio="3/4" sizes="48px" alt="" />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </Overlay>
    </div>
  );
}

function Stepper({ value, max, onChange, lang }: { value: number; max: number; onChange: (n: number) => void; lang: Lang }) {
  const tr = productCopy[lang];
  return (
    <div className="flex h-12 items-center border border-control bg-white" role="group" aria-label={tr.qty}>
      <button type="button" onClick={() => onChange(Math.max(1, value - 1))} disabled={value <= 1} className="grid h-full w-11 place-items-center text-ink-2 transition-colors hover:text-gold disabled:opacity-30" aria-label={tr.qtyLess}>
        <Icon name="minus" className="size-4" />
      </button>
      <span className="w-9 text-center font-ui text-sm tabular-nums" aria-live="polite">
        {num(value, lang)}
      </span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} className="grid h-full w-11 place-items-center text-ink-2 transition-colors hover:text-gold disabled:opacity-30" aria-label={tr.qtyMore}>
        <Icon name="plus" className="size-4" />
      </button>
    </div>
  );
}

/** What the visitor can do next: members order, everyone else is guided to Pro (never a dead end). */
function Actions({ lang, product, variantId, needsVariant, onAdded }: { lang: Lang; product: Product; variantId: string | null; needsVariant: boolean; onAdded: () => void }) {
  const tr = productCopy[lang];
  const c = commonCopy(lang);
  const me = useMe();
  const book = usePriceBook();
  const lines = useCart();
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  useEffect(() => {
    setQty(1);
    setAdded(false);
  }, [variantId]);

  if (me === undefined || (me?.pro.active && book === undefined)) return <div className="h-12 bg-bone/70" aria-hidden />;

  if (me?.pro.active && book) {
    const p = book.prices[product.id];
    const stock = p ? (variantId ? p.variants[variantId]?.stock ?? 0 : Object.keys(p.variants).length ? 0 : p.stock) : 0;
    const inCart = lines.find((l) => l.productId === product.id && l.variantId === variantId)?.qty ?? 0;
    const room = Math.max(0, stock - inCart);
    const seed = product.id.startsWith("seed-");
    if (needsVariant) return <p className="font-ui text-sm text-muted">{c.cart.chooseOption}</p>;
    if (stock <= 0) return <p className="text-sm leading-7 text-ink-2">{tr.outOfStock}</p>;
    return (
      <div className="space-y-3">
        <div className="flex gap-3">
          <Stepper value={Math.min(qty, Math.max(1, room))} max={Math.max(1, room)} onChange={setQty} lang={lang} />
          <button
            type="button"
            disabled={room <= 0 || seed}
            onClick={() => {
              cart.add(product.id, variantId, Math.min(qty, room));
              setAdded(true);
              onAdded();
            }}
            className="btn btn-metal min-h-12 flex-1 px-6"
          >
            <Icon name="bag" className="size-4" />
            {tr.add}
          </button>
        </div>
        {room < stock && room >= 0 && <p className="font-ui text-xs text-muted">{tr.maxStock(num(stock, lang))}</p>}
        {added && (
          <p className="flex animate-fade-in items-center justify-between gap-3 border border-gold/40 bg-gold-mist px-4 py-2.5 font-ui text-sm text-gold-text" role="status">
            <span className="flex items-center gap-2">
              <Icon name="check" className="size-4" />
              {tr.added}
            </span>
            <Link href={href(lang, "/account/cart")} className="underline underline-offset-4">
              {tr.viewOrder}
            </Link>
          </p>
        )}
      </div>
    );
  }

  if (me && me.pro.issued) {
    return (
      <div className="space-y-3 border border-line bg-white/80 p-4">
        <p className="text-sm text-ink-2">{tr.issued}</p>
        <CodeInput lang={lang} />
      </div>
    );
  }
  if (me && me.pro.request === "pending") return <p className="border border-line bg-bone/70 px-4 py-3 text-sm leading-7 text-ink-2">{tr.pending}</p>;
  if (me) {
    return (
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <Link href={`${href(lang, "/pro")}#request`} className="btn btn-metal min-h-12 flex-[1_0_auto] whitespace-nowrap">
          {tr.request}
        </Link>
        <button type="button" onClick={() => openProSheet("code")} className="font-ui text-sm text-gold-text underline-offset-8 hover:underline">
          {tr.haveCode}
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      <button type="button" onClick={() => openProSheet("code")} className="btn btn-metal min-h-12 flex-[1_0_auto] whitespace-nowrap">
        <Icon name="unlock" className="size-4" />
        {tr.unlock}
      </button>
      <Link href={href(lang, "/pro")} className="font-ui text-sm text-gold-text underline-offset-8 hover:underline">
        {tr.request}
      </Link>
    </div>
  );
}

export function ProductClient({
  lang,
  product,
  collectionName,
  contact,
  details,
}: {
  lang: Lang;
  product: Product;
  collectionName: string | null;
  contact: { whatsapp: string; phone: string };
  details: ReactNode;
}) {
  const tr = productCopy[lang];
  const c = commonCopy(lang);
  const me = useMe();
  const variants = product.variants;
  const [variantId, setVariantId] = useState<string | null>(variants.length === 1 ? variants[0].id : null);
  const variant = variants.find((v) => v.id === variantId) ?? null;

  // the gallery: product pictures, with the chosen option's picture shown when it has one
  const images = useMemo(() => {
    const list = [...product.images];
    for (const v of variants) if (v.image && !list.some((m) => same(m, v.image!))) list.push(v.image);
    return list;
  }, [product.images, variants]);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (variant?.image) {
      const i = images.findIndex((m) => same(m, variant.image!));
      if (i >= 0) setIndex(i);
    }
  }, [variant, images]);

  // the sticky phone bar appears once the main action has scrolled away
  const actionsRef = useRef<HTMLDivElement>(null);
  const [sticky, setSticky] = useState(false);
  useEffect(() => {
    const el = actionsRef.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([e]) => setSticky(!e.isIntersecting && e.boundingClientRect.top < 0), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const name = t(product, "name", lang);
  const subtitle = t(product, "subtitle", lang);
  const wa = contact.whatsapp ? `https://wa.me/98${contact.whatsapp.replace(/^0/, "")}?text=${encodeURIComponent(`${name} (${product.sku})`)}` : "";
  const locked = me !== undefined && !me?.pro.active;

  return (
    <div className="lg:container-lux lg:grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-12 lg:pt-5 xl:gap-16">
      <div className="lg:sticky lg:top-[calc(var(--header-h)+20px)] lg:self-start">
        <Gallery lang={lang} product={product} images={images} index={index} setIndex={setIndex} />
      </div>

      <div className="container-lux pt-8 pb-12 lg:px-0 lg:pt-6">
        {collectionName && product.collection && (
          <Link href={href(lang, `/collections/${product.collection}`)} className="label inline-flex items-center gap-2.5 text-gold-text! transition-colors hover:text-gold-deep!">
            {diamond("size-1.5 text-gold")}
            {tr.collection(collectionName)}
          </Link>
        )}
        <SplitWords as="h1" text={collectionName && product.collection ? pieceName(name, collectionName) : name} immediate className="title-page mt-3 text-ink" />
        {subtitle && <p className="mt-3 text-base leading-8 text-muted">{subtitle}</p>}
        <p className="mt-2 font-ui text-xs text-muted">
          {tr.ref} <span className="font-label tracking-wide text-muted ltr">{variant?.sku || product.sku}</span>
        </p>

        {/* the jewel box: price, options and the next step, in a copper hairline frame */}
        <div className="frame-metal glass relative isolate mt-7 overflow-hidden p-5 [--frame:var(--metal-copper)] sm:p-6">
          <span aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(70%_60%_at_100%_0%,var(--color-gold-mist),transparent_70%),radial-gradient(60%_60%_at_0%_100%,var(--color-champagne-2),transparent_70%)]" />
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <PriceSlot productId={product.id} variantId={variantId} lang={lang} size="pdp" className="font-ui text-xl!" />
              {locked && <p className="mt-1 font-ui text-xs leading-6 text-muted">{tr.lockedNote}</p>}
            </div>
            {locked && <ProSeal className="mt-0.5" />}
          </div>

          {variants.length > 0 && (
            <fieldset className="mt-5 border-t border-gold/20 pt-5">
              <legend className="sr-only">{tr.option}</legend>
              <p className="mb-3 font-ui text-sm text-ink-2" aria-hidden>
                {tr.option}
                {variant && <span className="ms-2 text-ink">{t(variant, "name", lang)}</span>}
              </p>
              <div className="flex flex-wrap gap-2">
                {variants.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    aria-pressed={v.id === variantId}
                    onClick={() => setVariantId(v.id)}
                    title={t(v, "name", lang)}
                    className={`flex h-11 items-center gap-2 border px-3 text-sm transition-colors duration-300 ${v.id === variantId ? "border-ink bg-white text-ink shadow-[inset_0_0_0_1px_var(--color-ink)]" : "border-line-strong bg-white/50 text-ink-2 hover:border-gold"}`}
                  >
                    <Swatch swatch={v.swatch} className="size-4" />
                    {t(v, "name", lang)}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <div ref={actionsRef} className="mt-5">
            <Actions lang={lang} product={product} variantId={variantId} needsVariant={variants.length > 0 && !variantId} onAdded={() => undefined} />
          </div>
        </div>

        {(wa || contact.phone) && (
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 font-ui text-sm text-ink-2">
            <span>{tr.concierge}</span>
            {wa && (
              <a href={wa} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-gold-text hover:underline">
                <Icon name="whatsapp" className="size-4" />
                {tr.whatsapp}
              </a>
            )}
            {contact.phone && (
              <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1.5 text-gold-text hover:underline">
                <Icon name="phone" className="size-4" />
                {tr.call}
              </a>
            )}
          </div>
        )}

        <ul className="mt-6 space-y-2.5 text-sm leading-7 text-ink-2">
          {tr.service.map((s) => (
            <li key={s} className="flex items-start gap-3">
              {diamond("mt-2.5 size-1.5 shrink-0 text-gold")}
              {s}
            </li>
          ))}
        </ul>

        <div className="mt-8">{details}</div>
      </div>

      {/* phone: sticky action bar */}
      <div
        className={`glass fixed inset-x-0 bottom-0 z-40 border-t border-gold/25 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-transform duration-500 ease-[var(--ease-lux)] lg:hidden ${sticky ? "translate-y-0" : "translate-y-full"}`}
        aria-hidden={!sticky}
      >
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{name}</p>
            <PriceSlot productId={product.id} variantId={variantId} lang={lang} showStock={false} className="font-ui" />
          </div>
          <button type="button" tabIndex={sticky ? 0 : -1} onClick={() => actionsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })} className="btn btn-metal min-h-11 px-5">
            {me?.pro.active ? tr.add : c.proBar.guestCta}
          </button>
        </div>
      </div>
    </div>
  );
}
