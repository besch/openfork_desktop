"use strict";

const dockerEngine = require("./docker-engine.cjs");
const wslUtils = require("./wsl-utils.cjs");

let _getMainWindow;
let _getPythonManager;
let _getAutoCompactManager;
let _getIsManualReclaimInProgress;
let _getIsPostReclaimSettling;

function init({
  getMainWindow,
  getPythonManager,
  getAutoCompactManager,
  getIsManualReclaimInProgress,
  getIsPostReclaimSettling,
}) {
  _getMainWindow = getMainWindow;
  _getPythonManager = getPythonManager;
  _getAutoCompactManager = getAutoCompactManager;
  _getIsManualReclaimInProgress = getIsManualReclaimInProgress;
  _getIsPostReclaimSettling = getIsPostReclaimSettling;
}

let dockerMonitorInterval = null;
let lastContainersJson = "";
let lastImagesJson = "";
let dockerMonitorConsecutiveFailures = 0;
const DOCKER_MONITOR_MAX_FAILURES = 3;
const DOCKER_MONITOR_INTERVAL_MS = 15000;
let dockerApiUnreachableFailures = 0;
let wslRecoveryInProgress = false;
let lastWslRecoveryTs = 0;
let lastLargeDownloadCompletedTs = 0;
// Trigger recovery after 6 consecutive DOCKER_API_UNREACHABLE polls. Large image
// downloads (8-24 GB) temporarily saturate the
// Docker daemon with overlay2 extraction work — the previous threshold of 2
// (10 seconds) was too aggressive and fired recovery during normal post-download
// I/O, stopping the Python client unnecessarily.
// During the first 3 minutes after a large download, the threshold is raised to
// 18 polls to give Docker extra settling time.
const DOCKER_API_RECOVERY_FAILURES = 6;
const DOCKER_API_RECOVERY_FAILURES_POST_DOWNLOAD = 18;
const POST_DOWNLOAD_GRACE_MS = 3 * 60 * 1000;
const WSL_RECOVERY_COOLDOWN_MS = 5 * 60 * 1000;

// Track the active engine across polls so we can emit an event when it changes.
let _lastKnownActiveEngine = null;

// Cached Docker routing — avoids expensive resolveDockerStatus on every list call
let _cachedRoutingResult = null;
let _cachedRoutingTimestamp = 0;
let _routingPromise = null;
let _monitorPollInFlight = false;
let _routingGeneration = 0;
const ROUTING_CACHE_TTL_MS = 10000; // 10 seconds

function isCompactionInProgress() {
  return (
    !!_getAutoCompactManager?.()?.isCompactionInProgress?.() ||
    !!_getIsManualReclaimInProgress?.() ||
    !!_getIsPostReclaimSettling?.()
  );
}

function notifyWslRecoveryStatus(payload) {
  const mainWindow = _getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const isTerminal =
    payload?.phase === "completed" || payload?.phase === "failed";
  mainWindow.webContents.send("docker:wsl-recovery-status", {
    ...payload,
    recoveryInProgress: isTerminal ? false : wslRecoveryInProgress,
    platformSupported: process.platform === "win32",
  });
}

function logToRenderer(type, message) {
  const mainWindow = _getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("openfork_client:log", { type, message });
}

function clearDockerLists() {
  const mainWindow = _getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (lastContainersJson !== "") {
    lastContainersJson = "";
    mainWindow.webContents.send("docker:containers-update", []);
  }
  if (lastImagesJson !== "") {
    lastImagesJson = "";
    mainWindow.webContents.send("docker:images-update", []);
  }
}

function parseOpenForkImages(imagesOutput = "") {
  return imagesOutput
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
      return `${img.repository}:${img.tag}`.toLowerCase().includes("openfork");
    });
}

function sendImagesUpdate(mainWindow, imagesOutput) {
  lastImagesJson = imagesOutput;
  mainWindow.webContents.send(
    "docker:images-update",
    parseOpenForkImages(imagesOutput),
  );
}

async function getDockerImagesOutput() {
  try {
    return await dockerEngine.execDockerCommand(
      'docker images --format "{{json .}}"',
    );
  } catch (e) {
    console.warn(`Failed to get image list: ${e?.message || e}`);
    return "";
  }
}

function shouldRecoverWslDocker() {
  if (process.platform !== "win32") return false;
  if (wslRecoveryInProgress) return false;
  if (Date.now() - lastWslRecoveryTs < WSL_RECOVERY_COOLDOWN_MS) return false;

  const pythonManager = _getPythonManager?.();
  if (!pythonManager?.isRunning?.()) return false;
  if (!pythonManager.getLastService?.()) return false;

  const threshold =
    Date.now() - lastLargeDownloadCompletedTs < POST_DOWNLOAD_GRACE_MS
      ? DOCKER_API_RECOVERY_FAILURES_POST_DOWNLOAD
      : DOCKER_API_RECOVERY_FAILURES;

  return dockerApiUnreachableFailures >= threshold;
}

