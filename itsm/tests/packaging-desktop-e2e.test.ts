// The installed Windows app's sandbox job (docs/qa/PERFORMANCE_E2E_FA.md): desktop-e2e installs this run's Kariz-Setup
// silently on a Windows runner and drives the installed Kariz.exe as the administrator and as a member, gated on console
// errors and budgets. These checks keep the job wired as described and the test from weakening the app it measures.
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

// The database's write-ahead log is gated while the app runs: after the close, the app's close checkpoint, PostgreSQL's
// shutdown checkpoint and the next start's checkpoint trim pg_wal to max_wal_size whatever happened before, so a size
// taken then passes whether or not the runtime scheduler (src/server/db/wal.ts) ever checkpointed.
describe("desktop-e2e watches the database log while the app runs", () => {
  type Wal = { mb: number; segments: number };
  const mod = async () =>
    (await import(join(__dirname, "../scripts/desktop-e2e-wal.mjs"))) as {
      walNow(dbDir: string): Wal | null;
      WalWatch: new (
        dbDir: string,
        now?: () => number,
      ) => {
        sample(phase: string): (Wal & { at_s: number }) | null;
        summary(): { samples: number; peak_mb: number | null; peak_segments: number | null; peak_phase: string | null; peak_mb_by_phase: Record<string, number> };
      };
      checkpointReasons(text: string): Record<string, number>;
      runtimeCheckpoints(reasons: Record<string, number>): number;
    };

  it("measures pg_wal on disk and keeps its peak, with the phase it was seen in", async () => {
    const { walNow, WalWatch } = await mod();
    const db = mkdtempSync(join(tmpdir(), "e2e-wal-"));
    try {
      // a first start still writing the folder: nothing to measure yet
      expect(walNow(db)).toBeNull();
      const wal = join(db, "pg_wal");
      mkdirSync(join(wal, "archive_status"), { recursive: true });
      const segment = (name: string) => {
        writeFileSync(join(wal, name), "");
        truncateSync(join(wal, name), 16 * 1048576);
      };
      segment("000000010000000000000001");
      writeFileSync(join(wal, "000000010000000000000001.partial"), "not a segment");
      let t = 0;
      const watch = new WalWatch(db, () => t);
      expect(watch.sample("setup")).toMatchObject({ mb: 16, segments: 1 });
      // the demo pack writes its log …
      for (const n of ["2", "3", "4", "5"]) segment(`00000001000000000000000${n}`);
      t = 61_000;
      expect(watch.sample("demo-load")).toMatchObject({ mb: 80, segments: 5, at_s: 61 });
      // … and a checkpoint of the app's scheduler removes what lies behind it
      for (const n of ["1", "2", "3"]) rmSync(join(wal, `00000001000000000000000${n}`));
      expect(watch.sample("admin:incidents")).toMatchObject({ mb: 32, segments: 2 });
      expect(watch.summary()).toEqual({ samples: 3, peak_mb: 80, peak_segments: 5, peak_phase: "demo-load", peak_at_s: 61, peak_mb_by_phase: { setup: 16, "demo-load": 80, admin: 32 } });
    } finally {
      rmSync(db, { recursive: true, force: true });
    }
  });

  it("counts the checkpoints the app logged by reason, and only volume and age as the scheduler's own", async () => {
    const { checkpointReasons, runtimeCheckpoints } = await mod();
    // app.log as the installed app writes it (desktop-e2e run 43180784825), with the failure lines of src/server/db
    const log = [
      "2026-11-12T08:28:59.806Z [server] [itsm] local server on 127.0.0.1:3939 (database 10631 ms from the template, migrations 92 ms, ready 10737 ms, process 11666 ms)",
      "2026-11-12T08:30:02.179Z [server] [itsm] database checkpoint { reason: 'volume', ms: 182, wal_mb: 38.9 }",
      "2026-11-12T08:30:59.844Z [server] [itsm] database checkpoint { reason: 'backup', ms: 37, wal_mb: 20.6 }",
      "2026-11-12T08:33:04.476Z [server] [itsm] database checkpoint { reason: 'volume', ms: 64, wal_mb: 64.2 }",
      "2026-11-12T08:34:51.258Z [server] [itsm] database checkpoint { reason: 'age', ms: 113, wal_mb: 3 }",
      "2026-11-12T08:35:00.000Z [server:err] [itsm] database checkpoint failed Error: aborted",
      "2026-11-12T08:36:05.306Z [server] [itsm] database checkpoint { reason: 'close', ms: 43, wal_mb: 31.2 }",
      "2026-11-12T08:36:05.400Z [server:err] [itsm] database checkpoint before close failed Error: closed",
    ].join("\n");
    const reasons = checkpointReasons(log);
    expect(reasons).toEqual({ volume: 2, backup: 1, age: 1, close: 1 });
    expect(runtimeCheckpoints(reasons)).toBe(3);
    // a run in which only the open, a backup, the migrations and the close checkpointed: the scheduler never did
    const idle = checkpointReasons("[server] [itsm] database checkpoint { reason: 'migrations', ms: 609, wal_mb: 54 }\n[server] [itsm] database checkpoint { reason: 'backup', ms: 37, wal_mb: 20.6 }\n[server] [itsm] database checkpoint { reason: 'close', ms: 10, wal_mb: 0 }");
    expect(runtimeCheckpoints(idle)).toBe(0);
    expect(runtimeCheckpoints(checkpointReasons(""))).toBe(0);
  });

  it("gates the peak while the app runs and the scheduler's checkpoints before the first close, not the size after it", () => {
    const s = script();
    // every second while the app runs (the sampler stops when a close begins), after the demo pack, before the close
    expect(s).toMatch(/sampler = setInterval\(async \(\) => \{\n(\s+\/\/.*\n)*\s+if \(app\) wal\.sample\(phase\);/);
    expect(s).toMatch(/async function closeApp\(label\) \{\n\s+phase = `\$\{label\}:close`;\n\s+stopSampler\(\);/);
    expect(s).toContain('report.database.after_demo = wal.sample("after-demo");');
    expect(s).toMatch(/report\.database\.before_first_close = wal\.sample\("before-close"\);\n\s+report\.database\.first_run_checkpoints = checkpointReasons\(appLog\(\)\);\n(\s+\/\/.*\n)*\s+await closeApp\("first"\);/);
    expect(s).toMatch(/budget\("pg_wal_peak_mb", report\.database\.in_run\.peak_mb, BUDGETS\.pg_wal_mb,/);
    expect(s).toMatch(/C\.check\(n >= 1, `the app's own scheduler checkpointed the database log while it ran/);
    // the size after the close is reported, never gated: it is max_wal_size whatever happened while the app ran
    expect(s).not.toMatch(/budget\("pg_wal_mb"/);
  });
});
