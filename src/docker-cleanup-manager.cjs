
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_IDLE_TIMEOUT_MINUTES = 30;

// Policy-specific idle timeouts for automatic image cleanup.
// null = disabled — no auto-cleanup for this policy.
const POLICY_IDLE_TIMEOUTS = {
  all: 120, // 2 hours  — user processes random network jobs; stale images pile up fast
  project: 240, // 4 hours — curated project images; longer gaps expected between work sessions
  users: 240, // 4 hours — trusted-user images; same rationale as project
  monetize: 90, // 90 minutes — reclaims space without churning on large (100-220 GB) image re-downloads
  mine: null, // disabled — user's own workflow images; never auto-evict
};

/**
 * DockerCleanupManager auto-evicts idle Docker images.
 *
 * Two independent cleanup modes run in parallel:
 *
 * 1. **Monetize mode** (manual): Enabled/disabled by the user via the Monetize tab.
 *    Idle timeout is configurable and persisted in the store.
 *
 * 2. **Policy mode** (automatic): Activated when the DGN client starts with a policy
 *    that has a non-null entry in POLICY_IDLE_TIMEOUTS (currently "all", "project",
 *    "users"). Stopped when the client stops or switches to a non-qualifying policy.
 *
 * Both modes share the same job-activity tracking (imageLastJobTime, activeServices)
 * so a single job_complete event resets the idle clock for both.
 *
 * Eviction logic per image:
 *   1. Skip if a container for that service is currently running
 *   2. Skip if the last job for that service finished within the idle timeout
 *   3. Skip if no job has ever been processed for that service (avoids evicting
 *      images that were pre-downloaded but not yet used)
 *   4. Otherwise: remove image + notify renderer
 */
class DockerCleanupManager {
  constructor({ store, mainWindow, execDockerCommand }) {
    this.store = store;
    this.mainWindow = mainWindow;
    this.execDockerCommand = execDockerCommand;

    // Shared job-activity state
    this.imageLastJobTime = new Map(); // service_type -> Date of last job completion
    this.activeServices = new Set(); // service_types with a container currently running

    // Monetize cleanup (manual, user-configured)
    this.checkIntervalId = null;
    const saved = this.store.get("monetizeConfig") || {};
    this.idleTimeoutMinutes =
      saved.idleTimeoutMinutes ?? DEFAULT_IDLE_TIMEOUT_MINUTES;
    this.enabled = saved.enabled ?? false;

    // Policy-based cleanup (automatic, driven by accept_policy)
    this.policyCheckIntervalId = null;
    this.policyIdleTimeoutMinutes = null; // null = disabled
    this.currentPolicy = null;
  }

  // ── Job activity tracking ──────────────────────────────────────────────────

  /** Called when a JOB_START message arrives from the Python client */
  notifyJobStart(serviceType) {
    if (!serviceType) return;
    this.imageLastJobTime.set(serviceType, new Date());
    this.activeServices.add(serviceType);
  }

  /** Called when a JOB_COMPLETE or JOB_FAILED message arrives */
  notifyJobEnd(serviceType) {
    if (!serviceType) return;
    this.imageLastJobTime.set(serviceType, new Date());
    this.activeServices.delete(serviceType);
  }

  // ── Monetize cleanup (manual) ──────────────────────────────────────────────

  setIdleTimeoutMinutes(minutes) {
    this.idleTimeoutMinutes = minutes;
    const saved = this.store.get("monetizeConfig") || {};
    this.store.set("monetizeConfig", { ...saved, idleTimeoutMinutes: minutes });
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    const saved = this.store.get("monetizeConfig") || {};
    this.store.set("monetizeConfig", { ...saved, enabled });
  }

  isEnabled() {
    return this.enabled;
  }

  startMonitoring() {
    if (this.checkIntervalId) return;
    console.log(
      "DockerCleanupManager: Starting monetize idle image monitoring.",
    );
    this.checkIntervalId = setInterval(
      () => this._runMonetizeCleanup(),
      CHECK_INTERVAL_MS,
    );
  }

