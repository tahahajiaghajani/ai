// Normalisation of reported records (design A §6.2): pure and shared. Connectors, the push API and the relay hand every
// record through `normaliseRecord`, so one tool value is stored, hashed and matched the same way wherever it came from:
//   · strings trimmed; Persian and Arabic digits to Latin in identifiers
//   · MACs as AA:BB:CC:DD:EE:FF, the null MAC dropped; IPs validated, loopback and link-local dropped
//   · serials without the placeholders firmware reports («To be filled by O.E.M.», «Default string», «0»…); VMware's
//     `VMware-xx…` kept as the VM's serial
//   · BIOS UUIDs in upper case, the all-zero one dropped; host names in lower case, the FQDN built from the host name
//     and the domain when only those are given
// A bad record is refused with its reason (one bad record never stops a pass or a batch); a field outside the record's
// shape — or one people and ITAM own (§6.3) — is dropped with a warning, or moved to the reported hints.
// Imported by the UI: keep it free of server imports.
import { ITEM_KIND_VALUES, STATUS_VALUES, type DiscoveredRecord, type DiscoveredSoftware, type ItemKind, type ReportedHints, type StatusState } from "./types";

export const MAX_EXTERNAL_ID = 200;
export const MAX_SOFTWARE = 300;
export const MAX_ATTRS = 100;

/** Persian (۰–۹) and Arabic-Indic (٠–٩) digits as Latin ones. */
export const latinDigits = (s: string): string => s.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));

const text = (v: unknown, max: number): string | undefined => {
  if (v === null || v === undefined) return undefined;
  if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") return undefined;
  const s = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  return s ? s.slice(0, max) : undefined;
};
const ident = (v: unknown, max: number): string | undefined => {
  const s = text(v, max * 2);
  return s ? latinDigits(s).trim().slice(0, max) : undefined;
};

// ---------------------------------------------------------------------------------------------------------------
// Identifiers

/** A MAC address in any notation as AA:BB:CC:DD:EE:FF; null when it is not one or is the null MAC. */
export function normaliseMac(v: unknown): string | null {
  const s = ident(v, 64);
  if (!s) return null;
  const hex = s.toUpperCase().replace(/[^0-9A-F]/g, "");
  if (hex.length !== 12 || /^0{12}$/.test(hex)) return null;
  return hex.match(/.{2}/g)!.join(":");
}

function ipv4(s: string): string | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  if (o.some((x) => x > 255)) return null;
  // unspecified, loopback, link-local
  if (o[0] === 0 || o[0] === 127 || (o[0] === 169 && o[1] === 254)) return null;
  return o.join(".");
}

