// Availability (design A §9.2): what a tool's facts say about the machine itself. A problem or an alert is a «هشدار»
// unless the kind's rule says the machine is down — a full disk is not an outage, a powered-off VM is «خاموش» and never
// «قطع». Each monitoring kind keeps its rule with its other facts, and nothing else decides for it:
//   · Zabbix: kinds/zabbix.ts `zabbixAvailability` (ICMP, the agent and SNMP interfaces, `scope: availability`
//     triggers, severities from «Warning» up, maintenance);
//   · PRTG: kinds/prtg.ts `prtgAvailability` (the Ping or primary sensor's status_raw, paused states, other sensors);
//   · vCenter: kinds/vcenter.ts `vcenterHostStatus` and `vcenterVmStatus` (a host's connection, then power; a VM's
//     power — off and suspended are «خاموش»). The REST host list the connector reads carries no maintenance mode: a
//     host's maintenance comes from event management's windows and implementing changes (the aggregation, §9.3).
// This file holds the rest: the records' own status (REST, feed, push; `recordState`) and the event sink's alerts
// (§9.7). Pure code, imported by the UI: keep it free of server imports.
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
