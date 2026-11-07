// Outbound requests to AI providers from the web version (SSRF guard). The base URL is checked as
// text when it is saved (src/server/net.ts safeExternalUrl), and again on every request here: the host name
// must resolve to public addresses only (a name such as 127.0.0.1.nip.io or one with an A record
// to 10.x/169.254.169.254 is refused), and redirects are never followed (a public host answering
// 30x to an internal address gets nothing). The Windows app is exempt: it may use LAN servers.
//
// Remaining gap: the address is resolved once here and again by fetch itself, so a name that
// changes its answer between the two lookups (DNS rebinding with a zero TTL) is not caught.
// Closing it needs pinning the checked address in the HTTP agent, which Node's built-in fetch
// does not expose without the undici package.
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { safeExternalUrl } from "../../net";
import { BlockedAddressError, ProviderError } from "./types";

/** Name resolution used by the guard (tests replace it to stay off the network). */
export const aiNet = {
  lookup: async (host: string): Promise<string[]> => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address),
};

/** Is this IP address loopback, private, link-local, CGNAT, multicast or otherwise internal? */
export function internalAddress(ip: string): boolean {
  const host = ip.includes(":") ? `[${ip.split("%")[0]}]` : ip;
  return !!safeExternalUrl(`https://${host}/`);
}

function urlOf(input: RequestInfo | URL): URL {
  if (typeof input === "string") return new URL(input);
  if (input instanceof URL) return input;
  return new URL(input.url);
}

/** fetch for provider calls on the web version: public hosts only, no redirects. */
export function guardedFetch(inner: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    let url: URL;
    try {
      url = urlOf(input);
    } catch {
      throw new BlockedAddressError("نشانی سرویس معتبر نیست");
    }
    if (safeExternalUrl(url.href)) throw new BlockedAddressError("نشانی داخلی در نسخهٔ وب مجاز نیست");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (!isIP(host)) {
      let addresses: string[];
      try {
        addresses = await aiNet.lookup(host);
      } catch {
        // a failed lookup may be passing (EAI_AGAIN): an ordinary network error, retried once
        throw new ProviderError("network", `نشانی سرویس پیدا نشد (${host})`);
      }
      if (!addresses.length || addresses.some(internalAddress)) throw new BlockedAddressError("نشانی سرویس به یک نشانی داخلی می‌رسد و در نسخهٔ وب مجاز نیست");
    }
    const res = await inner(input, { ...(init ?? {}), redirect: "manual" });
    if (res.status >= 300 && res.status < 400 && res.status !== 304) {
      await res.body?.cancel().catch(() => undefined);
      throw new BlockedAddressError(`سرویس به نشانی دیگری ارجاع داد (HTTP ${res.status})؛ نشانی دقیق سرویس را وارد کنید`, res.status);
    }
    return res;
  }) as typeof fetch;
}
