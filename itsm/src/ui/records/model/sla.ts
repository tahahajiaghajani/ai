// Record meta that other modules fill (docs/spec/ENGINE.md §5 `registerRecordMeta`): SLA timers (`meta.sla`) and the
// people who have the record open (`meta.viewers`). The shapes are read leniently so the SLA and presence services
// can evolve; the UI only renders what the server computed — it never decides a breach itself.
// Pure: no React, no antd.
import { toFa } from "@shared/jalali";

export interface SlaTimer {
  key: string;
  label: string;
  /** epoch ms of the target, null when unknown */
  dueAt: number | null;
  startAt: number | null;
  paused: boolean;
  breached: boolean;
  met: boolean;
  /** share of the target used, 0 … 1 (and beyond once breached); NaN when unknown */
  used: number;
  /** ms left until the target (negative once overdue); null when unknown or stopped */
  remainingMs: number | null;
}

const time = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? null : t;
};
const pick = (o: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
};

/**
 * Timers from `meta.sla`: an array of timers, `{ timers: [...] }` or one timer. Each may carry `label|name|title`,
 * `due_at|deadline|breach_at`, `start_at|started_at`, `paused` or `state: "paused"`, `breached`/`met` or
 * `state: "breached" | "met" | "achieved"`, `percent|elapsed_pct` (0–100) and `remaining_ms`.
 */
export function slaTimers(raw: unknown, now: number = Date.now()): SlaTimer[] {
  const list: unknown[] = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { timers?: unknown }).timers) ? (raw as { timers: unknown[] }).timers : raw && typeof raw === "object" ? [raw] : [];
  const out: SlaTimer[] = [];
  list.forEach((x, i) => {
    if (!x || typeof x !== "object") return;
    const o = x as Record<string, unknown>;
    const state = String(pick(o, "state", "status") ?? "").toLowerCase();
    const dueAt = time(pick(o, "due_at", "deadline", "breach_at", "target_at"));
    const startAt = time(pick(o, "start_at", "started_at", "start"));
    const paused = o.paused === true || state === "paused";
    const met = o.met === true || o.achieved === true || state === "met" || state === "achieved" || state === "completed";
    const breached = o.breached === true || state === "breached" || (!met && !paused && dueAt !== null && dueAt < now);
    const pct = Number(pick(o, "percent", "elapsed_pct", "used"));
    let used = Number.isFinite(pct) ? (pct > 1.5 ? pct / 100 : pct) : NaN;
    if (Number.isNaN(used) && dueAt !== null && startAt !== null && dueAt > startAt) used = (now - startAt) / (dueAt - startAt);
    const rem = Number(o.remaining_ms);
    const remainingMs = met ? null : Number.isFinite(rem) ? rem : dueAt !== null ? dueAt - now : null;
    out.push({ key: String(pick(o, "id", "key") ?? i), label: String(pick(o, "label", "name", "title") ?? "توافق سطح خدمت"), dueAt, startAt, paused, breached, met, used, remainingMs });
  });
  return out;
}

/** «۲ ساعت و ۱۰ دقیقه» of a span (minutes under an hour, days over two days). */
export function spanText(ms: number): string {
  const m = Math.max(0, Math.round(Math.abs(ms) / 60000));
  if (m < 60) return `${toFa(m)} دقیقه`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${toFa(h)} ساعت و ${toFa(m % 60)} دقیقه` : `${toFa(h)} ساعت`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${toFa(d)} روز و ${toFa(h % 24)} ساعت` : `${toFa(d)} روز`;
}

/** The words of a timer: «۲ ساعت مانده»، «۳۵ دقیقه از موعد گذشته»، «انجام شد»، «متوقف». */
export function slaText(t: SlaTimer): string {
  if (t.met) return "در موعد انجام شد";
  if (t.paused) return "متوقف";
  if (t.remainingMs === null) return "";
  return t.remainingMs >= 0 ? `${spanText(t.remainingMs)} مانده` : `${spanText(t.remainingMs)} از موعد گذشته`;
}

export interface Viewer {
  id: string;
  name: string;
  /** writing a reply or a note right now */
  typing?: boolean;
}

/** People other than `me` in `meta.viewers` (ids, or objects with id/user_id and name). */
export function otherViewers(raw: unknown, me: string | null | undefined, display: Record<string, string> = {}): Viewer[] {
  if (!Array.isArray(raw)) return [];
  const out: Viewer[] = [];
  for (const v of raw) {
    const o = typeof v === "string" ? { id: v } : v && typeof v === "object" ? (v as Record<string, unknown>) : null;
    const id = o ? String(o.id ?? o.user_id ?? "") : "";
    if (!id || id === me || out.some((x) => x.id === id)) continue;
    const name = String((o && (o.name ?? o.full_name)) ?? display[id] ?? "همکار");
    out.push({ id, name, ...(o && o.typing ? { typing: true } : {}) });
  }
  return out;
}

/** «سارا محمدی هم این رکورد را باز کرده است» / «سارا محمدی و ۲ نفر دیگر هم …». */
export function viewersText(vs: readonly Viewer[]): string {
  if (!vs.length) return "";
  const typing = vs.find((v) => v.typing);
  if (typing) return `${typing.name} در حال نوشتن روی این رکورد است`;
  if (vs.length === 1) return `${vs[0].name} هم این رکورد را باز کرده است`;
  return `${vs[0].name} و ${toFa(vs.length - 1)} نفر دیگر هم این رکورد را باز کرده‌اند`;
}
