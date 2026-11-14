// What the bank simulation (docs/qa/BANK_SIM_FA.md, CI job bank-sim) found and fixed, checked on the files themselves
// (the simulation itself runs only on the Windows runner), and the rules the simulation's own scripts must keep:
// ASCII-only PowerShell parsed by Windows PowerShell 5.1, no certificate check turned off anywhere, the job after the
// server job with its report uploaded on success and on failure.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { supportsSystemCa } from "@shared/desktop/node-flags";

const PKG = join(__dirname, "../packaging/server");
const SIM_PS = join(PKG, "scripts/bank-sim");
const SIM_JS = join(__dirname, "../scripts/bank-sim");
const workflow = () => readFileSync(join(__dirname, "../../.github/workflows/itsm.yml"), "utf8");

describe("the server edition trusts the Windows certificate store (finding: a bank-CA mail relay over STARTTLS)", () => {
  const xml = readFileSync(join(PKG, "winsw/app-service.xml.template"), "utf8");

  it("KarizApp runs Node.js with --use-system-ca (the workers inherit it from the supervisor)", () => {
    const args = /<arguments>([^<]*)<\/arguments>/.exec(xml)![1];
    expect(args.split(/\s+/)[0]).toBe("--use-system-ca");
    expect(args).toContain("app\\server.cjs");
    // an XML comment may not hold a double hyphen: the template must stay well-formed for WinSW
    for (const c of xml.match(/<!--[\s\S]*?-->/g) ?? []) expect(c.slice(4, -3)).not.toContain("--");
  });

  it("the bundled Node.js supports the flag", () => {
    const deps = JSON.parse(readFileSync(join(PKG, "deps.json"), "utf8"));
    expect(supportsSystemCa(deps.node.version)).toBe(true);
  });

  it("the cluster forks workers without replacing execArgv (so they keep the flag)", () => {
    const cluster = readFileSync(join(__dirname, "../src/server-edition/cluster.ts"), "utf8");
    expect(cluster).not.toMatch(/execArgv\s*:/);
    expect(cluster).not.toMatch(/setupPrimary\s*\(/);
  });
});

describe("the simulation's scripts", () => {
  it("PowerShell: ASCII only and parsed by Windows PowerShell 5.1 in CI", () => {
    const files = readdirSync(SIM_PS).filter((f) => f.endsWith(".ps1"));
    expect(files).toEqual(expect.arrayContaining(["bank-sim.ps1", "bank-net.ps1", "bank-pki.ps1"]));
    for (const f of files) {
      const bytes = readFileSync(join(SIM_PS, f));
      const at = bytes.findIndex((b) => b > 0x7f);
      expect(at, `${f} has a non-ASCII byte at offset ${at}`).toBe(-1);
    }
    const y = workflow();
    const step = y.indexOf("parse under Windows PowerShell 5.1");
    expect(y.slice(step, step + 1200)).toContain("packaging/server/scripts/bank-sim/*.ps1");
  });

  it("never turn certificate checks off (the bank's CA is trusted through the Windows store)", () => {
    for (const f of readdirSync(SIM_JS).filter((x) => x.endsWith(".mjs"))) {
      const s = readFileSync(join(SIM_JS, f), "utf8");
      expect(s, f).not.toMatch(/ignoreHTTPSErrors|rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED/);
    }
    const ps = readdirSync(SIM_PS).map((f) => readFileSync(join(SIM_PS, f), "utf8")).join("\n");
    expect(ps).not.toMatch(/ServerCertificateValidationCallback|SkipCertificateCheck|NODE_TLS_REJECT_UNAUTHORIZED/);
    expect(ps).toContain("'--use-system-ca'");
  });

  it("the CI job runs after the server job, fetches before the cut and uploads its report even on failure", () => {
    const y = workflow();
    const job = y.slice(y.indexOf("\n  bank-sim:"));
    expect(job).toContain("needs: [server]");
    expect(job).toContain("gh release download itsm-v1.0.0");
    expect(job).toContain("name: itsm-server-msi");
    expect(job.indexOf("playwright install chromium")).toBeLessThan(job.indexOf("bank-sim.ps1"));
    expect(job).toMatch(/upload-artifact@v4\n\s+if: always\(\)/);
    expect(job).toContain("Restore outbound traffic");
  });

  it("runs in steps that each leave their evidence behind (a lost runner left no log at all: run 42953772211)", () => {
    const y = workflow();
    const job = y.slice(y.indexOf("\n  bank-sim:") + 1).split(/\n  [a-z][a-z-]*:\n/)[0];
    const steps = job.split(/\n      - /).slice(1);
    const sims = steps.map((s, i) => [s, i] as const).filter(([s]) => /bank-sim\.ps1 .*-Only [\d,]+/.test(s));
    // every scenario once, in order
    const only = sims.flatMap(([s]) => /-Only ([\d,]+)/.exec(s)![1].split(",").map(Number));
    expect(only).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
    for (const [, i] of sims) {
      const next = steps[i + 1];
      expect(next).toContain("upload-artifact@v4");
      expect(next).toContain("if: always()");
      expect(next).toContain("overwrite: true");
    }
    const report = steps.find((s) => s.includes("bank-sim.ps1") && s.includes("-Report"))!;
    expect(report).toContain("if: always()");
  });

  it("no development shortcut is left in the workflow: every push runs the test shards and the smoke test", () => {
    const y = workflow();
    expect(y).not.toMatch(/bank-sim-fast|TEMPORARY/);
    const server = y.slice(y.indexOf("\n  server:"), y.indexOf("\n  server-publish:"));
    expect(server).toContain("needs: [check, test]");
    expect(server).not.toMatch(/\n    if:/);
  });

  it("the mock domain controller keeps its people's identity when a CI step starts it again", () => {
    const m = readFileSync(join(SIM_JS, "ldap-mock.mjs"), "utf8");
    expect(m).toMatch(/objectGUID: \[guid\(sam\)\]/);
    expect(m).toMatch(/whenCreated: \["\d{14}\.0Z"\]/);
    for (const sam of ["ali", "maryam", "sara"]) expect(m).toContain(`extra: stable("${sam}"`);
  });

  it("keeps the CI machine's own agents online but never the test's tools, and keeps the PFX password out of the artifact", () => {
    const net = readFileSync(join(SIM_PS, "bank-net.ps1"), "utf8");
    expect(net).toMatch(/\$tools = .*node\|powershell\|pwsh\|chrome/);
    expect(net).toContain("ci-machine-at-cut.txt");
    const sim = readFileSync(join(SIM_PS, "bank-sim.ps1"), "utf8");
    expect(sim).not.toMatch(/pfx_password\s*=/);
    expect(sim).toMatch(/\$PfxPasswordFile = Join-Path \(Split-Path -Parent \$Out\)/);
  });

  it("the upgraded and the re-installed server must report this build's sync protocol, read from the source (not a number that a bump leaves behind)", async () => {
    const { SYNC_PROTOCOL } = await import("@shared/constants");
    const sim = readFileSync(join(SIM_PS, "bank-sim.ps1"), "utf8");
    expect(sim).not.toMatch(/'--expect-protocol', '\d+'/);
    for (const step of ["api-verify-upgrade", "api-verify-reinstall"]) expect(sim).toMatch(new RegExp(`'${step}' @\\([^)]*'--expect-protocol', \\$SyncProtocol\\)`));
    // the script's own pattern finds the constant in the file it reads
    const pattern = /\$SyncProtocol = \[regex\]::Match\(\(Get-Content -Raw -LiteralPath \(Join-Path \$Itsm 'src\\shared\\constants\.ts'\)\), '([^']+)'\)/.exec(sim);
    expect(pattern).not.toBeNull();
    const constants = readFileSync(join(__dirname, "../src/shared/constants.ts"), "utf8");
    expect(new RegExp(pattern![1]).exec(constants)?.[1]).toBe(String(SYNC_PROTOCOL));
  });
});

