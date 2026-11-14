// Availability per kind (design A §9.2): what a tool's facts say about the machine itself. A problem or an alert is a
// «هشدار» unless the kind's rule says the machine is down — a full disk is not an outage, a powered-off VM is «خاموش»
// and never «قطع». Pure code, one function per kept kind of release 1.1 (Zabbix, PRTG, vCenter; REST, feed and push
// records; the event sink's alerts); the connectors (DA3a) and the status code call these and nothing else decides.
// Imported by the UI: keep it free of server imports.
import type { DiscoveredStatus, StatusState } from "./types";

/** Kinds whose `off` explains a monitor's down or unreachable (§9.3). */
export const VIRTUALISATION_KINDS: ReadonlySet<string> = new Set(["vcenter"]);

/** The tag a trigger or alert carries when it means the machine is down (Zabbix `scope: availability`). */
export const AVAILABILITY_TAG = "scope=availability";

/** Checks that test the machine itself: ICMP, the Zabbix agent, a PRTG Ping sensor, a Nagios/Icinga host check. */
const AVAILABILITY_CHECK = /^(icmpping(sec|loss)?(\[.*\])?|agent\.ping(\[.*\])?|zabbix\[host,agent,available\]|ping|ping v2|host( check)?|check-host-alive|hostalive)$/i;

const tagWords = (tags: unknown): string[] =>
  (Array.isArray(tags) ? tags : []).map((t) => (t && typeof t === "object" ? `${(t as { tag?: unknown }).tag ?? ""}=${(t as { value?: unknown }).value ?? ""}` : String(t ?? ""))).map((t) => t.trim().toLowerCase().replace(/\s*[:=]\s*/, "="));

/** Do these tags mark an availability problem (`scope=availability`, `scope: availability`, {tag, value})? */
export function hasAvailabilityTag(tags: unknown): boolean {
  return tagWords(tags).includes(AVAILABILITY_TAG);
}

/** Is a metric or resource name an availability check (icmpping, agent.ping, a Ping sensor, a host check)? */
export function isAvailabilityCheck(name: string | null | undefined): boolean {
  return !!name && AVAILABILITY_CHECK.test(name.trim());
}

// ---------------------------------------------------------------------------------------------------------------
// Zabbix

/** Zabbix severities 0 «Not classified» and 1 «Information» never make a host «هشدار». */
export function zabbixWarns(severity: number | string | null | undefined): boolean {
  const n = Number(severity);
  if (Number.isFinite(n) && String(severity).trim() !== "") return n >= 2;
  return !/^(not classified|information|info)$/i.test(String(severity ?? "").trim());
}

export interface ZabbixHostFacts {
  /** `maintenance_status = 1` */
  maintenance?: boolean;
  /** the last value of the host's `icmpping` item; null or absent when it has none */
  icmp?: number | null;
  /** the agent interface's `available` (0 unknown, 1 available, 2 unavailable); null or absent without one */
  agent?: number | null;
  /** the last value of `agent.ping`, when the host has the item */
  agentPing?: number | null;
  /** the host's open problems */
  problems?: { severity: number | string; tags?: unknown; name?: string; availability?: boolean }[];
  since?: string;
}

/** A Zabbix host's state: ICMP decides down; the agent alone unreachable; open problems warn (§9.2). */
export function zabbixStatus(f: ZabbixHostFacts): DiscoveredStatus {
  const since = f.since ? { since: f.since } : {};
  if (f.maintenance) return { state: "maintenance", ...since, message: "در دورهٔ نگهداری Zabbix" };
  if (f.icmp === 0) return { state: "down", availability: true, ...since, message: "پاسخی به ping نمی‌دهد" };
  const down = (f.problems ?? []).find((p) => p.availability || hasAvailabilityTag(p.tags));
  if (down) return { state: "down", availability: true, ...since, message: down.name ?? "مشکل دسترس‌پذیری" };
  const agentDown = f.agent === 2 || f.agentPing === 0;
  const noIcmp = f.icmp === null || f.icmp === undefined;
  if (agentDown && noIcmp) return { state: "unreachable", availability: true, ...since, message: "عامل Zabbix پاسخ نمی‌دهد" };
  const warn = (f.problems ?? []).find((p) => zabbixWarns(p.severity));
  if (agentDown) return { state: "warning", ...since, message: "عامل Zabbix پاسخ نمی‌دهد؛ ping برقرار است" };
  if (warn) return { state: "warning", ...since, message: warn.name ?? "مشکل باز در Zabbix" };
  return { state: "up", ...since };
}

// ---------------------------------------------------------------------------------------------------------------
// PRTG (status_raw of a sensor)

export const PRTG_STATUS = { up: 3, warning: 4, down: 5, pausedByDependency: 8, unusual: 10, downAcknowledged: 13, downPartial: 14 } as const;
const PRTG_PAUSED = new Set([7, 9, 12]);
const PRTG_DOWN = new Set([5, 13]);
const PRTG_WARN = new Set([4, 5, 10, 13, 14]);

export interface PrtgSensorFacts {
  id?: string | number;
  name?: string;
  /** the sensor's type («ping») */
  type?: string;
  status_raw: number;
  message?: string;
}

/**
 * A PRTG device's state from its sensors (the device's own status is unreliable): the Ping sensor — or the
 * connector's `options.primary_sensor` — decides down (5, 13), unreachable (8: paused because its parent is down)
 * and maintenance (7, 9, 12: paused); any other sensor down or warning, and «down partial» (14), warn.
 */
