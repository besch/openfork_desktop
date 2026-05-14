const { execFile } = require("child_process");
const {
  recoverWslDockerAfterCompaction,
  runCompactWslScript,
} = require("./compaction-utils.cjs");

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
  static DEFAULT_THRESHOLD_BYTES = 75 * 1024 ** 3; // 75 GB
  static DEFAULT_HOST_FREE_GATE_BYTES = 30 * 1024 ** 3; // compact only when the host drive is low
  static STALE_VHDX_BASE_ALLOWANCE_BYTES = 40 * 1024 ** 3;
  static STALE_VHDX_MIN_SIZE_BYTES = 160 * 1024 ** 3;
  static IDLE_CHECK_INTERVAL_MS = 30 * 1000; // 30 seconds
  static MIN_COMPACT_GAP_MS = 60 * 60 * 1000; // 1 hour minimum between auto-compactions
  static MIN_STALE_VHDX_COMPACT_GAP_MS = 24 * 60 * 60 * 1000;
  static RECOVERY_POLL_INTERVAL_MS = 5000;
  static EXTERNAL_LOCK_MIN_QUIET_MS = 20 * 1000;
  static EXTERNAL_RECOVERY_STABLE_PROBES = 2;

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
    const savedThresholdBytes = Number(saved.thresholdBytes) || 0;
    this._thresholdBytes =
      savedThresholdBytes >= 50 * 1024 ** 3
        ? savedThresholdBytes
        : AutoCompactManager.DEFAULT_THRESHOLD_BYTES;

    this._idleTimer = null;
    this._recoveryTimer = null;
    this._recoveryProbeInFlight = false;
    this._idleCheckInFlight = false;
    this._ownedCompactionFlow = false;
    this._compactInProgress =
      process.platform === "win32" && saved.compactInProgress === true;
    this._phase = this._compactInProgress
      ? saved.phase || "waiting_for_compaction"
      : saved.phase || undefined;
    this._lastError = saved.error || undefined;
    this._compactPid = Number(saved.compactPid || 0) || null;
    this._compactStartedTs = Number(saved.compactStartedTs || 0) || 0;
    this._lastExternalLockTs = Number(saved.lastExternalLockTs || 0) || 0;
    this._externalStableProbeCount = 0;
    this._restartAfterCompact = !!saved.restartAfterCompact;
    this._lastServiceForRestart = saved.lastService || null;
    this._lastRoutingConfigForRestart = saved.lastRoutingConfig || null;
    this._pausedProviderId = saved.pausedProviderId || null;
    this._currentProviderId = null;
    this._hostFreeBytes = null;
    this._deferredByHostFreeSpace = false;
    this._engineFileBytes = Number(saved.engineFileBytes || 0) || null;
    this._imageCacheBytes =
      Number.isFinite(Number(saved.imageCacheBytes))
        ? Number(saved.imageCacheBytes)
        : null;
    this._imageCacheCount =
      Number.isFinite(Number(saved.imageCacheCount))
        ? Number(saved.imageCacheCount)
        : null;
    this._buildCacheBytes =
      Number.isFinite(Number(saved.buildCacheBytes))
        ? Number(saved.buildCacheBytes)
        : null;
    this._buildCacheReclaimableBytes =
      Number.isFinite(Number(saved.buildCacheReclaimableBytes))
        ? Number(saved.buildCacheReclaimableBytes)
        : null;
    this._buildCacheCount =
      Number.isFinite(Number(saved.buildCacheCount))
        ? Number(saved.buildCacheCount)
        : null;
    this._estimatedReclaimableBytes =
      Number(saved.estimatedReclaimableBytes || 0) || 0;
    this._staleVhdxCompactPending = saved.staleVhdxCompactPending === true;
    this._storageLimitCompactPending =
      saved.storageLimitCompactPending === true;
    this._manualDeleteAllCompactPending =
      saved.manualDeleteAllCompactPending === true;
    this._lastStaleVhdxCompactTs =
      Number(saved.lastStaleVhdxCompactTs || 0) || 0;

    // If the app restarts while compact-wsl.ps1 or DiskPart is still holding
    // the VHDX, keep the state active until a host-side probe proves otherwise.
    this._interruptedCompaction = false;
    if (this._compactInProgress) {
      this._persistState();
      setTimeout(() => this._startRecoveryWatch(), 0);
    } else if (this._shouldCompactBase()) {
      setTimeout(() => {
        this._maybeStartIdleWatch().catch((err) => {
          console.warn(
            "AutoCompactManager: could not resume pending idle watch:",
            err?.message || err,
          );
        });
      }, 0);
    }
  }

  /** Wired to PythonProcessManager via onImageEvicted. */
  notifyImageEvicted({ freed_bytes, reason }) {
    if (process.platform !== "win32") return;
    const isManualDeleteAll = reason === "manual_delete_all";
    if (
      isManualDeleteAll &&
      this.dockerEngine?.isUsingWslDocker?.() !== true
    ) {
      return;
    }
    if (!this._enabled && !isManualDeleteAll) return;

    if (!Number.isFinite(freed_bytes) || freed_bytes <= 0) {
      if (!isManualDeleteAll) return;
      freed_bytes = 0;
    }

    this._freedSinceLastCompact += freed_bytes;
    if (reason === "storage_limit") {
      this._storageLimitCompactPending = true;
      this._sendPendingCompactionPauseToPython();
    } else if (isManualDeleteAll) {
      this._manualDeleteAllCompactPending = true;
      this._sendPendingCompactionPauseToPython();
    }
    this._persistState();
    this._maybeStartIdleWatch().catch((err) => {
      console.warn(
        "AutoCompactManager: could not start idle watch:",
        err?.message || err,
      );
    });
  }

  /**
   * Observe current WSL VHDX and OpenFork image-cache sizes.
   *
   * This catches the "large VHDX, no recent IMAGE_EVICTED event" case: for
   * example, images were removed manually before this app session, or Docker
   * accumulated dangling layers.
   */
  notifyStorageObserved({
    engineFileBytes,
    imageCacheBytes,
    imageCacheCount,
    buildCacheBytes,
    buildCacheReclaimableBytes,
    buildCacheCount,
    hostFreeBytes,
  } = {}) {
    if (process.platform !== "win32") return;
    if (!this._enabled) return;

    let changed = false;
    const updateNumber = (key, value, isValid) => {
      if (!isValid(value)) return;
      if (this[key] !== value) {
        this[key] = value;
        changed = true;
      }
    };

    updateNumber(
      "_engineFileBytes",
      engineFileBytes,
      (value) => Number.isFinite(value) && value > 0,
    );
    updateNumber(
      "_imageCacheBytes",
      imageCacheBytes,
      (value) => Number.isFinite(value) && value >= 0,
    );
    updateNumber(
      "_imageCacheCount",
      imageCacheCount,
      (value) => Number.isFinite(value) && value >= 0,
    );
    updateNumber(
      "_buildCacheBytes",
      buildCacheBytes,
      (value) => Number.isFinite(value) && value >= 0,
    );
    updateNumber(
      "_buildCacheReclaimableBytes",
      buildCacheReclaimableBytes,
      (value) => Number.isFinite(value) && value >= 0,
    );
    updateNumber(
      "_buildCacheCount",
      buildCacheCount,
      (value) => Number.isFinite(value) && value >= 0,
    );
    updateNumber(
      "_hostFreeBytes",
      hostFreeBytes,
      (value) => Number.isFinite(value) && value >= 0,
    );

    const hasVhdxAndCacheObservation =
      Number.isFinite(this._engineFileBytes) &&
      this._engineFileBytes > 0 &&
      Number.isFinite(this._imageCacheBytes) &&
      this._imageCacheBytes >= 0;

    if (hasVhdxAndCacheObservation) {
      const nextEstimatedReclaimableBytes = Math.max(
        0,
        this._engineFileBytes -
          this._imageCacheBytes -
          AutoCompactManager.STALE_VHDX_BASE_ALLOWANCE_BYTES,
        this._buildCacheReclaimableBytes || 0,
      );
      const nextStaleVhdxCompactPending =
        this._engineFileBytes >= AutoCompactManager.STALE_VHDX_MIN_SIZE_BYTES &&
        nextEstimatedReclaimableBytes >= this._thresholdBytes;

      if (this._estimatedReclaimableBytes !== nextEstimatedReclaimableBytes) {
        this._estimatedReclaimableBytes = nextEstimatedReclaimableBytes;
        changed = true;
      }
      if (this._staleVhdxCompactPending !== nextStaleVhdxCompactPending) {
        this._staleVhdxCompactPending = nextStaleVhdxCompactPending;
        changed = true;
      }
    }

    if (changed) {
      this._persistState();
      this._notify("auto-compact:status", {});
    }

    if (this._storageLimitCompactPending) {
      this._sendPendingCompactionPauseToPython();
    }

    if (
      this._storageLimitCompactPending ||
      this._staleVhdxCompactPending ||
      this._manualDeleteAllCompactPending
    ) {
      this._maybeStartIdleWatch().catch((err) => {
        console.warn(
          "AutoCompactManager: could not start pending idle watch:",
          err?.message || err,
        );
      });
    }
  }

  /** Wired to electron.cjs IPC `openfork_client:provider-id` so we know which row to flag. */
  setCurrentProviderId(providerId) {
    this._currentProviderId = providerId || null;
  }

  /** Manual reclaim resets the running tally — user already compacted. */
  notifyManualCompactCompleted() {
    this._freedSinceLastCompact = 0;
    this._lastCompactTs = Date.now();
    this._lastStaleVhdxCompactTs = this._lastCompactTs;
    this._staleVhdxCompactPending = false;
    this._storageLimitCompactPending = false;
    this._manualDeleteAllCompactPending = false;
    this._estimatedReclaimableBytes = 0;
    this._buildCacheBytes = 0;
    this._buildCacheReclaimableBytes = 0;
    this._buildCacheCount = 0;
    this._persistState();
  }

  setEnabled(enabled) {
    this._enabled = !!enabled;
    const saved = this.store.get("autoCompactState") || {};
    this.store.set("autoCompactState", { ...saved, enabled: this._enabled });
    if (!this._enabled && !this._manualDeleteAllCompactPending) {
      this._stopIdleWatch();
    } else if (this._manualDeleteAllCompactPending) {
      this._maybeStartIdleWatch().catch((err) => {
        console.warn(
          "AutoCompactManager: could not resume delete-all compaction:",
          err?.message || err,
        );
      });
    }
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
      hostFreeGateBytes: AutoCompactManager.DEFAULT_HOST_FREE_GATE_BYTES,
      hostFreeBytes: this._hostFreeBytes,
      deferredByHostFreeSpace: this._deferredByHostFreeSpace,
      engineFileBytes: this._engineFileBytes,
      imageCacheBytes: this._imageCacheBytes,
      imageCacheCount: this._imageCacheCount,
      buildCacheBytes: this._buildCacheBytes,
      buildCacheReclaimableBytes: this._buildCacheReclaimableBytes,
      buildCacheCount: this._buildCacheCount,
      estimatedReclaimableBytes: this._estimatedReclaimableBytes,
      staleVhdxCompactPending: this._staleVhdxCompactPending,
      storageLimitCompactPending: this._storageLimitCompactPending,
      manualDeleteAllCompactPending: this._manualDeleteAllCompactPending,
      lastCompactTs: this._lastCompactTs,
      compactInProgress: this._compactInProgress,
      platformSupported: process.platform === "win32",
      interruptedCompaction: this._interruptedCompaction,
      phase: this._phase,
      error: this._lastError,
      restartAfterCompact: this._restartAfterCompact,
    };
  }

  clearInterruptedCompaction() {
    this._interruptedCompaction = false;
    this._persistState();
  }

  isCompactionInProgress() {
    return this._compactInProgress;
  }

  async refreshCompactionStatus() {
    if (!this._compactInProgress) return this.getStatus();
    if (this._ownedCompactionFlow) return this.getStatus();
    if (process.platform !== "win32") {
      this._compactInProgress = false;
      this._phase = undefined;
      this._persistState();
      return this.getStatus();
    }

    const active = await this._isHostCompactionActive();
    if (!active) {
      await this._completeRecoveredCompaction();
    }
    return this.getStatus();
  }

  adoptExternalCompaction(details = {}) {
    if (process.platform !== "win32") return this.getStatus();

    const now = Date.now();
    let shouldPauseProvider = false;
    const lastService =
      this.pythonManager?.getLastService?.() || this._lastServiceForRestart;
    const lastRoutingConfig =
      this.pythonManager?.getLastRoutingConfig?.() ||
      this._lastRoutingConfigForRestart;

    if (!this._compactInProgress) {
      this._compactInProgress = true;
      this._ownedCompactionFlow = false;
      this._interruptedCompaction = false;
      this._phase = "external_compacting";
      this._lastError = undefined;
      this._compactStartedTs = now;
      this._lastExternalLockTs = now;
      this._externalStableProbeCount = 0;
      this._restartAfterCompact = !!lastService;
      this._lastServiceForRestart = lastService || null;
      this._lastRoutingConfigForRestart = lastRoutingConfig || null;
      this._pausedProviderId = this._currentProviderId || this._pausedProviderId;
      shouldPauseProvider = !!this._pausedProviderId;
      this._persistState();
      this._notify("auto-compact:status", {
        phase: this._phase,
        external: true,
        source: details.source,
      });
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send("openfork_client:log", {
          type: "stdout",
          message:
            "OpenFork detected that the Ubuntu disk is locked by a host disk operation. Treating it as active disk compaction and waiting for it to finish.",
        });
      }
    } else if (this._phase === "waiting_for_compaction") {
      this._phase = "external_compacting";
      this._lastExternalLockTs = now;
      this._externalStableProbeCount = 0;
      this._pausedProviderId = this._currentProviderId || this._pausedProviderId;
      shouldPauseProvider = !!this._pausedProviderId;
      this._persistState();
      this._notify("auto-compact:status", {
        phase: this._phase,
        external: true,
        source: details.source,
      });
    } else if (this._phase === "external_compacting") {
      this._lastExternalLockTs = now;
      this._externalStableProbeCount = 0;
      this._persistState();
    }

    if (this.pythonManager?.isRunning?.()) {
      this.pythonManager.setCompactionPending?.(true);
    }
    if (
      shouldPauseProvider &&
      this._pausedProviderId &&
      typeof this.setProviderPausedForCompaction === "function"
    ) {
      this.setProviderPausedForCompaction(this._pausedProviderId, true).then(
        (result) => {
          if (!result?.success) {
            console.warn(
              "AutoCompactManager: could not pause provider for external compaction:",
              result?.error || "unknown error",
            );
          }
        },
        (err) => {
          console.warn(
            "AutoCompactManager: provider pause request failed:",
            err?.message || err,
          );
        },
      );
    }
    this.dockerMonitor?.stopDockerMonitoring?.();
    this.dockerMonitor?.resetDockerRoutingCache?.();
    this._startRecoveryWatch();
    return this.getStatus();
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _sendPendingCompactionPauseToPython() {
    if (
      !this._storageLimitCompactPending &&
      !this._manualDeleteAllCompactPending
    ) {
      return;
    }
    if (this.pythonManager?.isRunning?.()) {
      this.pythonManager.setCompactionPending?.(true);
    }
  }

  _persistState() {
    this.store.set("autoCompactState", {
      freedSinceLastCompact: this._freedSinceLastCompact,
      lastCompactTs: this._lastCompactTs,
      enabled: this._enabled,
      thresholdBytes: this._thresholdBytes,
      hostFreeGateBytes: AutoCompactManager.DEFAULT_HOST_FREE_GATE_BYTES,
      hostFreeBytes: this._hostFreeBytes,
      deferredByHostFreeSpace: this._deferredByHostFreeSpace,
      engineFileBytes: this._engineFileBytes,
      imageCacheBytes: this._imageCacheBytes,
      imageCacheCount: this._imageCacheCount,
      buildCacheBytes: this._buildCacheBytes,
      buildCacheReclaimableBytes: this._buildCacheReclaimableBytes,
      buildCacheCount: this._buildCacheCount,
      estimatedReclaimableBytes: this._estimatedReclaimableBytes,
      staleVhdxCompactPending: this._staleVhdxCompactPending,
      storageLimitCompactPending: this._storageLimitCompactPending,
      manualDeleteAllCompactPending: this._manualDeleteAllCompactPending,
      lastStaleVhdxCompactTs: this._lastStaleVhdxCompactTs,
      compactInProgress: this._compactInProgress,
      phase: this._phase,
      error: this._lastError,
      compactPid: this._compactPid,
      compactStartedTs: this._compactStartedTs,
      lastExternalLockTs: this._lastExternalLockTs,
      restartAfterCompact: this._restartAfterCompact,
      lastService: this._lastServiceForRestart,
      lastRoutingConfig: this._lastRoutingConfigForRestart,
      pausedProviderId: this._pausedProviderId,
    });
  }

  _setPhase(phase, extra = {}) {
    this._phase = phase;
    if (extra.error !== undefined) {
      this._lastError = extra.error;
    }
    this._persistState();
    this._notify("auto-compact:status", extra);
  }

  _startRecoveryWatch() {
    if (!this._compactInProgress || this._recoveryTimer) return;
    this._notify("auto-compact:status", { phase: this._phase });
    this._recoveryTimer = setInterval(
      () => this._tickRecoveryWatch(),
      AutoCompactManager.RECOVERY_POLL_INTERVAL_MS,
    );
    this._tickRecoveryWatch();
  }

  _stopRecoveryWatch() {
    if (this._recoveryTimer) {
      clearInterval(this._recoveryTimer);
      this._recoveryTimer = null;
    }
  }

  async _tickRecoveryWatch() {
    if (this._recoveryProbeInFlight) return;
    this._recoveryProbeInFlight = true;
    try {
      await this.refreshCompactionStatus();
    } catch (err) {
      console.warn(
        "AutoCompactManager: recovery compaction probe failed:",
        err?.message || err,
      );
    } finally {
      this._recoveryProbeInFlight = false;
    }
  }

  async _completeRecoveredCompaction() {
    this._stopRecoveryWatch();
    this._compactInProgress = false;
    this._ownedCompactionFlow = false;
    this._compactPid = null;
    this._compactStartedTs = 0;
    this._lastExternalLockTs = 0;
    this._externalStableProbeCount = 0;
    this._freedSinceLastCompact = 0;
    this._lastCompactTs = Date.now();
    this._lastStaleVhdxCompactTs = this._lastCompactTs;
    this._staleVhdxCompactPending = false;
    this._storageLimitCompactPending = false;
    this._manualDeleteAllCompactPending = false;
    this._estimatedReclaimableBytes = 0;
    this._buildCacheBytes = 0;
    this._buildCacheReclaimableBytes = 0;
    this._buildCacheCount = 0;
    this._lastError = undefined;

    const service = this._lastServiceForRestart;
    const routingConfig = this._lastRoutingConfigForRestart;
    const providerId = this._pausedProviderId;
    const shouldRestart = this._restartAfterCompact && !!service;

    this._phase = "completed";
    this._persistState();
    this._notify("auto-compact:status", {
      phase: "completed",
      recoveredAfterRestart: true,
    });
    if (this.pythonManager?.isRunning?.()) {
      this.pythonManager.setCompactionPending?.(false);
    }

    if (providerId) {
      try {
        const resumeResult = await this.setProviderPausedForCompaction(
          providerId,
          false,
        );
        if (!resumeResult?.success) {
          console.warn(
            "AutoCompactManager: recovered provider pause flag is still set:",
            resumeResult?.error || "unknown error",
          );
        }
      } catch (err) {
        console.warn(
          "AutoCompactManager: could not clear recovered provider pause flag:",
          err?.message || err,
        );
      }
    }

    if (shouldRestart && this.pythonManager && !this.pythonManager.isRunning()) {
      try {
        this._setPhase("restarting_client");
        await this.pythonManager.start(service, routingConfig);
        this._phase = "completed";
        this._lastError = undefined;
        this._persistState();
        this._notify("auto-compact:status", {
          phase: "completed",
          recoveredAfterRestart: true,
        });
      } catch (err) {
        this._phase = "failed";
        this._lastError = `Failed to restart DGN client after compaction: ${
          err?.message || err
        }`;
        this._persistState();
        this._notify("auto-compact:status", {
          phase: "failed",
          error: this._lastError,
        });
      }
    }

    this._restartAfterCompact = false;
    this._lastServiceForRestart = null;
    this._lastRoutingConfigForRestart = null;
    this._pausedProviderId = null;
    this._persistState();
  }

  async _isHostCompactionActive() {
    if (this._compactPid && (await this._isProcessRunning(this._compactPid))) {
      return true;
    }
    if (await this._hasCompactPowerShellProcess()) {
      return true;
    }
    if (await this._hasDiskPartProcess()) {
      return true;
    }
    const wslDistro = await this.wslUtils?.getWslDistroName?.();
    if (!wslDistro) return false;
    const attachStatus = await this._probeWslAttachStatus(wslDistro);
    if (attachStatus === "blocked") {
      this._noteExternalLockObserved();
      return true;
    }
    if (this._phase === "external_compacting") {
      return this._isExternalCompactionStillActive(wslDistro, attachStatus);
    }
    if (attachStatus === "ok") return false;

    // On app restart while DiskPart is still compacting, `wsl.exe -d ... true`
    // can time out instead of returning the usual sharing-violation text. Do
    // not mark compaction complete from that ambiguous probe alone. First,
    // distinguish a normal mounted WSL disk from a host-side DiskPart lock:
    // a running distro keeps ext4.vhdx open even after compaction is done.
    const distroState = await this._getWslDistroState(wslDistro);
    if (distroState === "running") return false;

    // With no compact-wsl/PowerShell/DiskPart process left, an ambiguous WSL
    // probe should not keep the app blocked forever. Docker recovery can handle
    // any remaining WSL service trouble after compaction is cleared.
    return false;
  }

  _noteExternalLockObserved() {
    if (this._phase !== "external_compacting") return;
    this._lastExternalLockTs = Date.now();
    this._externalStableProbeCount = 0;
    this._persistState();
  }

  async _isExternalCompactionStillActive(wslDistro, attachStatus) {
    const now = Date.now();
    const lastLockTs = this._lastExternalLockTs || this._compactStartedTs || now;
    if (now - lastLockTs < AutoCompactManager.EXTERNAL_LOCK_MIN_QUIET_MS) {
      return true;
    }

    let dockerStatus = null;
    try {
      dockerStatus = await this.dockerEngine?.resolveDockerStatus?.({
        allowNativeStart: false,
        wslHostTimeoutMs: 5000,
      });
    } catch (err) {
      console.warn(
        "AutoCompactManager: external compaction Docker probe failed:",
        err?.message || err,
      );
    }

    if (dockerStatus?.error === "WSL_VHDX_LOCKED") {
      this._noteExternalLockObserved();
      return true;
    }

    if (attachStatus !== "ok") {
      const distroState = await this._getWslDistroState(wslDistro);
      if (distroState !== "running" && !dockerStatus?.running) {
        // With no host compaction process and no VHDX lock left, this is most
        // likely normal WSL recovery work. Require a second matching probe so a
        // transient timeout cannot flip the UI back and forth.
        this._externalStableProbeCount += 1;
        this._persistState();
        return (
          this._externalStableProbeCount <
          AutoCompactManager.EXTERNAL_RECOVERY_STABLE_PROBES
        );
      }
    }

    this._externalStableProbeCount += 1;
    this._persistState();
    return (
      this._externalStableProbeCount <
      AutoCompactManager.EXTERNAL_RECOVERY_STABLE_PROBES
    );
  }

  _isProcessRunning(pid) {
    return new Promise((resolve) => {
      execFile(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `if (Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue) { '1' }`,
        ],
        { windowsHide: true, timeout: 5000 },
        (error, stdout) => {
          resolve(!error && stdout.toString().trim() === "1");
        },
      );
    });
  }

  _hasCompactPowerShellProcess() {
    return new Promise((resolve) => {
      const command = [
        "$needle = 'compact' + '-wsl.ps1';",
        "$optimize = 'Optimize' + '-VHD';",
        "Get-CimInstance Win32_Process |",
        "Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and (",
        "$_.CommandLine -like \"*$needle*\" -or",
        "$_.CommandLine -like \"*$optimize*\"",
        ") } | Select-Object -First 1 -ExpandProperty ProcessId",
      ].join(" ");

      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", command],
        { windowsHide: true, timeout: 8000 },
        (error, stdout) => {
          resolve(!error && stdout.toString().trim().length > 0);
        },
      );
    });
  }

  _probeWslAttachStatus(wslDistro) {
    return new Promise((resolve) => {
      execFile(
        "wsl.exe",
        ["-d", wslDistro, "--", "true"],
        { windowsHide: true, timeout: 6000, encoding: "utf8" },
        (error, stdout, stderr) => {
          if (!error) {
            resolve("ok");
            return;
          }
          const combined = `${error.message}\n${stdout || ""}\n${
            stderr || ""
          }`.toLowerCase();
          const isSharingViolation =
            combined.includes("sharing_violation") ||
            combined.includes("error_sharing_violation") ||
            combined.includes("attach disk") ||
            combined.includes("hcs/error_sharing_violation");
          resolve(isSharingViolation ? "blocked" : "unknown");
        },
      );
    });
  }

  _hasDiskPartProcess() {
    return new Promise((resolve) => {
      const command = [
        "Get-CimInstance Win32_Process |",
        "Where-Object { $_.ProcessId -ne $PID -and $_.Name -ieq 'diskpart.exe' } |",
        "Select-Object -First 1 -ExpandProperty ProcessId",
      ].join(" ");

      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", command],
        { windowsHide: true, timeout: 8000, encoding: "utf8" },
        (error, stdout) => {
          resolve(!error && stdout.toString().trim().length > 0);
        },
      );
    });
  }

  _getWslDistroState(wslDistro) {
    return new Promise((resolve) => {
      execFile(
        "wsl.exe",
        ["--list", "--verbose"],
        { windowsHide: true, timeout: 5000, encoding: "utf8" },
        (error, stdout) => {
          if (error || !stdout) {
            resolve(null);
            return;
          }

          const targetName = String(wslDistro).toLowerCase();
          const lines = stdout
            .replace(/\0/g, "")
            .split(/\r?\n/)
            .map((line) => line.trim().replace(/^\*\s*/, ""))
            .filter(Boolean);

          for (const line of lines) {
            const parts = line.split(/\s+/);
            if (parts[0]?.toLowerCase() !== targetName) continue;
            const state = parts[1]?.toLowerCase();
            resolve(state || null);
            return;
          }
          resolve(null);
        },
      );
    });
  }

  _shouldCompactBase() {
    if (process.platform !== "win32") return false;
    const manualDeleteAllReady = this._manualDeleteAllCompactPending;
    if (!this._enabled && !manualDeleteAllReady) return false;
    if (this._compactInProgress) return false;
    const evictedBytesReady = this._freedSinceLastCompact >= this._thresholdBytes;
    const staleVhdxReady =
      this._staleVhdxCompactPending &&
      Date.now() - this._lastStaleVhdxCompactTs >=
        AutoCompactManager.MIN_STALE_VHDX_COMPACT_GAP_MS;
    const storageLimitReady = this._storageLimitCompactPending;
    if (
      !evictedBytesReady &&
      !staleVhdxReady &&
      !storageLimitReady &&
      !manualDeleteAllReady
    ) {
      return false;
    }
    if (
      !storageLimitReady &&
      !manualDeleteAllReady &&
      Date.now() - this._lastCompactTs <
      AutoCompactManager.MIN_COMPACT_GAP_MS
    )
      return false;
    return true;
  }

  async _shouldCompact() {
    if (!this._shouldCompactBase()) {
      this._deferredByHostFreeSpace = false;
      return false;
    }

    const freeBytes = await this._getHostFreeBytesForWslDistro();
    this._hostFreeBytes = Number.isFinite(freeBytes) ? freeBytes : null;

    const staleVhdxOnly =
      this._staleVhdxCompactPending &&
      this._freedSinceLastCompact < this._thresholdBytes;
    const storageLimitTriggered = this._storageLimitCompactPending;
    const manualDeleteAllTriggered = this._manualDeleteAllCompactPending;
    if (staleVhdxOnly || storageLimitTriggered || manualDeleteAllTriggered) {
      this._deferredByHostFreeSpace = false;
      return true;
    }

    // If the host free-space probe fails, fall back to the historical behavior
    // so disk pressure cleanup still works on unusual Windows installations.
    if (!Number.isFinite(freeBytes)) {
      this._deferredByHostFreeSpace = false;
      return true;
    }

    this._deferredByHostFreeSpace =
      freeBytes > AutoCompactManager.DEFAULT_HOST_FREE_GATE_BYTES;
    return !this._deferredByHostFreeSpace;
  }

  async _getHostFreeBytesForWslDistro() {
    const wslDistro = await this.wslUtils?.getWslDistroName?.();
    if (!wslDistro) return null;
    const storagePath = await this.wslUtils?.resolveWslStoragePath?.(wslDistro);
    const match = String(storagePath || "").match(/^([a-zA-Z]):/);
    if (!match) return null;
    const drive = `${match[1].toUpperCase()}:`;
    const escapedDrive = drive.replace(/'/g, "''");
    const command = `(Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${escapedDrive}'").FreeSpace`;

    return await new Promise((resolve) => {
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", command],
        { windowsHide: true, timeout: 5000, encoding: "utf8" },
        (error, stdout) => {
          if (error) {
            resolve(null);
            return;
          }
          const value = Number.parseInt(stdout.toString().trim(), 10);
          resolve(Number.isFinite(value) && value >= 0 ? value : null);
        },
      );
    });
  }

  _isIdle() {
    if (!this.pythonManager) return this._manualDeleteAllCompactPending;
    if (!this.pythonManager.isRunning()) {
      return this._manualDeleteAllCompactPending;
    }
    return (
      !this.pythonManager.hasActiveJob() &&
      !this.pythonManager.hasActiveDownload()
    );
  }

  async _maybeStartIdleWatch() {
    if (!this._shouldCompactBase()) return;
    if (this._idleTimer) return;
    if (!(await this._shouldCompact())) {
      this._persistState();
      this._notify("auto-compact:status", {});
      return;
    }
    this._sendPendingCompactionPauseToPython();
    this._idleTimer = setInterval(
      () => this._tickIdleCheck(),
      AutoCompactManager.IDLE_CHECK_INTERVAL_MS,
    );
    // Run once immediately so a long-idle session doesn't wait 30 s.
    this._tickIdleCheck().catch((err) => {
      console.warn(
        "AutoCompactManager: idle check failed:",
        err?.message || err,
      );
    });
  }

  _stopIdleWatch() {
    if (this._idleTimer) {
      clearInterval(this._idleTimer);
      this._idleTimer = null;
    }
  }

  async _tickIdleCheck() {
    if (this._idleCheckInFlight) return;
    this._idleCheckInFlight = true;
    try {
      if (!(await this._shouldCompact())) {
        this._stopIdleWatch();
        this._persistState();
        this._notify("auto-compact:status", {});
        return;
      }
      this._sendPendingCompactionPauseToPython();
      if (!this._isIdle()) return;
      if (this.pythonManager?.isRunning?.() && !this._currentProviderId) {
        // No provider id yet (Python registering / restarting). Wait for the next tick.
        return;
      }
      this._stopIdleWatch();
      this._runCompactionFlow().catch((err) => {
        console.error("AutoCompactManager: compaction flow failed:", err);
      });
    } finally {
      this._idleCheckInFlight = false;
    }
  }

  async _runCompactionFlow() {
    const pythonRunningAtStart = this.pythonManager?.isRunning?.() === true;
    const providerId = pythonRunningAtStart ? this._currentProviderId : null;
    const lastService = pythonRunningAtStart
      ? this.pythonManager?.getLastService?.()
      : null;
    const lastRoutingConfig = pythonRunningAtStart
      ? this.pythonManager?.getLastRoutingConfig?.()
      : null;
    const wasMonitoring =
      this.dockerMonitor?.isDockerMonitoringActive?.() ?? false;

    let pausedSet = false;
    let flowFailed = false;
    const staleVhdxOnly =
      this._staleVhdxCompactPending &&
      this._freedSinceLastCompact < this._thresholdBytes;
    const storageLimitTriggered = this._storageLimitCompactPending;
    const manualDeleteAllTriggered = this._manualDeleteAllCompactPending;

    this._ownedCompactionFlow = true;
    this._compactInProgress = true;
    this._interruptedCompaction = false;
    this._lastError = undefined;
    this._compactStartedTs = Date.now();
    this._restartAfterCompact = pythonRunningAtStart && !!lastService;
    this._lastServiceForRestart = lastService || null;
    this._lastRoutingConfigForRestart = lastRoutingConfig || null;
    this._pausedProviderId = providerId || null;
    this._setPhase("starting");

    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        const logMessage = staleVhdxOnly
          ? `Auto-compact: OpenFork Ubuntu disk is ${Math.round(
              (this._engineFileBytes || 0) / 1024 ** 3,
            )} GB with about ${Math.round(
              this._estimatedReclaimableBytes / 1024 ** 3,
            )} GB likely reclaimable. Pausing DGN client to compact...`
          : storageLimitTriggered
            ? `Auto-compact: storage-limit cleanup freed ${Math.round(
                this._freedSinceLastCompact / 1024 ** 3,
              )} GB. Pausing DGN client before the next queued job to compact...`
            : manualDeleteAllTriggered
              ? `Auto-compact: deleted all OpenFork Docker images and freed ${Math.round(
                  this._freedSinceLastCompact / 1024 ** 3,
                )} GB. ${
                  pythonRunningAtStart
                    ? "Pausing DGN client to compact OpenFork Ubuntu..."
                    : "Compacting OpenFork Ubuntu disk..."
                }`
          : `Auto-compact: ${Math.round(
              this._freedSinceLastCompact / 1024 ** 3,
            )} GB of Docker images evicted since last compaction. Pausing DGN client to reclaim disk space...`;
        this.mainWindow.webContents.send("openfork_client:log", {
          type: "stdout",
          message: logMessage,
        });
      }
      // 1. Tell the orchestrator we are pausing job acceptance.
      if (pythonRunningAtStart) {
        try {
          this.pythonManager.setCompactionPending?.(true);
          if (!providerId) {
            throw new Error("Missing provider id for compaction pause.");
          }
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
      }

      // 2. Stop Python so the VHDX is released.
      if (pythonRunningAtStart) {
        this._setPhase("stopping_client");
        await this.pythonManager.stop();
      }

      if (staleVhdxOnly) {
        this._setPhase("pruning_cache");
        try {
          await this.dockerEngine.execDockerCommand(
            "docker builder prune --force --all --filter until=24h",
          );
        } catch (pruneError) {
          console.warn(
            "AutoCompactManager: could not prune stale Docker build cache:",
            pruneError?.message || pruneError,
          );
        }
      }

      // 3. Run the existing compaction script. Reuses the manual flow.
      this._setPhase("compacting");
      this.dockerMonitor?.stopDockerMonitoring?.();
      this.dockerMonitor?.resetDockerRoutingCache?.();

      const wslDistro = (await this.wslUtils?.getWslDistroName?.()) ?? null;
      if (!wslDistro) {
        throw new Error("WSL distro not found; aborting auto-compact.");
      }
      await runCompactWslScript({
        app: this.app,
        wslDistro,
        timeoutMs: 10 * 60 * 1000,
        onPid: (pid) => {
          this._compactPid = pid;
          this._persistState();
        },
      });

      // Ensure WSL Docker is reachable before restarting Python.
      // Compaction can leave the VHDX briefly locked or WSL stopped.
      await recoverWslDockerAfterCompaction({
        dockerEngine: this.dockerEngine,
        dockerMonitor: this.dockerMonitor,
        wslDistro,
        restartOnAnyNotRunning: true,
        logPrefix: "Auto-compact",
        onBeforeRestart: () => {
          this._setPhase("recovering_wsl");
        },
        onPhase: (phase) => {
          this._setPhase(`recovering_${phase}`);
        },
      });

      // 4. Reset counters.
      this._freedSinceLastCompact = 0;
      this._lastCompactTs = Date.now();
      this._lastStaleVhdxCompactTs = this._lastCompactTs;
      this._staleVhdxCompactPending = false;
      this._storageLimitCompactPending = false;
      this._manualDeleteAllCompactPending = false;
      this._estimatedReclaimableBytes = 0;
      this._buildCacheBytes = 0;
      this._buildCacheReclaimableBytes = 0;
      this._buildCacheCount = 0;
      this._phase = "completed";
      this._persistState();
    } catch (err) {
      flowFailed = true;
      this._phase = "failed";
      this._lastError = err?.message || String(err);
      console.error("AutoCompactManager: compaction failed:", err);
      this._persistState();
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send("openfork_client:log", {
          type: "stderr",
          message: `Auto-compact failed: ${err?.message || err}.${
            pythonRunningAtStart ? " Client will restart." : ""
          }`,
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
        if (this._staleVhdxCompactPending) {
          this._lastStaleVhdxCompactTs = this._lastCompactTs;
        }
        this._persistState();
      }
      if (pythonRunningAtStart) {
        this.pythonManager?.setCompactionPending?.(false);
      }
      // 5. Restart Python with the previous service/routing config.
      try {
        if (
          pythonRunningAtStart &&
          lastService &&
          this.pythonManager &&
          !this.pythonManager.isRunning()
        ) {
          this._setPhase("restarting_client");
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send("openfork_client:log", {
              type: "stdout",
              message: "Auto-compact finished. Restarting DGN client...",
            });
          }
          await this.pythonManager.start(lastService, lastRoutingConfig);
        }
      } catch (err) {
        flowFailed = true;
        this._phase = "failed";
        this._lastError = `Failed to restart DGN client after compaction: ${
          err?.message || err
        }`;
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
          const resumeResult = await this.setProviderPausedForCompaction(
            providerId,
            false,
          );
          if (!resumeResult?.success) {
            console.warn(
              "AutoCompactManager: provider pause flag is still set:",
              resumeResult?.error || "unknown error",
            );
          }
        } catch (err) {
          console.warn(
            "AutoCompactManager: could not clear provider pause flag:",
            err?.message || err,
          );
        }
      }
      this._compactInProgress = false;
      this._ownedCompactionFlow = false;
      this._compactPid = null;
      this._compactStartedTs = 0;
      this._lastExternalLockTs = 0;
      this._externalStableProbeCount = 0;
      this._restartAfterCompact = false;
      this._lastServiceForRestart = null;
      this._lastRoutingConfigForRestart = null;
      this._pausedProviderId = null;
      if (!flowFailed) {
        this._phase = "completed";
        this._lastError = undefined;
      }
      this._persistState();
      this._notify("auto-compact:status", {
        phase: this._phase,
        error: this._lastError,
      });
      // 7. Restart Docker monitoring after the compaction flag is cleared so
      // the monitor does not immediately defer itself.
      this.dockerMonitor?.resetDockerRoutingCache?.();
      if (wasMonitoring) {
        this.dockerMonitor?.startDockerMonitoring?.();
      }
    }
  }

  _notify(channel, payload) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      const status = {
        ...this.getStatus(),
        ...payload,
      };

      // "completed" is a transient notification phase. Routine status updates
      // from storage observations must not resurface the completion banner.
      if (
        channel === "auto-compact:status" &&
        !Object.prototype.hasOwnProperty.call(payload, "phase") &&
        !status.compactInProgress &&
        status.phase === "completed"
      ) {
        status.phase = undefined;
        status.recoveredAfterRestart = undefined;
      }

      this.mainWindow.webContents.send(channel, status);
    }
  }
}

module.exports = { AutoCompactManager };
