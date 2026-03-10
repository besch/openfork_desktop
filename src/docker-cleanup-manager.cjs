const { exec } = require("child_process");

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_IDLE_TIMEOUT_MINUTES = 30;

/**
 * DockerCleanupManager auto-evicts idle Docker images in monetize mode.
 *
 * Logic per image:
 *   1. Skip if a container for that service is currently running
 *   2. Skip if the last job for that service was within idleTimeoutMinutes
 *   3. Otherwise: remove image + notify renderer
 */
class DockerCleanupManager {
  constructor({ store, mainWindow, execDockerCommand }) {
    this.store = store;
    this.mainWindow = mainWindow;
    this.execDockerCommand = execDockerCommand;
    this.checkIntervalId = null;
    this.imageLastJobTime = new Map(); // service_type -> Date
    this.activeServices = new Set();  // service_types with running containers

    const saved = this.store.get("monetizeConfig") || {};
    this.idleTimeoutMinutes = saved.idleTimeoutMinutes ?? DEFAULT_IDLE_TIMEOUT_MINUTES;
  }

  /** Called from PythonProcessManager when a JOB_START message arrives */
  notifyJobStart(serviceType) {
    if (!serviceType) return;
    this.imageLastJobTime.set(serviceType, new Date());
    this.activeServices.add(serviceType);
  }

  /** Called from PythonProcessManager when a JOB_COMPLETE / JOB_FAILED message arrives */
  notifyJobEnd(serviceType) {
    if (!serviceType) return;
    this.imageLastJobTime.set(serviceType, new Date());
    this.activeServices.delete(serviceType);
  }

  setIdleTimeoutMinutes(minutes) {
    this.idleTimeoutMinutes = minutes;
    const saved = this.store.get("monetizeConfig") || {};
    this.store.set("monetizeConfig", { ...saved, idleTimeoutMinutes: minutes });
  }

  startMonitoring() {
    if (this.checkIntervalId) return;
    console.log("DockerCleanupManager: Starting idle image monitoring.");
    this.checkIntervalId = setInterval(() => this._runCleanup(), CHECK_INTERVAL_MS);
  }

  stopMonitoring() {
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
      this.checkIntervalId = null;
      console.log("DockerCleanupManager: Stopped idle image monitoring.");
    }
  }

  async _runCleanup() {
    try {
      // Get all openfork images
      const imagesOut = await this.execDockerCommand(
        'docker images --format "{{.Repository}}:{{.Tag}}|{{.ID}}" --filter "reference=beschiak/openfork-*"'
      ).catch(() => "");

      const imageLines = imagesOut.split("\n").filter(Boolean);
      if (!imageLines.length) return;

      // Get running containers
      const runningOut = await this.execDockerCommand(
        'docker ps --format "{{.Image}}" --filter "status=running"'
      ).catch(() => "");
      const runningImages = new Set(runningOut.split("\n").filter(Boolean));

      const now = Date.now();
      const timeoutMs = this.idleTimeoutMinutes * 60 * 1000;

      for (const line of imageLines) {
        const [imageName, imageId] = line.split("|");
        if (!imageName || !imageId) continue;

        // Derive service type from image name
        // e.g. "beschiak/openfork-wan22:latest" -> "wan22"
        const serviceMatch = imageName.match(/openfork-([^:]+)/);
        const serviceType = serviceMatch ? serviceMatch[1] : null;

        // Skip if container is running
        if (runningImages.has(imageName) || (serviceType && this.activeServices.has(serviceType))) {
          continue;
        }

        // Skip if last job was recent
        const lastJobTime = serviceType ? this.imageLastJobTime.get(serviceType) : null;
        if (lastJobTime && now - lastJobTime.getTime() < timeoutMs) {
          continue;
        }

        // Also skip if last job time is unknown but the image was used recently
        // (only evict if we've seen at least one job completion for this service,
        //  or if idleTimeout has passed since process start)
        if (!lastJobTime) {
          // Never processed a job for this image in this session — skip to be safe
          continue;
        }

        // Evict the image
        console.log(`DockerCleanupManager: Removing idle image ${imageName} (${imageId})`);
        try {
          // Stop any stopped (not running) containers using this image first
          const stoppedContainersOut = await this.execDockerCommand(
            `docker ps -a -q --filter ancestor=${imageId} --filter "status=exited"`
          ).catch(() => "");
          const stoppedIds = stoppedContainersOut.split("\n").filter(Boolean);
          for (const cid of stoppedIds) {
            await this.execDockerCommand(`docker rm -f ${cid}`).catch(() => {});
          }

          await this.execDockerCommand(`docker rmi -f ${imageId}`);

          this._emitCleanupEvent({
            service_type: serviceType || imageName,
            image: imageName,
            action: "removed",
            reason: `Idle for >${this.idleTimeoutMinutes} minutes`,
          });
        } catch (err) {
          console.error(`DockerCleanupManager: Failed to remove ${imageName}:`, err);
        }
      }
    } catch (err) {
      console.error("DockerCleanupManager: Cleanup run failed:", err);
    }
  }

  _emitCleanupEvent(payload) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("monetize:cleanup-event", {
        ...payload,
        timestamp: new Date().toISOString(),
      });
      this.mainWindow.webContents.send("openfork_client:log", {
        type: "stdout",
        message: `[Monetize] Auto-removed idle image: ${payload.image} (${payload.reason})`,
      });
    }
  }
}

module.exports = { DockerCleanupManager };
