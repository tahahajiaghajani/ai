// The «Zabbix» kind (design A §2.1, §6.1, §9.2, §9.6, §10): JSON-RPC 2.0 at `api_jsonrpc.php` with an API token. The
// version decides how the token travels: the `Authorization: Bearer` header from 6.4, the request's `auth` member from
// 5.4 to 6.2 (older versions have no API tokens). `host.get` has no offset paging, so a page lists the host ids
// (light, sorted) and reads the next ≤ 500 after the cursor's last id with their interfaces, inventory, groups,
// templates and tags; the availability items (ICMP ping, agent ping, agent and SNMP availability) give the status and
// the last contact; triggers in problem state give availability outages and warnings. Problems are read from
// `problem.get` in event-id order (`eventid_from`), for the hosts in scope. The rules are pure, in
// @shared/discovery/kinds/zabbix.
import { z } from "zod";
import {
  agentTrigger, availabilityItem, isAvailabilityProblem, zabbix as descriptor, zabbixAvailability, zabbixContact, zabbixSeverity, type ZabbixAvailabilityInput,
  type ZabbixCheck,
} from "@shared/discovery/kinds/zabbix";
import { normaliseHost, normaliseIp } from "@shared/discovery/normalise";
import type { Cursor, DiscoveredProblem, DiscoveredRecord, DiscoveredStatus, Page, ProblemPage, StatusPage, TestResult } from "@shared/discovery/types";
import { faDigits } from "@shared/format";
import { ConnectorError, CONNECTOR_MESSAGES, type ConnCtx, type ConnectorKind } from "../kind";

/** The kind's own documented messages (the docs' troubleshooting table lists each). */
export const ZABBIX_MESSAGES = {
  tooOld: (v: string) => `نسخهٔ Zabbix (${v}) کلید API ندارد؛ Zabbix ۵٫۴ یا تازه‌تر لازم است`,
  notZabbix: "پاسخ این نشانی پاسخ Zabbix نیست؛ نشانی رابط وب Zabbix (یا api_jsonrpc.php) را وارد کنید",
  permission: "نقش کاربر API در Zabbix به این بخش دسترسی ندارد؛ دسترسی خواندن به گروه‌های میزبان را در Zabbix بدهید",
  rpc: (detail: string) => `Zabbix درخواست را نپذیرفت (${detail})؛ نسخه و دسترسی کاربر API را بررسی کنید`,
  noGroup: (names: string[]) => `گروه میزبان ${names.map((n) => `«${n}»`).join("، ")} در Zabbix پیدا نشد؛ نام گروه را در تنظیمات اصلاح کنید`,
  noHosts: "Zabbix هیچ میزبانی برنگرداند؛ دسترسی نقش کاربر API به گروه‌های میزبان را بررسی کنید",
  noInventory: (n: number) => `فهرست موجودی (inventory) در ${faDigits(n)} میزبان خاموش است؛ شمارهٔ سریال و سازنده از آن‌ها نمی‌آید`,
} as const;

const NAME = z.string().trim().min(1).max(200);
const CLASS_KEY = /^[a-z][a-z0-9_]{0,62}$/;

export const zabbixOptions = z.object({
  host_groups: z.array(NAME).max(200).default([]),
  tags: z.array(NAME).max(50).default([]),
  class_map: z.record(NAME, z.string().trim().regex(CLASS_KEY)).default({}),
  chunk_size: z.coerce.number().int().min(1).max(500).default(500),
  frontend_url: z.string().trim().max(500).default(""),
});
export type ZabbixOptions = z.infer<typeof zabbixOptions>;

// ---------------------------------------------------------------------------------------------------------------
// The JSON-RPC call

interface RpcAnswer<T> {
  jsonrpc?: string;
  result?: T;
  error?: { code?: number; message?: string; data?: string };
}

interface Session {
  version: string;
  /** the token in the Authorization header (6.4+), else in the request's `auth` member */
  bearer: boolean;
  /** 6.2+ names host groups `hostgroups` (selectHostGroups); earlier `groups` (selectGroups) */
  hostGroups: boolean;
}

