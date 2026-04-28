<#
.SYNOPSIS
    OpenFork AI Engine Cleanup
    Removes the WSL distro(s) managed by OpenFork and all associated Docker data.
    Called automatically by the NSIS uninstaller when the user opts in.
#>

param(
    [string]$ElevatedDistroName
)

$ErrorActionPreference = "Continue"
$script:CleanupFailed = $false

function Write-Log {
    param([string]$Message)
    Write-Host "[OpenFork Uninstall] $Message" -ForegroundColor Cyan
}

function Test-IsAdmin {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
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

function Resolve-WslDistroName {
    param(
        [string]$Name,
        [string[]]$Distros = (Get-WslDistros)
    )

    if (-not $Name) {
        return $null
    }

    $matches = @($Distros | Where-Object { $_ -ieq $Name } | Select-Object -First 1)
    if ($matches.Count -gt 0) {
        return $matches[0]
    }

    return $null
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
    $actualName = Resolve-WslDistroName -Name $Name -Distros $dists
    if ($actualName) {
        Write-Log "Shutting down WSL distro: $actualName ..."
        wsl.exe --terminate $actualName 2>$null
        Start-Sleep -Seconds 2

        Write-Log "Removing WSL distro: $actualName ..."
        wsl.exe --unregister $actualName
        if ($LASTEXITCODE -eq 0) {
            Write-Log "Removed: $actualName"
            return $true
        } else {
            Write-Log "WARNING: wsl --unregister $actualName exited with code $LASTEXITCODE"
            return $false
        }
    }
    Write-Log "Distro '$Name' not found, skipping."
    return $false
}

function Invoke-ElevatedDistroRemoval {
    param([string]$Name)

    $scriptPath = if ($PSCommandPath) { $PSCommandPath } else { $MyInvocation.MyCommand.Path }
    if (-not $scriptPath) {
        Write-Log "WARNING: Could not determine cleanup script path for elevated retry."
        return $false
    }

    Write-Log "Retrying WSL distro removal with administrator privileges..."
    try {
        $proc = Start-Process powershell.exe `
            -ArgumentList @(
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                "`"$scriptPath`"",
                "-ElevatedDistroName",
                "`"$Name`""
            ) `
            -Verb RunAs `
            -WindowStyle Hidden `
            -Wait `
            -PassThru
        return ($proc.ExitCode -eq 0)
    } catch {
        Write-Log "Elevated retry was cancelled or failed."
        return $false
    }
}

function Add-DistroCandidate {
    param(
        [System.Collections.Generic.List[string]]$Candidates,
        [string]$Name
    )

    if ($Name -and -not ($Candidates -contains $Name)) {
        $Candidates.Add($Name) | Out-Null
    }
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

if ($ElevatedDistroName) {
    Write-Log "Starting elevated OpenFork distro cleanup retry..."
    if (Remove-WslDistro -Name $ElevatedDistroName) {
        exit 0
    }
    exit 1
}

Write-Log "Starting OpenFork engine cleanup..."

# 1. Remove only the dedicated OpenFork distro.
$managedDistroNames = Get-OpenForkManagedDistroNames
$attempted = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$currentDistros = Get-WslDistros
$lxssEntries = Get-LxssEntries
$candidateDistroNames = [System.Collections.Generic.List[string]]::new()

foreach ($distroName in $managedDistroNames) {
    Add-DistroCandidate -Candidates $candidateDistroNames -Name $distroName
}

foreach ($distroName in $currentDistros) {
    if ($distroName -ieq "OpenFork") {
        Add-DistroCandidate -Candidates $candidateDistroNames -Name $distroName
    }
}

foreach ($entry in $lxssEntries) {
    $distroName = $entry.GetValue("DistributionName", $null)
    $basePath = $entry.GetValue("BasePath", $null)
    if ($distroName -and (Test-RegistryEntryOwnedByOpenFork -DistroName $distroName -ManagedDistroNames $managedDistroNames -BasePath $basePath)) {
        Add-DistroCandidate -Candidates $candidateDistroNames -Name $distroName
    }
}

foreach ($distroName in $candidateDistroNames) {
    if (-not $distroName) {
        continue
    }

    $actualName = Resolve-WslDistroName -Name $distroName -Distros $currentDistros
    if (-not $actualName) {
        continue
    }

    if ($attempted.Contains($actualName)) {
        continue
    }
    $null = $attempted.Add($actualName)

    if ($actualName -ieq "OpenFork") {
        $removed = Remove-WslDistro -Name $actualName
        if (-not $removed -and -not (Test-IsAdmin)) {
            $currentDistros = Get-WslDistros
            if (Resolve-WslDistroName -Name $actualName -Distros $currentDistros) {
                $removed = Invoke-ElevatedDistroRemoval -Name $actualName
            }
        }

        if ($removed) {
            $currentDistros = Get-WslDistros
        } else {
            $script:CleanupFailed = $true
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

if (@(Get-WslDistros | Where-Object { $_ -ieq "OpenFork" }).Count -gt 0) {
    Write-Log "WARNING: OpenFork WSL distro is still registered."
    $script:CleanupFailed = $true
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
if ($script:CleanupFailed) {
    exit 1
}

exit 0
