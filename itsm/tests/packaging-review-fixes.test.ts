// Server edition packaging review fixes, checked on the files themselves (PowerShell and WiX do not run here; the
// Windows CI job parses the scripts with Windows PowerShell 5.1 and installs, re-installs, upgrades and uninstalls the
// MSI): scripts Windows PowerShell 5.1 can read, the data folder locked before secrets are written, no setup token or
// certificate password in any log, upgrades that keep ports and roll back to running services, a validated data folder
// that REMOVEDATA=1 deletes only when it is ours, the remembered data folder never overriding DATADIR, and preview
// releases that never mix commits.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SCRIPTS = join(__dirname, "../packaging/server/scripts");
const read = (f: string) => readFileSync(join(SCRIPTS, f), "utf8");
const wxs = () => readFileSync(join(__dirname, "../packaging/server/wix/Package.wxs"), "utf8");
const workflow = () => readFileSync(join(__dirname, "../../.github/workflows/itsm.yml"), "utf8");

describe("scripts Windows PowerShell 5.1 runs", () => {
  it("are ASCII-only: 5.1 reads a file without a byte-order mark in the ANSI code page («—» would end a string)", () => {
    const files = readdirSync(SCRIPTS).filter((f) => f.endsWith(".ps1"));
    expect(files).toEqual(expect.arrayContaining(["install.ps1", "uninstall.ps1", "common.ps1", "smoke-test.ps1"]));
    for (const f of files) {
      const bytes = readFileSync(join(SCRIPTS, f));
      const at = bytes.findIndex((b) => b > 0x7f);
      expect(at, `${f} has a non-ASCII byte at offset ${at}`).toBe(-1);
    }
  });

  it("are parsed by Windows PowerShell 5.1 itself in CI before the MSI is built", () => {
    const y = workflow();
    const step = y.indexOf("parse under Windows PowerShell 5.1");
    expect(step).toBeGreaterThan(0);
    expect(y.slice(step, step + 900)).toMatch(/shell: powershell\n/);
    expect(y.slice(step, step + 900)).toContain("Parser]::ParseInput([IO.File]::ReadAllText($f.FullName, [Text.Encoding]::Default)");
    expect(step).toBeLessThan(y.indexOf("build-msi.ps1"));
  });
});

