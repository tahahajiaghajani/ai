import { contactLinks } from "@/components/account/contact";
import { formatPhone, latinDigits, normalizePhone, num, type Lang } from "@/lib/format";
import type { ContactSettings } from "@/lib/settings-types";

/** A handle typed as «@celin», «celin» or a full profile URL → «celin». */
export function handleOf(v: string): string {
  return (v ?? "")
    .trim()
    .replace(/^https?:\/\/(www\.)?(instagram\.com|t\.me|telegram\.me)\//i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "");
}

export interface StoreChannels {
  wa: string;
  waText: string;
  tel: string;
  phoneText: string;
  instagram: string;
  telegram: string;
  email: string;
  hours: string;
  address: string;
  map: string;
}

/** Every way to reach the store that the owner filled in (Admin → Settings → Contact); empty strings for the rest. */
export function storeChannels(c: ContactSettings, lang: Lang): StoreChannels {
  const l = contactLinks({ phone: c.phone, whatsapp: c.whatsapp }, lang);
  const email = (c.email ?? "").trim();
  const map = (c.mapUrl ?? "").trim();
  return {
    wa: l.wa,
    waText: l.wa ? (normalizePhone(c.whatsapp) ? formatPhone(normalizePhone(c.whatsapp), lang) : num(latinDigits(c.whatsapp).replace(/[^\d+]/g, ""), lang)) : "",
    tel: l.tel,
    phoneText: l.phoneText,
    instagram: handleOf(c.instagram),
    telegram: handleOf(c.telegram),
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "",
    hours: (lang === "en" ? c.hours_en || c.hours_fa : c.hours_fa).trim(),
    address: (lang === "en" ? c.address_en || c.address_fa : c.address_fa).trim(),
    map: /^https?:\/\//i.test(map) ? map : "",
  };
}
