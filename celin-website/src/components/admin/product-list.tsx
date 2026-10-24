"use client";

import Link from "next/link";
import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { adminDeleteProduct, adminDuplicateProduct, adminImportStarter, adminQuickUpdate } from "@/app/actions/admin-catalog";
import type { AdminProductListItem } from "@/lib/admin-catalog";
import type { ProductStatus } from "@/lib/catalog-types";
import { formatPrice, num } from "@/lib/format";
import { Badge, Button, ConfirmButton, Empty, Input, LinkButton, MoneyInput, Select, Spinner } from "@/components/admin/ui";
import { useAction } from "@/components/admin/toast";
import { CountInput } from "@/components/admin/count-input";
import { LOW_STOCK, STATUS_LABEL, STATUS_TONE } from "@/components/admin/catalog-labels";
import { Icon, type IconName } from "@/components/ui/icons";
import { Picture } from "@/components/ui/picture";

type Taxa = { id: string; name_fa: string }[];

/** Admin → محصولات: filters, quick price / stock / publish edits and row actions. */
export function ProductList({
  items,
  categories,
  collections,
  initialized,
  starter,
}: {
  items: AdminProductListItem[];
  categories: Taxa;
  collections: Taxa;
  initialized: boolean;
  starter: { products: number; categories: number; collections: number };
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | ProductStatus>("");
  const [cat, setCat] = useState("");
  const [col, setCol] = useState("");
  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name_fa])), [categories]);
  const colName = useMemo(() => new Map(collections.map((c) => [c.id, c.name_fa])), [collections]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((p) => {
      if (status && p.status !== status) return false;
      if (cat && (cat === "none" ? p.category_id : p.category_id !== cat)) return false;
      if (col && (col === "none" ? p.collection_id : p.collection_id !== col)) return false;
      if (s && !`${p.name_fa} ${p.name_en} ${p.sku} ${p.slug}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [items, q, status, cat, col]);
  const filtered = Boolean(q || status || cat || col);
  const clear = () => (setQ(""), setStatus(""), setCat(""), setCol(""));

  return (
    <div className="space-y-5">
      {!initialized && <StarterBanner starter={starter} />}

      {items.length === 0 ? (
        initialized ? (
          <Empty title="هنوز محصولی ثبت نشده است" action={<LinkButton href="/admin/products/new" variant="primary" icon="plus">محصول تازه</LinkButton>}>
            اولین محصول را بسازید یا محصولات نمونه را دوباره وارد کنید.
          </Empty>
        ) : null
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,170px))]">
            <div className="relative">
              <Icon name="search" className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-faint" />
              <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجوی نام، کد یا نشانی" className="ps-9" aria-label="جستجو" />
            </div>
            <div className="grid grid-cols-3 gap-2 sm:contents">
              <Select value={status} onChange={(e) => setStatus(e.target.value as "" | ProductStatus)} aria-label="وضعیت">
                <option value="">وضعیت</option>
                {(Object.keys(STATUS_LABEL) as ProductStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
              <Select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="دسته">
                <option value="">دسته</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name_fa}
                  </option>
                ))}
                <option value="none">بدون دسته</option>
              </Select>
              <Select value={col} onChange={(e) => setCol(e.target.value)} aria-label="مجموعه">
                <option value="">مجموعه</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name_fa}
                  </option>
                ))}
                <option value="none">بدون مجموعه</option>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-muted">
            <span>{filtered ? `${num(shown.length, "fa")} از ${num(items.length, "fa")} محصول` : `${num(items.length, "fa")} محصول`}</span>
            {filtered && (
              <button type="button" onClick={clear} className="h-8 px-1 text-ink-2 underline-offset-4 hover:underline">
                پاک کردن فیلترها
              </button>
            )}
          </div>

          {shown.length === 0 ? (
            <Empty title="محصولی با این فیلترها پیدا نشد" action={<Button variant="secondary" onClick={clear}>پاک کردن فیلترها</Button>} />
          ) : (
            <div className="border border-line bg-white">
              <div className="hidden grid-cols-[48px_minmax(0,1fr)_132px_92px_164px_116px_184px] gap-x-4 border-b border-line bg-ground px-4 py-2.5 text-xs text-muted xl:grid">
                <span />
                <span>محصول</span>
                <span>دسته / مجموعه</span>
                <span>وضعیت</span>
                <span>قیمت</span>
                <span>موجودی</span>
                <span className="text-end">کارها</span>
              </div>
              <ul className="divide-y divide-line">
                {shown.map((p) => (
                  <ProductRow key={p.id} p={p} taxa={[p.category_id ? catName.get(p.category_id) : "", p.collection_id ? colName.get(p.collection_id) : ""]} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StarterBanner({ starter }: { starter: { products: number; categories: number; collections: number } }) {
  const { pending, run } = useAction();
  return (
    <div className="border border-gold/30 bg-gold-mist px-5 py-5 sm:px-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-base font-medium text-ink">
            <Icon name="info" className="size-5 shrink-0 text-gold" />
            سایت هنوز محصولات نمونه (از عکس‌های شما) را نشان می‌دهد
          </h2>
          <p className="mt-1.5 text-sm leading-7 text-ink-2">
            با ورود نمونه‌ها، {num(starter.products, "fa")} محصول، {num(starter.categories, "fa")} دسته و {num(starter.collections, "fa")} مجموعه‌ی نمونه در پایگاه داده کپی می‌شوند تا بتوانید آن‌ها را ویرایش یا حذف کنید.
            ساختن اولین محصول هم سایت را به پایگاه داده می‌برد؛ از آن پس فقط محصولات این فهرست در سایت دیده می‌شوند.
          </p>
        </div>
        <Button variant="gold" size="lg" icon="refresh" pending={pending} onClick={() => run(() => adminImportStarter())}>
          ورود محصولات نمونه برای ویرایش
        </Button>
      </div>
    </div>
  );
}

function ProductRow({ p, taxa }: { p: AdminProductListItem; taxa: (string | undefined)[] }) {
  const router = useRouter();
  const pub = useAction();
  const dup = useAction();
  const del = useAction();
  const [cat, col] = taxa;
  const published = p.status === "published";
  return (
    <li data-product={p.slug} className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 py-3 xl:grid-cols-[48px_minmax(0,1fr)_132px_92px_164px_116px_184px] xl:items-center xl:gap-x-4">
      <Link href={`/admin/products/${p.id}`} className="row-span-3 self-start xl:row-span-1 xl:self-center" tabIndex={-1} aria-hidden>
        <Picture media={p.cover} ratio="3/4" sizes="64px" alt="" className="w-16 border border-line xl:w-12" />
      </Link>
      <div className="min-w-0">
        <Link href={`/admin/products/${p.id}`} className="block truncate text-sm font-medium text-ink hover:text-gold-text">
          {p.name_fa}
        </Link>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted">
          {p.name_en && <span className="ltr truncate">{p.name_en}</span>}
          {p.sku && <span className="ltr font-mono text-[11px] text-faint">{p.sku}</span>}
        </div>
      </div>
      <div className="min-w-0 truncate text-xs text-ink-2">
        {cat || col ? (
          <>
            {cat || <span className="text-faint">بدون دسته</span>}
            {col && <span className="text-muted"> · {col}</span>}
          </>
        ) : (
          <span className="text-faint">بدون دسته و مجموعه</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 xl:contents">
        <div>
          <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
        </div>
        <PriceCell p={p} />
        <StockCell p={p} />
      </div>
      <div className="col-span-2 flex flex-wrap items-center gap-1 border-t border-line pt-2 xl:col-span-1 xl:justify-end xl:border-0 xl:pt-0">
        <IconLink href={`/admin/products/${p.id}`} icon="edit" label="ویرایش" className="xl:hidden" text />
        <IconButton
          icon={published ? "eye-off" : "eye"}
          label={published ? "برگشت به پیش‌نویس" : "انتشار در سایت"}
          text={published ? "لغو انتشار" : "انتشار"}
          pending={pub.pending}
          onClick={() => pub.run(() => adminQuickUpdate({ id: p.id, status: published ? "draft" : "published" }), { silent: false })}
        />
        {published && <IconLink href={`/product/${p.slug}`} icon="external" label="مشاهده در سایت" external />}
        <IconButton icon="copy" label="ساختن نسخه‌ی کپی" pending={dup.pending} onClick={() => dup.run(() => adminDuplicateProduct({ id: p.id }), { onOk: (r) => router.push(`/admin/products/${r.id}`) })} />
        <span className="ms-auto xl:ms-0">
          <ConfirmButton size="md" variant="ghost" pending={del.pending} confirmLabel="حذف شود؟" onConfirm={() => del.run(() => adminDeleteProduct({ id: p.id }))}>
            <span className="sr-only">حذف {p.name_fa}</span>
          </ConfirmButton>
        </span>
      </div>
    </li>
  );
}

function PriceCell({ p }: { p: AdminProductListItem }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState<number | null>(p.price);
  const { pending, run } = useAction();
  const save = () => run(() => adminQuickUpdate({ id: p.id, price: v }), { onOk: () => setEdit(false) });
  if (edit)
    return (
      <QuickEditor onSave={save} onCancel={() => setEdit(false)} pending={pending}>
        <MoneyInput value={v} onChange={setV} autoFocus aria-label="قیمت" placeholder="خالی = استعلام" />
      </QuickEditor>
    );
  const text = p.price === null ? <span className="text-muted">بدون قیمت</span> : <span>{formatPrice(p.price, "fa")}</span>;
  return (
    <div className="flex min-w-0 items-center gap-1 text-sm">
      {p.variants > 0 ? (
        <span title="قیمت پایه؛ گزینه‌ها در ویرایش محصول">{text}</span>
      ) : (
        <button
          type="button"
          onClick={() => (setV(p.price), setEdit(true))}
          className="group inline-flex min-h-10 items-center gap-1.5 text-start xl:min-h-8"
          aria-label={`ویرایش سریع قیمت ${p.name_fa}`}
        >
          {text}
          <Icon name="edit" className="size-3.5 shrink-0 text-faint group-hover:text-ink" />
        </button>
      )}
    </div>
  );
}

function StockCell({ p }: { p: AdminProductListItem }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(p.stock);
  const { pending, run } = useAction();
  // stock_loaded: the shown number, so an order placed meanwhile is not undone (saved as a change)
  const save = () => run(() => adminQuickUpdate({ id: p.id, stock: v, stock_loaded: p.stock }), { onOk: () => setEdit(false) });
  if (edit)
    return (
      <QuickEditor onSave={save} onCancel={() => setEdit(false)} pending={pending}>
        <CountInput value={v} onChange={(n) => setV(Math.max(0, n))} autoFocus aria-label="موجودی" />
      </QuickEditor>
    );
  const level = p.stock === 0 ? <Badge tone="danger">ناموجود</Badge> : p.stock <= LOW_STOCK ? <Badge tone="warning">رو به اتمام</Badge> : null;
  const label = <span className="whitespace-nowrap">{num(p.stock, "fa")} عدد</span>;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
      {p.variants > 0 ? (
        label
      ) : (
        <button type="button" onClick={() => (setV(p.stock), setEdit(true))} className="group inline-flex min-h-10 items-center gap-1.5 xl:min-h-8" aria-label={`ویرایش سریع موجودی ${p.name_fa}`}>
          {label}
          <Icon name="edit" className="size-3.5 shrink-0 text-faint group-hover:text-ink" />
        </button>
      )}
      {level}
      {p.variants > 0 && <span className="w-full text-[11px] text-muted">{num(p.variants, "fa")} گزینه</span>}
    </div>
  );
}

function QuickEditor({ children, onSave, onCancel, pending }: { children: ReactNode; onSave: () => void; onCancel: () => void; pending: boolean }) {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") (e.preventDefault(), onSave());
    if (e.key === "Escape") (e.preventDefault(), onCancel());
  };
  return (
    <div className="flex min-w-0 basis-full flex-wrap items-center gap-1.5 sm:basis-auto xl:flex-col xl:items-stretch" onKeyDown={onKey}>
      <div className="min-w-36 flex-1 sm:w-48 sm:flex-none xl:w-auto xl:min-w-0">{children}</div>
      <div className="flex gap-1">
        <button type="button" onClick={onSave} disabled={pending} aria-label="ذخیره" className="inline-flex h-10 min-w-10 shrink-0 items-center justify-center gap-1.5 rounded-sm bg-ink px-2.5 text-xs text-bone disabled:opacity-50 xl:h-8 xl:flex-1">
          {pending ? <Spinner /> : <Icon name="check" className="size-4" />}
          <span className="hidden xl:inline">ذخیره</span>
        </button>
        <button type="button" onClick={onCancel} className="grid size-10 shrink-0 place-items-center rounded-sm border border-line text-muted hover:text-ink xl:size-8" aria-label="انصراف">
          <Icon name="close" className="size-4" />
        </button>
      </div>
    </div>
  );
}

const iconBtn = "inline-flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-sm border border-transparent px-2 text-xs text-ink-2 transition-colors hover:border-line hover:bg-bone hover:text-ink disabled:opacity-50";

function IconButton({ icon, label, onClick, pending, text }: { icon: IconName; label: string; onClick: () => void; pending?: boolean; text?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={pending} title={label} aria-label={label} className={iconBtn}>
      {pending ? <Spinner /> : <Icon name={icon} className="size-4" />}
      {text && <span className="xl:hidden">{text}</span>}
    </button>
  );
}

function IconLink({ href, icon, label, external, className = "", text }: { href: string; icon: IconName; label: string; external?: boolean; className?: string; text?: boolean }) {
  const inner = (
    <>
      <Icon name={icon} className="size-4" />
      {text && <span>{label}</span>}
    </>
  );
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" title={label} aria-label={label} className={`${iconBtn} ${className}`}>
      {inner}
    </a>
  ) : (
    <Link href={href} title={label} aria-label={label} className={`${iconBtn} ${className}`}>
      {inner}
    </Link>
  );
}
