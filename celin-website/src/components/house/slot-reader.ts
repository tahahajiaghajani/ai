import { slotDef } from "@/content/slots";
import type { Lang } from "@/lib/format";
import { slotText, type SlotMap } from "@/lib/slot-types";

/** Slot text in the page language; falls back to the slot's built-in default (a cached copy may predate a new text). */
export function slotReader(slots: SlotMap, lang: Lang) {
  return (key: string, field: string): string => {
    const v = slotText(slots[key], field, lang);
    if (v) return v;
    const t = slotDef(key)?.texts.find((x) => x.key === field);
    return t ? (lang === "en" ? t.en || t.fa : t.fa) : "";
  };
}