const AUTH_FAILURE = /not authori[sz]ed|session terminated|re-?login|api token expired|invalid (auth|api )?token|not authenticated|incorrect user name or password/i;

/** The address of the API: `api_jsonrpc.php` under the connector's address, or the address itself when it names it. */
function apiPath(c: ConnCtx): string {
  try {
    const u = new URL(String(c.connector.base_url ?? ""));
    if (/api_jsonrpc\.php$/i.test(u.pathname)) return u.href;
  } catch {
    /* the fetcher refuses the address with its own message */
  }
  return "api_jsonrpc.php";
}

let rpcId = 0;
async function rpc<T>(c: ConnCtx, s: Session | null, method: string, params: unknown): Promise<T> {
  const body: Record<string, unknown> = { jsonrpc: "2.0", method, params, id: ++rpcId };
  const headers: Record<string, string> = {};
  if (s) {
    if (s.bearer) headers.Authorization = `Bearer ${c.secret ?? ""}`;
    else body.auth = c.secret ?? "";
  }
  const res = await c.fetchJson<RpcAnswer<T>>(apiPath(c), { method: "POST", body, headers });
  const a = res.body;
  if (!a || typeof a !== "object" || Array.isArray(a) || (!("result" in a) && !a.error)) throw new ConnectorError("bad_response", ZABBIX_MESSAGES.notZabbix);
  if (a.error) {
    const detail = [a.error.message, a.error.data].filter(Boolean).join(" ").trim();
    if (AUTH_FAILURE.test(detail)) throw new ConnectorError("auth", CONNECTOR_MESSAGES.auth);
    if (/no permissions/i.test(detail)) throw new ConnectorError("bad_response", ZABBIX_MESSAGES.permission);
    throw new ConnectorError("bad_response", ZABBIX_MESSAGES.rpc(detail.slice(0, 200) || String(a.error.code ?? "")));
  }
  return a.result as T;
}

/** The API's version and how the token travels: once per job slice. */
const sessions = new WeakMap<ConnCtx, Promise<Session>>();
function session(c: ConnCtx): Promise<Session> {
  let p = sessions.get(c);
  if (!p) {
    p = (async () => {
      // apiinfo.version takes no token (Zabbix refuses one on it)
      const version = await rpc<string>(c, null, "apiinfo.version", []);
      const [major, minor] = String(version).split(".").map((x) => Number(x));
      if (!Number.isFinite(major) || !Number.isFinite(minor)) throw new ConnectorError("bad_response", ZABBIX_MESSAGES.notZabbix);
      const at = (M: number, m: number) => major > M || (major === M && minor >= m);
      if (!at(5, 4)) throw new ConnectorError("config", ZABBIX_MESSAGES.tooOld(String(version)));
      if (!c.secret) throw new ConnectorError("config", CONNECTOR_MESSAGES.reenterKey);
      return { version: String(version), bearer: at(6, 4), hostGroups: at(6, 2) };
    })();
    sessions.set(c, p);
    p.catch(() => sessions.delete(c));
  }
  return p;
}

// ---------------------------------------------------------------------------------------------------------------
// The host listing and its chunks

interface HostRow {
  hostid: string;
  host?: string;
  name?: string;
  status?: string;
  maintenance_status?: string;
  inventory_mode?: string;
  interfaces?: { type?: string; main?: string; useip?: string; ip?: string; dns?: string; available?: string }[];
  inventory?: Record<string, string> | unknown[];
  hostgroups?: { name?: string }[];
  groups?: { name?: string }[];
  parentTemplates?: { name?: string }[];
}

interface ItemRow {
  hostid: string;
  key_: string;
  lastvalue?: string;
  lastclock?: string;
  state?: string;
}

interface TriggerRow {
  triggerid: string;
  description?: string;
  priority?: string;
  lastchange?: string;
  hosts?: { hostid: string }[];
  tags?: { tag?: string; value?: string }[];
  /** the items of its expression */
  items?: { key_?: string }[];
}

const idOrder = (a: string, b: string) => (a.length !== b.length ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0);

