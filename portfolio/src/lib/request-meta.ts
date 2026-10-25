/** Request vocabulary (client-safe). */
export const KINDS = ["project", "consulting", "demo", "collaboration", "design", "other"] as const;
export const STATUSES = ["new", "reviewing", "answered", "scheduled", "closed"] as const;
export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export type RequestKind = (typeof KINDS)[number];
export type RequestStatus = (typeof STATUSES)[number];
export type RequestPriority = (typeof PRIORITIES)[number];

export const isKind = (v: unknown): v is RequestKind => KINDS.includes(v as RequestKind);
export const isStatus = (v: unknown): v is RequestStatus => STATUSES.includes(v as RequestStatus);
export const isPriority = (v: unknown): v is RequestPriority => PRIORITIES.includes(v as RequestPriority);

export const PRIORITY_LABEL: Record<RequestPriority, { fa: string; en: string }> = {
  low: { fa: "کم", en: "Low" },
  normal: { fa: "معمولی", en: "Normal" },
  high: { fa: "بالا", en: "High" },
  urgent: { fa: "فوری", en: "Urgent" },
};

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** Human-friendly tracking code, e.g. TA-7K3QX9 (no 0/O/1/I). */
export function requestCode(random: (n: number) => Uint8Array): string {
  let s = "";
  for (const b of random(6)) s += ALPHABET[b % ALPHABET.length];
  return `TA-${s}`;
}

export function normalizeCode(input: string): string {
  const s = input
    .trim()
    .toUpperCase()
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[^A-Z0-9]/g, "");
  return `TA-${s.startsWith("TA") ? s.slice(2) : s}`;
}

/** What the visitor sees after sending: the AI's reading of the request. */
export interface VisitorTriage {
  kind: RequestKind;
  priority: RequestPriority;
  summary: string;
  questions: string[];
}
