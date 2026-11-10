# Build machine (Windows CI runner): adds the pinned third-party binaries to the server bundle built by
# scripts/build-server.mjs. Everything is verified against packaging/server/deps.json (SHA-256) and cached:
#   server-dist\node\node.exe          Node.js (portable)
#   server-dist\pgsql\{bin,lib,share}  PostgreSQL (EDB binaries; pgAdmin, StackBuilder, docs and headers left out)
#   server-dist\winsw\WinSW-x64.exe    the service wrapper
#   <cache>\pgsql-full                 the complete PostgreSQL (headers and import libraries for build-pgvector.ps1)
#   <cache>\wix                        the WiX toolset and its extensions (build-msi.ps1)
# The Visual C++ runtime PostgreSQL needs is deployed next to postgres.exe (app-local) when the zip lacks it.
param(
    [Parameter(Mandatory)][string]$Dist,
    [Parameter(Mandatory)][string]$Cache
)
. (Join-Path $PSScriptRoot 'common.ps1')

$Dist = (Resolve-Path $Dist).Path
New-Item -ItemType Directory -Force -Path $Cache | Out-Null
$Cache = (Resolve-Path $Cache).Path
Set-LogFile (Join-Path $Cache 'fetch-deps.log')
$deps = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\deps.json') -Raw -Encoding UTF8 | ConvertFrom-Json

Write-Step "Node.js $($deps.node.version)"
$zip = Get-Pinned -Url $deps.node.url -Sha256 $deps.node.sha256 -Cache $Cache
$tmp = Join-Path $Cache 'node-x'
Expand-Zip $zip $tmp
New-Item -ItemType Directory -Force -Path (Join-Path $Dist 'node') | Out-Null
Copy-Item (Join-Path $tmp "$($deps.node.folder)\node.exe") (Join-Path $Dist 'node\node.exe') -Force
Copy-Item (Join-Path $tmp "$($deps.node.folder)\LICENSE") (Join-Path $Dist 'node\LICENSE') -Force
Remove-Item -Recurse -Force $tmp
$v = & (Join-Path $Dist 'node\node.exe') --version
if ($v -ne "v$($deps.node.version)") { Fail "node.exe reports $v, expected v$($deps.node.version)" }
Write-Log "node.exe $v"

Write-Step "PostgreSQL $($deps.postgresql.version)"
$zip = Get-Pinned -Url $deps.postgresql.url -Sha256 $deps.postgresql.sha256 -Cache $Cache
$full = Join-Path $Cache 'pgsql-full'
$marker = Join-Path $full "VERSION-$($deps.postgresql.version)"
if (-not (Test-Path $marker)) {
    $x = Join-Path $Cache 'pgsql-x'
    Expand-Zip $zip $x
    if (Test-Path $full) { Remove-Item -Recurse -Force $full }
    Move-Item (Join-Path $x 'pgsql') $full
    Remove-Item -Recurse -Force $x
    Set-Content -LiteralPath $marker -Value $deps.postgresql.version
}
$pg = Join-Path $Dist 'pgsql'
if (Test-Path $pg) { Remove-Item -Recurse -Force $pg }
New-Item -ItemType Directory -Force -Path $pg | Out-Null
foreach ($d in $deps.postgresql.ship) { Copy-Item -Recurse (Join-Path $full $d) (Join-Path $pg $d) }
# only the PostgreSQL server's own files: no development leftovers in lib (static and import libraries)
Get-ChildItem (Join-Path $pg 'lib') -Include '*.lib', '*.a', '*.pdb' -Recurse | Remove-Item -Force
foreach ($f in @('LICENSE', 'license.txt', 'COPYRIGHT')) { $p = Join-Path $full $f; if (Test-Path $p) { Copy-Item $p $pg } }
foreach ($exe in @('postgres.exe', 'pg_ctl.exe', 'initdb.exe', 'pg_dump.exe', 'pg_restore.exe', 'psql.exe')) {
    if (-not (Test-Path (Join-Path $pg "bin\$exe"))) { Fail "PostgreSQL bundle lacks bin\$exe" }
}
if (-not (Test-Path (Join-Path $pg 'lib\pg_stat_statements.dll'))) { Fail 'PostgreSQL bundle lacks pg_stat_statements' }

# Visual C++ runtime (PostgreSQL is built with MSVC): app-local copy when the zip has none
if (-not (Test-Path (Join-Path $pg 'bin\vcruntime140.dll'))) {
    $vs = Get-VsPath
    $crt = Get-ChildItem (Join-Path $vs 'VC\Redist\MSVC') -Directory | Sort-Object Name -Descending |
        ForEach-Object { Get-ChildItem (Join-Path $_.FullName 'x64') -Directory -Filter 'Microsoft.VC14*.CRT' -ErrorAction SilentlyContinue } | Select-Object -First 1
    if (-not $crt) { Fail 'Visual C++ redistributable files (Microsoft.VC14x.CRT) not found in Visual Studio' }
    Copy-Item (Join-Path $crt.FullName '*.dll') (Join-Path $pg 'bin') -Force
    Write-Log "Visual C++ runtime copied from $($crt.FullName)"
}
$check = Invoke-Native -File (Join-Path $pg 'bin\postgres.exe') -Arguments @('--version')
Write-Log "bundle: $($check -join ' ')"

Write-Step "WinSW $($deps.winsw.version)"
$exe = Get-Pinned -Url $deps.winsw.url -Sha256 $deps.winsw.sha256 -Cache $Cache
New-Item -ItemType Directory -Force -Path (Join-Path $Dist 'winsw') | Out-Null
Copy-Item $exe (Join-Path $Dist 'winsw\WinSW-x64.exe') -Force

Write-Step "WiX toolset $($deps.wix.version)"
$wix = Join-Path $Cache 'wix'
New-Item -ItemType Directory -Force -Path (Join-Path $wix 'feed') | Out-Null
foreach ($p in $deps.wix.packages) {
    $name = "$($p.id).$($deps.wix.version).nupkg".ToLowerInvariant()
    $file = Get-Pinned -Url $p.url -Sha256 $p.sha256 -Cache (Join-Path $wix 'feed') -Name $name
    if ($p.id -ne 'wix') {
        $x = Join-Path $wix $p.id
        if (-not (Test-Path (Join-Path $x 'ok'))) {
            Expand-Zip $file $x
            Set-Content (Join-Path $x 'ok') 'ok'
        }
    }
}
Write-Log "pinned WiX packages in $wix\feed"
Write-Step 'dependencies ready'
