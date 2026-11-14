// Outbound calls of connectors (design A §14.1, §14.2): the `fetchJson`/`fetchText` a kind gets in its ConnCtx.
//
// Every call, in this order — credentials are not sent before every check passed:
//   · the URL is joined to the connector's address and must keep its pinned host (or one of its extra hosts); no
//     credentials in the address; https only — plain http only on the server edition with the connector's journaled
//     «اتصال بدون رمزنگاری» tick; only the kind's declared headers besides Accept and Content-Type (never Host, Cookie,
//     Forwarded, X-Forwarded-*, X-Real-IP, X-Remote-User…);
//   · the host is resolved once and judged on its addresses, which the connection is then pinned to (no second lookup
//     a changed DNS answer could slip through): loopback, link-local, every address of this server itself, its public
//     name and the database server are refused on every edition, whatever the allowlist says («این نشانی به خود
//     سرور کاریز یا پایگاه داده‌اش می‌رسد…»); the web version reaches public addresses only; the server edition only
//     what its air-gap allowlist admits — and a connector that sends credentials only hosts the allowlist names
//     exactly (a name, or single addresses), never one reached through a wildcard or a range («برای فرستادن کلید…»).
//     Refusals go to the policy's `onRefused` («سلامت سرور») and the server log;
//   · the transport is node:https / node:http (no new dependency): TLS 1.2 or later, certificates always verified —
//     against the system roots plus the connector's own root (`ca_cert`, PEM) when it has one; a TLS failure answers
//     with its Persian cause; 15 s per request; responses capped at 20 MB; redirects never on the web version and only
//     to the same host (3 at most) on the server edition; Retry-After honoured up to 120 s (the runner reschedules the
//     job, it never sleeps); `rate_per_second` per connector; demo work never reaches the network.
// The server edition's socket guard (src/server-edition/airgap.ts) still sits underneath every connection.
import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import os from "node:os";
import { Readable } from "node:stream";
import tls from "node:tls";
import type { ServerConfig } from "../../context";
import type { Queryable } from "../../db";
import { assertNotDemoOutbound, DemoOutboundError } from "../../db/scope";
import { hostAllowed, ipInCidr, isLoopbackHost, lanAllowed, OutboundBlockedError, safeExternalUrl } from "../../net";
import { internalAddress } from "../ai/net";
import { BlockedAddressError } from "../ai/types";
import { caProblem } from "../integration/ldap";
import { ConnectorError, CONNECTOR_MESSAGES, type ConnectorView, type FetchInit, type FetchResult } from "./kind";

export const OUT_TIMEOUT_MS = 15_000;
export const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
export const MAX_RETRY_AFTER_MS = 120_000;
export const MAX_REDIRECTS = 3;
/** Requests one connector has in flight at most (§7.2). */
export const MAX_SOCKETS = 4;

/** Headers never sent, whatever a kind declares (they would let a tool impersonate a proxy or a person). */
const FORBIDDEN_HEADER = /^(host|cookie2?|forwarded|x-forwarded-[a-z-]*|x-real-ip|x-remote-user|x-client-ip|true-client-ip|proxy-[a-z-]*|content-length|connection|transfer-encoding|te|upgrade|keep-alive)$/i;
/** Query parameters that carry credentials: refused in an address (they belong in the connector's key field). */
const CREDENTIAL_PARAM = /^(api[-_]?key|apitoken|passhash|token|password|passwd|access[-_]?token|secret)$/i;

export type Transport = (url: string, init: RequestInit) => Promise<Response>;
let override: Transport | null = null;

/**
 * Tests put a mock tool behind the connector's address; every check above the transport still applies (with
 * `discoveryNet.lookup` answering for the mock's host name).
 */
export function setDiscoveryTransport(t: Transport | null): void {
  override = t;
}

/**
 * Name resolution, this server's own addresses and the dial of a checked address (tests replace them: a mock tool's
 * name resolves to a documentation address; the fixture-CA test dials the checked address on 127.0.0.1).
 */
