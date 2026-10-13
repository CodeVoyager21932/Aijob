param([ValidateSet('protect','unprotect')][string]$Operation)
$ErrorActionPreference = 'Stop'
try {
    Add-Type -AssemblyName System.Security
    $aijobInput = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
    $aijobEntropy = [Text.Encoding]::UTF8.GetBytes('cn.aijob.desktop.credentials.v1')
    $aijobScope = [Security.Cryptography.DataProtectionScope]::CurrentUser
    if ($Operation -eq 'protect') {
        $aijobOutput = [Security.Cryptography.ProtectedData]::Protect($aijobInput, $aijobEntropy, $aijobScope)
    } else {
        $aijobOutput = [Security.Cryptography.ProtectedData]::Unprotect($aijobInput, $aijobEntropy, $aijobScope)
    }
    [Console]::Out.Write([Convert]::ToBase64String($aijobOutput))
} catch {
    [Console]::Error.Write('WINDOWS_DPAPI_FAILED')
    exit 1
}
