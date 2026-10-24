import { accountCopy } from "@/content/copy/account";
import { formatPhone, latinDigits, num, type Lang } from "@/lib/format";
import { Icon } from "@/components/ui/icons";

export interface StoreContactInfo {
  phone: string;
  whatsapp: string;
}

/** tel: and WhatsApp links of the store (from Admin → Settings → Contact); nothing when neither is set. */
export function contactLinks(c: StoreContactInfo, lang: Lang) {
  const phone = latinDigits(c.phone ?? "").trim();
  const wa = latinDigits(c.whatsapp ?? "").replace(/\D/g, "");
  return {
    tel: phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : "",
    phoneText: phone ? (/^09\d{9}$/.test(phone) ? formatPhone(phone, lang) : num(phone, lang)) : "",
    wa: wa ? `https://wa.me/${wa.startsWith("98") ? wa : `98${wa.replace(/^0/, "")}`}` : "",
  };
}

export function StoreContact({ contact, lang, className = "", tone = "light" }: { contact: StoreContactInfo; lang: Lang; className?: string; tone?: "light" | "night" }) {
  const c = accountCopy(lang).contact;
  const l = contactLinks(contact, lang);
  if (!l.tel && !l.wa) return null;
  const link = tone === "night" ? "text-on-night hover:text-gold-glow" : "text-ink hover:text-gold-text";
  const icon = tone === "night" ? "text-gold-on-dark" : "text-muted";
  return (
    <span className={`flex flex-wrap items-center gap-x-5 gap-y-1 ${className}`}>
      {l.tel && (
        <a href={l.tel} className={`inline-flex min-h-11 items-center gap-2 text-sm transition-colors ${link}`}>
          <Icon name="phone" className={`size-4 ${icon}`} />
          <span className="sr-only">{c.call}</span>
          <span className="ltr tabular-nums">{l.phoneText}</span>
        </a>
      )}
      {l.wa && (
        <a href={l.wa} target="_blank" rel="noreferrer" className={`inline-flex min-h-11 items-center gap-2 text-sm transition-colors ${link}`}>
          <Icon name="whatsapp" className={`size-4 ${icon}`} />
          {c.whatsapp}
        </a>
      )}
    </span>
  );
}
