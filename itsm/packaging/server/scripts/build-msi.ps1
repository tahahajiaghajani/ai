# Build machine: builds the MSI from server-dist (after fetch-deps.ps1 and build-pgvector.ps1) with the pinned WiX
# toolset installed from its verified local feed. Names come from edition.json; the version from server-dist\VERSION.
#   build-msi.ps1 -Dist server-dist -Cache packaging\server\.cache -Out server-release [-Suffix -upgrade-test]
param(
    [Parameter(Mandatory)][string]$Dist,
    [Parameter(Mandatory)][string]$Cache,
    [Parameter(Mandatory)][string]$Out,
    [string]$Suffix = ''
)
. (Join-Path $PSScriptRoot 'common.ps1')

$Dist = (Resolve-Path $Dist).Path
$Cache = (Resolve-Path $Cache).Path
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$Out = (Resolve-Path $Out).Path
Set-LogFile (Join-Path $Out 'build-msi.log')
$edition = Read-Edition $Dist
$deps = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\deps.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version = (Get-Content -LiteralPath (Join-Path $Dist 'VERSION') -Raw).Trim()
foreach ($need in @('node\node.exe', 'app\server.cjs', 'app\karizctl.cjs', 'app\public\index.html', 'pgsql\bin\postgres.exe', 'winsw\WinSW-x64.exe', 'scripts\install.ps1', 'edition.json')) {
    if (-not (Test-Path (Join-Path $Dist $need))) { Fail "payload incomplete: $need missing in $Dist" }
}

Write-Step "WiX $($deps.wix.version) from the verified local feed"
$feed = Join-Path $Cache 'wix\feed'
$config = Join-Path $Cache 'wix\nuget.config'
Write-Utf8 $config "<?xml version=`"1.0`" encoding=`"utf-8`"?><configuration><packageSources><clear /><add key=`"pinned`" value=`"$feed`" /></packageSources></configuration>"
$wix = Join-Path $env:USERPROFILE '.dotnet\tools\wix.exe'
$have = if (Test-Path $wix) { (& $wix --version 2>$null) } else { '' }
if ("$have" -notlike "$($deps.wix.version)*") {
    if (Test-Path $wix) { Invoke-Native -File 'dotnet' -Arguments @('tool', 'uninstall', '--global', 'wix') -OkCodes @(0, 1) | Out-Null }
    Invoke-Native -File 'dotnet' -Arguments @('tool', 'install', '--global', 'wix', '--version', $deps.wix.version, '--configfile', $config) | Out-Null
}
Write-Log "wix $(& $wix --version)"
$ext = @()
foreach ($id in @('WixToolset.Util.wixext', 'WixToolset.UI.wixext')) {
    $dll = Get-ChildItem (Join-Path $Cache "wix\$id") -Recurse -Filter "$id.dll" | Select-Object -First 1
    if (-not $dll) { Fail "$id.dll not found in the pinned package (run fetch-deps.ps1)" }
    $ext += @('-ext', $dll.FullName)
}

$msi = Join-Path $Out ("{0}-{1}{2}.msi" -f $edition.msiFilePrefix, $version, $Suffix)
$installFolder = Split-Path -Leaf $edition.installDir
Write-Step "wix build -> $msi"
$wixArgs = @(
    'build', (Join-Path $PSScriptRoot '..\wix\Package.wxs'), '-arch', 'x64', '-nologo',
    '-d', "ProductName=$($edition.product)",
    '-d', "Manufacturer=$($edition.manufacturer)",
    '-d', "Version=$version",
    '-d', "UpgradeCode=$($edition.upgradeCode)",
    '-d', "InstallFolderName=$installFolder",
    '-d', "DataDirDefault=$($edition.dataDir)",
    '-d', "RegistryKey=$($edition.registryKey)",
    '-d', "SourceDir=$Dist",
    '-d', "LicenseRtf=$(Join-Path $PSScriptRoot '..\wix\License.rtf')",
    '-o', $msi
) + $ext
Invoke-Native -File $wix -Arguments $wixArgs | Out-Null
if (-not (Test-Path $msi)) { Fail 'the MSI was not produced' }
Write-Log ("MSI ready: {0} ({1:N1} MB)" -f $msi, ((Get-Item $msi).Length / 1MB))
