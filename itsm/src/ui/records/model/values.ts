// Values as text (kanban titles, tooltips, summaries, the activity stream's old → new), durations in Persian, the
// change set a save sends (only what changed), and deep equality of stored values. Pure: no React, no antd.
import { formatJalali, formatJalaliDateTime, toFa } from "@shared/jalali";
import { formatNumber } from "@shared/format";
import type { FieldDef, Option } from "@shared/model/types";
import { FIELD_TYPES } from "@shared/model/types";
import { displayOf, optionLabel, valuesOf } from "./schema";
import type { DisplayMap } from "./types";

export interface ValueContext {
  choices: Record<string, Option[]>;
  display?: DisplayMap;
  /** the organisation's time zone (date-times) */
  tz?: string;
}

/** Seconds → «۲ ساعت و ۳۰ دقیقه» (days of 24 hours; seconds only under a minute). */
export function formatDuration(seconds: unknown): string {
  const n = Number(seconds);
  if (seconds === null || seconds === undefined || seconds === "" || !Number.isFinite(n)) return "";
  const s = Math.round(Math.abs(n));
  if (s === 0) return "۰";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${toFa(d)} روز`);
  if (h) parts.push(`${toFa(h)} ساعت`);
  if (m) parts.push(`${toFa(m)} دقیقه`);
  if (!parts.length) parts.push(`${toFa(s)} ثانیه`);
  return `${n < 0 ? "−" : ""}${parts.slice(0, 2).join(" و ")}`;
}

/** Seconds → hours and minutes (the duration input's two boxes). */
export function splitDuration(seconds: unknown): { h: number; m: number } | null {
  const n = Number(seconds);
  if (seconds === null || seconds === undefined || seconds === "" || !Number.isFinite(n)) return null;
  const s = Math.max(0, Math.round(n));
  return { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60) };
}

/** A number for people: Persian digits, grouping (never for record numbers), percent and money as such. */
export function numberText(f: Pick<FieldDef, "type">, v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (f.type === "duration") return formatDuration(v);
  try {
    if (f.type === "percent") return `${formatNumber(String(v), { dp: 3 })}٪`;
    if (f.type === "int" || f.type === "rating") return formatNumber(String(v), { dp: 0 });
    return formatNumber(String(v), { dp: 8 });
  } catch {
    return toFa(String(v));
  }
}

/** A stored value as one line of Persian text. */
export function valueText(f: FieldDef, v: unknown, ctx: ValueContext): string {
  if (v === null || v === undefined || v === "") return "";
  const t = f.type;
  if (t === "bool") return v === true || v === "true" ? "بله" : "خیر";
  if (t === "date") return formatJalali(String(v));
  if (t === "datetime") return formatJalaliDateTime(String(v), ctx.tz);
  if (FIELD_TYPES[t].numeric) return numberText(f, v);
  if (t === "secret") {
    const hint = (v as { hint?: string } | null)?.hint;
    return hint ? `•••• ${hint.replace(/^…/, "")}` : "••••";
  }
  if (t === "choice" || t === "multichoice") return valuesOf(v).map((x) => optionLabel(f, ctx.choices, x)).join("، ");
  if (FIELD_TYPES[t].family === "ref") return valuesOf(v).map((x) => displayOf(ctx.display, x) ?? "(محدود)").join("، ");
  if (t === "tags") return valuesOf(v).join("، ");
  if (t === "json" || t === "conditions") return typeof v === "string" ? v : JSON.stringify(v);
  if (Array.isArray(v)) return v.map(String).join("، ");
  return String(v);
}

/** Deep equality of stored values (arrays and JSON objects compared by content; order matters for arrays). */
export function sameValue(a: unknown, b: unknown): boolean {
  const empty = (x: unknown) => x === null || x === undefined || x === "" || (Array.isArray(x) && x.length === 0);
  if (empty(a) && empty(b)) return true;
  if (a === b) return true;
  // a number and its decimal string are the same value («1.5» = 1.5)
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return typeof a !== "object" && typeof b !== "object" && String(a) === String(b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => sameValue(x, bb[i]));
  }
  const ka = Object.keys(a as object).sort();
  const kb = Object.keys(b as object).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/**
 * The values of `draft` that differ from `base`, limited to `fields` (what the form may change). A kept secret
 * (`{ secret: true }`) is never sent back.
 */
export function changedValues(base: Record<string, unknown>, draft: Record<string, unknown>, fields: readonly FieldDef[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (!(f.name in draft)) continue;
    const next = draft[f.name];
    if (f.type === "secret" && next && typeof next === "object") continue;
    if (!sameValue(base[f.name], next)) out[f.name] = next === undefined ? null : next;
  }
  return out;
}
