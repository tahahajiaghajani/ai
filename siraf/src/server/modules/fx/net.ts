// Outbound HTTP for live prices and blockchain lookups: every call has a 10-second timeout and
// fails with a short Persian message naming the service, so one broken provider never breaks
// a whole refresh. The fetch function comes from the server config (tests pass a stub).
import { D } from "@shared/money";

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

/** POST a JSON-RPC 2.0 call and return `result` (throws on `error`). */
export async function jsonRpc<T = any>(f: Fetch, url: string, label: string, method: string, params: unknown[]): Promise<{ result: T; text: string }> {
  const { json, text } = await fetchJson<{ result?: T; error?: { message?: string } }>(f, url, label, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (json?.error) throw new NetError(`${label}: ${String(json.error.message ?? "خطای سرویس").slice(0, 120)}`);
  if (json?.result === undefined) throw new NetError(`${label}: پاسخ بدون نتیجه`);
  return { result: json.result as T, text };
}

/** An integer field that may exceed JavaScript's safe range: read it from the raw text when needed. */
export function bigIntField(value: unknown, text: string, key: string): string {
  if (typeof value === "string" && /^-?\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  const m = new RegExp(`"${key}"\\s*:\\s*"?(-?\\d+)`).exec(text);
  if (m) return m[1];
  if (typeof value === "number" && Number.isFinite(value)) return D(value).toFixed(0);
  return "0";
}

/** Integer amount in the smallest unit → decimal string (e.g. 150000000 sats → "1.5"). */
export function fromUnits(raw: string | bigint, decimals: number): string {
  const s = typeof raw === "bigint" ? raw.toString() : raw;
  return D(s).div(D(10).pow(decimals)).toFixed();
}

export function hexToDec(hex: string): string {
  const h = String(hex ?? "").trim();
  if (!/^0x[0-9a-fA-F]*$/.test(h)) throw new NetError("پاسخ عددی نامعتبر");
  if (h === "0x") return "0";
  return BigInt(h).toString();
}

/** Value at a dotted path inside parsed JSON (`data.0.price`, `stats.usdt-rls.latest`). */
export function pickPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".").map((p) => p.trim()).filter(Boolean)) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) cur = cur[Number(part)];
    else if (typeof cur === "object") cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return cur;
}

/**
 * Custom price sources are typed by the business owner; refuse obvious internal targets so the
 * cloud server cannot be pointed at its own network.
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
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".") && !host.includes(":")) {
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
