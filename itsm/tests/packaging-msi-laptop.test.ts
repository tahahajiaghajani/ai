// The server MSI on a laptop or lab PC (D1), checked on the files themselves (WiX and PowerShell do not run here; the
// Windows CI job builds the MSI and installs it with 443 / 80 held by other programs): a preflight before any file is
// copied, the «Server settings» dialog after the folder dialog, a failure dialog that says where the reason is, the
// reason written to install-error.txt and the event log, and CI scenarios for busy ports.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../packaging/server");
const read = (f: string) => readFileSync(join(root, f), "utf8");
const x = read("wix/Package.wxs");
const install = read("scripts/install.ps1");
const smoke = read("scripts/smoke-test.ps1");
const workflow = readFileSync(join(__dirname, "../../.github/workflows/itsm.yml"), "utf8");

describe("the MSI's preflight (launch conditions, before any file is copied)", () => {
  it("stops on ARM64, a build older than 17763 and a Group Policy that blocks PowerShell scripts, with a precise message", () => {
    expect(x).toMatch(/<RegistrySearch Id="KarizArch" Root="HKLM" Key="SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment" Name="PROCESSOR_ARCHITECTURE"/);
    expect(x).toContain('<Launch Condition="Installed OR NOT KARIZARCH OR KARIZARCH = &quot;AMD64&quot;"');
    expect(x).toContain('<Launch Condition="Installed OR NOT KARIZBUILD OR KARIZBUILD &gt;= 17763"');
    expect(x).toMatch(/Key="SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell" Name="EnableScripts"/);
    expect(x).toContain('<Launch Condition="Installed OR NOT (KARIZPSENABLE = &quot;#0&quot; OR KARIZPSPOLICY ~= &quot;AllSigned&quot;)"');
    // administrator, 64-bit Windows and memory stay
    expect(x).toContain('<Launch Condition="Privileged"');
    expect(x).toContain('<Launch Condition="VersionNT64"');
    expect(x).toContain("PhysicalMemory &gt;= 3800");
  });
});

