// Outbound webhooks and inbound endpoints (catalogue INT-005, INT-006, INT-010): the events a subscription may name,
// the headers of a delivery, the retry schedule and the JSON paths an inbound mapping reads. Pure.
// Imported by the UI: keep it free of server imports.
import type { Option } from "../model/types";

export type HookEvent = "created" | "updated" | "transitioned" | "deleted" | "commented";

export const HOOK_EVENTS: Option[] = [
  { value: "created", label: "ثبت", color: "green" },
  { value: "updated", label: "تغییر", color: "blue" },
  { value: "transitioned", label: "تغییر وضعیت", color: "indigo" },
  { value: "deleted", label: "حذف", color: "red" },
  { value: "commented", label: "پاسخ یا یادداشت", color: "teal" },
];

/** A record event kind → the subscription event it is (null: not delivered). */
export function hookEventOf(kind: string): HookEvent | null {
  switch (kind) {
    case "record.created":
      return "created";
    case "record.updated":
      return "updated";
    case "record.state_changed":
      return "transitioned";
    case "record.deleted":
      return "deleted";
    case "record.commented":
      return "commented";
    default:
      return null;
  }
}

/** Headers of a delivery (the signature is `sha256=<hex HMAC-SHA256 of the raw body>` with the subscription's secret). */
export const HOOK_HEADERS = {
  signature: "X-Signature",
  event: "X-Event",
  delivery: "X-Delivery-Id",
  table: "X-Table",
} as const;

/** Attempts of a delivery before it goes to the dead-letter list. */
export const HOOK_ATTEMPTS = 6;
/** Consecutive failed deliveries after which a subscription is paused. */
export const HOOK_PAUSE_AFTER = 10;

/** Delay before retry `n` (1-based): 30 s, 2 min, 8 min, 30 min, 2 h … at most 6 h. */
export function hookBackoffMs(n: number): number {
  return Math.min(6 * 3600_000, 30_000 * 4 ** Math.max(0, n - 1));
}

/**
 * A value at a JSON path: `$.a.b[0].c`, `a.b.0.c` or a plain key; null when absent. Only plain property and index
 * steps — never code.
 */
export function jsonPath(data: unknown, path: string): unknown {
  const p = String(path ?? "").trim().replace(/^\$\.?/, "");
  if (!p) return data;
  let cur: unknown = data;
  for (const raw of p.split(".")) {
    if (!raw) continue;
    const parts = raw.split(/\[(\d+)\]/).filter((x) => x !== "");
    for (const part of parts) {
      if (cur === null || cur === undefined) return null;
      if (/^\d+$/.test(part) && Array.isArray(cur)) cur = cur[Number(part)];
      else if (typeof cur === "object") cur = (cur as Record<string, unknown>)[part];
      else return null;
    }
  }
  return cur === undefined ? null : cur;
}

export interface InboundRule {
  /** JSON path in the payload */
  path: string;
  /** target field */
  field: string;
}

/** The field values an inbound payload maps to (objects and arrays become JSON text; empty values are left out). */
export function mapInbound(payload: unknown, rules: InboundRule[], defaults: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = { ...defaults };
  for (const r of rules) {
    if (!r?.field || !r.path) continue;
    const v = jsonPath(payload, r.path);
    if (v === null || v === undefined || v === "") continue;
    out[r.field] = typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : v;
  }
  return out;
}

/** Clean inbound rules from input. */
export function cleanInboundRules(raw: unknown): InboundRule[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r) => r && typeof r === "object")
    .map((r) => ({ path: String((r as InboundRule).path ?? "").trim().slice(0, 200), field: String((r as InboundRule).field ?? "").trim().slice(0, 64) }))
    .filter((r) => r.path && /^(u_)?[a-z][a-z0-9_]*$/.test(r.field))
    .slice(0, 100);
}
