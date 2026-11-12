// Outbound calls of connectors (design A §14.1): the `fetchJson`/`fetchText` a kind gets in its ConnCtx.
//
// Every call: the URL is joined to the connector's address and must keep its pinned host (or one of its extra hosts);
// no credentials in the address; https only — plain http only on the server edition with the connector's journaled
// «اتصال بدون رمزنگاری» tick; loopback and link-local hosts refused on every edition; only the kind's declared headers
// besides Accept and Content-Type (never Host, Cookie, Forwarded, X-Forwarded-*, X-Real-IP, X-Remote-User); 15 s per
// request; responses capped at 20 MB; redirects never on the web version and only to the same host (3 at most) on the
// server; Retry-After honoured up to 120 s (the runner reschedules the job, it never sleeps); `rate_per_second` per
// connector. The edition's own guard sits underneath: the web version's guardedFetch (public addresses only, checked
// again on the resolved addresses), the server edition's cfg.fetch (the air-gap allow-list).
//
// DA1 part 2 completes §14.1 here without changing this shape: the transport on node:https with the connector's CA,
// the server's own addresses and the database host refused, credentials only to hosts named exactly on the allow-list,
// refusals logged through the policy's onRefused.
import type { ServerConfig } from "../../context";
import { isLoopbackHost, lanAllowed, OutboundBlockedError } from "../../net";
import { guardedFetch } from "../ai/net";
import { BlockedAddressError } from "../ai/types";
import { ConnectorError, CONNECTOR_MESSAGES, type ConnectorView, type FetchInit, type FetchResult } from "./kind";

export const OUT_TIMEOUT_MS = 15_000;
export const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
export const MAX_RETRY_AFTER_MS = 120_000;
export const MAX_REDIRECTS = 3;

/** Headers never sent, whatever a kind declares (they would let a tool impersonate a proxy or a person). */
const FORBIDDEN_HEADER = /^(host|cookie2?|forwarded|x-forwarded-[a-z-]*|x-real-ip|x-remote-user|x-client-ip|true-client-ip|proxy-[a-z-]*|content-length|connection|transfer-encoding|te|upgrade|keep-alive)$/i;
/** Query parameters that carry credentials: refused in an address (they belong in the connector's key field). */
const CREDENTIAL_PARAM = /^(api[-_]?key|apitoken|passhash|token|password|passwd|access[-_]?token|secret)$/i;

export type Transport = (url: string, init: RequestInit) => Promise<Response>;
let override: Transport | null = null;

/** Tests put a mock tool behind the connector's address; every check above the transport still applies. */
export function setDiscoveryTransport(t: Transport | null): void {
  override = t;
}

export type RuntimeEdition = "cloud" | "server" | "desktop";

/** The edition this server is (§3): the Windows app, the server edition (its bridge), else the web version. */
export function editionOf(cfg: Pick<ServerConfig, "mode"> & Partial<Pick<ServerConfig, "server">>): RuntimeEdition {
  if (cfg.mode === "desktop") return "desktop";
  return cfg.server ? "server" : "cloud";
}

const normHost = (h: string) => h.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");

/** Link-local and unspecified literals (169.254/16, fe80::/10, 0.0.0.0, ::) besides loopback. */
function linkLocalOrAny(host: string): boolean {
  const h = normHost(host);
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

/** The fetch functions of one connector for one job (§14.1). `headers`: the kind's declared ones. */
export function connectorFetcher(cfg: Pick<ServerConfig, "mode" | "fetch"> & Partial<Pick<ServerConfig, "server" | "network">>, view: ConnectorView, headers: string[]): Fetcher {
  const edition = editionOf(cfg);
  const allowed = new Set(["accept", "content-type", ...headers.map((h) => h.toLowerCase())]);
  const transport: Transport = override ?? ((url, init) => (lanAllowed(cfg) ? cfg.fetch : guardedFetch(cfg.fetch))(url, init));

  async function call(path: string, init: FetchInit = {}, as: "json" | "text"): Promise<FetchResult<unknown>> {
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
      await takeSlot(view.id, view.rate_per_second);
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), OUT_TIMEOUT_MS);
      let res: Response;
      try {
        res = await transport(url.href, { method, headers: out, body, redirect: "manual", signal: ac.signal });
      } catch (e) {
        clearTimeout(timer);
        if (e instanceof ConnectorError) throw e;
        if (e instanceof BlockedAddressError || e instanceof OutboundBlockedError) throw new ConnectorError("refused", (e as Error).message);
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
