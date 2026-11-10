// The server edition's installer on a laptop or lab PC (D1): ports chosen automatically when 443 / 80 / 5432 are busy
// (IIS, Skype, VMware, Docker, a local PostgreSQL), given ports that must be free, kept ports on an upgrade, and the
// preflight rules (administrator, x64, build, memory, disk, pending restart). Pure functions, plus one real bind.
import { describe, it, expect } from "vitest";
import { createServer, type Server } from "node:net";
import { PORT_CANDIDATES, canListen, choosePorts, parsePortSetting, portsToProbe, probePorts, publicUrlFor, type PortRequest } from "../src/server-edition/ports";
import { evaluatePreflight, MIN_BUILD } from "../src/server-edition/preflight";
import { main, parseArgs } from "../src/server-edition/ctl";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const auto = { mode: "auto" } as const;
const req = (r: Partial<PortRequest> = {}): PortRequest => ({ https: auto, http: auto, pg: auto, ...r });
const busyOf = (held: Record<number, string>) => (p: number) => held[p] ?? null;

describe("parsePortSetting", () => {
  it("reads empty and auto as automatic, a number as given, 0 as HTTP off", () => {
    expect(parsePortSetting("", "https")).toEqual({ mode: "auto" });
    expect(parsePortSetting(undefined, "http")).toEqual({ mode: "auto" });
    expect(parsePortSetting(" Auto ", "pg")).toEqual({ mode: "auto" });
    expect(parsePortSetting("8443", "https")).toEqual({ mode: "fixed", port: 8443 });
    expect(parsePortSetting("0", "http")).toEqual({ mode: "off" });
  });

  it("refuses 0 for HTTPS and PostgreSQL, words and out-of-range numbers, naming the MSI property", () => {
    expect(() => parsePortSetting("0", "https")).toThrow(/PORT=0 is out of range/);
    expect(() => parsePortSetting("0", "pg")).toThrow(/PGPORT=0/);
    expect(() => parsePortSetting("70000", "http")).toThrow(/HTTPPORT=70000 is out of range/);
    expect(() => parsePortSetting("https", "https")).toThrow(/is not a port/);
    expect(() => parsePortSetting("8443x", "https")).toThrow(/is not a port/);
  });
});

describe("choosePorts", () => {
  it("takes 443 / 80 / 5432 on a free machine", () => {
    const r = choosePorts(req(), () => null);
    expect(r.ok).toBe(true);
    expect(r.ports).toEqual({ https: 443, http: 80, pg: 5432 });
    expect(r.source).toEqual({ https: "default", http: "default", pg: "default" });
  });

  it("falls back along the fixed lists when the defaults are busy, and says why", () => {
    const r = choosePorts(req(), busyOf({ 443: "used by vmware-hostd, pid 4120", 80: "used by System, pid 4: HTTP.sys, e.g. IIS / W3SVC", 5432: "used by postgres, pid 77" }));
    expect(r.ok).toBe(true);
    expect(r.ports).toEqual({ https: 8443, http: 8080, pg: 5433 });
    expect(r.source).toEqual({ https: "fallback", http: "fallback", pg: "fallback" });
    expect(r.notes.join("\n")).toContain("443 is in use (used by vmware-hostd, pid 4120): using 8443");
    expect(PORT_CANDIDATES.https.slice(0, 4)).toEqual([443, 8443, 9443, 10443]);
    expect(PORT_CANDIDATES.http.slice(0, 3)).toEqual([80, 8080, 8081]);
  });

  it("skips every busy candidate and never gives one port to two services", () => {
    const r = choosePorts(req({ https: { mode: "fixed", port: 8080 } }), busyOf({ 80: "x", 8443: "y" }));
    expect(r.ok).toBe(true);
    expect(r.ports.https).toBe(8080);
    expect(r.ports.http).toBe(8081);
    const all = choosePorts(req(), (p) => (PORT_CANDIDATES.https.includes(p) ? "busy" : null));
    expect(all.ok).toBe(false);
    expect(all.errors[0]).toMatch(/no free HTTPS port among 443, 8443/);
    expect(all.errors[0]).toContain("PORT=");
  });

  it("fails on a given port that is busy, with the program and the way out", () => {
    const r = choosePorts(req({ https: { mode: "fixed", port: 443 } }), busyOf({ 443: "used by Skype, pid 9" }));
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual([expect.stringContaining("HTTPS port 443 (PORT=443) is already in use (used by Skype, pid 9)")]);
    expect(r.errors[0]).toContain("leave PORT empty to pick a free port automatically");
  });

  it("refuses the same given port twice", () => {
    const r = choosePorts(req({ https: { mode: "fixed", port: 9000 }, http: { mode: "fixed", port: 9000 } }), () => null);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/HTTP port 9000 is already the HTTPS port/);
  });

  it("keeps the ports of an existing installation on an upgrade (HTTP off stays off), and a given one wins", () => {
    const kept = { https: 8443, http: 0, pg: 5433 };
    const r = choosePorts(req({ kept }), busyOf({ 443: "", 80: "x" }));
    expect(r.ports).toEqual({ https: 8443, http: 0, pg: 5433 });
    expect(r.source).toEqual({ https: "kept", http: "off", pg: "kept" });
    const moved = choosePorts(req({ kept, http: { mode: "fixed", port: 8080 } }), () => null);
    expect(moved.ports.http).toBe(8080);
    expect(moved.source.http).toBe("given");
  });

  it("stops an upgrade whose kept port another program took meanwhile", () => {
    const r = choosePorts(req({ kept: { https: 443, http: 80, pg: 5432 } }), busyOf({ 443: "used by w3wp, pid 12" }));
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain("HTTPS port 443 of the existing installation (kariz.json) is now in use (used by w3wp, pid 12)");
  });

  it("probes only what the choice may use", () => {
    expect(portsToProbe(req({ https: { mode: "fixed", port: 9443 }, http: { mode: "off" }, kept: { pg: 5433 } })).sort()).toEqual([5433, 9443]);
    expect(portsToProbe(req())).toEqual(expect.arrayContaining([443, 8443, 80, 8080, 5432, 5433]));
    expect(portsToProbe(req({ kept: { https: 8443, http: 0, pg: 5432 } })).sort()).toEqual([5432, 8443]);
  });

  it("leaves 443 out of the public address only", () => {
    expect(publicUrlFor("Kariz.Bank.Local", 443)).toBe("https://kariz.bank.local");
    expect(publicUrlFor("laptop-7", 8443)).toBe("https://laptop-7:8443");
  });
});