describe("the «Server settings» dialog", () => {
  it("comes after the folder dialog and before the summary, both ways", () => {
    expect(x).toContain('<Dialog Id="KarizSetupDlg"');
    expect(x).toContain('<Publish Dialog="InstallDirDlg" Control="Next" Event="NewDialog" Value="KarizSetupDlg" Order="5" Condition="WIXUI_DONTVALIDATEPATH OR WIXUI_INSTALLDIR_VALID=&quot;1&quot;" />');
    expect(x).toContain('<Publish Dialog="VerifyReadyDlg" Control="Back" Event="NewDialog" Value="KarizSetupDlg" Order="5" Condition="NOT Installed" />');
    const dlg = x.slice(x.indexOf('<Dialog Id="KarizSetupDlg"'), x.indexOf("</Dialog>", x.indexOf('<Dialog Id="KarizSetupDlg"')));
    expect(dlg).toContain('<Publish Event="NewDialog" Value="InstallDirDlg" />');
    expect(dlg).toContain('<Publish Event="NewDialog" Value="VerifyReadyDlg" Order="8" Condition="NOT KARIZUIERROR" />');
  });

  it("edits the silent install's own properties: host name, HTTPS / HTTP port and data folder", () => {
    for (const p of ["HOSTNAME", "PORT", "HTTPPORT", "DATADIR"]) expect(x).toMatch(new RegExp(`<Control Id="\\w+" Type="Edit"[^>]*Property="${p}"`));
    // the host name defaults to this computer's DNS name, never on an upgrade (it keeps its address)
    expect(x).toContain('Value="[KARIZTCPHOST].[KARIZTCPDOMAIN]"');
    expect(x).toMatch(/Action="KarizUiFqdn"[^>]*Condition="NOT HOSTNAME AND NOT WIX_UPGRADE_DETECTED AND NOT PREVIOUSDATADIR/);
  });

  it("validates what was typed before going on", () => {
    const next = x.slice(x.indexOf('<Control Id="Next" Type="PushButton" X="236" Y="243" Width="56" Height="17" Default="yes" Text="!(loc.WixUINext)">'));
    expect(next).toContain('Condition="PORT AND NOT ((PORT ~= &quot;auto&quot;) OR (PORT &gt;= 1 AND PORT &lt;= 65535))"');
    expect(next).toContain('Condition="HTTPPORT AND NOT ((HTTPPORT ~= &quot;auto&quot;) OR (HTTPPORT &gt;= 0 AND HTTPPORT &lt;= 65535))"');
    expect(next).toContain("The HTTPS and HTTP ports must differ.");
    expect(next).toContain("Data folder: give a full path");
    expect(next).toContain("Host name: letters, digits, dots and hyphens only");
    expect(next).toContain('<Publish Event="SpawnDialog" Value="KarizInvalidDlg" Order="7" Condition="KARIZUIERROR" />');
    expect(x).toContain('<Dialog Id="KarizInvalidDlg"');
  });

  it("holds ASCII text only (MSI tables)", () => {
    const ui = x.slice(x.indexOf('<UI Id="KarizSetupUI">'), x.indexOf("</UI>"));
    expect([...ui].every((c) => c.charCodeAt(0) < 0x80)).toBe(true);
  });
});

describe("a failed install says where the reason is", () => {
  it("the failure dialog names install-error.txt and the event log (WixUI's texts replaced at build time)", () => {
    const wxl = read("wix/Package.en-us.wxl");
    expect(wxl).toContain('<WixLocalization Culture="en-US" Codepage="1252" xmlns="http://wixtoolset.org/schemas/v4/wxl">');
    expect(wxl).toMatch(/<String Id="FatalErrorDescription1" Value="[^"]*\[DATADIR\]\\logs\\install-error\.txt[^"]*event log \(source Kariz\)/);
    expect(wxl).toContain('<String Id="FatalErrorDescription2"');
    expect([...wxl].every((c) => c.charCodeAt(0) < 0x80)).toBe(true);
    expect(read("scripts/build-msi.ps1")).toContain("'-culture', 'en-US', '-loc', (Join-Path $PSScriptRoot '..\\wix\\Package.en-us.wxl')");
  });

  it("install.ps1 writes the reason to install-error.txt and the Application event log, masked, on every failure", () => {
    expect(install).toContain("$script:ErrorFile = Join-Path $DataDir 'logs\\install-error.txt'");
    expect(install).toMatch(/function Write-InstallError\(\[string\]\$Reason\)/);
    expect(install).toContain("Write-EventLogEntry (Get-EventSource) $text 'Error' 1001");
    const c = install.slice(install.indexOf("\n} catch {"));
    expect(c).toContain("$reason = $reason.Replace($CertPassword, '********')");
    expect(c).toContain("Write-InstallError $reason");
    // the data folder's checks run inside the try: a refused DATADIR reaches the event log too
    expect(install.indexOf("Assert-DataDir $DataDir")).toBeGreaterThan(install.indexOf("\ntry {"));
    // a stale reason of an earlier run is removed
    expect(install).toContain("if (Test-Path -LiteralPath $script:ErrorFile) { Remove-Item -LiteralPath $script:ErrorFile");
    expect(read("scripts/common.ps1")).toContain("[System.Diagnostics.EventLog]::CreateEventSource($Source, 'Application')");
    expect(JSON.parse(read("edition.json")).eventSource).toBe("Kariz");
  });

  it("install.ps1 checks the machine and chooses the ports with karizctl preflight before it changes anything", () => {
    const pf = install.indexOf("Invoke-Ctl $pfArgs -Quiet");
    expect(pf).toBeGreaterThan(0);
    expect(pf).toBeLessThan(install.indexOf("Invoke-Ctl $initArgs"));
    expect(pf).toBeLessThan(install.indexOf("Register-Svc $dbSvc"));
    expect(install).toContain("if (-not $pf.ok) { Fail ((@($pf.errors) | Where-Object { $_ }) -join '; ') }");
    // the firewall rule and the public address use the chosen ports
    expect(install).toContain("$ports = @([int]$HttpsPort)");
    expect(install).toContain("$initArgs += @('--public-url', (Get-PublicUrl $HostName $HttpsPort))");
  });
});

describe("CI: busy ports", () => {
  it("installs with default properties while 443 and 80 are held, and reaches the address of setup-url.txt", () => {
    expect(smoke).toMatch(/function Start-Squatter/);
    expect(smoke).toContain("Start-Squatter 443");
    expect(smoke).toContain("Start-Squatter 80");
    const first = smoke.slice(smoke.indexOf("Write-Step \"install $([IO.Path]::GetFileName($Msi)) (silent"));
    expect(first.slice(0, 400)).not.toMatch(/PORT=/);
    expect(smoke).toContain("$script:base = Get-SetupBase");
  });

  it("refuses a given busy port with its reason in install-error.txt, and accepts the dialog's properties silently", () => {
    expect(smoke).toContain("Invoke-MsiExpectFailure");
    expect(smoke).toMatch(/install-error\.txt/);
    expect(smoke).toContain("PORT=auto");
    expect(smoke).toContain("HTTPPORT=0");
    expect(workflow).toContain("smoke-test.ps1");
    expect(workflow).toMatch(/packaging\/server\/scripts\/smoke-test\.ps1, packaging\/server\/scripts\/build-msi\.ps1/);
  });
});
