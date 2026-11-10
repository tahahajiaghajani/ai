# Shared helpers of the server edition's PowerShell scripts (Windows PowerShell 5.1 compatible: the MSI runs them with
# powershell.exe). Every step is logged with a timestamp to the console (captured in the MSI log) and to a log file.
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$script:LogFile = $null

function Set-LogFile([string]$Path) {
    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $script:LogFile = $Path
}

function Write-Log([string]$Message, [string]$Level = 'INFO') {
    # a safety net: a one-time setup address (or any URL with a token) never reaches a log or the MSI log
    $Message = $Message -replace '(?i)(token=)[^&\s"'']+', '$1********'
    $line = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Write-Host $line
    if ($script:LogFile) {
        try { Add-Content -LiteralPath $script:LogFile -Value $line -Encoding UTF8 } catch { }
    }
}

function Write-Step([string]$Message) { Write-Log "==> $Message" 'STEP' }

function Write-Warn([string]$Message) {
    Write-Log $Message 'WARN'
    if ($env:GITHUB_ACTIONS -eq 'true') { Write-Host "::warning::$Message" }
}

function Fail([string]$Message) {
    Write-Log $Message 'ERROR'
    if ($env:GITHUB_ACTIONS -eq 'true') { Write-Host "::error::$Message" }
    throw $Message
}

# The Windows-facing names: packaging/server/edition.json (copied next to the scripts' folder in the installation).
function Read-Edition([string]$Root) {
    foreach ($p in @((Join-Path $Root 'edition.json'), (Join-Path $Root '..\edition.json'), (Join-Path $Root '..\..\edition.json'))) {
        if (Test-Path -LiteralPath $p) { return (Get-Content -LiteralPath $p -Raw -Encoding UTF8 | ConvertFrom-Json) }
    }
    Fail "edition.json not found near $Root"
}

# Run a program, log its command line (secrets masked) and output; throw with the output's tail when it fails.
function Invoke-Native {
    param([Parameter(Mandatory)][string]$File, [string[]]$Arguments = @(), [string[]]$Mask = @(), [int[]]$OkCodes = @(0), [switch]$Quiet)
    $shown = ($Arguments | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '
    foreach ($m in $Mask) { if ($m) { $shown = $shown.Replace($m, '********') } }
    Write-Log "run: $File $shown"
    # Windows PowerShell 5.1 turns a native program's stderr into terminating errors under 'Stop'
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $out = & $File @Arguments 2>&1 | ForEach-Object { "$_" } } finally { $ErrorActionPreference = $prev }
    $code = $LASTEXITCODE
    if (-not $Quiet -or ($OkCodes -notcontains $code)) { foreach ($l in $out) { Write-Log "    $l" } }
    if ($OkCodes -notcontains $code) { Fail ("{0} exited with code {1}" -f (Split-Path -Leaf $File), $code) }
    return ,$out
}

function Get-Sha256([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }

# Download once into the cache and verify the pinned SHA-256 (a mismatch is fatal: never ship an unverified binary).
function Get-Pinned {
    param([Parameter(Mandatory)][string]$Url, [Parameter(Mandatory)][string]$Sha256, [Parameter(Mandatory)][string]$Cache, [string]$Name)
    if (-not (Test-Path $Cache)) { New-Item -ItemType Directory -Force -Path $Cache | Out-Null }
    if (-not $Name) { $Name = Split-Path -Leaf ([Uri]$Url).AbsolutePath }
    $file = Join-Path $Cache $Name
    if ((Test-Path -LiteralPath $file) -and ((Get-Sha256 $file) -eq $Sha256.ToLowerInvariant())) {
        Write-Log "cached: $Name"
        return $file
    }
    Write-Log "download: $Url"
    $tmp = "$file.part"
    for ($i = 1; $i -le 3; $i++) {
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri $Url -OutFile $tmp -UseBasicParsing
            break
        } catch {
            if ($i -eq 3) { Fail "download failed: $Url ($($_.Exception.Message))" }
            Write-Warn "download attempt $i failed, retrying: $($_.Exception.Message)"
            Start-Sleep -Seconds (5 * $i)
        }
    }
    $got = Get-Sha256 $tmp
    if ($got -ne $Sha256.ToLowerInvariant()) {
        Remove-Item -LiteralPath $tmp -Force
        Fail "SHA-256 mismatch for $Name`: expected $Sha256, got $got (update packaging/server/deps.json only after checking the new file)"
    }
    Move-Item -LiteralPath $tmp -Destination $file -Force
    Write-Log "verified: $Name ($got)"
    return $file
}

function Expand-Zip([string]$Zip, [string]$Destination) {
    if (Test-Path $Destination) { Remove-Item -Recurse -Force $Destination }
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    # ZipFile lives in System.IO.Compression.FileSystem (Windows PowerShell 5.1) or System.IO.Compression.ZipFile (7.x)
    foreach ($a in @('System.IO.Compression.FileSystem', 'System.IO.Compression.ZipFile')) { try { Add-Type -AssemblyName $a -ErrorAction Stop } catch { } }
    [System.IO.Compression.ZipFile]::ExtractToDirectory($Zip, $Destination)
}

function Write-Utf8([string]$Path, [string]$Text) {
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding $false))
}

# Is a TCP port free on this machine (nothing listening on it)?
function Test-PortFree([int]$Port) {
    $l = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    return -not $l
}

# The Visual Studio installation (with the C++ tools) of a build machine.
function Get-VsPath {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path $vswhere)) { Fail 'vswhere.exe not found: Visual Studio with the C++ workload is required' }
    $vs = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if (-not $vs) { Fail 'Visual Studio C++ build tools not found' }
    return $vs
}
