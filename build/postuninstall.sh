#!/bin/bash
#
# DEB postuninstall script for OpenFork Client
# Called by dpkg after package removal
# Removes OpenFork Docker images and OpenFork-managed markers/overrides.
# Keeps the host Docker and NVIDIA stack intact.
#

# Never fail the package removal because of cleanup.
set +e

log() {
    echo "[OpenFork postuninstall] $1"
}

REAL_USER="$(awk -F= '$1 == "real-user" { print $2; exit }' /etc/openfork-managed 2>/dev/null)"
if [ "$REAL_USER" = "unknown" ]; then
    REAL_USER=""
fi
DOCKER_RUN_AS_USER=0

is_package_transition() {
    case "${1:-}" in
        upgrade|failed-upgrade|abort-install|abort-upgrade)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

is_openfork_managed() {
    [ -f /etc/openfork-managed ] && return 0
    [ -f /etc/systemd/system/docker.service.d/openfork-override.conf ] && return 0
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
        log "Docker CLI not found; skipping OpenFork Docker image cleanup."
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

    log "Docker daemon is not reachable; attempting to start it for cleanup..."
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

    log "Docker daemon is still not reachable; skipping OpenFork Docker image cleanup."
    return 1
}

remove_container_ids() {
    local container_ids="$1"
    local container_id

    [ -n "$container_ids" ] || return 0

    while IFS= read -r container_id; do
        [ -n "$container_id" ] || continue
        log "Removing OpenFork Docker container: $container_id"
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

    log "Removing OpenFork Docker containers and images..."
    remove_container_ids "$(docker_cmd ps -a -q --filter 'name=dgn-client' 2>/dev/null || true)"

    image_ids_file=$(mktemp)
    collect_openfork_image_ids "$image_ids_file"
    removed_count=0

    while IFS= read -r image_id; do
        [ -n "$image_id" ] || continue

        dependent_containers=$(docker_cmd ps -a -q --filter "ancestor=$image_id" 2>/dev/null || true)
        remove_container_ids "$dependent_containers"

        log "Removing OpenFork Docker image: $image_id"
        if docker_cmd rmi -f "$image_id" >/dev/null 2>&1; then
            removed_count=$((removed_count + 1))
        else
            log "Could not remove Docker image $image_id; it may already be gone or shared by another tag."
        fi
    done < "$image_ids_file"

    rm -f "$image_ids_file"
    log "OpenFork Docker image cleanup complete. Removed $removed_count image(s)."
}

cleanup_openfork_engine() {
    cleanup_openfork_docker_images

    log "Leaving Docker Engine, non-OpenFork Docker data, and NVIDIA packages untouched."

    log "Removing OpenFork markers and overrides..."
    rm -f /etc/openfork-managed
    rm -f /etc/openfork-setup-log
    rm -f /etc/systemd/system/docker.service.d/openfork-override.conf
    rmdir /etc/systemd/system/docker.service.d >/dev/null 2>&1 || true

    if command -v systemctl >/dev/null 2>&1; then
        systemctl daemon-reload >/dev/null 2>&1 || true
    fi
}

if is_package_transition "$1"; then
    log "Package transition '$1' detected; skipping OpenFork Docker image cleanup."
    exit 0
fi

if ! is_openfork_managed; then
    log "System is not marked as OpenFork-managed; skipping engine cleanup."
    exit 0
fi

log "Cleaning up OpenFork AI Engine..."
cleanup_openfork_engine

exit 0