describe("install.ps1", () => {
  const s = read("install.ps1");

  it("locks the data folder to administrators and SYSTEM before any secret is written, and every run", () => {
    const lock = s.indexOf("Invoke-Native -File 'icacls.exe' -Arguments @($DataDir, '/inheritance:r', '/grant:r', '*S-1-5-32-544:(OI)(CI)F', '/grant:r', '*S-1-5-18:(OI)(CI)F'");
    expect(lock).toBeGreaterThan(0);
    // before the log file, kariz.json (init) and the certificate (rotate-cert) — first thing of every run (inside the
    // try only so that a failure there still reaches install-error.txt and the event log), never only once an install
    // reaches the permissions step
    expect(lock).toBeLessThan(s.indexOf("Set-LogFile (Join-Path $DataDir"));
    expect(lock).toBeLessThan(s.indexOf("Invoke-Ctl $initArgs"));
    expect(lock).toBeGreaterThan(s.indexOf("\ntry {"));
    expect(lock).toBeLessThan(s.indexOf("Write-Step 'prerequisites'"));
    const init = s.indexOf("Invoke-Ctl $initArgs");
    expect(s.slice(init, init + 200)).toContain("Protect-File (Join-Path $DataDir 'kariz-admin.json')");
    // the TLS key is written after the lock too (inheriting it: the application's account must still read it later)
    expect(lock).toBeLessThan(s.indexOf("Invoke-Ctl @('rotate-cert'"));
  });

  it("writes the one-time setup address to setup-url.txt only, never to a log (the MSI log included)", () => {
    expect(s).toContain("Invoke-Ctl @('setup-token') -Quiet");
    expect(s).not.toMatch(/\$out = Invoke-Ctl @\('setup-token'\)/);
    expect(s).toMatch(/function Invoke-Ctl\(\[string\[\]\]\$Arguments, \[string\[\]\]\$Mask = @\(\), \[switch\]\$Quiet\)/);
    expect(read("common.ps1")).toContain("$Message = $Message -replace '(?i)(token=)[^&\\s\"'']+', '$1********'");
  });

  it("keeps the configured ports on a re-install or an upgrade (only given ones are changed)", () => {
    expect(s).toMatch(/\[string\]\$HttpsPort = '',\s*\n\s*\[string\]\$HttpPort = '',\s*\n\s*\[string\]\$PgPort = '',/);
    // karizctl preflight keeps kariz.json's ports unless one is given (src/server-edition/ports.ts, tested there); the
    // ports it returns are the ones init writes
    expect(s).toContain("$HttpsPort = [string]$pf.ports.https");
    expect(s).toContain("$initArgs = @('init', '--data-dir', $DataDir, '--install-dir', $InstallDir, '--https-port', $HttpsPort, '--http-port', $HttpPort, '--pg-port', $PgPort)");
    // only given ports reach the preflight (an empty argument would be dropped by Windows PowerShell 5.1)
    expect(s).toContain("if ($HttpsPort) { $pfArgs += @('--https-port', $HttpsPort) }");
    expect(s).toContain("if ($HttpsPort.Trim() -ieq 'auto') { $HttpsPort = '' }");
  });

  it("refuses a drive root, a system folder or a folder of other files as DATADIR, and marks its own", () => {
    expect(s).toMatch(/function Assert-DataDir/);
    expect(s).toContain("DATADIR must not be a drive root");
    expect(s).toContain("DATADIR must not be a system folder or contain one");
    expect(s).toContain("already holds other files");
    expect(s.indexOf("Assert-DataDir $DataDir")).toBeLessThan(s.indexOf("New-Item -ItemType Directory -Force -Path $DataDir"));
    expect(s).toContain("$DataMarker = '.kariz-data'");
  });
});

