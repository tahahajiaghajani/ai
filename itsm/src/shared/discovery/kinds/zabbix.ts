// The «Zabbix» kind (design A §2.1, §6.1, §9.2, §10): JSON-RPC 2.0 at `api_jsonrpc.php` with an API token (Zabbix 5.4+;
// the `Authorization: Bearer` header from 6.4, the request's `auth` member before it). Hosts are listed by id (light),
// then read in chunks of ≤ 500 sorted ids with their interfaces, inventory (`serialno_a`), groups, templates and tags.
// Availability comes from the ICMP and agent items, the monitoring interfaces and the open problems whose trigger
// carries `scope: availability`; every other open problem is a warning. The last contact is the `lastclock` of an
// availability item that answered. The rules below are pure and shared (the connector and the docs' table use them).
// Imported by the UI: keep it free of server imports.
import type { DiscoveredStatus } from "../types";
import { describeKind } from "./base";

export const zabbix = describeKind({
  kind: "zabbix",
  label: "Zabbix",
  icon: "activity",
  category: "monitoring",
  ready: true,
  editions: ["cloud", "server", "relay"],
  auth: ["token"],
  collects: ["inventory", "status", "problems"],
  contact: { lag_days: 0 },
  availability: true,
  priority: 70,
  options: [
    { key: "host_groups", label: "گروه‌های میزبان", type: "tags", help: "فقط میزبان‌های این گروه‌ها؛ خالی یعنی همهٔ میزبان‌هایی که کاربر API می‌بیند" },
    { key: "tags", label: "برچسب‌های میزبان", type: "tags", ltr: true, help: "مانند env=prod یا role؛ میزبانی که یکی از این برچسب‌ها را دارد" },
    { key: "class_map", label: "کلاس بر پایهٔ گروه یا الگو", type: "json", help: "نام گروه میزبان یا الگو ← کلاس پیکربندی، مانند { \"Linux servers\": \"server\" }" },
    { key: "chunk_size", label: "میزبان در هر درخواست", type: "int", default: 500, help: "حداکثر ۵۰۰" },
    { key: "frontend_url", label: "نشانی رابط وب برای پیوندها", type: "string", ltr: true, help: "خالی یعنی همان نشانی منبع؛ میزبان دیگر باید در «میزبان‌های مجاز دیگر» باشد" },
  ],
  permission_note: "کلید API (Zabbix ۵٫۴ یا تازه‌تر) برای کاربری با نقش فقط‌خواندنی که به گروه‌های میزبان لازم دسترسی خواندن دارد",
});

/** Zabbix severities (0 not classified … 5 disaster) as the event module's words. */
export const ZABBIX_SEVERITY = ["info", "info", "warning", "minor", "major", "critical"] as const;

export function zabbixSeverity(raw: unknown): string {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 5 ? ZABBIX_SEVERITY[n] : "minor";
}

/** Which availability check an item key is: ICMP ping, or the agent (and SNMP) availability; null for others. */
export function availabilityItem(key: unknown): "icmp" | "agent" | null {
  const k = String(key ?? "").trim();
  if (k === "icmpping" || k.startsWith("icmpping[")) return "icmp";
  if (k === "agent.ping" || k.startsWith("agent.ping[") || k === "zabbix[host,agent,available]" || k === "zabbix[host,snmp,available]") return "agent";
  return null;
}

/**
 * Is a trigger on the agent's (or SNMP's) own availability checks only, like the templates' «Zabbix agent is not
 * available» (agent.ping, zabbix[host,agent|active_agent|snmp,available])? It says the agent is away, not the machine.
 */
export function agentTrigger(keys: unknown[] | null | undefined): boolean {
  const k = (keys ?? []).map((x) => String(x ?? "").trim());
  return k.length > 0 && k.every((x) => availabilityItem(x) === "agent" || x === "zabbix[host,active_agent,available]");
}

