<#
.SYNOPSIS
    Automated OpenFork AI Engine Setup
    Enables WSL, installs the dedicated OpenFork distro, Docker Engine, and NVIDIA Container Toolkit.
#>

param (
    [switch]$InstallOnly,
    [string]$InstallPath,
    [string]$DistroName = "OpenFork",
    [string]$ProgressLog
)

$ErrorActionPreference = "Stop"
$VerbosePreference = "Continue"

$defaultProgressLog = "C:\Windows\Temp\openfork_install_progress.log"
$progressLog = if ([string]::IsNullOrWhiteSpace($ProgressLog)) { $defaultProgressLog } else { $ProgressLog }
try {
    $progressLogDir = Split-Path -Path $progressLog -Parent
    if ($progressLogDir -and -not (Test-Path -LiteralPath $progressLogDir)) {
        New-Item -ItemType Directory -Path $progressLogDir -Force | Out-Null
    }
    [System.IO.File]::WriteAllText($progressLog, "", [System.Text.Encoding]::UTF8)
} catch {
    $progressLog = $defaultProgressLog
    try { [System.IO.File]::WriteAllText($progressLog, "", [System.Text.Encoding]::UTF8) } catch { }
}

function Write-Log {
    param([string]$Message)
    Write-Host "[OpenFork Setup] $Message" -ForegroundColor Cyan
    $ts = Get-Date -Format "HH:mm:ss"
    try { Add-Content -Path $progressLog -Value "[$ts] $Message" -Encoding UTF8 -ErrorAction Stop } catch { }
}

function Check-IsAdmin {
    $currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-DistroVhdxPath {
    param([string]$Name)

    $registryPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss"
    $distroKey = Get-ChildItem $registryPath -ErrorAction SilentlyContinue | Where-Object {
        (Get-ItemProperty $_.PsPath).DistributionName -eq $Name
    } | Select-Object -First 1

    if (-not $distroKey) { return $null }

    $basePath = (Get-ItemProperty $distroKey.PsPath).BasePath
    if (-not $basePath) { return $null }

    return Join-Path $basePath "ext4.vhdx"
}

function Test-SparseFile {
    param([string]$Path)

    if (-not $Path -or -not (Test-Path -LiteralPath $Path)) { return $null }
    return (([System.IO.File]::GetAttributes($Path) -band [System.IO.FileAttributes]::SparseFile) -ne 0)
}

function Update-WslBestEffort {
    Write-Log "Checking for WSL updates before enabling Sparse VHD..."
    try {
        $output = & wsl.exe --update 2>&1
        $exitCode = $LASTEXITCODE
        $detail = ($output | Out-String).Trim()

        if ($exitCode -eq 0) {
            if ($detail) {
                Write-Log "WSL update completed: $detail"
            } else {
                Write-Log "WSL update completed."
            }
            return
        }

        if ($detail) {
            Write-Log "WSL update skipped or failed with code ${exitCode}: $detail"
        } else {
            Write-Log "WSL update skipped or failed with code $exitCode."
        }
    } catch {
        Write-Log "WSL update skipped or failed: $($_.Exception.Message)"
    }
}

function Enable-SparseVhd {
    param([string]$Name)

    Write-Log "Enabling Sparse VHD for automatic disk space reclamation..."
    try {
        Update-WslBestEffort
        wsl.exe --terminate $Name 2>$null
        Start-Sleep -Seconds 2

        # This requires WSL 2.0.0 or higher. Native command failures do not
        # throw in Windows PowerShell, so check $LASTEXITCODE explicitly.
        $output = & wsl.exe --manage $Name --set-sparse true 2>&1
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            $detail = ($output | Out-String).Trim()
            if ($detail -match "--allow-unsafe" -or $detail -match "Sparse VHD support is currently disabled") {
                Write-Log "WSL requires --allow-unsafe for sparse VHD conversion on this version. Retrying for the dedicated OpenFork distro..."
                $output = & wsl.exe --manage $Name --set-sparse true --allow-unsafe 2>&1
                $exitCode = $LASTEXITCODE
                if ($exitCode -eq 0) {
                    $detail = ""
                } else {
                    $detail = ($output | Out-String).Trim()
                }
            }
        }

        if ($exitCode -ne 0) {
            if ($detail) {
                throw "wsl --manage exited with code $exitCode. $detail"
            }
            throw "wsl --manage exited with code $exitCode."
        }

        $vhdxPath = Get-DistroVhdxPath -Name $Name
        $isSparse = Test-SparseFile -Path $vhdxPath
        if ($isSparse -eq $false) {
            throw "wsl --manage completed, but '$vhdxPath' is still not marked sparse."
        }

        if ($isSparse -eq $true) {
            Write-Log "Sparse VHD enabled successfully."
        } else {
            Write-Log "Sparse VHD command completed; VHDX attribute could not be verified."
        }
    } catch {
        Write-Log "Warning: Could not enable Sparse VHD: $($_.Exception.Message)"
        Write-Log "If Storage Settings still reports a non-sparse VHDX, run 'wsl --update' and then Repair OpenFork Ubuntu."
    }
}

