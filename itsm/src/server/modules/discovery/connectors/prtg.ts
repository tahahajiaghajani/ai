// The «PRTG Network Monitor» kind (design A §2.1, §6.1, §9.2, §9.6, §10): the v1 HTTP API, `/api/table.json`, paged by
// `start` + `count` in object-id order, with the API key in the `Authorization: Bearer` header (never in the address,
// §14.1). A page of devices brings their name, host, location, group and tags; the device's own status is not trusted
// for availability, so the page also reads each device's primary sensor (Ping by default) — by its parent id, a hundred
// devices a call — whose status gives availability and whose `lastup` is the last contact. Other sensors down or in
// warning come from the device row's sensor counts. Problems are the sensors in warning, unusual or down states,
// paged the same way, one per sensor whatever its state, and only on the devices the connector lists. The rules are
// pure, in @shared/discovery/kinds/prtg.
import { z } from "zod";
import { oleDateIso, prtg as descriptor, prtgAvailability, prtgSeverity, PRTG_PROBLEM_STATES } from "@shared/discovery/kinds/prtg";
import { normaliseHost, normaliseIp } from "@shared/discovery/normalise";
import type { Cursor, DiscoveredProblem, DiscoveredRecord, DiscoveredStatus, Page, ProblemPage, StatusPage, TestResult } from "@shared/discovery/types";
import { ConnectorError, type ConnCtx, type ConnectorKind } from "../kind";

/** The kind's own documented messages (the docs' troubleshooting table lists each). */
export const PRTG_MESSAGES = {
  notPrtg: "پاسخ این نشانی پاسخ PRTG نیست؛ نشانی رابط وب PRTG را وارد کنید",
  noDevices: "PRTG هیچ دستگاهی برنگرداند؛ دسترسی کاربر کلید API به گروه‌ها را بررسی کنید",
  noObjid: "دستگاهی بی‌شناسه (objid) از PRTG رسید و کنار گذاشته شد",
  noPrimary: (type: string) => `PRTG هیچ حسگری از نوع «${type}» ندارد؛ دسترس‌پذیری دستگاه‌ها «نامعلوم» می‌ماند تا حسگر Ping یا «حسگر دسترس‌پذیری» دیگری تعیین شود`,
} as const;

const NAME = z.string().trim().min(1).max(200);
const CLASS_KEY = /^[a-z][a-z0-9_]{0,62}$/;

export const prtgOptions = z.object({
  primary_sensor: z.string().trim().toLowerCase().regex(/^[a-z0-9_.-]{1,60}$/).default("ping"),
  group_id: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().int().positive().optional()),
  tags: z.array(z.string().trim().regex(/^[^\s,]{1,100}$/)).max(50).default([]),
  class_map: z.record(NAME, z.string().trim().regex(CLASS_KEY)).default({}),
  page_size: z.coerce.number().int().min(1).max(2000).default(500),
});
export type PrtgOptions = z.infer<typeof prtgOptions>;

/** Devices whose primary sensors one call reads (their ids travel in the address). */
const PARENTS_PER_CALL = 100;

const DEVICE_COLUMNS = "objid,device,host,group,probe,tags,location,status,downsens,partialdownsens,downacksens,warnsens,unusualsens";
const SENSOR_COLUMNS = "objid,parentid,device,sensor,type,status,message,lastup,lastdown";

type Row = Record<string, unknown>;

/** A column's raw value (PRTG answers `x` formatted and `x_raw` raw where they differ). */
const raw = (r: Row, col: string): unknown => (r[`${col}_raw`] !== undefined && r[`${col}_raw`] !== "" ? r[`${col}_raw`] : r[col]);
const num = (r: Row, col: string): number => {
  const n = Number(raw(r, col));
  return Number.isFinite(n) ? n : 0;
};
const text = (r: Row, col: string): string => {
  const v = raw(r, col);
  return typeof v === "string" ? v.replace(/<[^>]*>/g, "").trim() : typeof v === "number" ? String(v) : "";
};

interface Table {
  version: string;
  total: number;
  rows: Row[];
}

/** One table of the v1 API: `query` is joined to the address; `extra` carries repeated filters (never credentials). */
async function table(c: ConnCtx, content: "devices" | "sensors", query: Record<string, string | number>, extra: [string, string | number][] = []): Promise<Table> {
  const qs = new URLSearchParams();
  qs.set("content", content);
  for (const [k, v] of Object.entries(query)) qs.set(k, String(v));
  for (const [k, v] of extra) qs.append(k, String(v));
  const res = await c.fetchJson<Row>(`api/table.json?${qs.toString()}`, { headers: { Authorization: `Bearer ${c.secret ?? ""}` } });
  const body = res.body;
  const rows = body && typeof body === "object" && !Array.isArray(body) ? body[content] : undefined;
  if (!Array.isArray(rows)) throw new ConnectorError("bad_response", PRTG_MESSAGES.notPrtg);
  return { version: String(body["prtg-version"] ?? ""), total: Number(body.treesize ?? rows.length) || 0, rows: rows as Row[] };
}