describe("uninstall.ps1", () => {
  const s = read("uninstall.ps1");

  it("only stops the services on the old side of an upgrade, and starts them again when the upgrade rolls back", () => {
    const upgrade = s.indexOf("if ($Upgrade) {\n        # stopped, not removed");
    expect(upgrade).toBeGreaterThan(0);
    expect(upgrade).toBeLessThan(s.indexOf("Remove-Svc $appSvc\n"));
    expect(s).toMatch(/\[switch\]\$Restore/);
    expect(s).toMatch(/if \(\$Restore\) \{[\s\S]*Start-Service \$name/);
    // services already missing (an earlier failed upgrade) no longer block every later upgrade
    expect(s).toContain("no safety backup is possible; the upgrade goes on");
  });

  it("deletes a data folder only when it carries the marker (or kariz.json), never a drive root or system folder", () => {
    const rm = s.indexOf("Remove-Item -Recurse -Force -LiteralPath $full");
    expect(rm).toBeGreaterThan(0);
    const guard = s.slice(s.indexOf("if ($RemoveData -eq '1')"), rm);
    expect(guard).toContain("'.kariz-data'");
    expect(guard).toContain("GetPathRoot");
    expect(guard).toContain("was NOT deleted");
    expect(s).not.toMatch(/Remove-Item -Recurse -Force \$DataDir/);
  });
});

describe("Package.wxs", () => {
  const x = wxs();

  it("keeps CERTPASSWORD and the setup address out of the MSI log", () => {
    expect(x).toMatch(/<Property Id="KarizInstall" Hidden="yes" \/>/);
    for (const id of ["KarizInstall", "KarizPreUpgrade", "KarizPreUpgradeRollback", "KarizUninstall"]) expect(x).toMatch(new RegExp(`<CustomAction Id="${id}"[^>]*DllEntry="WixSilentExec"`));
    expect(x).toMatch(/<CustomAction Id="KarizInstall"[^>]*HideTarget="yes"/);
    // the logged variant (its output reaches the MSI log, /l*v) never carries the password and runs only without one
    const logged = /<SetProperty Id="KarizInstallLogged"[^>]*Value="([^"]*)"/.exec(x)![1];
    expect(logged).toContain("install.ps1");
    expect(logged).not.toContain("CERTPASSWORD");
    expect(logged).not.toContain("-CertPassword");
    expect(x).toMatch(/<CustomAction Id="KarizInstallLogged"[^>]*DllEntry="WixQuietExec"/);
    expect(x).toContain('<Custom Action="KarizInstallLogged" Before="InstallFinalize" Condition="NOT REMOVE~=&quot;ALL&quot; AND NOT CERTPASSWORD" />');
    expect(x).toContain('<Custom Action="KarizInstall" Before="InstallFinalize" Condition="NOT REMOVE~=&quot;ALL&quot; AND CERTPASSWORD" />');
    expect(x.match(/DllEntry="WixQuietExec"/g)).toHaveLength(1);
  });

  it("rolls a failed upgrade back to running services", () => {
    expect(x).toMatch(/<CustomAction Id="KarizPreUpgradeRollback"[^>]*Execute="rollback"/);
    expect(x).toMatch(/<SetProperty Id="KarizPreUpgradeRollback"[^>]*uninstall\.ps1&quot; -InstallDir &quot;\[INSTALLFOLDER\]\.&quot; -Restore"/);
    expect(x).toMatch(/<Custom Action="KarizPreUpgradeRollback" Before="KarizPreUpgrade" Condition="REMOVE~=&quot;ALL&quot; AND UPGRADINGPRODUCTCODE" \/>/);
  });

  it("gives PORT and HTTPPORT no defaults (install.ps1 keeps the configured ones)", () => {
    expect(x).toMatch(/<Property Id="PORT" Secure="yes" \/>/);
    expect(x).toMatch(/<Property Id="HTTPPORT" Secure="yes" \/>/);
    expect(x).toMatch(/<Property Id="PGPORT" Secure="yes" \/>/);
    // «auto» only for the dialog of a double-click install (InstallUISequence): the same as empty for install.ps1
    expect(x).toContain('<SetProperty Id="PORT" Action="KarizUiPort" Value="auto" After="AppSearch" Sequence="ui" Condition="NOT PORT" />');
    expect(x).toContain('<SetProperty Id="HTTPPORT" Action="KarizUiHttpPort" Value="auto" After="AppSearch" Sequence="ui" Condition="NOT HTTPPORT" />');
  });

  it("uses the remembered data folder only when DATADIR was not given on the command line", () => {
    expect(x).not.toMatch(/<Property Id="DATADIR"[^/]*>\s*<RegistrySearch/);
    expect(x).toMatch(/<Property Id="PREVIOUSDATADIR" Secure="yes">\s*<RegistrySearch Id="PreviousDataDir"/);
    expect(x).toContain('<SetProperty Id="DATADIR" Value="[PREVIOUSDATADIR]" After="AppSearch" Sequence="both" Condition="PREVIOUSDATADIR AND DATADIR = &quot;$(var.DataDirDefault)&quot;" />');
  });
});

describe("the preview releases of CI", () => {
  it("are one per branch, and the server MSI goes only into its own commit's release", () => {
    const y = workflow();
    expect(y).not.toMatch(/TAG="itsm-preview"/);
    expect(y.match(/TAG="itsm-preview-\$\{GITHUB_REF_NAME\/\/\[\^A-Za-z0-9\._-\]\/-\}"/g)?.length).toBe(2);
    const publish = y.slice(y.indexOf("server-publish:"));
    expect(publish).toContain("gh release view \"$TAG\" --json targetCommitish --jq .targetCommitish");
    expect(publish).toMatch(/elif \[ "\$TARGET" != "\$GITHUB_SHA" \]; then/);
    expect(publish).toMatch(/gh release create "\$TAG" server-release\/\*\.msi --target "\$GITHUB_SHA"/);
  });
});