Write-Log "Checking Windows Subsystem for Linux (WSL) status..."
$isAdmin = Check-IsAdmin
$wslFeature = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -ErrorAction SilentlyContinue
$vmpFeature = Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -ErrorAction SilentlyContinue

$requiresReboot = $false
$featuresToEnable = @()

if ($null -ne $wslFeature -and $wslFeature.State -ne "Enabled") {
    $featuresToEnable += "Microsoft-Windows-Subsystem-Linux"
}

if ($null -ne $vmpFeature -and $vmpFeature.State -ne "Enabled") {
    $featuresToEnable += "VirtualMachinePlatform"
}

if ($featuresToEnable.Count -gt 0 -and -not $isAdmin) {
    Write-Log "Administrator privileges are required to enable WSL features: $($featuresToEnable -join ', ')."
    Write-Output "ELEVATION_REQUIRED"
    Exit 1
}

if ($featuresToEnable.Count -eq 0 -and -not $isAdmin) {
    Write-Log "WSL features are already enabled. Continuing without Administrator privileges."
}

if ($featuresToEnable -contains "Microsoft-Windows-Subsystem-Linux") {
    Write-Log "Enabling WSL feature..."
    Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -NoRestart
    $requiresReboot = $true
}

if ($featuresToEnable -contains "VirtualMachinePlatform") {
    Write-Log "Enabling Virtual Machine Platform feature..."
    Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -NoRestart
    $requiresReboot = $true
}

if ($requiresReboot) {
    Write-Log "WSL features were enabled. A system reboot is required."
    Write-Output "REBOOT_REQUIRED"
    Exit 0
}

if ($null -eq $InstallPath -or $InstallPath -eq "") {
    $InstallPath = Join-Path $env:SystemDrive "OpenFork\wsl"
    Write-Log "No install path provided. Using default path: $InstallPath"
}

