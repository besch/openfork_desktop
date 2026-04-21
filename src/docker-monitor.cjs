"use strict";

const dockerEngine = require("./docker-engine.cjs");
const wslUtils = require("./wsl-utils.cjs");

let _getMainWindow;

function init({ getMainWindow }) {
  _getMainWindow = getMainWindow;
}

let dockerMonitorInterval = null;
let lastContainersJson = "";
let lastImagesJson = "";
let dockerMonitorConsecutiveFailures = 0;
const DOCKER_MONITOR_MAX_FAILURES = 3;

// Track the active engine across polls so we can emit an event when it changes.
let _lastKnownActiveEngine = null;

// Cached Docker routing — avoids expensive resolveDockerStatus on every list call
let _cachedRoutingResult = null;
let _cachedRoutingTimestamp = 0;
const ROUTING_CACHE_TTL_MS = 10000; // 10 seconds

/**
 * Ensures that OPENFORK_DOCKER_HOST is correctly set for the active Docker engine.
 * Uses a short-lived cache to avoid calling resolveDockerStatus() on every IPC call.
 * Returns the resolved Docker status.
 */
async function ensureDockerRouting() {
  const now = Date.now();
  if (
    _cachedRoutingResult &&
    now - _cachedRoutingTimestamp < ROUTING_CACHE_TTL_MS
  ) {
    return _cachedRoutingResult;
  }
  const status = await dockerEngine.resolveDockerStatus({
    allowNativeStart: false,
    wslHostTimeoutMs: 5000,
  });
  _cachedRoutingResult = status;
  _cachedRoutingTimestamp = now;
  return status;
}

async function checkDockerUpdates() {
  const mainWindow = _getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;

  try {
    const dockerStatus = await dockerEngine.resolveDockerStatus({
      allowNativeStart: false,
      wslHostTimeoutMs: 5000,
    });

    // Also update the routing cache so list handlers stay in sync
    _cachedRoutingResult = dockerStatus;
    _cachedRoutingTimestamp = Date.now();

    // Detect active-engine changes and notify the renderer so DockerManagement
    // can refresh without waiting for the user to click the refresh button.
    const nextEngine = dockerStatus.activeEngine ?? null;
    if (
      nextEngine &&
      _lastKnownActiveEngine &&
      nextEngine !== _lastKnownActiveEngine
    ) {
      console.log(
        `Docker engine switched: ${_lastKnownActiveEngine} → ${nextEngine}`,
      );
      mainWindow.webContents.send("docker:engine-switched", {
        from: _lastKnownActiveEngine,
        to: nextEngine,
      });
    }
    if (nextEngine) _lastKnownActiveEngine = nextEngine;

    if (!dockerStatus.running) {
      dockerMonitorConsecutiveFailures++;

      if (
        process.platform === "win32" &&
        dockerStatus.error === "WSL_DISTRO_MISSING"
      ) {
        mainWindow.webContents.send("docker:wsl-distro-missing", {
          distroName: await wslUtils.getWslDistroName(),
        });
      }

      // Only clear the display after consecutive failures to avoid
      // transient WSL Docker API timeouts from flickering the UI.
      if (dockerMonitorConsecutiveFailures >= DOCKER_MONITOR_MAX_FAILURES) {
        if (lastContainersJson !== "") {
          lastContainersJson = "";
          mainWindow.webContents.send("docker:containers-update", []);
        }
        if (lastImagesJson !== "") {
          lastImagesJson = "";
          mainWindow.webContents.send("docker:images-update", []);
        }
      } else {
        console.log(
          `Docker monitor: not running (${dockerMonitorConsecutiveFailures}/${DOCKER_MONITOR_MAX_FAILURES} failures, error: ${dockerStatus.error || "none"}). Keeping current display.`,
        );
      }
      return;
    }

    // Docker is running — reset the failure counter
    dockerMonitorConsecutiveFailures = 0;

    // Check containers
    let containersOutput = "";
    try {
      containersOutput = await dockerEngine.execDockerCommand(
        'docker ps -a --format "{{json .}}" --filter "name=dgn-client"',
      );
    } catch (e) {
      console.warn(`Failed to get container list: ${e?.message || e}`);
      containersOutput = "";
    }
    if (containersOutput !== lastContainersJson) {
      lastContainersJson = containersOutput;
      const containers = containersOutput
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try {
            const container = JSON.parse(line);
            return {
              id: container.ID,
              name: container.Names,
              image: container.Image,
              status: container.Status,
              state: container.State,
              created: container.CreatedAt,
            };
          } catch (e) {
            return null;
          }
        })
        .filter(Boolean);
      mainWindow.webContents.send("docker:containers-update", containers);
    }

    // Check images
    let imagesOutput = "";
    try {
      imagesOutput = await dockerEngine.execDockerCommand(
        'docker images --format "{{json .}}"',
      );
    } catch (e) {
      console.warn(`Failed to get image list: ${e?.message || e}`);
      imagesOutput = "";
    }
    if (imagesOutput !== lastImagesJson) {
      lastImagesJson = imagesOutput;
      const images = imagesOutput
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try {
            const img = JSON.parse(line);
            return {
              id: img.ID,
              repository: img.Repository,
              tag: img.Tag,
              size: img.Size,
              created: img.CreatedAt || img.CreatedSince,
            };
          } catch (e) {
            return null;
          }
        })
        .filter((img) => {
          if (!img) return false;
          return `${img.repository}:${img.tag}`
            .toLowerCase()
            .includes("openfork");
        });
      mainWindow.webContents.send("docker:images-update", images);
    }
  } catch (e) {
    console.warn(`Docker monitor update error: ${e?.message || e}`);
    dockerMonitorConsecutiveFailures++;

    // Log diagnostics on repeated failures
    if (dockerMonitorConsecutiveFailures === 1) {
      console.info(
        `Docker monitor failure #${dockerMonitorConsecutiveFailures}/${DOCKER_MONITOR_MAX_FAILURES} - ` +
          `This is typically a transient WSL/sudo issue. Retrying...`,
      );
    } else if (
      dockerMonitorConsecutiveFailures >= DOCKER_MONITOR_MAX_FAILURES
    ) {
      console.error(
        `Docker monitor has failed ${dockerMonitorConsecutiveFailures} times. ` +
          `This may indicate a WSL sudo configuration issue or Docker socket access problem. ` +
          `ERNIE-Image processor will continue working if containers are already running.`,
      );
    }
  }
}

function startDockerMonitoring() {
  if (dockerMonitorInterval) return;
  console.log("Starting Docker background monitoring...");
  checkDockerUpdates();
  dockerMonitorInterval = setInterval(checkDockerUpdates, 5000);
}

function stopDockerMonitoring() {
  if (dockerMonitorInterval) {
    console.log("Stopping Docker background monitoring...");
    clearInterval(dockerMonitorInterval);
    dockerMonitorInterval = null;
  }
}

function isDockerMonitoringActive() {
  return dockerMonitorInterval !== null;
}

function resetDockerRoutingCache() {
  _cachedRoutingResult = null;
  _cachedRoutingTimestamp = 0;
}

module.exports = {
  init,
  ensureDockerRouting,
  checkDockerUpdates,
  startDockerMonitoring,
  stopDockerMonitoring,
  isDockerMonitoringActive,
  resetDockerRoutingCache,
};
