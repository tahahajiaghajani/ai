"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, ViewTransition, type ReactNode } from "react";
import { commonCopy } from "@/content/copy/common";
import { productCopy } from "@/content/copy/product";
import type { Product } from "@/lib/catalog-types";
import { num, type Lang } from "@/lib/format";
import { href, t } from "@/lib/i18n";
import { altOf, mediaUrl, srcSet, type Media } from "@/lib/media";
import { Picture } from "@/components/ui/picture";
import { Overlay } from "@/components/ui/overlay";
import { Icon } from "@/components/ui/icons";
import { PriceSlot } from "@/components/pro/price-slot";
import { CodeInput } from "@/components/pro/code-input";
import { openProSheet } from "@/components/pro/events";
import { useMe, usePriceBook } from "@/components/pro/session";
import { cart, useCart } from "@/components/cart/cart-store";
import { Swatch } from "@/components/shop/swatch";
import { WishButton } from "@/components/shop/wish-button";

const same = (a: Media, b: Media) => a.src === b.src;

/** Gallery: big picture with a thumbnail strip (never dots), swipe on phones, a full-screen viewer with zoom. */
function Gallery({ lang, product, images, index, setIndex }: { lang: Lang; product: Product; images: Media[]; index: number; setIndex: (i: number) => void }) {
  const tr = productCopy[lang];
  const strip = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState(false);
  const [zoom, setZoom] = useState(false);
  const name = t(product, "name", lang);

  // keep the phone swiper in step with the selected picture
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const w = el.clientWidth;
    const target = index * w * (document.documentElement.dir === "rtl" ? -1 : 1);
    if (Math.abs(el.scrollLeft - target) > 4) el.scrollTo({ left: target, behavior: "smooth" });
  }, [index]);

  const onScroll = () => {
    const el = strip.current;
    if (!el) return;
    const i = Math.round(Math.abs(el.scrollLeft) / el.clientWidth);
    if (i !== index && i >= 0 && i < images.length) setIndex(i);
  };

  const main = images[index] ?? images[0];
  if (!main) return <div className="aspect-[4/5] bg-tile" />;
  return (
    <div className="lg:flex lg:gap-4">
      {/* thumbnails: below on phones, a column beside the picture on desktop */}
      {images.length > 1 && (
        <div className="order-2 mt-3 flex gap-2 overflow-x-auto px-[var(--gutter)] [scrollbar-width:none] lg:order-none lg:mt-0 lg:w-[72px] lg:shrink-0 lg:flex-col lg:px-0" role="tablist" aria-label={name}>
          {images.map((m, i) => (
            <button
              key={m.src}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={tr.image(num(i + 1, lang), num(images.length, lang))}
              onClick={() => setIndex(i)}
              className={`relative w-14 shrink-0 border-b-2 pb-1 transition-colors lg:w-full ${i === index ? "border-ink" : "border-transparent opacity-70 hover:opacity-100"}`}
            >
              <Picture media={m} lang={lang} ratio="4/5" sizes="72px" alt="" />
            </button>
          ))}
        </div>
      )}
      <div className="relative min-w-0 flex-1">
        {/* one swiper for every screen: swipe on phones, thumbnails (and arrow keys) on desktop */}
        <div
          ref={strip}
          onScroll={onScroll}
          onKeyDown={(e) => {
            const fwd = document.documentElement.dir === "rtl" ? "ArrowLeft" : "ArrowRight";
            const back = document.documentElement.dir === "rtl" ? "ArrowRight" : "ArrowLeft";
            if (e.key === fwd && index < images.length - 1) setIndex(index + 1);
            if (e.key === back && index > 0) setIndex(index - 1);
          }}
          className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]"
        >
          {images.map((m, i) => (
            <button key={m.src} type="button" onClick={() => setViewer(true)} className="w-full shrink-0 snap-center cursor-zoom-in" aria-label={`${tr.zoom} — ${tr.image(num(i + 1, lang), num(images.length, lang))}`}>
              {i === 0 ? (
                <ViewTransition name={`product-${product.id}`} share="morph" default="none">
                  <Picture media={m} lang={lang} ratio="4/5" sizes="(min-width: 1024px) 55vw, 100vw" priority alt={name} />
                </ViewTransition>
              ) : (
                <Picture media={m} lang={lang} ratio="4/5" sizes="(min-width: 1024px) 55vw, 100vw" alt={altOf(m, lang)} />
              )}
            </button>
          ))}
        </div>
        <WishButton slug={product.slug} lang={lang} className="absolute top-2 end-2 bg-ground/70 backdrop-blur-sm" />
        {images.length > 1 && (
          <span className="pointer-events-none absolute bottom-3 start-3 bg-ground/80 px-2 py-0.5 text-xs text-ink-2 tabular-nums">
            {num(index + 1, lang)} / {num(images.length, lang)}
          </span>
        )}
      </div>

      <Overlay open={viewer} onClose={() => { setViewer(false); setZoom(false); }} label={name} variant="top" closeLabel={tr.close} className="!max-h-[100dvh] h-[100dvh]">
        <div className="flex h-full flex-col">
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
            <div className="flex justify-center gap-2 border-t border-line p-3">
              {images.map((m, i) => (
                <button key={m.src} type="button" onClick={() => { setIndex(i); setZoom(false); }} className={`w-12 border-b-2 pb-1 ${i === index ? "border-ink" : "border-transparent opacity-60"}`} aria-label={tr.image(num(i + 1, lang), num(images.length, lang))}>
                  <Picture media={m} lang={lang} ratio="4/5" sizes="48px" alt="" />
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
    <div className="flex h-12 items-center border border-control" role="group" aria-label={tr.qty}>
      <button type="button" onClick={() => onChange(Math.max(1, value - 1))} disabled={value <= 1} className="grid h-full w-11 place-items-center text-ink-2 disabled:opacity-30" aria-label="−">
        <Icon name="minus" className="size-4" />
      </button>
      <span className="w-10 text-center text-sm tabular-nums" aria-live="polite">
        {num(value, lang)}
      </span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} className="grid h-full w-11 place-items-center text-ink-2 disabled:opacity-30" aria-label="+">
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

  if (me === undefined || (me?.pro.active && book === undefined)) return <div className="h-12 bg-bone" aria-hidden />;

  if (me?.pro.active && book) {
    const p = book.prices[product.id];
    const stock = p ? (variantId ? p.variants[variantId]?.stock ?? 0 : Object.keys(p.variants).length ? 0 : p.stock) : 0;
    const inCart = lines.find((l) => l.productId === product.id && l.variantId === variantId)?.qty ?? 0;
    const room = Math.max(0, stock - inCart);
    const seed = product.id.startsWith("seed-");
    if (needsVariant) return <p className="text-sm text-muted">{c.cart.chooseOption}</p>;
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
            className="h-12 flex-1 bg-ink px-6 text-sm text-bone transition-colors hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {tr.add}
          </button>
        </div>
        {room < stock && room >= 0 && <p className="text-xs text-muted">{tr.maxStock(num(stock, lang))}</p>}
        {added && (
          <p className="flex items-center justify-between gap-3 border border-gold/40 bg-gold-mist px-4 py-2.5 text-sm text-gold-text" role="status">
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
      <div className="space-y-3 border border-line bg-white p-4">
        <p className="text-sm text-ink-2">{tr.issued}</p>
        <CodeInput lang={lang} />
      </div>
    );
  }
  if (me && me.pro.request === "pending") return <p className="border border-line bg-bone px-4 py-3 text-sm leading-7 text-ink-2">{tr.pending}</p>;
  if (me) {
    return (
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <Link href={`${href(lang, "/pro")}#request`} className="inline-flex h-12 flex-1 items-center justify-center bg-ink px-6 text-sm text-bone hover:bg-ink-2">
          {tr.request}
        </Link>
        <button type="button" onClick={() => openProSheet("code")} className="text-sm text-gold-text underline-offset-8 hover:underline">
          {tr.haveCode}
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      <button type="button" onClick={() => openProSheet("code")} className="h-12 flex-1 bg-ink px-6 text-sm text-bone hover:bg-ink-2">
        {tr.unlock}
      </button>
      <Link href={`${href(lang, "/pro")}`} className="text-sm text-gold-text underline-offset-8 hover:underline">
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
  const wa = contact.whatsapp ? `https://wa.me/98${contact.whatsapp.replace(/^0/, "")}?text=${encodeURIComponent(`${name} (${product.sku})`)}` : "";

  return (
    <div className="lg:container-lux lg:grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-14 lg:pt-8 xl:gap-20">
      <Gallery lang={lang} product={product} images={images} index={index} setIndex={setIndex} />

      <div className="container-lux pt-7 pb-12 lg:sticky lg:top-[calc(var(--header-h)+24px)] lg:self-start lg:px-0 lg:pt-4">
        {collectionName && product.collection && (
          <Link href={href(lang, `/collections/${product.collection}`)} className="label hover:text-ink">
            {tr.collection(collectionName)}
          </Link>
        )}
        <h1 className="display mt-3 text-3xl sm:text-4xl">{name}</h1>
        {t(product, "subtitle", lang) && <p className="mt-2 text-sm leading-7 text-muted">{t(product, "subtitle", lang)}</p>}
        <p className="mt-3 text-xs text-faint">
          {tr.ref} <span className="font-label tracking-wide text-muted ltr">{variant?.sku || product.sku}</span>
        </p>

        <div className="mt-6 border-t border-line pt-5">
          <PriceSlot productId={product.id} variantId={variantId} lang={lang} size="pdp" />
          {me !== undefined && !me?.pro.active && <p className="mt-1 text-xs text-muted">{tr.lockedNote}</p>}
        </div>

        {variants.length > 0 && (
          <fieldset className="mt-6">
            <legend className="mb-3 text-sm text-ink-2">
              {tr.option}
              {variant && <span className="ms-2 text-ink">{t(variant, "name", lang)}</span>}
            </legend>
            <div className="flex flex-wrap gap-2">
              {variants.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={v.id === variantId}
                  onClick={() => setVariantId(v.id)}
                  title={t(v, "name", lang)}
                  className={`flex h-11 items-center gap-2 border px-3 text-sm transition-colors ${v.id === variantId ? "border-ink text-ink" : "border-line text-ink-2 hover:border-line-strong"}`}
                >
                  <Swatch swatch={v.swatch} className="size-4" />
                  {t(v, "name", lang)}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <div ref={actionsRef} className="mt-6">
          <Actions lang={lang} product={product} variantId={variantId} needsVariant={variants.length > 0 && !variantId} onAdded={() => undefined} />
        </div>

        {(wa || contact.phone) && (
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink-2">
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

        <ul className="mt-6 space-y-2 border-t border-line pt-5 text-sm text-ink-2">
          {tr.service.map((s) => (
            <li key={s} className="flex items-start gap-2.5">
              <span className="mt-2.5 size-1 shrink-0 rounded-full bg-gold" aria-hidden />
              {s}
            </li>
          ))}
        </ul>

        <div className="mt-6">{details}</div>
      </div>

      {/* phone: sticky action bar */}
      <div
        className={`fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ground/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md transition-transform duration-500 lg:hidden ${sticky ? "translate-y-0" : "translate-y-full"}`}
        aria-hidden={!sticky}
      >
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-muted">{name}</p>
            <PriceSlot productId={product.id} variantId={variantId} lang={lang} showStock={false} />
          </div>
          <button
            type="button"
            tabIndex={sticky ? 0 : -1}
            onClick={() => actionsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
            className="h-11 bg-ink px-5 text-sm text-bone"
          >
            {me?.pro.active ? tr.add : c.proBar.guestCta}
          </button>
        </div>
      </div>
    </div>
  );
}
