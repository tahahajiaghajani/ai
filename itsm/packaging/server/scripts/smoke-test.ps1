# CI (windows-latest): the air-gapped smoke test of the MSI. Outbound traffic is blocked with Windows Firewall (only
# the CI runner's own processes and DNS stay allowed) and ports 443 and 80 are held by dummy listeners (a laptop with
# IIS, Skype or VMware), then: silent install with default ports (the installer moves to free ones; the address comes
# from setup-url.txt) -> /api/ready -> first-run setup through its API -> sign-in -> an incident created and opened ->
# air-gap refusal -> backup -> the same MSI again with the setup dialog's properties (PORT=auto keeps HTTPS,
# HTTPPORT=0 turns HTTP off) -> a second build of the same version (a real major upgrade with its pre-upgrade backup,
# ports kept) -> uninstall keeping the data -> a given busy port (PORT=443) that must fail with its reason in
# install-error.txt, the event log and the MSI log. Every step is logged; on failure the MSI and server logs are
# printed and kept for the artifact.
param(
    [Parameter(Mandatory)][string]$Msi,
    [Parameter(Mandatory)][string]$UpgradeMsi,
    [string]$HostName = 'kariz.ci.local',
    [string]$DataDir = 'C:\KarizData',
    [string]$Logs = (Join-Path $env:RUNNER_TEMP 'kariz-logs')
)
. (Join-Path $PSScriptRoot 'common.ps1')

New-Item -ItemType Directory -Force -Path $Logs | Out-Null
Set-LogFile (Join-Path $Logs 'smoke-test.log')
$Msi = (Resolve-Path $Msi).Path
$UpgradeMsi = (Resolve-Path $UpgradeMsi).Path
$edition = Read-Edition (Join-Path $PSScriptRoot '..')
$installDir = $edition.installDir
$node = Join-Path $installDir 'node\node.exe'
$ctl = Join-Path $installDir 'app\karizctl.cjs'
$config = Join-Path $DataDir $edition.configFile
$smoke = Join-Path $PSScriptRoot 'smoke.mjs'
$state = Join-Path $Logs 'smoke-state.json'
$savedProfiles = Get-NetFirewallProfile | Select-Object Name, Enabled, DefaultOutboundAction

function Show-Logs {
    Write-Log '----- server logs (last lines) -----'
    foreach ($f in @((Join-Path $DataDir 'logs\kariz-app.log')) + @(Get-ChildItem (Join-Path $DataDir 'logs') -Filter 'install-*.log' -ErrorAction SilentlyContinue | ForEach-Object FullName) + @(Get-ChildItem (Join-Path $DataDir 'logs\service') -ErrorAction SilentlyContinue | ForEach-Object FullName)) {
        if ($f -and (Test-Path $f)) {
            Write-Log "== $f"
            Get-Content $f -Tail 60 | ForEach-Object { Write-Log "   $_" }
            Copy-Item $f $Logs -ErrorAction SilentlyContinue
        }
    }
    $pglog = Join-Path $DataDir 'db\log'
    if (Test-Path $pglog) { Get-ChildItem $pglog | ForEach-Object { Write-Log "== $($_.FullName)"; Get-Content $_.FullName -Tail 40 | ForEach-Object { Write-Log "   $_" } } }
}

# Dummy listeners holding ports the way IIS, Skype or VMware do on a laptop (released in the finally block).
$script:squatters = @()
function Start-Squatter([int]$Port) {
    try {
        $l = New-Object System.Net.Sockets.TcpListener ([System.Net.IPAddress]::Any, $Port)
        $l.Start()
        $script:squatters += $l
        Write-Log "port $Port held by a dummy listener (pid $PID)"
    } catch {
        Write-Log "port $Port is already held by another program on this runner: $($_.Exception.Message)"
    }
}

function Stop-Squatters {
    foreach ($l in $script:squatters) { try { $l.Stop() } catch { } }
    $script:squatters = @()
}

# The MSI log (UTF-16 or ANSI, as msiexec wrote it) as text.
function Read-MsiLog([string]$Path) {
    $bytes = [IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -ge 2 -and (($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) -or $bytes[1] -eq 0)) { return [Text.Encoding]::Unicode.GetString($bytes) }
    return [Text.Encoding]::UTF8.GetString($bytes)
}

