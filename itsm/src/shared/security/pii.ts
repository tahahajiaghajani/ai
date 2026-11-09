// Sensitive-data discovery and redaction (SEC-055, «Beyond the market»: Persian PII detectors with validation):
// Iranian national IDs (checksum), IBANs (mod-97), card numbers (Luhn), 09xx mobile numbers, 10-digit postal codes
// and e-mail addresses — Persian and Arabic digits included. Every finding carries its kind, a masked value and its
// position; `redact` replaces them. Deterministic and local: nothing leaves the tenant.
// Imported by the UI: keep it free of server imports.

export type PiiKind = "national_id" | "iban" | "card" | "mobile" | "postal_code" | "email";

export const PII_LABELS: Record<PiiKind, string> = {
  national_id: "کد ملی",
  iban: "شمارهٔ شبا",
  card: "شمارهٔ کارت",
  mobile: "شمارهٔ همراه",
  postal_code: "کد پستی",
  email: "نشانی رایانامه",
};

export interface PiiFinding {
  kind: PiiKind;
  label: string;
  /** the value with all but its last characters masked */
  masked: string;
  start: number;
  end: number;
}

const FA = "۰۱۲۳۴۵۶۷۸۹";
const AR = "٠١٢٣٤٥٦٧٨٩";

/** Latin digits for Persian and Arabic ones (same length, so positions keep). */
export function latinDigits(s: string): string {
  return s.replace(/[۰-۹٠-٩]/g, (d) => String(FA.includes(d) ? FA.indexOf(d) : AR.indexOf(d)));
}

/** The Iranian national ID checksum (10 digits, not all equal). */
export function validNationalId(v: string): boolean {
  const d = latinDigits(v).replace(/\D/g, "");
  if (!/^\d{10}$/.test(d) || /^(\d)\1{9}$/.test(d)) return false;
  const check = Number(d[9]);
  const sum = [...d.slice(0, 9)].reduce((s, c, i) => s + Number(c) * (10 - i), 0);
  const r = sum % 11;
  return r < 2 ? check === r : check === 11 - r;
}

/** IBAN mod-97 (any country; Iranian ones are «IR» + 24 digits). */
export function validIban(v: string): boolean {
  const s = latinDigits(v).replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const n = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const c of n) rem = (rem * 10 + Number(c)) % 97;
  }
  return rem === 1;
}

/** The Luhn check of a card number (13–19 digits). */
export function validLuhn(v: string): boolean {
  const d = latinDigits(v).replace(/[\s-]/g, "");
  if (!/^\d{13,19}$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

/** Iranian postal codes: 10 digits, no 0 or 2 in the first five, the fifth not 5. */
export const validPostalCode = (v: string) => /^[13-9]{4}[1346-9][013-9]{5}$/.test(latinDigits(v).replace(/\D/g, "")) && !/^(\d)\1{9}$/.test(latinDigits(v));

const mask = (v: string, keep = 4) => {
  const t = v.replace(/\s/g, "");
  return t.length <= keep ? "*".repeat(t.length) : `${"*".repeat(Math.min(12, t.length - keep))}${t.slice(-keep)}`;
};

interface Rule {
  kind: PiiKind;
  re: RegExp;
  ok: (v: string) => boolean;
}

const RULES: Rule[] = [
  { kind: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, ok: () => true },
  { kind: "iban", re: /\bIR\s?\d{2}(?:[\s-]?\d{4}){5}[\s-]?\d{2}\b/gi, ok: validIban },
  { kind: "card", re: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, ok: validLuhn },
  { kind: "mobile", re: /(?:\+98|0098|\b0)9\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/g, ok: () => true },
  { kind: "national_id", re: /\b\d{3}-?\d{6}-?\d\b/g, ok: validNationalId },
  { kind: "postal_code", re: /\b\d{5}-?\d{5}\b/g, ok: validPostalCode },
];

/** Personal data in a text, validated (a number that fails its checksum is not reported), in text order. */
export function detectPii(text: string, kinds?: PiiKind[]): PiiFinding[] {
  const src = latinDigits(String(text ?? ""));
  const taken: [number, number][] = [];
  const out: PiiFinding[] = [];
  const overlaps = (s: number, e: number) => taken.some(([a, b]) => s < b && e > a);
  for (const r of RULES) {
    if (kinds && !kinds.includes(r.kind)) continue;
    r.re.lastIndex = 0;
    for (const m of src.matchAll(r.re)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (overlaps(start, end) || !r.ok(m[0])) continue;
      taken.push([start, end]);
      out.push({ kind: r.kind, label: PII_LABELS[r.kind], masked: mask(m[0], r.kind === "email" ? 0 : 4).replace(/^\*+$/, (s) => (r.kind === "email" ? `${s}@…` : s)), start, end });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The text with every finding replaced by «[کد ملی حذف شد]» (or the given mask). */
export function redact(text: string, findings: PiiFinding[], replacement?: (f: PiiFinding) => string): string {
  let out = String(text ?? "");
  for (const f of [...findings].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, f.start) + (replacement ? replacement(f) : `[${f.label} حذف شد]`) + out.slice(f.end);
  }
  return out;
}

/** Counts per kind (for a scan summary). */
export function piiSummary(findings: PiiFinding[]): { kind: PiiKind; label: string; count: number }[] {
  const m = new Map<PiiKind, number>();
  for (const f of findings) m.set(f.kind, (m.get(f.kind) ?? 0) + 1);
  return [...m.entries()].map(([kind, count]) => ({ kind, label: PII_LABELS[kind], count }));
}
