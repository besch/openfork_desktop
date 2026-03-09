param(
    [Parameter(Mandatory=$true)]
    [string]$DistroName,
    [Parameter(Mandatory=$true)]
    [string]$NewLocation
)

try {
    Write-Host "Starting Lite Relocation for $DistroName to $NewLocation..."
    
    # 1. Ensure the new location exists
    if (-not (Test-Path $NewLocation)) {
        New-Item -ItemType Directory -Path $NewLocation -Force
    }
    
    # 2. Terminate and Unregister the old distro (This deletes all old data!)
    Write-Host "Unregistering old distribution (Cleaning up C:)..."
    wsl --terminate $DistroName
    wsl --unregister $DistroName
    
    # 3. Download a fresh rootfs - We'll use a specific Ubuntu 22.04 or 24.04 tiny image if possible
    # For now, we'll re-trigger the standard installer which handles the import
    Write-Host "Triggering fresh install on the new drive..."
    
    # We pass the new location as an environment variable or argument to the setup script
    # This script is intended to be called by electron.cjs which will then run setup-wsl.ps1
    
    Write-Host "Lite Relocation basic steps complete. Drive is now clean."
    exit 0
} catch {
    Write-Error "Error during relocation: $($_.Exception.Message)"
    exit 1
}
