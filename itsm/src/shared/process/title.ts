// The title of a case (design F §3.5, F4a): the version's `title_template` filled from the start submission — pills of
// the start form's fields and of the requester only: «تنخواه {{case.u_branch}} — {{case.u_amount}}»,
// «درخواست {{case.requested_by}}». A template without pills (or none) gives «<process name>»; the authority sets the
// title once, when it creates the case. Pure and shared: the designer's preview and the server.
// Imported by the UI: keep it free of server imports.
import { CASE_ROOT } from "./graph";

/** People pills a title may use (rendered as names). */
export const TITLE_PEOPLE = ["requested_by", "requested_for"] as const;

export const TITLE_MAX = 300;

const PILL = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** The `case` keys a template names, in order, without repeats (`{{case.u_amount}}` → «u_amount»); other pills too, as written. */
export function titlePills(template: string | null | undefined): { keys: string[]; other: string[] } {
  const keys: string[] = [];
  const other: string[] = [];
  for (const m of String(template ?? "").matchAll(PILL)) {
    const expr = m[1].trim();
    const prefix = `${CASE_ROOT}.`;
    if (expr.startsWith(prefix) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(expr.slice(prefix.length))) {
      const k = expr.slice(prefix.length);
      if (!keys.includes(k)) keys.push(k);
    } else if (!other.includes(expr)) other.push(expr);
  }
  return { keys, other };
}

/**
 * Fill a title template. `text(key)` gives the display text of a start-form field or a person pill (the caller
 * formats values and resolves names); a pill it cannot fill is left empty. Spaces are tidied and the result capped;
 * an empty result falls back to `fallback` (the process's name).
 */
export function renderTitle(template: string | null | undefined, text: (key: string) => string | null | undefined, fallback: string): string {
  const raw = String(template ?? "").replace(PILL, (_m, expr: string) => {
    const e = expr.trim();
    const prefix = `${CASE_ROOT}.`;
    if (!e.startsWith(prefix)) return "";
    const v = text(e.slice(prefix.length));
    return v === null || v === undefined ? "" : String(v);
  });
  const tidy = raw.replace(/\s+/g, " ").replace(/\s+([،,.:؛)])/g, "$1").replace(/[\s—\-–:،,]+$/u, "").replace(/^[\s—\-–:،,]+/u, "").trim();
  return (tidy || fallback || "پرونده").slice(0, TITLE_MAX);
}
