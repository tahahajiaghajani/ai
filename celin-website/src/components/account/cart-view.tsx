"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { placeOrder } from "@/app/actions/orders";
import { accountCopy } from "@/content/copy/account";
import { commonCopy } from "@/content/copy/common";
import { formatDate, formatPct, formatPrice, latinDigits, normalizePhone, num, type Lang } from "@/lib/format";
import { href, t } from "@/lib/i18n";
import type { Media } from "@/lib/media";
import { MAX_QTY, type CartLine } from "@/lib/order-meta";
import { invoiceLines, linePieces, piecePrice } from "@/lib/basket";
import { maxPacks, packCap } from "@/lib/packs";
import { invoice, listPrice, unitAt } from "@/lib/pricing";
import { saleTitle } from "@/lib/sale";
import { Icon } from "@/components/ui/icons";
import { Picture } from "@/components/ui/picture";
import { cart, useCart } from "@/components/cart/cart-store";
import { ProCodeLink } from "@/components/pro/pro-code-link";
import { ProSeal } from "@/components/pro/seal";
import { ProSteps } from "@/components/pro/steps";
import { LuxFrame } from "@/components/ui/lux-frame";
import { stockBand } from "@/components/pro/price-slot";
import { StepNote } from "@/components/pro/step-note";
import { sessionChanged, useHydrated, useMe, usePriceBook, type PriceBook } from "@/components/pro/session";
import { Swatch } from "@/components/shop/swatch";
import { StoreContact, type StoreContactInfo } from "@/components/account/contact";
import { Empty, FormNote, SectionTitle, TextArea, TextField, btn } from "@/components/account/ui";

export interface CartVariant {
  id: string;
  name_fa: string;
  name_en: string;
  swatch: string;
  image: Media | null;
}
export interface CartProduct {
  id: string;
  slug: string;
  name_fa: string;
  name_en: string;
  image: Media | null;
  variants: CartVariant[];
  /** how it is sold now (src/lib/packs.ts): a line of a pack that is no longer offered cannot be ordered */
  packs: number[];
}
export interface DeliveryDefaults {
  name: string;
  phone: string;
  business: string;
  city: string;
  address: string;
  postal_code: string;
}

type Problem = "gone" | "variant" | "pack" | "out" | "over" | "noPrice" | null;

interface LineView {
  line: CartLine;
  product?: CartProduct;
  variant?: CartVariant;
  price: number | null;
  stock: number;
  /** the pieces this line may hold: the stock less the other lines of the same piece and option (pieces) */
  room: number;
  problem: Problem;
}

const DOT = { in: "bg-success", low: "bg-warning", out: "bg-faint" };
const key = (l: CartLine) => `${l.productId}:${l.variantId ?? ""}:${l.pack}`;

function view(lines: CartLine[], products: Map<string, CartProduct>, book: PriceBook): LineView[] {
  return lines.map((line) => {
    const product = products.get(line.productId);
    const variant = line.variantId ? product?.variants.find((v) => v.id === line.variantId) : undefined;
    const pp = book.prices[line.productId];
    const vp = line.variantId ? pp?.variants[line.variantId] : undefined;
    const gone = !product || !pp || (line.variantId ? !variant || !vp : false);
    const needsVariant = !gone && !line.variantId && (product!.variants.length > 0 || Object.keys(pp!.variants).length > 0);
    const price = gone ? null : (piecePrice(book.prices, line) ?? null);
    const stock = gone ? 0 : vp ? vp.stock : pp!.stock;
    // a single line and a pack line of the same piece and option share its stock. A count below one line's cap is a
    // real one (a Pro account's stock); members only ever get "orderable" (MAX_QTY) — the database checks the rest.
    const others = stock < MAX_QTY ? lines.filter((l) => l !== line && l.productId === line.productId && l.variantId === line.variantId).reduce((n, l) => n + linePieces(l), 0) : 0;
    const room = Math.max(0, stock - others);
    const unsold = !gone && !(product!.packs ?? [1]).includes(line.pack);
    const problem: Problem = gone ? "gone" : needsVariant ? "variant" : unsold ? "pack" : stock <= 0 ? "out" : linePieces(line) > room ? "over" : price === null ? "noPrice" : null;
    return { line, product, variant, price, stock, room, problem };
  });
}