export function prtgStatus(sensors: PrtgSensorFacts[], opts: { primary_sensor?: string | number | null } = {}): DiscoveredStatus {
  if (!sensors.length) return { state: "unknown" };
  const want = opts.primary_sensor === null || opts.primary_sensor === undefined ? "" : String(opts.primary_sensor).trim().toLowerCase();
  const primary = want
    ? sensors.find((s) => String(s.id ?? "").toLowerCase() === want || String(s.name ?? "").trim().toLowerCase() === want)
    : sensors.find((s) => /^ping\b/i.test(String(s.type ?? "")) || /^ping\b/i.test(String(s.name ?? "")));
  const raw = (s: PrtgSensorFacts | undefined) => Number(s?.status_raw);
  if (primary) {
    if (PRTG_PAUSED.has(raw(primary))) return { state: "maintenance", message: "حسگر اصلی PRTG مکث شده است" };
    if (PRTG_DOWN.has(raw(primary))) return { state: "down", availability: true, message: primary.message || "حسگر Ping در PRTG قطع است" };
    if (raw(primary) === PRTG_STATUS.pausedByDependency) return { state: "unreachable", availability: true, message: "والد این دستگاه در PRTG قطع است" };
  }
  const warn = sensors.find((s) => s !== primary && PRTG_WARN.has(raw(s))) ?? (primary && PRTG_WARN.has(raw(primary)) ? primary : undefined);
  if (warn) return { state: "warning", message: warn.message || `حسگر «${warn.name ?? warn.id ?? ""}» در PRTG هشدار دارد` };
  if (primary ? raw(primary) === PRTG_STATUS.up : sensors.every((s) => raw(s) === PRTG_STATUS.up)) return { state: "up" };
  return { state: "unknown" };
}

// ---------------------------------------------------------------------------------------------------------------
// vCenter

export interface VcenterFacts {
  type: "vm" | "host";
  /** POWERED_ON, POWERED_OFF, SUSPENDED (VMs); hosts may report STANDBY */
  power_state?: string | null;
  /** CONNECTED, DISCONNECTED, NOT_RESPONDING (hosts) */
  connection_state?: string | null;
  /** a host in maintenance mode */
  maintenance?: boolean;
}

/** vCenter: a powered-off or suspended VM is «خاموش», never down; a host that vCenter lost is unreachable (§9.2). */
export function vcenterStatus(f: VcenterFacts): DiscoveredStatus {
  const power = String(f.power_state ?? "").toUpperCase();
  if (f.type === "host") {
    if (f.maintenance) return { state: "maintenance", message: "میزبان در حالت نگهداری vCenter است" };
    const conn = String(f.connection_state ?? "").toUpperCase();
    if (conn === "DISCONNECTED" || conn === "NOT_RESPONDING") return { state: "unreachable", availability: true, message: "vCenter با این میزبان ارتباط ندارد" };
    if (power === "POWERED_OFF" || power === "STANDBY") return { state: "off", message: "میزبان خاموش است" };
    return conn === "CONNECTED" || power === "POWERED_ON" ? { state: "up" } : { state: "unknown" };
  }
  if (power === "POWERED_OFF" || power === "SUSPENDED") return { state: "off", message: power === "SUSPENDED" ? "ماشین مجازی معلق است" : "ماشین مجازی خاموش است" };
  return power === "POWERED_ON" ? { state: "up" } : { state: "unknown" };
}

// ---------------------------------------------------------------------------------------------------------------
// REST, feed, push (and sql_view, the demo kind): the record says

/**
 * A record's own status: down and unreachable only when the record says the machine itself is unavailable
 * (`status.availability = true`, or a mapping that marks a column as availability); any other not-up state is a
 * warning; maintenance, off, up and unknown as given.
 */
export function recordState(s: Pick<DiscoveredStatus, "state" | "availability"> | null | undefined): StatusState | null {
  if (!s?.state) return null;
  if (s.state === "down" || s.state === "unreachable") return s.availability ? s.state : "warning";
  return s.state;
}

// ---------------------------------------------------------------------------------------------------------------
// The event sink (§9.7): status from pushed alerts

export interface AlertFacts {
  status: string | null | undefined;
  severity?: string | null;
  metric?: string | null;
  resource?: string | null;
  tags?: unknown;
  message?: string | null;
}

/**
 * Does an alert mean the machine itself is down: its tags carry `scope=availability`, its metric or resource is an
 * availability check, or it matches the linked connector's `options.availability_match` (a pattern over metric,
 * resource and message)?
 */
export function isAvailabilityAlert(a: AlertFacts, match?: string | null): boolean {
  if (hasAvailabilityTag(a.tags) || isAvailabilityCheck(a.metric) || isAvailabilityCheck(a.resource)) return true;
  if (typeof match !== "string" || !match.trim() || match.length > 300) return false;
  let re: RegExp;
  try {
    re = new RegExp(match, "iu");
  } catch {
    return false;
  }
  return [a.metric, a.resource, a.message].some((x) => typeof x === "string" && re.test(x.slice(0, 2000)));
}

/** The signal an alert gives its CI: down (availability), warning (any other firing alert but `info`), or none. */
export function alertSignal(a: AlertFacts, match?: string | null): "down" | "warning" | null {
  if (String(a.status ?? "").toLowerCase() === "resolved") return null;
  if (isAvailabilityAlert(a, match)) return "down";
  return String(a.severity ?? "").toLowerCase() === "info" ? null : "warning";
}
