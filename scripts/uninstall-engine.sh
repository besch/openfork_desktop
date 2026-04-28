#!/bin/bash
#
# OpenFork AI Engine Uninstall
# Removes OpenFork Docker images and OpenFork-managed markers/overrides.
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
DOCKER_RUN_AS_USER=0

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

run_docker_as_user() {
    local quoted_args="" arg

    [ -n "$REAL_USER" ] || return 1
    [ "$REAL_USER" != "root" ] || return 1

    for arg in "$@"; do
        quoted_args="$quoted_args $(printf '%q' "$arg")"
    done

    su - "$REAL_USER" -c "docker$quoted_args"
}

docker_cmd() {
    if [ "${DOCKER_RUN_AS_USER:-0}" = "1" ]; then
        run_docker_as_user "$@"
    else
        docker "$@"
    fi
}

ensure_docker_available() {
    if ! command -v docker >/dev/null 2>&1; then
        log_info "Docker CLI not found; skipping OpenFork Docker image cleanup."
        return 1
    fi

    if docker info >/dev/null 2>&1; then
        DOCKER_RUN_AS_USER=0
        return 0
    fi

    if run_docker_as_user info >/dev/null 2>&1; then
        DOCKER_RUN_AS_USER=1
        return 0
    fi

    log_info "Docker daemon is not reachable; attempting to start it for cleanup..."
    if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q '^docker\.service'; then
        systemctl start docker >/dev/null 2>&1 || true
    elif command -v service >/dev/null 2>&1; then
        service docker start >/dev/null 2>&1 || true
    fi

    for _ in $(seq 1 10); do
        if docker info >/dev/null 2>&1; then
            DOCKER_RUN_AS_USER=0
            return 0
        fi
        if run_docker_as_user info >/dev/null 2>&1; then
            DOCKER_RUN_AS_USER=1
            return 0
        fi
        sleep 1
    done

    log_warn "Docker daemon is still not reachable; skipping OpenFork Docker image cleanup."
    return 1
}

remove_container_ids() {
    local container_ids="$1"
    local container_id

    [ -n "$container_ids" ] || return 0

    while IFS= read -r container_id; do
        [ -n "$container_id" ] || continue
        log_info "Removing OpenFork Docker container: $container_id"
        docker_cmd rm -f "$container_id" >/dev/null 2>&1 || true
    done <<EOF
$container_ids
EOF
}

collect_openfork_image_ids() {
    local output_file="$1"
    local image_id image_ref image_ref_lower

    : > "$output_file"

    docker_cmd images --format '{{.ID}} {{.Repository}}:{{.Tag}}' 2>/dev/null |
        while read -r image_id image_ref; do
            [ -n "$image_id" ] || continue
            image_ref_lower=$(printf '%s' "$image_ref" | tr '[:upper:]' '[:lower:]')
            case "$image_ref_lower" in
                *openfork*)
                    grep -qx "$image_id" "$output_file" 2>/dev/null || printf '%s\n' "$image_id" >> "$output_file"
                    ;;
            esac
        done
}

cleanup_openfork_docker_images() {
    local image_ids_file image_id dependent_containers removed_count

    if ! ensure_docker_available; then
        return 0
    fi

    log_info "Removing OpenFork Docker containers and images..."
    remove_container_ids "$(docker_cmd ps -a -q --filter 'name=dgn-client' 2>/dev/null || true)"

    image_ids_file=$(mktemp)
    collect_openfork_image_ids "$image_ids_file"
    removed_count=0

    while IFS= read -r image_id; do
        [ -n "$image_id" ] || continue

        dependent_containers=$(docker_cmd ps -a -q --filter "ancestor=$image_id" 2>/dev/null || true)
        remove_container_ids "$dependent_containers"

        log_info "Removing OpenFork Docker image: $image_id"
        if docker_cmd rmi -f "$image_id" >/dev/null 2>&1; then
            removed_count=$((removed_count + 1))
        else
            log_warn "Could not remove Docker image $image_id; it may already be gone or shared by another tag."
        fi
    done < "$image_ids_file"

    rm -f "$image_ids_file"
    log_success "OpenFork Docker image cleanup complete. Removed $removed_count image(s)."
}

log_info "Starting OpenFork engine cleanup..."

# Safety check: Only proceed if this is an OpenFork-managed system
if ! test_openfork_managed; then
    log_warn "System does not appear to be OpenFork-managed (no /etc/openfork-managed marker found)."
    log_warn "Skipping cleanup to avoid touching the user's own Docker/NVIDIA installation."
    exit 0
fi

cleanup_openfork_docker_images

log_info "Leaving Docker Engine, non-OpenFork Docker data, and NVIDIA packages untouched."

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
log_info "Docker Engine, non-OpenFork Docker data, and NVIDIA packages were preserved."
