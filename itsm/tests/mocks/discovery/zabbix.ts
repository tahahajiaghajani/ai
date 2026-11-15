// A Zabbix front end for the discovery tests (design A §17), shaped after the Zabbix 6.0–7.0 API documentation:
// JSON-RPC 2.0 at /zabbix/api_jsonrpc.php; `apiinfo.version` without a token; an API token in the `Authorization: Bearer`
// header (6.4+) or the request's `auth` member (5.4–6.2), a wrong one answered as Zabbix does (HTTP 200, error
// "Not authorized."); `host.get` without offset paging (all ids sorted, or the hosts of `hostids`) with interfaces,
// inventory (`[]` when inventory is off), host groups (`selectHostGroups` from 6.2, `selectGroups` refused from 7.0),
// templates and tags; `item.get` by key prefix; `trigger.get` in problem state (`selectItems`: its items' keys);
// `problem.get` in event-id order with `eventid_from`, `limit`, `groupids` and `hostids`; `hostgroup.get` by name. Faults: an HTTP status once per method (503, 429 with
// Retry-After), a slow chunk, a malformed host, a redirect to another host.
import { json } from "./harness";

export const ZABBIX_HOST = "zbx.mock.test";
export const ZABBIX_TOKEN = "zbx-secret-token";
export const ZABBIX_URL = `https://${ZABBIX_HOST}/zabbix/`;

export interface ZbxInterface {
  type: string;
  main: string;
  useip: string;
  ip: string;
  dns: string;
  available: string;
}

export interface ZbxHost {
  hostid: string;
  host: string;
  name: string;
  status?: string;
  maintenance_status?: string;
  inventory_mode?: string;
  inventory?: Record<string, string>;
  interfaces?: ZbxInterface[];
  groups?: string[];
  templates?: string[];
  tags?: { tag: string; value: string }[];
}

export interface ZbxItem {
  hostid: string;
  key_: string;
  lastvalue: string;
  lastclock: string;
  state?: string;
  status?: string;
}

export interface ZbxTrigger {
  triggerid: string;
  hostid: string;
  description: string;
  priority: string;
  lastchange: string;
  /** "1" in problem state */
  value: string;
  tags?: { tag: string; value: string }[];
  /** the item keys of its expression (selectItems) */
  keys?: string[];
}

export interface ZbxProblem {
  eventid: string;
  objectid: string;
  name: string;
  severity: string;
  clock: string;
  tags?: { tag: string; value: string }[];
}

const now = () => String(Math.floor(Date.now() / 1000));
const hex = (n: number) => n.toString(16).padStart(2, "0");

/** n hosts from id 10100: agent interface 10.20.x.y, inventory with serial SN-<id>, agent.ping and icmpping answering. */
export function makeZabbixHosts(n: number, from = 10100): { hosts: ZbxHost[]; items: ZbxItem[] } {
  const hosts: ZbxHost[] = [];
  const items: ZbxItem[] = [];
  for (let i = 0; i < n; i++) {
    const id = String(from + i);
    hosts.push({
      hostid: id,
      host: `srv${id}.bank.local`,
      name: `Server ${id}`,
      status: "0",
      maintenance_status: "0",
      inventory_mode: "1",
      inventory: { serialno_a: `SN-${id}`, macaddress_a: `00:50:56:${hex((i >> 8) & 255)}:${hex(i & 255)}:01`, vendor: "HPE", model: "ProLiant DL380", os_short: "Linux", location: "تهران" },
      interfaces: [{ type: "1", main: "1", useip: "1", ip: `10.20.${(i >> 8) & 255}.${(i & 255) + 1}`, dns: "", available: "1" }],
      groups: ["Linux servers"],
      templates: ["Linux by Zabbix agent"],
    });
    items.push({ hostid: id, key_: "agent.ping", lastvalue: "1", lastclock: now() }, { hostid: id, key_: "icmpping", lastvalue: "1", lastclock: now() });
  }
  return { hosts, items };
}

export class ZabbixMock {
  version = "7.0.5";
  token = ZABBIX_TOKEN;
  hosts: ZbxHost[];
  items: ZbxItem[];
  triggers: ZbxTrigger[] = [];
  problems: ZbxProblem[] = [];
  groupIds = new Map<string, string>();
  /** every call: method, params and how the token came */
  calls: { method: string; params: Record<string, unknown>; auth: "bearer" | "body" | null }[] = [];
  /** answer the next call of this method once with this HTTP status */
  failOnce = new Map<string, number>();
  /** delay of host.get with hostids (a slow chunk) */
  slowMs = 0;
  /** answer every request with a redirect to this URL */
  redirectTo: string | null = null;
  /** answer with a page that is not Zabbix's: HTML, or JSON that is not JSON-RPC */
  notZabbix: "html" | "json" | false = false;
  /** answer a method with this JSON-RPC error (as Zabbix does, with HTTP 200) */
  rpcFaults = new Map<string, { code: number; message: string; data: string }>();