function ipv6(s: string): string | null {
  const lower = s.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  // an IPv4-mapped address is its IPv4; other forms with an embedded IPv4 are not taken
  const mapped = /^(?:(?:0{1,4}:){5}|::)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  if (mapped) return ipv4(mapped[1]);
  if (!/^[0-9a-f:]+$/.test(lower) || !lower.includes(":")) return null;
  const parts = lower.split("::");
  if (parts.length > 2) return null;
  const groups = (x: string) => (x ? x.split(":") : []);
  const head = groups(parts[0]);
  const tail = parts.length === 2 ? groups(parts[1]) : [];
  if ([...head, ...tail].some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const missing = 8 - head.length - tail.length;
  if (parts.length === 1 ? head.length !== 8 : missing < 1) return null;
  const full = [...head, ...Array(parts.length === 2 ? missing : 0).fill("0"), ...tail].map((g) => g.replace(/^0+(?=.)/, ""));
  // unspecified, loopback, link-local (fe80::/10)
  if (full.every((g) => g === "0")) return null;
  if (full.slice(0, 7).every((g) => g === "0") && full[7] === "1") return null;
  if ((parseInt(full[0], 16) & 0xffc0) === 0xfe80) return null;
  // RFC 5952: the longest run of two or more zero groups becomes «::»
  let best = -1;
  let len = 0;
  for (let i = 0; i < 8; ) {
    if (full[i] !== "0") {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && full[j] === "0") j++;
    if (j - i > len) [best, len] = [i, j - i];
    i = j;
  }
  if (len < 2) return full.join(":");
  return `${full.slice(0, best).join(":")}::${full.slice(best + len).join(":")}`;
}

/** An IP address, validated (v4 or v6), or null — loopback and link-local addresses are dropped. */
export function normaliseIp(v: unknown): string | null {
  const s = ident(v, 80);
  if (!s) return null;
  return s.includes(":") ? ipv6(s) : ipv4(s);
}

/** Values firmware puts where a serial number belongs (compared without spaces, dots and case). */
const SERIAL_PLACEHOLDERS = new Set([
  "", "0", "00000000", "0000000000", "NA", "N/A", "NONE", "NULL", "DEFAULT", "DEFAULTSTRING", "TOBEFILLEDBYOEM", "TOBEFILLEDBYO.E.M.", "SYSTEMSERIALNUMBER",
  "CHASSISSERIALNUMBER", "123456789", "1234567890", "NOTSPECIFIED", "NOTAPPLICABLE", "UNKNOWN", "INVALID", "OEM", "-", "SERIALNUMBER", "XXXXXXXXXX",
]);

/** A serial number without the placeholders some firmware reports (`VMware-xx…` is a real VM serial and stays). */
export function normaliseSerial(v: unknown): string | null {
  const s = ident(v, 120);
  if (!s) return null;
  const key = s.toUpperCase().replace(/[\s.]/g, "");
  if (SERIAL_PLACEHOLDERS.has(key) || SERIAL_PLACEHOLDERS.has(s.toUpperCase().replace(/\s+/g, "")) || /^0+$/.test(key)) return null;
  return s;
}

/** A BIOS UUID in upper case (dashes added to a bare 32-digit form); the all-zero and all-F placeholders dropped. */
export function normaliseUuid(v: unknown): string | null {
  const s = ident(v, 80);
  if (!s) return null;
  let u = s.toUpperCase().replace(/^\{|\}$/g, "");
  if (/^[0-9A-F]{32}$/.test(u)) u = `${u.slice(0, 8)}-${u.slice(8, 12)}-${u.slice(12, 16)}-${u.slice(16, 20)}-${u.slice(20)}`;
  const hex = u.replace(/-/g, "");
  if (/^0+$/.test(hex) || /^F+$/.test(hex)) return null;
  return u;
}

/** A host name in lower case without a trailing dot. */
export function normaliseHost(v: unknown, max = 255): string | null {
  const s = ident(v, max);
  if (!s) return null;
  const h = s.toLowerCase().replace(/\.+$/, "");
  return h && /^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?)*$/.test(h) ? h : null;
}

/** An instant as ISO, never later than `now` (a tool's clock ahead must not make a machine seen in the future). */
export function normaliseTime(v: unknown, now: Date): string | null {
  if (v === null || v === undefined || v === "") return null;
  let ms: number;
  if (typeof v === "number" && Number.isFinite(v)) ms = v < 1e11 ? v * 1000 : v; // epoch seconds or milliseconds
  else if (typeof v === "string") {
    const s = latinDigits(v.trim());
    ms = /^\d{9,13}$/.test(s) ? (s.length <= 10 ? Number(s) * 1000 : Number(s)) : Date.parse(s);
  } else return null;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(Math.min(ms, now.getTime())).toISOString();
}

function count(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(latinDigits(String(v)).trim());
  if (!Number.isFinite(n) || n < 0 || n > 2_000_000_000) return null;
  return Math.round(n);
}

// ---------------------------------------------------------------------------------------------------------------
// Fields people and ITAM own (§6.3): a record that carries one keeps it only as a hint, or loses it

