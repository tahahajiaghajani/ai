// The files input's pure helpers (design F §3.1 «پیوست»): the ids a value holds, how many files a field takes, the
// file picker's `accept`, the accepted kinds in words, why a file is refused and a size in Persian. Light on purpose:
// record forms load the files input without the canvas. Re-exported by ./model.ts.
import { ATTACHMENTS_DEFAULT_MAX, ATTACHMENTS_MAX, FILE_KINDS, acceptedExtensions, extensionOf } from "@shared/forms/validators";
import { faDigits } from "@shared/format";

/** The attachment ids a stored value holds (ids or `{ id }` objects), deduplicated; anything else is left out. */
export function fileIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const x of value) {
    const v = x && typeof x === "object" && "id" in (x as object) ? (x as { id: unknown }).id : x;
    const s = typeof v === "string" ? v.trim().toLowerCase() : "";
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** The most files a field takes. */
export const filesMax = (f: { max?: number | null }): number => Math.min(f.max ?? ATTACHMENTS_DEFAULT_MAX, ATTACHMENTS_MAX);

/** The file picker's `accept` attribute («.pdf,.png,…»); empty when any file is accepted. */
export function acceptAttr(accept?: readonly string[] | null): string {
  return [...acceptedExtensions(accept)].map((e) => `.${e}`).join(",");
}

/** The kinds a field accepts, in words («تصویر، PDF»); empty when any file is. */
export function acceptText(accept?: readonly string[] | null): string {
  return (accept ?? []).map((k) => FILE_KINDS[k]?.label ?? k).join("، ");
}

/** Why a file cannot be added (its kind, or the count it would reach), or null. */
export function fileProblem(f: { label: string; max?: number | null; accept?: string[] | null }, name: string, countAfter: number): string | null {
  const allowed = acceptedExtensions(f.accept);
  if (allowed.size && !allowed.has(extensionOf(name))) return `«${name}» پذیرفته نیست؛ «${f.label}» فقط این نوع‌ها را می‌پذیرد: ${acceptText(f.accept)}`;
  const max = filesMax(f);
  if (countAfter > max) return `«${f.label}» حداکثر ${faDigits(max)} پرونده می‌پذیرد`;
  return null;
}

/** A file size in Persian («۲٫۴ مگابایت»). */
export function sizeText(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return "";
  if (bytes < 1024) return `${faDigits(bytes)} بایت`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${faDigits(Math.round(kb))} کیلوبایت`;
  return `${faDigits((kb / 1024).toFixed(1)).replace(".", "٫")} مگابایت`;
}
