# The bank's network for the simulation (docs/qa/BANK_SIM_FA.md, scenario 1 and 14): the runner becomes a server on an
# intranet with no Internet. Windows Firewall blocks every outbound connection by default; allowed are only the
# runner's own agent (or the CI job would die), the machine's own LAN subnet (the bank's network) and the cloud VM's
# platform addresses (its DNS server and instance metadata - the analogue of the bank's DNS). Loopback is never
# filtered. Dropped packets are logged (pfirewall.log) and every connection attempt is audited with its program
# (Security log, events 5156/5157 of 'Filtering Platform Connection'), so the end of the run can prove that the
# installed server's processes never tried to reach anything outside loopback and the LAN.
# Dot-sourced by bank-sim.ps1 (Windows PowerShell 5.1 compatible).

$script:FwGroup = 'Kariz bank simulation'
# Filtering Platform Connection / Packet Drop (GUIDs: the subcategory names are localised)
$script:AuditConnection = '{0CCE9226-69AE-11D9-BED3-505054503030}'
$script:AuditPacketDrop = '{0CCE9225-69AE-11D9-BED3-505054503030}'

function Get-LanInfo {
    $cfg = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1
    if (-not $cfg) { Fail 'no network adapter with an IPv4 default gateway' }
    $addr = @($cfg.IPv4Address)[0]
    $ip = [string]$addr.IPAddress
    $prefix = [int]$addr.PrefixLength
    $bytes = [Net.IPAddress]::Parse($ip).GetAddressBytes()
    [Array]::Reverse($bytes)
    $n = [int64][BitConverter]::ToUInt32($bytes, 0)
    $mask = ([int64]0xFFFFFFFF -shl (32 - $prefix)) -band [int64]0xFFFFFFFF
    $net = $n -band $mask
    $nb = [BitConverter]::GetBytes([uint32]$net)
    [Array]::Reverse($nb)
    $netIp = (New-Object Net.IPAddress (, $nb)).ToString()
    return [pscustomobject]@{ Ip = $ip; Prefix = $prefix; Cidr = "$netIp/$prefix"; Adapter = $cfg.InterfaceAlias; Gateway = [string]@($cfg.IPv4DefaultGateway)[0].NextHop; Dns = @($cfg.DNSServer | Where-Object { $_.AddressFamily -eq 2 } | ForEach-Object { $_.ServerAddresses }) }
}

function Add-HostsEntries([string]$Ip, [string[]]$Names) {
    $hosts = "$env:SystemRoot\System32\drivers\etc\hosts"
    $lines = @('') + @($Names | ForEach-Object { "$Ip $_" })
    Add-Content -Path $hosts -Value ($lines -join "`r`n") -Encoding ASCII
    Clear-DnsClientCache -ErrorAction SilentlyContinue
    foreach ($n in $Names) { Write-Log "hosts: $n -> $Ip" }
}

function Test-TcpOpen([string]$HostName, [int]$Port, [int]$TimeoutMs = 5000) {
    $c = New-Object System.Net.Sockets.TcpClient
    try {
        $t = $c.ConnectAsync($HostName, $Port)
        if (-not $t.Wait($TimeoutMs)) { return 'timeout' }
        if ($c.Connected) { return 'open' }
        return 'closed'
    } catch {
        $e = $_.Exception
        while ($e.InnerException) { $e = $e.InnerException }
        return "refused: $($e.Message)"
    } finally { $c.Close() }
}

# Cut the Internet. Returns the firewall profiles as they were (Restore-BankNetwork puts them back).
function Enable-BankNetwork([object]$Lan, [string]$LogDir) {
    $saved = Get-NetFirewallProfile | Select-Object Name, Enabled, DefaultOutboundAction, DefaultInboundAction, LogBlocked, LogAllowed, LogFileName, LogMaxSizeKilobytes
    # the runner's agent stays online (as smoke-test.ps1 does): its programs only
    $runner = Get-Process | Where-Object { $_.ProcessName -match '^Runner\.(Listener|Worker)$' -and $_.Path } | ForEach-Object { Split-Path -Parent (Split-Path -Parent $_.Path) } | Sort-Object -Unique
    foreach ($root in $runner) {
        Get-ChildItem $root -Recurse -Filter '*.exe' -ErrorAction SilentlyContinue | ForEach-Object {
            New-NetFirewallRule -Group $script:FwGroup -DisplayName 'bank-sim: CI runner agent' -Direction Outbound -Program $_.FullName -Action Allow | Out-Null
        }
        Write-Log "the CI runner's agent stays online: $root"
    }
    # the bank's LAN (the machine's own subnet: domain controller, mail relay, PCs) and the platform's DNS / metadata
    New-NetFirewallRule -Group $script:FwGroup -DisplayName 'bank-sim: bank LAN' -Direction Outbound -RemoteAddress LocalSubnet -Action Allow | Out-Null
    New-NetFirewallRule -Group $script:FwGroup -DisplayName 'bank-sim: bank DNS and platform' -Direction Outbound -RemoteAddress 168.63.129.16, 169.254.169.254 -Action Allow | Out-Null
    # the mock domain controller and mail relay listen on the LAN address of this same machine
    New-NetFirewallRule -Group $script:FwGroup -DisplayName 'bank-sim: mock DC and relay' -Direction Inbound -Protocol TCP -LocalPort 25, 587, 636 -Action Allow | Out-Null
    $fwLog = "$env:SystemRoot\System32\LogFiles\Firewall\pfirewall.log"
    Set-NetFirewallProfile -All -Enabled True -DefaultOutboundAction Block -LogBlocked True -LogAllowed False -LogFileName $fwLog -LogMaxSizeKilobytes 32767
    Write-Log "outbound blocked by default; allowed: the runner's agent, the LAN $($Lan.Cidr), 168.63.129.16 (DNS) and 169.254.169.254; dropped packets logged to $fwLog"
    # every connection attempt with its program (5156 allowed, 5157 blocked), in a Security log large enough for the run
    Invoke-Native -File 'wevtutil.exe' -Arguments @('sl', 'Security', '/ms:1073741824') -Quiet | Out-Null
    Invoke-Native -File 'auditpol.exe' -Arguments @('/set', "/subcategory:$($script:AuditConnection)", '/success:enable', '/failure:enable') | Out-Null
    Invoke-Native -File 'auditpol.exe' -Arguments @('/set', "/subcategory:$($script:AuditPacketDrop)", '/failure:enable') | Out-Null
    return $saved
}

