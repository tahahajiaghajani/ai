// The «VMware vCenter» kind (design A §2.1, §6.1, §7.6, §9.2, §10): the Automation REST API of vCenter 7.0 U2 and later.
// `POST /api/session` with the user and password gives a session, sent as `vmware-api-session-id` and kept in this
// process for 20 idle minutes (vCenter limits sessions; an expired one is replaced once). Lists have no paging and are
// capped, so a pass is split: the clusters (those named in `clusters`, else all), the hosts of each cluster (and, without
// a cluster filter, the standalone hosts) on the first page, then the VMs of one host after another — which gives each
// VM its `runs_on` host. A page stops at about 500 VMs or at the slice's end and resumes inside the host. VM lists
// carry no change time: details (`/vm/{id}`, and the guest identity of a powered-on VM) are read for new VMs, for VMs
// whose list fields changed (name, power, CPU, memory), and for each VM once per `detail_days` (§7.6); the rest keep
// what the connector stored (ConnCtx.known). The rules are pure, in @shared/discovery/kinds/vcenter.
import { createHash } from "node:crypto";
import { z } from "zod";
import { detailDue, vcenter as descriptor, vcenterHostStatus, vcenterVmStatus, vmwareSerial } from "@shared/discovery/kinds/vcenter";
import { normaliseHost, normaliseIp } from "@shared/discovery/normalise";
import type { Cursor, DiscoveredRecord, Page, StatusPage, TestResult } from "@shared/discovery/types";
import { ConnectorError, CONNECTOR_MESSAGES, type ConnCtx, type ConnectorKind, type KnownItem } from "../kind";

/** The kind's own documented messages (the docs' troubleshooting table lists each). */
export const VCENTER_MESSAGES = {
  noApi: "این نشانی رابط /api ندارد؛ vCenter ۷٫۰ U2 یا تازه‌تر لازم است، یا نشانی vCenter را درست وارد کنید",
  noSession: "vCenter نشستی نداد؛ نشانی vCenter را بررسی کنید",
  noCluster: (names: string[]) => `خوشهٔ ${names.map((n) => `«${n}»`).join("، ")} در vCenter پیدا نشد؛ نام خوشه را در تنظیمات اصلاح کنید`,
  noHosts: "vCenter هیچ میزبانی برنگرداند؛ دسترسی خواندن کاربر را در سطح vCenter بررسی کنید",
  noVmId: "ماشین مجازی بی‌شناسه از vCenter رسید و کنار گذاشته شد",
  noLinks: "برای پیوند مستقیم به vSphere Client، شناسهٔ نمونهٔ vCenter را در تنظیمات وارد کنید",
} as const;

const NAME = z.string().trim().min(1).max(200);
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const vcenterOptions = z.object({
  clusters: z.array(NAME).max(200).default([]),
  detail_days: z.coerce.number().int().min(1).max(30).default(7),
  instance_uuid: z.string().trim().refine((v) => v === "" || UUID.test(v), { message: "شناسهٔ نمونه باید یک UUID باشد" }).default(""),
});
export type VcenterOptions = z.infer<typeof vcenterOptions>;

/** VMs a page gathers before it ends (it always finishes the VM it is on). */
const VMS_PER_PAGE = 500;
/** How long before the slice's end a page stops reading details. */
const DETAIL_MARGIN_MS = 500;

// ---------------------------------------------------------------------------------------------------------------
// The session

const SESSION_HEADER = "vmware-api-session-id";
const IDLE_MS = 20 * 60_000;
const sessions = new Map<string, { token: string; used: number }>();

/** Sessions are per connector, address, user and password: a changed key never reuses an old session. */
function sessionKey(c: ConnCtx): string {
  return `${c.connector.id}|${createHash("sha256").update(`${c.connector.base_url}\n${c.connector.username ?? ""}\n${c.secret ?? ""}`).digest("hex")}`;
}

/** Forget every kept session (tests). */
export function resetVcenterSessions(): void {
  sessions.clear();
}

async function login(c: ConnCtx): Promise<string> {
  if (!c.secret) throw new ConnectorError("config", CONNECTOR_MESSAGES.reenterKey);
  const basic = Buffer.from(`${c.connector.username ?? ""}:${c.secret}`, "utf8").toString("base64");
  let body: unknown;
  try {
    body = (await c.fetchJson<unknown>("api/session", { method: "POST", headers: { Authorization: `Basic ${basic}` } })).body;
  } catch (e) {
    if (e instanceof ConnectorError && e.status === 404) throw new ConnectorError("config", VCENTER_MESSAGES.noApi);
    throw e;
  }
  if (typeof body !== "string" || !body.trim()) throw new ConnectorError("bad_response", VCENTER_MESSAGES.noSession);
  return body.trim();
}

