# The bank installation, simulated end to end on a Windows machine with no Internet (docs/qa/BANK_SIM_FA.md; CI job
# bank-sim of .github/workflows/itsm.yml). The runner plays the bank's application server on an intranet: Windows
# Firewall cuts every outbound connection except the LAN, a PKI made with PowerShell plays the bank's CA, a Node LDAPS
# server plays the domain controller and a Node SMTP server the mail relay, Playwright's Chromium plays a branch PC.
# The scenarios run in the order of the brief: prepare and cut the Internet -> bank PKI -> install 1.0.0 as the admin
# would (silent msiexec with the bank's certificate, first-run setup in the browser, members, records, e-mail, AD)
# -> backup -> upgrade in place to this build -> LAN client in a browser (no foreign request, no console error) ->
# demo data -> security posture -> resilience -> load -> DR drill -> the Windows app (headless) -> uninstall and
# re-install, then uninstall with REMOVEDATA=1 -> no outbound attempt by the server's processes.
# Every scenario is timed and reported (report.md / report.json in -Out, with all logs, screenshots and phase files);
# a failed scenario is recorded and the run goes on where it can; the exit code is 1 when any scenario failed.
#
#   powershell -File bank-sim.ps1 -Msi10 Kariz-Server-1.0.0.msi -Msi11 Kariz-Server-1.1.0.msi -Out C:\bank-sim
param(
    [Parameter(Mandatory)][string]$Msi10,
    [Parameter(Mandatory)][string]$Msi11,
    [string]$Out = (Join-Path $env:RUNNER_TEMP 'bank-sim'),
    [string]$HostName = 'kariz.bank.local',
    [string]$DataDir = '',
    [int]$LoadUsers = 40,
    [int]$LoadSeconds = 180,
    # scenarios to skip (numbers), for a quick re-run while developing
    [int[]]$Skip = @(),
    # run only these scenarios (CI runs the simulation in several steps, so the step that fails is visible even if the
    # machine is lost); the context (addresses, PKI, ports, backup, results) carries over in <Out>\context.json
    [int[]]$Only = @(),
    # write the report, stop the mock servers and restore the network (the last step; runs whatever happened before)
    [switch]$Report
)
. (Join-Path $PSScriptRoot '..\common.ps1')
. (Join-Path $PSScriptRoot 'bank-net.ps1')
. (Join-Path $PSScriptRoot 'bank-pki.ps1')

$Started = Get-Date
New-Item -ItemType Directory -Force -Path $Out | Out-Null
foreach ($d in @('logs', 'phases', 'shots', 'pki', 'server-logs', 'perf')) { New-Item -ItemType Directory -Force -Path (Join-Path $Out $d) | Out-Null }
Set-LogFile (Join-Path $Out 'logs\bank-sim.log')
$Msi10 = (Resolve-Path $Msi10).Path
$Msi11 = (Resolve-Path $Msi11).Path
$Itsm = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$Js = Join-Path $Itsm 'scripts\bank-sim'
$NodeExe = (Get-Command node -ErrorAction Stop).Source
$edition = Read-Edition (Join-Path $PSScriptRoot '..\..')
$InstallDir = $edition.installDir
if (-not $DataDir) { $DataDir = if (Test-Path 'D:\') { 'D:\Kariz' } else { 'C:\KarizData' } }
$Config = Join-Path $DataDir $edition.configFile
$Ctl = Join-Path $InstallDir "$($edition.ctl).cmd"
$StateFile = Join-Path $Out 'state.json'
$MailFile = Join-Path $Out 'logs\mail.jsonl'
$Base = "https://$HostName"
$PfxPassword = 'Bank-Pfx-' + [Guid]::NewGuid().ToString('N').Substring(0, 12)
$script:Lan = $null
$script:Pki = $null
$script:SavedFw = $null
$script:Mocks = @()
$script:Results = New-Object System.Collections.ArrayList
$script:Notes = New-Object System.Collections.ArrayList
$script:Findings = New-Object System.Collections.ArrayList
$script:Backup = $null
$script:BackupAt = $null
$script:CutAt = $null
$script:Ports = $null
$script:Aborted = $false
$ContextFile = Join-Path $Out 'context.json'
# the PFX password carries over beside the output folder, never in it (the folder is the CI artifact)
$PfxPasswordFile = Join-Path (Split-Path -Parent $Out) 'bank-sim-pfx-password.txt'

function Save-Context {
    $ctx = [pscustomobject]@{
        started = $Started.ToString('o'); lan = $script:Lan; cut_at = $(if ($script:CutAt) { ([datetime]$script:CutAt).ToString('o') } else { $null })
        pki = $script:Pki; saved_fw = $script:SavedFw; ports = $script:Ports; backup = $script:Backup
        backup_at = $(if ($script:BackupAt) { ([datetime]$script:BackupAt).ToString('o') } else { $null })
        mocks = @($script:Mocks | ForEach-Object { $_.Id }); results = @($script:Results); findings = @($script:Findings); aborted = $script:Aborted
    }
    Write-Utf8 $ContextFile ($ctx | ConvertTo-Json -Depth 8)
    if (-not (Test-Path -LiteralPath $PfxPasswordFile)) { Write-Utf8 $PfxPasswordFile $PfxPassword }
}

# a run of every scenario at once starts afresh; a CI step (-Only) or the report (-Report) carries on from the earlier steps
if (-not $Only.Count -and -not $Report) { Remove-Item -LiteralPath $ContextFile, $PfxPasswordFile -Force -ErrorAction SilentlyContinue }
elseif (-not (Test-Path -LiteralPath $ContextFile)) { Remove-Item -LiteralPath $PfxPasswordFile -Force -ErrorAction SilentlyContinue }
if (Test-Path -LiteralPath $ContextFile) {
    $ctx = Get-Content -LiteralPath $ContextFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $Started = [datetime]$ctx.started
    $script:Lan = $ctx.lan
    if ($ctx.cut_at) { $script:CutAt = [datetime]$ctx.cut_at }
    $script:Pki = $ctx.pki
    $script:SavedFw = $ctx.saved_fw
    $script:Ports = $ctx.ports
    $script:Backup = $ctx.backup
    if ($ctx.backup_at) { $script:BackupAt = [datetime]$ctx.backup_at }
    if (Test-Path -LiteralPath $PfxPasswordFile) { $PfxPassword = (Get-Content -LiteralPath $PfxPasswordFile -Raw -Encoding UTF8).Trim() }
    foreach ($id in @($ctx.mocks)) { if ($id) { $mp = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($mp) { $script:Mocks += $mp } } }
    foreach ($r in @($ctx.results)) { if ($r) { [void]$script:Results.Add($r) } }
    foreach ($f in @($ctx.findings)) { if ($f) { [void]$script:Findings.Add([string]$f) } }
    $script:Aborted = [bool]$ctx.aborted
}

# A property of a parsed JSON object, or $null when it is absent (Set-StrictMode 2 throws on a missing property).
function Get-Prop($o, [string]$Name) {
    if ($null -ne $o -and $o.PSObject.Properties[$Name]) { return $o.PSObject.Properties[$Name].Value }
    return $null
}

function Note([string]$m) { Write-Log $m; [void]$script:Notes.Add($m) }
function Finding([string]$m) { Write-Log "FINDING: $m" 'WARN'; [void]$script:Findings.Add($m) }

# One scenario: timed, its result recorded; a critical one stops the run when it fails.
function Invoke-Scenario([int]$Id, [string]$Title, [scriptblock]$Body, [switch]$Critical, [switch]$Stretch) {
    if ($Report -or ($Only.Count -and $Only -notcontains $Id)) { return }
    if ($Skip -contains $Id) { [void]$script:Results.Add([pscustomobject]@{ id = $Id; title = $Title; status = 'skipped'; seconds = 0; detail = ''; notes = @() }); return }
    Write-Step "[$Id] $Title"
    $script:Notes.Clear()
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $status = 'pass'
    $detail = ''
    try { & $Body } catch {
        $status = if ($Stretch) { 'stretch-fail' } else { 'fail' }
        $detail = [string]$_.Exception.Message
        Write-Log "scenario $Id failed: $detail" 'ERROR'
        Write-Log ([string]$_.ScriptStackTrace) 'ERROR'
        if ($env:GITHUB_ACTIONS -eq 'true') { Write-Host "::error::[$Id] $Title - $detail" }
    }
    $sw.Stop()
    [void]$script:Results.Add([pscustomobject]@{ id = $Id; title = $Title; status = $status; seconds = [math]::Round($sw.Elapsed.TotalSeconds, 1); detail = $detail; notes = @($script:Notes) })
    Write-Log ("[{0}] {1}: {2} in {3:N1} s" -f $Id, $Title, $status.ToUpperInvariant(), $sw.Elapsed.TotalSeconds)
    Save-Context
    if ($status -eq 'fail' -and $Critical) { throw "critical scenario $Id failed: $detail" }
}

# A Node script of scripts/bank-sim with the runner's Node.js and the Windows certificate store (--use-system-ca); its
# output streams into the log; its checks come back from the phase file. Throws with the failed checks.
# $Phase names the run (api-verify-upgrade); the script's phase is the part after the prefix, without a run suffix.
function Invoke-Js([string]$Script, [string]$Phase, [string[]]$Arguments = @(), [switch]$AllowFail) {
    $file = Join-Path $Out "phases\$Phase.json"
    if (Test-Path $file) { Remove-Item $file -Force }
    $name = ($Phase -replace '^(browser|api)-', '') -replace '-(\d+|upgrade|resilience|reinstall)$', ''
    $all = @('--use-system-ca', (Join-Path $Js $Script), '--phase', $name, '--base', $Base, '--state', $StateFile, '--out', $file) + $Arguments
    Write-Log "node $($all -join ' ')"
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $NodeExe @all 2>&1 | ForEach-Object { Write-Log "    $_" } } finally { $ErrorActionPreference = $prev }
    $code = $LASTEXITCODE
    $res = $null
    if (Test-Path $file) { $res = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json }
    if ($res) {
        foreach ($n in @($res.notes)) { if ($n) { Note "[$Phase] $n" } }
        foreach ($k in @($res.metrics.PSObject.Properties)) { Note ("[{0}] {1} = {2}" -f $Phase, $k.Name, ($k.Value | ConvertTo-Json -Compress -Depth 6)) }
    }
    if ($code -ne 0 -and -not $AllowFail) {
        $failed = if ($res) { @($res.checks | Where-Object { -not $_.ok } | ForEach-Object { "$($_.what): $($_.detail)" }) -join ' | ' } else { "exit code $code, no result file" }
        throw "$Phase failed: $failed"
    }
    return $res
}

function Invoke-Ctl([string[]]$Arguments, [switch]$Timed) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $out = Invoke-Native -File $Ctl -Arguments ($Arguments + @('--config', $Config))
    $sw.Stop()
    if ($Timed) { Note ("karizctl {0}: {1:N1} s" -f ($Arguments -join ' '), $sw.Elapsed.TotalSeconds) }
    return $sw.Elapsed.TotalSeconds
}