function Restore-BankNetwork([object]$Saved) {
    foreach ($p in @($Saved)) {
        if ($p) { Set-NetFirewallProfile -Name $p.Name -Enabled $p.Enabled -DefaultOutboundAction $p.DefaultOutboundAction -ErrorAction SilentlyContinue }
    }
    Set-NetFirewallProfile -All -DefaultOutboundAction Allow -ErrorAction SilentlyContinue
    Get-NetFirewallRule -Group $script:FwGroup -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
    & auditpol.exe /set "/subcategory:$($script:AuditConnection)" /success:disable /failure:disable | Out-Null
    Write-Log 'outbound traffic restored'
}

# Is an address loopback or inside the LAN subnet?
function Test-InsideBank([string]$Address, [object]$Lan) {
    if (-not $Address) { return $true }
    if ($Address -match '^(127\.|::1$|0\.0\.0\.0$|::$)') { return $true }
    if ($Address -match ':') { return $Address -match '^fe80:' }
    try {
        $b = [Net.IPAddress]::Parse($Address).GetAddressBytes(); [Array]::Reverse($b)
        $n = [int64][BitConverter]::ToUInt32($b, 0)
        $cidr = $Lan.Cidr.Split('/')
        $nb = [Net.IPAddress]::Parse($cidr[0]).GetAddressBytes(); [Array]::Reverse($nb)
        $net = [int64][BitConverter]::ToUInt32($nb, 0)
        $mask = ([int64]0xFFFFFFFF -shl (32 - [int]$cidr[1])) -band [int64]0xFFFFFFFF
        return (($n -band $mask) -eq $net)
    } catch { return $false }
}

# Every outbound connection attempt of the installed server's programs (node.exe under the installation folder,
# postgres.exe and the other PostgreSQL programs, the service wrappers) since $Since, from the Security log.
function Get-KarizOutbound([datetime]$Since, [string]$InstallDir, [object]$Lan, [string]$OutFile) {
    $leaf = (Split-Path -NoQualifier $InstallDir).TrimStart('\').ToLowerInvariant()
    $ms = [int64]((Get-Date) - $Since).TotalMilliseconds
    # outbound only (%%14593); allowed (5156) and blocked (5157)
    $xpath = "*[System[(EventID=5156 or EventID=5157) and TimeCreated[timediff(@SystemTime) <= $ms]]] and *[EventData[Data[@Name='Direction']='%%14593']]"
    $events = @()
    try { $events = @(Get-WinEvent -LogName Security -FilterXPath $xpath -ErrorAction Stop) } catch { Write-Log "no audited outbound connection found: $($_.Exception.Message)" }
    $total = $events.Count
    $rows = New-Object System.Collections.ArrayList
    $byProgram = @{}
    foreach ($e in $events) {
        $x = [xml]$e.ToXml()
        $d = @{}
        foreach ($n in @($x.Event.EventData.Data)) { $d[[string]$n.GetAttribute('Name')] = [string]$n.InnerText }
        $app = ([string]$d['Application']).ToLowerInvariant()
        $prog = Split-Path -Leaf $app
        if (-not $byProgram.ContainsKey($prog)) { $byProgram[$prog] = 0 }
        $byProgram[$prog]++
        if (-not $app.Contains($leaf)) { continue }
        $dest = [string]$d['DestAddress']
        if (Test-InsideBank $dest $Lan) { continue }
        [void]$rows.Add([pscustomobject]@{ time = $e.TimeCreated.ToString('o'); event = $e.Id; app = $app; pid = $d['ProcessID']; dest = $dest; port = $d['DestPort']; protocol = $d['Protocol'] })
    }
    $summary = [pscustomobject]@{ audited_outbound = $total; by_program = $byProgram; kariz_outside_bank = @($rows) }
    Write-Utf8 $OutFile ($summary | ConvertTo-Json -Depth 5)
    return $summary
}