# The server's address as the installer wrote it into setup-url.txt (scheme, host and the port it chose).
function Get-SetupBase {
    $f = Join-Path $DataDir 'setup-url.txt'
    if (-not (Test-Path -LiteralPath $f)) { Show-Logs; Fail "no setup-url.txt in $DataDir" }
    $u = [Uri]((Get-Content -LiteralPath $f -Raw).Trim())
    $b = $u.GetLeftPart([UriPartial]::Authority)
    Write-Log "address from setup-url.txt: $b"
    return $b
}

# The install's output reaches the MSI log (no certificate password: WixQuietExec), never a setup token.
function Assert-MsiLog([string]$Log, [string]$Want) {
    $text = Read-MsiLog $Log
    if ($text -notmatch [regex]::Escape($Want)) { Fail "the MSI log $Log does not hold the install's output ($Want)" }
    if ($text -match 'token=[^*&\s"]') { Fail "the MSI log $Log holds a setup token" }
    Write-Log "MSI log holds the install's output ($Want) and no setup token"
}

# A silent install that must fail (exit code 1603), leaving nothing installed.
function Invoke-MsiExpectFailure([string[]]$Arguments, [string]$Log) {
    $all = ($Arguments + @('/qn', '/norestart', '/l*v', $Log))
    Write-Log "msiexec $($all -join ' ') (must fail)"
    $p = Start-Process -FilePath 'msiexec.exe' -ArgumentList $all -Wait -PassThru
    Write-Log "msiexec exit code $($p.ExitCode)"
    if ($p.ExitCode -eq 0 -or $p.ExitCode -eq 3010) { Fail 'the install succeeded although it had to fail' }
}