const startOf = (cursor: Cursor | null): number => {
  const s = cursor && typeof cursor === "object" && !Array.isArray(cursor) ? Number((cursor as { start?: number }).start ?? 0) : 0;
  return Number.isFinite(s) && s > 0 ? Math.floor(s) : 0;
};

/** Does a device row carry one of the connector's tags (any device when it names none)? */
const tagged = (r: Row, o: PrtgOptions): boolean => {
  if (!o.tags.length) return true;
  const wanted = o.tags.map((x) => x.toLowerCase());
  return text(r, "tags").toLowerCase().split(/[\s,]+/).some((x) => wanted.includes(x));
};

/** A page of devices in object-id order, filtered by the connector's tags. */
async function devices(c: ConnCtx, cursor: Cursor | null): Promise<{ rows: Row[]; listed: number; next: Cursor; total: number | undefined }> {
  const o = c.options as PrtgOptions;
  const start = startOf(cursor);
  const t = await table(c, "devices", { columns: DEVICE_COLUMNS, start, count: o.page_size, sortby: "objid", ...(o.group_id ? { id: o.group_id } : {}) });
  const rows = t.rows.filter((r) => tagged(r, o));
  const at = start + t.rows.length;
  // a page shorter than the tool's count of devices is not the last; an empty one always is
  const next = t.rows.length && at < t.total ? { start: at } : null;
  return { rows, listed: t.rows.length, next, total: o.tags.length ? undefined : t.total };
}

/** Which of these devices the connector lists (its tags), read a hundred a call: problems stay in the connector's scope. */
async function listedDevices(c: ConnCtx, ids: string[]): Promise<Set<string>> {
  const o = c.options as PrtgOptions;
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += PARENTS_PER_CALL) {
    const part = ids.slice(i, i + PARENTS_PER_CALL);
    const t = await table(c, "devices", { columns: "objid,tags", count: part.length }, part.map((id) => ["filter_objid", id]));
    for (const d of t.rows) if (tagged(d, o)) out.add(String(raw(d, "objid") ?? ""));
  }
  return out;
}

/** The primary sensor of each device (its first of the primary type, by object id). */
async function primaries(c: ConnCtx, deviceIds: string[]): Promise<Map<string, Row>> {
  const o = c.options as PrtgOptions;
  const out = new Map<string, Row>();
  for (let i = 0; i < deviceIds.length; i += PARENTS_PER_CALL) {
    const ids = deviceIds.slice(i, i + PARENTS_PER_CALL);
    const t = await table(c, "sensors", { columns: SENSOR_COLUMNS, filter_type: o.primary_sensor, count: Math.min(50_000, ids.length * 10), sortby: "objid" }, ids.map((id) => ["filter_parentid", id]));
    for (const s of t.rows) {
      const parent = String(raw(s, "parentid") ?? "");
      if (parent && !out.has(parent)) out.set(parent, s);
    }
  }
  return out;
}

function statusOf(d: Row, primary: Row | undefined): DiscoveredStatus {
  return prtgAvailability({
    device: num(d, "status") || null,
    primary: primary ? { status: num(primary, "status"), name: text(primary, "sensor") || undefined, message: text(primary, "message") || undefined } : null,
    down: num(d, "downsens") + num(d, "partialdownsens") + num(d, "downacksens"),
    warning: num(d, "warnsens") + num(d, "unusualsens"),
  });
}

