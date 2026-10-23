/** Shared result shape of every Server Action (client-safe). */
export type Result<T = object> = ({ ok: true; message?: string } & T) | { ok: false; error: string; field?: string };

export type Lang = "fa" | "en";
export const langOf = (v: unknown): Lang => (v === "en" ? "en" : "fa");

/** Trimmed text for a Postgres column (NUL is rejected by Postgres). */
export function text(v: unknown, max = 2000): string {
  return typeof v === "string" ? v.replace(/\u0000/g, "").trim().slice(0, max) : "";
}