/** host.get's filter of the connector's scope: groups by id, tags (any of them). */
async function scope(c: ConnCtx, s: Session): Promise<Record<string, unknown>> {
  const o = c.options as ZabbixOptions;
  const out: Record<string, unknown> = {};
  if (o.host_groups.length) {
    const groups = await rpc<{ groupid: string; name: string }[]>(c, s, "hostgroup.get", { output: ["groupid", "name"], filter: { name: o.host_groups } });
    const found = new Set(groups.map((g) => g.name));
    const missing = o.host_groups.filter((n) => !found.has(n));
    // a group renamed in Zabbix must not make its hosts look gone: the pass stops with what to fix
    if (missing.length) throw new ConnectorError("config", ZABBIX_MESSAGES.noGroup(missing));
    out.groupids = groups.map((g) => g.groupid);
  }
  if (o.tags.length) {
    out.evaltype = 2;
    out.tags = o.tags.map((t) => {
      const i = t.indexOf("=");
      return i < 0 ? { tag: t, operator: 4 } : { tag: t.slice(0, i).trim(), value: t.slice(i + 1).trim(), operator: 1 };
    });
  }
  return out;
}

/** The sorted ids of every host in scope (one light call). */
async function hostIds(c: ConnCtx, s: Session, sc?: Record<string, unknown>): Promise<string[]> {
  const rows = await rpc<{ hostid: string }[]>(c, s, "host.get", { output: ["hostid"], sortfield: "hostid", sortorder: "ASC", ...(sc ?? (await scope(c, s))) });
  return rows.map((r) => String(r.hostid)).sort(idOrder);
}

interface ZabbixCursor {
  /** the last host id done */
  after?: string;
}

function chunkAfter(ids: string[], cursor: Cursor | null, size: number): string[] {
  const after = cursor && typeof cursor === "object" && !Array.isArray(cursor) ? (cursor as ZabbixCursor).after : undefined;
  const from = after ? ids.findIndex((id) => idOrder(id, String(after)) > 0) : 0;
  return from < 0 ? [] : ids.slice(from, from + size);
}

const INVENTORY = ["serialno_a", "serialno_b", "macaddress_a", "macaddress_b", "os", "os_short", "hardware", "model", "vendor", "location", "asset_tag"];

/** What a chunk of hosts brings: the hosts, their availability items and their triggers in problem state. */
async function readChunk(c: ConnCtx, s: Session, ids: string[], withHosts: boolean, withTriggers: boolean) {
  const hosts = withHosts
    ? await rpc<HostRow[]>(c, s, "host.get", {
        hostids: ids,
        output: ["hostid", "host", "name", "status", "maintenance_status", "inventory_mode"],
        selectInterfaces: ["type", "main", "useip", "ip", "dns", "available"],
        selectInventory: INVENTORY,
        [s.hostGroups ? "selectHostGroups" : "selectGroups"]: ["name"],
        selectParentTemplates: ["name"],
      })
    : await rpc<HostRow[]>(c, s, "host.get", { hostids: ids, output: ["hostid", "status", "maintenance_status"], selectInterfaces: ["type", "available"] });
  const items = await rpc<ItemRow[]>(c, s, "item.get", {
    hostids: ids,
    output: ["hostid", "key_", "lastvalue", "lastclock", "state"],
    search: { key_: ["icmpping", "agent.ping", "zabbix[host,"] },
    startSearch: true,
    searchByAny: true,
    filter: { status: 0 },
  });
  const triggers = withTriggers
    ? await rpc<TriggerRow[]>(c, s, "trigger.get", {
        hostids: ids,
        output: ["triggerid", "description", "priority", "lastchange"],
        filter: { value: 1 },
        monitored: true,
        skipDependent: true,
        expandDescription: true,
        selectHosts: ["hostid"],
        selectTags: ["tag", "value"],
        selectItems: ["key_"],
      })
    : [];
  return { hosts, items, triggers };
}

