// What a connector may write into a CI, and how a tool's data becomes a record (design A §6.3). Pure and shared: the
// server builds reconciliation items from it, the push API checks pushed records with it, the wizard's mapping editor
// refuses what it refuses and previews the same mapped fields.
//
// THE ALLOW-LIST. Connectors write only identity and technical CI fields — name, hostname, fqdn, ip_address,
// mac_address, serial_number, bios_uuid, cloud_resource_id, manufacturer, model_name, os, os_version, sw_version,
// cpu_count, ram_mb, disk_gb, url — and class attributes `attrs.<key>` except the reserved `attrs.reported_*`. What
// people and ITAM own (owners, groups, place, cost centre, asset tag, lifecycle, environment, criticality, tags,
// dates) is never sent: a tool's value for the holder, place and tag goes to `attrs.reported_*` as a hint.
//
// MAPPING. A connector's `mapping` maps targets to sources. Targets are fields of the normalised record (the CI
// aliases ip_address, mac_address and model_name are accepted) or `attrs.<key>`. For the REST kind a source is a JSON
// path over one element of the tool's array (`$.inventory.serial`); for every other kind it is a path in the record
// the kind produced (`attrs.location`, `reported.site`) — a rename.
// Imported by the UI: keep it free of server imports.
import { pickPath } from "../json-path";
import { OWNED_FIELDS, latinDigits } from "./normalise";
import type { DiscoveredRecord, ReportedHints } from "./types";

/** CI fields a connector may write (besides `attrs.<key>`). */
export const ALLOWED_CI_FIELDS = [
  "name", "hostname", "fqdn", "ip_address", "mac_address", "serial_number", "bios_uuid", "cloud_resource_id", "manufacturer", "model_name", "os", "os_version",
  "sw_version", "cpu_count", "ram_mb", "disk_gb", "url",
] as const;
export type AllowedCiField = (typeof ALLOWED_CI_FIELDS)[number];
const ALLOWED = new Set<string>(ALLOWED_CI_FIELDS);

/** CI fields of the engine and of data quality: never a tool's (on top of what people and ITAM own). */
export const ENGINE_CI_FIELDS = new Set([
  "class", "description", "attrs", "change_id", "disposal_notes", "discovery_source_id", "first_discovered_at", "last_discovered_at", "is_stale",
  "health_score", "health_issues", "health", "health_at", "locked_attrs", "attr_meta", "certified_at", "certified_by", "supports_critical_function",
  "max_criticality", "merged_into", "watch_list",
]);

/** The class attributes that hold a tool's hints of holder, site, place and tag (§8.3). */
export const REPORTED_ATTRS: Record<keyof ReportedHints, string> = {
  user: "reported_user",
  site: "reported_site",
  location: "reported_location",
  asset_tag: "reported_asset_tag",
};

/** The editor's refusal of a target people or ITAM own (§6.3). */
export const REFUSED_FIELD_MESSAGE = "این فیلد را مدیر دارایی یا مالک پیکربندی تعیین می‌کند؛ مقدار ابزار در «گزارش‌شده» نگه داشته می‌شود";

/** Is this CI field (or `attrs.<key>`) one a connector may write? */
export function isAllowedTarget(target: string): boolean {
  if (target.startsWith("attrs.")) {
    const key = target.slice(6);
    return /^[a-z][a-z0-9_]{0,59}$/.test(key) && !key.startsWith("reported_");
  }
  return ALLOWED.has(target);
}

// ---------------------------------------------------------------------------------------------------------------
// Mapping targets and their validation

/** Fields of the normalised record a mapping may set (`attrs.<key>` besides). */
export const RECORD_TARGETS = [
  "external_id", "kind", "class", "name", "hostname", "fqdn", "domain", "ips", "macs", "serial_number", "bios_uuid", "terminal_id", "manufacturer", "model",
  "os", "os_version", "sw_version", "cpu_count", "ram_mb", "disk_gb", "cloud_resource_id", "url", "parent_external_id", "last_contact_at",
  "status.state", "status.availability", "status.since", "status.message", "status.device_status",
  "reported.user", "reported.site", "reported.location", "reported.asset_tag",
] as const;
const TARGETS = new Set<string>(RECORD_TARGETS);

/** CI field names accepted as targets, and the record field they stand for. */
export const CI_ALIASES: Record<string, string> = { ip_address: "ips", mac_address: "macs", model_name: "model" };

export interface MappingProblem {
  key: string;
  message: string;
}

/** The record field a mapping target sets (aliases resolved), or null when the target is not one. */
export function targetField(target: string): string | null {
  const t = CI_ALIASES[target] ?? target;
  if (TARGETS.has(t)) return t;
  if (t.startsWith("attrs.") && isAllowedTarget(t)) return t;
  return null;
}

/**
 * Problems of a connector's `mapping` (empty when it may be saved): a target people or ITAM own is refused with the
 * editor's message; the REST kind needs `external_id`.
 */