/** The class of a device: its group, then its tags, named in `class_map`. */
function classOf(d: Row, map: Record<string, string>): string | undefined {
  const names = [text(d, "group"), ...text(d, "tags").split(/[\s,]+/)].filter(Boolean);
  const lower = new Map(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  for (const n of names) if (lower.has(n.toLowerCase())) return lower.get(n.toLowerCase());
  return undefined;
}

function deviceRecord(d: Row, primary: Row | undefined, withStatus: boolean, o: PrtgOptions): DiscoveredRecord {
  const host = text(d, "host");
  const ip = normaliseIp(host);
  const name = normaliseHost(host);
  const location = text(d, "location");
  const contact = primary ? oleDateIso(raw(primary, "lastup")) : undefined;
  const cls = classOf(d, o.class_map);
  return {
    external_id: String(raw(d, "objid")),
    kind: "device",
    name: text(d, "device") || host || String(raw(d, "objid")),
    ...(cls ? { class: cls } : {}),
    ...(ip ? { ips: [ip] } : name ? { hostname: name } : {}),
    ...(location ? { reported: { location } } : {}),
    ...(contact ? { last_contact_at: contact } : {}),
    ...(withStatus ? { status: statusOf(d, primary) } : {}),
  };
}

const collects = (c: ConnCtx, what: string) => !c.connector.collect?.length || c.connector.collect.includes(what);
const objid = (r: Row) => String(raw(r, "objid") ?? "");

async function page(c: ConnCtx, cursor: Cursor | null): Promise<Page> {
  const o = c.options as PrtgOptions;
  const d = await devices(c, cursor);
  const prim = await primaries(c, d.rows.map(objid).filter(Boolean));
  const withStatus = collects(c, "status");
  const good = d.rows.filter((r) => objid(r));
  const records = good.map((r) => deviceRecord(r, prim.get(objid(r)), withStatus, o));
  const rejected = d.rows.filter((r) => !objid(r)).map(() => ({ message: PRTG_MESSAGES.noObjid }));
  return { records, raw: good, next: d.next, complete: true, ...(rejected.length ? { rejected } : {}), ...(d.total !== undefined ? { total: d.total } : {}) };
}

async function statusPage(c: ConnCtx, cursor: Cursor | null): Promise<StatusPage> {
  const d = await devices(c, cursor);
  const prim = await primaries(c, d.rows.map(objid).filter(Boolean));
  const items = d.rows.filter((r) => objid(r)).map((r) => {
    const p = prim.get(objid(r));
    const contact = p ? oleDateIso(raw(p, "lastup")) : undefined;
    return { external_id: objid(r), status: statusOf(r, p), ...(contact ? { last_contact_at: contact } : {}) };
  });
  return { items, next: d.next };
}

/**
 * The complete open set: sensors in warning, unusual or down states, in object-id order by start/count, on the devices
 * the connector lists (its group by `id`, its tags by the devices' own rows). A problem is its sensor: a state change
 * (down → acknowledged, warning → down) keeps the problem and changes its severity (§9.6).
 */
async function problemsPage(c: ConnCtx, cursor: Cursor | null): Promise<ProblemPage> {
  const o = c.options as PrtgOptions;
  const start = startOf(cursor);
  const t = await table(
    c, "sensors", { columns: SENSOR_COLUMNS, start, count: o.page_size, sortby: "objid", ...(o.group_id ? { id: o.group_id } : {}) },
    PRTG_PROBLEM_STATES.map((s) => ["filter_status", s]),
  );
  const parentOf = (s: Row) => String(raw(s, "parentid") ?? "");
  let rows = t.rows.filter((s) => objid(s));
  if (o.tags.length) {
    const listed = await listedDevices(c, [...new Set(rows.map(parentOf).filter(Boolean))]);
    rows = rows.filter((s) => listed.has(parentOf(s)));
  }
  const problems: DiscoveredProblem[] = rows.map((s) => {
    const status = num(s, "status");
    const availability = String(raw(s, "type") ?? "").toLowerCase() === o.primary_sensor && (status === 5 || status === 13);
    const since = status === 5 || status === 13 || status === 14 ? oleDateIso(raw(s, "lastdown")) : undefined;
    const parent = parentOf(s);
    return {
      key: objid(s),
      ...(parent ? { external_id: parent } : {}),
      severity: prtgSeverity(status, availability),
      availability,
      message: [text(s, "sensor"), text(s, "message")].filter(Boolean).join(": ").slice(0, 500),
      ...(since ? { since } : {}),
    };
  });
  const at = start + t.rows.length;
  return { problems, next: t.rows.length && at < t.total ? { start: at } : null, complete: true };
}

/** PRTG's web interface for links: the connector's address as a folder. */
export function webBase(base: string | null | undefined): string | null {
  try {
    const u = new URL(String(base ?? ""));
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
    let path = u.pathname.replace(/[^/]*\.htm$/i, "");
    if (!path.endsWith("/")) path += "/";
    return `${u.origin}${path}`;
  } catch {
    return null;
  }
}

export const connector: ConnectorKind = {
  ...descriptor,
  headers: ["Authorization"],
  optionsSchema: prtgOptions,
  async test(c: ConnCtx): Promise<TestResult> {
    const o = c.options as PrtgOptions;
    const all = await table(c, "devices", { columns: "objid", count: 1, ...(o.group_id ? { id: o.group_id } : {}) });
    const warnings: string[] = [];
    if (!all.total) warnings.push(PRTG_MESSAGES.noDevices);
    else {
      const ping = await table(c, "sensors", { columns: "objid", count: 1, filter_type: o.primary_sensor, ...(o.group_id ? { id: o.group_id } : {}) });
      if (!ping.total) warnings.push(PRTG_MESSAGES.noPrimary(o.primary_sensor));
    }
    return { ok: true, ...(all.version ? { version: all.version } : {}), warnings };
  },
  pages: page,
  status: statusPage,
  problems: problemsPage,
  link(record, c) {
    const base = webBase(c.connector.base_url);
    return base && /^\d+$/.test(record.external_id) ? `${base}device.htm?id=${record.external_id}` : null;
  },
};