# The server's background work (demo pack, queued / running / failed jobs) into the log and phases\jobs-<Label>.json.
function Show-Jobs([string]$Label) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $NodeExe (Join-Path $Js 'jobs.mjs') --config $Config --out (Join-Path $Out "phases\jobs-$Label.json") 2>&1 | ForEach-Object { Write-Log "    [jobs] $_" } } finally { $ErrorActionPreference = $prev }
}

# A long karizctl command (demo load / purge --wait) with a time budget: the server's queue is shown every two minutes,
# and a command that overruns is stopped with the queue's state, the server's logs and its output kept.
function Invoke-CtlWatched([string[]]$Arguments, [int]$BudgetMinutes, [string]$Label) {
    $o = Join-Path $Out "logs\karizctl-$Label.out.log"
    $e = Join-Path $Out "logs\karizctl-$Label.err.log"
    $list = ($Arguments + @('--config', $Config)) | ForEach-Object { if ($_ -match '\s') { "`"$_`"" } else { $_ } }
    Write-Log "karizctl $($Arguments -join ' ') (budget $BudgetMinutes min)"
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $p = Start-Process -FilePath $Ctl -ArgumentList $list -RedirectStandardOutput $o -RedirectStandardError $e -PassThru -WindowStyle Hidden
    $null = $p.Handle
    $next = 60
    while (-not $p.WaitForExit(10000)) {
        if ($sw.Elapsed.TotalSeconds -ge $next) { Write-Log ("karizctl {0}: {1:N0} s so far" -f $Label, $sw.Elapsed.TotalSeconds); Show-Jobs $Label; $next += 120 }
        if ($sw.Elapsed.TotalMinutes -ge $BudgetMinutes) {
            Show-Jobs "$Label-overrun"
            & taskkill.exe /T /F /PID $p.Id 2>&1 | Out-Null
            Get-Content $o, $e -ErrorAction SilentlyContinue | Select-Object -Last 20 | ForEach-Object { Write-Log "    $_" }
            Copy-ServerLogs
            Fail ("karizctl {0} did not finish within {1} minutes" -f ($Arguments -join ' '), $BudgetMinutes)
        }
    }
    $sw.Stop()
    Get-Content $o, $e -ErrorAction SilentlyContinue | ForEach-Object { Write-Log "    $_" }
    if ($p.ExitCode -ne 0) { Show-Jobs "$Label-failed"; Fail "karizctl $($Arguments -join ' ') exited with code $($p.ExitCode)" }
    Note ("karizctl {0}: {1:N1} s" -f ($Arguments -join ' '), $sw.Elapsed.TotalSeconds)
    Show-Jobs "$Label-done"
    return $sw.Elapsed.TotalSeconds
}

function Invoke-Msi([string[]]$Arguments, [string]$Log, [string[]]$Mask = @(), [switch]$AllowFail) {
    $all = ($Arguments + @('/qn', '/norestart', '/l*v', $Log)) | ForEach-Object {
        if ($_ -match '\s' -and $_ -notmatch '"') { if ($_ -match '^([A-Z]+)=(.*)$') { "$($Matches[1])=`"$($Matches[2])`"" } else { "`"$_`"" } } else { $_ }
    }
    $shown = $all -join ' '
    foreach ($m in $Mask) { $shown = $shown.Replace($m, '********') }
    Write-Log "msiexec $shown"
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $p = Start-Process -FilePath 'msiexec.exe' -ArgumentList $all -Wait -PassThru
    $sw.Stop()
    Note ("msiexec {0}: exit {1} in {2:N0} s" -f $Arguments[0], $p.ExitCode, $sw.Elapsed.TotalSeconds)
    if ($AllowFail) { return [int]$p.ExitCode }
    if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) {
        Get-Content $Log -Encoding Unicode -ErrorAction SilentlyContinue | Select-String -Pattern 'Return value 3|error|ERROR|STEP|WARN' | Select-Object -Last 80 | ForEach-Object { Write-Log "   $_" }
        Copy-ServerLogs
        Fail "msiexec $($Arguments[0]) failed with exit code $($p.ExitCode)"
    }
    return $sw.Elapsed.TotalSeconds
}