function Invoke-Msi([string[]]$Arguments, [string]$Log) {
    # Start-Process joins arguments without quoting them: quote paths and KEY=values that contain spaces
    $all = ($Arguments + @('/qn', '/norestart', '/l*v', $Log)) | ForEach-Object {
        if ($_ -match '\s' -and $_ -notmatch '"') { if ($_ -match '^([A-Z]+)=(.*)$') { "$($Matches[1])=`"$($Matches[2])`"" } else { "`"$_`"" } } else { $_ }
    }
    Write-Log "msiexec $($all -join ' ')"
    $p = Start-Process -FilePath 'msiexec.exe' -ArgumentList $all -Wait -PassThru
    Write-Log "msiexec exit code $($p.ExitCode)"
    if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) {
        Write-Log "----- $Log (errors and custom action output) -----"
        Get-Content $Log -Encoding Unicode -ErrorAction SilentlyContinue | Select-String -Pattern 'WixSilentExec|WixQuietExec|Return value 3|error|ERROR|STEP|WARN' | Select-Object -Last 120 | ForEach-Object { Write-Log "   $_" }
        Show-Logs
        Fail "msiexec failed with exit code $($p.ExitCode)"
    }
}

function Invoke-Smoke([string]$Phase) {
    $ca = Join-Path $DataDir 'tls\self-signed.crt'
    $a = @($smoke, '--phase', $Phase, '--base', $script:base, '--ca', $ca, '--state', $state)
    if ($Phase -eq 'first') { $a += @('--setup-file', (Join-Path $DataDir 'setup-url.txt')) }
    try { Invoke-Native -File $node -Arguments $a | Out-Null } catch { Show-Logs; throw }
}

function Assert-Services([string]$Want) {
    foreach ($s in @($edition.services.db.name, $edition.services.app.name)) {
        $svc = Get-Service -Name $s -ErrorAction SilentlyContinue
        if ($Want -eq 'absent') {
            if ($svc) { Fail "service $s still exists" }
        } else {
            if (-not $svc -or $svc.Status -ne 'Running') { Show-Logs; Fail "service $s is not running" }
            $acct = (Get-CimInstance Win32_Service -Filter "Name='$s'").StartName
            if ($acct -ne "NT SERVICE\$s") { Fail "service $s runs as $acct, expected the virtual account NT SERVICE\$s" }
            Write-Log "service $s running as $acct"
        }
    }
}

try {
    Write-Step 'ports held like on a laptop (IIS, Skype, VMware) and host name'
    Start-Squatter 443
    Start-Squatter 80
    Add-Content -Path "$env:SystemRoot\System32\drivers\etc\hosts" -Value "`r`n127.0.0.1 $HostName" -Encoding ASCII
    Write-Log "$HostName -> 127.0.0.1"

    Write-Step 'block all outbound traffic (Windows Firewall), except the CI runner and DNS'
    $runner = Get-Process | Where-Object { $_.ProcessName -match '^Runner\.(Listener|Worker)$' -and $_.Path } | ForEach-Object { Split-Path -Parent (Split-Path -Parent $_.Path) } | Sort-Object -Unique
    foreach ($root in $runner) {
        Get-ChildItem $root -Recurse -Filter '*.exe' -ErrorAction SilentlyContinue | ForEach-Object {
            New-NetFirewallRule -DisplayName 'ci-allow-runner' -Direction Outbound -Program $_.FullName -Action Allow | Out-Null
        }
        Write-Log "runner kept online: $root"
    }
    New-NetFirewallRule -DisplayName 'ci-allow-dns' -Direction Outbound -Protocol UDP -RemotePort 53 -Action Allow | Out-Null
    # the cloud VM's own platform endpoints (Azure wire server and instance metadata), not the Internet
    New-NetFirewallRule -DisplayName 'ci-allow-platform' -Direction Outbound -RemoteAddress 168.63.129.16, 169.254.169.254 -Action Allow | Out-Null
    Set-NetFirewallProfile -All -Enabled True -DefaultOutboundAction Block
    $leaked = $true
    try { Invoke-WebRequest -Uri 'https://www.microsoft.com/' -TimeoutSec 15 -UseBasicParsing | Out-Null } catch { $leaked = $false; Write-Log "outbound blocked as expected: $($_.Exception.Message)" }
    if ($leaked) { Fail 'outbound traffic still reaches the Internet: the air-gap test would prove nothing' }

    Write-Step "install $([IO.Path]::GetFileName($Msi)) (silent, default ports while 443 and 80 are held)"
    Invoke-Msi @('/i', $Msi, "HOSTNAME=$HostName", "DATADIR=$DataDir") (Join-Path $Logs 'msi-install.log')
    Assert-Services 'running'
    $script:base = Get-SetupBase
    $chosen = Get-Content -LiteralPath $config -Raw -Encoding UTF8 | ConvertFrom-Json
    $https = [int]$chosen.listen.https_port
    $http = [int]$chosen.listen.http_port
    Write-Log "the installer chose HTTPS $https, HTTP $http, PostgreSQL $($chosen.db.port)"
    if ($https -eq 443 -or $http -eq 80) { Fail "443 / 80 are held, yet the server was given HTTPS $https / HTTP $http" }
    if (([Uri]$script:base).Port -ne $https) { Fail "setup-url.txt ($script:base) does not carry the HTTPS port $https" }
    $fw = @(Get-NetFirewallRule -DisplayName $edition.firewallRule | Get-NetFirewallPortFilter | ForEach-Object { $_.LocalPort })
    if (-not ($fw -contains "$https") -or -not ($fw -contains "$http")) { Fail "the firewall rule allows $($fw -join ', '), not HTTPS $https and HTTP $http" }
    Assert-MsiLog (Join-Path $Logs 'msi-install.log') "ports: HTTPS $https"
    Invoke-Native -File $node -Arguments @($ctl, 'status', '--config', $config) | Out-Null

    Write-Step 'smoke: setup, sign-in, incident, air gap'
    Invoke-Smoke 'first'

    Write-Step 'backup now'
    Invoke-Native -File $node -Arguments @($ctl, 'backup', '--config', $config) | Out-Null
    if (-not (Get-ChildItem (Join-Path $DataDir 'backups') -Directory -Filter 'itsm-manual-*')) { Fail 'no backup folder was written' }

    Write-Step 'the same MSI again with the setup dialog properties (idempotent re-install: PORT=auto keeps HTTPS, HTTPPORT=0 turns HTTP off)'
    Invoke-Msi @('/i', $Msi, "HOSTNAME=$HostName", 'PORT=auto', 'HTTPPORT=0', "DATADIR=$DataDir") (Join-Path $Logs 'msi-reinstall.log')
    Assert-Services 'running'
    $after = Get-Content -LiteralPath $config -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([int]$after.listen.https_port -ne $https) { Fail "PORT=auto moved HTTPS from $https to $($after.listen.https_port)" }
    if ([int]$after.listen.http_port -ne 0) { Fail "HTTPPORT=0 left HTTP on port $($after.listen.http_port)" }
    $fw = @(Get-NetFirewallRule -DisplayName $edition.firewallRule | Get-NetFirewallPortFilter | ForEach-Object { $_.LocalPort })
    if ($fw -contains "$http") { Fail "HTTP is off, yet the firewall rule still allows $http" }
    Invoke-Smoke 'after-upgrade'

    Write-Step "upgrade with $([IO.Path]::GetFileName($UpgradeMsi)) (major upgrade)"
    Invoke-Msi @('/i', $UpgradeMsi) (Join-Path $Logs 'msi-upgrade.log')
    Assert-Services 'running'
    $kept = Get-Content -LiteralPath $config -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([int]$kept.listen.https_port -ne $https -or [int]$kept.listen.http_port -ne 0) { Fail "the upgrade did not keep the ports (HTTPS $($kept.listen.https_port), HTTP $($kept.listen.http_port))" }
    if (-not (Get-ChildItem (Join-Path $DataDir 'backups') -Directory -Filter 'itsm-pre-upgrade-*')) { Fail 'the upgrade took no safety backup' }
    Invoke-Smoke 'after-upgrade'
    Invoke-Native -File $node -Arguments @($ctl, 'diagnostics', '--out', (Join-Path $Logs 'diagnostics.zip'), '--config', $config) | Out-Null

    Write-Step 'uninstall (data kept)'
    Invoke-Msi @('/x', $UpgradeMsi) (Join-Path $Logs 'msi-uninstall.log')
    Assert-Services 'absent'
    foreach ($p in @($config, (Join-Path $DataDir 'db\PG_VERSION'), (Join-Path $DataDir 'backups'))) { if (-not (Test-Path $p)) { Fail "uninstall removed $p" } }
    if (Get-NetFirewallRule -DisplayName $edition.firewallRule -ErrorAction SilentlyContinue) { Fail 'the firewall rule is still there' }

    Write-Step 'a given port that is busy (PORT=443) stops the install, with its reason in install-error.txt'
    $busyData = 'C:\KarizBusyPort'
    $busyLog = Join-Path $Logs 'msi-busy-port.log'
    Invoke-MsiExpectFailure @('/i', $Msi, "HOSTNAME=$HostName", 'PORT=443', "DATADIR=$busyData") $busyLog
    $errFile = Join-Path $busyData 'logs\install-error.txt'
    if (-not (Test-Path -LiteralPath $errFile)) { Fail "no install-error.txt after the failed install ($errFile)" }
    $reason = Get-Content -LiteralPath $errFile -Raw -Encoding UTF8
    Write-Log "install-error.txt: $reason"
    Copy-Item $errFile $Logs -ErrorAction SilentlyContinue
    if ($reason -notmatch 'port 443 \(PORT=443\) is already in use') { Fail 'install-error.txt does not give the busy port as the reason' }
    $ev = Get-WinEvent -FilterHashtable @{ LogName = 'Application'; ProviderName = $edition.eventSource; Id = 1001 } -MaxEvents 1 -ErrorAction SilentlyContinue
    $evText = if ($ev) { "$($ev.Message) $(@($ev.Properties | ForEach-Object { $_.Value }) -join ' ')" } else { '' }
    if ($evText -notmatch 'port 443') { Fail "the reason is not in the Application event log (source $($edition.eventSource))" }
    Write-Log 'the reason is in the Application event log too'
    Assert-MsiLog $busyLog 'PORT=443) is already in use'
    Assert-Services 'absent'
    Write-Step 'smoke test passed'
} finally {
    Stop-Squatters
    foreach ($p in $savedProfiles) { Set-NetFirewallProfile -Name $p.Name -Enabled $p.Enabled -DefaultOutboundAction $p.DefaultOutboundAction -ErrorAction SilentlyContinue }
    Get-NetFirewallRule -DisplayName 'ci-allow-runner', 'ci-allow-dns', 'ci-allow-platform' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    Write-Log 'outbound traffic restored'
}
