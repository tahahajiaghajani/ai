// Turning a capture into form values: exact matches only (a party by its national id / economic code or the id the
// server matched; an item by its code or its exact name) — anything else stays for the person to pick. Marks carry
// each value's confidence to the form (kit/AiMark).
import type { AiCaptureResult } from "@shared/ai/types";
import { fromJalali } from "@shared/jalali";
import type { OrgApi } from "../../lib/api";
import { normalizeFa } from "../../lib/fa";
import type { AiMarkValue } from "../kit/AiMark";
import { amountOf, dayOf } from "../kit/model";

type Fields = AiCaptureResult["fields"];

export const captureDay = (v: string | null | undefined) => dayOf(v, fromJalali);

/** The value of a field, trimmed, or null. */
export function val(f: Fields, key: string): string | null {
  const v = f[key]?.value;
  return v === null || v === undefined || !String(v).trim() ? null : String(v).trim();
}

/** A mark for a filled field (null when the field was not read). */
export function markOf(f: Fields, key: string): AiMarkValue | null {
  const x = f[key];
  return x && x.value !== null ? { confidence: x.confidence, note: x.note_fa ?? null, source: "capture" } : null;
}

const digits = (s: string | null) => (s ? s.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/\D/g, "") : "");

/** The party the capture names, by exact national id / economic code (or the server's own match), else null. */
export async function matchParty(api: OrgApi, f: Fields, keys: { id: string[]; code: string[] }): Promise<{ id: string; label: string } | null> {
  const direct = val(f, "party_id");
  // the server's exact match: its note reads «name» (کد …)
  if (direct) return { id: direct, label: (f.party_id?.note_fa ?? "").replace(/^«(.*)».*$/, "$1") };
  for (const k of [...keys.id, ...keys.code]) {
    const want = digits(val(f, k));
    if (want.length < 8) continue;
    const r = await api.get<{ options: { id: string; label: string; national_id?: string | null; economic_code?: string | null }[] }>("/data/party/options", { q: want }).catch(() => null);
    const hits = (r?.options ?? []).filter((o) => !o.national_id && !o.economic_code ? true : digits(o.national_id ?? "") === want || digits(o.economic_code ?? "") === want);
    if (hits.length === 1) return { id: hits[0].id, label: hits[0].label };
  }
  return null;
}

/** An item by exact code, else by exact (normalised) name; null when unsure. */
export async function matchItem<T extends { id: string; name: string; code: string }>(api: OrgApi, line: Record<string, { value: string | null }>, ctx: Record<string, unknown>): Promise<T | null> {
  const code = line.code?.value?.trim();
  if (code) {
    const r = await api.get<{ item: T | null }>("/goods/items/by-code", { code, ...ctx }).catch(() => null);
    if (r?.item) return r.item;
  }
  const name = line.description?.value?.trim();
  if (!name) return null;
  const want = normalizeFa(name);
  const exact = async (q: string) => {
    const r = await api.get<{ rows: T[] }>("/goods/items/lookup", { q, ...ctx }).catch(() => null);
    return (r?.rows ?? []).filter((it) => normalizeFa(it.name) === want);
  };
  let hits = await exact(name);
  // names written with Persian digits («۲۵۶ گیگ») may not be found by the search: retry with the words without digits
  const words = name.split(/\s+/).filter((w) => !/[0-9۰-۹٠-٩]/.test(w)).join(" ");
  if (!hits.length && words && words !== name) hits = await exact(words);
  return hits.length === 1 ? hits[0] : null;
}

/** Quantity, unit price and discount of a captured line as plain decimal strings (price = total ÷ qty when missing). */
export function lineNumbers(line: Record<string, { value: string | null }>): { qty: string | null; price: string | null; discount: string | null; total: string | null } {
  const qty = amountOf(line.qty?.value);
  const total = amountOf(line.total?.value);
  let price = amountOf(line.unit_price?.value);
  if (!price && qty && total && Number(qty) > 0) price = String(Math.round((Number(total) / Number(qty)) * 100) / 100);
  return { qty, price, discount: amountOf(line.discount?.value), total };
}
