<#
.SYNOPSIS
    OpenFork AI Engine Cleanup
    Removes the WSL distro(s) managed by OpenFork and all associated Docker data.
    Called automatically by the NSIS uninstaller when the user opts in.
#>

$ErrorActionPreference = "Continue"

function Write-Log {
    param([string]$Message)
    Write-Host "[OpenFork Uninstall] $Message" -ForegroundColor Cyan
}

function Test-IsAdmin {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdmin)) {
    Write-Log "Requesting administrator privileges..."
    Start-Process powershell -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $PSCommandPath) -Verb RunAs -Wait
    exit
}

function Remove-WslDistro {
    param([string]$Name)
    $dists = (wsl.exe -l -v 2>$null | Out-String) -replace "\0", ""
    if ($dists -match [regex]::Escape($Name)) {
        Write-Log "Shutting down WSL distro: $Name ..."
        wsl.exe --terminate $Name 2>$null
        Start-Sleep -Seconds 2

        Write-Log "Removing WSL distro: $Name ..."
        wsl.exe --unregister $Name
        if ($LASTEXITCODE -eq 0) {
            Write-Log "Removed: $Name"
        } else {
            Write-Log "WARNING: wsl --unregister $Name exited with code $LASTEXITCODE"
        }
        return $true
    }
    Write-Log "Distro '$Name' not found, skipping."
    return $false
}

Write-Log "Starting OpenFork engine cleanup..."

# 1. Always remove the dedicated "OpenFork" distro (custom-path installs)
Remove-WslDistro -Name "OpenFork"

# 2. Always remove "Ubuntu" distro if it was set up by OpenFork (default-path installs)
Remove-WslDistro -Name "Ubuntu"

# 3. Check electron-store config for any other managed distro name
$candidateConfigs = @(
    (Join-Path $env:APPDATA "Openfork Client\config.json"),
    (Join-Path $env:APPDATA "openfork_client\config.json")
)

$storedDistro = $null
foreach ($cfgPath in $candidateConfigs) {
    if (Test-Path $cfgPath) {
        try {
            $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
            if ($cfg.wslDistro -and $cfg.wslDistro -ne "OpenFork" -and $cfg.wslDistro -ne "Ubuntu") {
                $storedDistro = $cfg.wslDistro
            }
        } catch {}
        break
    }
}

if ($storedDistro) {
    Write-Log "Found managed distro in config: $storedDistro"
    Remove-WslDistro -Name $storedDistro
}

Write-Log "OpenFork engine cleanup complete."
