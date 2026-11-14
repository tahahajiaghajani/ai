// A PRTG core server for the discovery tests (design A §17), shaped after the PRTG v1 HTTP API documentation:
// `/api/table.json?content=devices|sensors&columns=…&start=&count=` with `treesize` (the matching count), `sortby`,
// `id` (objects below a group), `filter_<column>` (repeated values: any of them), each column formatted and `_raw`;
// the API key in `Authorization: Bearer` (a wrong one → 401). Device rows carry PRTG's sensor counts (downsens,
// warnsens, …), sensor rows `lastup`/`lastdown` as OLE dates. Faults: an HTTP status once per content (503, 429 with
// Retry-After), a slow page, a malformed device (no objid), a redirect to another host, a page that is not PRTG's.
import { json } from "./harness";

export const PRTG_HOST = "prtg.mock.test";
export const PRTG_TOKEN = "prtg-secret-key";
export const PRTG_URL = `https://${PRTG_HOST}/`;

export interface PrtgDevice {
  objid: number;
  device: string;
  host: string;
  group: string;
  /** the group's object id (for `id=`) */
  groupid: number;
  probe: string;
  tags?: string;
  location?: string;
  status_raw?: number;
}

export interface PrtgSensor {
  objid: number;
  parentid: number;
  sensor: string;
  type_raw: string;
  status_raw: number;
  message?: string;
  /** ms since the epoch */
  lastup?: number;
  lastdown?: number;
}

const STATUS_WORDS: Record<number, string> = { 1: "Unknown", 3: "Up", 4: "Warning", 5: "Down", 7: "Paused", 8: "Paused", 9: "Paused", 10: "Unusual", 12: "Paused", 13: "Down (Acknowledged)", 14: "Down (Partial)" };

/** ms since the epoch as PRTG's raw date (an OLE Automation date). */
export const ole = (ms: number) => ms / 86_400_000 + 25569;

/** n devices from objid 2001, each with an up Ping sensor (objid 5001…) and an up CPU sensor (objid 7001…). */
export function makePrtg(n: number): { devices: PrtgDevice[]; sensors: PrtgSensor[] } {
  const devices: PrtgDevice[] = [];
  const sensors: PrtgSensor[] = [];
  const t = Date.now() - 60_000;
  for (let i = 0; i < n; i++) {
    const objid = 2001 + i;
    devices.push({ objid, device: `Switch ${objid}`, host: `10.30.${(i >> 8) & 255}.${(i & 255) + 1}`, group: "Switches", groupid: 50, probe: "Local Probe", tags: "switch core", location: "شعبهٔ مرکزی", status_raw: 3 });
    sensors.push({ objid: 5001 + i, parentid: objid, sensor: "Ping", type_raw: "ping", status_raw: 3, message: "OK", lastup: t });
    sensors.push({ objid: 7001 + i, parentid: objid, sensor: "CPU Load", type_raw: "snmpcpu", status_raw: 3, message: "OK", lastup: t });
  }
  return { devices, sensors };
}

export class PrtgMock {
  version = "24.1.92.1554";
  token = PRTG_TOKEN;
  devices: PrtgDevice[];
  sensors: PrtgSensor[];
  /** every table request: its content and parameters */
  requests: { content: string; params: URLSearchParams }[] = [];
  /** answer the next request of this content once with this HTTP status */
  failOnce = new Map<string, number>();
  /** delay of every devices page */
  slowMs = 0;
  /** device objids answered without their objid (a malformed row) */
  malformed = new Set<number>();
  redirectTo: string | null = null;
  notPrtg = false;

  constructor(data: { devices: PrtgDevice[]; sensors: PrtgSensor[] }) {
    this.devices = data.devices;
    this.sensors = data.sensors;
  }

