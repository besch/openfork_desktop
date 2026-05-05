const { execFile } = require("child_process");
const path = require("path");

/**
 * AutoCompactManager — Windows-only orchestrator for automatic VHDX compaction.
 *
 * After Python evicts cached Docker images, the WSL VHDX file on the host stays
 * the same size. The user has to either click "Reclaim Disk Space" in Storage
 * Settings or wait for it to fragment further. This manager watches IMAGE_EVICTED
 * events from Python and, once cumulative freed bytes cross a threshold, schedules
 * a compaction during the next fully-idle window:
 *
 *   - DGN client is currently running (we won't start it).
 *   - No active job in flight (hasActiveJob() === false).
 *   - No Docker pull in flight (hasQueuedDownloads() === false).
 *
 * On an idle window:
 *   1. Mark provider `paused_for_compaction = true` server-side.
 *   2. Stop Python (drains heartbeat, releases the VHDX).
 *   3. Run compact-wsl.ps1.
 *   4. Restart Python with the same routing config.
 *   5. Clear paused_for_compaction.
 *
 * Linux/macOS: no-op (docker rmi reclaims space immediately on those platforms).
 */
class AutoCompactManager {
  static DEFAULT_THRESHOLD_BYTES = 20 * 1024 ** 3; // 20 GB
  static IDLE_CHECK_INTERVAL_MS = 30 * 1000; // 30 seconds
  static MIN_COMPACT_GAP_MS = 60 * 60 * 1000; // 1 hour minimum between auto-compactions

  constructor({
    app,
    store,
    mainWindow,
    pythonManager,
    dockerEngine,
    dockerMonitor,
    wslUtils,
    setProviderPausedForCompaction,
  }) {
    this.app = app;
    this.store = store;
    this.mainWindow = mainWindow;
    this.pythonManager = pythonManager;
    this.dockerEngine = dockerEngine;
    this.dockerMonitor = dockerMonitor;
    this.wslUtils = wslUtils;
    // Function provided by electron.cjs that PATCHes the orchestrator to set
    // paused_for_compaction on dgn_providers. Returns a Promise.
    this.setProviderPausedForCompaction = setProviderPausedForCompaction;

    const saved = this.store.get("autoCompactState") || {};
    this._freedSinceLastCompact = Number(saved.freedSinceLastCompact || 0);
    this._lastCompactTs = Number(saved.lastCompactTs || 0);
    this._enabled = saved.enabled !== false; // default on
    this._thresholdBytes =
      Number(saved.thresholdBytes) ||
      AutoCompactManager.DEFAULT_THRESHOLD_BYTES;

    this._idleTimer = null;
    this._compactInProgress = false;
    this._currentProviderId = null;

    // Detect interrupted compaction: if the app was force-quit during a compaction
    // the stored flag will be true while nothing is actually running.
    this._interruptedCompaction = saved.compactInProgress === true;
    if (this._interruptedCompaction) {
      // Clear the stale flag immediately so it only shows once per launch.
      const current = this.store.get("autoCompactState") || {};
      this.store.set("autoCompactState", {
        ...current,
        compactInProgress: false,
      });
    }
  }

  /** Wired to PythonProcessManager via onImageEvicted. */
  notifyImageEvicted({ freed_bytes }) {
    if (process.platform !== "win32") return;
    if (!this._enabled) return;

    if (!Number.isFinite(freed_bytes) || freed_bytes <= 0) return;

    this._freedSinceLastCompact += freed_bytes;
    this._persistState();
    this._maybeStartIdleWatch();
  }

  /** Wired to electron.cjs IPC `openfork_client:provider-id` so we know which row to flag. */
  setCurrentProviderId(providerId) {
    this._currentProviderId = providerId || null;
  }

  /** Manual reclaim resets the running tally — user already compacted. */
  notifyManualCompactCompleted() {
    this._freedSinceLastCompact = 0;
    this._lastCompactTs = Date.now();
    this._persistState();
  }

  setEnabled(enabled) {
    this._enabled = !!enabled;
    const saved = this.store.get("autoCompactState") || {};
    this.store.set("autoCompactState", { ...saved, enabled: this._enabled });
    if (!this._enabled) this._stopIdleWatch();
  }

  isEnabled() {
    return this._enabled;
  }

  setThresholdBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 1024 ** 3) return;
    this._thresholdBytes = bytes;
    this._persistState();
  }

  getStatus() {
    return {
      enabled: this._enabled,
      freedBytes: this._freedSinceLastCompact,
      thresholdBytes: this._thresholdBytes,
      lastCompactTs: this._lastCompactTs,
      compactInProgress: this._compactInProgress,
      platformSupported: process.platform === "win32",
      interruptedCompaction: this._interruptedCompaction,
    };
  }

  clearInterruptedCompaction() {
    this._interruptedCompaction = false;
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _persistState() {
    this.store.set("autoCompactState", {
      freedSinceLastCompact: this._freedSinceLastCompact,
      lastCompactTs: this._lastCompactTs,
      enabled: this._enabled,
      thresholdBytes: this._thresholdBytes,
      compactInProgress: this._compactInProgress,
    });
  }

  _shouldCompact() {
    if (process.platform !== "win32") return false;
    if (!this._enabled) return false;
    if (this._compactInProgress) return false;
    if (this._freedSinceLastCompact < this._thresholdBytes) return false;
    if (
      Date.now() - this._lastCompactTs <
      AutoCompactManager.MIN_COMPACT_GAP_MS
    )
      return false;
    return true;
  }

  _isIdle() {
    if (!this.pythonManager) return false;
    return (
      this.pythonManager.isRunning() &&
      !this.pythonManager.hasActiveJob() &&
      !this.pythonManager.hasQueuedDownloads()
    );
  }

  _maybeStartIdleWatch() {
    if (!this._shouldCompact()) return;
    if (this._idleTimer) return;
    this._idleTimer = setInterval(
      () => this._tickIdleCheck(),
      AutoCompactManager.IDLE_CHECK_INTERVAL_MS,
    );
    // Run once immediately so a long-idle session doesn't wait 30 s.
    this._tickIdleCheck();
  }

  _stopIdleWatch() {
    if (this._idleTimer) {
      clearInterval(this._idleTimer);
      this._idleTimer = null;
    }
  }

  _tickIdleCheck() {
    if (!this._shouldCompact()) {
      this._stopIdleWatch();
      return;
    }
    if (!this._isIdle()) return;
    if (!this._currentProviderId) {
      // No provider id yet (Python registering / restarting). Wait for the next tick.
      return;
    }
    this._stopIdleWatch();
    this._runCompactionFlow().catch((err) => {
      console.error("AutoCompactManager: compaction flow failed:", err);
    });
  }

  async _runCompactionFlow() {
    this._compactInProgress = true;
    this._interruptedCompaction = false;
    this._persistState();
    this._notify("auto-compact:status", { phase: "starting" });

    const providerId = this._currentProviderId;
    const lastService = this.pythonManager.getLastService?.();
    const lastRoutingConfig = this.pythonManager.getLastRoutingConfig?.();
    const wasMonitoring =
      this.dockerMonitor?.isDockerMonitoringActive?.() ?? false;

    let pausedSet = false;
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send("openfork_client:log", {
          type: "stdout",
          message: `Auto-compact: ${Math.round(this._freedSinceLastCompact / 1024 ** 3)} GB of Docker images evicted since last compaction. Pausing DGN client to reclaim disk space...`,
        });
      }
      // 1. Tell the orchestrator we are pausing job acceptance.
      try {
        this.pythonManager.setCompactionPending?.(true);
        const pauseResult = await this.setProviderPausedForCompaction(
          providerId,
          true,
        );
        if (!pauseResult?.success) {
          throw new Error(
            pauseResult?.error || "Could not pause provider for compaction.",
          );
        }
        pausedSet = true;
      } catch (err) {
        throw new Error(
          `Could not pause provider for compaction: ${err?.message || err}`,
        );
      }

      // 2. Stop Python so the VHDX is released.
      this._notify("auto-compact:status", { phase: "stopping_client" });
      await this.pythonManager.stop();

      // 3. Run the existing compaction script. Reuses the manual flow.
      this._notify("auto-compact:status", { phase: "compacting" });
      this.dockerMonitor?.stopDockerMonitoring?.();
      this.dockerMonitor?.resetDockerRoutingCache?.();

      const wslDistro = (await this.wslUtils?.getWslDistroName?.()) ?? null;
      if (!wslDistro) {
        throw new Error("WSL distro not found; aborting auto-compact.");
      }
      const scriptPath = this.app.isPackaged
        ? path.join(process.resourcesPath, "scripts", "compact-wsl.ps1")
        : path.join(__dirname, "..", "scripts", "compact-wsl.ps1");

      await this._runPowerShell(scriptPath, wslDistro);

      // Ensure WSL Docker is reachable before restarting Python.
      // Compaction can leave the VHDX briefly locked or WSL stopped.
      try {
        const dockerStatus = await this.dockerEngine.resolveDockerStatus({
          allowNativeStart: false,
          wslHostTimeoutMs: 10000,
        });
        if (!dockerStatus.running) {
          this._notify("auto-compact:status", { phase: "recovering_wsl" });
          await this.dockerEngine.restartWslDockerEngine({
            wslDistro,
            onPhase: (phase) => {
              this._notify("auto-compact:status", {
                phase: `recovering_${phase}`,
              });
            },
          });
        }
      } catch (recoveryErr) {
        console.error(
          "AutoCompactManager: post-compaction WSL recovery failed:",
          recoveryErr,
        );
      }

      // 4. Reset counters.
      this._freedSinceLastCompact = 0;
      this._lastCompactTs = Date.now();
      this._persistState();
      this._notify("auto-compact:status", { phase: "completed" });
    } catch (err) {
      console.error("AutoCompactManager: compaction failed:", err);
      this._notify("auto-compact:status", {
        phase: "failed",
        error: err?.message || String(err),
      });
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send("openfork_client:log", {
          type: "stderr",
          message: `Auto-compact failed: ${err?.message || err}. Client will restart.`,
        });
      }
    } finally {
      // Always update the attempt timestamp so _shouldCompact() enforces the
      // 1-hour cooldown even after a failed compaction. Without this, a failed
      // compact leaves _freedSinceLastCompact above threshold and _lastCompactTs
      // unchanged, causing compaction to re-trigger on the next eviction event
      // (a stop → fail → restart → stop loop).
      if (
        this._lastCompactTs === 0 ||
        Date.now() - this._lastCompactTs > 1000
      ) {
        this._lastCompactTs = Date.now();
        this._persistState();
      }
      this.pythonManager.setCompactionPending?.(false);
      // 5. Restart Python with the previous service/routing config.
      try {
        if (lastService && !this.pythonManager.isRunning()) {
          this._notify("auto-compact:status", { phase: "restarting_client" });
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send("openfork_client:log", {
              type: "stdout",
              message: "Auto-compact finished. Restarting DGN client...",
            });
          }
          await this.pythonManager.start(lastService, lastRoutingConfig);
        }
      } catch (err) {
        console.error("AutoCompactManager: failed to restart client:", err);
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send("openfork_client:log", {
            type: "stderr",
            message: `Auto-compact: failed to restart DGN client: ${err?.message || err}`,
          });
        }
      }
      // 6. Clear the orchestrator pause flag (best-effort).
      if (pausedSet) {
        try {
          await this.setProviderPausedForCompaction(providerId, false);
        } catch (err) {
          console.warn(
            "AutoCompactManager: could not clear provider pause flag:",
            err?.message || err,
          );
        }
      }
      // 7. Restart Docker monitoring if it was active.
      this.dockerMonitor?.resetDockerRoutingCache?.();
      if (wasMonitoring) {
        this.dockerMonitor?.startDockerMonitoring?.();
      }
      this._compactInProgress = false;
      this._persistState();
    }
  }

  _runPowerShell(scriptPath, wslDistro) {
    return new Promise((resolve, reject) => {
      execFile(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          scriptPath,
          "-DistroName",
          wslDistro,
        ],
        { windowsHide: true, timeout: 10 * 60 * 1000 },
        (error, stdout, stderr) => {
          if (error) {
            const detail = (stderr || stdout || error.message)
              .toString()
              .trim();
            reject(new Error(detail || "compact-wsl.ps1 failed"));
          } else {
            resolve();
          }
        },
      );
    });
  }

  _notify(channel, payload) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, {
        ...payload,
        ...this.getStatus(),
      });
    }
  }
}

module.exports = { AutoCompactManager };