export const discoveryNet = {
  lookup: async (host: string): Promise<string[]> => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address),
  selfAddresses: (): string[] => {
    const out: string[] = [];
    for (const list of Object.values(os.networkInterfaces())) for (const a of list ?? []) out.push(a.address);
    return out;
  },
  /** where the socket of a checked request goes (production: the checked addresses and the URL's port) */
  dial: (_host: string, port: number, addresses: string[]): { addresses: string[]; port: number } => ({ addresses, port }),
};

export type RuntimeEdition = "cloud" | "server" | "desktop";

/** The edition this server is (§3): the Windows app, the server edition (its bridge), else the web version. */
export function editionOf(cfg: Pick<ServerConfig, "mode"> & Partial<Pick<ServerConfig, "server">>): RuntimeEdition {
  if (cfg.mode === "desktop") return "desktop";
  return cfg.server ? "server" : "cloud";
}

const normHost = (h: string) => h.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
/** An address as compared here: lower case, no zone, an IPv4-mapped IPv6 address as its IPv4 form. */
const normAddr = (a: string) => normHost(a).split("%")[0].replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, "$1");
const isIpLiteral = (h: string) => isIP(normHost(h)) !== 0;

/** Link-local and unspecified literals (169.254/16, fe80::/10, 0.0.0.0, ::) besides loopback. */
function linkLocalOrAny(host: string): boolean {
  const h = normAddr(host);
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(h) || /^0+(\.0+){3}$/.test(h) || h === "::" || h === "0:0:0:0:0:0:0:0") return true;
  return /^fe[89ab][0-9a-f]?:/i.test(h);
}

/**
 * Why a connector's address may not be used (null when it may): an address that does not parse, credentials in it,
 * plain http where it is not allowed, a loopback or link-local host. Asked before every call and when it is saved.
 */
export function addressProblem(raw: string | URL | null | undefined, opts: { plainHttp: boolean; edition: RuntimeEdition }): string | null {
  if (!raw) return CONNECTOR_MESSAGES.noBaseUrl;
  let u: URL;
  try {
    u = raw instanceof URL ? raw : new URL(String(raw).trim());
  } catch {
    return "نشانی ابزار معتبر نیست";
  }
  if (u.username || u.password) return CONNECTOR_MESSAGES.credentialsInUrl;
  for (const k of u.searchParams.keys()) if (CREDENTIAL_PARAM.test(k)) return CONNECTOR_MESSAGES.credentialsInUrl;
  if (u.protocol === "http:") {
    if (!(opts.plainHttp && opts.edition === "server")) return CONNECTOR_MESSAGES.plainHttp;
  } else if (u.protocol !== "https:") return "نشانی ابزار باید با https:// شروع شود";
  if (isLoopbackHost(u.hostname) || linkLocalOrAny(u.hostname)) return CONNECTOR_MESSAGES.self;
  return null;
}

/** The hosts a connector may call: its address's host and its extra hosts. */
export function pinnedHosts(view: Pick<ConnectorView, "base_url" | "hosts">): Set<string> {
  const out = new Set<string>();
  try {
    if (view.base_url) out.add(normHost(new URL(view.base_url).hostname));
  } catch {
    /* refused by addressProblem */
  }
  for (const h of view.hosts ?? []) if (typeof h === "string" && h.trim()) out.add(normHost(h));
  return out;
}

/** The URL of a call: a path joined to the connector's address, or an absolute URL that must keep a pinned host. */
export function callUrl(view: Pick<ConnectorView, "base_url" | "hosts">, path: string, query: FetchInit["query"] = {}): URL {
  if (!view.base_url) throw new ConnectorError("config", CONNECTOR_MESSAGES.noBaseUrl);
  const base = new URL(view.base_url);
  // a path is taken under the address's own path (a tool behind a proxy prefix keeps it); a full URL (a tool's link
  // to its next page) must keep a pinned host
  const under = new URL(base.pathname.endsWith("/") ? base.href : `${base.origin}${base.pathname}/${base.search}`);
  const url = /^https?:\/\//i.test(path) ? new URL(path) : new URL(path.replace(/^\/+/, ""), under);
  if (!pinnedHosts(view).has(normHost(url.hostname))) throw new ConnectorError("refused", CONNECTOR_MESSAGES.otherHost);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null) continue;
    if (CREDENTIAL_PARAM.test(k)) throw new ConnectorError("refused", CONNECTOR_MESSAGES.credentialsInUrl);
    url.searchParams.set(k, String(v));
  }
  return url;
}

