#!/bin/bash
#
# OpenFork AI Engine Uninstall
# Removes only OpenFork-managed markers and overrides.
# Called automatically by DEB postuninstall or manually by user.
# Keeps the host Docker and NVIDIA stack intact.
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${CYAN}[OpenFork Uninstall]${NC} $1"
}

log_warn() {
    echo -e "${RED}[OpenFork Uninstall WARNING]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[OpenFork Uninstall]${NC} $1"
}

# Ensure running as root
if [ "$(id -u)" -ne 0 ]; then
    log_info "Requesting root privileges..."
    exec sudo "$0" "$@"
fi

# Determine the actual username of the user running the app
REAL_USER="${SUDO_USER:-$(logname 2>/dev/null || echo "$USER")}"
if [ "$REAL_USER" = "root" ] || [ -z "$REAL_USER" ]; then
    REAL_USER="$(who am i 2>/dev/null | awk '{print $1}' || echo '')"
fi

if [ -z "$REAL_USER" ]; then
    log_warn "Could not determine the user who installed OpenFork. Skipping docker group cleanup."
    REAL_USER=""
fi

# Safety gate: Check if this is an OpenFork-managed system
test_openfork_managed() {
    if [ -f /etc/openfork-managed ]; then
        return 0
    fi

    # Fallback: Check for OpenFork-specific systemd override.
    if [ -f /etc/systemd/system/docker.service.d/openfork-override.conf ] 2>/dev/null; then
        return 0
    fi

    return 1
}

log_info "Starting OpenFork engine cleanup..."

# Safety check: Only proceed if this is an OpenFork-managed system
if ! test_openfork_managed; then
    log_warn "System does not appear to be OpenFork-managed (no /etc/openfork-managed marker found)."
    log_warn "Skipping cleanup to avoid touching the user's own Docker/NVIDIA installation."
    exit 0
fi

log_info "Leaving Docker Engine, Docker data, and NVIDIA packages untouched."

# Remove OpenFork-specific configuration files and markers
log_info "Cleaning up OpenFork markers and configuration..."
rm -f /etc/openfork-managed
rm -f /etc/openfork-setup-log

# Clean up Docker systemd overrides if they exist
if [ -d /etc/systemd/system/docker.service.d ]; then
    rm -f /etc/systemd/system/docker.service.d/openfork-override.conf
    rmdir /etc/systemd/system/docker.service.d 2>/dev/null || true
    systemctl daemon-reload 2>/dev/null || true
fi

# Disable fstrim if it was enabled by OpenFork
if command -v systemctl >/dev/null 2>&1; then
    # Note: We keep fstrim enabled since it's beneficial for all users
    # systemctl disable fstrim.timer >/dev/null 2>&1 || true
    # systemctl stop fstrim.timer >/dev/null 2>&1 || true
    true
fi

log_success "OpenFork engine cleanup complete."
log_info "Docker Engine, Docker data, and NVIDIA packages were preserved."