function Copy-ServerLogs {
    $dest = Join-Path $Out 'server-logs'
    foreach ($d in @((Join-Path $DataDir 'logs'), (Join-Path $DataDir 'logs\service'), (Join-Path $DataDir 'db\log'))) {
        if (Test-Path $d) { Get-ChildItem $d -File -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName (Join-Path $dest ("{0}-{1}" -f (Split-Path -Leaf $d), $_.Name)) -Force -ErrorAction SilentlyContinue } }
    }
}

function Assert-Services([string]$Want) {
    foreach ($s in @($edition.services.db.name, $edition.services.app.name)) {
        $svc = Get-Service -Name $s -ErrorAction SilentlyContinue
        if ($Want -eq 'absent') { if ($svc) { Fail "service $s still exists" }; continue }
        if (-not $svc -or $svc.Status -ne 'Running') { Copy-ServerLogs; Fail "service $s is not running" }
        $w = Get-CimInstance Win32_Service -Filter "Name='$s'"
        if ($w.StartName -ne "NT SERVICE\$s") { Fail "service $s runs as $($w.StartName), not the virtual account NT SERVICE\$s" }
        if ($w.PathName -match '\s' -and $w.PathName -notmatch '^"') { Fail "service $s has an unquoted path with spaces: $($w.PathName)" }
    }
    if ($Want -ne 'absent') { Write-Log 'services KarizDB and KarizApp running as their virtual accounts (quoted paths)' }
}

function Read-Config { return (Get-Content -LiteralPath $Config -Raw -Encoding UTF8 | ConvertFrom-Json) }