/** «سفارش جدید»: the basket with live prices and stock, the delivery form and «ثبت سفارش برای تأیید فروشگاه». */
export function CartView({
  lang,
  products: list,
  seed,
  orderNote,
  contact,
  defaults,
}: {
  lang: Lang;
  products: CartProduct[];
  seed: boolean;
  orderNote: string;
  contact: StoreContactInfo;
  defaults: DeliveryDefaults;
}) {
  const c = accountCopy(lang).cart;
  const f = accountCopy(lang).fields;
  const router = useRouter();
  const hydrated = useHydrated();
  const lines = useCart();
  const book = usePriceBook();
  const me = useMe();
  const products = useMemo(() => new Map(list.map((p) => [p.id, p])), [list]);
  const [form, setForm] = useState({ ...defaults, postal_code: num(defaults.postal_code, lang), note: "" });
  const [save, setSave] = useState(true);
  const [errors, setErrors] = useState<Partial<Record<"name" | "phone" | "city" | "address" | "postal_code", string>>>({});
  const [error, setError] = useState("");
  const [badItem, setBadItem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [placed, setPlaced] = useState(false);

  // a line that the server flagged stays marked until it changes
  useEffect(() => {
    if (badItem && !lines.some((l) => l.productId === badItem || l.variantId === badItem)) setBadItem(null);
  }, [lines, badItem]);

  if (!hydrated || placed) {
    return <div className="min-h-64 text-sm text-muted">{placed ? c.placed : null}</div>;
  }
  if (book === null) {
    // Pro but no prices: the price service did not answer this time
    if (me?.pro.active) {
      return (
        <div className="max-w-2xl space-y-4">
          <FormNote tone="error">{c.pricesFailed}</FormNote>
          <button type="button" onClick={() => void sessionChanged()} className={btn.outline}>
            {commonCopy(lang).actions.retry}
          </button>
        </div>
      );
    }
    return <NotPro lang={lang} />;
  }
  if (!lines.length) {
    return (
      <Empty
        action={
          <Link href={href(lang, "/shop")} className={btn.outline}>
            {c.emptyCta}
          </Link>
        }
      >
        {c.empty}
      </Empty>
    );
  }
  if (book === undefined) {
    return (
      <div aria-busy className="space-y-px">
        <p className="sr-only">{c.loadingPrices}</p>
        {lines.map((l) => (
          <div key={key(l)} className="flex gap-4 border-b border-line py-5">
            <span className="aspect-[4/5] w-18 bg-bone sm:w-24" />
            <span className="flex-1 space-y-3 pt-1">
              <span className="block h-3 w-1/2 bg-bone" />
              <span className="block h-3 w-1/3 bg-bone" />
            </span>
          </div>
        ))}
      </div>
    );
  }

  const rows = view(lines, products, book);
  // the invoice exactly as the order will be placed (src/lib/basket.ts, src/lib/pricing.ts): the lines at the list
  // price, the step of every piece of the order together, then the special-day discount
  const bill = invoice(
    invoiceLines(
      rows.filter((r) => r.problem !== "gone").map((r) => r.line),
      book.prices,
    ),
    book.pricing,
  );
  const sale = book.pricing.sale;
  const saleEnd = sale?.until ? formatDate(new Date(Date.parse(sale.until) - 1).toISOString(), lang) : "";
  const belowMin = book.minOrder > 0 && bill.total < book.minOrder;
  const blocked = rows.some((r) => r.problem) || belowMin;

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm((s) => ({ ...s, [k]: e.target.value }));
    if (k in errors) setErrors((s) => ({ ...s, [k]: undefined }));
  };

  function validate(): boolean {
    const e: typeof errors = {};
    if (form.name.trim().length < 2) e.name = c.errors.name;
    if (!normalizePhone(form.phone)) e.phone = c.errors.phone;
    if (!form.city.trim()) e.city = c.errors.city;
    if (form.address.trim().length < 6) e.address = c.errors.address;
    const postal = latinDigits(form.postal_code).replace(/[\s-]/g, "");
    if (postal && !/^\d{10}$/.test(postal)) e.postal_code = f.postalBad;
    setErrors(e);
    const first = (["name", "phone", "city", "address", "postal_code"] as const).find((k) => e[k]);
    if (first) document.getElementById(`cart-${first}`)?.focus();
    return !first;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending || blocked || seed) return;
    setError("");
    if (!validate()) return;
    setPending(true);
    try {
      const r = await placeOrder({
        lines,
        customer: { name: form.name, phone: form.phone, business: form.business, city: form.city, address: form.address, postal_code: latinDigits(form.postal_code).replace(/[\s-]/g, "") },
        note: form.note,
        saveAddress: save,
        seen: bill.total,
        lang,
      });
      if (r.ok) {
        setPlaced(true);
        cart.clear();
        router.push(`${href(lang, `/account/orders/${r.code}`)}?placed=1`);
        void sessionChanged();
        return;
      }
      const reason = r.reason ?? "";
      if (reason.startsWith("field:")) {
        const field = reason.slice(6) === "address" && !form.city.trim() ? "city" : (reason.slice(6) as "name" | "phone" | "address");
        setErrors({ [field]: r.error });
        document.getElementById(`cart-${field}`)?.focus();
      } else {
        setError(r.error);
        if (r.itemId) {
          if (reason === "product_unavailable" || reason === "variant_unavailable") {
            for (const l of lines) if (l.productId === r.itemId || l.variantId === r.itemId) cart.remove(l.productId, l.variantId, l.pack);
          } else setBadItem(r.itemId);
        }
        if (reason === "out_of_stock" || reason === "price_changed") void sessionChanged();
        // the admin changed how a piece is sold: the page's catalogue says which line, and how it is sold now
        if (reason === "pack_unavailable") router.refresh();
      }
    } catch {
      setError(commonCopy(lang).errors.network);
    }
    setPending(false);
  }

  return (
    <form onSubmit={submit} noValidate className="max-w-3xl space-y-12">
      <section aria-label={c.title}>
        <p className="mb-3 text-sm text-muted">{c.lines(num(bill.pieces, lang))}</p>
        <ul className="border-t border-line">
          {rows.map((r) => (
            <Line key={key(r.line)} r={r} lang={lang} book={book} pct={bill.pct} sale={bill.sale} flagged={Boolean(badItem && (r.line.productId === badItem || r.line.variantId === badItem))} />
          ))}
        </ul>
        {/* list → «تخفیف تعداد» (every piece of the order together) → the special-day discount → what is charged */}
        <dl className="mt-6 space-y-2">
          {(bill.stepDiscount > 0 || bill.saleDiscount > 0) && (
            <div className="flex items-baseline justify-between gap-6">
              <dt className="text-sm text-ink-2">{c.listTotal}</dt>
              <dd className="text-sm text-ink-2 tabular-nums">{formatPrice(bill.list, lang)}</dd>
            </div>
          )}
          {bill.stepDiscount > 0 && (
            <div className="flex items-baseline justify-between gap-6">
              <dt className="text-sm text-success">{c.stepDiscount(num(bill.pieces, lang), formatPct(bill.off, lang))}</dt>
              <dd className="shrink-0 text-sm text-success tabular-nums">− {formatPrice(bill.stepDiscount, lang)}</dd>
            </div>
          )}
          {bill.saleDiscount > 0 && sale && (
            <div className="flex items-baseline justify-between gap-6">
              <dt className="text-sm text-success">{c.saleDiscount(saleTitle(sale, lang), formatPct(bill.sale, lang))}</dt>
              <dd className="shrink-0 text-sm text-success tabular-nums">− {formatPrice(bill.saleDiscount, lang)}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-6">
            <dt className="text-sm text-ink-2">{c.subtotal}</dt>
            <dd className="text-lg text-ink tabular-nums">{formatPrice(bill.total, lang)}</dd>
          </div>
        </dl>
        <p className="mt-1 text-xs leading-6 text-muted">{c.subtotalNote}</p>
        {book.pricing.steps.length > 0 && <p className="text-xs leading-6 text-muted">{c.stepsNote}</p>}
        {sale && c.saleNote(saleEnd, book.pricing.steps.length > 0) && <p className="text-xs leading-6 text-muted">{c.saleNote(saleEnd, book.pricing.steps.length > 0)}</p>}
        <StepNote lang={lang} pricing={book.pricing} pieces={bill.pieces} className="mt-3 text-sm! leading-7!" />
        {belowMin && (
          <div className="mt-5">
            <FormNote tone="info">
              {c.minOrder(formatPrice(book.minOrder, lang))} {c.minLeft(formatPrice(book.minOrder - bill.total, lang))}
            </FormNote>
          </div>
        )}
      </section>

      <section aria-labelledby="cart-delivery">
        <SectionTitle id="cart-delivery">{c.delivery}</SectionTitle>
        <p className="-mt-2 mb-7 text-sm text-muted">{c.deliveryLead}</p>
        <div className="grid gap-6 sm:grid-cols-2">
          <TextField id="cart-name" label={c.recipient} value={form.name} onChange={set("name")} autoComplete="name" maxLength={80} required error={errors.name} />
          <TextField id="cart-phone" label={f.phone} type="tel" inputMode="tel" dir="ltr" value={form.phone} onChange={set("phone")} autoComplete="tel" maxLength={30} required error={errors.phone} />
          <TextField id="cart-business" label={f.business} optional={f.optional} value={form.business} onChange={set("business")} autoComplete="organization" maxLength={120} />
          <TextField id="cart-city" label={f.city} value={form.city} onChange={set("city")} autoComplete="address-level2" maxLength={80} required error={errors.city} />
          <TextArea id="cart-address" label={f.address} value={form.address} onChange={set("address")} autoComplete="street-address" maxLength={400} rows={2} required help={f.addressHelp} error={errors.address} wrapClassName="sm:col-span-2" />
          <TextField
            id="cart-postal_code"
            label={f.postal}
            optional={f.optional}
            value={form.postal_code}
            onChange={set("postal_code")}
            inputMode="numeric"
            dir="ltr"
            autoComplete="postal-code"
            maxLength={14}
            help={f.postalHelp}
            error={errors.postal_code}
          />
          <TextArea
            id="cart-note"
            label={c.note}
            optional={f.optional}
            value={form.note}
            onChange={set("note")}
            maxLength={1500}
            rows={3}
            placeholder={c.notePlaceholder}
            // packs of sizes: the store picks the sizes unless the member asks for particular ones here
            help={lines.some((l) => l.pack > 1) ? c.sizesHelp : undefined}
            wrapClassName="sm:col-span-2"
          />
        </div>
        <label className="mt-6 flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink-2">
          <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} className="size-5 shrink-0 accent-ink" />
          {c.save}
        </label>
      </section>

      <section className="space-y-5 border-t border-line pt-8">
        {orderNote && <p className="border-s border-gold/60 ps-4 text-sm leading-7 text-ink-2">{orderNote}</p>}
        {/* the notes are alerts of their own */}
        <div className="space-y-3 empty:hidden">
          {error && <FormNote tone="error">{error}</FormNote>}
          {!error && rows.some((r) => r.problem) && <FormNote tone="error">{c.blocked}</FormNote>}
        </div>
        {seed ? (
          <div className="border border-line bg-bone px-5 py-5">
            <p className="text-sm leading-7 text-ink">{c.seed}</p>
            <StoreContact contact={contact} lang={lang} className="mt-2" />
          </div>
        ) : (
          <button type="submit" aria-disabled={pending || blocked || undefined} className={`${btn.primary} w-full sm:w-auto sm:min-w-80`}>
            {pending ? c.submitting : c.submit}
          </button>
        )}
      </section>
    </form>
  );
}

