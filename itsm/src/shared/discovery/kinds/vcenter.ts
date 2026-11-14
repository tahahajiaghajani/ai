// The «VMware vCenter» kind (design A §2.1, §6.1, §7.6, §9.2, §10): the Automation REST API of vCenter 7.0 U2 and later
// (`/api`), a session from `POST /api/session` with the user and password, then the `vmware-api-session-id` header.
// Lists have no paging and are capped, so a pass is split: clusters, the hosts of each cluster (and the standalone
// hosts), then the VMs of each host — which also gives every VM its `runs_on` host. VM lists carry no change time:
// details are read for new VMs, for VMs whose cheap list fields changed (name, power, CPU, memory), and for a rolling
// share of the rest (each VM once per `detail_days`). Availability: a host's connection (disconnected or not
// responding → unreachable); a powered-off or suspended VM is «خاموش», never down. Contact is "now" while a VM is
// powered on and its host connected, or while a host is connected. Pure rules below, shared.
// Imported by the UI: keep it free of server imports.
import type { DiscoveredStatus } from "../types";
import { describeKind } from "./base";

export const vcenter = describeKind({
  kind: "vcenter",
  label: "VMware vCenter",
  icon: "server-cog",
  category: "virtualisation",
  ready: true,
  editions: ["cloud", "server", "relay"],
  auth: ["session"],
  collects: ["inventory", "status"],
  contact: { lag_days: 0 },
  availability: true,
  priority: 40,
  options: [
    { key: "clusters", label: "خوشه‌ها", type: "tags", help: "فقط این خوشه‌ها؛ خالی یعنی همهٔ خوشه‌ها و میزبان‌های تنها" },
    { key: "detail_days", label: "بازخوانی جزئیات هر ماشین (روز)", type: "int", default: 7, help: "جزئیات ماشین تازه یا تغییرکرده همان دم خوانده می‌شود؛ بقیه به نوبت در این چند روز" },
    { key: "instance_uuid", label: "شناسهٔ نمونهٔ vCenter برای پیوندها", type: "string", ltr: true, help: "instanceUuid خود vCenter؛ با آن، هر مورد به صفحه‌اش در vSphere Client پیوند می‌خورد" },
  ],
  permission_note: "کاربری با نقش فقط‌خواندنی (Read-only) در سطح vCenter که به همهٔ فرزندان می‌رسد؛ vCenter ۷٫۰ U2 یا تازه‌تر",
});

/** A host's monitor status: its connection to vCenter (§9.2), then its power. */
export function vcenterHostStatus(connection: unknown, power?: unknown): DiscoveredStatus {
  const c = String(connection ?? "").toUpperCase();
  const p = String(power ?? "").toUpperCase();
  if (c === "DISCONNECTED") return { state: "unreachable", availability: true, message: "میزبان از vCenter جدا شده است" };
  if (c === "NOT_RESPONDING") return { state: "unreachable", availability: true, message: "میزبان به vCenter پاسخ نمی‌دهد" };
  if (c !== "CONNECTED") return { state: "unknown" };
  if (p === "POWERED_OFF") return { state: "off", message: "میزبان خاموش است" };
  if (p === "STANDBY") return { state: "off", message: "میزبان در حالت آماده‌باش است" };
  return { state: "up" };
}

/** A VM's monitor status: its power (off and suspended are «خاموش», never down); unknown while its host is cut off. */
export function vcenterVmStatus(power: unknown, hostConnected: boolean): DiscoveredStatus {
  if (!hostConnected) return { state: "unknown", message: "میزبان این ماشین مجازی به vCenter پاسخ نمی‌دهد" };
  const p = String(power ?? "").toUpperCase();
  if (p === "POWERED_ON") return { state: "up" };
  if (p === "POWERED_OFF") return { state: "off", message: "ماشین مجازی خاموش است" };
  if (p === "SUSPENDED") return { state: "off", message: "ماشین مجازی معلق است" };
  return { state: "unknown" };
}

/** The serial number VMware gives a VM: `VMware-` and the BIOS UUID's 16 bytes in pairs (null when it is not a UUID). */
export function vmwareSerial(biosUuid: unknown): string | null {
  const hex = String(biosUuid ?? "").replace(/[{}-]/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex) || /^0+$/.test(hex)) return null;
  const pairs = hex.match(/../g)!;
  return `VMware-${pairs.slice(0, 8).join(" ")}-${pairs.slice(8).join(" ")}`;
}

/**
 * Is a VM's rolling detail refresh due (§7.6)? Each VM has its own slot in every `days`-long period; it is due when its
 * latest slot fell after the pass that last listed it, so every VM is re-read once per period and a day's share is
 * about 1/`days` of them — without any stored time but the listing.
 */
export function detailDue(externalId: string, listedAt: string | null | undefined, now: Date, days: number): boolean {
  const at = listedAt ? Date.parse(listedAt) : NaN;
  if (!Number.isFinite(at)) return true;
  const period = Math.max(1, days) * 86_400_000;
  let h = 2166136261;
  for (let i = 0; i < externalId.length; i++) h = Math.imul(h ^ externalId.charCodeAt(i), 16777619) >>> 0;
  const offset = h % period;
  const t = now.getTime();
  const slot = Math.floor((t - offset) / period) * period + offset;
  return at < slot;
}
