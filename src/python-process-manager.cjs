const { spawn } = require("child_process");
const path = require("path");
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

    this._listenForTokenRefresh();
  }

  getPythonExecutablePath() {
    const exeName = process.platform === "win32" ? "client.exe" : "client";
    if (app.isPackaged) {
      // For production, the executable is packaged into the resources directory.
      return path.join(process.resourcesPath, "bin", exeName);
    } else {
      // For development, assume the executable is in a 'bin' directory inside the 'desktop' project.
      return path.join(__dirname, "..", "bin", exeName);
    }
  }

  _sendTokensToPython(accessToken, refreshToken) {
    if (!this.pythonProcess || !this.pythonProcess.stdin.writable) {
      console.error(
        "Cannot send tokens: Python process not running or stdin not writable."
      );
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

  async start(service, policy, allowedIds, comfyuiSettings = {}) {
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

    const currentSession = data.session;

    const pythonExecutablePath = this.getPythonExecutablePath();
    const pythonExecutableDir = path.dirname(pythonExecutablePath);

    const dgnClientRootDir = app.isPackaged
      ? pythonExecutableDir
      : path.join(__dirname, "..", "..", "client");

    const args = [
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
    ];

    if (
      (policy === "project" || policy === "users") &&
      Array.isArray(allowedIds) &&
      allowedIds.length > 0
    ) {
      args.push("--allowed-targets", allowedIds.join(","));
    }

    // Add Docker image setting if provided
    if (comfyuiSettings.dockerImage) {
      args.push("--docker-image", comfyuiSettings.dockerImage);
      console.log(`Using Docker image: ${comfyuiSettings.dockerImage}`);
    }

    console.log(`Starting Python backend for '${service}' service...`);
    const cwd = app.isPackaged ? pythonExecutableDir : dgnClientRootDir;
    console.log(`Using CWD: ${cwd}`);

    try {
      this.pythonProcess = spawn(pythonExecutablePath, args, {
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
            console.warn(
              "Python reported auth expired. Attempting to refresh and recover."
            );
            (async () => {
              // Force a refresh since the client reported the current token is invalid
              const { data: freshData, error: refreshError } =
                await this.supabase.auth.refreshSession();

              if (refreshError || !freshData.session) {
                console.error(
                  "Could not recover session. Forcing logout.",
                  refreshError?.message
                );
                await this.stop();
                await this.supabase.auth.signOut();

                // Notify the renderer process about the auth failure
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                  this.mainWindow.webContents.send("auth:session", null);
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
            })();
            return; // Handled
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

      this.pythonProcess.once("close", () => {
        console.log("Python process confirmed closed.");
        this.pythonProcess = null;
        resolve();
      });

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

      // Failsafe timeout
      setTimeout(() => {
        if (this.pythonProcess) {
          console.warn("Python process did not exit gracefully, forcing kill.");
          this.pythonProcess.kill("SIGKILL");
        }
      }, 8000);
    });
  }
}

module.exports = { PythonProcessManager };
