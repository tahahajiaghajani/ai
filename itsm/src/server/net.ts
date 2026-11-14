// Outbound HTTP of the server (AI providers, integrations, later monitoring and directory connectors): every
// call has a timeout and fails with a short Persian message naming the service, so one broken service never
// breaks a whole request. The fetch function comes from the server config (tests pass a stub). Addresses a
// person types are checked with `safeExternalUrl` before the cloud server is pointed at them.
import { DEMO_OUTBOUND_TEXT, DemoOutboundError } from "./db/scope";

export type Fetch = typeof fetch;

export class NetError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

export const TIMEOUT_MS = 10_000;

export async function fetchText(f: Fetch, url: string, label: string, init: RequestInit = {}, timeoutMs = TIMEOUT_MS): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await f(url, {
      ...init,
      signal: ac.signal,
      headers: { accept: "application/json", ...((init.headers as Record<string, string> | undefined) ?? {}) },
    });
    const text = await res.text();
    if (!res.ok) {
      const hint = res.status === 429 ? " (محدودیت تعداد درخواست؛ کمی بعد دوباره امتحان کنید)" : res.status === 403 || res.status === 451 ? " (دسترسی از این مکان بسته است)" : "";
      throw new NetError(`${label}: پاسخ ${res.status}${hint}`, res.status);
    }
    return text;
  } catch (e) {
    if (e instanceof NetError) throw e;
    // refused inside the demo pack's work before any connection (demoSafeFetch): said as such, not as a network failure
    if (e instanceof DemoOutboundError) throw new NetError(`${label}: ${DEMO_OUTBOUND_TEXT}`);
    if ((e as Error)?.name === "AbortError") throw new NetError(`${label}: پاسخی در ${Math.round(timeoutMs / 1000)} ثانیه نرسید`);
    throw new NetError(`${label}: اتصال برقرار نشد`);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T = any>(f: Fetch, url: string, label: string, init: RequestInit = {}, timeoutMs = TIMEOUT_MS): Promise<{ json: T; text: string }> {
  const text = await fetchText(f, url, label, init, timeoutMs);
  try {
    return { json: JSON.parse(text) as T, text };
  } catch {
    throw new NetError(`${label}: پاسخ معتبر نیست`);
  }
}

/**
 * Addresses of outside services are typed by an organisation's managers; refuse obvious internal targets so
 * the cloud server cannot be pointed at its own network. Null when the address may be used.
 */
export function safeExternalUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(String(raw ?? "").trim());
  } catch {
    return "نشانی معتبر نیست";
  }
  if (u.protocol !== "https:") return "نشانی باید با https:// شروع شود";
  // a trailing dot ("localhost.") names the same host
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || (!host.includes(".") && !host.includes(":"))) {
    return "نشانی داخلی مجاز نیست";
  }
  const privateV4 = (a: number, b: number) =>
    a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4 && privateV4(Number(v4[1]), Number(v4[2]))) return "نشانی داخلی مجاز نیست";
  if (host.includes(":")) {
    const groups = expandIpv6(host);
    if (!groups) return "نشانی معتبر نیست";
    const [g0] = groups;
    const zeros = (n: number) => groups.slice(0, n).every((g) => g === 0);
    // ::, ::1, unique-local fc00::/7, link-local fe80::/10, site-local fec0::/10, multicast ff00::/8
    if (zeros(8) || (zeros(7) && groups[7] === 1) || (g0 & 0xfe00) === 0xfc00 || (g0 & 0xffc0) === 0xfe80 || (g0 & 0xffc0) === 0xfec0 || (g0 & 0xff00) === 0xff00) {
      return "نشانی داخلی مجاز نیست";
    }
    // an IPv4 address carried inside IPv6: mapped ::ffff:a.b.c.d, compatible ::a.b.c.d, NAT64 64:ff9b::a.b.c.d
    const embedded = (zeros(5) && (groups[5] === 0xffff || groups[5] === 0)) || (g0 === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0)) || (g0 === 0x64 && groups[1] === 0xff9b && groups[2] === 1);
    if (embedded && privateV4(groups[6] >> 8, groups[6] & 0xff)) return "نشانی داخلی مجاز نیست";
  }
  return null;
}

