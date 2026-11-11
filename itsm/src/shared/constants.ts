// App-wide constants shared by the web app, the desktop app and the server.

/**
 * The product's name: «کاریز» / Kariz — the Persian qanat, the channel that has carried water to towns quietly,
 * steadily and by measure for three thousand years (docs/BRAND_FA.md). It lives here only: use these constants
 * wherever the app names itself and never derive an internal identifier from them (tables are sm_*, settings
 * itsm.*, environment variables ITSM_*, IPC channels itsm:*, appId app.itsm.desktop, data in %APPDATA%\ITSM).
 * The drawn logo (src/shared/brand.ts) declares the name it draws; brand.tsx falls back to text if they differ.
 */
export const APP_NAME = "کاریز";
/** The Latin name (installer, executable, shortcuts, Latin contexts). */
export const APP_NAME_EN = "Kariz";
/** The tagline. */
export const APP_TAGLINE = "مدیریت هوشمند خدمات سازمان";
export const APP_TAGLINE_EN = "Intelligent service management";
/** What the app is, in one line (window titles, the About screen, meta descriptions). */
export const APP_DESCRIPTION = "سامانهٔ سازمانی مدیریت خدمات فناوری اطلاعات و خدمات سازمانی، با هوش مصنوعی";
/** Bumped with every release; the desktop app compares it with the cloud to offer updates. */
export const APP_VERSION = "1.1.0";
/**
 * Sync protocol version — the server refuses pushes and pulls from clients with another one. Bump it whenever a
 * synced table gains a column or a new synced kind appears, so a Windows app that does not know them cannot
 * overwrite them, and whenever the wire format changes.
 * 15: bank ITAM (asset branch and device fields, transfers, custody, device status, maintenance SLAs, attestation);
 * 16: revisions are transaction ids and pull cursors are database snapshots (no organisation write lock; a 1.1.0-beta
 * app, protocol 15, is told to update — docs/spec/ENGINE.md §13).
 */
export const SYNC_PROTOCOL = 16;

/**
 * Optional modules an organisation switches on («ماژول‌ها»). The platform itself has none; later modules
 * add an entry here (and their nav, routes and API) and `ModuleKey` follows.
 */
export const MODULES: { key: string; title: string; description: string }[] = [];
export type ModuleKey = (typeof MODULES)[number]["key"];

export const DEFAULT_TIMEZONE = "Asia/Tehran";

/** Time zones offered when an organisation is created (any IANA name is accepted by the API). */
export const TIMEZONES: { value: string; label: string }[] = [
  { value: "Asia/Tehran", label: "تهران (Asia/Tehran)" },
  { value: "Asia/Kabul", label: "کابل (Asia/Kabul)" },
  { value: "Asia/Dubai", label: "دبی (Asia/Dubai)" },
  { value: "Asia/Baghdad", label: "بغداد (Asia/Baghdad)" },
  { value: "Europe/Istanbul", label: "استانبول (Europe/Istanbul)" },
  { value: "Europe/Berlin", label: "برلین (Europe/Berlin)" },
  { value: "Europe/London", label: "لندن (Europe/London)" },
  { value: "America/New_York", label: "نیویورک (America/New_York)" },
  { value: "UTC", label: "UTC" },
];

/** Whether `tz` is a time zone this runtime knows (Intl). */
export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Record kinds that carry their own number series (e.g. `incident: { title: "رخداد", prefix: "INC" }`).
 * A numbered record keeps `no int` per organisation (and per `kind` when the series is shared by kinds) with a
 * unique index whose name contains `_no_`: the server hands out max + 1 under the organisation's write lock
 * (`nextNo` in src/server/db/sql.ts) and synchronisation moves a clashing number to the next free one. The
 * platform has none yet; later modules register theirs here.
 */
export const DOC_SERIES: Record<string, { title: string; prefix: string }> = {};
export type DocSeries = keyof typeof DOC_SERIES;

/** «INC-000123»: a record number with its series prefix (Latin by nature, shown in an LTR isolate). */
export function seriesNo(prefix: string, no: number | string, width = 6): string {
  const n = String(no ?? "").replace(/\D/g, "");
  return `${prefix}-${n.padStart(width, "0")}`;
}
