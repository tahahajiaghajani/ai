# The bank's PKI for the simulation (docs/qa/BANK_SIM_FA.md, scenario 2), with the Windows PKI cmdlets only: a root
# CA 'Bank Test Root CA', server certificates it signs (the Kariz server with its host name and LAN address as SANs,
# the domain controller dc1 and the mail relay smtp), each exported as a password-protected PFX the way an
# administrator exports one from certlm.msc, and the root installed into LocalMachine\Root (what Group Policy does on
# a bank's machines). The root's private key is then removed from the machine. Nothing in the simulation turns
# certificate checks off. Dot-sourced by bank-sim.ps1 (Windows PowerShell 5.1 compatible).

function New-BankPki([string]$Dir, [string]$Password, [string]$LanIp, [hashtable]$Names) {
    New-Item -ItemType Directory -Force -Path $Dir | Out-Null
    $sec = ConvertTo-SecureString -String $Password -AsPlainText -Force
    $root = New-SelfSignedCertificate -Type Custom -Subject 'CN=Bank Test Root CA, O=Bank Test, C=IR' -FriendlyName 'Bank Test Root CA' `
        -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -KeyExportPolicy Exportable -KeyUsage CertSign, CRLSign, DigitalSignature `
        -TextExtension @('2.5.29.19={critical}{text}ca=1&pathlength=1') -NotAfter (Get-Date).AddYears(10) -CertStoreLocation 'Cert:\LocalMachine\My'
    Write-Log "root CA: $($root.Subject) ($($root.Thumbprint))"
    $rootCer = Join-Path $Dir 'bank-root-ca.cer'
    Export-Certificate -Cert $root -FilePath $rootCer -Type CERT | Out-Null
    $pem = "-----BEGIN CERTIFICATE-----`n" + [Convert]::ToBase64String($root.RawData, 'InsertLineBreaks').Replace("`r`n", "`n") + "`n-----END CERTIFICATE-----`n"
    Write-Utf8 (Join-Path $Dir 'bank-root-ca.pem') $pem
    Import-Certificate -FilePath $rootCer -CertStoreLocation 'Cert:\LocalMachine\Root' | Out-Null
    Write-Log 'root CA installed into LocalMachine\Root (as Group Policy distributes it)'
    $out = @{ root = $root.Thumbprint; rootPem = (Join-Path $Dir 'bank-root-ca.pem'); rootCer = $rootCer }
    foreach ($key in $Names.Keys) {
        $dns = [string]$Names[$key]
        $san = "DNS=$dns"
        if ($key -eq 'kariz') { $san += "&IPAddress=$LanIp" }
        $c = New-SelfSignedCertificate -Type Custom -Subject "CN=$dns, O=Bank Test, C=IR" -Signer $root -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 `
            -KeyExportPolicy Exportable -KeyUsage DigitalSignature, KeyEncipherment -NotAfter (Get-Date).AddYears(2) -CertStoreLocation 'Cert:\LocalMachine\My' `
            -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.1', "2.5.29.17={text}$san", '2.5.29.19={critical}{text}ca=0')
        $pfx = Join-Path $Dir "$key.pfx"
        # the whole chain, as 'Include all certificates in the certification path' exports it
        Export-PfxCertificate -Cert $c -FilePath $pfx -Password $sec -ChainOption BuildChain | Out-Null
        $chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain
        $chain.ChainPolicy.RevocationMode = 'NoCheck'
        if (-not $chain.Build($c)) { Fail "the certificate for $dns does not chain to the bank's root: $(($chain.ChainStatus | ForEach-Object { $_.StatusInformation }) -join '; ')" }
        Write-Log "issued $dns ($san), chain OK, exported to $pfx"
        $out[$key] = $pfx
        Remove-Item -LiteralPath "Cert:\LocalMachine\My\$($c.Thumbprint)" -DeleteKey -ErrorAction SilentlyContinue
    }
    # the CA's key never stays on a server
    Remove-Item -LiteralPath "Cert:\LocalMachine\My\$($root.Thumbprint)" -DeleteKey -ErrorAction SilentlyContinue
    return $out
}
