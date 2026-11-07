// Typed links between any two records (sm_links): an incident caused by a problem, a change that fixes it, a
// duplicate… A link is stored once (from → to) and shown on both records with the label of its direction.
// Modules add kinds with `registerLinkKind`. Imported by the UI: keep it free of server imports.

export interface LinkKind {
  /** shown on the `from` record, before the `to` record: «ناشی از» INC… */
  out: string;
  /** shown on the `to` record, before the `from` record: «علت» PRB… */
  in: string;
}

export const LINK_KINDS: Record<string, LinkKind> = {
  related: { out: "مرتبط با", in: "مرتبط با" },
  caused_by: { out: "ناشی از", in: "علت" },
  duplicate_of: { out: "تکراریِ", in: "نسخهٔ اصلیِ" },
  fixes: { out: "رفع می‌کند", in: "رفع‌شده با" },
  implements: { out: "پیاده‌سازیِ", in: "پیاده‌شده با" },
  affects: { out: "اثر می‌گذارد بر", in: "متأثر از" },
  blocks: { out: "مانعِ", in: "منتظرِ" },
};

export function registerLinkKind(key: string, kind: LinkKind): void {
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(key)) throw new Error(`invalid link kind: ${key}`);
  LINK_KINDS[key] = kind;
}
