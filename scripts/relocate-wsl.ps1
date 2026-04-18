param(
    [Parameter(Mandatory=$true)]
    [string]$DistroName,
    [Parameter(Mandatory=$true)]
    [string]$NewLocation
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
    Write-Host "Starting OpenFork engine relocation for $DistroName to $NewLocation..."

    if (-not (Test-OpenForkManagedDistro -Name $DistroName)) {
        throw "Refusing to relocate '$DistroName' because it is not recognized as an OpenFork-managed distro."
    }
    
    # 1. Ensure the new location exists
    if (-not (Test-Path $NewLocation)) {
        New-Item -ItemType Directory -Path $NewLocation -Force
    }
    
    # 2. Terminate and Unregister the old distro (This deletes all old data!)
    Write-Host "Unregistering old distribution (Cleaning up C:)..."
    wsl --terminate $DistroName
    wsl --unregister $DistroName
    
    # 3. The Electron caller re-runs setup-wsl.ps1 with -InstallPath afterwards
    # to create a fresh OpenFork distro at the new location.
    Write-Host "Triggering fresh install on the new drive..."

    Write-Host "Lite Relocation basic steps complete. Drive is now clean."
    exit 0
} catch {
    Write-Error "Error during relocation: $($_.Exception.Message)"
    exit 1
}
