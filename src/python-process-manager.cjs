const { spawn } = require("child_process");
const path = require("path");
const http = require("http");
const { app } = require("electron");

class PythonProcessManager {
  constructor({ supabase, mainWindow }) {
    this.pythonProcess = null;
    this.tokenServerPort = 8001; // Default port, will be updated on client startup
    this.supabase = supabase;
    this.mainWindow = mainWindow;
    this.isQuitting = false;
  }

  getPythonExecutablePath() {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, "bin", "openfork_client.exe");
    } else {
      // In dev, this assumes the executable is in a 'bin' directory adjacent to 'electron.cjs'
      return path.join(__dirname, "..", "bin", "openfork_client.exe");
    }
  }

  updatePythonBackendTokens(accessToken, refreshToken) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      const options = {
        hostname: "127.0.0.1",
        port: this.tokenServerPort,
        path: "/update-tokens",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": payload.length,
        },
      };

      const req = http.request(options, (res) => {
        if (res.statusCode === 200) {
          console.log("Successfully updated Python backend tokens.");
          resolve();
        } else {
          let body = "";
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => {
            console.error(
              `Failed to update Python backend tokens. Status: ${res.statusCode}, Body: ${body}`
            );
            reject(
              new Error(
                `Failed to update tokens with status: ${res.statusCode}`
              )
            );
          });
        }
      });

      req.on("error", (error) => {
        console.error("Error sending token update to Python backend:", error);
        reject(error);
      });

      req.write(payload);
      req.end();
    });
  }

  async start(service) {
    if (!service) {
      console.error("Service type must be provided to start the DGN client.");
      this.mainWindow.webContents.send("dgn-client:log", {
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
      this.mainWindow.webContents.send("dgn-client:log", {
        type: "stderr",
        message:
          "Your session has expired. Please log in again to start the client.",
      });
      return;
    }

    const currentSession = data.session;

    const pythonExecutablePath = this.getPythonExecutablePath();
    const pythonCwd = path.dirname(pythonExecutablePath);
    const args = [
      "--access-token",
      currentSession.access_token,
      "--refresh-token",
      currentSession.refresh_token,
      "--service",
      service,
    ];

    console.log(`Starting Python backend for '${service}' service...`);

    try {
      this.pythonProcess = spawn(pythonExecutablePath, args, {
        cwd: pythonCwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });

      this.mainWindow.webContents.send("dgn-client:status", "starting");

      const handlePythonLog = (log) => {
        if (log.startsWith("DGN_CLIENT_TOKEN_SERVER_PORT:")) {
          const portStr = log
            .substring("DGN_CLIENT_TOKEN_SERVER_PORT:".length)
            .trim();
          const port = parseInt(portStr, 10);
          if (!isNaN(port)) {
            this.tokenServerPort = port;
            console.log(
              `Python token server is running on port ${this.tokenServerPort}`
            );
          }
          return;
        }

        if (log.startsWith("DGN_CLIENT_TOKENS_REFRESHED:")) {
          try {
            const jsonString = log.substring(
              "DGN_CLIENT_TOKENS_REFRESHED:".length
            );
            const tokens = JSON.parse(jsonString);
            console.log(
              "Received refreshed tokens from Python. Updating main session."
            );
            this.supabase.auth.setSession({
              access_token: tokens.access_token,
              refresh_token: tokens.refresh_token,
            });
          } catch (e) {
            console.error("Failed to parse refreshed tokens from Python:", e);
          }
          return;
        }

        if (log.includes("DGN_CLIENT_AUTH_REFRESH_FAILED")) {
          console.warn(
            "Python reported auth failure. Attempting to recover session."
          );
          (async () => {
            const { data: freshData, error: refreshError } =
              await this.supabase.auth.getSession();
            if (refreshError || !freshData.session) {
              console.error(
                "Could not recover session. Forcing logout.",
                refreshError?.message
              );
              await this.stop();
              await this.supabase.auth.signOut();
            } else {
              console.log("Recovered session. Pushing new tokens to Python.");
              try {
                await this.updatePythonBackendTokens(
                  freshData.session.access_token,
                  freshData.session.refresh_token
                );
              } catch (updateError) {
                console.error(
                  "Failed to push updated tokens to Python. Shutting down.",
                  updateError
                );
                await this.stop();
                await this.supabase.auth.signOut();
              }
            }
          })();
          return;
        }

        if (log.includes("DGN_CLIENT_RUNNING")) {
          this.mainWindow.webContents.send("dgn-client:status", "running");
          return;
        }

        this.mainWindow.webContents.send("dgn-client:log", {
          type: "stdout",
          message: log,
        });
      };

      this.pythonProcess.stdout.on("data", (data) => {
        console.log(`[PY_STDOUT_RAW]: ${data}`); // Raw log for debugging
        const logs = data.toString().split(/\r?\n/).filter(Boolean);
        logs.forEach(handlePythonLog);
      });

      this.pythonProcess.stderr.on("data", (data) => {
        console.error(`[PY_STDERR_RAW]: ${data}`); // Raw log for debugging
        const logs = data.toString().split(/\r?\n/).filter(Boolean);
        logs.forEach((log) => {
          this.mainWindow.webContents.send("dgn-client:log", {
            type: "stderr",
            message: log,
          });
        });
      });

      this.pythonProcess.on("close", (code) => {
        console.log(`Python process exited with code ${code}`);
        this.mainWindow.webContents.send("dgn-client:status", "stopped");
        this.pythonProcess = null;
      });

      this.pythonProcess.on("error", (err) => {
        console.error(`Failed to start Python process: ${err}`);
        this.mainWindow.webContents.send("dgn-client:status", "error");
        this.pythonProcess = null;
      });
    } catch (err) {
      console.error(`Error spawning Python process: ${err}`);
      this.mainWindow.webContents.send("dgn-client:status", "error");
    }
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.pythonProcess) {
        this.mainWindow.webContents.send("dgn-client:status", "stopped");
        return resolve();
      }

      this.mainWindow.webContents.send("dgn-client:status", "stopping");

      this.pythonProcess.once("close", () => {
        console.log("Python process confirmed closed.");
        this.pythonProcess = null;
        resolve();
      });

      // Send HTTP shutdown request to the DGN client's internal server
      fetch(`http://localhost:8000/shutdown`).catch((error) => {
        console.error(
          `Error sending HTTP shutdown request: ${error}. Falling back to kill.`
        );
        if (this.pythonProcess) this.pythonProcess.kill();
      });

      // Failsafe timeout
      setTimeout(() => {
        if (this.pythonProcess) {
          console.warn("Python process did not exit gracefully, forcing kill.");
          this.pythonProcess.kill();
        }
      }, 8000);
    });
  }
}

module.exports = { PythonProcessManager };
