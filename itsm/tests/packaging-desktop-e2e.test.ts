// The installed Windows app's sandbox job (docs/qa/PERFORMANCE_E2E_FA.md): desktop-e2e installs this run's Kariz-Setup
// silently on a Windows runner and drives the installed Kariz.exe as the administrator and as a member, gated on console
// errors and budgets. These checks keep the job wired as described and the test from weakening the app it measures.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workflow = () => readFileSync(join(__dirname, "../../.github/workflows/itsm.yml"), "utf8");
const script = () => readFileSync(join(__dirname, "../scripts/desktop-e2e.mjs"), "utf8");
/** The text of one job of the workflow (up to the next job). */
function job(y: string, name: string): string {
  const start = y.indexOf(`\n  ${name}:\n`);
  expect(start).toBeGreaterThan(0);
  const next = y.slice(start + 1).search(/\n {2}[a-z][a-z0-9-]*:\n/);
  return next < 0 ? y.slice(start) : y.slice(start, start + 1 + next);
}

describe("the desktop-e2e job", () => {
  it("installs this run's installer silently after the windows job and runs the installed app", () => {
    const j = job(workflow(), "desktop-e2e");
    expect(j).toContain("needs: [windows]");
    expect(j).toContain("needs.windows.result == 'success'");
    expect(j).toContain("runs-on: windows-latest");
    expect(j).toContain("name: itsm-windows-installer");
    expect(j).toMatch(/Start-Process -FilePath \$setup\.FullName -ArgumentList '\/S' -Wait/);
    expect(j).toContain("Programs\\Kariz\\Kariz.exe");
    expect(j).toMatch(/node scripts\/desktop-e2e\.mjs --exe "\$env:KARIZ_EXE"/);
    // the evidence is kept whatever happened, and the app is removed again
    expect(j).toMatch(/name: itsm-desktop-e2e[\s\S]*?if-no-files-found: ignore/);
    expect(j).toMatch(/- uses: actions\/upload-artifact@v4\n\s+if: always\(\)/);
    expect(j).toMatch(/- name: Uninstall\n\s+if: always\(\)/);
  });

  it("no development shortcut is left: every push runs the test shards before the installers", () => {
    const y = workflow();
    expect(y).not.toMatch(/desktop-e2e-fast|FAST-PATH/);
    expect(job(y, "windows")).toContain("needs: [check, test]");
    expect(job(y, "windows")).not.toMatch(/\n {4}if:/);
  });

  it("drives the app without weakening it: no flag of its own, no certificate or web-security switch", () => {
    const s = script();
    expect(s).toContain('require("playwright")');
    expect(s).toMatch(/electron\.launch\(\{ executablePath: EXE, args, env/);
    // the only argument besides an unpacked app folder (local runs) is Chromium's sandbox switch for root on Linux
    expect(s).toMatch(/const args = \[\.\.\.\(a\.app \? \[resolve\(String\(a\.app\)\)\] : \[\]\), \.\.\.\(a\["no-sandbox"\] \? \["--no-sandbox"\] : \[\]\)\];/);
    for (const weak of ["--disable-web-security", "--ignore-certificate-errors", "ignoreHTTPSErrors", "nodeIntegration", "ITSM_SMOKE", "--remote-debugging-address"]) expect(s).not.toContain(weak);
  });

  it("gates on console errors and on budgets for every measure the brief names", () => {
    const s = script();
    expect(s).toContain("no console error or uncaught exception in the app's windows during the whole run");
    for (const key of ["cold_start_ms", "warm_start_ms", "nav_visible_p95_ms", "nav_visible_max_ms", "api_p95_ms", "order_ms", "demo_load_s", "close_ms", "backend_peak_mb", "total_peak_mb", "idle_backend_cpu_pct", "pg_wal_mb"]) {
      expect(s).toMatch(new RegExp(`\\n  ${key}: [0-9_]+,`));
    }
    // memory and CPU come from Electron itself, every second, for the main, renderer and local-server processes
    expect(s).toContain("getAppMetrics()");
    expect(s).toMatch(/report\.json[\s\S]*report\.md[\s\S]*GITHUB_STEP_SUMMARY/);
  });

  it("measures the start the way a person waits for it and proves the first start used the database made at build time", () => {
    const s = script();
    // when the main window is first on screen, next to the page being ready behind the splash
    expect(s).toMatch(/report\.starts\.cold\.shown_ms = await coldShown/);
    expect(s).toMatch(/report\.starts\.warm\.shown_ms = await warmShown/);
    // the local server's own start line (src/desktop/server.ts), and a check that the first one came from the template
    expect(s).toContain("local server on \\S+ \\(database (\\d+) ms( from the template)?, migrations (\\d+) ms, ready (\\d+) ms, process (\\d+) ms\\)");
    expect(s).toContain('"the first start opens the database made at build time (app.log)"');
    expect(readFileSync(join(__dirname, "../src/desktop/server.ts"), "utf8")).toContain("from the template");
    // every file a route needed (code, styles, fonts), apart from the API calls
    expect(s).toMatch(/staticLog\.push\(\{ phase, path: u\.pathname, ms, failed \}\)/);
  });
});