/** A GET with the kept session; an expired session (401) is replaced once. */
async function get<T>(c: ConnCtx, path: string, query?: Record<string, string>): Promise<T> {
  const key = sessionKey(c);
  for (let attempt = 0; ; attempt++) {
    let s = sessions.get(key);
    const fresh = !s || Date.now() - s.used > IDLE_MS;
    if (fresh) {
      s = { token: await login(c), used: Date.now() };
      if (sessions.size >= 200) sessions.delete(sessions.keys().next().value as string);
      sessions.set(key, s);
    }
    try {
      const r = await c.fetchJson<T>(path, { query, headers: { [SESSION_HEADER]: s!.token } });
      s!.used = Date.now();
      return r.body;
    } catch (e) {
      if (e instanceof ConnectorError && e.code === "auth" && !fresh && attempt === 0) {
        sessions.delete(key);
        continue;
      }
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Clusters, hosts, VMs

interface ClusterRow {
  cluster: string;
  name: string;
}
interface HostRow {
  host: string;
  name: string;
  connection_state?: string;
  power_state?: string;
}
interface VmRow {
  vm: string;
  name: string;
  power_state?: string;
  cpu_count?: number;
  memory_size_MiB?: number;
}
interface VmInfo {
  guest_OS?: string;
  identity?: { bios_uuid?: string; instance_uuid?: string };
  nics?: Record<string, { mac_address?: string }>;
  disks?: Record<string, { capacity?: number }>;
}
interface GuestIdentity {
  host_name?: string;
  ip_address?: string;
  full_name?: { default_message?: string };
}

const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** One host of the pass (the cursor keeps them: their VMs are read one host after another). */
interface Unit {
  id: string;
  /** connected to vCenter (its VMs' power states are current) */
  on: boolean;
}

interface VcenterCursor {
  units: Unit[];
  /** the host being read */
  i: number;
  /** VMs of that host already on earlier pages (in VM-id order) */
  done: number;
}

/** The hosts in scope, each with its cluster's name: split by cluster (lists are capped, §2.1). */
async function hostsInScope(c: ConnCtx): Promise<{ host: HostRow; cluster?: string }[]> {
  const o = c.options as VcenterOptions;
  const clusters = list<ClusterRow>(await get(c, "api/vcenter/cluster"));
  let chosen = clusters;
  if (o.clusters.length) {
    const want = new Set(o.clusters.map((n) => n.toLowerCase()));
    chosen = clusters.filter((k) => want.has(String(k.name).toLowerCase()));
    const found = new Set(chosen.map((k) => String(k.name).toLowerCase()));
    const missing = o.clusters.filter((n) => !found.has(n.toLowerCase()));
    // a cluster renamed in vCenter must not make its machines look gone: the pass stops with what to fix
    if (missing.length) throw new ConnectorError("config", VCENTER_MESSAGES.noCluster(missing));
  }
  const out: { host: HostRow; cluster?: string }[] = [];
  const seen = new Set<string>();
  for (const k of chosen) {
    for (const h of list<HostRow>(await get(c, "api/vcenter/host", { clusters: k.cluster }))) {
      if (seen.has(h.host)) continue;
      seen.add(h.host);
      out.push({ host: h, cluster: k.name });
    }
  }
  if (!o.clusters.length) {
    // standalone hosts (in no cluster)
    for (const h of list<HostRow>(await get(c, "api/vcenter/host"))) {
      if (seen.has(h.host)) continue;
      seen.add(h.host);
      out.push({ host: h });
    }
  }
  return out.sort((a, b) => byId({ id: a.host.host }, { id: b.host.host }));
}

const connected = (h: HostRow) => String(h.connection_state ?? "").toUpperCase() === "CONNECTED";

function hostRecord(h: HostRow, cluster: string | undefined, now: Date): DiscoveredRecord {
  const ip = normaliseIp(h.name);
  const name = normaliseHost(h.name);
  return {
    external_id: h.host,
    kind: "host",
    name: String(h.name ?? h.host),
    ...(ip ? { ips: [ip] } : name ? { hostname: name } : {}),
    ...(cluster ? { attrs: { cluster } } : {}),
    ...(connected(h) ? { last_contact_at: now.toISOString() } : {}),
    status: vcenterHostStatus(h.connection_state, h.power_state),
  };
}

/** The fields a VM's details give (kept between passes while the cheap list fields stay the same). */
const DETAIL_FIELDS = ["bios_uuid", "serial_number", "macs", "disk_gb", "os", "hostname", "fqdn", "ips"] as const;

/** A VM's details; null when the VM went away between the list and the read. */
async function vmDetails(c: ConnCtx, vm: VmRow): Promise<Partial<DiscoveredRecord> | null> {
  let info: VmInfo;
  try {
    info = (await get<VmInfo>(c, `api/vcenter/vm/${encodeURIComponent(vm.vm)}`)) ?? {};
  } catch (e) {
    if (e instanceof ConnectorError && e.status === 404) return null;
    throw e;
  }
  const out: Partial<DiscoveredRecord> = {};
  const bios = info.identity?.bios_uuid;
  if (bios) {
    out.bios_uuid = bios;
    const serial = vmwareSerial(bios);
    if (serial) out.serial_number = serial;
  }
  const macs = Object.values(info.nics ?? {}).map((n) => n?.mac_address).filter((m): m is string => !!m);
  if (macs.length) out.macs = macs;
  const bytes = Object.values(info.disks ?? {}).reduce((s, d) => s + (Number(d?.capacity) || 0), 0);
  if (bytes > 0) out.disk_gb = Math.round(bytes / 2 ** 30);
  if (info.guest_OS) out.os = String(info.guest_OS);
  if (String(vm.power_state ?? "").toUpperCase() === "POWERED_ON") {
    // the guest's own name and address need VMware Tools running: without them the VM keeps its other details
    let guest: GuestIdentity | null = null;
    try {
      guest = await get<GuestIdentity>(c, `api/vcenter/vm/${encodeURIComponent(vm.vm)}/guest/identity`);
    } catch (e) {
      if (!(e instanceof ConnectorError) || e.code === "auth" || e.code === "refused" || e.code === "config") throw e;
    }
    if (guest?.full_name?.default_message) out.os = guest.full_name.default_message;
    const host = normaliseHost(guest?.host_name);
    if (host) {
      if (host.includes(".")) out.fqdn = host;
      out.hostname = host.split(".")[0];
    }
    const ip = normaliseIp(guest?.ip_address);
    if (ip) out.ips = [ip];
  }
  return out;
}

const vmState = (power: unknown, on: boolean) => vcenterVmStatus(power, on).state;

/** May a VM keep the details the connector stored? Same list fields, no renames in between, not due for its refresh. */
function reusable(prev: KnownItem | undefined, vm: VmRow, on: boolean, c: ConnCtx, now: Date): boolean {
  if (!prev || (prev.record as unknown as { _truncated?: boolean })._truncated) return false;
  // a connector's renames rewrite the stored record: details are then read every pass
  if (Object.keys(c.connector.mapping ?? {}).length) return false;
  const r = prev.record;
  if (r.name !== String(vm.name ?? vm.vm).trim().slice(0, 200) || r.cpu_count !== vm.cpu_count || r.ram_mb !== vm.memory_size_MiB) return false;
  if ((r.status?.state ?? null) !== vmState(vm.power_state, on)) return false;
  return !detailDue(vm.vm, prev.listed_at, now, (c.options as VcenterOptions).detail_days);
}

function vmRecord(vm: VmRow, unit: Unit, details: Partial<DiscoveredRecord>, now: Date): DiscoveredRecord {
  const status = vcenterVmStatus(vm.power_state, unit.on);
  return {
    external_id: vm.vm,
    kind: "vm",
    name: String(vm.name ?? vm.vm),
    ...(Number.isFinite(vm.cpu_count) ? { cpu_count: vm.cpu_count } : {}),
    ...(Number.isFinite(vm.memory_size_MiB) ? { ram_mb: vm.memory_size_MiB } : {}),
    ...details,
    parent_external_id: unit.id,
    ...(status.state === "up" ? { last_contact_at: now.toISOString() } : {}),
    status,
  };
}

const cursorOf = (cursor: Cursor | null): VcenterCursor | null =>
  cursor && typeof cursor === "object" && !Array.isArray(cursor) && Array.isArray((cursor as { units?: unknown }).units) ? (cursor as unknown as VcenterCursor) : null;

const vmsOf = async (c: ConnCtx, hostId: string) => list<VmRow>(await get(c, "api/vcenter/vm", { hosts: hostId })).sort((a, b) => byId({ id: a.vm }, { id: b.vm }));

async function page(c: ConnCtx, cursor: Cursor | null): Promise<Page> {
  const now = c.now();
  const cur = cursorOf(cursor);
  if (!cur) {
    // the first page: the hosts; the VMs follow host by host
    const hosts = await hostsInScope(c);
    const records = hosts.map((h) => hostRecord(h.host, h.cluster, now));
    const units = hosts.map((h) => ({ id: h.host.host, on: connected(h.host) }));
    return { records, raw: hosts.map((h) => h.host), next: units.length ? ({ units, i: 0, done: 0 } as unknown as Cursor) : null, complete: true };
  }
  const records: DiscoveredRecord[] = [];
  const raw: unknown[] = [];
  const rejected: { message: string }[] = [];
  let { i, done } = cur;
  // a page always makes progress; at about 500 VMs or past the slice's end it stops between VMs (inside a host too)
  const full = () => records.length >= VMS_PER_PAGE || (records.length > 0 && Date.now() >= c.deadline - DETAIL_MARGIN_MS);
  hosts: while (i < cur.units.length) {
    const unit = cur.units[i];
    const vms = (await vmsOf(c, unit.id)).slice(done);
    const known = c.known ? await c.known(vms.map((v) => v.vm)) : new Map<string, KnownItem>();
    for (const vm of vms) {
      if (full()) break hosts;
      done++;
      if (typeof vm?.vm !== "string" || !vm.vm) {
        rejected.push({ message: VCENTER_MESSAGES.noVmId });
        continue;
      }
      const prev = known.get(vm.vm);
      let details: Partial<DiscoveredRecord> | null = {};
      if (reusable(prev, vm, unit.on, c, now)) {
        for (const f of DETAIL_FIELDS) if ((prev!.record as unknown as Record<string, unknown>)[f] !== undefined) (details as Record<string, unknown>)[f] = (prev!.record as unknown as Record<string, unknown>)[f];
      } else details = await vmDetails(c, vm);
      // a VM removed between the list and its details is simply not listed
      if (!details) continue;
      records.push(vmRecord(vm, unit, details, now));
      raw.push(vm);
    }
    i++;
    done = 0;
    if (full()) break;
  }
  const next: Cursor = i < cur.units.length ? ({ units: cur.units, i, done } as unknown as Cursor) : null;
  return { records, raw, next, complete: true, ...(rejected.length ? { rejected } : {}) };
}

async function statusPage(c: ConnCtx, cursor: Cursor | null): Promise<StatusPage> {
  const now = c.now().toISOString();
  const cur = cursorOf(cursor);
  if (!cur) {
    const hosts = await hostsInScope(c);
    const items = hosts.map((h) => ({ external_id: h.host.host, status: vcenterHostStatus(h.host.connection_state, h.host.power_state), ...(connected(h.host) ? { last_contact_at: now } : {}) }));
    const units = hosts.map((h) => ({ id: h.host.host, on: connected(h.host) }));
    return { items, next: units.length ? ({ units, i: 0, done: 0 } as unknown as Cursor) : null };
  }
  const items: StatusPage["items"] = [];
  let i = cur.i;
  // status needs no details: whole hosts, a few at a time
  while (i < cur.units.length && items.length < VMS_PER_PAGE * 4) {
    const unit = cur.units[i];
    for (const vm of await vmsOf(c, unit.id)) {
      if (typeof vm?.vm !== "string" || !vm.vm) continue;
      const status = vcenterVmStatus(vm.power_state, unit.on);
      items.push({ external_id: vm.vm, status, ...(status.state === "up" ? { last_contact_at: now } : {}) });
    }
    i++;
  }
  return { items, next: i < cur.units.length ? ({ units: cur.units, i, done: 0 } as unknown as Cursor) : null };
}

/** vSphere Client's object pages need the vCenter's own instance UUID (`instance_uuid`). */
function link(record: DiscoveredRecord, c: ConnCtx): string | null {
  const uuid = (c.options as VcenterOptions).instance_uuid;
  if (!uuid || !/^(vm|host)-\d+$/.test(record.external_id)) return null;
  let origin: string;
  try {
    origin = new URL(String(c.connector.base_url)).origin;
  } catch {
    return null;
  }
  const [type, view] = record.kind === "vm" ? ["VirtualMachine", "vm"] : ["HostSystem", "host"];
  return `${origin}/ui/app/${view};nav=h/urn:vmomi:${type}:${record.external_id}:${uuid.toLowerCase()}/summary`;
}

export const connector: ConnectorKind = {
  ...descriptor,
  headers: ["Authorization", SESSION_HEADER],
  optionsSchema: vcenterOptions,
  async test(c: ConnCtx): Promise<TestResult> {
    const warnings: string[] = [];
    const who = await get<{ user?: string }>(c, "api/session");
    const hosts = await hostsInScope(c);
    if (!hosts.length) warnings.push(VCENTER_MESSAGES.noHosts);
    if (!(c.options as VcenterOptions).instance_uuid) warnings.push(VCENTER_MESSAGES.noLinks);
    let version: string | undefined;
    try {
      version = (await get<{ version?: string }>(c, "api/appliance/system/version"))?.version;
    } catch (e) {
      // the appliance's version needs a right a read-only user may lack: the test still passes
      if (e instanceof ConnectorError && (e.code === "refused" || e.code === "config")) throw e;
    }
    return { ok: true, ...(version ? { version } : {}), ...(who?.user ? { identity: who.user } : {}), warnings };
  },
  pages: page,
  status: statusPage,
  link,
};