/** Does a problem's tag set mark an availability trigger (`scope: availability`, as Zabbix 6.0+ templates tag them)? */
export function isAvailabilityProblem(tags: { tag?: unknown; value?: unknown }[] | null | undefined): boolean {
  return (tags ?? []).some((t) => String(t?.tag ?? "").trim().toLowerCase() === "scope" && String(t?.value ?? "").trim().toLowerCase() === "availability");
}

export interface ZabbixCheck {
  /** the item's last value ("1" answered, "0" did not); null before its first poll */
  value: string | null;
  /** the item's last poll (epoch seconds) */
  clock: number;
}

export interface ZabbixAvailabilityInput {
  /** host.status: 0 monitored, 1 not monitored */
  status: number;
  /** maintenance_status = 1 */
  maintenance: boolean;
  icmp: ZabbixCheck[];
  agent: ZabbixCheck[];
  /** monitoring interfaces: type 1 agent, 2 SNMP, 3 IPMI, 4 JMX; available 0 unknown, 1 available, 2 unavailable */
  interfaces: { type: number; available: number }[];
  /** open problems of the host (severity 0–5); `agent`: the trigger is on the agent's own checks (agentTrigger) */
  problems: { severity: number; availability: boolean; name: string; since?: number; agent?: boolean }[];
}

const iso = (clock: number | undefined): string | undefined => (clock && clock > 0 ? new Date(clock * 1000).toISOString() : undefined);

/**
 * A host's monitor status by the Zabbix rule (§9.2): ICMP ping 0 → down; an open availability problem → down; the agent
 * (or SNMP) unavailable → unreachable when no ICMP check answered, else a warning; any other open problem from
 * «Warning» up → warning (Information and Not classified are not); maintenance → in maintenance. The agent's own
 * trigger is the agent rule, not an outage, though the stock templates tag it `scope: availability`: an active agent's
 * agent.ping keeps its last «1», so the trigger is then the only sign.
 */
export function zabbixAvailability(x: ZabbixAvailabilityInput): DiscoveredStatus {
  if (x.status === 1) return { state: "unknown", message: "پایش این میزبان در Zabbix خاموش است" };
  if (x.maintenance) return { state: "maintenance", message: "در دورهٔ نگهداری Zabbix" };
  if (x.icmp.some((c) => c.value === "0")) return { state: "down", availability: true, message: "به پینگ ICMP پاسخ نمی‌دهد" };
  const outage = x.problems.filter((p) => p.availability && !p.agent).sort((a, b) => b.severity - a.severity)[0];
  if (outage) return { state: "down", availability: true, message: outage.name, ...(iso(outage.since) ? { since: iso(outage.since) } : {}) };
  const icmpUp = x.icmp.some((c) => c.value === "1");
  const agentDown =
    x.agent.some((c) => c.value === "0") || x.interfaces.some((i) => (i.type === 1 || i.type === 2) && i.available === 2) || x.problems.some((p) => p.agent);
  if (agentDown && !icmpUp) return { state: "unreachable", availability: true, message: "عامل Zabbix یا SNMP میزبان پاسخ نمی‌دهد" };
  if (agentDown) return { state: "warning", message: "میزبان به پینگ پاسخ می‌دهد ولی عامل Zabbix پاسخ نمی‌دهد" };
  const worst = x.problems.filter((p) => p.severity >= 2).sort((a, b) => b.severity - a.severity)[0];
  if (worst) return { state: "warning", message: worst.name, ...(iso(worst.since) ? { since: iso(worst.since) } : {}) };
  if (icmpUp || x.agent.some((c) => c.value === "1") || x.interfaces.some((i) => i.available === 1)) return { state: "up" };
  return { state: "unknown", message: "Zabbix هنوز از این میزبان دادهٔ دسترس‌پذیری ندارد" };
}

/** The tool's last contact with a host (§10): the latest poll of an availability item that answered. */
export function zabbixContact(checks: ZabbixCheck[]): string | undefined {
  const up = checks.filter((c) => c.value === "1" && c.clock > 0).map((c) => c.clock);
  return up.length ? iso(Math.max(...up)) : undefined;
}