describe("DR on a rebuilt server: the backup says which application key sealed its secrets (finding of the runbook)", () => {
  it("fingerprints the key without revealing it and flags a restore under another key", async () => {
    const { secretId, keyMismatch } = await import("../src/server-edition/backup");
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const key = "k".repeat(48);
    expect(secretId(key)).toMatch(/^[0-9a-f]{16}$/);
    expect(secretId(key)).toBe(secretId(key));
    expect(secretId(key)).not.toBe(secretId(`${key}x`));
    expect(secretId(key)).not.toContain("kkkk");
    const dir = mkdtempSync(join(tmpdir(), "kariz-dr-"));
    try {
      // a backup older than the fingerprint: nothing to compare
      writeFileSync(join(dir, "manifest.json"), JSON.stringify({ format: "itsm-server-backup", version: 1 }));
      expect(keyMismatch(dir, key)).toBe(false);
      writeFileSync(join(dir, "manifest.json"), JSON.stringify({ format: "itsm-server-backup", version: 1, secret_id: secretId(key) }));
      expect(keyMismatch(dir, key)).toBe(false);
      expect(keyMismatch(join(dir, "db.dump"), key)).toBe(false);
      expect(keyMismatch(dir, "another-key-of-a-rebuilt-server-0123456789")).toBe(true);
      expect(keyMismatch(join(dir, "db.dump"), "another-key-of-a-rebuilt-server-0123456789")).toBe(true);
      expect(keyMismatch(join(dir, "missing"), key)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const ctl = readFileSync(join(__dirname, "../src/server-edition/ctl.ts"), "utf8");
    expect(ctl).toMatch(/r\.key_mismatch[\s\S]{0,200}warn\(/);
  });
});

// The server edition measured as people use it (docs/qa/PERFORMANCE_E2E_FA.md §2): every page of the administrator
// and of a requester-only member (time to first byte, DOMContentLoaded, content visible, API calls), the load test per
// endpoint, KarizApp's and KarizDB's memory and CPU at idle and under the load — each against a budget, in a report.
describe("the simulation measures the server edition's speed against budgets", () => {
  const sim = (f: string) => readFileSync(join(SIM_JS, f), "utf8");
  type Usage = { cpu_avg_pct: number | null; private_peak_mb: number; ws_peak_mb: number; processes: number };
  const perf = async () =>
    (await import(join(SIM_JS, "perf.mjs"))) as {
      SERVER_BUDGETS: Record<string, number>;
      summarizeResources(samples: { ms: number; procs: object[] }[]): { app: Usage; db: Usage };
    };
  const ps = () => readFileSync(join(SIM_PS, "bank-sim.ps1"), "utf8");

  it("measures every page of the administrator and of a requester-only member, on the small data and the demo pack", () => {
    const b = sim("browser.mjs");
    for (const m of ["contentVisible(page)", "navTiming(page)", "recorder.start()", "await recorder.stop()", "pageRow({", "checkPages(C, measured"]) expect(b).toContain(m);
    // the requester: the member made with the «درخواست‌دهنده» preset, on the portal's pages
    expect(b).toMatch(/PEOPLE\.find\(\(p\) => p\.preset === "requester"\)/);
    for (const page of ["portal", "catalogue", "requests", "knowledge", "ticket"]) expect(b).toContain(`"${page}"`);
    expect(b).toContain("requester-catalogue-item");
    expect(b).toMatch(/const PHASES = \{ setup, pages, demo, perf, purged \}/);
    expect(ps()).toMatch(/Invoke-Js 'browser\.mjs' 'browser-perf'/);
    // the browser trusts the server only through the Windows store (perf.mjs is one of the simulation's scripts)
    expect(sim("perf.mjs")).not.toMatch(/ignoreHTTPSErrors|rejectUnauthorized/);
  });

  it("samples KarizApp and KarizDB at idle and under the load, and reports the load per endpoint", () => {
    const s = ps();
    expect(s).toMatch(/\$idle = Start-Sampler 'idle'[\s\S]*Stop-Sampler \$idle[\s\S]*\$busy = Start-Sampler 'load'[\s\S]*'api-load'[\s\S]*Stop-Sampler \$busy[\s\S]*'perf-resources'/);
    expect(readFileSync(join(SIM_PS, "resources.ps1"), "utf8")).toMatch(/Win32_Process[\s\S]*WorkingSetSize[\s\S]*PrivatePageCount[\s\S]*KernelModeTime/);
    const api = sim("api.mjs");
    for (const ep of ["GET r/incident (list)", "GET r/incident?q (search)", "GET r/incident/:id", "GET r/incident/:id/journal", "GET r/incident/:id/attachments", "POST r/incident", "PATCH r/incident/:id"]) expect(api).toContain(`"${ep}"`);
    expect(s).toMatch(/Invoke-Js 'perf\.mjs' 'perf-report' @\('--dir', \$Out\)/);
  });

  it("has a budget for every measure, and every budget is checked", async () => {
    const { SERVER_BUDGETS } = await perf();
    const keys = ["page_ttfb_p95_ms", "page_dcl_p95_ms", "page_content_p95_ms", "page_content_max_ms", "api_p95_ms", "api_calls_per_page_max", "signin_ms", "load_endpoint_p95_ms", "load_endpoint_p99_ms", "app_private_peak_mb", "db_private_peak_mb", "idle_cpu_pct"];
    expect(Object.keys(SERVER_BUDGETS).sort()).toEqual([...keys].sort());
    const code = sim("perf.mjs") + sim("api.mjs");
    for (const k of keys) {
      expect(typeof SERVER_BUDGETS[k]).toBe("number");
      expect(code, k).toMatch(new RegExp(`B\\.${k}\\b`));
    }
  });

  it("sums the samples into CPU per service (% of one core) and memory peaks", async () => {
    const { summarizeResources } = await perf();
    const proc = (pid: number, name: string, cpu: number) => ({ pid, ppid: 0, name, ws: 300 * 1048576, priv: 100 * 1048576, cpu100ns: cpu });
    // two seconds apart: a node.exe that used one second of processor time is 50% of a core; a new process is skipped
    const s = summarizeResources([
      { ms: 0, procs: [proc(1, "node.exe", 0), proc(2, "postgres.exe", 0)] },
      { ms: 2000, procs: [proc(1, "node.exe", 10_000_000), proc(2, "postgres.exe", 4_000_000), proc(3, "postgres.exe", 9_000_000)] },
    ]);
    expect(s.app).toMatchObject({ cpu_avg_pct: 50, private_peak_mb: 100, ws_peak_mb: 300, processes: 1 });
    expect(s.db).toMatchObject({ cpu_avg_pct: 20, private_peak_mb: 200, processes: 2 });
  });
});