// ---------------------------------------------------------------------------------------------------------------
// Who the connection may reach (§14.1)

/** May credentials go to `host` (resolved to `addresses`) under the server edition's allowlist: is it named exactly? */
export function namedExactly(allow: readonly string[], host: string, addresses: readonly string[] = []): boolean {
  const h = normHost(host);
  const entries = allow.map(normHost).filter(Boolean);
  // a single address: a plain IP entry, or a range of exactly one (/32, /128)
  const single = (ip: string) => entries.some((e) => (e.includes("/") ? /\/(32|128)$/.test(e) && ipInCidr(ip, e) : isIpLiteral(e) && ipInCidr(ip, e)));
  if (isIpLiteral(h)) return single(normAddr(h));
  if (entries.includes(h)) return true;
  // a name the allowlist does not name: only when every address it resolves to is named on its own
  return addresses.length > 0 && addresses.every((a) => single(normAddr(a)));
}

/** This server itself: every address of its interfaces (cached a minute). */
let selfCache: { at: number; set: Set<string> } | null = null;
function selfAddresses(): Set<string> {
  if (!selfCache || Date.now() - selfCache.at > 60_000) selfCache = { at: Date.now(), set: new Set(discoveryNet.selfAddresses().map(normAddr)) };
  return selfCache.set;
}

/** The database server: the host names this process was given and the addresses it is connected to. */
export interface DbHosts {
  names: Set<string>;
  addresses: Set<string>;
}
const dbCache = new WeakMap<object, { at: number; hosts: Promise<DbHosts> }>();
const NO_DB = {};
const DB_CACHE_MS = 10 * 60_000;

/** Host names of the database URLs in the environment (the web version is given its database there). */
function envDbNames(): string[] {
  const out: string[] = [];
  for (const raw of [process.env.DATABASE_URL, process.env.SUPABASE_DB_URL, process.env.POSTGRES_URL]) {
    if (!raw) continue;
    try {
      const h = normHost(new URL(raw).hostname);
      if (h) out.push(h);
    } catch {
      /* not a URL */
    }
  }
  if (process.env.ITSM_DB_HOST) out.push(normHost(process.env.ITSM_DB_HOST));
  return out;
}

/**
 * The database host of this runtime (§14.1): the names it was configured with and every address they resolve to,
 * plus the address the database itself answers on (`inet_server_addr()`; none for the Windows app's embedded
 * database). Cached ten minutes per database.
 */
export function databaseHosts(db: Queryable | null | undefined): Promise<DbHosts> {
  const key = (db ?? NO_DB) as object;
  const hit = dbCache.get(key);
  if (hit && Date.now() - hit.at < DB_CACHE_MS) return hit.hosts;
  const hosts = (async () => {
    const names = new Set(envDbNames());
    const addresses = new Set<string>();
    if (db) {
      const r = await db.one<{ a: string | null }>(`select host(inet_server_addr()) as a`).catch(() => null);
      if (r?.a) addresses.add(normAddr(r.a));
    }
    for (const n of names) {
      if (isIpLiteral(n)) addresses.add(normAddr(n));
      else for (const a of await discoveryNet.lookup(n).catch(() => [] as string[])) addresses.add(normAddr(a));
    }
    return { names, addresses };
  })();
  dbCache.set(key, { at: Date.now(), hosts });
  return hosts;
}

/** Tests: the database host a runtime is to refuse (replaces what `databaseHosts` found for `db`). */
export function setDatabaseHosts(db: Queryable | null | undefined, hosts: { names?: string[]; addresses?: string[] } | null): void {
  const key = (db ?? NO_DB) as object;
  if (!hosts) dbCache.delete(key);
  else dbCache.set(key, { at: Date.now() + 365 * 86_400_000, hosts: Promise.resolve({ names: new Set((hosts.names ?? []).map(normHost)), addresses: new Set((hosts.addresses ?? []).map(normAddr)) }) });
}

/** Forget the cached addresses of this server and the connectors' connections (tests). */
export function resetDiscoveryNet(): void {
  selfCache = null;
  for (const a of agents.values()) a.destroy();
  agents.clear();
  nextSlot.clear();
}

