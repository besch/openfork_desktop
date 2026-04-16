"use strict";

const { execFile } = require("child_process");

const dockerEngine = require("./docker-engine.cjs");
const wslUtils = require("./wsl-utils.cjs");
const engineInstall = require("./engine-install.cjs");

let _autoUpdater;
let _openExternal;

function init({ autoUpdater, openExternal }) {
  _autoUpdater = autoUpdater;
  _openExternal = openExternal;
}

function register(ipcMain) {
  // --- DOCKER CHECK ---

  ipcMain.handle("deps:check-docker", async () => {
    try {
      return await dockerEngine.resolveDockerStatus({ allowNativeStart: true });
    } catch (err) {
      console.error("Unexpected error checking Docker:", err);
      return { installed: false, running: false };
    }
  });

  // --- ENGINE INSTALL ---

  ipcMain.handle("deps:install-engine", async (event, installPath) => {
    return engineInstall.handleInstallEngine(installPath);
  });

  ipcMain.handle("deps:cancel-install", async () => {
    return engineInstall.handleCancelInstall();
  });

  // Clears the cached WSL distro name so the next check re-detects it.
  // Useful when switching from the OpenFork distro to Docker Desktop (or vice-versa).
  ipcMain.handle("deps:reset-wsl-distro", () => {
    wslUtils.resetWslDistro();
    return { success: true };
  });

  // --- NVIDIA CHECK ---

  ipcMain.handle("deps:check-nvidia", async () => {
    try {
      // Minimum CUDA version required for OpenFork AI models
      const MIN_CUDA_VERSION = "12.8";

      const nvidiaSmiArgs = ["--query-gpu=name,cuda_version", "--format=csv,noheader"];

      const runExecFile = (cmd, args, opts) =>
        new Promise((resolve, reject) =>
          execFile(cmd, args, opts, (err, out) =>
            err ? reject(err) : resolve(out),
          ),
        );

      let output;
      if (process.platform === "win32") {
        // C:\Windows\System32\nvidia-smi.exe is a stub that fails when run
        // programmatically. Try real installation paths first, then fall back
        // to PowerShell (which resolves PATH correctly).
        const directPaths = [
          process.env["ProgramFiles"] +
            "\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe",
          "C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe",
        ];

        let found = false;
        for (const candidate of directPaths) {
          try {
            output = await runExecFile(candidate, nvidiaSmiArgs, { timeout: 10000 });
            found = true;
            break;
          } catch {
            // try next
          }
        }

        if (!found) {
          // Try direct path with PowerShell call operator
          const possiblePaths = [
            "C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe",
            "C:\\Windows\\System32\\nvidia-smi.exe",
          ];

          for (const nvidiaSmiPath of possiblePaths) {
            try {
              output = await runExecFile(
                "powershell.exe",
                [
                  "-NoProfile",
                  "-Command",
                  `& "${nvidiaSmiPath}" '--query-gpu=name,cuda_version' '--format=csv,noheader'`,
                ],
                { timeout: 15000 },
              );
              found = true;
              break;
            } catch {
              // try next path
            }
          }

          // Try using cmd.exe where command
          if (!found) {
            try {
              output = await runExecFile("cmd.exe", ["/c", "where nvidia-smi"], {
                timeout: 15000,
              });
              const nvidiaPath = output.toString().trim().split("\r?\n")[0];
              if (nvidiaPath) {
                output = await runExecFile(nvidiaPath, nvidiaSmiArgs, {
                  timeout: 15000,
                });
                found = true;
              }
            } catch {
              // try next approach
            }
          }

          // Try PowerShell's Get-Command
          if (!found) {
            try {
              output = await runExecFile(
                "powershell.exe",
                [
                  "-NoProfile",
                  "-Command",
                  `(Get-Command nvidia-smi -ErrorAction SilentlyContinue).Source`,
                ],
                { timeout: 15000 },
              );
              const nvidiaPath = output.toString().trim();
              if (nvidiaPath) {
                output = await runExecFile(
                  "powershell.exe",
                  [
                    "-NoProfile",
                    "-Command",
                    `& "${nvidiaPath}" '--query-gpu=name,cuda_version' '--format=csv,noheader'`,
                  ],
                  { timeout: 15000 },
                );
                found = true;
              }
            } catch {
              // try next approach
            }
          }

          // Last resort: try with PATH modification via cmd.exe
          if (!found) {
            try {
              output = await runExecFile(
                "cmd.exe",
                [
                  "/c",
                  `set "PATH=C:\\Program Files\\NVIDIA Corporation\\NVSMI;%PATH%" && nvidia-smi --query-gpu=name,cuda_version --format=csv,noheader`,
                ],
                { timeout: 15000 },
              );
              found = true;
            } catch {
              // All methods exhausted
            }
          }
        }
      } else {
        output = await runExecFile("nvidia-smi", nvidiaSmiArgs, { timeout: 10000 });
      }

      const lines = output.toString().trim().split("\n");
      if (lines.length === 0 || !lines[0].trim()) {
        return { available: false, gpu: null, cudaVersion: null, isOutdated: false };
      }

      const gpuInfo = lines[0].split(",").map((s) => s.trim());
      const gpuName = gpuInfo[0] || null;
      const cudaVersion = gpuInfo[1] || null;

      let isOutdated = false;
      if (cudaVersion) {
        const [major, minor] = cudaVersion.split(".").map(Number);
        const [minMajor, minMinor] = MIN_CUDA_VERSION.split(".").map(Number);
        if (major < minMajor || (major === minMajor && minor < minMinor)) {
          isOutdated = true;
        }
      }

      return { available: true, gpu: gpuName, cudaVersion, isOutdated };
    } catch (err) {
      console.error("[deps:check-nvidia] detection failed:", err?.message ?? err);
      return { available: false, gpu: null, cudaVersion: null, isOutdated: false };
    }
  });

  // --- MISC DEPS ---

  ipcMain.handle("deps:open-docker-download", () => {
    const urls = {
      win32: "https://www.docker.com/products/docker-desktop/",
      darwin: "https://www.docker.com/products/docker-desktop/",
      linux: "https://docs.docker.com/engine/install/",
    };
    const url = urls[process.platform] || urls.linux;
    _openExternal(url);
    return { success: true };
  });

  // --- AUTO UPDATER ---

  ipcMain.handle("update:download", () => {
    _autoUpdater.downloadUpdate();
  });

  ipcMain.handle("update:install", () => {
    _autoUpdater.quitAndInstall();
  });
}

module.exports = { init, register };
