param(
    [Parameter(Mandatory=$true)]
    [string]$DistroName
)

try {
    Write-Host "Reclaiming disk space for WSL distribution: $DistroName..."
    
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
    
    # 2. Shutdown WSL to release the file
    Write-Host "Shutting down WSL..."
    wsl --terminate $DistroName
    wsl --shutdown
    Start-Sleep -Seconds 2
    
    # 3. Create diskpart script
    $tempFile = New-TemporaryFile
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
    
    Remove-Item $tempFile -Force
    
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