/** Top-level keys a record may carry. */
const RECORD_KEYS = new Set([
  "external_id", "kind", "class", "name", "hostname", "fqdn", "domain", "ips", "macs", "serial_number", "bios_uuid", "terminal_id", "manufacturer", "model",
  "os", "os_version", "sw_version", "cpu_count", "ram_mb", "disk_gb", "cloud_resource_id", "url", "reported", "parent_external_id", "last_contact_at",
  "status", "software", "attrs",
]);

/** What a record carrying a field people or ITAM own keeps of it: the hint it becomes (§6.3, §8.3). */
const AS_HINT: Record<string, keyof ReportedHints> = {
  asset_tag: "asset_tag", used_by: "user", user: "user", location: "location", location_id: "location", site: "site",
};

/** CI fields people or ITAM decide (§6.3): never written by a tool. */
export const OWNED_FIELDS = new Set([
  "owned_by", "managed_by", "used_by", "support_group_id", "managed_by_group_id", "change_approval_group_id", "location_id", "cost_center_id", "company_id",
  "asset_tag", "install_status", "operational_status", "state", "environment", "criticality", "tier", "tags", "expires_at", "eol_date",
  "maintenance_calendar_id",
]);

export const OWNED_FIELD_WARNING = (field: string) => `«${field}» را مدیر دارایی یا مالک پیکربندی تعیین می‌کند؛ مقدار ابزار در «گزارش‌شده» نگه داشته می‌شود`;
export const OWNED_FIELD_DROPPED = (field: string) => `«${field}» را مدیر دارایی یا مالک پیکربندی تعیین می‌کند و از ابزار پذیرفته نمی‌شود`;
export const UNKNOWN_FIELD_DROPPED = (field: string) => `فیلد «${field}» در رکورد شناخته نیست و کنار گذاشته شد`;
export const RESERVED_ATTR_DROPPED = (key: string) => `ویژگی «${key}» برای مقدارهای گزارش‌شده رزرو شده است؛ آن را در «reported» بفرستید`;
export const SECRET_ATTR_DROPPED = (key: string) => `ویژگی «${key}» شبیه رمز یا کلید است و نگه داشته نمی‌شود`;
export const NO_EXTERNAL_ID = "شناسهٔ مورد در ابزار (external_id) لازم است";
export const LONG_EXTERNAL_ID = `شناسهٔ مورد در ابزار بیش از ${MAX_EXTERNAL_ID} نویسه است`;
export const NOT_A_RECORD = "رکورد باید یک شیء JSON باشد";

const ATTR_KEY = /^[a-z][a-z0-9_]{0,59}$/;
/** Keys whose values are credentials, never kept (as event ingest redacts them). */
const SECRET_KEY = /pass(word|wd)?|secret|token|api[-_]?key|authori[sz]ation|^auth$|cookie|private[-_]?key|credential|signature|ms-mcs-admpwd|laps/i;

export interface Normalised {
  record: DiscoveredRecord | null;
  /** fields dropped or moved, values that did not parse (Persian) */
  warnings: string[];
  /** why the record was refused (Persian), when `record` is null */
  error?: string;
}