export type NetConfig = Pick<ServerConfig, "mode"> & Partial<Pick<ServerConfig, "server" | "network" | "db" | "publicUrl" | "log" | "fetch">>;

/** The refusal of one host: logged, counted on «سلامت سرور» (the policy's onRefused) and answered in Persian. */
function refuse(cfg: NetConfig, host: string, reason: string, message: string): never {
  try {
    cfg.network?.onRefused?.(host, `discovery:${reason}`);
  } catch {
    /* the hook never decides the answer */
  }
  cfg.log?.warn?.("discovery outbound call refused", { host, reason });
  throw new ConnectorError("refused", message);
}

/**
 * Judge the host of one request (§14.1) and answer the addresses its connection is pinned to: the self and database
 * refusal on every edition, public addresses only on the web version, the air-gap allowlist on the server edition and
 * the exact-name rule for a connector that sends credentials. `checked` keeps a host's answer for one fetcher.
 */
export async function checkHost(cfg: NetConfig, host: string, opts: { credentialed: boolean; checked?: Map<string, string[]> }): Promise<string[]> {
  const h = normHost(host);
  const cached = opts.checked?.get(h);
  if (cached) return cached;
  const edition = editionOf(cfg);
  if (edition === "desktop") throw new ConnectorError("refused", CONNECTOR_MESSAGES.desktop);
  const db = await databaseHosts(cfg.db);
  let publicName = "";
  try {
    publicName = cfg.publicUrl ? normHost(new URL(cfg.publicUrl).hostname) : "";
  } catch {
    publicName = "";
  }
  if (isLoopbackHost(h) || linkLocalOrAny(h) || db.names.has(h) || (publicName && h === publicName)) refuse(cfg, h, "self", CONNECTOR_MESSAGES.self);
  let addresses: string[];
  if (isIpLiteral(h)) addresses = [normAddr(h)];
  else {
    try {
      addresses = (await discoveryNet.lookup(h)).map(normAddr);
    } catch {
      throw new ConnectorError("network", CONNECTOR_MESSAGES.notFound(h));
    }
    if (!addresses.length) throw new ConnectorError("network", CONNECTOR_MESSAGES.notFound(h));
  }
  const self = selfAddresses();
  if (addresses.some((a) => isLoopbackHost(a) || linkLocalOrAny(a) || self.has(a) || db.addresses.has(a))) refuse(cfg, h, "self", CONNECTOR_MESSAGES.self);
  // the web version: public hosts only (the SSRF guard's rules, judged on the addresses the connection will use)
  if (!lanAllowed(cfg) && (safeExternalUrl(`https://${h.includes(":") ? `[${h}]` : h}/`) || addresses.some(internalAddress))) refuse(cfg, h, "web", CONNECTOR_MESSAGES.webPrivate);
  if (cfg.network?.airGapped && !hostAllowed(cfg.network, h, addresses)) refuse(cfg, h, "allow", CONNECTOR_MESSAGES.notAllowed(h));
  // credentials only to hosts the server administrator named (never through a wildcard or a range)
  if (edition === "server" && opts.credentialed && !namedExactly(cfg.network?.allow ?? [], h, addresses)) refuse(cfg, h, "exact", CONNECTOR_MESSAGES.exactName);
  opts.checked?.set(h, addresses);
  return addresses;
}

/**
 * «آزمودن اتصال»'s first step (§14.1): may this connector reach its hosts at all? The address, then every pinned host
 * against the refusals and the allowlist — before anything is sent. The Persian cause, or null.
 */