function Start-Mock([string]$Name, [string[]]$Arguments) {
    $o = Join-Path $Out "logs\$Name.out.log"
    $e = Join-Path $Out "logs\$Name.err.log"
    $all = @((Join-Path $Js "$Name.mjs")) + $Arguments | ForEach-Object { if ($_ -match '\s') { "`"$_`"" } else { $_ } }
    $p = Start-Process -FilePath $NodeExe -ArgumentList $all -RedirectStandardOutput $o -RedirectStandardError $e -PassThru -WindowStyle Hidden
    $script:Mocks += $p
    Start-Sleep -Seconds 4
    if ($p.HasExited) { Get-Content $o, $e -ErrorAction SilentlyContinue | ForEach-Object { Write-Log "   $_" }; Fail "$Name exited at start (code $($p.ExitCode))" }
    Write-Log "$Name running (pid $($p.Id))"
}

# The installed server's programs (by path): node.exe of the installation, postgres.exe and the service wrappers.
function Get-KarizProcesses {
    return @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith("$InstallDir\", [StringComparison]::OrdinalIgnoreCase) })
}

function Get-AppWorkers {
    $all = Get-KarizProcesses
    $wrapper = $all | Where-Object { $_.Name -eq "$($edition.services.app.name).exe" } | Select-Object -First 1
    $sup = $all | Where-Object { $_.Name -eq 'node.exe' -and $wrapper -and $_.ParentProcessId -eq $wrapper.ProcessId } | Select-Object -First 1
    $workers = @($all | Where-Object { $_.Name -eq 'node.exe' -and $sup -and $_.ParentProcessId -eq $sup.ProcessId })
    return [pscustomobject]@{ Supervisor = $sup; Workers = $workers }
}

# KarizApp's and KarizDB's processes sampled in the background (resources.ps1: memory and processor time every 2 s)
# into perf\resources-<Label>.jsonl, for docs/qa/PERFORMANCE_E2E_FA.md section 2; scripts/bank-sim/perf.mjs sums them up.
function Start-Sampler([string]$Label) {
    $file = Join-Path (Join-Path $Out 'perf') "resources-$Label.jsonl"
    $stop = "$file.stop"
    Remove-Item -LiteralPath $file, $stop -Force -ErrorAction SilentlyContinue
    $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $q = { param($v) '"' + ([string]$v).TrimEnd('\') + '"' }
    $argList = @('-NoProfile', '-NonInteractive', '-File', (& $q (Join-Path $PSScriptRoot 'resources.ps1')), '-InstallDir', (& $q $InstallDir), '-Out', (& $q $file), '-Stop', (& $q $stop))
    $p = Start-Process -FilePath $ps -ArgumentList $argList -PassThru -WindowStyle Hidden
    $null = $p.Handle
    Write-Log "resource sampler '$Label' running (pid $($p.Id)): $file"
    return [pscustomobject]@{ Label = $Label; Out = $file; Stop = $stop; Process = $p }
}

function Stop-Sampler($Sampler) {
    if (-not $Sampler) { return }
    Set-Content -LiteralPath $Sampler.Stop -Value 'stop' -Encoding ASCII
    if (-not $Sampler.Process.WaitForExit(20000)) { try { Stop-Process -Id $Sampler.Process.Id -Force } catch { } }
    Remove-Item -LiteralPath $Sampler.Stop -Force -ErrorAction SilentlyContinue
    $n = 0
    if (Test-Path -LiteralPath $Sampler.Out) { $n = @(Get-Content -LiteralPath $Sampler.Out).Count }
    Write-Log "resource sampler '$($Sampler.Label)' stopped: $n samples"
}

# Allow ACEs of everyone / users / authenticated users / interactive / guests on a path ($WriteOnly: only write-ish rights).
$WideSids = @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545', 'S-1-5-4', 'S-1-5-32-546', 'S-1-5-7', 'S-1-5-2')
function Get-WideAces([string]$Path, [switch]$WriteOnly) {
    $bad = @()
    $acl = Get-Acl -LiteralPath $Path
    foreach ($ace in $acl.Access) {
        if ($ace.AccessControlType -ne 'Allow') { continue }
        $sid = try { $ace.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { [string]$ace.IdentityReference }
        if ($WideSids -notcontains $sid) { continue }
        $rights = [int64]$ace.FileSystemRights
        if ($WriteOnly -and -not ($rights -band (0x2 -bor 0x4 -bor 0x10 -bor 0x100 -bor 0x10000 -bor 0x40000 -bor 0x80000 -bor 0x40000000 -bor 0x10000000))) { continue }
        $bad += "$($ace.IdentityReference): $($ace.FileSystemRights)"
    }
    return $bad
}

# ======================================================================================================================
try {
    if ($script:Aborted -and -not $Report) { Fail 'an earlier step stopped the simulation (critical scenario failed)' }
    if (-not $script:Lan) { $script:Lan = Get-LanInfo }
    # the mock domain controller and mail relay keep running between the CI steps; started again if they are gone
    if ($script:Pki -and -not $Report) {
        if ((Test-TcpOpen 'smtp.bank.local' 587 3000) -ne 'open') {
            Write-Log 'the mock mail relay is not running: starting it again'
            Start-Mock 'smtp-sink' @('--host', $script:Lan.Ip, '--ports', '25,587', '--pfx', $script:Pki.smtp, '--passphrase', $PfxPassword, '--out', $MailFile)
        }
        if ((Test-TcpOpen 'dc1.bank.local' 636 3000) -ne 'open') {
            Write-Log 'the mock domain controller is not running: starting it again'
            Start-Mock 'ldap-mock' @('--host', $script:Lan.Ip, '--port', '636', '--pfx', $script:Pki.dc1, '--passphrase', $PfxPassword, '--info', (Join-Path $Out 'logs\ldap-info.json'), '--log', (Join-Path $Out 'logs\ldap-activity.json'))
        }
    }
    Write-Log ("machine: {0}, {1} logical processors, {2} GB memory; LAN {3} ({4}); data folder {5}" -f (Get-CimInstance Win32_OperatingSystem).Caption, (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors, [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1), $script:Lan.Ip, $script:Lan.Cidr, $DataDir)

    Invoke-Scenario 1 'Prepare, then cut the internet' -Critical {
        foreach ($f in @($Msi10, $Msi11)) { Note ("{0}: {1:N1} MB" -f (Split-Path -Leaf $f), ((Get-Item $f).Length / 1MB)) }
        $chrome = & $NodeExe -e "console.log(require('module').createRequire(process.argv[1])('playwright').chromium.executablePath())" (Join-Path $Itsm 'package.json')
        if (-not ($chrome -and (Test-Path ([string]$chrome).Trim()))) { Fail "Playwright's Chromium is not installed ($chrome)" }
        Note "Chromium for the LAN client: $chrome"
        Add-HostsEntries $script:Lan.Ip @($HostName, 'dc1.bank.local', 'smtp.bank.local')
        $script:SavedFw = Enable-BankNetwork $script:Lan (Join-Path $Out 'logs')
        $script:CutAt = Get-Date
        foreach ($t in @(@('1.1.1.1', 443), @('8.8.8.8', 53), @('140.82.112.3', 443), @('www.microsoft.com', 443), @('registry.npmjs.org', 443))) {
            $r = Test-TcpOpen $t[0] $t[1]
            if ($r -eq 'open') { Fail "the Internet is still reachable: $($t[0]):$($t[1])" }
            Note "Internet unreachable as expected: $($t[0]):$($t[1]) -> $r"
        }
        $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        $nodeOut = & $NodeExe -e "fetch('https://www.google.com/',{signal:AbortSignal.timeout(15000)}).then(r=>{console.log('REACHED',r.status);process.exit(1)},e=>{console.log('blocked:',e.cause?.code??e.message);process.exit(0)})" 2>&1
        $ErrorActionPreference = $prev
        if ($LASTEXITCODE -ne 0) { Fail "Node.js still reaches the Internet: $nodeOut" }
        Note "Node.js fetch to the Internet: $nodeOut"
        $dnsName = [System.Net.Dns]::GetHostAddresses($HostName) | Select-Object -First 1
        if ([string]$dnsName -ne $script:Lan.Ip) { Fail "$HostName resolves to $dnsName, not the LAN address $($script:Lan.Ip)" }
        Note "$HostName -> $($script:Lan.Ip) (hosts file, as the bank's DNS A record)"
    }

    Invoke-Scenario 2 'Bank PKI (root CA, server certificates, PFX, LocalMachine\Root)' -Critical {
        $script:Pki = New-BankPki (Join-Path $Out 'pki') $PfxPassword $script:Lan.Ip @{ kariz = $HostName; dc1 = 'dc1.bank.local'; smtp = 'smtp.bank.local' }
        $inRoot = Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Thumbprint -eq $script:Pki.root }
        if (-not $inRoot) { Fail 'the bank root CA is not in LocalMachine\Root' }
        Start-Mock 'smtp-sink' @('--host', $script:Lan.Ip, '--ports', '25,587', '--pfx', $script:Pki.smtp, '--passphrase', $PfxPassword, '--out', $MailFile)
        Start-Mock 'ldap-mock' @('--host', $script:Lan.Ip, '--port', '636', '--pfx', $script:Pki.dc1, '--passphrase', $PfxPassword, '--info', (Join-Path $Out 'logs\ldap-info.json'), '--log', (Join-Path $Out 'logs\ldap-activity.json'))
        foreach ($p in @(@('smtp.bank.local', 587), @('dc1.bank.local', 636))) { $r = Test-TcpOpen $p[0] $p[1]; if ($r -ne 'open') { Fail "$($p[0]):$($p[1]) is not reachable on the LAN ($r)" } }
        Note 'the mock domain controller (LDAPS 636) and mail relay (25, 587 STARTTLS) answer on the LAN'
    }

    Invoke-Scenario 3 'Install 1.0.0 the way the bank admin would' -Critical {
        foreach ($port in @(443, 80)) {
            $held = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($held) { Note ("before the install, port {0} is held by {1} (pid {2})" -f $port, (Get-Process -Id $held.OwningProcess -ErrorAction SilentlyContinue).ProcessName, $held.OwningProcess) }
        }
        $props = @('/i', $Msi10, "HOSTNAME=$HostName", "DATADIR=$DataDir", "CERTPATH=$($script:Pki.kariz)", "CERTPASSWORD=$PfxPassword")
        $log = Join-Path $Out 'logs\msi-install-1.0.0.log'
        $code = Invoke-Msi $props $log -Mask @($PfxPassword) -AllowFail
        if ($code -ne 0 -and $code -ne 3010) {
            # 1.0.0 cannot move off a busy default port by itself (1.1.0 does); the guide's remedy: give another port
            $why = ''
            $ef = Join-Path $DataDir 'logs\install-error.txt'
            if (Test-Path $ef) { $why = (Get-Content -LiteralPath $ef -Raw -Encoding UTF8) }
            else { $il = Get-ChildItem (Join-Path $DataDir 'logs') -Filter 'install-*.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1; if ($il) { $why = (Get-Content -LiteralPath $il.FullName -Raw -Encoding UTF8) } }
            if ($why -notmatch 'port 80 is already used') { Copy-ServerLogs; Fail "the 1.0.0 install failed (exit $code): $($why.Trim())" }
            $sys = ''
            try { $sys = (& netsh.exe http show servicestate view=requestq | Select-String -Pattern 'Process IDs|Controller process|Registered URLs|HTTP://\*:80|HTTP://\+:80' | Select-Object -First 8 | ForEach-Object { "$_".Trim() }) -join '; ' } catch { $sys = $_.Exception.Message }
            Finding "1.0.0: port 80 is held by Windows (HTTP.sys, System pid 4) on this Windows Server 2025 machine, so a silent install with the default ports fails ('port 80 is already used by System'); 1.1.0 moves to the next free port by itself. HTTP.sys: $sys"
            Note 'the admin follows the guide and installs 1.0.0 again with HTTPPORT=8080'
            $code = Invoke-Msi ($props + @('HTTPPORT=8080')) (Join-Path $Out 'logs\msi-install-1.0.0-retry.log') -Mask @($PfxPassword) -AllowFail
            if ($code -ne 0 -and $code -ne 3010) { Copy-ServerLogs; Fail "the 1.0.0 install with HTTPPORT=8080 failed too (exit $code)" }
        }
        $msiLog = (Get-ChildItem (Join-Path $Out 'logs') -Filter 'msi-install-1.0.0*.log' | ForEach-Object { [IO.File]::ReadAllText($_.FullName) }) -join "`n"
        if ($msiLog.Contains($PfxPassword)) { Fail 'the MSI log holds the certificate password' }
        Assert-Services 'running'
        $c = Read-Config
        Note "ports: HTTPS $($c.listen.https_port), HTTP $($c.listen.http_port), PostgreSQL $($c.db.port); public URL $($c.public_url); TLS $($c.tls.pfx)"
        if ([int]$c.listen.https_port -ne 443) { Fail "HTTPS on 443 expected, got $($c.listen.https_port)" }
        if ($c.public_url -ne $Base) { Fail "public URL $($c.public_url), expected $Base" }
        $script:Ports = [pscustomobject]@{ https = [int]$c.listen.https_port; http = [int]$c.listen.http_port; pg = [int]$c.db.port; pfx = [string]$c.tls.pfx }
        Invoke-Js 'api.mjs' 'api-fresh' @('--setup-file', (Join-Path $DataDir 'setup-url.txt')) | Out-Null
        # 1.0.0 hashes its pre-paint theme script over the CR LF of a Windows build, so Chromium refuses it (fixed in 1.1.0;
        # every later browser phase runs on 1.1.0 and fails on any console error)
        $bs = Invoke-Js 'browser.mjs' 'browser-setup' @('--shots', (Join-Path $Out 'shots'), '--allow-console', "violates the following Content Security Policy directive 'script-src")
        if (Get-Prop $bs.metrics 'known_console') { Finding '1.0.0: the CSP hash of the pre-paint theme script was computed over the CR LF line ends of the Windows build, while browsers hash the script after turning CR LF into LF: Chromium refused the script (console error, theme applied late). Fixed in 1.1.0 (newlines normalised before hashing)' }
        $pop = Invoke-Js 'api.mjs' 'api-populate' @('--mail-file', $MailFile, '--ldap-info', (Join-Path $Out 'logs\ldap-info.json'), '--ca-pem', $script:Pki.rootPem)
        if (Get-Prop $pop.metrics 'seeds_on_demand') { Finding '1.0.0: the modules'' defaults (IT catalogue, knowledge bases, SLA calendars) arrive 10-12 minutes after the first-run setup; fixed in 1.1.0 (the setup runs them at once)' }
        # the e-mail channel of the setup: STARTTLS on 587 with the relay's bank-CA certificate
        $n = Invoke-Js 'api.mjs' 'api-notify-1' @('--mail-file', $MailFile, '--smtp-port', '587', '--smtp-security', 'starttls', '--who', 'agent1', '--may-fail', '--mail-timeout', '90')
        if (-not (Get-Prop $n.metrics 'delivered')) {
            Finding '1.0.0: a notification over STARTTLS to the relay with a bank-CA certificate is not delivered (the server does not trust the Windows certificate store); fixed in 1.1.0 (KarizApp runs Node.js with --use-system-ca)'
            Get-Content (Join-Path $Out 'logs\smtp-sink.out.log') -Tail 20 -ErrorAction SilentlyContinue | ForEach-Object { Write-Log "   relay: $_" }
            Invoke-Js 'api.mjs' 'api-notify-2' @('--mail-file', $MailFile, '--smtp-port', '25', '--smtp-security', 'none', '--who', 'agent1') | Out-Null
            Note 'on 1.0.0 the channel was switched to the relay port 25 without TLS, and the e-mail arrived'
        }
    }

    Invoke-Scenario 4 'Backup with karizctl (kept for the DR drill)' {
        Invoke-Ctl @('backup') -Timed | Out-Null
        $b = Get-ChildItem (Join-Path $DataDir 'backups') -Directory -Filter 'itsm-manual-*' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if (-not $b) { Fail 'no backup folder' }
        $m = Get-Content -LiteralPath (Join-Path $b.FullName 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        if (-not $m.verified) { Fail "the backup is not verified: $($m.verify_detail)" }
        $script:Backup = $b.FullName
        $script:BackupAt = Get-Date
        Note ("backup {0}: {1:N1} MB dump, {2} attachment files, verified, app {3}" -f $b.Name, ($m.dump.size / 1MB), $m.blobs.files, $m.app_version)
        Invoke-Js 'api.mjs' 'api-mark' | Out-Null
    }

    Invoke-Scenario 5 'Upgrade in place to this build (no properties)' -Critical {
        $before = Read-Config
        $t = Invoke-Msi @('/i', $Msi11) (Join-Path $Out 'logs\msi-upgrade-1.1.0.log')
        Note ("upgrade took {0:N0} s" -f $t)
        Assert-Services 'running'
        $after = Read-Config
        foreach ($k in @('https_port', 'http_port')) { if ([int]$after.listen.$k -ne [int]$before.listen.$k) { Fail "the upgrade changed listen.$k from $($before.listen.$k) to $($after.listen.$k)" } }
        if ([int]$after.db.port -ne [int]$before.db.port) { Fail 'the upgrade changed the PostgreSQL port' }
        if ([string]$after.tls.pfx -ne [string]$before.tls.pfx) { Fail "the upgrade changed the certificate ($($before.tls.pfx) -> $($after.tls.pfx))" }
        if ([string]$after.public_url -ne [string]$before.public_url) { Fail 'the upgrade changed the public URL' }
        if ((@($after.network.allow) -join ',') -ne (@($before.network.allow) -join ',')) { Fail 'the upgrade changed the allow-list' }
        $pre = Get-ChildItem (Join-Path $DataDir 'backups') -Directory -Filter 'itsm-pre-upgrade-*' | Select-Object -First 1
        if (-not $pre) { Fail 'the upgrade took no safety backup' }
        Note "pre-upgrade safety backup: $($pre.Name); ports, certificate, public URL and allow-list kept"
        $inst = Get-ChildItem (Join-Path $DataDir 'logs') -Filter 'install-*.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($inst) {
            $mig = @(Select-String -LiteralPath $inst.FullName -Pattern 'migration' -ErrorAction SilentlyContinue)
            Note "install log $($inst.Name): $($mig.Count) migration lines"
        }
        Invoke-Js 'api.mjs' 'api-verify-upgrade' @('--expect-version', '1.1.0', '--expect-protocol', '15') | Out-Null
        Invoke-Js 'api.mjs' 'api-notify-3' @('--mail-file', $MailFile, '--smtp-port', '587', '--smtp-security', 'starttls', '--who', 'agent2', '--mail-timeout', '120') | Out-Null
        Note '1.1.0 delivers over STARTTLS to the relay whose certificate the bank CA issued'
        Invoke-Js 'api.mjs' 'api-ad-store' | Out-Null
        Note '1.1.0 reaches LDAPS with no root pasted in the source (the Windows store), and with it'
    }

    Invoke-Scenario 6 'A LAN client in a browser (admin and agent pages; no foreign request, no console error)' {
        Invoke-Js 'browser.mjs' 'browser-pages' @('--shots', (Join-Path $Out 'shots')) | Out-Null
    }

    Invoke-Scenario 7 'Demo data on the server (load, browse, purge)' {
        Invoke-CtlWatched @('demo', 'load', '--size', 'medium', '--wait', '--force') 45 'demo-load' | Out-Null
        Invoke-Js 'api.mjs' 'api-demo-on' | Out-Null
        Invoke-Js 'browser.mjs' 'browser-demo' @('--shots', (Join-Path $Out 'shots')) | Out-Null
        # the administrator's and the requester's main pages measured on the medium pack's volume (budgets: perf.mjs);
        # a page over its budget is recorded and the purge still runs
        $perfError = $null
        try { Invoke-Js 'browser.mjs' 'browser-perf' @('--shots', (Join-Path $Out 'shots')) | Out-Null } catch { $perfError = $_.Exception.Message }
        Invoke-CtlWatched @('demo', 'purge', '--yes', '--wait') 30 'demo-purge' | Out-Null
        Invoke-Js 'browser.mjs' 'browser-purged' @('--shots', (Join-Path $Out 'shots')) | Out-Null
        Invoke-Js 'api.mjs' 'api-demo-off' | Out-Null
        if ($perfError) { Fail $perfError }
    }

    Invoke-Scenario 8 'Security posture' {
        Invoke-Js 'api.mjs' 'api-security' @('--lan', $script:Lan.Ip, '--http-port', "$($script:Ports.http)", '--pg-port', "$($script:Ports.pg)") | Out-Null
        # listening ports of the server's programs: only the configured ones (PostgreSQL on loopback only)
        $procs = Get-KarizProcesses
        $ids = @($procs | ForEach-Object { [int]$_.ProcessId })
        $listen = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ids -contains [int]$_.OwningProcess })
        $want = @($script:Ports.https, $script:Ports.http, $script:Ports.pg)
        foreach ($l in $listen) {
            $p = $procs | Where-Object { [int]$_.ProcessId -eq [int]$l.OwningProcess } | Select-Object -First 1
            Note "listening: $($l.LocalAddress):$($l.LocalPort) ($($p.Name))"
            if ($want -notcontains [int]$l.LocalPort) { Fail "unexpected listening port $($l.LocalAddress):$($l.LocalPort) ($($p.Name))" }
            if ([int]$l.LocalPort -eq $script:Ports.pg -and $l.LocalAddress -notmatch '^(127\.0\.0\.1|::1)$') { Fail "PostgreSQL listens on $($l.LocalAddress)" }
        }
        $udp = @(Get-NetUDPEndpoint -ErrorAction SilentlyContinue | Where-Object { $ids -contains [int]$_.OwningProcess -and $_.LocalAddress -notmatch '^(127\.0\.0\.1|::1)$' })
        if ($udp.Count) { Fail "UDP endpoints outside loopback: $(($udp | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort)" }) -join ', ')" }
        # ACLs: nothing in the data folder for Users / Everyone / Authenticated Users; the program folder not writable by them
        $wide = @()
        foreach ($f in @(Get-Item -LiteralPath $DataDir) + @(Get-ChildItem -LiteralPath $DataDir -Recurse -Force -ErrorAction SilentlyContinue)) {
            $b = @(Get-WideAces $f.FullName)
            if ($b.Count) { $wide += "$($f.FullName): $($b -join '; ')" }
        }
        if ($wide.Count) { Fail "data folder entries open to users: $(($wide | Select-Object -First 10) -join ' | ')" }
        $count = @(Get-ChildItem -LiteralPath $DataDir -Recurse -Force -ErrorAction SilentlyContinue).Count
        Note "data folder: $count entries, none open to Users / Everyone / Authenticated Users"
        foreach ($secret in @($Config, (Join-Path $DataDir 'kariz-admin.json'), $script:Ports.pfx)) {
            if (-not (Test-Path -LiteralPath $secret)) { continue }
            $who = @((Get-Acl -LiteralPath $secret).Access | ForEach-Object { [string]$_.IdentityReference })
            Note "$(Split-Path -Leaf $secret): $($who -join ', ')"
            if ($secret -like '*kariz-admin.json' -and ($who | Where-Object { $_ -match 'KarizApp|KarizDB' })) { Fail 'kariz-admin.json is readable by a service account' }
        }
        $wInst = @()
        foreach ($f in @(Get-Item -LiteralPath $InstallDir) + @(Get-ChildItem -LiteralPath $InstallDir -Recurse -Directory -ErrorAction SilentlyContinue) + @(Get-ChildItem -LiteralPath (Join-Path $InstallDir 'services') -File -ErrorAction SilentlyContinue)) {
            $b = @(Get-WideAces $f.FullName -WriteOnly)
            if ($b.Count) { $wInst += "$($f.FullName): $($b -join '; ')" }
        }
        if ($wInst.Count) { Fail "program folder entries writable by users: $(($wInst | Select-Object -First 10) -join ' | ')" }
        Note 'program folder (with the service wrappers and their XML): not writable by users'
        Assert-Services 'running'
        # the diagnostics bundle holds no secret of kariz.json / kariz-admin.json / the PFX password
        $zip = Join-Path $Out 'diagnostics.zip'
        Invoke-Ctl @('diagnostics', '--out', $zip) | Out-Null
        $dir = Join-Path $Out 'diagnostics'
        if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
        Expand-Archive -LiteralPath $zip -DestinationPath $dir -Force
        $secrets = New-Object System.Collections.ArrayList
        $walk = $null
        $walk = {
            param($o, $path)
            if ($null -eq $o) { return }
            if ($o -is [string]) { if ($path -match '(?i)secret|password|passphrase|token|key' -and $o.Length -ge 8 -and $o -notmatch '^[A-Z]:\\') { [void]$secrets.Add($o) }; return }
            if ($o -is [System.Management.Automation.PSCustomObject]) { foreach ($p in $o.PSObject.Properties) { & $walk $p.Value "$path.$($p.Name)" } }
            elseif ($o -is [System.Collections.IEnumerable]) { foreach ($x in $o) { & $walk $x $path } }
        }
        & $walk (Read-Config) 'kariz'
        $adminFile = Join-Path $DataDir 'kariz-admin.json'
        if (Test-Path $adminFile) { & $walk (Get-Content -LiteralPath $adminFile -Raw | ConvertFrom-Json) 'admin' }
        [void]$secrets.Add($PfxPassword)
        $text = (Get-ChildItem $dir -Recurse -File | ForEach-Object { [IO.File]::ReadAllText($_.FullName) }) -join "`n"
        $leaks = @($secrets | Where-Object { $text.Contains($_) })
        if ($leaks.Count) { Fail "the diagnostics bundle holds $($leaks.Count) secret value(s)" }
        Note "diagnostics bundle: $(@(Get-ChildItem $dir -Recurse -File).Count) files, none of the $($secrets.Count) secret values"
    }

    Invoke-Scenario 9 'Resilience (worker crash, service restarts, PostgreSQL killed)' {
        $before = Get-AppWorkers
        $n = $before.Workers.Count
        if (-not $n) { Fail 'no application worker found' }
        $victim = $before.Workers[0]
        Stop-Process -Id $victim.ProcessId -Force
        $sw = [Diagnostics.Stopwatch]::StartNew()
        do { Start-Sleep -Milliseconds 500; $now = Get-AppWorkers } while ($sw.Elapsed.TotalSeconds -lt 90 -and (@($now.Workers | Where-Object { $_.ProcessId -ne $victim.ProcessId }).Count -lt $n))
        if (@($now.Workers | Where-Object { $_.ProcessId -ne $victim.ProcessId }).Count -lt $n) { Fail "the killed worker did not come back ($n before)" }
        Note ("worker {0} killed: replaced in {1:N1} s ({2} workers)" -f $victim.ProcessId, $sw.Elapsed.TotalSeconds, $n)
        Invoke-Js 'api.mjs' 'api-ready-1' @('--timeout', '60') | Out-Null

        $sw = [Diagnostics.Stopwatch]::StartNew()
        Restart-Service -Name $edition.services.app.name
        Invoke-Js 'api.mjs' 'api-ready-2' @('--timeout', '180') | Out-Null
        Note ("Restart-Service KarizApp: ready again in {0:N1} s" -f $sw.Elapsed.TotalSeconds)

        $sw = [Diagnostics.Stopwatch]::StartNew()
        Restart-Service -Name $edition.services.db.name -Force
        Start-Sleep -Seconds 3
        $app = Get-Service $edition.services.app.name
        if ($app.Status -ne 'Running') {
            Note "Restart-Service KarizDB -Force stopped its dependent KarizApp and Windows did not start it again (state $($app.Status)): the runbook says 'karizctl restart' or start both"
            Start-Service $edition.services.app.name
        }
        Invoke-Js 'api.mjs' 'api-ready-3' @('--timeout', '180') | Out-Null
        Note ("Restart-Service KarizDB: ready again in {0:N1} s" -f $sw.Elapsed.TotalSeconds)

        $wrapper = Get-KarizProcesses | Where-Object { $_.Name -eq "$($edition.services.db.name).exe" } | Select-Object -First 1
        $pm = Get-KarizProcesses | Where-Object { $_.Name -eq 'postgres.exe' -and $wrapper -and $_.ParentProcessId -eq $wrapper.ProcessId } | Select-Object -First 1
        if (-not $pm) { Fail 'the PostgreSQL postmaster was not found' }
        $sw = [Diagnostics.Stopwatch]::StartNew()
        Stop-Process -Id $pm.ProcessId -Force
        Note "postgres.exe (postmaster, pid $($pm.ProcessId)) killed"
        Invoke-Js 'api.mjs' 'api-ready-4' @('--timeout', '300') | Out-Null
        Note ("after PostgreSQL was killed: ready again in {0:N1} s (service recovery restarts KarizDB)" -f $sw.Elapsed.TotalSeconds)
        Assert-Services 'running'
        Invoke-Js 'api.mjs' 'api-verify-resilience' | Out-Null
    }

    Invoke-Scenario 10 "Load ($LoadUsers virtual users, $LoadSeconds s)" {
        $cs = Get-CimInstance Win32_ComputerSystem
        Note ("machine: {0} logical processors, {1:N1} GB memory, {2}" -f $cs.NumberOfLogicalProcessors, ($cs.TotalPhysicalMemory / 1GB), (Get-CimInstance Win32_Processor | Select-Object -First 1).Name)
        # KarizApp and KarizDB for a minute with nobody on the server, then under the load (docs/qa/PERFORMANCE_E2E_FA.md)
        $idle = Start-Sampler 'idle'
        Start-Sleep -Seconds 60
        Stop-Sampler $idle
        $busy = Start-Sampler 'load'
        $load = $null
        try { $load = Invoke-Js 'api.mjs' 'api-load' @('--users', "$LoadUsers", '--seconds', "$LoadSeconds") -AllowFail } finally { Stop-Sampler $busy }
        $res = Invoke-Js 'perf.mjs' 'perf-resources' @('--idle', $idle.Out, '--load', $busy.Out) -AllowFail
        $bad = @()
        foreach ($r in @(@('api-load', $load), @('perf-resources', $res))) {
            if (-not $r[1]) { $bad += "$($r[0]): no result"; continue }
            $bad += @($r[1].checks | Where-Object { -not $_.ok } | ForEach-Object { "$($r[0]): $($_.what) $($_.detail)" })
        }
        if ($bad.Count) { Fail ($bad -join ' | ') }
    }

    Invoke-Scenario 11 'DR drill: restore the backup of scenario 4' {
        if (-not $script:Backup) { Fail 'no backup from scenario 4' }
        $sw = [Diagnostics.Stopwatch]::StartNew()
        Invoke-Ctl @('restore', $script:Backup, '--yes') | Out-Null
        $restore = $sw.Elapsed.TotalSeconds
        $r = Invoke-Js 'api.mjs' 'api-dr'
        $sw.Stop()
        Note ("RTO: karizctl restore {0:N0} s, ready and verified {1:N0} s after the command started" -f $restore, $sw.Elapsed.TotalSeconds)
        Note ("RPO: everything written after the backup of {0:HH:mm:ss} is lost ({1:N0} minutes of work in this run, including the marked incidents, the load test and the demo audit lines)" -f $script:BackupAt, ((Get-Date) - $script:BackupAt).TotalMinutes)
    }

    Invoke-Scenario 12 'The Windows app on the intranet (headless sync client)' -Stretch {
        Invoke-Js 'desktop.mjs' 'desktop' @('--data', (Join-Path $Out 'desktop-data')) | Out-Null
    }

    Invoke-Scenario 13 'Uninstall keeping data, re-install, then uninstall with REMOVEDATA=1' {
        Invoke-Msi @('/x', $Msi11) (Join-Path $Out 'logs\msi-uninstall.log') | Out-Null
        Assert-Services 'absent'
        foreach ($p in @($Config, (Join-Path $DataDir 'db\PG_VERSION'), (Join-Path $DataDir 'backups'), (Join-Path $DataDir 'blobs'))) { if (-not (Test-Path $p)) { Fail "uninstall removed $p" } }
        if (Get-NetFirewallRule -DisplayName $edition.firewallRule -ErrorAction SilentlyContinue) { Fail 'the firewall rule is still there after the uninstall' }
        Note 'uninstalled: services and firewall rule gone, data kept'
        Invoke-Msi @('/i', $Msi11) (Join-Path $Out 'logs\msi-reinstall.log') | Out-Null
        Assert-Services 'running'
        $c = Read-Config
        if ([int]$c.listen.https_port -ne $script:Ports.https -or [string]$c.tls.pfx -ne $script:Ports.pfx) { Fail 're-install did not keep the port or the certificate' }
        if (Test-Path (Join-Path $DataDir 'setup-url.txt')) { Fail 'the re-install issued a new setup address although accounts exist' }
        Invoke-Js 'api.mjs' 'api-verify-reinstall' @('--expect-version', '1.1.0', '--expect-protocol', '15') | Out-Null
        Note 're-installed on the kept data: everything back'
        Copy-ServerLogs
        Invoke-Msi @('/x', $Msi11, 'REMOVEDATA=1') (Join-Path $Out 'logs\msi-uninstall-removedata.log') | Out-Null
        $left = @()
        Assert-Services 'absent'
        if (Get-NetFirewallRule -DisplayName $edition.firewallRule -ErrorAction SilentlyContinue) { $left += "firewall rule $($edition.firewallRule)" }
        if (Get-ScheduledTask -TaskName $edition.services.backupTask.name -ErrorAction SilentlyContinue) { $left += "scheduled task $($edition.services.backupTask.name)" }
        foreach ($p in @($InstallDir, $DataDir, "HKLM:\$($edition.registryKey)", (Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\$($edition.product).url"))) { if (Test-Path $p) { $left += $p } }
        if ([Environment]::GetEnvironmentVariable('ITSM_SERVER_CONFIG', 'Machine')) { $left += 'machine variable ITSM_SERVER_CONFIG' }
        if ((([Environment]::GetEnvironmentVariable('Path', 'Machine')) -split ';') -contains $InstallDir) { $left += 'machine PATH entry' }
        if ($left.Count) { Fail "left behind after REMOVEDATA=1: $($left -join ', ')" }
        $src = [System.Diagnostics.EventLog]::SourceExists($edition.eventSource)
        $tmp = @(Get-ChildItem "$env:SystemRoot\Temp" -Filter 'kariz-uninstall-*.log' -ErrorAction SilentlyContinue)
        Note "after REMOVEDATA=1: no service, firewall rule, scheduled task, program or data folder, registry key, shortcut or variable; kept as documented: the event source $($edition.eventSource) (registered: $src, so past events stay readable) and $($tmp.Count) uninstall log(s) in $env:SystemRoot\Temp"
    }

    Invoke-Scenario 14 'No outbound attempts by the server''s processes (firewall log and connection audit)' {
        $sum = Get-KarizOutbound $script:CutAt $InstallDir $script:Lan (Join-Path $Out 'logs\outbound-audit.json')
        $top = ($sum.by_program.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 8 | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ', '
        Note "audited outbound connection events since the cut: $($sum.audited_outbound) ($top)"
        Note "the server's DNS queries to the machine's DNS server ($(@($sum.dns_servers) -join ', '), the bank's DNS): $($sum.kariz_dns_queries)"
        $fw = "$env:SystemRoot\System32\LogFiles\Firewall\pfirewall.log"
        if (Test-Path $fw) {
            Copy-Item $fw (Join-Path $Out 'logs\pfirewall.log') -Force
            $drops = @(Get-Content $fw | Where-Object { $_ -match ' DROP ' -and $_ -match ' SEND ' })
            $dests = $drops | ForEach-Object { ($_ -split ' ')[5] } | Group-Object | Sort-Object Count -Descending | Select-Object -First 10 | ForEach-Object { "$($_.Name) x$($_.Count)" }
            Note "firewall log: $($drops.Count) outbound packets dropped (all programs; top destinations: $($dests -join ', '))"
        }
        if (@($sum.kariz_outside_bank).Count) { Fail "the server's processes tried to reach outside the bank: $((@($sum.kariz_outside_bank) | Select-Object -First 10 | ForEach-Object { "$($_.app) -> $($_.dest):$($_.port)" }) -join '; ')" }
        if ($sum.audited_outbound -eq 0) { Fail 'the connection audit recorded nothing: the proof would be empty' }
        Note "none of the server's processes (node.exe, postgres.exe, the wrappers) attempted a connection outside loopback and $($script:Lan.Cidr)"
    }
} catch {
    Write-Log "stopped: $($_.Exception.Message)" 'ERROR'
    $script:Aborted = $true
} finally {
    Save-Context
    Copy-ServerLogs
}
# a step of the CI run: its scenarios are recorded; only a critical failure stops the next steps
if ($Only.Count -and -not $Report) { if ($script:Aborted) { exit 1 }; exit 0 }
# the report (the last step, or a run of every scenario at once)
& {
    foreach ($p in $script:Mocks) { try { if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force } } catch { } }
    if ($script:SavedFw) { Restore-BankNetwork $script:SavedFw }
    $failed = @($script:Results | Where-Object { $_.status -eq 'fail' })
    $report = [pscustomobject]@{
        started = $Started.ToString('o'); finished = (Get-Date).ToString('o'); minutes = [math]::Round(((Get-Date) - $Started).TotalMinutes, 1)
        machine = [pscustomobject]@{ os = (Get-CimInstance Win32_OperatingSystem).Caption; cpus = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors; memory_gb = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1); lan = $script:Lan }
        msi = @((Split-Path -Leaf $Msi10), (Split-Path -Leaf $Msi11)); scenarios = @($script:Results); findings = @($script:Findings); failed = $failed.Count
    }
    Write-Utf8 (Join-Path $Out 'report.json') ($report | ConvertTo-Json -Depth 8)
    # (no LAN when the first step stopped before finding it)
    $lanCidr = if ($script:Lan) { $script:Lan.Cidr } else { 'unknown' }
    $md = @("# Bank simulation report", '', "Started $($report.started), $($report.minutes) minutes; $($report.machine.os), $($report.machine.cpus) CPUs, $($report.machine.memory_gb) GB; LAN $lanCidr", '', '| # | Scenario | Result | Seconds |', '|---|---|---|---|')
    foreach ($r in $script:Results) { $md += "| $($r.id) | $($r.title) | $($r.status) | $($r.seconds) |" }
    foreach ($r in $script:Results) {
        $md += ''; $md += "## $($r.id). $($r.title) - $($r.status)"
        if ($r.detail) { $md += ''; $md += "**$($r.detail)**" }
        foreach ($n in $r.notes) { $md += "- $n" }
    }
    if ($script:Findings.Count) { $md += ''; $md += '## Findings'; foreach ($f in $script:Findings) { $md += "- $f" } }
    Write-Utf8 (Join-Path $Out 'report.md') ($md -join "`r`n")
    if ($env:GITHUB_STEP_SUMMARY) { Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Value ($md -join "`n") -Encoding UTF8 }
    # the server's speed per page and persona, the load per endpoint, KarizApp and KarizDB (perf\server-perf.md, the summary)
    try { Invoke-Js 'perf.mjs' 'perf-report' @('--dir', $Out) -AllowFail | Out-Null } catch { Write-Log "performance report: $($_.Exception.Message)" 'WARN' }
    Write-Log ("{0} scenario(s), {1} failed" -f $script:Results.Count, $failed.Count)
}
if (@($script:Results | Where-Object { $_.status -eq 'fail' }).Count -or $script:Results.Count -lt 14) { exit 1 }
exit 0
