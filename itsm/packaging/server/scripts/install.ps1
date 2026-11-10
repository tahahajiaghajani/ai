# Installs or upgrades the server edition on this machine. Run by the MSI (elevated, as SYSTEM) after the files are in
# place; safe to run again by hand from an elevated prompt (it is idempotent):
#   powershell -ExecutionPolicy Bypass -File "C:\Program Files\Kariz\scripts\install.ps1" -HostName kariz.bank.local
# Steps: prerequisites -> configuration (kariz.json: generated secrets and database passwords, kept on upgrade) ->
# certificate -> services (WinSW, virtual accounts, recovery, dependency) -> folder permissions -> PostgreSQL cluster
# (initdb, tuned postgresql.conf, loopback-only pg_hba) -> role, database, extensions -> migrations -> firewall ->
# start -> readiness -> one-time setup URL. A log is kept in <data>\logs\install-<time>.log.
# Ports: given ones (PORT= / HTTPPORT= / PGPORT=) are used as given and must be free; empty or 'auto' keeps those of
# kariz.json (re-install, upgrade), else takes the first free port of 443 / 8443 / 9443 ..., 80 / 8080 / 8081 ... and
# 5432 / 5433 ... (karizctl preflight). A failure writes its reason to <data>\logs\install-error.txt and to the
# Application event log (source Kariz); the MSI's error dialog points there.
param(
    [string]$InstallDir = '',
    [string]$DataDir = '',
    [string]$HostName = '',
    # empty or 'auto': kept from kariz.json on a re-install or upgrade, else the first free port (443 / 80 by default)
    [string]$HttpsPort = '',
    [string]$HttpPort = '',
    [string]$PgPort = '',
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

# The data folder: never a drive root, a system folder or a folder other software uses - its ACL is replaced below and
# REMOVEDATA=1 deletes it. A first install takes a new or empty folder; one this product already uses carries the
# marker (or kariz.json).
function Assert-DataDir([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    if ($full -eq [IO.Path]::GetPathRoot($full).TrimEnd('\')) { Fail "DATADIR must not be a drive root ($Path): use a folder such as D:\Kariz" }
    $system = @($env:SystemRoot, $env:ProgramData, $env:ProgramFiles, ${env:ProgramFiles(x86)}, $(if ($env:PUBLIC) { Split-Path -Parent $env:PUBLIC }))
    foreach ($sys in $system) {
        if (-not $sys) { continue }
        $s = [IO.Path]::GetFullPath($sys).TrimEnd('\')
        if ($full -ieq $s -or $s.StartsWith("$full\", [StringComparison]::OrdinalIgnoreCase)) { Fail "DATADIR must not be a system folder or contain one ($Path)" }
    }
    if ($env:SystemRoot -and $full.StartsWith("$([IO.Path]::GetFullPath($env:SystemRoot).TrimEnd('\'))\", [StringComparison]::OrdinalIgnoreCase)) { Fail "DATADIR must not be inside the Windows folder ($Path)" }
    if (Test-Path -LiteralPath $full) {
        $ours = (Test-Path -LiteralPath (Join-Path $full $edition.configFile)) -or (Test-Path -LiteralPath (Join-Path $full $DataMarker))
        $empty = -not (Get-ChildItem -LiteralPath $full -Force -ErrorAction SilentlyContinue | Select-Object -First 1)
        if (-not $ours -and -not $empty) { Fail "DATADIR $Path already holds other files: choose a new or empty folder" }
    }
}

$DataMarker = '.kariz-data'
$edition = $null
$created = @()
$upgrade = $false
# the services of a re-install that were running when it started: started again if this run fails
$running = @()
$svcDir = $null
$dbSvc = $null
$appSvc = $null
$script:ErrorFile = $null

function Invoke-Ctl([string[]]$Arguments, [string[]]$Mask = @(), [switch]$Quiet) {
    $env:ITSM_SERVER_CONFIG = $config
    $env:ITSM_INSTALL_DIR = $InstallDir
    return Invoke-Native -File $node -Arguments (@($ctlJs) + $Arguments + @('--config', $config)) -Mask $Mask -Quiet:$Quiet
}

# an administrators-and-SYSTEM-only file (the superuser's password, the TLS key)
function Protect-File([string]$Path) {
    if (Test-Path -LiteralPath $Path) { Invoke-Native -File 'icacls.exe' -Arguments @($Path, '/inheritance:r', '/grant:r', '*S-1-5-32-544:F', '/grant:r', '*S-1-5-18:F', '/Q') -Quiet | Out-Null }
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


function Get-PublicUrl([string]$HostPart, [string]$Port) {
    $h = $HostPart.Trim().ToLowerInvariant()
    if ([int]$Port -eq 443) { return "https://$h" }
    return "https://$($h):$Port"
}

function Test-Elevated {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return $id.IsSystem -or ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# A restart Windows is waiting for (servicing or Windows Update): a warning, services may fail to start until then.
function Test-PendingReboot {
    foreach ($k in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending', 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired')) {
        if (Test-Path -LiteralPath $k) { return $true }
    }
    return $false
}

function Get-EventSource {
    if ($edition -and $edition.PSObject.Properties['eventSource'] -and $edition.eventSource) { return [string]$edition.eventSource }
    return 'Kariz'
}

# The reason of a failed install where the user finds it: <data>\logs\install-error.txt (the MSI's error dialog names
# it), the Application event log (source Kariz) and the install log. Never a secret: the certificate password and any
# setup token are masked.
function Write-InstallError([string]$Reason) {
    $product = if ($edition) { [string]$edition.product } else { 'Kariz Server' }
    $msi = if ($edition) { "$($edition.msiFilePrefix)-x.y.z.msi" } else { 'the .msi file' }
    $text = @(
        "$product could not be installed ($(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')).",
        '',
        "Reason: $Reason",
        '',
        "Install log: $(if ($script:LogFile) { $script:LogFile } else { 'none (the data folder could not be used)' })",
        'A busy port: leave PORT / HTTPPORT empty (auto) so free ones are chosen, or stop the program that holds it.',
        "A detailed Windows Installer log: msiexec /i $msi /l*v `"%TEMP%\kariz-install.log`"",
        'Guide: docs/SERVER_FA.md, section: install on a laptop for a demo.'
    ) -join "`r`n"
    $file = $script:ErrorFile
    if (-not $file -and $env:SystemRoot) { $file = Join-Path $env:SystemRoot 'Temp\Kariz-install-error.txt' }
    if ($file) {
        try { Write-Utf8 $file ($text + "`r`n"); Write-Log "the reason was written to $file" 'ERROR' } catch { Write-Log "install-error.txt not written: $($_.Exception.Message)" 'WARN' }
    }
    Write-EventLogEntry (Get-EventSource) $text 'Error' 1001
}

try {
    $edition = Read-Edition (Join-Path $PSScriptRoot '..')
    $dbSvc = $edition.services.db.name
    $appSvc = $edition.services.app.name
    if (-not $InstallDir) { $InstallDir = Join-Path $PSScriptRoot '..' }
    $InstallDir = (Resolve-Path (Clean-Path $InstallDir)).Path
    $svcDir = Join-Path $InstallDir 'services'
    if (-not $DataDir) { $DataDir = $edition.dataDir }
    $DataDir = Clean-Path $DataDir
    Assert-DataDir $DataDir
    New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
    # locked before anything is written into it (secrets, the superuser's password, the TLS key): administrators and
    # SYSTEM only - inheritance from C:\ProgramData (Users: read) or a drive root (Authenticated Users: modify) removed. The
    # services' own grants (kept on a re-install) are added once they exist. A failed install leaves nothing readable.
    Invoke-Native -File 'icacls.exe' -Arguments @($DataDir, '/inheritance:r', '/grant:r', '*S-1-5-32-544:(OI)(CI)F', '/grant:r', '*S-1-5-18:(OI)(CI)F', '/Q') -Quiet | Out-Null
    Set-Content -LiteralPath (Join-Path $DataDir $DataMarker) -Value 'Kariz Server data folder (uninstall with REMOVEDATA=1 deletes this folder)' -Encoding ASCII
    New-Item -ItemType Directory -Force -Path (Join-Path $DataDir 'logs') | Out-Null
    Set-LogFile (Join-Path $DataDir ("logs\install-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss')))
    $script:ErrorFile = Join-Path $DataDir 'logs\install-error.txt'
    if (Test-Path -LiteralPath $script:ErrorFile) { Remove-Item -LiteralPath $script:ErrorFile -Force -ErrorAction SilentlyContinue }

    $node = Join-Path $InstallDir 'node\node.exe'
    $ctlJs = Join-Path $InstallDir 'app\karizctl.cjs'
    $config = Join-Path $DataDir $edition.configFile
    $version = (Get-Content -LiteralPath (Join-Path $InstallDir 'VERSION') -Raw).Trim()

    Write-Step "$($edition.product) $version - $InstallDir -> $DataDir"

    # ----- prerequisites and ports (karizctl preflight: the rules live in src/server-edition/preflight.ts) ------------
    Write-Step 'prerequisites'
    $os = Get-CimInstance Win32_OperatingSystem
    $build = [int]$os.BuildNumber
    $memMb = [int64]($os.TotalVisibleMemorySize / 1KB)
    $arch = [string](Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment' -ErrorAction SilentlyContinue).PROCESSOR_ARCHITECTURE
    Write-Log "Windows: $($os.Caption) build $build ($arch), $([math]::Round($memMb / 1KB, 1)) GB memory, $((Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors) logical processors"
    $drive = (Split-Path -Qualifier $DataDir)
    $free = (Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$drive'").FreeSpace
    $upgrade = (Test-Path -LiteralPath $config)
    if ($upgrade) { Write-Log "existing installation found ($config): upgrade, data and secrets kept" }
    # 'auto' (the setup dialog's default) is the same as not given: kept from kariz.json, else the first free port
    if ($HttpsPort.Trim() -ieq 'auto') { $HttpsPort = '' } else { $HttpsPort = $HttpsPort.Trim() }
    if ($HttpPort.Trim() -ieq 'auto') { $HttpPort = '' } else { $HttpPort = $HttpPort.Trim() }
    if ($PgPort.Trim() -ieq 'auto') { $PgPort = '' } else { $PgPort = $PgPort.Trim() }
    $httpsGiven = [bool]$HttpsPort
    # a re-install of a running installation: its own services hold its ports (stopped first; started again on failure)
    foreach ($s in @($appSvc, $dbSvc)) { $svc = Get-Svc $s; if ($svc -and $svc.Status -eq 'Running') { $running += $s } }
    Stop-Svc $appSvc
    Stop-Svc $dbSvc
    $pfFile = Join-Path $DataDir 'logs\preflight.json'
    if (Test-Path -LiteralPath $pfFile) { Remove-Item -LiteralPath $pfFile -Force }
    $pfArgs = @('preflight', '--out', $pfFile, '--admin', $(if (Test-Elevated) { '1' } else { '0' }), '--build', "$build", '--product-type', "$($os.ProductType)", '--memory-mb', "$memMb", '--pending-reboot', $(if (Test-PendingReboot) { '1' } else { '0' }))
    if ($arch) { $pfArgs += @('--arch', $arch) }
    if ($null -ne $free) { $pfArgs += @('--free-mb', "$([int64]($free / 1MB))") }
    # given ports only (an empty argument is dropped by Windows PowerShell 5.1 and would shift the others)
    if ($HttpsPort) { $pfArgs += @('--https-port', $HttpsPort) }
    if ($HttpPort) { $pfArgs += @('--http-port', $HttpPort) }
    if ($PgPort) { $pfArgs += @('--pg-port', $PgPort) }
    try { Invoke-Ctl $pfArgs -Quiet | Out-Null } catch { Fail "the bundled Node.js could not run the preflight ($($_.Exception.Message)): an antivirus or Controlled Folder Access may block $InstallDir, or this is not an x64 processor" }
    if (-not (Test-Path -LiteralPath $pfFile)) { Fail 'the preflight wrote no result' }
    $pf = Get-Content -LiteralPath $pfFile -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($n in @($pf.notes)) { if ($n) { Write-Log "ports: $n" } }
    foreach ($w in @($pf.warnings)) { if ($w) { Write-Warn $w } }
    if (-not $pf.ok) { Fail ((@($pf.errors) | Where-Object { $_ }) -join '; ') }
    $HttpsPort = [string]$pf.ports.https
    $HttpPort = [string]$pf.ports.http
    $PgPort = [string]$pf.ports.pg
    Write-Log "ports: HTTPS $HttpsPort, HTTP $(if ($HttpPort -eq '0') { 'off' } else { $HttpPort }), PostgreSQL $PgPort (127.0.0.1 only)"

    # ----- configuration ---------------------------------------------------------------------------------------------
    Write-Step 'configuration'
    # the chosen ports (given, kept from kariz.json, or the first free ones): the runtime, the redirect, karizctl status,
    # the firewall rule and the public address all use them
    $initArgs = @('init', '--data-dir', $DataDir, '--install-dir', $InstallDir, '--https-port', $HttpsPort, '--http-port', $HttpPort, '--pg-port', $PgPort)
    if ($HostName) {
        $initArgs += @('--public-url', (Get-PublicUrl $HostName $HttpsPort))
    } elseif (-not $upgrade) {
        $fqdn = $null
        try { $fqdn = [System.Net.Dns]::GetHostEntry($env:COMPUTERNAME).HostName } catch { }
        if (-not $fqdn) { $fqdn = $env:COMPUTERNAME }
        $url = Get-PublicUrl $fqdn $HttpsPort
        $initArgs += @('--public-url', $url)
        Write-Log "HOSTNAME not given: using $url (change it in the first-run setup)"
    } elseif ($httpsGiven) {
        # an upgrade that moves HTTPS (PORT= given): the public address keeps its host name and takes the new port
        try {
            $old = [Uri]((Get-Content -LiteralPath $config -Raw -Encoding UTF8 | ConvertFrom-Json).public_url)
            $initArgs += @('--public-url', (Get-PublicUrl $old.Host $HttpsPort))
        } catch { Write-Warn "the public address could not be moved to port $HttpsPort`: $($_.Exception.Message)" }
    }
    if ($AirGapped -eq '0') { $initArgs += @('--air-gapped', 'false') } elseif (-not $upgrade) { $initArgs += @('--air-gapped', 'true') }
    if ([int]$Workers -gt 0) { $initArgs += @('--workers', $Workers) }
    Invoke-Ctl $initArgs | Out-Null
    Protect-File (Join-Path $DataDir 'kariz-admin.json')

    if ($CertPath) {
        Write-Step 'certificate'
        if (-not (Test-Path -LiteralPath $CertPath)) { Fail "certificate file not found: $CertPath" }
        # the key lands in tls\, under the data folder locked above: administrators and SYSTEM (and, on a re-install, the
        # application's account, which serves it) - never Users or Authenticated Users, even if a later step fails
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
    # the PostgreSQL superuser's password: administrators and SYSTEM only (the application never needs it)
    $adminFile = Join-Path $DataDir 'kariz-admin.json'
    if (Test-Path $adminFile) { Invoke-Native -File 'icacls.exe' -Arguments @($adminFile, '/inheritance:r', '/grant:r', '*S-1-5-32-544:F', '/grant:r', '*S-1-5-18:F', '/Q') | Out-Null }
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
        # the address holds the one-time token: written to setup-url.txt (administrators only), never to a log
        Invoke-Ctl @('setup-token') -Quiet | Out-Null
        Write-Log "first-run setup: the one-time address was written to $setup"
        $users = 0
    } catch {
        Write-Log 'first-run setup already done (accounts exist): no setup address issued'
        $users = 1
    }
    # administrators read it; the application removes it once the setup is done
    if (Test-Path $setup) { Invoke-Native -File 'icacls.exe' -Arguments @($setup, '/inheritance:r', '/grant:r', '*S-1-5-32-544:F', '/grant:r', '*S-1-5-18:F', '/grant:r', "NT SERVICE\$appSvc`:M", '/Q') -Quiet | Out-Null }
    $summary = "{0} {1} is running: {2}/ (HTTPS {3}, HTTP {4}, PostgreSQL {5} on 127.0.0.1)" -f $edition.product, $version, $publicUrl, $HttpsPort, $(if ($HttpPort -eq '0') { 'off' } else { $HttpPort }), $PgPort
    Write-EventLogEntry (Get-EventSource) "$summary. Data folder: $DataDir" 'Information' 1000
    Write-Step ("{0}{1}" -f $summary, $(if ($users) { '' } else { " - open the address in $setup to finish the setup" }))
    exit 0
} catch {
    $reason = [string]$_.Exception.Message
    if ($CertPassword) { $reason = $reason.Replace($CertPassword, '********') }
    Write-Log "INSTALL FAILED: $reason" 'ERROR'
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
    # a failed re-install leaves the installation running as it was
    foreach ($s in $running) { try { Start-Svc $s; Write-Log "started $s again" } catch { } }
    Write-InstallError $reason
    if ($script:LogFile) { Write-Log "log: $script:LogFile" 'ERROR' }
    exit 1
}
