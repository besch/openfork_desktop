<#
.SYNOPSIS
    OpenFork AI Engine Cleanup
    Removes the WSL distro(s) managed by OpenFork and all associated Docker data.
    Called automatically by the NSIS uninstaller when the user opts in.
#>

$ErrorActionPreference = "SilentlyContinue"

function Remove-WslDistro {
    param([string]$Name)
    $dists = (wsl.exe -l -v | Out-String) -replace "\0", ""
    if ($dists -match [regex]::Escape($Name)) {
        Write-Host "Removing WSL distro: $Name ..."
        wsl.exe --unregister $Name
        Write-Host "Removed: $Name"
        return $true
    }
    return $false
}

# 1. Always remove the dedicated "OpenFork" distro (used by all custom-path installs)
Remove-WslDistro -Name "OpenFork"

# 2. Check electron-store config for any other managed distro name (e.g. "Ubuntu" from
#    a default-path install).  electron-store uses app.getPath('userData') which resolves
#    to %APPDATA%\<productName> on Windows.  Try both the productName and package name.
$candidateConfigs = @(
    (Join-Path $env:APPDATA "Openfork Client\config.json"),
    (Join-Path $env:APPDATA "openfork_client\config.json")
)

$storedDistro = $null
foreach ($cfgPath in $candidateConfigs) {
    if (Test-Path $cfgPath) {
        try {
            $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
            if ($cfg.wslDistro -and $cfg.wslDistro -ne "OpenFork") {
                $storedDistro = $cfg.wslDistro
            }
        } catch {}
        break
    }
}

if ($storedDistro) {
    Write-Host "Found managed distro in config: $storedDistro"
    Remove-WslDistro -Name $storedDistro
}

Write-Host "OpenFork engine cleanup complete."
