# Build machine: compiles pgvector (pinned tag and commit from deps.json) with MSVC against the bundled PostgreSQL and
# adds vector.dll and its extension files to server-dist\pgsql. With -AllowMissing a failed build is a warning: the
# package then ships without pgvector and retrieval uses its portable vector store (docs/SERVER_FA.md).
param(
    [Parameter(Mandatory)][string]$Dist,
    [Parameter(Mandatory)][string]$Cache,
    [switch]$AllowMissing
)
. (Join-Path $PSScriptRoot 'common.ps1')

$Dist = (Resolve-Path $Dist).Path
$Cache = (Resolve-Path $Cache).Path
Set-LogFile (Join-Path $Cache 'build-pgvector.log')
$deps = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\deps.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$full = Join-Path $Cache 'pgsql-full'
if (-not (Test-Path (Join-Path $full 'include\server\postgres.h'))) { Fail "PostgreSQL headers not found in $full (run fetch-deps.ps1 first)" }
$missingNote = Join-Path $Dist 'pgsql\PGVECTOR-NOT-INCLUDED.txt'

try {
    Write-Step "pgvector $($deps.pgvector.tag)"
    $src = Join-Path $Cache "pgvector-$($deps.pgvector.tag)"
    if (Test-Path $src) { Remove-Item -Recurse -Force $src }
    Invoke-Native -File 'git' -Arguments @('-c', 'advice.detachedHead=false', 'clone', '--quiet', '--depth', '1', '--branch', $deps.pgvector.tag, $deps.pgvector.repo, $src) | Out-Null
    $head = (& git -C $src rev-parse HEAD).Trim()
    if ($head -ne $deps.pgvector.commit) { Fail "pgvector $($deps.pgvector.tag) is commit $head, expected $($deps.pgvector.commit)" }
    Write-Log "commit verified: $head"

    $vcvars = Join-Path (Get-VsPath) 'VC\Auxiliary\Build\vcvars64.bat'
    if (-not (Test-Path $vcvars)) { Fail "vcvars64.bat not found: $vcvars" }
    $cmd = "call `"$vcvars`" >nul && set `"PGROOT=$full`" && cd /d `"$src`" && nmake /NOLOGO /F Makefile.win && nmake /NOLOGO /F Makefile.win install"
    Write-Step 'nmake /F Makefile.win (MSVC x64)'
    Invoke-Native -File 'cmd.exe' -Arguments @('/d', '/c', $cmd) | Out-Null

    $dll = Join-Path $full 'lib\vector.dll'
    if (-not (Test-Path $dll)) { Fail 'vector.dll was not produced' }
    Copy-Item $dll (Join-Path $Dist 'pgsql\lib\vector.dll') -Force
    $ext = Join-Path $Dist 'pgsql\share\extension'
    Copy-Item (Join-Path $full 'share\extension\vector.control') $ext -Force
    Copy-Item (Join-Path $full 'share\extension\vector--*.sql') $ext -Force
    if (Test-Path $missingNote) { Remove-Item $missingNote -Force }
    $n = (Get-ChildItem $ext -Filter 'vector--*.sql').Count
    Write-Log "pgvector added: vector.dll, vector.control, $n upgrade scripts"
} catch {
    if (-not $AllowMissing) { throw }
    Write-Warn "pgvector could not be built; the package ships without it (retrieval falls back to its portable store): $($_.Exception.Message)"
    Write-Utf8 $missingNote "pgvector was not built for this package ($($_.Exception.Message)). Retrieval uses the portable vector store; see docs/SERVER_FA.md.`r`n"
}