/**
 * Called by PythonProcessManager when Python reports a DOCKER_DOWNLOAD_STATE
 * completed event. Resets the post-download grace window so the monitor backs
 * off its recovery trigger threshold for the next few minutes.
 */
function notifyLargeDownloadCompleted() {
  lastLargeDownloadCompletedTs = Date.now();
  console.log(
    "Docker monitor: large download completed — using relaxed recovery threshold for the next 3 minutes.",
  );
}

function maybeRecoverWslDocker(dockerStatus) {
  if (!shouldRecoverWslDocker()) return;

  runWslRecoveryFlow(dockerStatus).catch((err) => {
    console.error("Docker monitor WSL recovery failed:", err);
  });
}

async function runWslRecoveryFlow(dockerStatus) {
  const pythonManager = _getPythonManager?.();
  if (!pythonManager?.isRunning?.()) return;

  wslRecoveryInProgress = true;
  lastWslRecoveryTs = Date.now();

  const lastService = pythonManager.getLastService?.();
  const lastRoutingConfig = pythonManager.getLastRoutingConfig?.();
  const wasMonitoring = isDockerMonitoringActive();

  try {
    console.warn(
      "Docker API has been unreachable for multiple polls. Restarting OpenFork Ubuntu and DGN client...",
    );
    logToRenderer(
      "stderr",
      "Docker API is unreachable. Restarting OpenFork Ubuntu and reconnecting the DGN client...",
    );

    notifyWslRecoveryStatus({
      phase: "stopping_client",
      error: undefined,
    });
    await pythonManager.stop();

    if (wasMonitoring) {
      stopDockerMonitoring();
    }
    resetDockerRoutingCache();
    clearDockerLists();

    await dockerEngine.restartWslDockerEngine({
      wslDistro: dockerStatus?.wslDistro,
      onPhase: (phase) => {
        notifyWslRecoveryStatus({ phase, error: undefined });
      },
    });

    dockerApiUnreachableFailures = 0;
    dockerMonitorConsecutiveFailures = 0;
    resetDockerRoutingCache();

    if (lastService && !pythonManager.isRunning()) {
      notifyWslRecoveryStatus({
        phase: "restarting_client",
        error: undefined,
      });
      await pythonManager.start(lastService, lastRoutingConfig);
    }

    notifyWslRecoveryStatus({
      phase: "completed",
      error: undefined,
    });
    logToRenderer(
      "stdout",
      "OpenFork Ubuntu recovered. The DGN client is reconnecting with the previous settings.",
    );
  } catch (err) {
    const message = err?.message || String(err);
    console.error("WSL Docker recovery failed:", message);
    notifyWslRecoveryStatus({
      phase: "failed",
      error: message,
    });
    logToRenderer("stderr", `Automatic WSL recovery failed: ${message}`);
  } finally {
    wslRecoveryInProgress = false;
    resetDockerRoutingCache();
    if (wasMonitoring) {
      startDockerMonitoring();
    }
  }
}

/**
 * Ensures that OPENFORK_DOCKER_HOST is correctly set for the active Docker engine.
 * Uses a short-lived cache to avoid calling resolveDockerStatus() on every IPC call.
 * Returns the resolved Docker status.
 */
async function ensureDockerRouting() {
  if (isCompactionInProgress()) {
    return {
      installed: true,
      running: false,
      isNative: false,
      error: "WSL_COMPACTING",
    };
  }

  const now = Date.now();
  if (
    _cachedRoutingResult &&
    now - _cachedRoutingTimestamp < ROUTING_CACHE_TTL_MS
  ) {
    return _cachedRoutingResult;
  }
  if (_routingPromise) return _routingPromise;

  const generation = _routingGeneration;
  _routingPromise = dockerEngine
    .resolveDockerStatus({
      allowNativeStart: false,
      wslHostTimeoutMs: 5000,
    })
    .finally(() => {
      if (generation === _routingGeneration) {
        _routingPromise = null;
      }
    });
  const status = await _routingPromise;
  if (isCompactionInProgress()) {
    resetDockerRoutingCache();
    return {
      installed: true,
      running: false,
      isNative: false,
      error: "WSL_COMPACTING",
    };
  }
  if (status.error === "WSL_VHDX_LOCKED") {
    resetDockerRoutingCache();
    return status;
  }
  if (generation === _routingGeneration) {
    _cachedRoutingResult = status;
    _cachedRoutingTimestamp = now;
  }
  return status;
}

