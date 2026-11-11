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
});