Write-Log "Checking for $DistroName distribution..."
try {
    $dists = (wsl -l -v | Out-String) -replace "\0", ""
    if ($dists -notmatch $DistroName) {
        Write-Log "Installing $DistroName to path: $InstallPath"
        if (-not (Test-Path $InstallPath)) {
            New-Item -ItemType Directory -Path $InstallPath -Force
        }

        $rootfsPath = Join-Path $InstallPath "ubuntu-rootfs.tar.gz"
        $rootfsUrl = "https://cloud-images.ubuntu.com/wsl/releases/24.04/current/ubuntu-noble-wsl-amd64-wsl.rootfs.tar.gz"

        Write-Log "Downloading Ubuntu rootfs (~130MB)..."

        Add-Type -AssemblyName System.Net.Http
        $httpClient = [System.Net.Http.HttpClient]::new()
        $httpClient.Timeout = [System.TimeSpan]::FromMinutes(10)

        $response = $httpClient.GetAsync($rootfsUrl, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        $response.EnsureSuccessStatusCode()

        $totalBytes = $response.Content.Headers.ContentLength
        $totalMB = if ($totalBytes) { [math]::Round($totalBytes / 1MB, 1) } else { $null }
        $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $fileStream = [System.IO.File]::Create($rootfsPath)

        $buffer = New-Object byte[] 81920
        $totalRead = 0
        $lastReportedPct = -1

        while ($true) {
            $read = $stream.Read($buffer, 0, $buffer.Length)
            if ($read -le 0) { break }
            $fileStream.Write($buffer, 0, $read)
            $totalRead += $read

            if ($totalBytes -and $totalBytes -gt 0) {
                $pct = [math]::Floor(($totalRead / $totalBytes) * 100)
                if ($pct -ge $lastReportedPct + 5 -or $pct -eq 100) {
                    $readMB = [math]::Round($totalRead / 1MB, 1)
                    Write-Log "Downloading Ubuntu rootfs... $($pct)% ($readMB MB / $totalMB MB)"
                    $lastReportedPct = $pct
                }
            }
        }

        $fileStream.Close()
        $stream.Close()
        $httpClient.Dispose()

        Write-Log "Download complete. ($([math]::Round($totalRead / 1MB, 1)) MB)"

        $leftoverVhdx = Join-Path $InstallPath "ext4.vhdx"
        if (Test-Path $leftoverVhdx) {
            Write-Log "Found leftover ext4.vhdx from previous failed install. Removing..."
            Remove-Item $leftoverVhdx -Force
        }

        Write-Log "Importing $DistroName to $InstallPath..."
        wsl --import $DistroName $InstallPath $rootfsPath --version 2

        Remove-Item $rootfsPath -Force

        Write-Log "Waiting for WSL to list $DistroName..."
        $retry = 0
        while (((wsl -l -v | Out-String) -replace "\0", "") -notmatch $DistroName) {
            if ($retry -gt 60) { throw "Timeout waiting for $DistroName install" }
            Start-Sleep -Seconds 2
            $retry++
        }

        Write-Log "Provisioning default user automatically to bypass interactive prompt..."
        $provisionScript = @"
if ! id -u openfork > /dev/null 2>&1; then
    useradd -m -s /bin/bash openfork
    echo "openfork:openfork" | chpasswd
    usermod -aG sudo openfork
    echo "openfork ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/openfork
fi
mkdir -p /etc
echo -e "[boot]\nsystemd=true\n[user]\ndefault=openfork" > /etc/wsl.conf
echo "managed-by=openfork" > /etc/openfork-managed
"@
        $provisionScript | wsl -d $DistroName --user root -e bash -c "cat > /tmp/provision.sh && bash /tmp/provision.sh"

        Write-Log "Restarting WSL to apply new default user and systemd setting..."
        wsl --terminate $DistroName
        Start-Sleep -Seconds 2
     } else {
         Write-Log "$DistroName is already installed. Ensuring OpenFork user and WSL config..."
         $repairScript = @"
set -e
if ! id -u openfork > /dev/null 2>&1; then
    useradd -m -s /bin/bash openfork
    echo "openfork:openfork" | chpasswd
    usermod -aG sudo openfork
    echo "openfork ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/openfork
fi
mkdir -p /etc
cat > /etc/wsl.conf <<'EOF'
[boot]
systemd=true
[user]
default=openfork
EOF
echo "managed-by=openfork" > /etc/openfork-managed
"@
         $repairScript | wsl -d $DistroName --user root -e bash -c "cat > /tmp/repair.sh && bash /tmp/repair.sh"

         Write-Log "Restarting WSL to apply OpenFork configuration..."
         wsl --terminate $DistroName
         Start-Sleep -Seconds 2
     }
} catch {
    Write-Log "Detailed Error: $($_.Exception.Message)"
    if ($_.ScriptStackTrace) { Write-Log "Stack: $($_.ScriptStackTrace)" }
    Write-Log "Failed to check or install $DistroName via wsl command. Make sure WSL is fully updated."
    Write-Output "ERROR: Failed to install $DistroName."
    Exit 1
}

Enable-SparseVhd -Name $DistroName

Write-Log "Ensuring WSL is running and executing setup script..."

function ConvertTo-WslPath {
    param([string]$WindowsPath)

    if ($WindowsPath -match '^([A-Za-z]):\\(.*)$') {
        $drive = $matches[1].ToLowerInvariant()
        $relativePath = $matches[2].Replace('\', '/')
        return "/mnt/$drive/$relativePath"
    }

    return "/mnt/c/Windows/Temp/openfork_install_progress.log"
}

function ConvertTo-BashSingleQuotedString {
    param([string]$Value)

    return "'" + $Value.Replace("'", "'\''") + "'"
}

$script = @'
#!/bin/bash
set -eo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

WLOG=__OPENFORK_PROGRESS_LOG__
log() {
    local ts
    ts=$(date '+%H:%M:%S')
    printf '[%s] %s\n' "$ts" "$*" >> "$WLOG" 2>/dev/null || true
}

log "[Linux] Waiting for network connectivity..."
for i in {1..15}; do
    if curl -fsSL --connect-timeout 3 https://download.docker.com -o /dev/null 2>/dev/null; then
        log "[Linux] Network is ready."
        break
    fi
    log "[Linux] Waiting for network... (attempt $i/15)"
    sleep 2
done

log "[Linux] Checking for Docker..."
if ! command -v docker &> /dev/null; then
    log "[Linux] Installing Docker Engine..."
    sudo apt-get update -qq 2>&1 | while IFS= read -r line; do log "$line"; done
    log "[Linux] Installing ca-certificates and curl..."
    sudo apt-get install -y ca-certificates curl 2>&1 | while IFS= read -r line; do log "$line"; done
    sudo install -m 0755 -d /etc/apt/keyrings
    sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    sudo chmod a+r /etc/apt/keyrings/docker.asc
    UBUNTU_CODENAME=$(. /etc/os-release && echo "$VERSION_CODENAME")
    ARCH=$(dpkg --print-architecture)
    echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME} stable" | \
        sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    sudo apt-get update -qq 2>&1 | while IFS= read -r line; do log "$line"; done
    log "[Linux] Downloading and installing Docker packages..."
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin \
        2>&1 | while IFS= read -r line; do log "$line"; done
    log "[Linux] Docker Engine installed successfully."
else
    log "[Linux] Docker is already installed."
fi

log "[Linux] Checking for NVIDIA Container Toolkit..."
if ! command -v nvidia-ctk &> /dev/null; then
    log "[Linux] Installing NVIDIA Container Toolkit..."
    curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
    curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
      sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
      sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list > /dev/null
    log "[Linux] Updating package lists for NVIDIA toolkit..."
    sudo apt-get update -qq 2>&1 | while IFS= read -r line; do log "$line"; done
    log "[Linux] Downloading and installing NVIDIA toolkit packages..."
    sudo apt-get install -y nvidia-container-toolkit 2>&1 | while IFS= read -r line; do log "$line"; done
    sudo nvidia-ctk runtime configure --runtime=docker
else
    log "[Linux] NVIDIA Container Toolkit is already installed."
fi

log "[Linux] Configuring Docker to listen on localhost-only TCP..."
sudo mkdir -p /etc/docker
echo '{"hosts": ["tcp://127.0.0.1:2375", "unix:///var/run/docker.sock"], "tls": false, "max-concurrent-uploads": 2}' | sudo tee /etc/docker/daemon.json
echo "managed-by=openfork" | sudo tee /etc/openfork-managed > /dev/null

sudo mkdir -p /etc/systemd/system/docker.service.d
echo -e "[Service]\nExecStart=\nExecStart=/usr/bin/dockerd" | sudo tee /etc/systemd/system/docker.service.d/override.conf

is_systemd_active() {
    [ "$(cat /proc/1/comm 2>/dev/null | tr -d '\r\n')" = "systemd" ]
}

start_docker_service() {
    if command -v systemctl >/dev/null 2>&1 && is_systemd_active; then
        log "[Linux] Starting Docker with systemd..."
        sudo systemctl daemon-reload
        sudo systemctl enable docker
        sudo systemctl restart docker
        return
    fi

    if command -v systemctl >/dev/null 2>&1; then
        log "[Linux] systemctl is installed, but systemd is not active yet in this WSL session."
    fi

    if command -v service >/dev/null 2>&1; then
        log "[Linux] Starting Docker with service..."
        if sudo service docker restart; then
            return
        fi
        if sudo service docker start; then
            return
        fi
    fi

    log "[Linux] Falling back to launching dockerd directly..."
    sudo mkdir -p /var/log/openfork
    if command -v pgrep >/dev/null 2>&1 && pgrep -x dockerd >/dev/null 2>&1; then
        return
    fi
    sudo nohup /usr/bin/dockerd >/var/log/openfork/dockerd.log 2>&1 &
}

start_docker_service

log "[Linux] Waiting for Docker daemon to be ready..."
sleep 2
for i in {1..15}; do
    if sudo docker info &> /dev/null; then
        log "[Linux] Docker daemon is running."
        break
    fi
    sleep 1
done

if command -v systemctl >/dev/null 2>&1 && is_systemd_active; then
    log "[Linux] Enabling periodic WSL disk trimming..."
    sudo systemctl enable fstrim.timer >/dev/null 2>&1 || true
    sudo systemctl start fstrim.timer >/dev/null 2>&1 || true
fi

log "[Linux] OpenFork AI Engine Setup Complete."

echo '{"exclude":["/**"]}' | sudo tee /pyrightconfig.json > /dev/null
'@

$wslProgressLogPath = ConvertTo-WslPath -WindowsPath $progressLog
$script = $script.Replace(
    "__OPENFORK_PROGRESS_LOG__",
    (ConvertTo-BashSingleQuotedString -Value $wslProgressLogPath)
)

Write-Log "Writing setup script to temp file..."
$tempScriptDir = Join-Path ([System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::LocalApplicationData)) "OpenFork\Temp"
if (-not (Test-Path $tempScriptDir)) {
    New-Item -ItemType Directory -Path $tempScriptDir -Force | Out-Null
}
$tempScriptPath = Join-Path $tempScriptDir "openfork_setup.sh"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($tempScriptPath, $script.Replace("`r`n", "`n"), $utf8NoBom)

$driveLetter = $tempScriptPath[0].ToString().ToLower()
$wslScriptPath = "/mnt/$driveLetter/" + $tempScriptPath.Substring(3).Replace('\', '/')

Write-Log "Running Docker setup commands inside WSL $DistroName..."
wsl -d $DistroName --user root -- bash $wslScriptPath
if ($LASTEXITCODE -ne 0) {
    Remove-Item $tempScriptPath -Force -ErrorAction SilentlyContinue
    Write-Log "ERROR: Setup script inside WSL exited with code $LASTEXITCODE"
    Write-Output "ERROR: WSL setup script failed."
    Exit 1
}

Remove-Item $tempScriptPath -Force -ErrorAction SilentlyContinue

Write-Log "Setup Complete!"
Write-Output "SUCCESS"
Exit 0
