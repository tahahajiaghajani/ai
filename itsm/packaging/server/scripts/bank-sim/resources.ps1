# The installed server's processes, sampled for docs/qa/PERFORMANCE_E2E_FA.md section 2 (bank-sim scenario 10):
# every process whose program is in the installation folder (node.exe of KarizApp: the supervisor and its workers;
# postgres.exe of KarizDB: the postmaster and every backend; the services' wrappers) with its working set, private
# bytes and processor time (user + kernel, 100 ns units). One JSON line per sample in -Out; runs until the file -Stop
# exists or -Seconds pass. scripts/bank-sim/perf.mjs turns the samples into CPU per service (% of one core) and memory
# peaks. Started in the background by bank-sim.ps1 (Start-Sampler / Stop-Sampler).
param(
    [Parameter(Mandatory)][string]$InstallDir,
    [Parameter(Mandatory)][string]$Out,
    [Parameter(Mandatory)][string]$Stop,
    [int]$IntervalMs = 2000,
    [int]$Seconds = 1800
)
$ErrorActionPreference = 'Continue'
$prefix = $InstallDir.TrimEnd('\') + '\'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$sw = [Diagnostics.Stopwatch]::StartNew()
while (-not (Test-Path -LiteralPath $Stop) -and $sw.Elapsed.TotalSeconds -lt $Seconds) {
    $at = $sw.Elapsed.TotalMilliseconds
    $list = New-Object System.Collections.ArrayList
    try {
        foreach ($p in @(Get-CimInstance Win32_Process -ErrorAction Stop)) {
            $exe = [string]$p.ExecutablePath
            if (-not $exe -or -not $exe.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { continue }
            [void]$list.Add([pscustomobject]@{
                pid = [int]$p.ProcessId
                ppid = [int]$p.ParentProcessId
                name = [string]$p.Name
                ws = [int64]$p.WorkingSetSize
                priv = [int64]$p.PrivatePageCount
                cpu100ns = ([int64]$p.KernelModeTime + [int64]$p.UserModeTime)
            })
        }
    } catch {
        [void]$list.Clear()
    }
    $sample = [pscustomobject]@{ t = [DateTime]::UtcNow.ToString('o'); ms = [math]::Round($at); procs = $list.ToArray() }
    [IO.File]::AppendAllText($Out, (ConvertTo-Json -InputObject $sample -Compress -Depth 4) + "`n", $utf8)
    $left = $IntervalMs - ($sw.Elapsed.TotalMilliseconds - $at)
    if ($left -gt 0) { Start-Sleep -Milliseconds ([int]$left) }
}