  constructor(data: { hosts: ZbxHost[]; items?: ZbxItem[] }) {
    this.hosts = data.hosts;
    this.items = data.items ?? [];
  }

  private groupId(name: string): string {
    if (!this.groupIds.has(name)) this.groupIds.set(name, String(100 + this.groupIds.size));
    return this.groupIds.get(name)!;
  }

  private major(): number[] {
    return this.version.split(".").map(Number);
  }

  private atLeast(M: number, m: number): boolean {
    const [a, b] = this.major();
    return a > M || (a === M && b >= m);
  }

  private inScope(h: ZbxHost, p: Record<string, any>): boolean {
    if (Array.isArray(p.hostids) && !p.hostids.map(String).includes(h.hostid)) return false;
    if (Array.isArray(p.groupids) && !(h.groups ?? []).some((g) => p.groupids.includes(this.groupId(g)))) return false;
    if (Array.isArray(p.tags) && p.tags.length) {
      const any = p.tags.some((t: { tag: string; value?: string; operator?: number }) =>
        (h.tags ?? []).some((x) => x.tag === t.tag && (t.operator === 4 || x.value === t.value)),
      );
      if (!any) return false;
    }
    if (p.filter?.inventory_mode !== undefined && String(h.inventory_mode ?? "-1") !== String(p.filter.inventory_mode)) return false;
    return true;
  }

  private hostOut(h: ZbxHost, p: Record<string, any>): Record<string, unknown> {
    const out: Record<string, unknown> = { hostid: h.hostid, host: h.host, name: h.name, status: h.status ?? "0", maintenance_status: h.maintenance_status ?? "0", inventory_mode: h.inventory_mode ?? "-1" };
    if (p.selectInterfaces) out.interfaces = h.interfaces ?? [];
    if (p.selectInventory) out.inventory = h.inventory_mode === "-1" || !h.inventory ? [] : h.inventory;
    if (p.selectHostGroups) out.hostgroups = (h.groups ?? []).map((g) => ({ groupid: this.groupId(g), name: g }));
    if (p.selectGroups) out.groups = (h.groups ?? []).map((g) => ({ groupid: this.groupId(g), name: g }));
    if (p.selectParentTemplates) out.parentTemplates = (h.templates ?? []).map((t, i) => ({ templateid: String(9000 + i), name: t }));
    if (p.selectTags) out.tags = h.tags ?? [];
    return out;
  }