async function checkDockerUpdates() {
  const mainWindow = _getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (_monitorPollInFlight) return;
  _monitorPollInFlight = true;

  try {
    if (isCompactionInProgress()) {
      dockerMonitorConsecutiveFailures = 0;
      dockerApiUnreachableFailures = 0;
      resetDockerRoutingCache();
      return;
    }

    const dockerStatus = await dockerEngine.resolveDockerStatus({
      allowNativeStart: false,
      wslHostTimeoutMs: 5000,
    });
    _cachedRoutingResult = dockerStatus;
    _cachedRoutingTimestamp = Date.now();

    if (isCompactionInProgress()) {
      dockerMonitorConsecutiveFailures = 0;
      dockerApiUnreachableFailures = 0;
      resetDockerRoutingCache();
      return;
    }
    if (dockerStatus.error === "WSL_VHDX_LOCKED") {
      dockerMonitorConsecutiveFailures = 0;
      dockerApiUnreachableFailures = 0;
      resetDockerRoutingCache();
      return;
    }

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

    // Always try to list containers via WSL — the command runs inside the
    // distro where Docker is reachable even when the Windows→WSL TCP API
    // (port 2375) is flaky.  Only clear containers when the listing itself
    // confirms zero containers AND the status check agrees Docker is down.
    let containersOutput = "";
    try {
      containersOutput = await dockerEngine.execDockerCommand(
        'docker ps -a --format "{{json .}}" --filter "name=dgn-client"',
      );
    } catch (e) {
      console.warn(`Failed to get container list: ${e?.message || e}`);
      containersOutput = "";
    }

    // Also try images via the WSL-side Docker CLI. The TCP health check can be
    // flaky after large pulls, but the in-distro CLI often still works.
    const imagesOutput = await getDockerImagesOutput();

    if (!dockerStatus.running) {
      if (
        process.platform === "win32" &&
        dockerStatus.error === "DOCKER_API_UNREACHABLE"
      ) {
        dockerApiUnreachableFailures++;
        maybeRecoverWslDocker(dockerStatus);
      } else {
        dockerApiUnreachableFailures = 0;
      }

      // If containers were found inside WSL, trust the listing over the
      // TCP-based status check and reset the failure counter.
      if (
        (containersOutput && containersOutput.trim().length > 0) ||
        (imagesOutput && imagesOutput.trim().length > 0)
      ) {
        dockerMonitorConsecutiveFailures = 0;
      } else {
        dockerMonitorConsecutiveFailures++;
      }

      if (
        process.platform === "win32" &&
        dockerStatus.error === "WSL_DISTRO_MISSING"
      ) {
        mainWindow.webContents.send("docker:wsl-distro-missing", {
          distroName: await wslUtils.getWslDistroName(),
        });
      }

      // Only clear the display after consecutive failures with empty listings
      // to avoid transient WSL Docker API timeouts from flickering the UI.
      if (dockerMonitorConsecutiveFailures >= DOCKER_MONITOR_MAX_FAILURES) {
        if (lastContainersJson !== "") {
          lastContainersJson = "";
          mainWindow.webContents.send("docker:containers-update", []);
        }
        if (!imagesOutput && lastImagesJson !== "") {
          lastImagesJson = "";
          mainWindow.webContents.send("docker:images-update", []);
        }
      } else {
        console.log(
          `Docker monitor: not running (${dockerMonitorConsecutiveFailures}/${DOCKER_MONITOR_MAX_FAILURES} failures, error: ${dockerStatus.error || "none"}). Keeping current display.`,
        );
      }

      // Still send the container update if containers were found despite the
      // status check failing — the containers ARE running inside WSL.
      if (containersOutput && containersOutput !== lastContainersJson) {
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
        if (containers.length > 0) {
          mainWindow.webContents.send("docker:containers-update", containers);
        }
      }
      if (imagesOutput && imagesOutput !== lastImagesJson) {
        sendImagesUpdate(mainWindow, imagesOutput);
      }
      return;
    }

    // Docker is running — reset the failure counter
    dockerMonitorConsecutiveFailures = 0;
    dockerApiUnreachableFailures = 0;

    // Send container updates
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

    if (imagesOutput !== lastImagesJson) {
      sendImagesUpdate(mainWindow, imagesOutput);
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
  } finally {
    _monitorPollInFlight = false;
  }
}

function startDockerMonitoring() {
  if (dockerMonitorInterval) return;
  if (isCompactionInProgress()) {
    resetDockerRoutingCache();
    return;
  }
  console.log("Starting Docker background monitoring...");
  checkDockerUpdates();
  dockerMonitorInterval = setInterval(
    checkDockerUpdates,
    DOCKER_MONITOR_INTERVAL_MS,
  );
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
  _routingGeneration++;
  _cachedRoutingResult = null;
  _cachedRoutingTimestamp = 0;
  _routingPromise = null;
  dockerEngine.resetDockerStatusCache?.();
}

module.exports = {
  init,
  ensureDockerRouting,
  checkDockerUpdates,
  startDockerMonitoring,
  stopDockerMonitoring,
  isDockerMonitoringActive,
  resetDockerRoutingCache,
  notifyLargeDownloadCompleted,
};