export function checkMapping(mapping: unknown, opts: { rest?: boolean } = {}): MappingProblem[] {
  if (mapping === null || mapping === undefined) return opts.rest ? [{ key: "external_id", message: "برای منبع REST، مسیر شناسهٔ مورد (external_id) لازم است" }] : [];
  if (typeof mapping !== "object" || Array.isArray(mapping)) return [{ key: "", message: "نگاشت باید یک شیء JSON از «فیلد ← مسیر» باشد" }];
  const problems: MappingProblem[] = [];
  const entries = Object.entries(mapping as Record<string, unknown>);
  if (entries.length > 200) problems.push({ key: "", message: "نگاشت بیش از ۲۰۰ فیلد دارد" });
  for (const [key, source] of entries) {
    if (typeof source !== "string" || !source.trim() || source.length > 300) {
      problems.push({ key, message: `مسیر «${key}» باید متنی کوتاه باشد` });
      continue;
    }
    if (key.startsWith("attrs.reported_")) {
      problems.push({ key, message: REFUSED_FIELD_MESSAGE });
      continue;
    }
    if (targetField(key)) continue;
    const bare = key.replace(/^attrs\./, "");
    if (OWNED_FIELDS.has(key) || ENGINE_CI_FIELDS.has(key) || OWNED_FIELDS.has(bare)) problems.push({ key, message: REFUSED_FIELD_MESSAGE });
    else problems.push({ key, message: `فیلد «${key}» در نگاشت شناخته نیست` });
  }
  if (opts.rest && !entries.some(([k]) => k === "external_id")) problems.push({ key: "external_id", message: "برای منبع REST، مسیر شناسهٔ مورد (external_id) لازم است" });
  return problems;
}

/** The value at a mapping source: a JSON path (`$.a.b`, `a.b`, `items[0].x`) over an object. */
export function sourceValue(obj: unknown, path: string): unknown {
  const p = path.trim().replace(/^\$\.?/, "");
  return p ? pickPath(obj, p) : obj;
}

function setPath(out: Record<string, unknown>, field: string, value: unknown): void {
  if (value === undefined || value === null || value === "") return;
  const dot = field.indexOf(".");
  if (dot < 0) {
    out[field] = value;
    return;
  }
  const head = field.slice(0, dot);
  const rest = field.slice(dot + 1);
  const inner = (out[head] && typeof out[head] === "object" ? out[head] : (out[head] = {})) as Record<string, unknown>;
  inner[rest] = value;
}

/**
 * A raw record from one element of a REST tool's array (the REST kind *is* mapping): every target of the mapping
 * read by its JSON path. The result goes through `normaliseRecord` like any other.
 */
export function recordFromElement(element: unknown, mapping: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [target, path] of Object.entries(mapping)) {
    const field = targetField(target);
    if (!field) continue;
    setPath(out, field, sourceValue(element, path));
  }
  return out;
}

/**
 * A built-in kind's record with the connector's renames applied (`{ "attrs.rack": "attrs.location" }`): each target
 * takes the value at its source path in the record. Refused targets are left out (the editor never saves them).
 */
export function applyRenames(record: DiscoveredRecord, mapping: Record<string, string> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = JSON.parse(JSON.stringify(record));
  if (!mapping) return out;
  for (const [target, path] of Object.entries(mapping)) {
    const field = targetField(target);
    if (!field || field === "external_id") continue;
    const v = sourceValue(record, path);
    if (v === undefined || v === null || v === "") continue;
    if (field.startsWith("attrs.")) {
      const attrs = (out.attrs && typeof out.attrs === "object" ? out.attrs : (out.attrs = {})) as Record<string, unknown>;
      attrs[field.slice(6)] = v;
    } else setPath(out, field, v);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Record → CI values

export interface CiValues {
  /** allow-listed CI fields */
  values: Partial<Record<AllowedCiField, string | number>>;
  /** class attributes, the reported hints among them (`reported_*`) */
  attrs: Record<string, string | number | boolean>;
}

/**
 * The CI fields and class attributes of a normalised record (§6.3): only allow-listed fields; the first address and
 * MAC become the CI's; the terminal id is a class attribute; holder, site, place and tag hints go to `attrs.reported_*`.
 */
export function ciValues(record: DiscoveredRecord): CiValues {
  const values: CiValues["values"] = {};
  const set = (k: AllowedCiField, v: string | number | undefined) => {
    if (v !== undefined && v !== null && v !== "") values[k] = v;
  };
  set("name", record.name);
  set("hostname", record.hostname);
  set("fqdn", record.fqdn);
  set("ip_address", record.ips?.[0]);
  set("mac_address", record.macs?.[0]);
  set("serial_number", record.serial_number);
  set("bios_uuid", record.bios_uuid);
  set("cloud_resource_id", record.cloud_resource_id);
  set("manufacturer", record.manufacturer);
  set("model_name", record.model);
  set("os", record.os);
  set("os_version", record.os_version);
  set("sw_version", record.sw_version);
  set("cpu_count", record.cpu_count);
  set("ram_mb", record.ram_mb);
  set("disk_gb", record.disk_gb);
  set("url", record.url);
  const attrs: CiValues["attrs"] = {};
  for (const [k, v] of Object.entries(record.attrs ?? {})) if (isAllowedTarget(`attrs.${k}`)) attrs[k] = v;
  if (record.terminal_id) attrs.terminal_id = latinDigits(record.terminal_id);
  for (const [hint, attr] of Object.entries(REPORTED_ATTRS) as [keyof ReportedHints, string][]) {
    const v = record.reported?.[hint];
    if (v) attrs[attr] = v;
  }
  return { values, attrs };
}
