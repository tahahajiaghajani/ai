// A REST/JSON inventory tool for the discovery tests (design A §17): offset paging (`offset`/`limit`, NetBox-like
// `{ count, results, next }`) or page paging (`page`/`page_size`, from 1), a page size the tool caps (`maxLimit`), an
// API key in X-API-Key (a wrong one → 401), and the faults every mock offers — a 503 or a 429 with Retry-After on a
// chosen page, a slow page, a malformed record and a redirect to another host.
import { json } from "./harness";

export const REST_HOST = "rest.mock.test";
export const REST_TOKEN = "rest-secret-token";

export interface RestDevice {
  id: number;
  name: string;
  serial?: string;
  ip?: string;
  vendor?: string;
  os?: string;
  /** a VM's host (the parent's id) */
  host_id?: number;
  last_seen?: string;
  rack?: string;
  kind?: string;
  class?: string;
}

/** n devices (servers by default) seen `seenDaysAgo` days ago. */
export function makeDevices(n: number, opts: { from?: number; seenDaysAgo?: number; prefix?: string } = {}): RestDevice[] {
  const from = opts.from ?? 1;
  const seen = new Date(Date.now() - (opts.seenDaysAgo ?? 0) * 86_400_000).toISOString();
  return Array.from({ length: n }, (_, i) => {
    const id = from + i;
    return { id, name: `${opts.prefix ?? "srv"}-${id}`, serial: `SN${String(id).padStart(6, "0")}`, ip: `10.${(id >> 16) & 255}.${(id >> 8) & 255}.${(id & 255) || 1}`, vendor: "HPE", os: "Linux", last_seen: seen };
  });
}

/** The connector settings that read this mock (offset paging, the API key header, the JSON paths). */
export const REST_CONNECTOR = {
  kind: "rest",
  base_url: `https://${REST_HOST}/`,
  auth: "token",
  api_key_header: "X-API-Key",
  secret: REST_TOKEN,
  default_class: "server",
  options: { path: "/api/devices/", items_path: "results", paging: "offset", page_size: 500, total_path: "count" },
  mapping: {
    external_id: "$.id", name: "$.name", hostname: "$.name", serial_number: "$.serial", ip_address: "$.ip", manufacturer: "$.vendor", os: "$.os",
    parent_external_id: "$.host_id", last_contact_at: "$.last_seen", "attrs.rack": "$.rack", kind: "$.kind", class: "$.class",
  },
};

export class RestMock {
  devices: RestDevice[];
  token = REST_TOKEN;
  requests: { offset: number; limit: number }[] = [];
  /** answer the page at this offset once with this status (503, 429…) */
  failOnce = new Map<number, number>();
  /** answer the page at this offset every time with this status */
  failAlways = new Map<number, number>();
  /** delay of every page (a slow tool) */
  slowMs = 0;
  /** ids answered without their id (a malformed record) */
  malformed = new Set<number>();
  /** answer every request with a redirect to this URL */
  redirectTo: string | null = null;
  /** the most items the tool answers in one page, whatever was asked */
  maxLimit = 1000;

  constructor(devices: RestDevice[]) {
    this.devices = devices;
  }

  handler = async (req: Request): Promise<Response> => {
    const u = new URL(req.url);
    if (this.redirectTo) return new Response(null, { status: 302, headers: { location: this.redirectTo } });
    if (req.headers.get("x-api-key") !== this.token) return json({ detail: "Invalid token" }, 401);
    if (u.pathname !== "/api/devices/") return json({ detail: "Not found" }, 404);
    const limit = Math.min(this.maxLimit, Number(u.searchParams.get("limit") ?? u.searchParams.get("page_size") ?? 50));
    const page = u.searchParams.get("page");
    const offset = page !== null ? (Number(page) - 1) * limit : Number(u.searchParams.get("offset") ?? 0);
    this.requests.push({ offset, limit });
    if (this.slowMs) await new Promise((r) => setTimeout(r, this.slowMs));
    const once = this.failOnce.get(offset);
    if (once) {
      this.failOnce.delete(offset);
      return json({ detail: "busy" }, once, once === 429 ? { "retry-after": "2" } : {});
    }
    const always = this.failAlways.get(offset);
    if (always) return json({ detail: "busy" }, always);
    const results = this.devices.slice(offset, offset + limit).map((d) => (this.malformed.has(d.id) ? { ...d, id: undefined } : d));
    const next = offset + limit < this.devices.length ? `https://${REST_HOST}/api/devices/?offset=${offset + limit}&limit=${limit}` : null;
    return json({ count: this.devices.length, results, next });
  };
}