/**
 * One line: the original price struck through and the price at the order's quantity step (less the special-day
 * discount while it runs) beside it, the line at that price.
 */
function Line({ r, lang, book, pct, sale, flagged }: { r: LineView; lang: Lang; book: PriceBook; pct: number; sale: number; flagged: boolean }) {
  const list = r.price === null ? null : listPrice(r.price, book.pricing);
  const now = r.price === null ? null : unitAt(r.price, pct, sale);
  const stepped = list !== null && now !== null && now < list;
  const was = commonCopy(lang).price;
  const c = accountCopy(lang).cart;
  const { line, product, variant } = r;
  const name = product ? t(product, "name", lang) : c.gone;
  const option = variant ? t(variant, "name", lang) : "";
  const media = variant?.image ?? product?.image ?? null;
  // the stepper counts packs of `line.pack` pieces (1: pieces); everything priced counts pieces
  const pack = line.pack;
  const pieces = linePieces(line);
  const fits = maxPacks(pack, r.room);
  const max = Math.max(1, Math.min(packCap(pack), fits));
  // stock is shown to Pro accounts only
  const band = r.problem === "gone" || !book.showStock ? null : stockBand({ stock: r.stock }, book, lang);
  const productHref = product ? href(lang, `/product/${product.slug}`) : null;
  const marked = flagged || Boolean(r.problem);
  const message =
    r.problem === "gone" ? c.gone
    : r.problem === "variant" ? c.chooseOption
    : r.problem === "pack" ? c.packGone
    : r.problem === "out" ? c.out
    : r.problem === "over" ? c.over(num(r.stock, lang))
    : r.problem === "noPrice" ? c.noPriceNote
    : null;

  return (
    <li className={`relative grid grid-cols-[4.5rem_minmax(0,1fr)] gap-4 border-b border-line py-5 sm:grid-cols-[6rem_minmax(0,1fr)] sm:gap-6 ${marked ? "before:absolute before:inset-y-0 before:-start-2 before:w-px before:bg-danger sm:before:-start-4" : ""}`}>
      {productHref ? (
        <Link href={productHref} tabIndex={-1} aria-hidden>
          <Picture media={media} lang={lang} ratio="4/5" sizes="96px" alt="" />
        </Link>
      ) : (
        <Picture media={null} ratio="4/5" />
      )}
      <div className="min-w-0">
        <div className="pe-11">
          {productHref ? (
            <Link href={productHref} className="text-sm leading-6 text-ink hover:text-gold-text">
              {name}
            </Link>
          ) : (
            <p className="text-sm leading-6 text-muted">{name}</p>
          )}
          {option && (
            <p className="mt-0.5 flex items-center gap-2 text-xs text-ink-2">
              {variant?.swatch && <Swatch swatch={variant.swatch} />}
              {option}
            </p>
          )}
          {pack > 1 && <p className="mt-0.5 text-xs text-ink-2 tabular-nums">{commonCopy(lang).pack.line(num(line.qty, lang), num(pack, lang), num(pieces, lang))}</p>}
          {r.problem !== "gone" && (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              <span>
                {c.unit}:{" "}
                {stepped && (
                  <span className="text-faint line-through decoration-gold/70 tabular-nums">
                    <span className="sr-only">{was.was} </span>
                    {formatPrice(list, lang)}
                  </span>
                )}{" "}
                <span className="text-ink-2 tabular-nums">
                  {stepped && <span className="sr-only">{was.now} </span>}
                  {now === null ? c.noPrice : formatPrice(now, lang)}
                </span>
              </span>
              {band && r.problem !== "variant" && (
                <span className="inline-flex items-center gap-1.5">
                  <span className={`size-1.5 rounded-full ${DOT[band.tone]}`} aria-hidden />
                  {band.text}
                </span>
              )}
            </p>
          )}
          {message && (
            <p className="mt-2 flex flex-wrap items-center gap-x-3 text-xs leading-6 text-danger">
              {message}
              {r.problem === "over" && fits > 0 && (
                <button type="button" onClick={() => cart.setQty(line.productId, line.variantId, fits, pack)} className="min-h-8 text-gold-text underline underline-offset-4">
                  {pack > 1 ? c.fixPacks(num(fits, lang)) : c.fixQty(num(fits, lang))}
                </button>
              )}
              {(r.problem === "variant" || r.problem === "pack") && productHref && (
                <Link href={productHref} className="min-h-8 text-gold-text underline underline-offset-4">
                  {r.problem === "pack" ? c.choosePack : c.chooseLink}
                </Link>
              )}
            </p>
          )}
        </div>
        {r.problem !== "gone" && (
          <div className="mt-4 flex items-center justify-between gap-4">
            <span className="inline-flex h-11 items-center border border-control bg-white">
              <button
                type="button"
                onClick={() => cart.setQty(line.productId, line.variantId, line.qty - 1, pack)}
                disabled={line.qty <= 1}
                aria-label={c.decrease}
                className="grid size-11 place-items-center text-ink-2 hover:text-ink disabled:text-faint"
              >
                <Icon name="minus" className="size-4" />
              </button>
              <input
                aria-label={pack > 1 ? c.packsQty : commonCopy(lang).cart.qty}
                inputMode="numeric"
                value={num(line.qty, lang)}
                onChange={(e) => {
                  const n = Number(latinDigits(e.target.value).replace(/\D/g, ""));
                  if (n >= 1) cart.setQty(line.productId, line.variantId, Math.min(n, r.stock > 0 ? max : packCap(pack)), pack);
                }}
                className="h-full w-10 border-x border-line bg-transparent text-center text-sm tabular-nums outline-none focus:bg-gold-mist/40"
              />
              <button
                type="button"
                onClick={() => cart.setQty(line.productId, line.variantId, line.qty + 1, pack)}
                disabled={line.qty >= max}
                aria-label={c.increase}
                className="grid size-11 place-items-center text-ink-2 hover:text-ink disabled:text-faint"
              >
                <Icon name="plus" className="size-4" />
              </button>
            </span>
            <span className="text-end text-sm tabular-nums">
              {stepped && list !== null && <span className="block text-xs text-faint line-through decoration-gold/70">{formatPrice(list * pieces, lang)}</span>}
              <span className="text-ink">{now === null ? "" : formatPrice(now * pieces, lang)}</span>
            </span>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => cart.remove(line.productId, line.variantId, pack)}
        aria-label={c.remove(name)}
        title={commonCopy(lang).cart.remove}
        className="absolute top-3 end-0 grid size-11 place-items-center text-muted hover:text-ink"
      >
        <Icon name="trash" className="size-[18px]" />
      </button>
    </li>
  );
}

function NotPro({ lang }: { lang: Lang }) {
  const c = accountCopy(lang).cart;
  return (
    <LuxFrame className="max-w-2xl bg-porcelain/85 px-6 py-8 sm:px-10 sm:py-10">
      <div className="flex items-center gap-4">
        <ProSeal size="md" />
        <p className="title-section">{c.notProTitle}</p>
      </div>
      <p className="mt-4 max-w-lg font-ui text-sm leading-7 text-ink-2">{c.notProText}</p>
      <ProSteps lang={lang} current={0} className="mt-7 max-w-md" />
      <div className="mt-8 flex flex-col gap-x-6 gap-y-3 sm:flex-row sm:items-center">
        <Link href={`${href(lang, "/pro")}#request`} className={`${btn.metal} btn-lg`}>
          {c.notProCta}
        </Link>
        <ProCodeLink lang={lang} className={`${btn.text} max-sm:mx-auto`}>
          {c.haveCode}
        </ProCodeLink>
      </div>
    </LuxFrame>
  );
}

export { NotPro };
