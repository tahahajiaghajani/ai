import { formatDate, type Lang } from "@/lib/format";

/** How a membership ended (its code expired or was revoked; from proStatus, via /api/me); client-safe. */
export type ProEnded = { reason: "expired" | "revoked"; at: string } | null;

/** The line a former member sees above the renewal request (account and /pro). */
export function proEndedText(lang: Lang, ended: ProEnded | undefined): string {
  if (!ended) return "";
  const d = formatDate(ended.at, lang);
  if (lang === "fa") {
    return ended.reason === "expired"
      ? `اعتبار عضویت شما${d ? ` در ${d}` : ""} به پایان رسید. برای تمدید، درخواست تازه بفرستید یا با فروشگاه تماس بگیرید.`
      : `عضویت شما${d ? ` در ${d}` : ""} از سوی فروشگاه پایان یافت. برای عضویت دوباره، درخواست بفرستید یا با فروشگاه تماس بگیرید.`;
  }
  return ended.reason === "expired"
    ? `Your membership expired${d ? ` on ${d}` : ""}. To renew, send a new request or contact the store.`
    : `Your membership was ended by the store${d ? ` on ${d}` : ""}. To join again, send a request or contact the store.`;
}
