// A vCenter for the discovery tests (design A §17), shaped after the vSphere Automation REST API of 7.0 U2 and 8.0:
// `POST /api/session` with basic credentials → a JSON string, then the `vmware-api-session-id` header (unknown or
// expired → 401); `GET /api/session`; `/api/vcenter/cluster`; `/api/vcenter/host` (filter `clusters`); `/api/vcenter/vm`
// (filters `hosts`, `clusters`; more than `cap` VMs → the API's "too many" error, so a client must split);
// `/api/vcenter/vm/{vm}` (8.0 `identity` with the BIOS UUID); `/vm/{vm}/guest/identity` (503 without running Tools);
// `/api/appliance/system/version`. Faults: a vCenter without `/api` (6.x), an HTTP status once per path (503, 429 with
// Retry-After), a slow VM list, a malformed VM (no id), expired sessions, a redirect to another host.
import { json } from "./harness";

export const VCENTER_HOST = "vc.mock.test";
export const VCENTER_URL = `https://${VCENTER_HOST}/`;
export const VCENTER_USER = "kariz@vsphere.local";
export const VCENTER_PASSWORD = "vc-secret-password";

export interface VcCluster {
  cluster: string;
  name: string;
}

export interface VcHost {
  host: string;
  name: string;
  connection_state: "CONNECTED" | "DISCONNECTED" | "NOT_RESPONDING";
  power_state?: "POWERED_ON" | "POWERED_OFF" | "STANDBY";
  cluster?: string;
}

export interface VcVm {
  vm: string;
  name: string;
  host: string;
  power_state: "POWERED_ON" | "POWERED_OFF" | "SUSPENDED";
  cpu_count: number;
  memory_size_MiB: number;
  bios_uuid?: string;
  guest_OS?: string;
  macs?: string[];
  disks_gb?: number[];
  guest?: { host_name?: string; ip_address?: string; full_name?: string };
  /** answered without its id (a malformed list row) */
  malformed?: boolean;
}

/** Two clusters with two hosts each, one standalone host, and `perHost` VMs on every host. */
export function makeVcenter(perHost = 2): { clusters: VcCluster[]; hosts: VcHost[]; vms: VcVm[] } {
  const clusters: VcCluster[] = [{ cluster: "domain-c8", name: "Prod" }, { cluster: "domain-c9", name: "Test" }];
  const hosts: VcHost[] = [
    { host: "host-11", name: "esx11.bank.local", connection_state: "CONNECTED", power_state: "POWERED_ON", cluster: "domain-c8" },
    { host: "host-12", name: "esx12.bank.local", connection_state: "CONNECTED", power_state: "POWERED_ON", cluster: "domain-c8" },
    { host: "host-21", name: "esx21.bank.local", connection_state: "CONNECTED", power_state: "POWERED_ON", cluster: "domain-c9" },
    { host: "host-22", name: "esx22.bank.local", connection_state: "CONNECTED", power_state: "POWERED_ON", cluster: "domain-c9" },
    { host: "host-31", name: "10.40.0.31", connection_state: "CONNECTED", power_state: "POWERED_ON" },
  ];
  const vms: VcVm[] = [];
  let n = 100;
  for (const h of hosts) {
    for (let i = 0; i < perHost; i++) {
      n++;
      const hex = n.toString(16).padStart(4, "0");
      vms.push({
        vm: `vm-${n}`, name: `app-${n}`, host: h.host, power_state: "POWERED_ON", cpu_count: 2, memory_size_MiB: 4096,
        bios_uuid: `4237${hex}-12b5-2b98-5e6c-5d3a0c8b${hex}`, guest_OS: "RHEL_8_64", macs: [`00:50:56:a1:${hex.slice(0, 2)}:${hex.slice(2)}`], disks_gb: [40, 100],
        guest: { host_name: `app-${n}.bank.local`, ip_address: `10.41.${n >> 8}.${n & 255}`, full_name: "Red Hat Enterprise Linux 8 (64-bit)" },
      });
    }
  }
  return { clusters, hosts, vms };
}

export class VcenterMock {
  user = VCENTER_USER;
  password = VCENTER_PASSWORD;
  clusters: VcCluster[];
  hosts: VcHost[];
  vms: VcVm[];
  /** the most VMs one list answers (the API's cap) */
  cap = 4000;
  /** a vCenter older than 7.0 U2: no /api */
  legacy = false;
  sessions = new Set<string>();
  logins = 0;
  /** every GET: path with its query */
  gets: string[] = [];
  /** answer the next request whose path starts with this once with this HTTP status */
  failOnce = new Map<string, number>();
  slowMs = 0;
  redirectTo: string | null = null;

  constructor(data: { clusters: VcCluster[]; hosts: VcHost[]; vms: VcVm[] }) {
    this.clusters = data.clusters;
    this.hosts = data.hosts;
    this.vms = data.vms;
  }

  /** Forget every session (vCenter restarted, or they idled out). */
  expireSessions(): void {
    this.sessions.clear();
  }

  /** The detail reads (`/api/vcenter/vm/{id}`) so far. */
  detailReads(): string[] {
    return this.gets.filter((g) => /^\/api\/vcenter\/vm\/[^/?]+$/.test(g));
  }

