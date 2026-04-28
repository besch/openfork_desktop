const { spawn, exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const http = require("http");

class PythonProcessManager {
  constructor({ supabase, mainWindow, userDataPath, onJobEvent, onImageEvicted, onProviderRegistered }) {
    this.pythonProcess = null;
    this.shutdownServerPort = 8000;
    this.supabase = supabase;
    this.mainWindow = mainWindow;
    this.isQuitting = false;
    this.userDataPath = userDataPath;
    this.authSubscription = null;
    this.currentDownloadImage = null; // Track current download to prevent race conditions
    this.onJobEvent = onJobEvent || null; // Optional callback for job events (used by DockerCleanupManager)
    this.onImageEvicted = onImageEvicted || null; // Optional callback for IMAGE_EVICTED events (auto-compact + cleanup UI)
    this.onProviderRegistered = onProviderRegistered || null; // Optional callback when Python reports its provider_id

    // Auth refresh debouncing
    this._lastRefreshAttempt = 0;
    this._refreshInProgress = false;
    this._refreshCooldownMs = 3000; // 3 seconds cooldown

    // Restart settings (stored when start() is called)
    this._lastService = null;
    this._lastRoutingConfig = null;

    // Cleanup synchronization
    this._cleanupPromise = null;

    // Idle predicates: number of jobs currently in flight as reported by Python.
    // Used by AutoCompactManager to gate compaction on a fully idle window.
    this._activeJobIds = new Set();

    this._listenForTokenRefresh();
  }

  isRunning() {
    return this.pythonProcess !== null;
  }

  /** True if Python has reported a JOB_START with no matching JOB_COMPLETE/FAILED/CLEARED yet. */
  hasActiveJob() {
    return this._activeJobIds.size > 0;
  }

  /** True if a Docker image download is currently in flight. */
  hasQueuedDownloads() {
    return this.currentDownloadImage !== null;
  }

  getLastRoutingConfig() {
    return this._lastRoutingConfig;
  }

  getLastService() {
    return this._lastService;
  }

  async cleanupRogueProcesses() {
    // If a cleanup is already in progress, return the existing promise
    if (this._cleanupPromise) {
      return this._cleanupPromise;
    }

    this._cleanupPromise = new Promise((resolve) => {
      const platform = process.platform;
      const marker = "openfork_dgn_client_v1_marker";

      console.log("Cleaning up potential rogue client processes...");

      // Hard cap so a hung shell can't block us forever; the next start() must
      // proceed even if cleanup didn't fully confirm. 8s is generous for both
      // PowerShell startup on Windows and pgrep+kill on Unix.
      const HARD_TIMEOUT_MS = 8000;
      // Brief grace after the kill returns so the OS can release pipes/locks
      // before the next Python process spawns.
      const POST_KILL_GRACE_MS = 200;

      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(hardTimer);
        this._cleanupPromise = null;
        resolve();
      };

      const hardTimer = setTimeout(() => {
        if (!settled) {
          console.warn(
            `Rogue process cleanup did not return within ${HARD_TIMEOUT_MS}ms — proceeding anyway.`
          );
          finish();
        }
      }, HARD_TIMEOUT_MS);

      const cmd = platform === "win32"
        ? `powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*--process-marker=${marker}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`
        : `pgrep -af "${marker}" | awk '{print $1}' | xargs -r kill -9`;

      exec(cmd, (error) => {
        // Non-zero exit just means no matching processes; not an error condition.
        setTimeout(finish, POST_KILL_GRACE_MS);
      });
    });

    return this._cleanupPromise;
  }

  getPythonCommand() {
    const isWin = process.platform === "win32";
    
    // In production, always use the bundled executable
    if (app.isPackaged) {
      const exeName = isWin ? "client.exe" : "client";
      return {
        command: path.join(process.resourcesPath, "bin", exeName),
        args: []
      };
    }
    
    // In development, use the sibling client directory (../client from desktop)
    // This ensures we always use the main client codebase
    const siblingClientDir = path.resolve(__dirname, "..", "..", "client");
    
    const venvPython = isWin 
      ? path.join(siblingClientDir, "venv", "Scripts", "python.exe")
      : path.join(siblingClientDir, "venv", "bin", "python");

    if (fs.existsSync(venvPython) && fs.existsSync(path.join(siblingClientDir, "dgn_client.py"))) {
       console.log(`Dev mode: Found Python venv at ${venvPython}`);
       console.log(`Dev mode: Running from source in ${siblingClientDir}`);
       return {
         command: venvPython,
         args: [path.join(siblingClientDir, "dgn_client.py")]
       };
    }
    
    // Fallback: Look for compiled executable in desktop/bin/client, or desktop/bin itself
    // when the binary was placed directly at that path (not inside a bin/ subdirectory).
    const exeName = isWin ? "client.exe" : "client";
    const binDir = path.join(__dirname, "..", "bin");
    let binPath = path.join(binDir, exeName);
    try {
      const binStat = fs.statSync(binDir);
      if (binStat.isFile()) {
        // 'bin' is the executable itself, not a directory
        binPath = binDir;
      }
    } catch (_) {}

    console.log("Dev mode: Python venv not found, falling back to compiled executable.");
    return {
      command: binPath,
      args: []
    };
  }

  _sendTokensToPython(accessToken, refreshToken) {
    if (!this.pythonProcess || !this.pythonProcess.stdin.writable) {
      if (this.pythonProcess) {
        console.error(
          "Cannot send tokens: Python process stdin not writable."
        );
      } else {
        // Just a debug message if process isn't even supposed to be running
        console.log("Token update skipped: Python process not running.");
      }
      return;
    }

    const command = {
      type: "UPDATE_TOKENS",
      payload: {
        access_token: accessToken,
        refresh_token: refreshToken,
      },
    };

    try {
      this.pythonProcess.stdin.write(JSON.stringify(command) + "\n");
      console.log("Successfully sent token update command to Python process.");
    } catch (error) {
      console.error("Error writing to Python process stdin:", error);
    }
  }

  _sendAuthFailedPermanentlyToPython() {
    if (!this.pythonProcess || !this.pythonProcess.stdin.writable) {
      console.error(
        "Cannot send auth failed command: Python process not running or stdin not writable."
      );
      return;
    }

    const command = {
      type: "AUTH_FAILED_PERMANENTLY",
    };

    try {
      this.pythonProcess.stdin.write(JSON.stringify(command) + "\n");
      console.log("Sent AUTH_FAILED_PERMANENTLY command to Python process.");
    } catch (error) {
      console.error("Error writing to Python process stdin:", error);
    }
  }

  _buildRoutingConfigPayload(routingConfig) {
    const rc = routingConfig || {};
    return {
      process_own_jobs: rc.processOwnJobs ?? false,
      community_mode: rc.communityMode ?? "none",
      allowed_ids: Array.isArray(rc.trustedIds) ? rc.trustedIds : [],
      monetize_mode: rc.monetizeMode ?? false,
    };
  }

  updateRoutingConfig(routingConfig) {
    this._lastRoutingConfig = routingConfig;

    if (!this.pythonProcess || !this.pythonProcess.stdin.writable) {
      console.warn(
        "Cannot update routing config: Python process not running or stdin not writable.",
      );
      return false;
    }

    const command = {
      type: "UPDATE_ROUTING_CONFIG",
      payload: this._buildRoutingConfigPayload(routingConfig),
    };

    try {
      this.pythonProcess.stdin.write(JSON.stringify(command) + "\n");
      console.log("Sent routing config update command to Python process.");
      return true;
    } catch (error) {
      console.error("Error writing routing config update to Python stdin:", error);
      return false;
    }
  }
  
  cancelDownload(serviceType) {
    if (!this.pythonProcess || !this.pythonProcess.stdin.writable) {
      console.error(
        "Cannot cancel download: Python process not running or stdin not writable."
      );
      return;
    }

    const command = {
      type: "CANCEL_DOWNLOAD",
      payload: {
        service_type: serviceType,
      },
    };

    try {
      this.pythonProcess.stdin.write(JSON.stringify(command) + "\n");
      console.log(`Sent CANCEL_DOWNLOAD command for ${serviceType} to Python process.`);

      // Clear the current download tracking
      this.currentDownloadImage = null;

      // Clear the progress display immediately in the UI for instant feedback
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send("openfork_client:docker-progress", null);
        this.mainWindow.webContents.send("openfork_client:log", {
          type: "stdout",
          message: `Sent cancellation request for ${serviceType}.`,
        });
      }
    } catch (error) {
      console.error("Error writing to Python process stdin:", error);
    }
  }

  _requestStopFromPython() {
    if (!this.pythonProcess || !this.pythonProcess.stdin.writable) {
      console.warn(
        "Cannot send REQUEST_STOP command: Python process not running or stdin not writable.",
      );
      return false;
    }

    const command = {
      type: "REQUEST_STOP",
    };

    try {
      this.pythonProcess.stdin.write(JSON.stringify(command) + "\n");
      console.log("Sent REQUEST_STOP command to Python process.");
      return true;
    } catch (error) {
      console.error("Error writing REQUEST_STOP to Python process stdin:", error);
      return false;
    }
  }

  _listenForTokenRefresh() {
    if (this.authSubscription) {
      this.authSubscription.unsubscribe();
    }
    const { data: subscription } = this.supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "TOKEN_REFRESHED" && session) {
          console.log("Token refreshed proactively. Pushing update to Python.");
          this._sendTokensToPython(session.access_token, session.refresh_token);
        } else if (event === "SIGNED_OUT") {
          console.log("User signed out. Stopping Python client.");
          this.stop();
        }
      }
    );
    this.authSubscription = subscription;
  }

  async start(service, routingConfig) {
    if (!service) {
      console.error("Service type must be provided to start the DGN client.");
      this.mainWindow.webContents.send("openfork_client:log", {
        type: "stderr",
        message:
          "ERROR: Service type must be selected before starting the client.",
      });
      this.mainWindow.webContents.send("openfork_client:status", "stopped");
      return;
    }
    if (this.pythonProcess) {
      console.log("Python process is already running.");
      return;
    }

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("openfork_client:provider-id", null);
    }

    // Wait for any pending cleanup to complete before starting
    if (this._cleanupPromise) {
      await this._cleanupPromise;
    }

    // Ensure no rogue processes are running before we start a fresh one
    await this.cleanupRogueProcesses();

    const { data, error: sessionError } = await this.supabase.auth.getSession();
    if (sessionError || !data.session) {
      console.error("Could not get session:", sessionError?.message);
      await this.supabase.auth.signOut();
      this.mainWindow.webContents.send("openfork_client:log", {
        type: "stderr",
        message:
          "Your session has expired. Please log in again to start the client.",
      });
      this.mainWindow.webContents.send("openfork_client:status", "stopped");
      return;
    }

    // Store settings for restart capability
    this._lastService = service;
    this._lastRoutingConfig = routingConfig;

    const currentSession = data.session;

    const { command, args: initialArgs } = this.getPythonCommand();

    const dgnClientRootDir = app.isPackaged
      ? path.dirname(command)
      : path.join(__dirname, "..", "..", "client");

    // Build CLI args from routingConfig
    const rc = routingConfig || {};
    const trustedIds = Array.isArray(rc.trustedIds) ? rc.trustedIds : [];

    // NOTE: tokens are NOT passed as CLI args (they would be visible in Task Manager).
    // Instead they are sent as the first stdin message immediately after spawn.
    const args = [
      ...initialArgs,
      "--service",
      service,
      "--root-dir",
      dgnClientRootDir,
      "--data-dir",
      this.userDataPath,
      "--community-mode",
      rc.communityMode || "none",
      "--process-marker",
      "openfork_dgn_client_v1_marker",
    ];

    if (rc.processOwnJobs) {
      args.push("--process-own-jobs");
    }

    if (
      (rc.communityMode === "trusted_projects" || rc.communityMode === "trusted_users") &&
      trustedIds.length > 0
    ) {
      args.push("--allowed-targets", trustedIds.join(","));
    }

    if (rc.monetizeMode) {
      args.push("--monetize-mode");
    }

    console.log(`Starting Python backend for '${service}' service...`);
    const cwd = app.isPackaged ? path.dirname(command) : dgnClientRootDir;
    console.log(`Using CWD: ${cwd}`);

    try {
      const spawnEnv = { ...process.env, PYTHONUNBUFFERED: "1" };
      if (process.platform === "win32") {
        // Only propagate an explicit Docker endpoint.
        // When OPENFORK_DOCKER_HOST is not set (Docker Desktop native mode) leave
        // DOCKER_HOST unset so the Python Docker SDK uses named-pipe discovery.
        // Setting it to tcp://127.0.0.1:2375 as a blanket fallback would silently
        // route the Python client to the WSL Docker daemon even when Docker Desktop
        // is the active engine, causing DockerManagement to show a different daemon.
        const dockerHost =
          process.env.OPENFORK_DOCKER_HOST || process.env.DOCKER_HOST;
        if (dockerHost) {
          spawnEnv.DOCKER_HOST = dockerHost;
        }
      }

      this.pythonProcess = spawn(command, args, {
        cwd: cwd,
        stdio: ["pipe", "pipe", "pipe"], // stdin, stdout, stderr
        env: spawnEnv,
      });

      // Send initial tokens via stdin — safer than CLI args which are visible in Task Manager
      this._sendTokensToPython(currentSession.access_token, currentSession.refresh_token);

      this.mainWindow.webContents.send("openfork_client:status", "starting");

      const handlePythonMessage = (log) => {
        // First, check for structured JSON messages
        try {
          const message = JSON.parse(log);
          if (message.status === "AUTH_EXPIRED") {
            // Debounce: Skip if a refresh attempt happened recently or is in progress
            const now = Date.now();
            if (this._refreshInProgress) {
              console.log("Token refresh already in progress, skipping duplicate request.");
              return;
            }
            if (now - this._lastRefreshAttempt < this._refreshCooldownMs) {
              console.log("Token refresh request debounced (within cooldown period).");
              return;
            }

            this._refreshInProgress = true;
            this._lastRefreshAttempt = now;

            console.warn(
              "Python reported auth expired. Attempting to refresh and recover."
            );
            (async () => {
              try {
                // Hard timeout so a stuck refresh (network stall, never-resolving
                // promise) cannot leave _refreshInProgress=true forever, which would
                // silently swallow every future AUTH_EXPIRED signal.
                const refreshPromise = this.supabase.auth.refreshSession();
                const timeoutPromise = new Promise((_, reject) =>
                  setTimeout(
                    () => reject(new Error("auth refresh timed out after 15s")),
                    15000
                  )
                );
                const { data: freshData, error: refreshError } =
                  await Promise.race([refreshPromise, timeoutPromise]);

                if (refreshError || !freshData.session) {
                  console.error(
                    "Could not recover session. Notifying Python and forcing logout.",
                    refreshError?.message
                  );
                  
                  // Tell Python that auth has permanently failed
                  this._sendAuthFailedPermanentlyToPython();

                  // Notify the renderer process about the auth failure
                  if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    this.mainWindow.webContents.send("auth:session", null);
                    this.mainWindow.webContents.send("auth:force-logout");
                    this.mainWindow.webContents.send("openfork_client:log", {
                      type: "stderr",
                      message: "Authentication failed. Please log in again.",
                    });
                  }
                } else {
                  console.log(
                    "Recovered session via refresh. Pushing new tokens to Python."
                  );
                  this._sendTokensToPython(
                    freshData.session.access_token,
                    freshData.session.refresh_token
                  );

                  // Notify renderer that tokens were refreshed successfully
                  if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    this.mainWindow.webContents.send(
                      "auth:session",
                      freshData.session
                    );
                  }
                }
              } catch (err) {
                // Timeout or any other unexpected refresh exception. Don't kill
                // the session here — the next AUTH_EXPIRED signal can retry once
                // the cooldown elapses.
                console.error("Auth refresh attempt failed:", err?.message || err);
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                  this.mainWindow.webContents.send("openfork_client:log", {
                    type: "stderr",
                    message: `Auth refresh failed (${err?.message || "unknown"}). Will retry on next signal.`,
                  });
                }
              } finally {
                this._refreshInProgress = false;
              }
            })();
            return; // Handled
          }

          if (message.type === "PROVIDER_REGISTERED") {
            const providerId =
              message.payload?.provider_id || message.payload?.providerId;
            if (providerId && this.mainWindow && !this.mainWindow.isDestroyed()) {
              this.mainWindow.webContents.send(
                "openfork_client:provider-id",
                providerId,
              );
            }
            if (this.onProviderRegistered) {
              try {
                this.onProviderRegistered(providerId || null);
              } catch (err) {
                console.error("onProviderRegistered handler threw:", err);
              }
            }
            return;
          }

          // Handle provider expiration (cleaned up by stale provider cron)
          if (message.status === "PROVIDER_EXPIRED") {
            console.warn(
              "Python reported provider registration expired. Restarting client..."
            );
            // Log to UI
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              this.mainWindow.webContents.send("openfork_client:log", {
                type: "stdout",
                message: "Provider registration expired. Restarting client...",
              });
            }
            // Restart the client with the same settings
            this._triggerRestart();
            return; // Handled
          }


          // Helper to normalize image names (ensuring :latest if no tag)
          const normalizeImage = (img) => {
            if (!img) return img;
            return img.includes(":") ? img : `${img}:latest`;
          };

          // Handle Docker pull progress messages
          if (message.type === "DOCKER_PULL_PROGRESS") {
            const currentNorm = normalizeImage(this.currentDownloadImage);
            const messageNorm = normalizeImage(message.payload.image);
            
            // Only update if this is for the current download
            if (currentNorm === messageNorm) {
              this.mainWindow.webContents.send(
                "openfork_client:docker-progress",
                message.payload
              );
            } else {
              console.log(`Ignoring progress for image mismatch: ${messageNorm} vs current: ${currentNorm}`);
            }
            return; // Don't log these to avoid spam
          }

          if (message.type === "DOCKER_PULL_START") {
            // Track this as the current download
            this.currentDownloadImage = message.payload.image;
            this.mainWindow.webContents.send(
              "openfork_client:docker-progress",
              { ...message.payload, status: "Starting", progress: 0 }
            );
            // Log a single line for the start event
            this.mainWindow.webContents.send("openfork_client:log", {
              type: "stdout",
              message: `Downloading Docker image: ${message.payload.image}`,
            });
            return;
          }

          if (message.type === "DOCKER_PULL_COMPLETE") {
            const currentNorm = normalizeImage(this.currentDownloadImage);
            const messageNorm = normalizeImage(message.payload.image);

            // Only clear if this is for the current download
            if (currentNorm === messageNorm) {
              this.mainWindow.webContents.send(
                "openfork_client:docker-progress",
                { ...message.payload, status: "Complete", progress: 100 }
              );
              // Log a single line for the completion event
              this.mainWindow.webContents.send("openfork_client:log", {
                type: "stdout",
                message: `Docker image ready: ${message.payload.image}`,
              });
              // Clear the progress display after a short delay
              const completionImage = message.payload.image;
              setTimeout(() => {
                // Double-check image name before clearing (in case a new download started)
                if (normalizeImage(this.currentDownloadImage) === normalizeImage(completionImage)) {
                  this.mainWindow.webContents.send(
                    "openfork_client:docker-progress",
                    null
                  );
                  this.currentDownloadImage = null;
                }
              }, 1500);
            } else {
              console.log(`Ignoring completion for image mismatch: ${messageNorm} vs current: ${currentNorm}`);
            }
            return;
          }

          if (message.type === "DOCKER_PULL_FAILED") {
            // Only clear if this is for the current download (prevents race condition)
            if (this.currentDownloadImage === message.payload.image) {
              this.mainWindow.webContents.send(
                "openfork_client:docker-progress",
                null
              );
              this.currentDownloadImage = null;
              
              const errorMsg = message.payload.error === "cancelled" 
                ? `Download cancelled: ${message.payload.image}` 
                : `Download failed: ${message.payload.image} (${message.payload.error})`;

              this.mainWindow.webContents.send("openfork_client:log", {
                type: message.payload.error === "cancelled" ? "stdout" : "stderr",
                message: errorMsg,
              });
            } else {
              console.log(`Ignoring stale FAILED event for ${message.payload.image} (current: ${this.currentDownloadImage})`);
            }
            return;
          }

          // Handle Job Status messages (Start/Complete/Failed/MonetizeComplete)
          if (["JOB_START", "JOB_COMPLETE", "JOB_FAILED", "JOB_CLEARED", "MONETIZE_JOB_COMPLETE"].includes(message.type)) {
            this.mainWindow.webContents.send(
              "openfork_client:job-status",
              { type: message.type, ...message.payload }
            );
            // Track active jobs so AutoCompactManager can gate on idle.
            const jobId = message.payload?.id;
            if (jobId) {
              if (message.type === "JOB_START") {
                this._activeJobIds.add(jobId);
              } else {
                this._activeJobIds.delete(jobId);
              }
            }
            // Notify cleanup manager (if registered) about job lifecycle
            if (this.onJobEvent) {
              this.onJobEvent(message.type, message.payload || {});
            }
            // Also log to console for visibility
            if (message.type === "JOB_START") {
               this.mainWindow.webContents.send("openfork_client:log", {
                 type: "stdout",
                 message: `Starting job ${message.payload.id} (${message.payload.workflow_type})...`
               });
            } else if (message.type === "JOB_COMPLETE") {
               this.mainWindow.webContents.send("openfork_client:log", {
                 type: "stdout",
                 message: `Job ${message.payload.id} completed successfully.`
               });
            } else if (message.type === "JOB_FAILED") {
               this.mainWindow.webContents.send("openfork_client:log", {
                 type: "stderr",
                 message: `Job ${message.payload.id} failed: ${message.payload.error}`
               });
            } else if (message.type === "JOB_CLEARED") {
               const suffix = message.payload.status
                 ? ` (${message.payload.status})`
                 : "";
               this.mainWindow.webContents.send("openfork_client:log", {
                 type: "stdout",
                 message: `Job ${message.payload.id} is no longer active${suffix}.`
               });
             }
             return;
           }

           // Handle disk space errors
           if (message.type === "DISK_SPACE_ERROR") {
             this.mainWindow.webContents.send(
               "openfork_client:disk-space-error",
               message.payload
             );
             // Also log to console
             this.mainWindow.webContents.send("openfork_client:log", {
               type: "stderr",
               message: message.payload.message
             });
             return;
           }

           // Forward Python-side image evictions to the auto-compact manager and
           // monetize cleanup UI. Payload: { service_type, image, freed_bytes, reason }
           if (message.type === "IMAGE_EVICTED") {
             if (this.onImageEvicted) {
               try {
                 this.onImageEvicted(message.payload || {});
               } catch (err) {
                 console.error("onImageEvicted handler threw:", err);
               }
             }
             return;
           }
         } catch (e) {
           // Not a JSON message, treat as regular log
         }

        // Handle legacy/plain text logs
        if (log.startsWith("DGN_CLIENT_SHUTDOWN_SERVER_PORT:")) {
          const portStr = log
            .substring("DGN_CLIENT_SHUTDOWN_SERVER_PORT:".length)
            .trim();
          const port = parseInt(portStr, 10);
          if (!isNaN(port)) {
            this.shutdownServerPort = port;
            console.log(
              `Python shutdown server is running on port ${this.shutdownServerPort}`
            );
          }
          return;
        }

        if (log.includes("DGN_CLIENT_RUNNING")) {
          this.mainWindow.webContents.send("openfork_client:status", "running");
          return;
        }

        // Forward all other logs to the renderer
        this.mainWindow.webContents.send("openfork_client:log", {
          type: "stdout",
          message: log,
        });
      };

      this.pythonProcess.stdout.on("data", (data) => {
        console.log(`[PY_STDOUT_RAW]: ${data}`);
        const logs = data.toString().split(/\r?\n/).filter(Boolean);
        logs.forEach(handlePythonMessage);
      });

      this.pythonProcess.stderr.on("data", (data) => {
        console.error(`[PY_STDERR_RAW]: ${data}`);
        const logs = data.toString().split(/\r?\n/).filter(Boolean);
        logs.forEach((log) => {
          this.mainWindow.webContents.send("openfork_client:log", {
            type: "stderr",
            message: log,
          });
        });
      });

      this.pythonProcess.on("close", (code) => {
        console.log(`Python process exited with code ${code}`);
        this.mainWindow.webContents.send("openfork_client:status", "stopped");
        this.mainWindow.webContents.send("openfork_client:provider-id", null);
        this.pythonProcess = null;
        this._activeJobIds.clear();
        this.currentDownloadImage = null;
        if (this.onProviderRegistered) {
          try {
            this.onProviderRegistered(null);
          } catch (err) {
            console.error("onProviderRegistered handler threw on close:", err);
          }
        }

        // Auto-cleanup zombies on exit
        this.cleanupRogueProcesses();
      });

      this.pythonProcess.on("error", (err) => {
        console.error(`Failed to start Python process: ${err}`);
        this.mainWindow.webContents.send("openfork_client:status", "error");
        this.mainWindow.webContents.send("openfork_client:provider-id", null);
        this.pythonProcess = null;
      });
    } catch (err) {
      console.error(`Error spawning Python process: ${err}`);
      this.mainWindow.webContents.send("openfork_client:status", "error");
    }
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.pythonProcess) {
        this.mainWindow.webContents.send("openfork_client:status", "stopped");
        return resolve();
      }

      this.mainWindow.webContents.send("openfork_client:status", "stopping");

      let resolved = false;
      const cleanup = () => {
        if (resolved) return;
        resolved = true;
        console.log("Python process stopped. Setting status to 'stopped'.");
        this.pythonProcess = null;
        this.mainWindow.webContents.send("openfork_client:status", "stopped");
        resolve();
      };

      this.pythonProcess.once("close", cleanup);

      const stopRequested = this._requestStopFromPython();
      const shutdownRequestDelayMs = stopRequested ? 250 : 0;

      setTimeout(() => {
        if (resolved || !this.pythonProcess) {
          return;
        }

        // Give the stdin stop command a brief head start so Python can capture
        // the in-flight job before the HTTP shutdown event begins unwinding.
        const request = http.get(
          `http://localhost:${this.shutdownServerPort}/shutdown`,
          () => {
            console.log("Sent HTTP shutdown request to Python backend.");
          }
        );
        request.on("error", (err) => {
          console.error(
            `Error sending HTTP shutdown request: ${err.message}. Falling back to kill.`
          );
          if (this.pythonProcess) this.pythonProcess.kill("SIGTERM");
        });
      }, shutdownRequestDelayMs);

      // Failsafe timeout - force kill and cleanup
      setTimeout(() => {
        if (!resolved && this.pythonProcess) {
          console.warn("Python process did not exit gracefully, forcing kill.");
          this.pythonProcess.kill("SIGKILL");
          
          // On Windows, SIGKILL may not trigger 'close' event reliably
          // Force cleanup after a short delay
          setTimeout(() => {
            if (!resolved) {
              console.warn("Force cleanup after SIGKILL.");
              cleanup();
            }
          }, 1000);
        }
      }, 15000);
    });
  }

  async _triggerRestart() {
    console.log("Triggering Python client restart due to provider expiration...");
    
    if (!this._lastService) {
      console.error("Cannot restart: no previous settings stored.");
      return;
    }

    // Stop the current process first
    await this.stop();

    // Small delay to ensure clean shutdown
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Start with the same settings
    console.log(
      `Restarting Python client with service: ${this._lastService}`
    );
    await this.start(this._lastService, this._lastRoutingConfig);
  }
}

module.exports = { PythonProcessManager };

