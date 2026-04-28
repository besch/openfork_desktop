const DEFAULT_IDLE_TIMEOUT_MINUTES = 30;

// Policy-specific idle timeouts the UI surfaces in the Monetize tab.
// Source of truth for actual eviction is now the Python download manager
// (services/docker_download_manager.py), which performs LRU and disk-pressure
// driven cleanup. These values are kept here only for monetize-tab UX defaults.
const POLICY_IDLE_TIMEOUTS = {
  all: 120,
  project: 240,
  users: 240,
  monetize: 90,
  mine: null,
};

/**
 * DockerCleanupManager — UI/notification shim only.
 *
 * The actual `docker rmi` decisions are made by the Python DockerDownloadManager,
 * which has the full picture (active downloads, queued jobs, last-job timestamps,
 * disk-pressure tier). This class:
 *
 *   1. Keeps job-activity tracking so the Monetize tab can show recent jobs.
 *   2. Exposes the existing monetize idle-timeout configuration for backward
 *      compatibility with the UI.
 *   3. Persists the user's enabled/idleTimeoutMinutes choice in the store.
 *   4. Forwards eviction events emitted by Python (IMAGE_EVICTED) to the
 *      renderer as `monetize:cleanup-event` notifications.
 *
 * The previous 5-minute polling + `docker rmi` loop has been removed to avoid
 * racing with Python-side eviction.
 */
class DockerCleanupManager {
  constructor({ store, mainWindow }) {
    this.store = store;
    this.mainWindow = mainWindow;

    // Shared job-activity state (used by the Monetize tab UI)
    this.imageLastJobTime = new Map(); // service_type -> Date of last job completion
    this.activeServices = new Set(); // service_types with a container currently running

    const saved = this.store.get("monetizeConfig") || {};
    this.idleTimeoutMinutes =
      saved.idleTimeoutMinutes ?? DEFAULT_IDLE_TIMEOUT_MINUTES;
    this.enabled = saved.enabled ?? false;

    this.currentPolicy = null;
  }

  // ── Job activity tracking ──────────────────────────────────────────────────

  notifyJobStart(serviceType) {
    if (!serviceType) return;
    this.imageLastJobTime.set(serviceType, new Date());
    this.activeServices.add(serviceType);
  }

  notifyJobEnd(serviceType) {
    if (!serviceType) return;
    this.imageLastJobTime.set(serviceType, new Date());
    this.activeServices.delete(serviceType);
  }

  // ── Monetize idle-timeout config (UI only) ─────────────────────────────────

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

  // No-op start/stop methods kept for backward compatibility with existing
  // electron.cjs IPC handlers that called startMonitoring/stopMonitoring.
  startMonitoring() {}
  stopMonitoring() {}

  // ── Policy tracking (kept for backward compat) ─────────────────────────────

  updatePolicy(policy) {
    this.currentPolicy = policy;
  }

  resetPolicy() {
    this.currentPolicy = null;
  }

  // ── Eviction notifications from Python ────────────────────────────────────

  /**
   * Called by PythonProcessManager when an IMAGE_EVICTED message arrives on stdout.
   * Forwards to the renderer so the Monetize tab can show a "removed image" toast.
   */
  notifyImageEvicted({ service_type, image, freed_bytes, reason }) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      const freedGB = freed_bytes ? (freed_bytes / 1024 ** 3).toFixed(1) : null;
      this.mainWindow.webContents.send("monetize:cleanup-event", {
        service_type: service_type || null,
        image: image || null,
        action: "removed",
        reason: reason || "image_cap",
        freed_bytes: freed_bytes || 0,
        timestamp: new Date().toISOString(),
      });
      const reasonLabel =
        reason === "disk_critical"
          ? "Critical disk pressure"
          : reason === "disk_pressure"
            ? "Disk pressure"
            : "Image cap";
      const sizeLabel = freedGB ? ` — ${freedGB} GB freed` : "";
      this.mainWindow.webContents.send("openfork_client:log", {
        type: "stdout",
        message: `[Auto-Cleanup] Removed ${image || service_type || "image"} (${reasonLabel}${sizeLabel})`,
      });
    }
  }
}

module.exports = { DockerCleanupManager, POLICY_IDLE_TIMEOUTS };