  private error(status: number, type: string, message: string): Response {
    return json({ error_type: type, messages: [{ id: `vapi.${type.toLowerCase()}`, default_message: message, args: [] }] }, status);
  }

  handler = async (req: Request): Promise<Response> => {
    if (this.redirectTo) return new Response(null, { status: 302, headers: { location: this.redirectTo } });
    const u = new URL(req.url);
    const path = u.pathname;
    if (this.legacy && path.startsWith("/api/")) return this.error(404, "NOT_FOUND", "Not found.");
    for (const [prefix, status] of this.failOnce) {
      if (path.startsWith(prefix)) {
        this.failOnce.delete(prefix);
        return json({ error_type: "SERVICE_UNAVAILABLE" }, status, status === 429 ? { "retry-after": "5" } : {});
      }
    }
    if (req.method === "POST" && path === "/api/session") {
      const m = /^Basic (.+)$/.exec(req.headers.get("authorization") ?? "");
      const [user, password] = m ? Buffer.from(m[1], "base64").toString("utf8").split(/:(.*)/s) : ["", ""];
      if (user !== this.user || password !== this.password) return this.error(401, "UNAUTHENTICATED", "Authentication required.");
      const token = `sess-${++this.logins}-${Math.random().toString(16).slice(2)}`;
      this.sessions.add(token);
      return json(token, 201);
    }
    if (req.method !== "GET") return this.error(400, "INVALID_ARGUMENT", "Unsupported method.");
    if (!this.sessions.has(req.headers.get("vmware-api-session-id") ?? "")) return this.error(401, "UNAUTHENTICATED", "Authentication required.");
    this.gets.push(`${path}${u.search}`);
    const q = u.searchParams;
    if (path === "/api/session") return json({ user: this.user.toUpperCase(), created_time: new Date().toISOString(), last_accessed_time: new Date().toISOString() });
    if (path === "/api/appliance/system/version") return json({ version: "8.0.2.00300", build: "22617221", type: "vCenter Server" });
    if (path === "/api/vcenter/cluster") return json(this.clusters.map((k) => ({ cluster: k.cluster, name: k.name, ha_enabled: true, drs_enabled: true })));
    if (path === "/api/vcenter/host") {
      const want = q.getAll("clusters");
      const rows = this.hosts.filter((h) => !want.length || (h.cluster && want.includes(h.cluster)));
      return json(rows.map((h) => ({ host: h.host, name: h.name, connection_state: h.connection_state, ...(h.connection_state === "CONNECTED" ? { power_state: h.power_state ?? "POWERED_ON" } : {}) })));
    }
    if (path === "/api/vcenter/vm") {
      if (this.slowMs) await new Promise((r) => setTimeout(r, this.slowMs));
      const hosts = q.getAll("hosts");
      const clusters = q.getAll("clusters");
      const rows = this.vms
        .filter((v) => !hosts.length || hosts.includes(v.host))
        .filter((v) => !clusters.length || clusters.includes(this.hosts.find((h) => h.host === v.host)?.cluster ?? ""))
        .map((v) => ({ ...(v.malformed ? {} : { vm: v.vm }), name: v.name, power_state: v.power_state, cpu_count: v.cpu_count, memory_size_MiB: v.memory_size_MiB }));
      return this.capped(rows);
    }
    const guest = /^\/api\/vcenter\/vm\/([^/]+)\/guest\/identity$/.exec(path);
    if (guest) {
      const v = this.vms.find((x) => x.vm === guest[1]);
      if (!v) return this.error(404, "NOT_FOUND", "VM not found.");
      if (v.power_state !== "POWERED_ON" || !v.guest) return this.error(503, "SERVICE_UNAVAILABLE", "VMware Tools is not running.");
      return json({ host_name: v.guest.host_name, ip_address: v.guest.ip_address, name: v.guest_OS, family: "LINUX", full_name: { default_message: v.guest.full_name, id: "x", args: [] } });
    }
    const one = /^\/api\/vcenter\/vm\/([^/]+)$/.exec(path);
    if (one) {
      const v = this.vms.find((x) => x.vm === one[1]);
      if (!v) return this.error(404, "NOT_FOUND", "VM not found.");
      return json({
        name: v.name, power_state: v.power_state, guest_OS: v.guest_OS, cpu: { count: v.cpu_count }, memory: { size_MiB: v.memory_size_MiB },
        ...(v.bios_uuid ? { identity: { bios_uuid: v.bios_uuid, instance_uuid: `50${v.bios_uuid.slice(2)}`, name: v.name } } : {}),
        nics: Object.fromEntries((v.macs ?? []).map((m, i) => [String(4000 + i), { mac_address: m, label: `Network adapter ${i + 1}` }])),
        disks: Object.fromEntries((v.disks_gb ?? []).map((g, i) => [String(2000 + i), { capacity: g * 2 ** 30, label: `Hard disk ${i + 1}` }])),
      });
    }
    return this.error(404, "NOT_FOUND", "Not found.");
  };

  private capped(rows: unknown[]): Response {
    if (rows.length > this.cap) return this.error(400, "UNABLE_TO_ALLOCATE_RESOURCE", `Too many results to return; the limit is ${this.cap}.`);
    return json(rows);
  }
}
