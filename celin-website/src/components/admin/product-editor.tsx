"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { adminDeleteProduct, adminDuplicateProduct, adminSaveProduct } from "@/app/actions/admin-catalog";
import type { AdminProduct, AdminVariant } from "@/lib/admin-catalog";
import { METALS, STONES, type Badge as BadgeT, type Metal, type ProductStatus, type Spec, type Stone } from "@/lib/catalog-types";
import type { Media } from "@/lib/media";
import { num } from "@/lib/format";
import { Button, Card, ConfirmButton, Dialog, Field, Input, MoneyInput, PageHeader, Select, Textarea, Toggle } from "@/components/admin/ui";
import { toast, useAction } from "@/components/admin/toast";
import { BADGE_LABEL, METAL_LABEL, SLUG_RE, slugify, STATUS_LABEL, STONE_LABEL } from "@/components/admin/catalog-labels";
import { CountInput } from "@/components/admin/count-input";
import { ProductImages } from "@/components/admin/product-images";
import { isHex, Swatch, SWATCH_PRESETS, swatchLabel } from "@/components/admin/swatch";
import { Icon, type IconName } from "@/components/ui/icons";
import { Picture } from "@/components/ui/picture";

/**
 * Create / edit one product: texts, facets, price and stock, pictures, specifications and options.
 * Everything is kept in one local form and sent at once with adminSaveProduct (shape = parseProduct input).
 * The page remounts this component after a save (key = updated_at), so new option ids come back from the
 * database before the next save.
 */

type SpecRow = Spec & { k: number };
type VariantRow = Omit<AdminVariant, "sort"> & { k: number };

interface Form {
  name_fa: string;
  name_en: string;
  subtitle_fa: string;
  subtitle_en: string;
  description_fa: string;
  description_en: string;
  slug: string;
  sku: string;
  category_id: string;
  collection_id: string;
  metal: Metal;
  stone: Stone;
  badge: BadgeT;
  featured: boolean;
  sort: number;
  price: number | null;
  stock: number;
  status: ProductStatus;
  images: string[];
  specs: SpecRow[];
  variants: VariantRow[];
}

type Errors = Partial<Record<"name_fa" | "slug" | `variant${number}`, string>>;

// row keys: stored rows use their index (same on server and client), rows added in the browser count from here
let K = 100_000;
const nk = () => ++K;

function initial(p: AdminProduct | null): Form {
  return {
    name_fa: p?.name_fa ?? "",
    name_en: p?.name_en ?? "",
    subtitle_fa: p?.subtitle_fa ?? "",
    subtitle_en: p?.subtitle_en ?? "",
    description_fa: p?.description_fa ?? "",
    description_en: p?.description_en ?? "",
    slug: p?.slug ?? "",
    sku: p?.sku ?? "",
    category_id: p?.category_id ?? "",
    collection_id: p?.collection_id ?? "",
    metal: p?.metal ?? "",
    stone: p?.stone ?? "",
    badge: p?.badge ?? "",
    featured: p?.featured ?? false,
    sort: p?.sort ?? 0,
    price: p?.price ?? null,
    stock: p?.stock ?? 0,
    status: p?.status ?? "draft",
    images: p?.images ?? [],
    specs: (p?.specs ?? []).map((s, i) => ({ ...s, k: i + 1 })),
    variants: (p?.variants ?? []).map(({ sort: _, ...v }, i) => ({ ...v, k: i + 1 })),
  };
}

function payload(f: Form, id?: string) {
  return {
    ...(id ? { id } : {}),
    name_fa: f.name_fa,
    name_en: f.name_en,
    subtitle_fa: f.subtitle_fa,
    subtitle_en: f.subtitle_en,
    description_fa: f.description_fa,
    description_en: f.description_en,
    slug: f.slug.trim().toLowerCase(),
    sku: f.sku,
    category_id: f.category_id || null,
    collection_id: f.collection_id || null,
    metal: f.metal,
    stone: f.stone,
    badge: f.badge,
    featured: f.featured,
    sort: f.sort,
    price: f.price,
    stock: f.stock,
    status: f.status,
    images: f.images,
    specs: f.specs.map(({ k: _, ...s }) => s),
    variants: f.variants.map(({ k: _, ...v }) => v),
  };
}