  private call(method: string, p: Record<string, any>): unknown {
    switch (method) {
      case "apiinfo.version":
        return this.version;
      case "hostgroup.get": {
        const names: string[] = p.filter?.name ?? [];
        const all = [...new Set(this.hosts.flatMap((h) => h.groups ?? []))];
        return all.filter((g) => !names.length || names.includes(g)).map((g) => ({ groupid: this.groupId(g), name: g }));
      }
      case "host.get": {
        if (p.selectGroups && this.atLeast(7, 0)) throw new RpcFault(-32602, "Invalid params.", 'Invalid parameter "/": unexpected parameter "selectGroups".');
        const hosts = this.hosts.filter((h) => this.inScope(h, p)).sort((a, b) => Number(a.hostid) - Number(b.hostid));
        if (p.countOutput) return String(hosts.length);
        if (Array.isArray(p.output) && p.output.length === 1 && p.output[0] === "hostid") return hosts.map((h) => ({ hostid: h.hostid }));
        return hosts.map((h) => this.hostOut(h, p));
      }
      case "item.get": {
        const prefixes: string[] = [].concat(p.search?.key_ ?? []);
        return this.items
          .filter((it) => !Array.isArray(p.hostids) || p.hostids.includes(it.hostid))
          .filter((it) => !prefixes.length || prefixes.some((x) => (p.startSearch ? it.key_.startsWith(x) : it.key_.includes(x))))
          .filter((it) => p.filter?.status === undefined || String(it.status ?? "0") === String(p.filter.status))
          .map((it) => ({ itemid: `${it.hostid}${it.key_.length}`, hostid: it.hostid, key_: it.key_, lastvalue: it.lastvalue, lastclock: it.lastclock, state: it.state ?? "0" }));
      }
      case "trigger.get": {
        let ts = this.triggers;
        if (Array.isArray(p.triggerids)) ts = ts.filter((t) => p.triggerids.includes(t.triggerid));
        if (Array.isArray(p.hostids)) ts = ts.filter((t) => p.hostids.includes(t.hostid));
        if (p.filter?.value !== undefined) ts = ts.filter((t) => t.value === String(p.filter.value));
        return ts.map((t) => ({
          triggerid: t.triggerid, description: t.description, priority: t.priority, lastchange: t.lastchange, hosts: [{ hostid: t.hostid }], tags: t.tags ?? [],
          ...(p.selectItems ? { items: (t.keys ?? []).map((key_, i) => ({ itemid: `${t.triggerid}${i}`, key_ })) } : {}),
        }));
      }
      case "problem.get": {
        let ps = [...this.problems].sort((a, b) => Number(a.eventid) - Number(b.eventid));
        if (p.eventid_from !== undefined) ps = ps.filter((x) => BigInt(x.eventid) >= BigInt(p.eventid_from));
        const hostOf = new Map(this.triggers.map((t) => [t.triggerid, t.hostid]));
        if (Array.isArray(p.groupids)) {
          ps = ps.filter((x) => this.hosts.some((h) => h.hostid === hostOf.get(x.objectid) && (h.groups ?? []).some((g) => p.groupids.includes(this.groupId(g)))));
        }
        if (Array.isArray(p.hostids)) ps = ps.filter((x) => p.hostids.map(String).includes(hostOf.get(x.objectid) ?? ""));
        if (p.limit) ps = ps.slice(0, Number(p.limit));
        return ps.map((x) => ({ eventid: x.eventid, objectid: x.objectid, name: x.name, severity: x.severity, clock: x.clock, tags: x.tags ?? [] }));
      }
      default:
        throw new RpcFault(-32601, "Method not found.", `Incorrect API "${method.split(".")[0]}".`);
    }
  }

  handler = async (req: Request): Promise<Response> => {
    if (this.redirectTo) return new Response(null, { status: 302, headers: { location: this.redirectTo } });
    if (this.notZabbix === "html") return new Response("<html><body>Welcome</body></html>", { status: 200, headers: { "content-type": "text/html" } });
    if (this.notZabbix === "json") return json({ status: "ok" });
    const u = new URL(req.url);
    if (req.method !== "POST" || u.pathname !== "/zabbix/api_jsonrpc.php") return json({ detail: "Not found" }, 404);
    const body = (await req.json()) as { method: string; params: Record<string, any>; id: number; auth?: string };
    const header = req.headers.get("authorization");
    const auth = header ? "bearer" : body.auth !== undefined ? "body" : null;
    this.calls.push({ method: body.method, params: body.params, auth });
    const failed = this.failOnce.get(body.method);
    if (failed) {
      this.failOnce.delete(body.method);
      return json({ error: "busy" }, failed, failed === 429 ? { "retry-after": "3" } : {});
    }
    const answer = (x: unknown) => json({ jsonrpc: "2.0", ...(x instanceof RpcFault ? { error: { code: x.code, message: x.message, data: x.data } } : { result: x }), id: body.id });
    if (body.method === "apiinfo.version") {
      if (body.auth !== undefined) return answer(new RpcFault(-32602, "Invalid params.", 'The "apiinfo.version" method must be called without the "auth" parameter.'));
      return answer(this.version);
    }
    const token = header ? (/^Bearer (.+)$/.exec(header)?.[1] ?? "") : body.auth;
    // the header is read from 6.4; earlier versions only know the request's auth member
    if (header && !this.atLeast(6, 4)) return answer(new RpcFault(-32602, "Invalid params.", "Not authorised."));
    if (token !== this.token) return answer(new RpcFault(-32602, "Invalid params.", "Not authorized."));
    const fault = this.rpcFaults.get(body.method);
    if (fault) return answer(new RpcFault(fault.code, fault.message, fault.data));
    if (this.slowMs && body.method === "host.get" && Array.isArray(body.params.hostids)) await new Promise((r) => setTimeout(r, this.slowMs));
    try {
      return answer(this.call(body.method, body.params ?? {}));
    } catch (e) {
      if (e instanceof RpcFault) return answer(e);
      throw e;
    }
  };

  /** The calls of a method. */
  of(method: string) {
    return this.calls.filter((c) => c.method === method);
  }
}

class RpcFault {
  constructor(public code: number, public message: string, public data: string) {}
}
