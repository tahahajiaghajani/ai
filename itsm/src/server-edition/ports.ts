// The ports of the server edition's installer (karizctl preflight, run by install.ps1 before anything is changed):
// HTTPS, HTTP and the bundled PostgreSQL. A port given on the command line (PORT= / HTTPPORT= / PGPORT=) is used as
// given and a busy one stops the install with a clear message; one kept in kariz.json (re-install, upgrade) stays;
// otherwise the first free port of a fixed list is taken, so a laptop where IIS, Skype, VMware, Docker or a local
// PostgreSQL already holds 443 / 80 / 5432 still installs (on 8443 / 8080 / 5433 …). choosePorts is pure; the probe
// (a real bind, plus the listeners netstat shows on Windows) lives beside it.
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";

export type PortKind = "https" | "http" | "pg";

/** The fixed fallback lists, in order: the first free one is taken when a port was not given. */
export const PORT_CANDIDATES: Record<PortKind, readonly number[]> = {
  https: [443, 8443, 9443, 10443, 11443, 12443, 13443, 14443],
  http: [80, 8080, 8081, 8082, 8083, 8084, 8085, 8086, 8087, 8088],
  pg: [5432, 5433, 5434, 5435, 5436, 5437, 5438, 5439],
};

export const PORT_LABEL: Record<PortKind, string> = { https: "HTTPS", http: "HTTP", pg: "PostgreSQL" };
/** The MSI property (and install.ps1 parameter) that sets each port. */
export const PORT_PROPERTY: Record<PortKind, string> = { https: "PORT", http: "HTTPPORT", pg: "PGPORT" };

export type PortSetting = { mode: "auto" } | { mode: "fixed"; port: number } | { mode: "off" };

export class PortSettingError extends Error {}

/**
 * A PORT= / HTTPPORT= / PGPORT= value: empty or «auto» (any case) → chosen automatically; 1–65535 → that port;
 * 0 → HTTP off (HTTP only: HTTPS and PostgreSQL always listen).
 */
export function parsePortSetting(raw: string | number | undefined | null, kind: PortKind): PortSetting {
  const v = String(raw ?? "").trim();
  if (!v || v.toLowerCase() === "auto") return { mode: "auto" };
  if (!/^\d{1,5}$/.test(v)) throw new PortSettingError(`${PORT_PROPERTY[kind]}=${v} is not a port: give auto${kind === "http" ? ", 0 (HTTP off)" : ""} or a number from 1 to 65535`);
  const n = Number(v);
  if (n === 0 && kind === "http") return { mode: "off" };
  if (n < 1 || n > 65535) throw new PortSettingError(`${PORT_PROPERTY[kind]}=${v} is out of range: give auto${kind === "http" ? ", 0 (HTTP off)" : ""} or a number from 1 to 65535`);
  return { mode: "fixed", port: n };
}

export interface PortRequest {
  https: PortSetting;
  http: PortSetting;
  pg: PortSetting;
  /** the ports of an existing installation (kariz.json): kept unless a port is given (0 = HTTP off) */
  kept?: Partial<Record<PortKind, number>>;
}

export type PortSource = "given" | "kept" | "default" | "fallback" | "off";

export interface PortChoice {
  ok: boolean;
  ports: Record<PortKind, number>;
  source: Record<PortKind, PortSource>;
  /** what was decided and why (for the log): «HTTPS 443 is in use (by vmware-hostd, pid 4120): using 8443» */
  notes: string[];
  /** reasons the install cannot go on */
  errors: string[];
}

/** Every port the choice may look at (for the probe): given, kept and the candidates of the automatic ones. */
export function portsToProbe(req: PortRequest): number[] {
  const out = new Set<number>();
  for (const kind of ["https", "http", "pg"] as const) {
    const s = req[kind];
    if (s.mode === "fixed") out.add(s.port);
    else if (s.mode === "auto") {
      const kept = req.kept?.[kind];
      if (kept !== undefined && kept > 0) out.add(kept);
      else if (!(kind === "http" && kept === 0)) for (const p of PORT_CANDIDATES[kind]) out.add(p);
    }
  }
  return [...out];
}

/**
 * Choose the three ports. `busy(port)` says what holds a port (null: free). HTTPS first, then HTTP, then PostgreSQL;
 * a port is never used twice.
 */
