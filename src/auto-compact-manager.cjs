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
  static RECOVERY_POLL_INTERVAL_MS = 5000;

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
    this._recoveryTimer = null;
    this._recoveryProbeInFlight = false;
    this._ownedCompactionFlow = false;
    this._compactInProgress =
      process.platform === "win32" && saved.compactInProgress === true;
    this._phase = this._compactInProgress
      ? saved.phase || "waiting_for_compaction"
      : saved.phase || undefined;
    this._lastError = saved.error || undefined;
    this._compactPid = Number(saved.compactPid || 0) || null;
    this._compactStartedTs = Number(saved.compactStartedTs || 0) || 0;
    this._restartAfterCompact = !!saved.restartAfterCompact;
    this._lastServiceForRestart = saved.lastService || null;
    this._lastRoutingConfigForRestart = saved.lastRoutingConfig || null;
    this._pausedProviderId = saved.pausedProviderId || null;
    this._currentProviderId = null;

    // If the app restarts while compact-wsl.ps1 or DiskPart is still holding
    // the VHDX, keep the state active until a host-side probe proves otherwise.
    this._interruptedCompaction = false;
    if (this._compactInProgress) {
      this._persistState();
      setTimeout(() => this._startRecoveryWatch(), 0);
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

  // ── Internal ──────────────────────────────────────────────────────────────

  _persistState() {
    this.store.set("autoCompactState", {
      freedSinceLastCompact: this._freedSinceLastCompact,
      lastCompactTs: this._lastCompactTs,
      enabled: this._enabled,
      thresholdBytes: this._thresholdBytes,
      compactInProgress: this._compactInProgress,
      phase: this._phase,
      error: this._lastError,
      compactPid: this._compactPid,
      compactStartedTs: this._compactStartedTs,
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
    this._freedSinceLastCompact = 0;
    this._lastCompactTs = Date.now();
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
    const wslDistro = await this.wslUtils?.getWslDistroName?.();
    if (!wslDistro) return false;
    return await this._isWslAttachBlockedBySharingViolation(wslDistro);
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

  _isWslAttachBlockedBySharingViolation(wslDistro) {
    return new Promise((resolve) => {
      execFile(
        "wsl.exe",
        ["-d", wslDistro, "--", "true"],
        { windowsHide: true, timeout: 6000, encoding: "utf8" },
        (error, stdout, stderr) => {
          if (!error) {
            resolve(false);
            return;
          }
          const combined = `${error.message}\n${stdout || ""}\n${
            stderr || ""
          }`.toLowerCase();
          resolve(
            combined.includes("sharing_violation") ||
              combined.includes("error_sharing_violation") ||
              combined.includes("attach disk") ||
              combined.includes("hcs/error_sharing_violation"),
          );
        },
      );
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
    const providerId = this._currentProviderId;
    const lastService = this.pythonManager.getLastService?.();
    const lastRoutingConfig = this.pythonManager.getLastRoutingConfig?.();
    const wasMonitoring =
      this.dockerMonitor?.isDockerMonitoringActive?.() ?? false;

    let pausedSet = false;
    let flowFailed = false;

    this._ownedCompactionFlow = true;
    this._compactInProgress = true;
    this._interruptedCompaction = false;
    this._lastError = undefined;
    this._compactStartedTs = Date.now();
    this._restartAfterCompact = !!lastService;
    this._lastServiceForRestart = lastService || null;
    this._lastRoutingConfigForRestart = lastRoutingConfig || null;
    this._pausedProviderId = providerId || null;
    this._setPhase("starting");

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
      this._setPhase("stopping_client");
      await this.pythonManager.stop();

      // 3. Run the existing compaction script. Reuses the manual flow.
      this._setPhase("compacting");
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
          this._setPhase("recovering_wsl");
          await this.dockerEngine.restartWslDockerEngine({
            wslDistro,
            onPhase: (phase) => {
              this._setPhase(`recovering_${phase}`);
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
      // 7. Restart Docker monitoring if it was active.
      this.dockerMonitor?.resetDockerRoutingCache?.();
      if (wasMonitoring) {
        this.dockerMonitor?.startDockerMonitoring?.();
      }
      this._compactInProgress = false;
      this._ownedCompactionFlow = false;
      this._compactPid = null;
      this._compactStartedTs = 0;
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
    }
  }

  _runPowerShell(scriptPath, wslDistro) {
    return new Promise((resolve, reject) => {
      const child = execFile(
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
      this._compactPid = child.pid || null;
      this._persistState();
    });
  }

  _notify(channel, payload) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, {
        ...this.getStatus(),
        ...payload,
      });
    }
  }
}

module.exports = { AutoCompactManager };
