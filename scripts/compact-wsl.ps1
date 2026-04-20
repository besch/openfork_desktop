param(
    [Parameter(Mandatory=$true)]
    [string]$DistroName
)

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

try {
    Write-Host "Reclaiming disk space for WSL distribution: $DistroName..."

    if (-not (Test-OpenForkManagedDistro -Name $DistroName)) {
        throw "Refusing to compact '$DistroName' because it is not recognized as an OpenFork-managed distro."
    }
    
    # 1. Get the VHDX path from registry
    $registryPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss"
    $distroKey = Get-ChildItem $registryPath | Where-Object { 
        (Get-ItemProperty $_.PsPath).DistributionName -eq $DistroName 
    }
    
    if (-not $distroKey) {
        throw "Could not find registry entry for distribution $DistroName"
    }
    
    $vhdxPath = Join-Path (Get-ItemProperty $distroKey.PsPath).BasePath "ext4.vhdx"
    
    if (-not (Test-Path $vhdxPath)) {
        throw "VHDX file not found at $vhdxPath"
    }
    
    Write-Host "Found VHDX at: $vhdxPath"

    # Trim free blocks inside the Linux filesystem first so the subsequent VHDX
    # compaction has more reclaimable space to work with.
    Write-Host "Trimming free space inside WSL..."
    try {
        wsl.exe -d $DistroName --user root -- bash -lc "sync && (command -v fstrim >/dev/null 2>&1 && fstrim -av || true)" | Out-Null
    } catch {
        Write-Host "WSL trim skipped: $($_.Exception.Message)"
    }
    
    # 2. Shutdown WSL to release the file
    Write-Host "Shutting down WSL..."
    wsl --terminate $DistroName
    wsl --shutdown
    Start-Sleep -Seconds 2
    
    # 3. Create diskpart script
    $tempFile = New-TemporaryFile
    try {
        $diskpartScript = @"
select vdisk file="$vhdxPath"
attach vdisk readonly
compact vdisk
detach vdisk
exit
"@
        $diskpartScript | Out-File -FilePath $tempFile -Encoding ascii
    
        # 4. Run diskpart as admin
        Write-Host "Running diskpart compaction..."
        $process = Start-Process diskpart -ArgumentList "/s `"$($tempFile.FullName)`"" -Verb RunAs -Wait -PassThru
    } finally {
        Remove-Item $tempFile -Force -ErrorAction SilentlyContinue
    }

    if ($process.ExitCode -eq 0) {
        Write-Host "Successfully reclaimed disk space."
        exit 0
    } else {
        Write-Host "Diskpart failed with exit code $($process.ExitCode)"
        exit 1
    }
} catch {
    Write-Error "Error during compaction: $($_.Exception.Message)"
    exit 1
}