  stopMonitoring() {
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
      this.checkIntervalId = null;
      console.log(
        "DockerCleanupManager: Stopped monetize idle image monitoring.",
      );
    }
  }

  // ── Policy-based cleanup (automatic) ──────────────────────────────────────

  /**
   * Called when the DGN client starts or changes its accept_policy.
   * Starts or stops policy-based monitoring accordingly.
   */
  updatePolicy(policy) {
    this.currentPolicy = policy;
    const timeout = POLICY_IDLE_TIMEOUTS[policy] ?? null;

    if (!timeout) {
      // mine, monetize, or unknown policy: no auto-cleanup
      this.stopPolicyMonitoring();
      return;
    }

    this.policyIdleTimeoutMinutes = timeout;
    // Restart (clears any existing interval with a different timeout)
    this.startPolicyMonitoring();
    console.log(
      `DockerCleanupManager: Policy '${policy}' → auto-cleanup idle timeout = ${timeout} min.`,
    );
  }

  /**
   * Called when the DGN client stops.
   * Keeps job-activity tracking intact (useful if cleanup should finish up)
   * but stops scheduling new cleanup passes since the client is no longer running.
   */
  resetPolicy() {
    const prev = this.currentPolicy;
    this.currentPolicy = null;
    this.stopPolicyMonitoring();
    if (prev) {
      console.log(
        `DockerCleanupManager: Policy '${prev}' cleared — policy-based cleanup stopped.`,
      );
    }
  }

  startPolicyMonitoring() {
    if (this.policyCheckIntervalId) {
      clearInterval(this.policyCheckIntervalId);
    }
    console.log(
      `DockerCleanupManager: Starting policy-based cleanup (policy=${this.currentPolicy}, idle=${this.policyIdleTimeoutMinutes} min).`,
    );
    this.policyCheckIntervalId = setInterval(
      () => this._runPolicyCleanup(),
      CHECK_INTERVAL_MS,
    );
  }

  stopPolicyMonitoring() {
    if (this.policyCheckIntervalId) {
      clearInterval(this.policyCheckIntervalId);
      this.policyCheckIntervalId = null;
      console.log("DockerCleanupManager: Stopped policy-based cleanup.");
    }
    this.policyIdleTimeoutMinutes = null;
  }

  // ── Cleanup runners ────────────────────────────────────────────────────────

  async _runMonetizeCleanup() {
    await this._doCleanup(this.idleTimeoutMinutes);
  }

  async _runPolicyCleanup() {
    if (!this.policyIdleTimeoutMinutes) return;
    await this._doCleanup(this.policyIdleTimeoutMinutes);
  }

  /**
   * Core eviction loop.
   * @param {number} idleTimeoutMinutes - Evict images idle longer than this.
   */
  async _doCleanup(idleTimeoutMinutes) {
    try {
      // Get all openfork images
      const imagesOut = await this.execDockerCommand(
        'docker images --format "{{.Repository}}:{{.Tag}}|{{.ID}}" --filter "reference=beschiak/openfork-*"',
      ).catch(() => "");

      const imageLines = imagesOut.split("\n").filter(Boolean);
      if (!imageLines.length) return;

      // Get running containers to avoid evicting images in active use
      const runningOut = await this.execDockerCommand(
        'docker ps --format "{{.Image}}" --filter "status=running"',
      ).catch(() => "");
      const runningImages = new Set(runningOut.split("\n").filter(Boolean));

      const now = Date.now();
      const timeoutMs = idleTimeoutMinutes * 60 * 1000;

      for (const line of imageLines) {
        const [imageName, imageId] = line.split("|");
        if (!imageName || !imageId) continue;

        // Derive service type from image name
        // e.g. "beschiak/openfork-wan22:latest" → "wan22"
        const serviceMatch = imageName.match(/openfork-([^:]+)/);
        const serviceType = serviceMatch ? serviceMatch[1] : null;

        // Skip if a container is currently running for this image
        if (
          runningImages.has(imageName) ||
          (serviceType && this.activeServices.has(serviceType))
        ) {
          continue;
        }

        const lastJobTime = serviceType
          ? this.imageLastJobTime.get(serviceType)
          : null;

        // Skip if last job was recent
        if (lastJobTime && now - lastJobTime.getTime() < timeoutMs) {
          continue;
        }

        // Skip if we have never processed a job for this service in this session.
        // This prevents evicting images that were pre-downloaded but not yet used
        // (e.g. images downloaded by prefetch or a previous session).
        if (!lastJobTime) {
          continue;
        }

        // Evict
        console.log(
          `DockerCleanupManager: Removing idle image ${imageName} (${imageId}) — idle >${idleTimeoutMinutes} min`,
        );
        try {
          // Remove stopped containers that reference this image before rmi
          const stoppedOut = await this.execDockerCommand(
            `docker ps -a -q --filter ancestor=${imageId} --filter "status=exited"`,
          ).catch(() => "");
          const stoppedIds = stoppedOut.split("\n").filter(Boolean);
          for (const cid of stoppedIds) {
            await this.execDockerCommand(`docker rm -f ${cid}`).catch(() => {});
          }

          await this.execDockerCommand(`docker rmi -f ${imageId}`);

          this._emitCleanupEvent({
            service_type: serviceType || imageName,
            image: imageName,
            action: "removed",
            reason: `Idle for >${idleTimeoutMinutes} minutes`,
          });
        } catch (err) {
          console.error(
            `DockerCleanupManager: Failed to remove ${imageName}:`,
            err,
          );
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
        message: `[Auto-Cleanup] Removed idle image: ${payload.image} (${payload.reason})`,
      });
    }
  }
}

module.exports = { DockerCleanupManager, POLICY_IDLE_TIMEOUTS };
