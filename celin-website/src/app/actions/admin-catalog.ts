"use server";

import { revalidatePath } from "next/cache";
import { guard } from "@/lib/admin-action";
import { deleteProduct, deleteTaxon, duplicateProduct, importStarter, quickUpdate, reorderTaxa, saveProduct, saveTaxon, seedMediaId, type TaxonKind } from "@/lib/admin-catalog";
import { deleteMedia, listLibrary, mediaUsage, updateMedia } from "@/lib/admin-media";
import { loadMedia } from "@/lib/catalog";
import { UserError } from "@/lib/db";
import type { Media } from "@/lib/media";
import { SEED_MEDIA, type SeedKey } from "@/content/seed-media";
import { text, type Result } from "@/lib/action";
import { num } from "@/lib/format";

/** Admin: products, categories, collections and the picture library. */

const kindOf = (v: unknown): TaxonKind => (v === "collections" ? "collections" : "categories");

function refresh() {
  revalidatePath("/admin", "layout");
}

export async function adminSaveProduct(input: Record<string, unknown>): Promise<Result<{ id: string }>> {
  return guard(async () => {
    const id = await saveProduct(text(input.id, 40) || null, input);
    refresh();
    return { ok: true, message: "محصول ذخیره شد.", id };
  });
}

export async function adminQuickUpdate(input: Record<string, unknown>): Promise<Result> {
  return guard(async () => {
    const patch: { price?: unknown; stock?: unknown; stock_loaded?: unknown; status?: unknown } = {};
    if ("price" in input) patch.price = input.price;
    if ("stock" in input) patch.stock = input.stock;
    if ("stock_loaded" in input) patch.stock_loaded = input.stock_loaded;
    if ("status" in input) patch.status = input.status;
    await quickUpdate(text(input.id, 40), patch);
    refresh();
    return { ok: true, message: "ذخیره شد." };
  });
}

export async function adminDeleteProduct(input: Record<string, unknown>): Promise<Result> {
  return guard(async () => {
    await deleteProduct(text(input.id, 40));
    refresh();
    return { ok: true, message: "محصول حذف شد." };
  });
}

export async function adminDuplicateProduct(input: Record<string, unknown>): Promise<Result<{ id: string }>> {
  return guard(async () => {
    const id = await duplicateProduct(text(input.id, 40));
    refresh();
    return { ok: true, message: "یک نسخه‌ی پیش‌نویس ساخته شد.", id };
  });
}

export async function adminSaveTaxon(input: Record<string, unknown>): Promise<Result<{ id: string }>> {
  return guard(async () => {
    const id = await saveTaxon(kindOf(input.kind), text(input.id, 40) || null, input);
    refresh();
    return { ok: true, message: "ذخیره شد.", id };
  });
}

export async function adminDeleteTaxon(input: Record<string, unknown>): Promise<Result> {
  return guard(async () => {
    await deleteTaxon(kindOf(input.kind), text(input.id, 40));
    refresh();
    return { ok: true, message: "حذف شد؛ محصولات آن بدون دسته/مجموعه ماندند." };
  });
}

export async function adminReorderTaxa(input: Record<string, unknown>): Promise<Result> {
  return guard(async () => {
    await reorderTaxa(kindOf(input.kind), Array.isArray(input.ids) ? input.ids.map(String) : []);
    refresh();
    return { ok: true, message: "ترتیب ذخیره شد." };
  });
}

export async function adminImportStarter(): Promise<Result<{ products: number }>> {
  return guard(async () => {
    const r = await importStarter();
    refresh();
    return { ok: true, message: r.products + r.categories + r.collections ? `${num(r.products, "fa")} محصول، ${num(r.categories, "fa")} دسته و ${num(r.collections, "fa")} مجموعه‌ی نمونه وارد شد.` : "همه‌ی نمونه‌ها از قبل وارد شده بودند.", products: r.products };
  });
}

export async function adminUpdateMedia(input: Record<string, unknown>): Promise<Result> {
  return guard(async () => {
    await updateMedia(text(input.id, 40), input);
    return { ok: true, message: "ذخیره شد." };
  });
}

export async function adminDeleteMedia(input: Record<string, unknown>): Promise<Result> {
  return guard(async () => {
    await deleteMedia(text(input.id, 40));
    refresh();
    return { ok: true, message: "تصویر حذف شد." };
  });
}

/** The picture library for the media picker (newest first). */
export async function adminListMedia(): Promise<Result<{ items: Media[] }>> {
  return guard(async () => ({ ok: true, items: (await listLibrary()) ?? [] }));
}

/** Where one picture is used (products, options, categories, collections, site pictures). */
export async function adminMediaUsage(input: Record<string, unknown>): Promise<Result<{ usage: string[] }>> {
  return guard(async () => ({ ok: true, usage: await mediaUsage(text(input.id, 40)) }));
}

/**
 * Turns a built-in starter picture into a library row (created once, then reused), so it can get its own
 * focal point / alt text or be picked for another place.
 */
export async function adminAdoptSeedImage(input: Record<string, unknown>): Promise<Result<{ media: Media }>> {
  return guard(async () => {
    const key = text(input.key, 80);
    if (!Object.prototype.hasOwnProperty.call(SEED_MEDIA, key)) throw new UserError("این تصویر پیش‌فرض پیدا نشد.");
    const id = await seedMediaId(key as SeedKey);
    const media = (await loadMedia([id])).get(id);
    if (!media) throw new UserError("تصویر پیدا نشد؛ صفحه را دوباره باز کنید.");
    return { ok: true, media };
  });
}