function checksOf(items: ItemRow[]): Map<string, { icmp: ZabbixCheck[]; agent: ZabbixCheck[] }> {
  const out = new Map<string, { icmp: ZabbixCheck[]; agent: ZabbixCheck[] }>();
  for (const it of items) {
    const which = availabilityItem(it.key_);
    // an unsupported item (state 1) says nothing of the host
    if (!which || it.state === "1") continue;
    const clock = Number(it.lastclock ?? 0) || 0;
    const n = it.lastvalue === undefined || it.lastvalue === "" ? NaN : Number(it.lastvalue);
    let value: string | null = null;
    // before its first poll an item says nothing; zabbix[host,…,available] is 0 no, 1 yes, 2 unknown
    if (clock > 0 && Number.isFinite(n)) value = it.key_.startsWith("zabbix[") ? (n === 1 ? "1" : n === 0 ? "0" : null) : n > 0 ? "1" : "0";
    const e = out.get(it.hostid) ?? { icmp: [], agent: [] };
    e[which].push({ value, clock });
    out.set(it.hostid, e);
  }
  return out;
}

function problemsOf(triggers: TriggerRow[]): Map<string, ZabbixAvailabilityInput["problems"]> {
  const out = new Map<string, ZabbixAvailabilityInput["problems"]>();
  for (const t of triggers) {
    const p = {
      severity: Number(t.priority ?? 0) || 0,
      availability: isAvailabilityProblem(t.tags),
      agent: agentTrigger((t.items ?? []).map((i) => i.key_)),
      name: String(t.description ?? "").slice(0, 300),
      since: Number(t.lastchange ?? 0) || undefined,
    };
    for (const h of t.hosts ?? []) out.set(h.hostid, [...(out.get(h.hostid) ?? []), p]);
  }
  return out;
}

function statusOf(h: HostRow, checks: { icmp: ZabbixCheck[]; agent: ZabbixCheck[] } | undefined, problems: ReturnType<typeof problemsOf>): DiscoveredStatus {
  return zabbixAvailability({
    status: Number(h.status ?? 0),
    maintenance: String(h.maintenance_status ?? "0") === "1",
    icmp: checks?.icmp ?? [],
    agent: checks?.agent ?? [],
    interfaces: (h.interfaces ?? []).map((i) => ({ type: Number(i.type ?? 0), available: Number(i.available ?? 0) })),
    problems: problems.get(h.hostid) ?? [],
  });
}

/** The class of a host: the first of its groups, then its templates, named in `class_map`. */
function classOf(h: HostRow, map: Record<string, string>): string | undefined {
  const names = [...(h.hostgroups ?? h.groups ?? []), ...(h.parentTemplates ?? [])].map((g) => String(g.name ?? ""));
  for (const n of names) if (map[n]) return map[n];
  const lower = new Map(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  for (const n of names) if (lower.has(n.toLowerCase())) return lower.get(n.toLowerCase());
  return undefined;
}

const str = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
  return s ? s : undefined;
};

function hostRecord(h: HostRow, checks: { icmp: ZabbixCheck[]; agent: ZabbixCheck[] } | undefined, status: DiscoveredStatus | null, o: ZabbixOptions): DiscoveredRecord {
  const inv = h.inventory && !Array.isArray(h.inventory) ? (h.inventory as Record<string, string>) : {};
  const ifaces = [...(h.interfaces ?? [])].sort((a, b) => Number(b.main === "1") - Number(a.main === "1"));
  const ips = ifaces.map((i) => normaliseIp(i.ip)).filter((x): x is string => !!x);
  const dns = ifaces.map((i) => normaliseHost(i.dns)).find((d) => !!d && d.includes("."));
  const technical = normaliseHost(h.host);
  const reported: Record<string, string> = {};
  if (str(inv.location)) reported.location = str(inv.location)!;
  if (str(inv.asset_tag)) reported.asset_tag = str(inv.asset_tag)!;
  const contact = zabbixContact([...(checks?.icmp ?? []), ...(checks?.agent ?? [])]);
  const rec: DiscoveredRecord = {
    external_id: String(h.hostid),
    kind: "device",
    name: str(h.name) ?? str(h.host) ?? String(h.hostid),
    ...(classOf(h, o.class_map) ? { class: classOf(h, o.class_map) } : {}),
    // the interface's DNS name when it has one, else the technical host name (an FQDN when it is dotted)
    ...(dns ? { fqdn: dns } : technical ? { hostname: technical } : {}),
    ...(ips.length ? { ips: [...new Set(ips)] } : {}),
    ...(str(inv.macaddress_a) || str(inv.macaddress_b) ? { macs: [inv.macaddress_a, inv.macaddress_b].filter((m): m is string => !!str(m)) } : {}),
    ...(str(inv.serialno_a) || str(inv.serialno_b) ? { serial_number: str(inv.serialno_a) ?? str(inv.serialno_b) } : {}),
    ...(str(inv.vendor) ? { manufacturer: str(inv.vendor) } : {}),
    ...(str(inv.model) || str(inv.hardware) ? { model: str(inv.model) ?? str(inv.hardware) } : {}),
    ...(str(inv.os_short) || str(inv.os) ? { os: str(inv.os_short) ?? str(inv.os) } : {}),
    ...(Object.keys(reported).length ? { reported } : {}),
    ...(contact ? { last_contact_at: contact } : {}),
    ...(status ? { status } : {}),
  };
  return rec;
}

