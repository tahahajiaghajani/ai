# Removes the server edition's services, firewall rule and shortcuts (run by the MSI before it removes the files).
#   -Upgrade      the old version's side of an upgrade: a pg_dump safety backup first (a failure cancels the upgrade),
#                 then the services are stopped and removed; data, configuration and environment stay.
#   -RemoveData 1 also delete the data folder (database, attachments, backups inside it, logs). Default: kept.
# Rollback of an upgrade: install the previous MSI again (data is kept), then restore the safety backup:
#   karizctl restore <data>\backups\itsm-pre-upgrade-<time> --yes
param(
    [string]$InstallDir = '',
    [string]$RemoveData = '0',
    [switch]$Upgrade
)
. (Join-Path $PSScriptRoot 'common.ps1')

$edition = Read-Edition (Join-Path $PSScriptRoot '..')
if (-not $InstallDir) { $InstallDir = Join-Path $PSScriptRoot '..' }
$InstallDir = $InstallDir.Trim().Trim('"').TrimEnd('.').TrimEnd('\')
$reg = "HKLM:\$($edition.registryKey)"
$DataDir = $edition.dataDir
$saved = Get-ItemProperty -Path $reg -ErrorAction SilentlyContinue
if ($saved -and $saved.PSObject.Properties['DataDir'] -and $saved.DataDir) { $DataDir = $saved.DataDir }
$logDir = if (Test-Path $DataDir) { Join-Path $DataDir 'logs' } else { $env:TEMP }
Set-LogFile (Join-Path $logDir ("uninstall-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss')))
$config = Join-Path $DataDir $edition.configFile
$node = Join-Path $InstallDir 'node\node.exe'
$ctlJs = Join-Path $InstallDir 'app\karizctl.cjs'
$dbSvc = $edition.services.db.name
$appSvc = $edition.services.app.name

function Stop-Svc([string]$Name) {
    $s = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if ($s -and $s.Status -ne 'Stopped') {
        Write-Log "stopping $Name"
        Stop-Service -Name $Name -Force -ErrorAction SilentlyContinue
        try { $s.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(180)) } catch { Write-Warn "$Name did not stop in time" }
    }
}

function Remove-Svc([string]$Name) {
    if (-not (Get-Service -Name $Name -ErrorAction SilentlyContinue)) { return }
    Stop-Svc $Name
    $exe = Join-Path $InstallDir "services\$Name.exe"
    if (Test-Path $exe) { Invoke-Native -File $exe -Arguments @('uninstall') -OkCodes @(0, 1) | Out-Null }
    if (Get-Service -Name $Name -ErrorAction SilentlyContinue) { Invoke-Native -File 'sc.exe' -Arguments @('delete', $Name) -OkCodes @(0, 1072, 1060) | Out-Null }
    Write-Log "service $Name removed"
}

try {
    Write-Step ("{0}: {1} ({2})" -f $edition.product, $(if ($Upgrade) { 'upgrade — removing the old version' } else { 'uninstall' }), $InstallDir)
    if ($Upgrade -and (Test-Path $config) -and (Test-Path $node)) {
        Write-Step 'safety backup before the upgrade (pg_dump -Fc + attachment files)'
        Stop-Svc $appSvc
        $db = Get-Service -Name $dbSvc -ErrorAction SilentlyContinue
        if ($db -and $db.Status -ne 'Running') { Start-Service $dbSvc; $db.WaitForStatus('Running', [TimeSpan]::FromSeconds(180)) }
        try {
            $env:ITSM_SERVER_CONFIG = $config
            $env:ITSM_INSTALL_DIR = $InstallDir
            $out = Invoke-Native -File $node -Arguments @($ctlJs, 'backup', '--label', 'pre-upgrade', '--config', $config)
            Write-Log "safety backup: $(($out | Select-Object -Last 1))"
        } catch {
            Write-Log 'the safety backup failed: the upgrade is cancelled and the current version keeps running' 'ERROR'
            Start-Service $appSvc -ErrorAction SilentlyContinue
            exit 1
        }
    }
    Remove-Svc $appSvc
    Remove-Svc $dbSvc
    if (-not $Upgrade) {
        Get-NetFirewallRule -DisplayName $edition.firewallRule -ErrorAction SilentlyContinue | Remove-NetFirewallRule
        $shortcut = Join-Path $env:ProgramData ("Microsoft\Windows\Start Menu\Programs\{0}.url" -f $edition.product)
        if (Test-Path $shortcut) { Remove-Item $shortcut -Force }
        Unregister-ScheduledTask -TaskName $edition.services.backupTask.name -Confirm:$false -ErrorAction SilentlyContinue
        $path = [Environment]::GetEnvironmentVariable('Path', 'Machine')
        [Environment]::SetEnvironmentVariable('Path', ((($path -split ';') | Where-Object { $_ -and $_.TrimEnd('\') -ne $InstallDir }) -join ';'), 'Machine')
        [Environment]::SetEnvironmentVariable('ITSM_SERVER_CONFIG', $null, 'Machine')
        if (Test-Path (Join-Path $InstallDir 'services')) { Remove-Item -Recurse -Force (Join-Path $InstallDir 'services') -ErrorAction SilentlyContinue }
        if ($RemoveData -eq '1') {
            Write-Step "removing the data folder $DataDir"
            Set-LogFile (Join-Path $env:TEMP ("kariz-uninstall-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss')))
            Remove-Item -Recurse -Force $DataDir -ErrorAction Stop
            Remove-Item -Path $reg -Recurse -Force -ErrorAction SilentlyContinue
            Write-Log "data removed"
        } else {
            Write-Log "data kept in $DataDir (database, attachments, backups, configuration). To remove it: msiexec /x … REMOVEDATA=1, or delete the folder."
        }
    }
    exit 0
} catch {
    Write-Log "UNINSTALL STEP FAILED: $($_.Exception.Message)" 'ERROR'
    exit 1
}
