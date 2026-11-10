// The socket-level air-gap guard of the server edition: defence in depth under the fetch-level policy
// (src/server/net.ts networkFetch / checkOutboundHost). Every TCP connection this process opens — fetch (undici),
// http.request, SMTP (nodemailer), IMAP, LDAP, a library's telemetry — goes through net.Socket#connect; a destination
// that is not loopback, not the database and not on the allowlist is refused with EAIRGAP (and logged) before any
// packet leaves. Names allowed only through an IP/CIDR entry are checked again on the addresses they resolve to.
import net from "node:net";
import dns from "node:dns";
import { hostAllowed, isLoopbackHost, type NetworkPolicy } from "@server/net";

type ConnectFn = (this: net.Socket, ...args: unknown[]) => net.Socket;

interface Installed {
  policy: NetworkPolicy;
  /** hosts always reachable besides loopback (the database server) */
  extra: Set<string>;
  original: ConnectFn;
  onRefused: (host: string, port: number | null) => void;
}

let state: Installed | null = null;

/** An error like a refused connection, with code EAIRGAP. */
export class AirGapError extends Error {
  code = "EAIRGAP";
  constructor(public host: string, public port: number | null) {
    super(`air-gapped: connection to ${host}${port ? `:${port}` : ""} refused (not on network.allow)`);
  }
}

interface ConnectOptions {
  host?: string;
  port?: number | string;
  path?: string;
  lookup?: typeof dns.lookup;
}

/** The options object of Socket#connect's argument forms (already-normalised array, options, port/host, path). */
function optionsOf(args: unknown[]): ConnectOptions | null {
  const a0 = args[0];
  if (Array.isArray(a0)) return (a0[0] as ConnectOptions) ?? null;
  if (a0 && typeof a0 === "object") return a0 as ConnectOptions;
  if (typeof a0 === "number" || (typeof a0 === "string" && /^\d+$/.test(a0))) return { port: a0, host: typeof args[1] === "string" ? args[1] : "localhost" };
  if (typeof a0 === "string") return { path: a0 };
  return null;
}

const hasIpEntries = (p: NetworkPolicy) => p.allow.some((e) => e.includes("/") || net.isIP(e.replace(/^\[|\]$/g, "")) !== 0);

function allowedNow(s: Installed, host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  return isLoopbackHost(h) || s.extra.has(h) || hostAllowed(s.policy, h);
}

/** Install (or update) the guard for this process. */
export function installSocketGuard(policy: NetworkPolicy, opts: { extraHosts?: string[]; onRefused?: (host: string, port: number | null) => void } = {}): void {
  const extra = new Set((opts.extraHosts ?? []).map((h) => h.toLowerCase().replace(/^\[|\]$/g, "")));
  const onRefused = opts.onRefused ?? (() => {});
  if (state) {
    state.policy = policy;
    state.extra = extra;
    state.onRefused = onRefused;
    return;
  }
  const original = net.Socket.prototype.connect as unknown as ConnectFn;
  state = { policy, extra, original, onRefused };
  const guarded: ConnectFn = function (this: net.Socket, ...args: unknown[]) {
    const s = state;
    const o = s?.policy.airGapped ? optionsOf(args) : null;
    if (!s || !o || o.path) return original.apply(this, args);
    const host = String(o.host ?? "localhost");
    const port = o.port === undefined ? null : Number(o.port);
    if (allowedNow(s, host)) return original.apply(this, args);
    const refuse = () => {
      s.onRefused(host, port);
      const err = new AirGapError(host, port);
      process.nextTick(() => this.destroy(err));
      return this;
    };
    // an IP literal or a name with no IP/CIDR entries that could admit it: refused at once
    if (net.isIP(host.replace(/^\[|\]$/g, "")) || !hasIpEntries(s.policy)) return refuse();
    // a name: allowed only when every address it resolves to is allowed (checked on the actual lookup)
    const inner = o.lookup ?? dns.lookup;
    o.lookup = ((hostname: string, lopts: dns.LookupOptions, cb: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void) => {
      inner(hostname, lopts, (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => {
        if (err) return cb(err, address, family);
        const list = Array.isArray(address) ? address.map((a) => a.address) : [address];
        if (!list.length || !hostAllowed(s.policy, hostname, list)) {
          s.onRefused(hostname, port);
          return cb(new AirGapError(hostname, port) as unknown as NodeJS.ErrnoException, address, family);
        }
        cb(null, address, family);
      });
    }) as unknown as typeof dns.lookup;
    return original.apply(this, args);
  };
  net.Socket.prototype.connect = guarded as unknown as typeof net.Socket.prototype.connect;
}

/** Remove the guard (tests). */
export function uninstallSocketGuard(): void {
  if (!state) return;
  net.Socket.prototype.connect = state.original as unknown as typeof net.Socket.prototype.connect;
  state = null;
}
