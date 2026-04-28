#!/bin/bash
#
# DEB postuninstall script for OpenFork Client
# Called by dpkg after package removal
# Cleans up only OpenFork-managed markers and overrides.
# Keeps the host Docker and NVIDIA stack intact.
#

# Never fail the package removal because of cleanup.
set +e

log() {
    echo "[OpenFork postuninstall] $1"
}

is_openfork_managed() {
    [ -f /etc/openfork-managed ] && return 0
    [ -f /etc/systemd/system/docker.service.d/openfork-override.conf ] && return 0
    return 1
}

cleanup_openfork_engine() {
    log "Leaving Docker Engine, Docker data, and NVIDIA packages untouched."

    log "Removing OpenFork markers and overrides..."
    rm -f /etc/openfork-managed
    rm -f /etc/openfork-setup-log
    rm -f /etc/systemd/system/docker.service.d/openfork-override.conf
    rmdir /etc/systemd/system/docker.service.d >/dev/null 2>&1 || true

    if command -v systemctl >/dev/null 2>&1; then
        systemctl daemon-reload >/dev/null 2>&1 || true
    fi
}

if ! is_openfork_managed; then
    log "System is not marked as OpenFork-managed; skipping engine cleanup."
    exit 0
fi

log "Cleaning up OpenFork AI Engine..."
cleanup_openfork_engine

exit 0
