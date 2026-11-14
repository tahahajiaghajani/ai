// The «PRTG Network Monitor» kind (design A §2.1, §6.1, §9.2, §10): the v1 HTTP API (`/api/table.json`, paged by
// `start` + `count`) with an API key in the `Authorization: Bearer` header (PRTG never gets a key in its address,
// §14.1). Devices bring the name, host (address or DNS name), location and tags — PRTG knows no serial or hardware.
// The device's own status is unreliable (Paessler's KB shows a device «Up» while all its sensors are down), so
// availability is read from the device's Ping sensor or the sensor type named in `primary_sensor`; other sensors down
// or in warning make a warning. The last contact is the primary sensor's `lastup`. Pure rules below, shared.
// Imported by the UI: keep it free of server imports.
import type { DiscoveredStatus } from "../types";
import { describeKind } from "./base";

export const prtg = describeKind({
  kind: "prtg",
  label: "PRTG Network Monitor",
  icon: "gauge",
  category: "monitoring",
  ready: true,
  editions: ["cloud", "server", "relay"],
  auth: ["token"],
  collects: ["inventory", "status", "problems"],
  contact: { lag_days: 0 },
  availability: true,
  priority: 70,
  options: [
    { key: "primary_sensor", label: "حسگر دسترس‌پذیری", type: "string", default: "ping", ltr: true, help: "نوع حسگری که بودن یا نبودن دستگاه را نشان می‌دهد، مانند ping یا http" },
    { key: "group_id", label: "شناسهٔ گروه", type: "int", help: "فقط دستگاه‌های زیر این گروه یا کاوشگر؛ خالی یعنی همهٔ دستگاه‌هایی که کاربر API می‌بیند" },
    { key: "tags", label: "برچسب‌ها", type: "tags", ltr: true, help: "فقط دستگاه‌هایی که یکی از این برچسب‌ها را دارند" },
    { key: "class_map", label: "کلاس بر پایهٔ گروه یا برچسب", type: "json", help: "نام گروه یا برچسب PRTG ← کلاس پیکربندی، مانند { \"Switches\": \"network_device\" }" },
    { key: "page_size", label: "اندازهٔ صفحه", type: "int", default: 500 },
  ],
  permission_note: "کلید API برای کاربر فقط‌خواندنی PRTG (PRTG ۲۲ یا تازه‌تر)، با دسترسی خواندن به گروه‌های لازم",
});

/** PRTG's `status_raw` values. */
export const PRTG_STATUS = {
  unknown: 1, collecting: 2, up: 3, warning: 4, down: 5, noProbe: 6, pausedByUser: 7, pausedByDependency: 8, pausedBySchedule: 9, unusual: 10,
  notLicensed: 11, pausedUntil: 12, downAcknowledged: 13, downPartial: 14,
} as const;

/** Sensor states that are an open problem (§9.6): warning, unusual, down, down acknowledged, down partial. */
export const PRTG_PROBLEM_STATES = [4, 5, 10, 13, 14] as const;

const paused = (s: number | null | undefined) => s === 7 || s === 9 || s === 12;

export interface PrtgAvailabilityInput {
  /** the device's own status_raw: only its paused states are trusted */
  device: number | null;
  /** the primary sensor (Ping by default), when the device has one */
  primary: { status: number; name?: string; message?: string } | null;
  /** the device's sensors down (down, acknowledged, partial) and in warning (warning, unusual) */
  down: number;
  warning: number;
}

/**
 * A device's monitor status by the PRTG rule (§9.2): the primary sensor down (5) or down acknowledged (13) → down; paused
 * by dependency (8: its parent is down) → unreachable; paused (7, 9, 12) → in maintenance; down partial (14), warning,
 * unusual, or any other sensor down or in warning → warning; up (3) → up; else unknown.
 */
export function prtgAvailability(x: PrtgAvailabilityInput): DiscoveredStatus {
  const p = x.primary?.status ?? null;
  const said = x.primary ? [x.primary.name, x.primary.message].filter(Boolean).join(": ") : "";
  if (paused(x.device) || paused(p)) return { state: "maintenance", message: "پایش این دستگاه در PRTG مکث شده است" };
  if (p === 5 || p === 13) return { state: "down", availability: true, message: said || "حسگر دسترس‌پذیری پاسخ نمی‌گیرد" };
  if (p === 8 || x.device === 8) return { state: "unreachable", availability: true, message: "PRTG این دستگاه را به سبب قطع بودن والدش نمی‌پاید" };
  if (p === 4 || p === 10 || p === 14) return { state: "warning", message: said || "حسگر دسترس‌پذیری در هشدار است" };
  if (x.down > 0 || x.warning > 0) return { state: "warning", message: "حسگر دیگری از این دستگاه قطع یا در هشدار است" };
  if (p === 3) return { state: "up" };
  if (!x.primary) return { state: "unknown", message: "حسگر دسترس‌پذیری (Ping یا حسگر اصلی) برای این دستگاه پیدا نشد" };
  return { state: "unknown", message: said || "PRTG هنوز وضعیت این دستگاه را نمی‌داند" };
}

/** The severity of an open sensor state as the event module's words. */
export function prtgSeverity(status: number, availability: boolean): string {
  if (status === 5) return availability ? "critical" : "major";
  if (status === 13 || status === 14) return "minor";
  return "warning";
}

/** PRTG's raw date (an OLE Automation date: days since 1899-12-30, UTC) as ISO; undefined when empty. */
export function oleDateIso(raw: unknown): string | undefined {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 25569) return undefined;
  const ms = Math.round((n - 25569) * 86_400_000);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}