const collects = (c: ConnCtx, what: string) => !c.connector.collect?.length || c.connector.collect.includes(what);

async function page(c: ConnCtx, cursor: Cursor | null): Promise<Page> {
  const o = c.options as ZabbixOptions;
  const s = await session(c);
  const ids = await hostIds(c, s);
  const chunk = chunkAfter(ids, cursor, o.chunk_size);
  if (!chunk.length) return { records: [], next: null, complete: true, total: ids.length };
  const withStatus = collects(c, "status");
  const { hosts, items, triggers } = await readChunk(c, s, chunk, true, withStatus);
  const checks = checksOf(items);
  const problems = problemsOf(triggers);
  const byId = new Map(hosts.map((h) => [String(h.hostid), h]));
  const records: DiscoveredRecord[] = [];
  const raw: unknown[] = [];
  for (const id of chunk) {
    const h = byId.get(id);
    // a host removed between the listing and the chunk is simply not listed
    if (!h) continue;
    records.push(hostRecord(h, checks.get(id), withStatus ? statusOf(h, checks.get(id), problems) : null, o));
    raw.push(h);
  }
  const last = chunk[chunk.length - 1];
  const more = ids.findIndex((x) => x === last) < ids.length - 1;
  return { records, raw, next: more ? { after: last } : null, complete: true, total: ids.length };
}

async function statusPage(c: ConnCtx, cursor: Cursor | null): Promise<StatusPage> {
  const o = c.options as ZabbixOptions;
  const s = await session(c);
  const ids = await hostIds(c, s);
  const chunk = chunkAfter(ids, cursor, o.chunk_size);
  if (!chunk.length) return { items: [], next: null };
  const { hosts, items, triggers } = await readChunk(c, s, chunk, false, true);
  const checks = checksOf(items);
  const problems = problemsOf(triggers);
  const out: StatusPage["items"] = [];
  for (const h of hosts) {
    const id = String(h.hostid);
    const contact = zabbixContact([...(checks.get(id)?.icmp ?? []), ...(checks.get(id)?.agent ?? [])]);
    out.push({ external_id: id, status: statusOf(h, checks.get(id), problems), ...(contact ? { last_contact_at: contact } : {}) });
  }
  const last = chunk[chunk.length - 1];
  return { items: out, next: ids.indexOf(last) < ids.length - 1 ? { after: last } : null };
}

interface ProblemRow {
  eventid: string;
  objectid?: string;
  name?: string;
  severity?: string;
  clock?: string;
  tags?: { tag?: string; value?: string }[];
}

/**
 * The complete open set of the hosts in scope, in event-id order from the cursor's next id (problem.get has no offset
 * either). Host groups narrow it by id; with tags, by the ids of the hosts in scope — a problem keeps the tags it opened
 * with, so a host tagged since would be missed by the problems' own tags.
 */
