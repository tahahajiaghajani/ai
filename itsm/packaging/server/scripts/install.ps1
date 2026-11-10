# Installs or upgrades the server edition on this machine. Run by the MSI (elevated, as SYSTEM) after the files are in
# place; safe to run again by hand from an elevated prompt (it is idempotent):
#   powershell -ExecutionPolicy Bypass -File "C:\Program Files\Kariz\scripts\install.ps1" -HostName kariz.bank.local
# Steps: prerequisites → configuration (kariz.json: generated secrets and database passwords, kept on upgrade) →
# certificate → services (WinSW, virtual accounts, recovery, dependency) → folder permissions → PostgreSQL cluster
# (initdb, tuned postgresql.conf, loopback-only pg_hba) → role, database, extensions → migrations → firewall →
# start → readiness → one-time setup URL. A log is kept in <data>\logs\install-<time>.log.
param(
    [string]$InstallDir = '',
    [string]$DataDir = '',
    [string]$HostName = '',
    [string]$HttpsPort = '443',
    [string]$HttpPort = '80',
    [string]$CertPath = '',
    [string]$CertPassword = '',
    [string]$AirGapped = '1',
    [string]$Workers = '0',
    [switch]$RegisterBackupTask
)
. (Join-Path $PSScriptRoot 'common.ps1')