/** Normalise one reported record (pure). `now` bounds the times a tool reports. */
export function normaliseRecord(raw: unknown, opts: { now?: Date } = {}): Normalised {
  const now = opts.now ?? new Date();
  const warnings: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { record: null, warnings, error: NOT_A_RECORD };
  const r = raw as Record<string, unknown>;
  const externalRaw = text(r.external_id, MAX_EXTERNAL_ID * 4);
  if (!externalRaw) return { record: null, warnings, error: NO_EXTERNAL_ID };
  const external_id = latinDigits(externalRaw);
  if (external_id.length > MAX_EXTERNAL_ID) return { record: null, warnings, error: LONG_EXTERNAL_ID };

  const reported: ReportedHints = {};
  for (const [k, v] of Object.entries(r)) {
    if (RECORD_KEYS.has(k)) continue;
    if (AS_HINT[k]) {
      const hint = text(v, 200);
      if (hint && !reported[AS_HINT[k]]) reported[AS_HINT[k]] = hint;
      warnings.push(OWNED_FIELD_WARNING(k));
    } else if (OWNED_FIELDS.has(k)) warnings.push(OWNED_FIELD_DROPPED(k));
    else warnings.push(UNKNOWN_FIELD_DROPPED(k));
  }

  let kind = text(r.kind, 20) as ItemKind | undefined;
  if (kind && !ITEM_KIND_VALUES.includes(kind)) {
    warnings.push(`گونهٔ «${kind}» شناخته نیست؛ «سایر» در نظر گرفته شد`);
    kind = undefined;
  }
  const out: DiscoveredRecord = { external_id, kind: kind ?? "other", name: "" };

  const cls = text(r.class, 63);
  if (cls) {
    if (/^[a-z][a-z0-9_]{0,62}$/.test(cls)) out.class = cls;
    else warnings.push(`کلاس «${cls}» نام درستی ندارد و کنار گذاشته شد`);
  }

  // host names and the FQDN: a dotted host name is an FQDN
  let hostname = normaliseHost(r.hostname, 255);
  let fqdn = normaliseHost(r.fqdn, 255);
  const domain = normaliseHost(r.domain, 255);
  if (hostname && hostname.includes(".")) {
    fqdn ??= hostname;
    hostname = hostname.split(".")[0];
  }
  if (!fqdn && hostname && domain) fqdn = `${hostname}.${domain}`;
  if (!hostname && fqdn) hostname = fqdn.split(".")[0];
  if (hostname) out.hostname = hostname.slice(0, 120);
  if (fqdn) out.fqdn = fqdn;
  if (domain) out.domain = domain;
  if (r.hostname !== undefined && r.hostname !== null && r.hostname !== "" && !hostname) warnings.push("نام میزبان درست نیست و کنار گذاشته شد");

  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === null || v === undefined || v === "" ? [] : [v]);
  const ips = [...new Set(list(r.ips).map(normaliseIp).filter((x): x is string => !!x))].slice(0, 32);
  if (ips.length) out.ips = ips;
  const macs = [...new Set(list(r.macs).map(normaliseMac).filter((x): x is string => !!x))].slice(0, 32);
  if (macs.length) out.macs = macs;

  const serial = normaliseSerial(r.serial_number);
  if (serial) out.serial_number = serial;
  const bios = normaliseUuid(r.bios_uuid);
  if (bios) out.bios_uuid = bios;
  const terminal = ident(r.terminal_id, 40);
  if (terminal) out.terminal_id = terminal;

  const strings: [keyof DiscoveredRecord, number][] = [["manufacturer", 120], ["model", 160], ["os", 120], ["os_version", 80], ["sw_version", 80], ["cloud_resource_id", 255]];
  for (const [k, max] of strings) {
    const s = text(r[k], max);
    if (s) (out as unknown as Record<string, unknown>)[k] = k === "os_version" || k === "sw_version" ? latinDigits(s) : s;
  }
  const url = text(r.url, 500);
  if (url) {
    if (/^https?:\/\/[^\s/]+/i.test(url) && !/^[a-z]+:\/\/[^/]*@/i.test(url)) out.url = url;
    else warnings.push("نشانی (url) درست نیست و کنار گذاشته شد");
  }
  for (const k of ["cpu_count", "ram_mb", "disk_gb"] as const) {
    if (r[k] === undefined || r[k] === null || r[k] === "") continue;
    const n = count(r[k]);
    if (n === null) warnings.push(`«${k}» عدد درستی نیست و کنار گذاشته شد`);
    else out[k] = n;
  }

  // hints of holder, place and tag (never the CI's own fields)
  if (r.reported && typeof r.reported === "object" && !Array.isArray(r.reported)) {
    for (const [k, v] of Object.entries(r.reported as Record<string, unknown>)) {
      if (k !== "user" && k !== "site" && k !== "location" && k !== "asset_tag") {
        warnings.push(UNKNOWN_FIELD_DROPPED(`reported.${k}`));
        continue;
      }
      const hint = k === "asset_tag" ? ident(v, 80) : text(v, 200);
      if (hint) reported[k] = hint;
    }
  }
  if (Object.keys(reported).length) out.reported = reported;

  const parent = ident(r.parent_external_id, MAX_EXTERNAL_ID);
  if (parent && parent !== external_id) out.parent_external_id = parent;

  if (r.last_contact_at !== undefined && r.last_contact_at !== null && r.last_contact_at !== "") {
    const at = normaliseTime(r.last_contact_at, now);
    if (at) out.last_contact_at = at;
    else warnings.push("زمان آخرین تماس (last_contact_at) درست نیست و کنار گذاشته شد");
  }

  if (r.status && typeof r.status === "object" && !Array.isArray(r.status)) {
    const s = r.status as Record<string, unknown>;
    let state = text(s.state, 20) as StatusState | undefined;
    if (!state || !STATUS_VALUES.includes(state)) {
      if (state) warnings.push(`وضعیت «${state}» شناخته نیست؛ «نامعلوم» در نظر گرفته شد`);
      state = "unknown";
    }
    out.status = { state };
    if (typeof s.availability === "boolean") out.status.availability = s.availability;
    const since = normaliseTime(s.since, now);
    if (since) out.status.since = since;
    const message = text(s.message, 500);
    if (message) out.status.message = message;
    const device = text(s.device_status, 60);
    if (device) out.status.device_status = device;
  }

  if (Array.isArray(r.software)) {
    const sw: DiscoveredSoftware[] = [];
    for (const x of r.software) {
      if (sw.length >= MAX_SOFTWARE) {
        warnings.push(`بیش از ${MAX_SOFTWARE} نرم‌افزار؛ بقیه کنار گذاشته شد`);
        break;
      }
      if (!x || typeof x !== "object") continue;
      const o = x as Record<string, unknown>;
      const name = text(o.name, 300);
      if (!name) continue;
      const item: DiscoveredSoftware = { name };
      const version = text(o.version, 120);
      if (version) item.version = latinDigits(version);
      const vendor = text(o.vendor, 200);
      if (vendor) item.vendor = vendor;
      sw.push(item);
    }
    if (sw.length) out.software = sw;
  }

  if (r.attrs && typeof r.attrs === "object" && !Array.isArray(r.attrs)) {
    const attrs: Record<string, string | number | boolean> = {};
    let n = 0;
    for (const [k, v] of Object.entries(r.attrs as Record<string, unknown>)) {
      if (!ATTR_KEY.test(k)) {
        warnings.push(`ویژگی «${k.slice(0, 60)}» نام درستی ندارد و کنار گذاشته شد`);
        continue;
      }
      if (k.startsWith("reported_")) {
        warnings.push(RESERVED_ATTR_DROPPED(k));
        continue;
      }
      if (SECRET_KEY.test(k)) {
        warnings.push(SECRET_ATTR_DROPPED(k));
        continue;
      }
      if (++n > MAX_ATTRS) {
        warnings.push(`بیش از ${MAX_ATTRS} ویژگی؛ بقیه کنار گذاشته شد`);
        break;
      }
      if (typeof v === "boolean") attrs[k] = v;
      else if (typeof v === "number" && Number.isFinite(v)) attrs[k] = v;
      else {
        const s = text(v, 1000);
        if (s !== undefined) attrs[k] = s;
      }
    }
    if (Object.keys(attrs).length) out.attrs = attrs;
  }

  out.name = text(r.name, 200) ?? out.hostname ?? out.fqdn ?? out.serial_number ?? external_id;
  return { record: out, warnings };
}