export function choosePorts(req: PortRequest, busy: (port: number) => string | null): PortChoice {
  const ports: Record<PortKind, number> = { https: 0, http: 0, pg: 0 };
  const source = { https: "default", http: "default", pg: "default" } as Record<PortKind, PortSource>;
  const notes: string[] = [];
  const errors: string[] = [];
  const taken = new Map<number, PortKind>();
  const why = (p: number) => {
    const b = busy(p);
    return b ? ` (${b})` : "";
  };
  for (const kind of ["https", "http", "pg"] as const) {
    const s = req[kind];
    const label = PORT_LABEL[kind];
    const prop = PORT_PROPERTY[kind];
    const kept = req.kept?.[kind];
    if (s.mode === "off" || (s.mode === "auto" && kind === "http" && kept === 0)) {
      ports[kind] = 0;
      source[kind] = "off";
      notes.push(`${label}: off${s.mode === "off" ? "" : " (kept from the configuration)"}`);
      continue;
    }
    if (s.mode === "fixed" || (s.mode === "auto" && kept !== undefined && kept > 0)) {
      const port = s.mode === "fixed" ? s.port : kept!;
      const src: PortSource = s.mode === "fixed" ? "given" : "kept";
      ports[kind] = port;
      source[kind] = src;
      if (taken.has(port)) {
        errors.push(`${label} port ${port} is already the ${PORT_LABEL[taken.get(port)!]} port: give different ports`);
        continue;
      }
      taken.set(port, kind);
      if (busy(port)) {
        errors.push(
          src === "given"
            ? `${label} port ${port} (${prop}=${port}) is already in use${why(port)}: stop that program, give another port with ${prop}=, or leave ${prop} empty to pick a free port automatically`
            : `${label} port ${port} of the existing installation (kariz.json) is now in use${why(port)}: stop that program, or give another port with ${prop}=`,
        );
        continue;
      }
      notes.push(`${label}: ${port} (${src === "given" ? `${prop}=${port}` : "kept from the configuration"})`);
      continue;
    }
    // automatic: the first free candidate
    const list = PORT_CANDIDATES[kind];
    const skipped: string[] = [];
    let chosen = 0;
    for (const p of list) {
      if (taken.has(p)) continue;
      if (busy(p)) {
        skipped.push(`${p} is in use${why(p)}`);
        continue;
      }
      chosen = p;
      break;
    }
    if (!chosen) {
      errors.push(`no free ${label} port among ${list.join(", ")} (${skipped.join("; ")}): give a free one with ${prop}=`);
      continue;
    }
    ports[kind] = chosen;
    source[kind] = chosen === list[0] ? "default" : "fallback";
    taken.set(chosen, kind);
    notes.push(skipped.length ? `${label}: ${skipped.join("; ")}: using ${chosen}` : `${label}: ${chosen}`);
  }
  return { ok: errors.length === 0, ports, source, notes, errors };
}

/** The public address for a host name and HTTPS port (443 is left out). */
export function publicUrlFor(host: string, httpsPort: number): string {
  const h = host.trim().toLowerCase();
  return httpsPort === 443 ? `https://${h}` : `https://${h}:${httpsPort}`;
}

// ----- the probe (not pure) -----------------------------------------------------------------------------------------

/** Can this process listen on host:port? A real bind: it also catches the ports Windows reserves (Hyper-V/WSL/Docker
 * excluded port ranges answer EACCES) and HTTP.sys (IIS) listeners. */
export function canListen(port: number, host: string): Promise<{ ok: boolean; code?: string }> {
  return new Promise((done) => {
    const s = createServer();
    s.unref();
    s.once("error", (e: NodeJS.ErrnoException) => done({ ok: false, code: e.code ?? "error" }));
    s.listen({ port, host, exclusive: true }, () => s.close(() => done({ ok: true })));
  });
}

/** Windows: the TCP listeners netstat shows, as port → "name, pid N". Locale-independent: a listening socket is the one
 * whose remote end is 0.0.0.0:0 / [::]:0 (the state word is translated on non-English Windows). */
export function windowsListeners(): Map<number, string> {
  const out = new Map<number, string>();
  if (process.platform !== "win32") return out;
  const ns = spawnSync("netstat.exe", ["-ano"], { encoding: "utf8", windowsHide: true, timeout: 20_000 });
  const names = new Map<number, string>();
  const tl = spawnSync("tasklist.exe", ["/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true, timeout: 20_000 });
  for (const line of (tl.stdout ?? "").split(/\r?\n/)) {
    const m = /^"([^"]+)","(\d+)"/.exec(line.trim());
    if (m) names.set(Number(m[2]), m[1].replace(/\.exe$/i, ""));
  }
  for (const line of (ns.stdout ?? "").split(/\r?\n/)) {
    const m = /^\s*TCP\s+(\S+):(\d+)\s+(\S+)\s+\S*\s*(\d+)\s*$/i.exec(line);
    if (!m) continue;
    if (!/^(0\.0\.0\.0|\[::\]):0$/.test(m[3])) continue;
    const port = Number(m[2]);
    const pid = Number(m[4]);
    if (!out.has(port)) out.set(port, `used by ${names.get(pid) ?? "a program"}, pid ${pid}${pid === 4 ? ": HTTP.sys, e.g. IIS / W3SVC" : ""}`);
  }
  return out;
}

/** What holds each port (missing: free). PostgreSQL listens on 127.0.0.1, the web ports on every address. */
export async function probePorts(ports: number[], pgPorts: Set<number> = new Set()): Promise<Map<number, string>> {
  const listeners = windowsListeners();
  const out = new Map<number, string>();
  for (const p of ports) {
    if (listeners.has(p)) {
      out.set(p, listeners.get(p)!);
      continue;
    }
    const r = await canListen(p, pgPorts.has(p) ? "127.0.0.1" : "0.0.0.0");
    if (!r.ok) out.set(p, r.code === "EACCES" ? "reserved by Windows or blocked (EACCES): see netsh int ipv4 show excludedportrange protocol=tcp" : r.code === "EADDRINUSE" ? "used by another program" : `cannot listen: ${r.code}`);
  }
  return out;
}