function Clean-Path([string]$p) {
    $p = $p.Trim().Trim('"')
    while ($p.EndsWith('.') -or ($p.EndsWith('\') -and $p.Length -gt 3)) { $p = $p.Substring(0, $p.Length - 1) }
    return $p
}

$edition = Read-Edition (Join-Path $PSScriptRoot '..')
if (-not $InstallDir) { $InstallDir = Join-Path $PSScriptRoot '..' }
$InstallDir = (Resolve-Path (Clean-Path $InstallDir)).Path
if (-not $DataDir) { $DataDir = $edition.dataDir }
$DataDir = Clean-Path $DataDir
New-Item -ItemType Directory -Force -Path (Join-Path $DataDir 'logs') | Out-Null
Set-LogFile (Join-Path $DataDir ("logs\install-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss')))

$node = Join-Path $InstallDir 'node\node.exe'
$ctlJs = Join-Path $InstallDir 'app\karizctl.cjs'
$config = Join-Path $DataDir $edition.configFile
$dbSvc = $edition.services.db.name
$appSvc = $edition.services.app.name
$svcDir = Join-Path $InstallDir 'services'
$version = (Get-Content -LiteralPath (Join-Path $InstallDir 'VERSION') -Raw).Trim()
$created = @()
$upgrade = $false

function Invoke-Ctl([string[]]$Arguments, [string[]]$Mask = @()) {
    $env:ITSM_SERVER_CONFIG = $config
    $env:ITSM_INSTALL_DIR = $InstallDir
    return Invoke-Native -File $node -Arguments (@($ctlJs) + $Arguments + @('--config', $config)) -Mask $Mask
}

function Get-Svc([string]$Name) { return Get-Service -Name $Name -ErrorAction SilentlyContinue }

function Stop-Svc([string]$Name) {
    $s = Get-Svc $Name
    if ($s -and $s.Status -ne 'Stopped') {
        Write-Log "stopping $Name"
        Stop-Service -Name $Name -Force -ErrorAction SilentlyContinue
        $s.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(180))
    }
}

function Start-Svc([string]$Name) {
    $s = Get-Svc $Name
    if ($s.Status -ne 'Running') {
        Write-Log "starting $Name"
        Start-Service -Name $Name
        $s.WaitForStatus('Running', [TimeSpan]::FromSeconds(180))
    }
}

# A WinSW service from its template: the wrapper is a copy of WinSW-x64.exe named after the service.
function Register-Svc([string]$Name, [string]$Template, [hashtable]$Values) {
    New-Item -ItemType Directory -Force -Path $svcDir | Out-Null
    $xml = Get-Content -LiteralPath (Join-Path $InstallDir "winsw\$Template") -Raw -Encoding UTF8
    foreach ($k in $Values.Keys) { $xml = $xml.Replace("{{$k}}", [System.Security.SecurityElement]::Escape([string]$Values[$k])) }
    if ($xml -match '\{\{[A-Z_]+\}\}') { Fail "unfilled placeholder in $Template`: $($Matches[0])" }
    $exe = Join-Path $svcDir "$Name.exe"
    Copy-Item (Join-Path $InstallDir 'winsw\WinSW-x64.exe') $exe -Force
    Write-Utf8 (Join-Path $svcDir "$Name.xml") $xml
    if (Get-Svc $Name) {
        Write-Log "service $Name exists: re-registering"
        Stop-Svc $Name
        Invoke-Native -File $exe -Arguments @('uninstall') -OkCodes @(0, 1) | Out-Null
        Start-Sleep -Seconds 2
    }
    Invoke-Native -File $exe -Arguments @('install') | Out-Null
    # least privilege: a virtual account per service (no password, no interactive logon)
    Invoke-Native -File 'sc.exe' -Arguments @('config', $Name, 'obj=', "NT SERVICE\$Name", 'start=', 'auto') | Out-Null
    Invoke-Native -File 'sc.exe' -Arguments @('failure', $Name, 'reset=', '3600', 'actions=', 'restart/10000/restart/30000/restart/60000') | Out-Null
    Invoke-Native -File 'sc.exe' -Arguments @('failureflag', $Name, '1') | Out-Null
    $script:created += $Name
}

function Grant-Acl([string]$Path, [string[]]$Grants, [switch]$Reset) {
    if (-not (Test-Path $Path)) { New-Item -ItemType Directory -Force -Path $Path | Out-Null }
    if ($Reset) {
        # only administrators, SYSTEM and the named service accounts: inheritance from C:\ProgramData removed
        Invoke-Native -File 'icacls.exe' -Arguments @($Path, '/inheritance:r', '/grant:r', '*S-1-5-32-544:(OI)(CI)F', '/grant:r', '*S-1-5-18:(OI)(CI)F', '/Q') -Quiet | Out-Null
    }
    # inheritable grants on the folder itself (files created later inherit them; no /T: explicit ACEs on every child
    # would survive a later /inheritance:r of a sub-folder such as db)
    foreach ($g in $Grants) { Invoke-Native -File 'icacls.exe' -Arguments @($Path, '/grant', $g, '/Q') -Quiet | Out-Null }
}

try {
    Write-Step "$($edition.product) $version — $InstallDir → $DataDir"

    # ----- prerequisites -------------------------------------------------------------------------------------------
    Write-Step 'prerequisites'
    $os = Get-CimInstance Win32_OperatingSystem
    $build = [int]$os.BuildNumber
    Write-Log "Windows: $($os.Caption) build $build, $([math]::Round($os.TotalVisibleMemorySize / 1MB, 1)) GB memory, $((Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors) logical processors"
    if ($build -lt 17763) { Fail "Windows Server 2019 (build 17763) or later is required; this is build $build" }
    if ($os.TotalVisibleMemorySize -lt 7.5MB) { Write-Warn 'less than 8 GB of memory: fine for a lab, too small for a bank (16 GB or more recommended)' }
    $drive = (Split-Path -Qualifier $DataDir)
    $free = (Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$drive'").FreeSpace
    if ($free -lt 2GB) { Fail "less than 2 GB free on $drive" }
    if ($free -lt 20GB) { Write-Warn ("only {0:N1} GB free on {1}: plan for the database, attachments and backups" -f ($free / 1GB), $drive) }
    $upgrade = (Test-Path -LiteralPath $config)
    foreach ($p in @([int]$HttpsPort, [int]$HttpPort)) {
        if ($p -le 0) { continue }
        $owner = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($owner) {
            $proc = Get-Process -Id $owner.OwningProcess -ErrorAction SilentlyContinue
            $mine = $proc -and ($proc.Path -like "$InstallDir*")
            if (-not $mine) { Fail "port $p is already used by $($proc.ProcessName) (pid $($owner.OwningProcess)); choose another with PORT=/HTTPPORT= or stop that program" }
        }
    }
    if ($upgrade) { Write-Log "existing installation found ($config): upgrade, data and secrets kept" }
    $pgOwner = Get-NetTCPConnection -State Listen -LocalPort $edition.database.port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($pgOwner) {
        $pgProc = Get-Process -Id $pgOwner.OwningProcess -ErrorAction SilentlyContinue
        if (-not ($pgProc -and $pgProc.Path -like "$InstallDir*")) { Fail "port $($edition.database.port) (PostgreSQL) is used by $($pgProc.ProcessName) (pid $($pgOwner.OwningProcess)): stop that database server first" }
    }

    # ----- stop what runs (re-install, upgrade) ----------------------------------------------------------------------
    Stop-Svc $appSvc

    # ----- configuration ---------------------------------------------------------------------------------------------
    Write-Step 'configuration'
    $initArgs = @('init', '--data-dir', $DataDir, '--install-dir', $InstallDir, '--https-port', $HttpsPort, '--http-port', $HttpPort, '--pg-port', "$($edition.database.port)")
    if ($HostName) {
        $url = if ([int]$HttpsPort -eq 443) { "https://$HostName" } else { "https://$($HostName):$HttpsPort" }
        $initArgs += @('--public-url', $url)
    } elseif (-not $upgrade) {
        $fqdn = $null
        try { $fqdn = [System.Net.Dns]::GetHostEntry($env:COMPUTERNAME).HostName } catch { }
        if (-not $fqdn) { $fqdn = $env:COMPUTERNAME }
        $url = if ([int]$HttpsPort -eq 443) { "https://$($fqdn.ToLowerInvariant())" } else { "https://$($fqdn.ToLowerInvariant()):$HttpsPort" }
        $initArgs += @('--public-url', $url)
        Write-Log "HOSTNAME not given: using $url (change it in the first-run setup)"
    }
    if ($AirGapped -eq '0') { $initArgs += @('--air-gapped', 'false') } elseif (-not $upgrade) { $initArgs += @('--air-gapped', 'true') }
    if ([int]$Workers -gt 0) { $initArgs += @('--workers', $Workers) }
    Invoke-Ctl $initArgs | Out-Null

    if ($CertPath) {
        Write-Step 'certificate'
        if (-not (Test-Path -LiteralPath $CertPath)) { Fail "certificate file not found: $CertPath" }
        Invoke-Ctl @('rotate-cert', '--pfx', $CertPath, '--password', $CertPassword, '--no-restart') -Mask @($CertPassword) | Out-Null
    }

    # ----- services --------------------------------------------------------------------------------------------------
    Write-Step 'services'
    $values = @{
        DB_NAME = $dbSvc; DB_DISPLAY = $edition.services.db.displayName; DB_DESCRIPTION = $edition.services.db.description
        APP_NAME = $appSvc; APP_DISPLAY = $edition.services.app.displayName; APP_DESCRIPTION = $edition.services.app.description
        INSTALL_DIR = $InstallDir; DATA_DIR = $DataDir
        NODE_HEAP_MB = [string]([math]::Max(1024, [math]::Min(4096, [int]($os.TotalVisibleMemorySize / 1KB / 8))))
    }
    Stop-Svc $dbSvc
    Register-Svc $dbSvc 'db-service.xml.template' $values
    Register-Svc $appSvc 'app-service.xml.template' $values

    # ----- folders and permissions (least privilege) ------------------------------------------------------------------
    Write-Step 'folder permissions'
    foreach ($d in @('db', 'blobs', 'backups', 'logs', 'logs\service', 'quarantine', 'tls')) { New-Item -ItemType Directory -Force -Path (Join-Path $DataDir $d) | Out-Null }
    # the data folder: administrators, SYSTEM and the application's account (attachments, backups, logs, status files);
    # the database account may only pass through it to its own folders
    Grant-Acl $DataDir @("NT SERVICE\$appSvc`:(OI)(CI)M", "NT SERVICE\$dbSvc`:(RX)") -Reset
    # the PostgreSQL cluster: only the database account (and administrators, SYSTEM)
    Grant-Acl (Join-Path $DataDir 'db') @("NT SERVICE\$dbSvc`:(OI)(CI)F") -Reset
    Grant-Acl (Join-Path $DataDir 'logs') @("NT SERVICE\$dbSvc`:(RX)")
    Grant-Acl (Join-Path $DataDir 'logs\service') @("NT SERVICE\$dbSvc`:(OI)(CI)M")
    # the configuration (secrets, passwords): administrators, SYSTEM and the application's account (it updates it)
    Invoke-Native -File 'icacls.exe' -Arguments @($config, '/inheritance:r', '/grant:r', '*S-1-5-32-544:F', '/grant:r', '*S-1-5-18:F', '/grant:r', "NT SERVICE\$appSvc`:M", '/Q') | Out-Null
    Grant-Acl (Join-Path $DataDir 'tls') @("NT SERVICE\$appSvc`:(OI)(CI)M") -Reset

    # ----- PostgreSQL ------------------------------------------------------------------------------------------------
    Write-Step 'database'
    $disk = 'ssd'
    try {
        $part = Get-Partition -DriveLetter $drive.TrimEnd(':') -ErrorAction Stop
        $media = (Get-PhysicalDisk | Where-Object { $_.DeviceId -eq [string]$part.DiskNumber } | Select-Object -First 1).MediaType
        if ("$media" -eq 'HDD') { $disk = 'hdd' }
        Write-Log "data disk media: $media"
    } catch { Write-Log 'data disk media unknown (virtual or SAN): tuned as SSD' }
    Invoke-Ctl @('db-init', '--disk', $disk) | Out-Null
    Invoke-Ctl @('pg-conf', '--disk', $disk) | Out-Null
    Grant-Acl (Join-Path $DataDir 'db') @("NT SERVICE\$dbSvc`:(OI)(CI)F")
    Start-Svc $dbSvc
    Invoke-Ctl @('db-bootstrap', '--timeout', '180') | Out-Null
    Invoke-Ctl @('migrate', '--timeout', '180') | Out-Null

    # ----- firewall, shortcuts, environment ---------------------------------------------------------------------------
    Write-Step 'firewall'
    Get-NetFirewallRule -DisplayName $edition.firewallRule -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    $ports = @([int]$HttpsPort)
    if ([int]$HttpPort -gt 0) { $ports += [int]$HttpPort }
    New-NetFirewallRule -DisplayName $edition.firewallRule -Direction Inbound -Protocol TCP -LocalPort $ports -Action Allow -Profile Any | Out-Null
    Write-Log "inbound TCP $($ports -join ', ') allowed (all profiles; narrow it to Domain if your policy asks); PostgreSQL listens on 127.0.0.1 only"
    [Environment]::SetEnvironmentVariable('ITSM_SERVER_CONFIG', $config, 'Machine')
    $path = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    if (($path -split ';') -notcontains $InstallDir) { [Environment]::SetEnvironmentVariable('Path', "$path;$InstallDir", 'Machine') }
    $reg = "HKLM:\$($edition.registryKey)"
    New-Item -Path $reg -Force | Out-Null
    Set-ItemProperty -Path $reg -Name InstallDir -Value $InstallDir
    Set-ItemProperty -Path $reg -Name DataDir -Value $DataDir
    Set-ItemProperty -Path $reg -Name Version -Value $version

    if ($RegisterBackupTask) {
        Write-Step "scheduled task $($edition.services.backupTask.name)"
        $action = New-ScheduledTaskAction -Execute $node -Argument "`"$ctlJs`" backup --label manual --config `"$config`""
        $trigger = New-ScheduledTaskTrigger -Daily -At '01:30'
        Register-ScheduledTask -TaskName $edition.services.backupTask.name -Action $action -Trigger $trigger -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
    }

    # ----- start ------------------------------------------------------------------------------------------------------
    Write-Step 'start'
    Start-Svc $appSvc
    Invoke-Ctl @('wait-ready', '--timeout', '300') | Out-Null
    $publicUrl = (Get-Content -LiteralPath $config -Raw -Encoding UTF8 | ConvertFrom-Json).public_url
    $start = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs'
    Write-Utf8 (Join-Path $start "$($edition.product).url") "[InternetShortcut]`r`nURL=$publicUrl/`r`nIconFile=$(Join-Path $InstallDir 'icon.ico')`r`nIconIndex=0`r`n"

    # a fresh platform: the one-time setup address (only its hash stays in kariz.json)
    $setup = Join-Path $DataDir 'setup-url.txt'
    $users = 0
    try {
        $out = Invoke-Ctl @('setup-token')
        Write-Log "first-run setup: $(($out | Select-Object -Last 1))"
        $users = 0
    } catch {
        Write-Log 'first-run setup already done (accounts exist): no setup address issued'
        $users = 1
    }
    # administrators read it; the application removes it once the setup is done
    if (Test-Path $setup) { Invoke-Native -File 'icacls.exe' -Arguments @($setup, '/inheritance:r', '/grant:r', '*S-1-5-32-544:F', '/grant:r', '*S-1-5-18:F', '/grant:r', "NT SERVICE\$appSvc`:M", '/Q') -Quiet | Out-Null }
    Write-Step ("{0} {1} is running: {2}{3}" -f $edition.product, $version, $publicUrl, $(if ($users) { '' } else { " — open the address in $setup to finish the setup" }))
    exit 0
} catch {
    Write-Log "INSTALL FAILED: $($_.Exception.Message)" 'ERROR'
    Write-Log ($_.ScriptStackTrace) 'ERROR'
    if (-not $upgrade) {
        foreach ($s in $created) {
            try {
                Stop-Svc $s
                & (Join-Path $svcDir "$s.exe") uninstall 2>&1 | Out-Null
                Write-Log "rolled back service $s"
            } catch { }
        }
    }
    Write-Log "log: $script:LogFile" 'ERROR'
    exit 1
}
