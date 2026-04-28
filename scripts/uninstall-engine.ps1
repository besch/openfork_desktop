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
    try {
        $proc = Start-Process powershell -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $PSCommandPath) -Verb RunAs -Wait -PassThru
        exit ($proc.ExitCode | ForEach-Object { if ($_ -ne $null) { $_ } else { 0 } })
    } catch {
        Write-Log "Elevation was cancelled or failed."
        exit 1
    }
}

function Get-ConfigSearchPaths {
    return @(
        (Join-Path $env:LOCALAPPDATA "Openfork Client\config.json"),
        (Join-Path $env:LOCALAPPDATA "openfork_client\config.json"),
        (Join-Path $env:APPDATA "Openfork Client\config.json"),
        (Join-Path $env:APPDATA "openfork_client\config.json")
    )
}

function Get-WslDistros {
    try {
        return @(
            ((wsl.exe --list --quiet 2>$null | Out-String) -replace "\0", "") `
                -split "\r?\n" |
                ForEach-Object { $_.Trim() } |
                Where-Object { $_ }
        )
    } catch {
        return @()
    }
}

function Test-OpenForkManagedDistro {
    param([string]$Name)

    try {
        $probe = wsl.exe -d $Name --user root -- bash -lc @'
if [ -f /etc/openfork-managed ]; then
  echo managed
elif id -u openfork >/dev/null 2>&1 \
  && [ -f /etc/sudoers.d/openfork ] \
  && grep -q "default=openfork" /etc/wsl.conf 2>/dev/null \
  && grep -q "tcp://0.0.0.0:2375" /etc/docker/daemon.json 2>/dev/null; then
  echo legacy-managed
else
  echo unmanaged
fi
'@
        $probe = ($probe | Out-String).Trim()
        return ($LASTEXITCODE -eq 0) -and ($probe -in @("managed", "legacy-managed"))
    } catch {
        return $false
    }
}

function Remove-WslDistro {
    param([string]$Name)
    $dists = Get-WslDistros
    if ($dists -contains $Name) {
        Write-Log "Shutting down WSL distro: $Name ..."
        wsl.exe --terminate $Name 2>$null
        Start-Sleep -Seconds 2

        Write-Log "Removing WSL distro: $Name ..."
        wsl.exe --unregister $Name
        if ($LASTEXITCODE -eq 0) {
            Write-Log "Removed: $Name"
            return $true
        } else {
            Write-Log "WARNING: wsl --unregister $Name exited with code $LASTEXITCODE"
            return $false
        }
    }
    Write-Log "Distro '$Name' not found, skipping."
    return $false
}

function Get-OpenForkManagedDistroNames {
    $names = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $null = $names.Add("OpenFork")

    $candidateConfigs = Get-ConfigSearchPaths

    foreach ($cfgPath in $candidateConfigs) {
        if (-not (Test-Path $cfgPath)) {
            continue
        }

        try {
            $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
            if ($cfg.wslDistro -and [string]$cfg.wslDistro -ieq "OpenFork") {
                $null = $names.Add([string]$cfg.wslDistro)
            }
        } catch {}
    }

    return @($names)
}

function Get-LxssEntries {
    $entries = @()
    try {
        $lxssPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss"
        if (Test-Path $lxssPath) {
            $entries = @(Get-ChildItem -Path $lxssPath -ErrorAction SilentlyContinue)
        }
    } catch {}
    return $entries
}

function Test-RegistryEntryOwnedByOpenFork {
    param(
        [string]$DistroName,
        [string[]]$ManagedDistroNames,
        [string]$BasePath
    )

    if ($ManagedDistroNames -contains $DistroName) {
        return $true
    }

    if ($BasePath -and $BasePath -match '(?i)\\OpenFork(\\|$)') {
        return $true
    }

    return $false
}

Write-Log "Starting OpenFork engine cleanup..."

# 1. Remove only the dedicated OpenFork distro.
$managedDistroNames = Get-OpenForkManagedDistroNames
$attempted = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$currentDistros = Get-WslDistros
$lxssEntries = Get-LxssEntries

foreach ($entry in $lxssEntries) {
    $distroName = $entry.GetValue("DistributionName", $null)
    if ($distroName) {
        $null = $managedDistroNames += @($distroName)
    }
}
$managedDistroNames = @($managedDistroNames | Where-Object { $_ } | Select-Object -Unique)

foreach ($distroName in $managedDistroNames) {
    if (-not $distroName) {
        continue
    }
    if ($attempted.Contains($distroName)) {
        continue
    }
    $null = $attempted.Add($distroName)

    if ($currentDistros -notcontains $distroName) {
        continue
    }

    if ($distroName -ieq "OpenFork") {
        $removed = Remove-WslDistro -Name $distroName
        if ($removed) {
            $currentDistros = Get-WslDistros
        }
    }
}

# 2. Clean up orphaned registry entries from Lxss
Write-Log "Cleaning up WSL registry entries..."
try {
    $lxssPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss"
    $managedDistroNames = Get-OpenForkManagedDistroNames
    $existingDistros = Get-WslDistros
    if (Test-Path $lxssPath) {
        Get-ChildItem -Path $lxssPath -ErrorAction SilentlyContinue | ForEach-Object {
            $distroName = $_.GetValue("DistributionName", $null)
            $basePath = $_.GetValue("BasePath", $null)
            if ($distroName) {
                $ownedByOpenFork = Test-RegistryEntryOwnedByOpenFork -DistroName $distroName -ManagedDistroNames $managedDistroNames -BasePath $basePath
                if ($ownedByOpenFork -and $existingDistros -notcontains $distroName) {
                    Write-Log "Removing orphaned registry entry for: $distroName"
                    Remove-Item -Path $_.PSPath -Force -ErrorAction SilentlyContinue
                }
            }
        }
        Write-Log "Registry cleanup complete."
    }
} catch {
    Write-Log "Registry cleanup skipped (may require additional permissions)"
}

# 3. Remove OpenFork installation directory if it exists and is empty
$openForkPath = "C:\OpenFork"
if (Test-Path $openForkPath) {
    try {
        $items = Get-ChildItem -Path $openForkPath -Recurse -ErrorAction SilentlyContinue | Measure-Object
        if ($items.Count -eq 0 -or $null -eq $items.Count) {
            Write-Log "Removing empty OpenFork directory: $openForkPath"
            Remove-Item -Path $openForkPath -Force -Recurse -ErrorAction SilentlyContinue
            Write-Log "OpenFork directory removed."
        } else {
            Write-Log "OpenFork directory not empty. Leaving it for manual cleanup if desired."
        }
    } catch {
        Write-Log "Could not remove OpenFork directory (may be in use)"
    }
}

Write-Log "OpenFork engine cleanup complete."
