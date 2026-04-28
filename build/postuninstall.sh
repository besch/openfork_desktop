#!/bin/bash
#
# DEB postuninstall script for OpenFork Client
# Called by dpkg after package removal
# Handles cleanup of Docker, NVIDIA Container Toolkit, and OpenFork markers
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

detect_package_manager() {
    if command -v apt-get >/dev/null 2>&1; then
        echo "apt"
    elif command -v dnf >/dev/null 2>&1; then
        echo "dnf"
    elif command -v yum >/dev/null 2>&1; then
        echo "yum"
    elif command -v zypper >/dev/null 2>&1; then
        echo "zypper"
    else
        echo ""
    fi
}

remove_packages() {
    local pm="$1"
    shift
    case "$pm" in
        apt)
            apt-get remove -y "$@" >/dev/null 2>&1 || true
            ;;
        dnf)
            dnf remove -y "$@" >/dev/null 2>&1 || true
            ;;
        yum)
            yum remove -y "$@" >/dev/null 2>&1 || true
            ;;
        zypper)
            zypper --non-interactive remove "$@" >/dev/null 2>&1 || true
            ;;
    esac
}

cleanup_openfork_engine() {
    local pm
    pm="$(detect_package_manager)"

    if [ -n "$pm" ]; then
        log "Removing NVIDIA Container Toolkit packages..."
        case "$pm" in
            apt)
                remove_packages "$pm" nvidia-container-toolkit nvidia-container-toolkit-base libnvidia-container-tools libnvidia-container1
                rm -f /etc/apt/sources.list.d/nvidia-container-toolkit.list
                rm -f /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
                apt-get update >/dev/null 2>&1 || true
                ;;
            dnf|yum)
                remove_packages "$pm" nvidia-container-toolkit libnvidia-container-tools libnvidia-container1
                rm -f /etc/yum.repos.d/nvidia-container-toolkit.repo
                ;;
            zypper)
                remove_packages "$pm" nvidia-container-toolkit
                ;;
        esac

        log "Removing Docker packages..."
        case "$pm" in
            apt)
                remove_packages "$pm" docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin docker.io docker-compose
                apt-get autoremove -y >/dev/null 2>&1 || true
                ;;
            dnf|yum)
                remove_packages "$pm" docker docker-ce docker-ce-cli docker-engine containerd.io docker-buildx-plugin docker-compose-plugin
                ;;
            zypper)
                remove_packages "$pm" docker docker-compose
                ;;
        esac
    else
        log "No supported package manager detected; skipping package removal."
    fi

    log "Removing OpenFork markers and overrides..."
    rm -f /etc/openfork-managed
    rm -f /etc/openfork-setup-log
    rm -f /etc/systemd/system/docker.service.d/openfork-override.conf
    rmdir /etc/systemd/system/docker.service.d >/dev/null 2>&1 || true

    if command -v systemctl >/dev/null 2>&1; then
        systemctl daemon-reload >/dev/null 2>&1 || true
    fi

    # OpenFork manages the full engine install, so remove its Docker data too.
    rm -rf /var/lib/docker >/dev/null 2>&1 || true
    rm -rf /var/lib/containerd >/dev/null 2>&1 || true
}

if ! is_openfork_managed; then
    log "System is not marked as OpenFork-managed; skipping engine cleanup."
    exit 0
fi

log "Cleaning up OpenFork AI Engine..."
cleanup_openfork_engine

exit 0