const SPEC_PRESETS: { fa: string; en: string }[] = [
  { fa: "آبکاری", en: "Plating" },
  { fa: "نگین", en: "Stones" },
  { fa: "پرداخت", en: "Finish" },
  { fa: "ابعاد", en: "Dimensions" },
  { fa: "وزن", en: "Weight" },
  { fa: "شامل", en: "Includes" },
];

const move = <T,>(xs: T[], from: number, to: number): T[] => {
  if (to < 0 || to >= xs.length || from === to) return xs;
  const next = [...xs];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
};

export function ProductEditor({
  product,
  media: initialMedia,
  categories,
  collections,
}: {
  product: AdminProduct | null;
  media: Record<string, Media>;
  categories: { id: string; name_fa: string }[];
  collections: { id: string; name_fa: string }[];
}) {
  const router = useRouter();
  const [f, setF] = useState<Form>(() => initial(product));
  const [media, setMedia] = useState<Record<string, Media>>(initialMedia);
  const [slugTouched, setSlugTouched] = useState(Boolean(product));
  const [errors, setErrors] = useState<Errors>({});
  const [baseline, setBaseline] = useState(() => JSON.stringify(payload(initial(product))));
  const save = useAction();
  const del = useAction();
  const dup = useAction();
  const leaving = useRef(false);

  const snap = useMemo(() => JSON.stringify(payload(f)), [f]);
  const dirty = snap !== baseline;

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setF((x) => ({ ...x, [key]: value }));
  const setImages = (fn: (prev: string[]) => string[]) =>
    setF((x) => {
      const images = fn(x.images);
      // an option can only show one of the product's own pictures
      const variants = x.variants.map((v) => (v.image_id && !images.includes(v.image_id) ? { ...v, image_id: null } : v));
      return { ...x, images, variants };
    });
  const putMedia = (m: Media) => m.id && setMedia((x) => ({ ...x, [m.id!]: m }));

  // unsaved changes: warn before closing the tab or following a link
  useEffect(() => {
    if (!dirty) return;
    const before = (e: BeforeUnloadEvent) => {
      if (leaving.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    const click = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname === location.pathname) return;
      if (!window.confirm("تغییرات این محصول ذخیره نشده‌اند. بدون ذخیره از این صفحه بیرون می‌روید؟")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", before);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", before);
      document.removeEventListener("click", click, true);
    };
  }, [dirty]);

  const check = (x: Form): Errors => {
    const e: Errors = {};
    if (x.name_fa.trim().length < 2) e.name_fa = "نام فارسی محصول را بنویسید.";
    const slug = x.slug.trim().toLowerCase() || slugify(x.name_en);
    if (!slug) e.slug = "نشانی را بنویسید (یا نام انگلیسی را پر کنید)؛ مثلاً darya-ring.";
    else if (!SLUG_RE.test(slug)) e.slug = "فقط حروف کوچک انگلیسی، عدد و خط تیره؛ مثلاً darya-ring.";
    x.variants.forEach((v, i) => {
      if (!v.name_fa.trim()) e[`variant${i}`] = `نام فارسی گزینه‌ی ${num(i + 1, "fa")} را بنویسید (مثلاً «طلایی»).`;
    });
    return e;
  };
  const validate = (): boolean => {
    const e = check(f);
    setErrors(e);
    const first = Object.values(e)[0];
    if (first) toast(false, first);
    return !first;
  };
  // once shown, error messages follow the form (a fixed field loses its message at once)
  const shownErrors = Object.keys(errors).length;
  useEffect(() => {
    if (shownErrors) setErrors(check(f));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f]);

  const onSave = () => {
    if (!validate()) return;
    const body = payload(f, product?.id);
    save.run(() => adminSaveProduct(body), {
      onOk: (r) => {
        setBaseline(JSON.stringify(payload(f)));
        if (!product) {
          leaving.current = true;
          router.replace(`/admin/products/${r.id}`);
        }
      },
    });
  };

  const live = product?.status === "published" && !dirty;
  const hasVariants = f.variants.length > 0;
  const imageList = f.images.map((id) => media[id]).filter((m): m is Media => Boolean(m));

  return (
    <div>
      <PageHeader
        title={product ? product.name_fa || "محصول" : "محصول تازه"}
        back={{ href: "/admin/products", label: "محصولات" }}
        actions={
          product && (
            <>
              <Button
                variant="secondary"
                icon="copy"
                pending={dup.pending}
                onClick={() => {
                  if (dirty) return toast(false, "اول تغییرات را ذخیره کنید؛ نسخه‌ی ذخیره‌شده کپی می‌شود.");
                  dup.run(() => adminDuplicateProduct({ id: product.id }), { onOk: (r) => router.push(`/admin/products/${r.id}`) });
                }}
              >
                نسخه‌ی کپی
              </Button>
              <ConfirmButton
                size="md"
                pending={del.pending}
                confirmLabel="حذف شود؟ دوباره بزنید"
                onConfirm={() =>
                  del.run(() => adminDeleteProduct({ id: product.id }), {
                    onOk: () => {
                      leaving.current = true;
                      setBaseline(snap);
                      router.replace("/admin/products");
                    },
                  })
                }
              >
                حذف
              </ConfirmButton>
            </>
          )
        }
      />

      {/* sticky save bar */}
      <div className="sticky top-16 z-20 -mx-4 mb-6 border-b border-line bg-ground/95 px-4 py-3 backdrop-blur-sm sm:-mx-8 sm:px-8 lg:top-0 lg:-mx-10 lg:px-10">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <span className={`flex min-w-0 flex-1 items-center gap-2 text-xs ${dirty ? "text-warning" : "text-muted"}`}>
            <span className={`size-1.5 shrink-0 rounded-full ${dirty ? "bg-warning" : "bg-success"}`} />
            <span className="truncate">
              {dirty ? (
                <>
                  <span className="sm:hidden">ذخیره نشده</span>
                  <span className="hidden sm:inline">تغییرات ذخیره نشده</span>
                </>
              ) : product ? (
                "ذخیره شده"
              ) : (
                "هنوز ذخیره نشده"
              )}
            </span>
          </span>
          <label className="flex items-center gap-2 text-xs text-muted">
            <span className="hidden sm:inline">وضعیت</span>
            <Select value={f.status} onChange={(e) => set("status", e.target.value as ProductStatus)} className="w-auto min-w-28" aria-label="وضعیت انتشار">
              {(Object.keys(STATUS_LABEL) as ProductStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </label>
          {product && (
            <a
              href={live ? `/product/${product.slug}` : undefined}
              target="_blank"
              rel="noreferrer"
              aria-disabled={!live}
              title={live ? "مشاهده در سایت" : "پس از انتشار و ذخیره در سایت دیده می‌شود"}
              className={`inline-flex h-10 items-center gap-2 rounded-sm border px-3 text-sm ${live ? "border-line-strong bg-white text-ink hover:border-ink" : "pointer-events-none border-line text-faint"}`}
            >
              <Icon name="external" className="size-4" />
              <span className="hidden sm:inline">مشاهده در سایت</span>
            </a>
          )}
          <Button onClick={onSave} pending={save.pending} icon="check" disabled={product ? !dirty : false}>
            {product ? "ذخیره" : "ساختن محصول"}
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        <InfoCard f={f} set={set} errors={errors} slugTouched={slugTouched} setSlugTouched={setSlugTouched} categories={categories} collections={collections} />
        <PriceCard f={f} set={set} hasVariants={hasVariants} />
        <ProductImages images={f.images} media={media} setImages={setImages} onMedia={putMedia} alt={{ fa: f.name_fa, en: f.name_en }} />
        <SpecsCard specs={f.specs} setSpecs={(fn) => setF((x) => ({ ...x, specs: fn(x.specs) }))} />
        <VariantsCard variants={f.variants} setVariants={(fn) => setF((x) => ({ ...x, variants: fn(x.variants) }))} images={imageList} errors={errors} productPrice={f.price} />
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-end gap-3 border-t border-line pt-5">
        {dirty && <span className="text-xs text-warning">تغییرات ذخیره نشده</span>}
        <Button onClick={onSave} pending={save.pending} icon="check" disabled={product ? !dirty : false} size="lg">
          {product ? "ذخیره‌ی محصول" : "ساختن محصول"}
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ info

function InfoCard({
  f,
  set,
  errors,
  slugTouched,
  setSlugTouched,
  categories,
  collections,
}: {
  f: Form;
  set: <K extends keyof Form>(key: K, value: Form[K]) => void;
  errors: Errors;
  slugTouched: boolean;
  setSlugTouched: (v: boolean) => void;
  categories: { id: string; name_fa: string }[];
  collections: { id: string; name_fa: string }[];
}) {
  return (
    <Card title="اطلاعات">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="نام فارسی *" error={errors.name_fa}>
          <Input value={f.name_fa} onChange={(e) => set("name_fa", e.target.value)} maxLength={160} placeholder="مثلاً انگشتر دریا" name="name_fa" />
        </Field>
        <Field label="نام انگلیسی">
          <Input
            value={f.name_en}
            dir="ltr"
            maxLength={160}
            placeholder="e.g. Darya ring"
            name="name_en"
            onChange={(e) => {
              set("name_en", e.target.value);
              if (!slugTouched) set("slug", slugify(e.target.value));
            }}
          />
        </Field>
        <Field label="زیرعنوان فارسی" hint="یک عبارت کوتاه زیر نام">
          <Input value={f.subtitle_fa} onChange={(e) => set("subtitle_fa", e.target.value)} maxLength={200} />
        </Field>
        <Field label="زیرعنوان انگلیسی">
          <Input value={f.subtitle_en} onChange={(e) => set("subtitle_en", e.target.value)} maxLength={200} dir="ltr" />
        </Field>
        <Field label="توضیح فارسی">
          <Textarea value={f.description_fa} onChange={(e) => set("description_fa", e.target.value)} rows={5} maxLength={6000} />
        </Field>
        <Field label="توضیح انگلیسی">
          <Textarea value={f.description_en} onChange={(e) => set("description_en", e.target.value)} rows={5} maxLength={6000} dir="ltr" />
        </Field>
        <Field label="نشانی در سایت (slug)" error={errors.slug} hint={slugTouched ? "فقط حروف کوچک انگلیسی، عدد و خط تیره" : "خودکار از نام انگلیسی ساخته می‌شود"}>
          <span dir="ltr" className="flex">
            <span className="flex h-10 items-center rounded-s-sm border border-e-0 border-line-strong bg-bone px-2.5 text-xs text-muted">/product/</span>
            <Input
              value={f.slug}
              name="slug"
              maxLength={80}
              placeholder="darya-ring"
              className="rounded-s-none"
              onChange={(e) => {
                setSlugTouched(true);
                set("slug", e.target.value.toLowerCase().replace(/\s+/g, "-"));
              }}
            />
          </span>
        </Field>
        <Field label="کد محصول (SKU)">
          <Input value={f.sku} onChange={(e) => set("sku", e.target.value)} maxLength={60} dir="ltr" placeholder="CL-R-101" />
        </Field>
      </div>

      <div className="mt-6 grid gap-4 border-t border-line pt-5 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="دسته">
          <Select value={f.category_id} onChange={(e) => set("category_id", e.target.value)} name="category_id">
            <option value="">بدون دسته</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name_fa}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="مجموعه">
          <Select value={f.collection_id} onChange={(e) => set("collection_id", e.target.value)} name="collection_id">
            <option value="">بدون مجموعه</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name_fa}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="برچسب روی کارت">
          <Select value={f.badge} onChange={(e) => set("badge", e.target.value as BadgeT)}>
            <option value="">بدون برچسب</option>
            {(Object.keys(BADGE_LABEL) as Exclude<BadgeT, "">[]).map((b) => (
              <option key={b} value={b}>
                {BADGE_LABEL[b]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="رنگ آبکاری" hint="برای فیلتر فروشگاه">
          <Select value={f.metal} onChange={(e) => set("metal", e.target.value as Metal)}>
            <option value="">—</option>
            {METALS.map((m) => (
              <option key={m} value={m}>
                {METAL_LABEL[m]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="رنگ نگین" hint="برای فیلتر فروشگاه">
          <Select value={f.stone} onChange={(e) => set("stone", e.target.value as Stone)}>
            <option value="">—</option>
            {STONES.map((s) => (
              <option key={s} value={s}>
                {STONE_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="ترتیب" hint="عدد کوچک‌تر، جلوتر در فهرست">
          <CountInput value={f.sort} onChange={(v) => set("sort", v)} signed />
        </Field>
      </div>
      <div className="mt-4">
        <Toggle checked={f.featured} onChange={(v) => set("featured", v)} label="محصول منتخب" hint="در بخش منتخب‌های صفحه‌ی اصلی نمایش داده می‌شود." />
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ price & stock

function PriceCard({ f, set, hasVariants }: { f: Form; set: <K extends keyof Form>(key: K, value: Form[K]) => void; hasVariants: boolean }) {
  return (
    <Card title="قیمت و موجودی" sub="قیمت و موجودی فقط به اعضای Pro نشان داده می‌شود.">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="قیمت (تومان)" hint={f.price === null ? "خالی است؛ اعضا «استعلام قیمت» می‌بینند." : hasVariants ? "قیمت گزینه‌هایی که قیمت جدا ندارند." : undefined}>
          <MoneyInput value={f.price} onChange={(v) => set("price", v)} name="price" />
        </Field>
        {hasVariants ? (
          <div>
            <span className="mb-1.5 block text-xs font-medium text-ink-2">موجودی</span>
            <div className="flex min-h-10 items-center gap-2 border border-line bg-bone px-3 py-2 text-xs leading-5 text-muted">
              <Icon name="info" className="size-4 shrink-0" />
              این محصول گزینه دارد؛ موجودی هر گزینه جداگانه در بخش «گزینه‌ها» ثبت می‌شود.
            </div>
          </div>
        ) : (
          <Field label="موجودی" hint={f.stock === 0 ? "صفر = ناموجود" : undefined}>
            <CountInput value={f.stock} onChange={(v) => set("stock", Math.max(0, v))} name="stock" />
          </Field>
        )}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ specs

function SpecsCard({ specs, setSpecs }: { specs: SpecRow[]; setSpecs: (fn: (xs: SpecRow[]) => SpecRow[]) => void }) {
  const patch = (k: number, p: Partial<Spec>) => setSpecs((xs) => xs.map((s) => (s.k === k ? { ...s, ...p } : s)));
  const add = (preset?: { fa: string; en: string }) => {
    const k = nk();
    setSpecs((xs) => [...xs, { k, label_fa: preset?.fa ?? "", label_en: preset?.en ?? "", value_fa: "", value_en: "" }]);
    // focus the new row's first empty field
    setTimeout(() => document.querySelector<HTMLInputElement>(`[data-spec="${k}"] input[data-first]`)?.focus(), 30);
  };
  return (
    <Card title="مشخصات" sub="ردیف‌هایی مثل آبکاری، نگین و ابعاد که در صفحه‌ی محصول نمایش داده می‌شوند. ردیف بدون مقدار ذخیره نمی‌شود.">
      {specs.length > 0 && (
        <ol className="mb-4 space-y-3">
          {specs.map((s, i) => (
            <li key={s.k} data-spec={s.k} className="border border-line">
              <div className="flex items-center gap-2 border-b border-line bg-ground px-3 py-1.5">
                <span className="flex-1 text-xs text-muted">ردیف {num(i + 1, "fa")}</span>
                <RowButtons i={i} n={specs.length} onMove={(to) => setSpecs((xs) => move(xs, i, to))} onRemove={() => setSpecs((xs) => xs.filter((x) => x.k !== s.k))} label="ردیف" />
              </div>
              <div className="grid gap-3 p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                <Field label="عنوان (فارسی)">
                  <Input value={s.label_fa} onChange={(e) => patch(s.k, { label_fa: e.target.value })} maxLength={60} placeholder="مثلاً آبکاری" {...(s.label_fa ? {} : { "data-first": "" })} />
                </Field>
                <Field label="مقدار (فارسی)">
                  <Input value={s.value_fa} onChange={(e) => patch(s.k, { value_fa: e.target.value })} maxLength={300} placeholder="مثلاً رادیوم طلایی" {...(s.label_fa ? { "data-first": "" } : {})} />
                </Field>
                <Field label="عنوان (انگلیسی)">
                  <Input value={s.label_en} onChange={(e) => patch(s.k, { label_en: e.target.value })} maxLength={60} dir="ltr" placeholder="Plating" />
                </Field>
                <Field label="مقدار (انگلیسی)">
                  <Input value={s.value_en} onChange={(e) => patch(s.k, { value_en: e.target.value })} maxLength={300} dir="ltr" placeholder="Gold-tone rhodium" />
                </Field>
              </div>
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" icon="plus" onClick={() => add()}>
          ردیف تازه
        </Button>
        <span className="mx-1 text-xs text-muted">افزودن سریع:</span>
        {SPEC_PRESETS.map((p) => (
          <Button key={p.fa} variant="ghost" size="sm" className="h-10 border-line! sm:h-8" onClick={() => add(p)}>
            + {p.fa}
          </Button>
        ))}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ variants

function VariantsCard({
  variants,
  setVariants,
  images,
  errors,
  productPrice,
}: {
  variants: VariantRow[];
  setVariants: (fn: (xs: VariantRow[]) => VariantRow[]) => void;
  images: Media[];
  errors: Errors;
  productPrice: number | null;
}) {
  const [imageFor, setImageFor] = useState<number | null>(null);
  const patch = (k: number, p: Partial<VariantRow>) => setVariants((xs) => xs.map((v) => (v.k === k ? { ...v, ...p } : v)));
  const add = (preset?: { key: string; fa: string; en: string }) =>
    setVariants((xs) => [...xs, { k: nk(), id: null, name_fa: preset?.fa ?? "", name_en: preset?.en ?? "", swatch: preset?.key ?? "", sku: "", price: null, stock: 0, image_id: null }]);
  const target = variants.find((v) => v.k === imageFor);

  return (
    <Card title="گزینه‌ها (رنگ / مدل)" sub="وقتی محصول گزینه دارد، مشتری برای سفارش باید یکی را انتخاب کند و موجودی هر گزینه جدا حساب می‌شود.">
      {variants.length > 0 && (
        <ol className="mb-4 space-y-3">
          {variants.map((v, i) => {
            const img = v.image_id ? images.find((m) => m.id === v.image_id) : undefined;
            const err = errors[`variant${i}`];
            return (
              <li key={v.k} data-variant={i} className={`border ${err ? "border-danger/50" : "border-line"}`}>
                <div className="flex items-center gap-2.5 border-b border-line bg-ground px-3 py-1.5">
                  <span className="text-xs text-muted">{num(i + 1, "fa")}</span>
                  <Swatch value={v.swatch} className="size-4" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{v.name_fa || <span className="font-normal text-faint">گزینه‌ی تازه</span>}</span>
                  <RowButtons i={i} n={variants.length} onMove={(to) => setVariants((xs) => move(xs, i, to))} onRemove={() => setVariants((xs) => xs.filter((x) => x.k !== v.k))} label="گزینه" />
                </div>
                <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="نام فارسی *" error={err}>
                    <Input value={v.name_fa} onChange={(e) => patch(v.k, { name_fa: e.target.value })} maxLength={80} placeholder="مثلاً طلایی" name={`variant_name_${i}`} />
                  </Field>
                  <Field label="نام انگلیسی">
                    <Input value={v.name_en} onChange={(e) => patch(v.k, { name_en: e.target.value })} maxLength={80} dir="ltr" placeholder="Gold tone" />
                  </Field>
                  <Field label="کد (SKU)">
                    <Input value={v.sku} onChange={(e) => patch(v.k, { sku: e.target.value })} maxLength={60} dir="ltr" />
                  </Field>
                  <Field label="موجودی">
                    <CountInput value={v.stock} onChange={(n) => patch(v.k, { stock: Math.max(0, n) })} name={`variant_stock_${i}`} />
                  </Field>
                  <div className="sm:col-span-2">
                    <span className="mb-1.5 block text-xs font-medium text-ink-2">
                      رنگ نشانگر <span className="font-normal text-muted">— {swatchLabel(v.swatch)}</span>
                    </span>
                    <SwatchPicker value={v.swatch} onChange={(s) => patch(v.k, { swatch: s })} />
                  </div>
                  <Field label="قیمت این گزینه" hint={v.price === null ? (productPrice === null ? "خالی = قیمت محصول (استعلام قیمت)" : "خالی = قیمت محصول") : undefined}>
                    <MoneyInput value={v.price} onChange={(n) => patch(v.k, { price: n })} placeholder="همان قیمت محصول" />
                  </Field>
                  <div>
                    <span className="mb-1.5 block text-xs font-medium text-ink-2">تصویر</span>
                    <button
                      type="button"
                      onClick={() => setImageFor(v.k)}
                      disabled={!images.length}
                      className="flex h-10 w-full items-center gap-2 rounded-sm border border-line-strong bg-white px-1.5 text-sm text-ink-2 transition-colors hover:border-ink disabled:cursor-not-allowed disabled:bg-bone disabled:text-faint"
                    >
                      {img ? <Picture media={img} ratio="3/4" sizes="40px" alt="" className="h-8 w-6 shrink-0" /> : <Icon name="image" className="mx-1 size-4 shrink-0 text-muted" />}
                      <span className="truncate">{img ? "تغییر تصویر" : images.length ? "انتخاب از تصاویر محصول" : "اول تصویر بیفزایید"}</span>
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" icon="plus" onClick={() => add()}>
          گزینه‌ی تازه
        </Button>
        <span className="mx-1 text-xs text-muted">افزودن سریع:</span>
        {SWATCH_PRESETS.slice(0, 3).map((p) => (
          <Button key={p.key} variant="ghost" size="sm" className="h-10 border-line! sm:h-8" onClick={() => add(p)}>
            <Swatch value={p.key} className="size-3.5" /> {p.fa}
          </Button>
        ))}
      </div>

      <Dialog open={Boolean(target)} onClose={() => setImageFor(null)} title={`تصویر گزینه‌ی ${target?.name_fa || "تازه"}`}>
        {target && (
          <div className="space-y-4">
            <p className="text-xs leading-6 text-muted">وقتی مشتری این گزینه را انتخاب کند، این تصویر نمایش داده می‌شود.</p>
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              <li>
                <button
                  type="button"
                  onClick={() => (patch(target.k, { image_id: null }), setImageFor(null))}
                  aria-pressed={!target.image_id}
                  className={`grid aspect-[3/4] w-full place-items-center border px-2 text-center text-xs text-muted ${!target.image_id ? "border-gold outline outline-1 outline-gold" : "border-line hover:border-ink"}`}
                >
                  بدون تصویر
                </button>
              </li>
              {images.map((m, j) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => (patch(target.k, { image_id: m.id ?? null }), setImageFor(null))}
                    aria-pressed={target.image_id === m.id}
                    aria-label={`تصویر ${num(j + 1, "fa")}`}
                    className={`block w-full border ${target.image_id === m.id ? "border-gold outline outline-1 outline-gold" : "border-line hover:border-ink"}`}
                  >
                    <Picture media={m} ratio="3/4" sizes="140px" alt="" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Dialog>
    </Card>
  );
}

function SwatchPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const custom = isHex(value);
  const opts = [{ key: "", fa: "بدون رنگ" }, ...SWATCH_PRESETS];
  return (
    <div role="radiogroup" aria-label="رنگ نشانگر" className="flex flex-wrap items-center sm:gap-1">
      {opts.map((o) => (
        <button
          key={o.key || "none"}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          aria-label={o.fa}
          title={o.fa}
          onClick={() => onChange(o.key)}
          className={`grid size-10 place-items-center rounded-full border transition-colors ${value === o.key ? "border-ink" : "border-transparent hover:border-line-strong"}`}
        >
          <Swatch value={o.key} className="size-6" />
        </button>
      ))}
      <label
        title="رنگ دلخواه"
        className={`relative grid size-10 cursor-pointer place-items-center rounded-full border transition-colors focus-within:outline focus-within:outline-1 focus-within:outline-gold ${custom ? "border-ink" : "border-transparent hover:border-line-strong"}`}
      >
        {/* the only raw colour of the admin: a free swatch colour chosen by the admin */}
        <input type="color" value={custom ? value : "#7a7a7a"} onChange={(e) => onChange(e.target.value.toLowerCase())} className="absolute inset-0 size-full cursor-pointer opacity-0" aria-label="رنگ دلخواه" />
        {custom ? <Swatch value={value} className="size-6" /> : <span className="grid size-6 place-items-center rounded-full border border-dashed border-line-strong text-muted"><Icon name="plus" className="size-3.5" /></span>}
      </label>
      {custom && <span className="ltr ms-1 font-mono text-xs text-muted">{value}</span>}
    </div>
  );
}

function RowButtons({ i, n, onMove, onRemove, label }: { i: number; n: number; onMove: (to: number) => void; onRemove: () => void; label: string }) {
  const btn = (icon: IconName, text: string, onClick: () => void, disabled = false, cls = "") => (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={text} title={text} className={`grid size-10 place-items-center text-muted transition-colors hover:text-ink disabled:text-line-strong sm:size-8 ${cls}`}>
      <Icon name={icon} className="size-4" />
    </button>
  );
  return (
    <span className="flex items-center">
      {btn("chevron-down", `${label} بالاتر`, () => onMove(i - 1), i === 0, "rotate-180")}
      {btn("chevron-down", `${label} پایین‌تر`, () => onMove(i + 1), i === n - 1)}
      {btn("trash", `حذف ${label}`, onRemove, false, "hover:text-danger!")}
    </span>
  );
}

