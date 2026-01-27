const { spawn, exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const http = require("http");

class PythonProcessManager {
  constructor({ supabase, mainWindow, userDataPath }) {
    this.pythonProcess = null;
    this.shutdownServerPort = 8000;
    this.supabase = supabase;
    this.mainWindow = mainWindow;
    this.isQuitting = false;
    this.userDataPath = userDataPath;
    this.authSubscription = null;
    this.currentDownloadImage = null; // Track current download to prevent race conditions

    // Auth refresh debouncing
    this._lastRefreshAttempt = 0;
    this._refreshInProgress = false;
    this._refreshCooldownMs = 3000; // 3 seconds cooldown

    // Restart settings (stored when start() is called)
    this._lastService = null;
    this._lastPolicy = null;
    this._lastAllowedIds = null;
    
    // Cleanup synchronization
    this._cleanupPromise = null;

    this._listenForTokenRefresh();
  }

  isRunning() {
    return this.pythonProcess !== null;
  }

  async cleanupRogueProcesses() {
    // If a cleanup is already in progress, return the existing promise
    if (this._cleanupPromise) {
      return this._cleanupPromise;
    }

    this._cleanupPromise = new Promise((resolve) => {
      const isWin = process.platform === "win32";
      if (!isWin) {
         this._cleanupPromise = null;
         resolve();
         return;
      }
      
      console.log("Cleaning up potential rogue client processes...");
      
      // Use PowerShell to find processes by our unique command line marker
      // This is more reliable than name matching or generic flags
      const marker = "openfork_dgn_client_v1_marker";
      const psCommand = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*--process-marker=${marker}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
      
      exec(`powershell -NoProfile -NonInteractive -Command "${psCommand}"`, (error, stdout, stderr) => {
          if (error) {
              // It's not really an error if no processes were found to kill
              // console.warn("Cleanup warning (may be empty):", error.message);
          }
          // Small delay to let OS release locks
          setTimeout(() => {
              this._cleanupPromise = null;
              resolve();
          }, 500);
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
    
    // Fallback: Look for compiled executable in desktop/bin
    const exeName = isWin ? "client.exe" : "client";
    const binPath = path.join(__dirname, "..", "bin", exeName);
    
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

  async start(service, policy, allowedIds) {
    if (!service) {
      console.error("Service type must be provided to start the DGN client.");
      this.mainWindow.webContents.send("openfork_client:log", {
        type: "stderr",
        message:
          "ERROR: Service type must be selected before starting the client.",
      });
      return;
    }
    if (this.pythonProcess) {
      console.log("Python process is already running.");
      return;
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
      return;
    }

    // Store settings for restart capability
    this._lastService = service;
    this._lastPolicy = policy;
    this._lastAllowedIds = allowedIds;

    const currentSession = data.session;

    const { command, args: initialArgs } = this.getPythonCommand();

    const dgnClientRootDir = app.isPackaged
      ? path.dirname(command)
      : path.join(__dirname, "..", "..", "client");

    const args = [
      ...initialArgs,
      "--access-token",
      currentSession.access_token,
      "--refresh-token",
      currentSession.refresh_token,
      "--service",
      service,
      "--root-dir",
      dgnClientRootDir,
      "--data-dir",
      this.userDataPath,
      "--accept-policy",
      policy,
      "--process-marker",
      "openfork_dgn_client_v1_marker",
    ];

    if (
      (policy === "project" || policy === "users") &&
      Array.isArray(allowedIds) &&
      allowedIds.length > 0
    ) {
      args.push("--allowed-targets", allowedIds.join(","));
    }

    console.log(`Starting Python backend for '${service}' service...`);
    const cwd = app.isPackaged ? path.dirname(command) : dgnClientRootDir;
    console.log(`Using CWD: ${cwd}`);

    try {
      this.pythonProcess = spawn(command, args, {
        cwd: cwd,
        stdio: ["pipe", "pipe", "pipe"], // stdin, stdout, stderr
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });

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
                // Force a refresh since the client reported the current token is invalid
                const { data: freshData, error: refreshError } =
                  await this.supabase.auth.refreshSession();

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
              } finally {
                this._refreshInProgress = false;
              }
            })();
            return; // Handled
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


          // Handle Docker pull progress messages
          if (message.type === "DOCKER_PULL_PROGRESS") {
            // Only update if this is for the current download
            if (this.currentDownloadImage === message.payload.image) {
              this.mainWindow.webContents.send(
                "openfork_client:docker-progress",
                message.payload
              );
            } else {
              console.log(`Ignoring progress for stale download: ${message.payload.image}`);
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
            // Only clear if this is for the current download
            if (this.currentDownloadImage === message.payload.image) {
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
              setTimeout(() => {
                // Double-check image name before clearing (in case a new download started)
                if (this.currentDownloadImage === message.payload.image) {
                  this.mainWindow.webContents.send(
                    "openfork_client:docker-progress",
                    null
                  );
                  this.currentDownloadImage = null;
                }
              }, 1500);
            } else {
              console.log(`Ignoring completion for stale download: ${message.payload.image}`);
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

          // Handle Job Status messages (Start/Complete/Failed)
          if (["JOB_START", "JOB_COMPLETE", "JOB_FAILED"].includes(message.type)) {
            this.mainWindow.webContents.send(
              "openfork_client:job-status",
              { type: message.type, ...message.payload }
            );
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
        this.pythonProcess = null;
        
        // Auto-cleanup zombies on exit
        this.cleanupRogueProcesses();
      });

      this.pythonProcess.on("error", (err) => {
        console.error(`Failed to start Python process: ${err}`);
        this.mainWindow.webContents.send("openfork_client:status", "error");
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

      // Gracefully shutdown via HTTP endpoint
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
      }, 8000);
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
      `Restarting Python client with service: ${this._lastService}, policy: ${this._lastPolicy}`
    );
    await this.start(this._lastService, this._lastPolicy, this._lastAllowedIds);
  }
}

module.exports = { PythonProcessManager };