/** Eight 16-bit groups of an IPv6 address (with an optional dotted IPv4 tail), or null. */
function expandIpv6(host: string): number[] | null {
  let h = host.split("%")[0];
  const tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (tail) {
    const b = tail.slice(1).map(Number);
    if (b.some((x) => x > 255)) return null;
    h = `${h.slice(0, tail.index)}${((b[0] << 8) | b[1]).toString(16)}:${((b[2] << 8) | b[3]).toString(16)}`;
  }
  const halves = h.split("::");
  if (halves.length > 2) return null;
  const part = (s: string) => (s ? s.split(":") : []);
  const head = part(halves[0]);
  const rest = halves.length === 2 ? part(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const all = [...head, ...Array(fill).fill("0"), ...rest];
  if (all.length !== 8 || all.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map((g) => parseInt(g, 16));
}

// ----- outbound network policy -------------------------------------------------------------------------------------
//
// Where outbound calls may go depends on the runtime:
// - the web version: public hosts only (SSRF guard: `safeExternalUrl`, modules/ai/net.ts `guardedFetch`);
// - the Windows app: anything, the office network included;
// - the server edition (a bank's intranet): the internal network, and with `airGapped` (its default) only the hosts on
//   the administrator's allowlist — internal AI servers (Ollama, vLLM), SMTP/Exchange, LDAP, webhooks. Everything else
//   is refused with a Persian message and logged. Loopback (a model server on the same machine) is always allowed.
// The server edition wraps `cfg.fetch` with `networkFetch` (every HTTP call of every module), checks SMTP/IMAP/LDAP
// hosts with `checkOutboundHost`, and installs a socket-level guard on top (src/server-edition/airgap.ts).

export interface NetworkPolicy {
  /** internal (private) addresses may be used: the organisation's own network */
  lan: boolean;
  /** only hosts on `allow` (and loopback) are reachable */
  airGapped: boolean;
  /** host names, `*.suffix` wildcards, IP addresses and CIDR ranges (IPv4 and IPv6) */
  allow: string[];
  /** called for every refused call (logging, «سلامت سرور») */
  onRefused?(host: string, label: string): void;
}

/** A call the air-gap policy refused (never retried). */
export class OutboundBlockedError extends NetError {
  readonly code = "air_gapped";
  constructor(public host: string, label = "") {
    super(`${label ? `${label}: ` : ""}دسترسی به «${host}» در حالت شبکهٔ بسته مجاز نیست؛ مدیر سامانه می‌تواند این میزبان را در پیکربندی سرور (network.allow) به فهرست مجاز بیفزاید`);
    this.name = "OutboundBlockedError";
  }
}

/**
 * May this runtime use internal (private, LAN) addresses? The Windows app and the server edition (an organisation's own
 * network); the web version reaches only public hosts.
 */
export function lanAllowed(cfg: { mode?: string; network?: NetworkPolicy | null } | null | undefined): boolean {
  return cfg?.mode === "desktop" || cfg?.network?.lan === true;
}

const normHost = (h: string) => h.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");

function ipv4ToInt(s: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const b = m.slice(1).map(Number);
  if (b.some((x) => x > 255)) return null;
  return ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
}

function ipv6ToBig(s: string): bigint | null {
  const g = expandIpv6(s);
  if (!g) return null;
  return g.reduce((acc, x) => (acc << 16n) | BigInt(x), 0n);
}

/** Is `ip` inside `cidr` ("10.0.0.0/8", "fd00::/8", or a single address)? */
export function ipInCidr(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  const v4 = ipv4ToInt(normHost(ip));
  const b4 = ipv4ToInt(normHost(base));
  if (v4 !== null && b4 !== null) {
    const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (v4 & mask) === (b4 & mask);
  }
  const v6 = ipv6ToBig(normHost(ip));
  const b6 = ipv6ToBig(normHost(base));
  if (v6 === null || b6 === null) return false;
  const bits = bitsRaw === undefined ? 128 : Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 128) return false;
  const mask = bits === 0 ? 0n : ((1n << 128n) - 1n) ^ ((1n << BigInt(128 - bits)) - 1n);
  return (v6 & mask) === (b6 & mask);
}

const isIpLiteral = (h: string) => ipv4ToInt(h) !== null || (h.includes(":") && expandIpv6(h) !== null);

/** Loopback: this machine itself (a model server or relay on the same server). */
export function isLoopbackHost(host: string): boolean {
  const h = normHost(host);
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (ipv4ToInt(h) !== null) return ipInCidr(h, "127.0.0.0/8");
  if (h.includes(":")) {
    const g = expandIpv6(h);
    if (!g) return false;
    if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true;
    // ::ffff:127.x.y.z
    return g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff && g[6] >> 8 === 127;
  }
  return false;
}

/** Is an allowlist entry well formed (a host name, *.suffix, IP or CIDR)? Null when it is. */
export function allowEntryProblem(entry: string): string | null {
  const e = normHost(entry);
  if (!e) return "خالی است";
  if (e.includes("/")) {
    const [base, bits] = e.split("/");
    const max = ipv4ToInt(base) !== null ? 32 : expandIpv6(base) ? 128 : -1;
    if (max < 0 || !/^\d{1,3}$/.test(bits) || Number(bits) > max) return "بازهٔ نشانی (CIDR) معتبر نیست";
    return null;
  }
  if (isIpLiteral(e)) return null;
  const name = e.startsWith("*.") ? e.slice(2) : e.startsWith(".") ? e.slice(1) : e;
  if (!/^(?=.{1,253}$)([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?)(\.[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?)*$/.test(name)) return "نام میزبان معتبر نیست";
  return null;
}

/**
 * Is `host` reachable under the policy? Names match exact entries and `*.suffix`/`.suffix` wildcards; IP addresses
 * (the host itself or, when given, every address the name resolves to) match IP and CIDR entries.
 */
export function hostAllowed(policy: NetworkPolicy | null | undefined, host: string, resolved: string[] = []): boolean {
  if (!policy?.airGapped) return true;
  const h = normHost(host);
  if (!h) return false;
  if (isLoopbackHost(h)) return true;
  const entries = policy.allow.map(normHost).filter(Boolean);
  const ipEntries = entries.filter((e) => e.includes("/") || isIpLiteral(e));
  if (isIpLiteral(h)) return ipEntries.some((e) => ipInCidr(h, e));
  for (const e of entries) {
    if (e === h) return true;
    if ((e.startsWith("*.") && h.endsWith(e.slice(1))) || (e.startsWith(".") && h.endsWith(e))) return true;
  }
  return resolved.length > 0 && resolved.every((ip) => isLoopbackHost(ip) || ipEntries.some((e) => ipInCidr(ip, e)));
}

/** Name resolution of the policy (tests replace it). */
export const policyNet = {
  lookup: async (host: string): Promise<string[]> => {
    const { lookup } = await import("node:dns/promises");
    return (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
  },
};

/** Does the allowlist have IP/CIDR entries (a name must then be resolved to be judged)? */
const hasIpEntries = (p: NetworkPolicy) => p.allow.some((e) => e.includes("/") || isIpLiteral(normHost(e)));

/**
 * Refuse a host the policy does not allow (SMTP, IMAP and LDAP clients, which do not use fetch). `label` names the
 * service in the message («سرور ایمیل»).
 */
export async function checkOutboundHost(policy: NetworkPolicy | null | undefined, host: string, label = ""): Promise<void> {
  if (!policy?.airGapped) return;
  if (hostAllowed(policy, host)) return;
  const h = normHost(host);
  if (!isIpLiteral(h) && hasIpEntries(policy)) {
    const addresses = await policyNet.lookup(h).catch(() => [] as string[]);
    if (hostAllowed(policy, h, addresses)) return;
  }
  policy.onRefused?.(h, label);
  throw new OutboundBlockedError(h, label);
}

/**
 * fetch under the policy: the URL's host is checked before the call, and redirects are followed by hand (at most 5)
 * so each hop is checked too. Used as the server edition's `cfg.fetch`.
 */
export function networkFetch(policy: NetworkPolicy, inner: Fetch): Fetch {
  const f = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!policy.airGapped) return inner(input, init);
    let url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    await checkOutboundHost(policy, url.hostname);
    const mode = init?.redirect ?? (input instanceof Request ? input.redirect : "follow");
    if (mode !== "follow") return inner(input, init);
    let req: RequestInfo | URL = input;
    let opts: RequestInit = { ...(init ?? {}), redirect: "manual" };
    for (let hop = 0; ; hop++) {
      const res = await inner(req, opts);
      const loc = res.status >= 300 && res.status < 400 && res.status !== 304 ? res.headers.get("location") : null;
      if (!loc) return res;
      if (hop >= 5) return res;
      await res.body?.cancel().catch(() => undefined);
      url = new URL(loc, url);
      await checkOutboundHost(policy, url.hostname);
      // 303 (and 301/302 after a POST) turn into a GET without a body, like fetch itself does
      const method = (opts.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      const toGet = res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST");
      opts = toGet ? { ...opts, method: "GET", body: undefined } : opts;
      req = url.href;
    }
  };
  return f as Fetch;
}

/** Run `fn` over items with at most `limit` in flight. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}