  private deviceRow(d: PrtgDevice): Record<string, unknown> {
    const mine = this.sensors.filter((s) => s.parentid === d.objid);
    const count = (...st: number[]) => mine.filter((s) => st.includes(s.status_raw)).length;
    const st = d.status_raw ?? 3;
    const row: Record<string, unknown> = {
      objid: d.objid, objid_raw: d.objid, device: d.device, device_raw: d.device, host: d.host, group: d.group, probe: d.probe, tags: d.tags ?? "", location: d.location ?? "",
      status: STATUS_WORDS[st] ?? "Unknown", status_raw: st,
      downsens: String(count(5)), downsens_raw: count(5), partialdownsens: String(count(14)), partialdownsens_raw: count(14),
      downacksens: String(count(13)), downacksens_raw: count(13), warnsens: String(count(4)), warnsens_raw: count(4), unusualsens: String(count(10)), unusualsens_raw: count(10),
    };
    if (this.malformed.has(d.objid)) {
      delete row.objid;
      delete row.objid_raw;
    }
    return row;
  }

  private sensorRow(s: PrtgSensor): Record<string, unknown> {
    const d = this.devices.find((x) => x.objid === s.parentid);
    return {
      objid: s.objid, objid_raw: s.objid, parentid: s.parentid, parentid_raw: s.parentid, device: d?.device ?? "", sensor: s.sensor, type: s.type_raw.toUpperCase(), type_raw: s.type_raw,
      status: STATUS_WORDS[s.status_raw] ?? "Unknown", status_raw: s.status_raw,
      message: `<div class="status">${s.message ?? ""}</div>`, message_raw: s.message ?? "",
      lastup: s.lastup ? new Date(s.lastup).toUTCString() : "", lastup_raw: s.lastup ? ole(s.lastup) : "",
      lastdown: s.lastdown ? new Date(s.lastdown).toUTCString() : "", lastdown_raw: s.lastdown ? ole(s.lastdown) : "",
    };
  }

  handler = async (req: Request): Promise<Response> => {
    if (this.redirectTo) return new Response(null, { status: 302, headers: { location: this.redirectTo } });
    const u = new URL(req.url);
    if (req.headers.get("authorization") !== `Bearer ${this.token}`) return new Response("Unauthorized", { status: 401 });
    if (this.notPrtg) return json({ hello: "world" });
    if (u.pathname !== "/api/table.json") return json({ error: "not found" }, 404);
    const q = u.searchParams;
    const content = q.get("content") ?? "";
    this.requests.push({ content, params: q });
    const failed = this.failOnce.get(content);
    if (failed) {
      this.failOnce.delete(content);
      return json({ error: "busy" }, failed, failed === 429 ? { "retry-after": "4" } : {});
    }
    const any = (col: string, v: string | number) => {
      const want = q.getAll(`filter_${col}`);
      return !want.length || want.map(String).includes(String(v));
    };
    const group = q.get("id") ? Number(q.get("id")) : null;
    let rows: Record<string, unknown>[];
    if (content === "devices") {
      if (this.slowMs) await new Promise((r) => setTimeout(r, this.slowMs));
      rows = this.devices.filter((d) => (group === null || d.groupid === group) && any("objid", d.objid)).sort((a, b) => a.objid - b.objid).map((d) => this.deviceRow(d));
    } else if (content === "sensors") {
      rows = this.sensors
        .filter((s) => group === null || this.devices.find((d) => d.objid === s.parentid)?.groupid === group)
        .filter((s) => any("type", s.type_raw) && any("parentid", s.parentid) && any("status", s.status_raw))
        .sort((a, b) => a.objid - b.objid)
        .map((s) => this.sensorRow(s));
    } else return json({ error: "unknown content" }, 400);
    const start = Number(q.get("start") ?? 0);
    const count = Number(q.get("count") ?? 500);
    return json({ "prtg-version": this.version, treesize: rows.length, [content]: rows.slice(start, start + count) });
  };

  of(content: string) {
    return this.requests.filter((r) => r.content === content);
  }
}
