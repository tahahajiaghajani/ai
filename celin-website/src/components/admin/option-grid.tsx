"use client";

import Link from "next/link";
import { useState } from "react";
import type { AdminVariant } from "@/lib/admin-catalog";
import { num } from "@/lib/format";
import type { Media } from "@/lib/media";
import { AXIS_FA, comboSku, combos, MAX_VARIANTS, OPTION_AXES, optionLabel, optionsKey, valueOf, type OptionAxis, type OptionPalette, type VariantOptions } from "@/lib/options";
import { Button, Card, Dialog, Input, MoneyInput, Select } from "@/components/admin/ui";
import { CountInput } from "@/components/admin/count-input";
import { Swatch } from "@/components/admin/swatch";
import { Icon } from "@/components/ui/icons";
import { Picture } from "@/components/ui/picture";

/**
 * «گزینه‌ها» of a product chosen by colour (src/lib/options.ts): the plating, stone and leather colours it is made in
 * (from Settings → «رنگ‌های گزینه‌ها», always in that order), and a grid with one row per combination — offered or
 * not, stock, its own price (empty = the product's), SKU and picture — with bulk fill for all rows or one colour.
 */

/**
 * A row of the editor: a stored or new option; `off` = a combination of the grid that is not made (not saved);
 * `orig` = the combination a stored option was opened with (syncCombos reuses it only for that combination).
 */
export type VariantRow = Omit<AdminVariant, "sort"> & { k: number; off?: boolean; orig?: VariantOptions };
export type Axes = Record<OptionAxis, string[]>;

export const NO_AXES: Axes = { plating: [], stone: [], leather: [] };

/** The grid: each combination of the chosen colours with its row (rows are kept by syncCombos, so one always exists). */
export function gridOf(axes: Axes, rows: VariantRow[], palette: OptionPalette): { o: VariantOptions; row: VariantRow | undefined }[] {
  const byKey = new Map(rows.map((r) => [optionsKey(r.options), r]));
  return combos(axes, palette).map((o) => ({ o, row: byKey.get(optionsKey(o)) }));
}

type Target = "all" | `${OptionAxis}:${string}`;

