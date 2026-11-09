// Outbound HTTP of the administration consoles and the integration hub (webhooks, issue trackers, scheduled imports and
// exports): on the web version through the SSRF guard (public hosts only, no redirects), on the Windows app the office
// network is allowed; always with a timeout and a Persian message naming the service.
import type { ServerConfig } from "../../context";
import { guardedFetch } from "../ai/net";

export const OUT_TIMEOUT_MS = 15_000;

/** fetch for calls to other systems. */
export function outsideFetch(cfg: Partial<ServerConfig>): typeof fetch {
  const f = cfg.fetch ?? fetch;
  return cfg.mode === "desktop" ? f : guardedFetch(f);
}

export interface OutResult {
  status: number;
  ok: boolean;
  text: string;
  ms: number;
  headers: Headers | null;
}

/** One call; network failures come back as status 0 with a Persian message (never thrown). */
export async function callOut(cfg: Partial<ServerConfig>, url: string, init: RequestInit, label: string, timeoutMs = OUT_TIMEOUT_MS): Promise<OutResult> {
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await outsideFetch(cfg)(url, { ...init, signal: ac.signal, redirect: "manual" });
    const text = await res.text().catch(() => "");
    return { status: res.status, ok: res.ok, text: text.slice(0, 200_000), ms: Date.now() - started, headers: res.headers };
  } catch (e) {
    const aborted = (e as Error)?.name === "AbortError";
    const why = aborted ? "پاسخ نداد (زمان تمام شد)" : String((e as Error)?.message ?? e).slice(0, 200);
    return { status: 0, ok: false, text: `${label}: ${why}`, ms: Date.now() - started, headers: null };
  } finally {
    clearTimeout(timer);
  }
}

/** A short Persian description of a failed call. */
export function failText(label: string, r: OutResult): string {
  if (r.status === 0) return r.text;
  return `${label} پاسخ ${r.status} داد${r.text ? `: ${r.text.slice(0, 200)}` : ""}`;
}
