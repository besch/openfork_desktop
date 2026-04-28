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

function Get-OpenForkManagedDistroNames {
    $names = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $null = $names.Add("OpenFork")
    $null = $names.Add("Ubuntu")

    $candidateConfigs = @(
        (Join-Path $env:APPDATA "Openfork Client\config.json"),
        (Join-Path $env:APPDATA "openfork_client\config.json")
    )

    foreach ($cfgPath in $candidateConfigs) {
        if (-not (Test-Path $cfgPath)) {
            continue
        }

        try {
            $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
            if ($cfg.wslDistro) {
                $null = $names.Add([string]$cfg.wslDistro)
            }
        } catch {}
    }

    return @($names)
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

# 1. Remove the dedicated OpenFork distro.
Remove-WslDistro -Name "OpenFork"

# 2. Remove a legacy Ubuntu-based install only if it has OpenFork markers.
$ubuntuExists = ((wsl.exe -l -v 2>$null | Out-String) -replace "\0", "") -match '(^|\s)Ubuntu(\s|$)'
if ($ubuntuExists) {
    if (Test-OpenForkManagedDistro -Name "Ubuntu") {
        Write-Log "Legacy OpenFork-managed Ubuntu distro detected."
        Remove-WslDistro -Name "Ubuntu"
    } else {
        Write-Log "Ubuntu exists but is not recognized as OpenFork-managed. Leaving it untouched."
    }
}

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
    if (Test-OpenForkManagedDistro -Name $storedDistro) {
        Write-Log "Found OpenFork-managed distro in config: $storedDistro"
        Remove-WslDistro -Name $storedDistro
    } else {
        Write-Log "Stored distro '$storedDistro' is not recognized as OpenFork-managed. Leaving it untouched."
    }
}

# 4. Clean up orphaned registry entries from Lxss
Write-Log "Cleaning up WSL registry entries..."
try {
    $lxssPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss"
    $managedDistroNames = Get-OpenForkManagedDistroNames
    $existingDists = (wsl.exe -l -v 2>$null | Out-String) -replace "\0", ""
    if (Test-Path $lxssPath) {
        Get-ChildItem -Path $lxssPath -ErrorAction SilentlyContinue | ForEach-Object {
            $distroName = $_.GetValue("DistributionName", $null)
            $basePath = $_.GetValue("BasePath", $null)
            if ($distroName) {
                $ownedByOpenFork = Test-RegistryEntryOwnedByOpenFork -DistroName $distroName -ManagedDistroNames $managedDistroNames -BasePath $basePath
                if ($ownedByOpenFork -and $existingDists -notmatch [regex]::Escape($distroName)) {
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

# 5. Remove OpenFork installation directory if it exists and is empty
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