export async function reachProblem(cfg: NetConfig, view: Pick<ConnectorView, "base_url" | "hosts" | "plain_http">, opts: { credentialed: boolean }): Promise<string | null> {
  const edition = editionOf(cfg);
  if (edition === "desktop") return CONNECTOR_MESSAGES.desktop;
  const problem = addressProblem(view.base_url, { plainHttp: view.plain_http, edition });
  if (problem) return problem;
  for (const host of pinnedHosts(view)) {
    try {
      await checkHost(cfg, host, { credentialed: opts.credentialed });
    } catch (e) {
      if (e instanceof ConnectorError) return e.message;
      throw e;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// TLS (§14.2)

/** The roots a connector trusts by default: the system store when the process runs with it (--use-system-ca). */
function defaultRoots(): string[] {
  const get = (tls as unknown as { getCACertificates?: (kind?: string) => string[] }).getCACertificates;
  try {
    if (typeof get === "function") return get("default");
  } catch {
    /* an older Node */
  }
  return [...tls.rootCertificates];
}

/** The Persian cause of a TLS failure with a tool (the LDAP client's tlsProblem, worded for connectors), or null. */
export function tlsMessage(host: string, e: NodeJS.ErrnoException): string | null {
  const code = String(e.code ?? "");
  const text = String(e.message ?? "");
  if (/ALTNAME|HOSTNAME|ERR_TLS_CERT_ALTNAME_INVALID/.test(code)) return `نام میزبان (${host}) با نام‌های گواهی ابزار هم‌خوان نیست؛ نشانی را با همان نامی بنویسید که در گواهی ابزار آمده است`;
  if (/EXPIRED/.test(code)) return `گواهی ابزار (${host}) منقضی شده است`;
  if (/NOT_YET_VALID/.test(code)) return `گواهی ابزار (${host}) هنوز معتبر نشده است (ساعت سرورها را بررسی کنید)`;
  if (/SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|CERT_UNTRUSTED|CERT_SIGNATURE_FAILURE|CERT_CHAIN|CERT_REJECTED/.test(code)) {
    return `گواهی ابزار (${host}) را مرجع معتبری امضا نکرده است؛ گواهی ریشهٔ سازمان (PEM) را در «گواهی ریشهٔ ابزار» وارد کنید`;
  }
  if (/WRONG_VERSION|UNKNOWN_PROTOCOL|PACKET_LENGTH|HTTP_REQUEST|ERR_SSL|EPROTO/.test(code) || /wrong version|unknown protocol|ssl routines/i.test(text)) {
    return `${host} در این درگاه اتصال امن (TLS) را نمی‌شناسد؛ نشانی و درگاه ابزار را بررسی کنید`;
  }
  return null;
}

/** Keep-alive agents per connector, protocol and root (a few sockets each, closed after 30 idle seconds). */
const agents = new Map<string, http.Agent>();
const MAX_AGENTS = 64;

function agentFor(view: Pick<ConnectorView, "id" | "ca_cert">, protocol: string): http.Agent {
  const pem = String(view.ca_cert ?? "").trim();
  const key = `${protocol}|${view.id}|${pem ? createHash("sha256").update(pem).digest("hex") : ""}`;
  let a = agents.get(key);
  if (a) return a;
  if (protocol === "https:") {
    if (pem) {
      const problem = caProblem(pem);
      if (problem) throw new ConnectorError("config", problem);
    }
    // certificates are always verified: there is no option to turn it off (bank rule, §14.2)
    a = new https.Agent({ keepAlive: true, maxSockets: MAX_SOCKETS, timeout: 30_000, minVersion: "TLSv1.2", ...(pem ? { ca: [...defaultRoots(), pem] } : {}) });
  } else a = new http.Agent({ keepAlive: true, maxSockets: MAX_SOCKETS, timeout: 30_000 });
  if (agents.size >= MAX_AGENTS) {
    const [oldest] = agents.keys();
    agents.get(oldest)?.destroy();
    agents.delete(oldest);
  }
  agents.set(key, a);
  return a;
}

const NULL_BODY = new Set([101, 204, 205, 304]);

/** One request on node:https / node:http, its connection pinned to the checked addresses. */
function nodeRequest(url: URL, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }, addresses: string[], agent: http.Agent): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    const dial = discoveryNet.dial(host, port, addresses);
    const literal = isIP(host) !== 0;
    const lookup = (_name: string, o: unknown, cb: (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void) => {
      const all = dial.addresses.map((a) => ({ address: a, family: isIP(a) || 4 }));
      if (o && typeof o === "object" && (o as { all?: boolean }).all) cb(null, all);
      else cb(null, all[0].address, all[0].family);
    };
    const headers: Record<string, string> = { ...init.headers, host: url.host };
    if (init.body !== undefined) headers["content-length"] = String(Buffer.byteLength(init.body));
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request({
      protocol: url.protocol,
      host: literal ? dial.addresses[0] : host,
      port: dial.port,
      path: `${url.pathname}${url.search}`,
      method: init.method,
      headers,
      agent,
      ...(literal ? {} : { lookup: lookup as never }),
      signal: init.signal,
      ...(url.protocol === "https:" && !literal ? { servername: host } : {}),
    });
    req.on("response", (res) => {
      const status = res.statusCode ?? 0;
      const h = new Headers();
      for (let i = 0; i + 1 < res.rawHeaders.length; i += 2) {
        try {
          h.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
        } catch {
          /* a header value fetch would refuse */
        }
      }
      const empty = NULL_BODY.has(status) || init.method === "HEAD";
      if (empty) res.resume();
      try {
        resolve(new Response(empty ? null : (Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>), { status: status >= 200 && status <= 599 ? status : 502, headers: h }));
      } catch (e) {
        res.destroy();
        reject(e);
      }
    });
    req.on("error", (e: NodeJS.ErrnoException) => {
      const why = url.protocol === "https:" ? tlsMessage(host, e) : null;
      reject(why ? new ConnectorError("config", why) : e);
    });
    if (init.body !== undefined) req.end(init.body);
    else req.end();
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Calls

/** The rate limit per connector in this process: `rate_per_second` calls a second, as a token bucket of one second. */
const nextSlot = new Map<string, number>();
async function takeSlot(id: string, rate: number): Promise<void> {
  const gap = 1000 / Math.max(1, Math.min(100, rate || 5));
  const now = Date.now();
  const at = Math.max(now, nextSlot.get(id) ?? 0);
  nextSlot.set(id, at + gap);
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

function retryAfter(res: Response): number | undefined {
  const raw = res.headers.get("retry-after");
  if (!raw) return undefined;
  const secs = Number(raw);
  const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(raw) - Date.now();
  return Number.isFinite(ms) ? Math.max(1000, Math.min(MAX_RETRY_AFTER_MS, ms)) : undefined;
}

async function readCapped(res: Response): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await res.body?.cancel().catch(() => undefined);
    throw new ConnectorError("bad_response", CONNECTOR_MESSAGES.tooLarge);
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new ConnectorError("bad_response", CONNECTOR_MESSAGES.tooLarge);
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8").decode(Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength))));
}

export interface Fetcher {
  fetchJson<T = unknown>(path: string, init?: FetchInit): Promise<FetchResult<T>>;
  fetchText(path: string, init?: FetchInit): Promise<FetchResult<string>>;
}

export interface FetcherOptions {
  /** the connector sends credentials (a stored key or password, NTLM, Negotiate): exact allowlist names only (§14.1) */
  credentialed?: boolean;
}

/** The fetch functions of one connector for one job (§14.1). `headers`: the kind's declared ones. */
export function connectorFetcher(cfg: NetConfig, view: ConnectorView, headers: string[], opts: FetcherOptions = {}): Fetcher {
  const edition = editionOf(cfg);
  const allowed = new Set(["accept", "content-type", ...headers.map((h) => h.toLowerCase())]);
  const checked = new Map<string, string[]>();
  const credentialed = !!opts.credentialed;

  async function call(path: string, init: FetchInit = {}, as: "json" | "text"): Promise<FetchResult<unknown>> {
    // nothing of the demo pack leaves the system (§14.4): demo work never calls out
    try {
      assertNotDemoOutbound();
    } catch (e) {
      if (e instanceof DemoOutboundError) throw new ConnectorError("refused", CONNECTOR_MESSAGES.demo);
      throw e;
    }
    if (edition === "desktop") throw new ConnectorError("refused", CONNECTOR_MESSAGES.desktop);
    const problem = addressProblem(view.base_url, { plainHttp: view.plain_http, edition });
    if (problem) throw new ConnectorError(problem === CONNECTOR_MESSAGES.noBaseUrl ? "config" : "refused", problem);
    const out: Record<string, string> = { accept: as === "json" ? "application/json" : "*/*" };
    for (const [k, v] of Object.entries(init.headers ?? {})) {
      if (FORBIDDEN_HEADER.test(k) || !allowed.has(k.toLowerCase())) throw new ConnectorError("refused", CONNECTOR_MESSAGES.header(k));
      out[k] = String(v);
    }
    let body: string | undefined;
    if (init.body !== undefined) {
      body = JSON.stringify(init.body);
      out["content-type"] = "application/json";
    }
    let url = callUrl(view, path, init.query);
    let method = init.method ?? "GET";
    for (let hop = 0; ; hop++) {
      const problemHere = addressProblem(url, { plainHttp: view.plain_http, edition });
      if (problemHere) throw new ConnectorError("refused", problemHere);
      // every check before anything — credentials included — is sent
      const addresses = await checkHost(cfg, url.hostname, { credentialed, checked });
      await takeSlot(view.id, view.rate_per_second);
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), OUT_TIMEOUT_MS);
      let res: Response;
      try {
        res = override
          ? await override(url.href, { method, headers: out, body, redirect: "manual", signal: ac.signal })
          : await nodeRequest(url, { method, headers: out, body, signal: ac.signal }, addresses, agentFor(view, url.protocol));
      } catch (e) {
        clearTimeout(timer);
        if (e instanceof ConnectorError) throw e;
        if (e instanceof BlockedAddressError || e instanceof OutboundBlockedError) throw new ConnectorError("refused", (e as Error).message);
        if ((e as { code?: string })?.code === "EAIRGAP") throw new ConnectorError("refused", CONNECTOR_MESSAGES.notAllowed(normHost(url.hostname)));
        throw new ConnectorError("network", CONNECTOR_MESSAGES.noAnswer(view.name));
      }
      try {
        if (res.status >= 300 && res.status < 400 && res.status !== 304) {
          const loc = res.headers.get("location");
          await res.body?.cancel().catch(() => undefined);
          // the web version follows no redirect; the server edition only to the same host, a few times
          if (!loc || edition !== "server" || hop >= MAX_REDIRECTS) throw new ConnectorError("refused", CONNECTOR_MESSAGES.redirect);
          const next = new URL(loc, url);
          if (!pinnedHosts(view).has(normHost(next.hostname)) || normHost(next.hostname) !== normHost(url.hostname)) throw new ConnectorError("refused", CONNECTOR_MESSAGES.redirect);
          url = next;
          if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
            method = "GET";
            body = undefined;
            delete out["content-type"];
          }
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          await res.body?.cancel().catch(() => undefined);
          throw new ConnectorError("auth", CONNECTOR_MESSAGES.auth, { status: res.status });
        }
        if (res.status === 429) {
          await res.body?.cancel().catch(() => undefined);
          throw new ConnectorError("rate_limited", CONNECTOR_MESSAGES.noAnswer(view.name), { status: 429, retryAfterMs: retryAfter(res) ?? 30_000 });
        }
        if (res.status >= 500) {
          await res.body?.cancel().catch(() => undefined);
          throw new ConnectorError("network", CONNECTOR_MESSAGES.noAnswer(view.name), { status: res.status, retryAfterMs: retryAfter(res) });
        }
        if (res.status >= 400) {
          await res.body?.cancel().catch(() => undefined);
          throw new ConnectorError("bad_response", CONNECTOR_MESSAGES.status(res.status), { status: res.status });
        }
        const text = await readCapped(res);
        const headersOut: Record<string, string> = {};
        res.headers.forEach((v, k) => (headersOut[k] = v));
        if (as === "text") return { status: res.status, headers: headersOut, body: text, url: url.href };
        try {
          return { status: res.status, headers: headersOut, body: text.trim() ? JSON.parse(text) : null, url: url.href };
        } catch {
          throw new ConnectorError("bad_response", CONNECTOR_MESSAGES.badJson, { status: res.status });
        }
      } catch (e) {
        if (e instanceof ConnectorError) throw e;
        if ((e as Error)?.name === "AbortError") throw new ConnectorError("network", CONNECTOR_MESSAGES.noAnswer(view.name));
        throw new ConnectorError("network", CONNECTOR_MESSAGES.noAnswer(view.name));
      } finally {
        clearTimeout(timer);
      }
    }
  }

  return {
    fetchJson: <T>(path: string, init?: FetchInit) => call(path, init, "json") as Promise<FetchResult<T>>,
    fetchText: (path: string, init?: FetchInit) => call(path, init, "text") as Promise<FetchResult<string>>,
  };
}