describe("the probe", () => {
  it("sees a port another program listens on", async () => {
    const s: Server = createServer();
    await new Promise<void>((r) => s.listen({ port: 0, host: "0.0.0.0" }, r));
    const port = (s.address() as { port: number }).port;
    try {
      expect((await canListen(port, "0.0.0.0")).ok).toBe(false);
      const held = await probePorts([port]);
      expect(held.get(port)).toMatch(/used by|reserved|cannot listen/);
    } finally {
      await new Promise((r) => s.close(r));
    }
    expect((await canListen(port, "0.0.0.0")).ok).toBe(true);
  });
});

describe("evaluatePreflight", () => {
  const free = () => null;
  it("passes a Windows 11 laptop with enough memory and disk (lab mode noted)", () => {
    const r = evaluatePreflight({ admin: true, arch: "AMD64", build: 22631, productType: 1, memoryMb: 16000, freeDiskMb: 100_000, pendingReboot: false }, req(), free);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(" ")).toContain("lab or demo mode");
  });

  it("stops on a non-administrator, ARM64, an old build, too little memory or disk, with one reason each", () => {
    const r = evaluatePreflight({ admin: false, arch: "ARM64", build: 17134, memoryMb: 2048, freeDiskMb: 1024 }, req(), free);
    expect(r.ok).toBe(false);
    const all = r.errors.join("\n");
    expect(all).toContain("as an administrator");
    expect(all).toContain("ARM64");
    expect(all).toContain(`build ${MIN_BUILD}`);
    expect(all).toContain("at least 4 GB");
    expect(all).toContain("at least 2 GB");
    expect(r.errors).toHaveLength(5);
  });

  it("warns (never stops) on a pending restart, little memory or little disk", () => {
    const r = evaluatePreflight({ admin: true, arch: "AMD64", build: 20348, productType: 3, memoryMb: 6000, freeDiskMb: 10_000, pendingReboot: true }, req(), free);
    expect(r.ok).toBe(true);
    expect(r.warnings).toHaveLength(3);
    expect(r.warnings.join(" ")).toContain("restart pending");
  });

  it("carries the port errors and choices", () => {
    const r = evaluatePreflight({ admin: true }, req({ http: { mode: "fixed", port: 80 } }), busyOf({ 80: "used by httpd, pid 5", 443: "used by vmware-hostd, pid 6" }));
    expect(r.ok).toBe(false);
    expect(r.ports.https).toBe(8443);
    expect(r.errors[0]).toContain("HTTPPORT=80");
  });
});

describe("karizctl preflight", () => {
  it("writes its result (ports, errors) for install.ps1 and reads given ports, auto and HTTP off", async () => {
    expect(parseArgs(["preflight", "--https-port", "auto", "--http-port", "0"]).flags).toEqual({ "https-port": "auto", "http-port": "0" });
    const dir = mkdtempSync(join(tmpdir(), "kariz-pf-"));
    const out = join(dir, "preflight.json");
    const code = await main(["preflight", "--out", out, "--config", join(dir, "kariz.json"), "--https-port", "auto", "--http-port", "0", "--admin", "1", "--build", "17763", "--memory-mb", "8192", "--free-mb", "50000"]);
    expect(code).toBe(0);
    const r = JSON.parse(readFileSync(out, "utf8"));
    expect(r.ports.http).toBe(0);
    expect(r.source.http).toBe("off");
    expect(r.ports.https).toBeGreaterThan(0);
    expect(r.ports.pg).toBeGreaterThan(0);
    const bad = join(dir, "bad.json");
    await main(["preflight", "--out", bad, "--config", join(dir, "kariz.json"), "--https-port", "0x1"]);
    const b = JSON.parse(readFileSync(bad, "utf8"));
    expect(b.ok).toBe(false);
    expect(b.errors[0]).toContain("PORT=0x1 is not a port");
  });
});