async function problemsPage(c: ConnCtx, cursor: Cursor | null): Promise<ProblemPage> {
  const o = c.options as ZabbixOptions;
  const s = await session(c);
  const from = cursor && typeof cursor === "object" && !Array.isArray(cursor) ? String((cursor as { from?: string }).from ?? "") : "";
  const sc = await scope(c, s);
  const hostids = sc.tags ? await hostIds(c, s, sc) : null;
  if (hostids && !hostids.length) return { problems: [], next: null, complete: true };
  const rows = await rpc<ProblemRow[]>(c, s, "problem.get", {
    output: ["eventid", "objectid", "name", "severity", "clock"],
    source: 0,
    object: 0,
    recent: false,
    selectTags: ["tag", "value"],
    sortfield: ["eventid"],
    sortorder: "ASC",
    limit: o.chunk_size,
    ...(from ? { eventid_from: from } : {}),
    ...(hostids ? { hostids } : sc.groupids ? { groupids: sc.groupids } : {}),
  });
  const triggerIds = [...new Set(rows.map((r) => String(r.objectid ?? "")).filter(Boolean))];
  const triggers = triggerIds.length ? await rpc<TriggerRow[]>(c, s, "trigger.get", { triggerids: triggerIds, output: ["triggerid"], selectHosts: ["hostid"] }) : [];
  const hostOf = new Map(triggers.map((t) => [String(t.triggerid), t.hosts?.[0]?.hostid]));
  const problems: DiscoveredProblem[] = rows.map((r) => {
    const host = hostOf.get(String(r.objectid ?? ""));
    const clock = Number(r.clock ?? 0);
    return {
      key: String(r.eventid),
      ...(host ? { external_id: String(host) } : {}),
      severity: zabbixSeverity(r.severity),
      availability: isAvailabilityProblem(r.tags),
      message: String(r.name ?? "").slice(0, 500),
      ...(clock > 0 ? { since: new Date(clock * 1000).toISOString() } : {}),
    };
  });
  const last = rows[rows.length - 1]?.eventid;
  const next = rows.length >= o.chunk_size && last ? { from: (BigInt(last) + 1n).toString() } : null;
  return { problems, next, complete: true };
}

/** The Zabbix front end for links: `frontend_url` when it is on a pinned host, else the connector's address. */
export function frontEnd(c: Pick<ConnCtx, "connector" | "options">): string | null {
  const host = (raw: string | null | undefined) => {
    try {
      return raw && /^https?:/i.test(raw) ? new URL(raw).hostname.toLowerCase() : String(raw ?? "").trim().toLowerCase();
    } catch {
      return "";
    }
  };
  const pinned = new Set([host(c.connector.base_url), ...c.connector.hosts.map(host)].filter(Boolean));
  for (const raw of [(c.options as ZabbixOptions).frontend_url, c.connector.base_url]) {
    if (!raw) continue;
    try {
      const u = new URL(raw);
      if (!/^https?:$/.test(u.protocol) || !pinned.has(u.hostname.toLowerCase()) || u.username || u.password) continue;
      // a page's name goes (api_jsonrpc.php, index.php); the rest is the front end's folder
      let path = u.pathname.replace(/[^/]*\.php$/i, "");
      if (!path.endsWith("/")) path += "/";
      return `${u.origin}${path}`;
    } catch {
      /* not an address */
    }
  }
  return null;
}

export const connector: ConnectorKind = {
  ...descriptor,
  headers: ["Authorization"],
  optionsSchema: zabbixOptions,
  async test(c: ConnCtx): Promise<TestResult> {
    const s = await session(c);
    const warnings: string[] = [];
    const sc = await scope(c, s);
    const count = Number(await rpc<string>(c, s, "host.get", { countOutput: true, ...sc }));
    if (!count) warnings.push(ZABBIX_MESSAGES.noHosts);
    else {
      const off = Number(await rpc<string>(c, s, "host.get", { countOutput: true, filter: { inventory_mode: -1 }, ...sc }));
      if (off > 0) warnings.push(ZABBIX_MESSAGES.noInventory(off));
    }
    return { ok: true, version: s.version, warnings };
  },
  pages: page,
  status: statusPage,
  problems: problemsPage,
  link(record, c) {
    const front = frontEnd(c);
    return front && /^\d+$/.test(record.external_id) ? `${front}hostinventories.php?hostid=${record.external_id}` : null;
  },
};