export function OptionsCard({
  palette,
  axes,
  setAxis,
  rows,
  patchRows,
  images,
  productPrice,
  productSku,
  removed,
}: {
  palette: OptionPalette;
  axes: Axes;
  setAxis: (axis: OptionAxis, keys: string[]) => void;
  rows: VariantRow[];
  /** changes the rows `pick` chooses */
  patchRows: (pick: (r: VariantRow) => boolean, p: Partial<VariantRow>) => void;
  images: Media[];
  productPrice: number | null;
  productSku: string;
  /** stored combinations that saving would delete, with stock still on them */
  removed: { name: string; stock: number }[];
}) {
  const grid = gridOf(axes, rows, palette);
  const count = grid.length;
  const on = grid.filter((g) => g.row && !g.row.off);
  const [imageFor, setImageFor] = useState<{ title: string; pick: (r: VariantRow) => boolean; current: string | null } | null>(null);
  const [target, setTarget] = useState<Target>("all");
  const [bulkStock, setBulkStock] = useState(0);
  const [bulkPrice, setBulkPrice] = useState<number | null>(null);

  const inTarget = (r: VariantRow) => {
    if (target === "all") return true;
    const [axis, key] = target.split(":") as [OptionAxis, string];
    return r.options[axis] === key;
  };
  const onKeys = new Set(on.map((g) => optionsKey(g.o)));
  const bulkPick = (r: VariantRow) => onKeys.has(optionsKey(r.options)) && inTarget(r);
  const targets = OPTION_AXES.flatMap((axis) => axes[axis].map((key) => ({ v: `${axis}:${key}` as Target, label: `${AXIS_FA[axis]}: ${valueOf(palette, axis, key)?.fa ?? key}` })));
  const targetLabel = target === "all" ? "همه‌ی ترکیب‌ها" : (targets.find((t) => t.v === target)?.label ?? "");

  return (
    <Card
      title="گزینه‌ها"
      sub="رنگ‌هایی که این قطعه در آن‌ها ساخته می‌شود؛ مشتری از هر ردیف یکی را انتخاب می‌کند و هر ترکیب موجودی، قیمت، کد و تصویر خودش را دارد."
      actions={
        <Link href="/admin/settings#options" className="inline-flex h-8 items-center gap-1.5 text-xs text-gold-text underline-offset-4 hover:underline">
          <Icon name="edit" className="size-3.5" />
          فهرست رنگ‌ها
        </Link>
      }
    >
      <div className="space-y-4">
        {OPTION_AXES.map((axis) => (
          <fieldset key={axis}>
            <legend className="mb-1.5 text-xs font-medium text-ink-2">{AXIS_FA[axis]}</legend>
            <div className="flex flex-wrap gap-2">
              {palette[axis].map((v) => {
                const chosen = axes[axis].includes(v.key);
                return (
                  <label
                    key={v.key}
                    className="relative inline-flex h-10 cursor-pointer items-center gap-2 rounded-sm border border-line-strong bg-white px-3 text-sm text-ink-2 transition-colors hover:border-ink has-[:checked]:border-ink has-[:checked]:text-ink has-[:checked]:shadow-[inset_0_0_0_1px_var(--color-ink)] has-[:focus-visible]:outline has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-gold"
                  >
                    <input type="checkbox" className="peer sr-only" checked={chosen} onChange={(e) => setAxis(axis, e.target.checked ? [...axes[axis], v.key] : axes[axis].filter((k) => k !== v.key))} />
                    <Swatch value={v.swatch} className="size-4" />
                    {v.fa}
                    <Icon name="check" className="hidden size-3.5 peer-checked:block" />
                  </label>
                );
              })}
              {!palette[axis].length && <span className="text-xs text-muted">این فهرست خالی است.</span>}
            </div>
          </fieldset>
        ))}
      </div>

      {count === 0 ? (
        <p className="mt-5 border-t border-line pt-4 text-xs leading-6 text-muted">بدون رنگ: محصول بدون انتخاب سفارش داده می‌شود و موجودی آن در «قیمت و موجودی» است.</p>
      ) : (
        <div className="mt-5 border-t border-line pt-4">
          <p className={`mb-3 text-xs ${count > MAX_VARIANTS ? "text-danger" : "text-ink-2"}`}>
            {count > MAX_VARIANTS
              ? `${num(count, "fa")} ترکیب — هر محصول حداکثر ${num(MAX_VARIANTS, "fa")} ترکیب دارد؛ چند رنگ را بردارید.`
              : `${num(count, "fa")} ترکیب${on.length < count ? ` · ${num(on.length, "fa")} ترکیب ساخته می‌شود` : ""}`}
          </p>

          {count <= MAX_VARIANTS && (
            <>
              {/* bulk fill: all combinations, or those of one colour */}
              <div className="mb-4 grid gap-3 border border-line bg-ground/60 p-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto]">
                <label className="block min-w-0">
                  <span className="mb-1 block text-xs font-medium text-ink-2">اعمال گروهی روی</span>
                  <Select value={target} onChange={(e) => setTarget(e.target.value as Target)}>
                    <option value="all">همه‌ی ترکیب‌ها</option>
                    {targets.map((t) => (
                      <option key={t.v} value={t.v}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
                </label>
                <div className="min-w-0">
                  <span className="mb-1 block text-xs font-medium text-ink-2">موجودی</span>
                  <div className="flex gap-2">
                    <CountInput value={bulkStock} onChange={(n) => setBulkStock(Math.max(0, n))} aria-label={`موجودی برای ${targetLabel}`} />
                    <Button variant="secondary" onClick={() => patchRows(bulkPick, { stock: bulkStock })} disabled={!on.length}>
                      اعمال
                    </Button>
                  </div>
                </div>
                <div className="min-w-0">
                  <span className="mb-1 block text-xs font-medium text-ink-2">قیمت (خالی = قیمت محصول)</span>
                  <div className="flex gap-2">
                    <div className="min-w-0 flex-1">
                      <MoneyInput value={bulkPrice} onChange={setBulkPrice} placeholder="همان قیمت محصول" aria-label={`قیمت برای ${targetLabel}`} />
                    </div>
                    <Button variant="secondary" onClick={() => patchRows(bulkPick, { price: bulkPrice })} disabled={!on.length}>
                      اعمال
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap items-end gap-2 sm:col-span-full lg:col-span-1">
                  <Button variant="secondary" icon="image" disabled={!images.length || !on.length} onClick={() => setImageFor({ title: `تصویر ${targetLabel}`, pick: bulkPick, current: null })}>
                    تصویر
                  </Button>
                  <Button variant="ghost" disabled={!productSku.trim() || !on.length} onClick={() => on.filter((g) => g.row && inTarget(g.row)).forEach((g) => patchRows((r) => r.k === g.row!.k, { sku: comboSku(productSku, g.o, palette) }))} title="کد هر ترکیب از کد محصول و کد رنگ‌ها">
                    کدها از کد محصول
                  </Button>
                </div>
              </div>

              <div aria-hidden className="hidden gap-3 px-3 pb-1.5 text-xs text-muted lg:grid lg:grid-cols-[minmax(0,1.5fr)_6.5rem_minmax(0,0.6fr)_minmax(0,1fr)_minmax(0,1.35fr)_9rem]">
                <span>ترکیب</span>
                <span>ساخته می‌شود</span>
                <span>موجودی</span>
                <span>قیمت این ترکیب</span>
                <span>کد (SKU)</span>
                <span>تصویر</span>
              </div>
              <ol className="space-y-2">
                {grid.map(({ o, row }) => {
                  if (!row) return null;
                  const name = optionLabel(o, palette, "fa");
                  const img = row.image_id ? images.find((m) => m.id === row.image_id) : undefined;
                  const dots = OPTION_AXES.filter((a) => o[a]).map((a) => valueOf(palette, a, o[a])?.swatch ?? "");
                  const sel = (r: VariantRow) => r.k === row.k;
                  return (
                    <li key={row.k} className={`border ${row.off ? "border-dashed border-line-strong bg-ground/60" : "border-line bg-white"}`}>
                      <div className="grid grid-cols-6 items-center gap-3 p-3 lg:grid-cols-[minmax(0,1.5fr)_6.5rem_minmax(0,0.6fr)_minmax(0,1fr)_minmax(0,1.35fr)_9rem]">
                        <span className={`col-span-4 flex min-w-0 items-center gap-2.5 lg:col-span-1 ${row.off ? "text-muted" : "text-ink"}`}>
                          <span className="flex shrink-0 -space-x-1 rtl:space-x-reverse" aria-hidden>
                            {dots.map((d, i) => (
                              <Swatch key={i} value={d} className="size-4 ring-2! ring-white!" />
                            ))}
                          </span>
                          <span className="min-w-0 text-sm leading-6">{name}</span>
                        </span>
                        <label className="col-span-2 flex h-10 cursor-pointer items-center justify-end gap-2 text-xs text-ink-2 lg:col-span-1 lg:justify-start">
                          <input type="checkbox" checked={!row.off} onChange={(e) => patchRows(sel, { off: !e.target.checked })} className="size-4 accent-[var(--color-ink)]" aria-label={`${name} ساخته می‌شود`} />
                          <span className="lg:sr-only">{row.off ? "ساخته نمی‌شود" : "ساخته می‌شود"}</span>
                        </label>
                        {row.off ? (
                          <span className="col-span-6 text-xs leading-5 text-muted lg:col-span-4">ساخته نمی‌شود؛ در سایت کم‌رنگ دیده می‌شود و سفارش داده نمی‌شود.</span>
                        ) : (
                          <>
                            <label className="col-span-3 block min-w-0 lg:col-span-1">
                              <span className="mb-1 block text-xs text-muted lg:sr-only">موجودی</span>
                              <CountInput value={row.stock} onChange={(n) => patchRows(sel, { stock: Math.max(0, n) })} aria-label={`موجودی ${name}`} />
                            </label>
                            <label className="col-span-3 block min-w-0 lg:col-span-1">
                              <span className="mb-1 block text-xs text-muted lg:sr-only">قیمت این ترکیب</span>
                              <MoneyInput value={row.price} onChange={(n) => patchRows(sel, { price: n })} placeholder={productPrice === null ? "قیمت محصول (استعلام)" : "قیمت محصول"} aria-label={`قیمت ${name}`} />
                            </label>
                            <label className="col-span-6 block min-w-0 sm:col-span-3 lg:col-span-1">
                              <span className="mb-1 block text-xs text-muted lg:sr-only">کد (SKU)</span>
                              <Input value={row.sku} onChange={(e) => patchRows(sel, { sku: e.target.value })} maxLength={60} dir="ltr" placeholder={comboSku(productSku, o, palette) || "—"} aria-label={`کد ${name}`} />
                            </label>
                            <button
                              type="button"
                              onClick={() => setImageFor({ title: `تصویر ${name}`, pick: sel, current: row.image_id })}
                              disabled={!images.length}
                              className="col-span-6 flex h-10 w-full min-w-0 items-center gap-2 self-end rounded-sm border border-line-strong bg-white px-1.5 text-sm text-ink-2 transition-colors hover:border-ink disabled:cursor-not-allowed disabled:bg-bone disabled:text-faint sm:col-span-3 lg:col-span-1"
                            >
                              {img ? <Picture media={img} ratio="3/4" sizes="40px" alt="" className="h-8 w-6 shrink-0" /> : <Icon name="image" className="mx-1 size-4 shrink-0 text-muted" />}
                              <span className="truncate">{img ? "تغییر تصویر" : images.length ? "انتخاب تصویر" : "اول تصویر بیفزایید"}</span>
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </div>
      )}

      {removed.length > 0 && (
        <p className="mt-4 flex items-start gap-2 border border-warning/40 bg-warning-soft px-3 py-2.5 text-xs leading-6 text-warning" role="status">
          <Icon name="warning" className="mt-1 size-4 shrink-0" />
          <span>
            با ذخیره، {num(removed.length, "fa")} ترکیب که موجودی دارد حذف می‌شود: {removed.map((r) => `${r.name} (${num(r.stock, "fa")} عدد)`).join("، ")}.
          </span>
        </p>
      )}

      <Dialog open={Boolean(imageFor)} onClose={() => setImageFor(null)} title={imageFor?.title ?? ""}>
        {imageFor && (
          <div className="space-y-4">
            <p className="text-xs leading-6 text-muted">وقتی مشتری این ترکیب را انتخاب کند، این تصویر نمایش داده می‌شود.</p>
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              <li>
                <button
                  type="button"
                  onClick={() => (patchRows(imageFor.pick, { image_id: null }), setImageFor(null))}
                  aria-pressed={!imageFor.current}
                  className={`grid aspect-[3/4] w-full place-items-center border px-2 text-center text-xs text-muted ${!imageFor.current ? "border-gold outline outline-1 outline-gold" : "border-line hover:border-ink"}`}
                >
                  بدون تصویر
                </button>
              </li>
              {images.map((m, j) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => (patchRows(imageFor.pick, { image_id: m.id ?? null }), setImageFor(null))}
                    aria-pressed={imageFor.current === m.id}
                    aria-label={`تصویر ${num(j + 1, "fa")}`}
                    className={`block w-full border ${imageFor.current === m.id ? "border-gold outline outline-1 outline-gold" : "border-line hover:border-ink"}`}
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
