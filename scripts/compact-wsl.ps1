param(
    [Parameter(Mandatory=$true)]
    [string]$DistroName
)

$ErrorActionPreference = "Stop"

function Invoke-WslRootCommand {
    param([string]$Name, [string[]]$Command)
    try {
        $null = & wsl.exe -d $Name --user root -- @Command 2>$null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

function Test-OpenForkManagedDistro {
    param([string]$Name)
    if (Invoke-WslRootCommand -Name $Name -Command @("test", "-f", "/etc/openfork-managed")) {
        return $true
    }

    $hasOpenForkUser = Invoke-WslRootCommand -Name $Name -Command @("id", "-u", "openfork")
    $hasOpenForkSudoers = Invoke-WslRootCommand -Name $Name -Command @("test", "-f", "/etc/sudoers.d/openfork")
    $hasOpenForkDefaultUser = Invoke-WslRootCommand -Name $Name -Command @("grep", "-q", "default=openfork", "/etc/wsl.conf")
    $hasDockerTcpBinding =
        (Invoke-WslRootCommand -Name $Name -Command @("grep", "-Fq", "tcp://0.0.0.0:2375", "/etc/docker/daemon.json")) -or
        (Invoke-WslRootCommand -Name $Name -Command @("grep", "-Fq", "tcp://127.0.0.1:2375", "/etc/docker/daemon.json"))

    return $hasOpenForkUser -and $hasOpenForkSudoers -and $hasOpenForkDefaultUser -and $hasDockerTcpBinding
}

function Test-FileExclusiveAccess {
    param([string]$Path)
    $stream = $null
    try {
        $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
        return $true
    } catch {
        return $false
    } finally {
        if ($null -ne $stream) { $stream.Dispose() }
    }
}

function Wait-ForVhdxReady {
    param([string]$Name, [string]$Path, [int]$TimeoutSeconds = 45)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if ((Test-Path $Path) -and (Test-FileExclusiveAccess -Path $Path)) { return }
        Start-Sleep -Milliseconds 750
    }
    throw "Timed out waiting for exclusive access to '$Path'. Another WSL or OpenFork process is still using the distro disk."
}

function Get-DiskPartFailureSummary {
    param([string]$Output)
    $lines = @(($Output -split "`r?`n") | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if (-not $lines) { return $null }
    $patterns = @(
        "DiskPart has encountered an error", "Virtual Disk Service error",
        "The process cannot access the file", "The device is not ready",
        "Access is denied", "The system cannot find the file specified",
        "The requested operation requires elevation"
    )
    foreach ($pattern in $patterns) {
        $match = $lines | Where-Object { $_ -like "*$pattern*" } | Select-Object -Last 1
        if ($match) { return $match }
    }
    return ($lines | Select-Object -Last 3) -join " "
}

function Invoke-ElevatedDiskPart {
    param([string]$ScriptPath)
    $guid = [Guid]::NewGuid().ToString("N")
    $logPath = Join-Path ([System.IO.Path]::GetTempPath()) "openfork-compact-$guid.log"
    try {
        $cmd = "`$ErrorActionPreference = 'Stop'; & diskpart.exe /s '$($ScriptPath.Replace("'","''"))' *> '$($logPath.Replace("'","''"))'; exit `$LASTEXITCODE"
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cmd))
        $process = Start-Process powershell.exe `
            -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encoded) `
            -Verb RunAs -WindowStyle Hidden -Wait -PassThru
        $output = if (Test-Path $logPath) { (Get-Content -Path $logPath -Raw).Trim() } else { "" }
        return @{ ExitCode = $process.ExitCode; Output = $output }
    } finally {
        Remove-Item $logPath -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-BestEffortVhdxDetach {
    param([string]$Path)
    $f = New-TemporaryFile
    try {
        "select vdisk file=`"$Path`"`ndetach vdisk`nexit" | Out-File -FilePath $f -Encoding ascii
        $r = Invoke-ElevatedDiskPart -ScriptPath $f.FullName
        if ($r.ExitCode -ne 0) { Write-Host "Best-effort VHDX detach did not complete cleanly." }
    } catch {
        Write-Host "Best-effort VHDX detach skipped: $($_.Exception.Message)"
    } finally {
        Remove-Item $f -Force -ErrorAction SilentlyContinue
    }
}

try {
    Write-Host "Reclaiming disk space for WSL distribution: $DistroName..."

    if (-not (Test-OpenForkManagedDistro -Name $DistroName)) {
        throw "Refusing to compact '$DistroName' because it is not recognized as an OpenFork-managed distro."
    }

    $registryPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss"
    $distroKey = Get-ChildItem $registryPath | Where-Object {
        (Get-ItemProperty $_.PsPath).DistributionName -eq $DistroName
    }
    if (-not $distroKey) { throw "Could not find registry entry for distribution $DistroName" }

    $vhdxPath = Join-Path (Get-ItemProperty $distroKey.PsPath).BasePath "ext4.vhdx"
    if (-not (Test-Path $vhdxPath)) { throw "VHDX file not found at $vhdxPath" }
    Write-Host "Found VHDX at: $vhdxPath"

    $isSparse = ([System.IO.File]::GetAttributes($vhdxPath) -band [System.IO.FileAttributes]::SparseFile) -ne 0

    Write-Host "Trimming free space inside WSL..."
    try {
        wsl.exe -d $DistroName --user root -- bash -lc "sync && (command -v fstrim >/dev/null 2>&1 && fstrim -av || true)"
    } catch {
        Write-Host "WSL trim skipped: $($_.Exception.Message)"
    }

    Write-Host "Shutting down WSL..."
    wsl --terminate $DistroName
    wsl --shutdown
    Start-Sleep -Seconds 2
    Write-Host "Waiting for the VHDX to be released..."
    Wait-ForVhdxReady -Name $DistroName -Path $vhdxPath

    if ($isSparse) {
        Write-Host "Sparse VHDX - space already reclaimed by fstrim. Skipping DiskPart."
        Write-Host "Successfully reclaimed disk space."
        exit 0
    }

    $tempFile = New-TemporaryFile
    try {
        @"
select vdisk file="$vhdxPath"
attach vdisk readonly
compact vdisk
detach vdisk
exit
"@ | Out-File -FilePath $tempFile -Encoding ascii
        Write-Host "Running diskpart compaction (non-sparse VHDX - this may take several minutes)..."
        $diskpartResult = Invoke-ElevatedDiskPart -ScriptPath $tempFile.FullName
    } finally {
        Remove-Item $tempFile -Force -ErrorAction SilentlyContinue
    }

    if ($diskpartResult.ExitCode -ne 0) {
        Invoke-BestEffortVhdxDetach -Path $vhdxPath
        $detail = Get-DiskPartFailureSummary -Output $diskpartResult.Output
        if ($detail) { throw "DiskPart failed with exit code $($diskpartResult.ExitCode). $detail" }
        throw "DiskPart failed with exit code $($diskpartResult.ExitCode)."
    }

    Write-Host "Successfully reclaimed disk space."
    exit 0
} catch {
    [Console]::Error.WriteLine("Error during compaction: $($_.Exception.Message)")
    exit 1
}
