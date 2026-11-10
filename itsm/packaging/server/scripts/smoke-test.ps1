# CI (windows-latest): the air-gapped smoke test of the MSI. Outbound traffic is blocked with Windows Firewall (only
# the CI runner's own processes and DNS stay allowed), then: silent install → /api/ready → first-run setup through its
# API → sign-in → an incident created and opened → air-gap refusal → backup → the same MSI again (idempotent
# re-install) → a second build of the same version (a real major upgrade with its pre-upgrade backup) → uninstall
# keeping the data. Every step is logged; on failure the MSI and server logs are printed and kept for the artifact.
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
        Get-Content $Log -Encoding Unicode -ErrorAction SilentlyContinue | Select-String -Pattern 'WixQuietExec|Return value 3|error|ERROR|STEP|WARN' | Select-Object -Last 120 | ForEach-Object { Write-Log "   $_" }
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
    Write-Step 'ports and host name'
    $https = 443; $http = 80
    if (-not (Test-PortFree 443)) { $https = 8443; Write-Warn 'port 443 is busy on this runner: using 8443' }
    if (-not (Test-PortFree 80)) { $http = 8080; Write-Warn 'port 80 is busy on this runner: using 8080' }
    $script:base = if ($https -eq 443) { "https://$HostName" } else { "https://$($HostName):$https" }
    Add-Content -Path "$env:SystemRoot\System32\drivers\etc\hosts" -Value "`r`n127.0.0.1 $HostName" -Encoding ASCII
    Write-Log "$HostName → 127.0.0.1"

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

    Write-Step "install $([IO.Path]::GetFileName($Msi)) (silent)"
    Invoke-Msi @('/i', $Msi, "HOSTNAME=$HostName", "PORT=$https", "HTTPPORT=$http", "DATADIR=$DataDir") (Join-Path $Logs 'msi-install.log')
    Assert-Services 'running'
    Invoke-Native -File $node -Arguments @($ctl, 'status', '--config', $config) | Out-Null

    Write-Step 'smoke: setup, sign-in, incident, air gap'
    Invoke-Smoke 'first'

    Write-Step 'backup now'
    Invoke-Native -File $node -Arguments @($ctl, 'backup', '--config', $config) | Out-Null
    if (-not (Get-ChildItem (Join-Path $DataDir 'backups') -Directory -Filter 'itsm-manual-*')) { Fail 'no backup folder was written' }

    Write-Step 'the same MSI again (idempotent re-install)'
    Invoke-Msi @('/i', $Msi, "HOSTNAME=$HostName", "PORT=$https", "HTTPPORT=$http") (Join-Path $Logs 'msi-reinstall.log')
    Assert-Services 'running'
    Invoke-Smoke 'after-upgrade'

    Write-Step "upgrade with $([IO.Path]::GetFileName($UpgradeMsi)) (major upgrade)"
    Invoke-Msi @('/i', $UpgradeMsi, "HOSTNAME=$HostName", "PORT=$https", "HTTPPORT=$http") (Join-Path $Logs 'msi-upgrade.log')
    Assert-Services 'running'
    if (-not (Get-ChildItem (Join-Path $DataDir 'backups') -Directory -Filter 'itsm-pre-upgrade-*')) { Fail 'the upgrade took no safety backup' }
    Invoke-Smoke 'after-upgrade'
    Invoke-Native -File $node -Arguments @($ctl, 'diagnostics', '--out', (Join-Path $Logs 'diagnostics.zip'), '--config', $config) | Out-Null

    Write-Step 'uninstall (data kept)'
    Invoke-Msi @('/x', $UpgradeMsi) (Join-Path $Logs 'msi-uninstall.log')
    Assert-Services 'absent'
    foreach ($p in @($config, (Join-Path $DataDir 'db\PG_VERSION'), (Join-Path $DataDir 'backups'))) { if (-not (Test-Path $p)) { Fail "uninstall removed $p" } }
    if (Get-NetFirewallRule -DisplayName $edition.firewallRule -ErrorAction SilentlyContinue) { Fail 'the firewall rule is still there' }
    Write-Step 'smoke test passed'
} finally {
    foreach ($p in $savedProfiles) { Set-NetFirewallProfile -Name $p.Name -Enabled $p.Enabled -DefaultOutboundAction $p.DefaultOutboundAction -ErrorAction SilentlyContinue }
    Get-NetFirewallRule -DisplayName 'ci-allow-runner', 'ci-allow-dns', 'ci-allow-platform' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    Write-Log 'outbound traffic restored'
}
