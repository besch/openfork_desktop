"use strict";

const { exec, execFile } = require("child_process");
const http = require("http");
const fs = require("fs");

const wslUtils = require("./wsl-utils.cjs");
const dockerStorage = require("./docker-storage.cjs");
const settings = require("./settings.cjs");

const WINDOWS_DOCKER_API_PORT = 2375;

let _getMainWindow;

function init({ getMainWindow }) {
  _getMainWindow = getMainWindow;
}

// --- SECURITY HELPERS ---

// SECURITY: Validate Docker ID format to prevent command injection.
// Docker IDs are hex strings (12 or 64 chars for short/full format).
function isValidDockerId(id) {
  if (typeof id !== "string" || !id) return false;
  const dockerIdPattern = /^[a-f0-9]{12,64}$/i;
  const imageNamePattern = /^[a-z0-9][a-z0-9._\/-]*:[a-z0-9._-]+$/i;
  return dockerIdPattern.test(id) || imageNamePattern.test(id);
}

// SECURITY: Escape shell argument to prevent injection.
function escapeShellArg(arg) {
  if (!arg) return '""';
  if (process.platform === "win32") {
    return `"${arg.replace(/"/g, '\\"')}"`;
  }
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

// --- DOCKER ROUTING ---

/**
 * Returns true when Docker commands are routed through WSL (not native Docker Desktop).
 * OPENFORK_DOCKER_HOST is set only when the WSL Docker TCP endpoint was resolved.
 */
function isUsingWslDocker() {
  return process.platform === "win32" && !!process.env.OPENFORK_DOCKER_HOST;
}

/**
 * After deleting Docker images in WSL mode, physical disk space is not reclaimed
 * automatically — the WSL VHDX must be compacted separately. Emit an event so the
 * UI can surface a "Reclaim space" prompt to the user.
 */
function emitCompactionSuggested() {
  if (!isUsingWslDocker()) return;
  const mainWindow = _getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("docker:compaction-suggested");
  }
}

// --- DOCKER COMMAND EXECUTION ---

async function execDockerCommand(command) {
  const wslDistro =
    process.platform === "win32" ? await wslUtils.getWslDistroName() : null;
  return new Promise((resolve, reject) => {
    // WSL ROBUSTNESS: On Windows, use execFile to avoid CMD shell escaping issues
    if (process.platform === "win32" && command.startsWith("docker ")) {
      // When OPENFORK_DOCKER_HOST is not set, Docker Desktop is the active engine.
      // Route directly to the native docker.exe instead of through WSL.
      if (!process.env.OPENFORK_DOCKER_HOST) {
        exec(command, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout) => {
          if (error) {
            const msg = error.message.toLowerCase();
            if (msg.includes("is not running") || msg.includes("connection refused")) {
              resolve("");
              return;
            }
            console.error(`Docker command error: ${error.message}`);
            reject(error);
            return;
          }
          resolve(stdout.trim());
        });
        return;
      }
      // Use -- separator which is more robust for passing complex strings to WSL
      const args = ["-d", wslDistro, "--", "sudo", "bash", "-c", command];
      execFile(
        "wsl.exe",
        args,
        { maxBuffer: 1024 * 1024 * 10 },
        (error, stdout) => {
          if (error) {
            const msg = error.message.toLowerCase();
            if (
              msg.includes("is not running") ||
              msg.includes("connection refused") ||
              msg.includes("distribution with the supplied name could not be found")
            ) {
              resolve("");
              return;
            }
            console.error(`Docker command error: ${error.message}`);
            reject(error);
            return;
          }
          resolve(stdout.trim());
        },
      );
    } else {
      exec(command, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout) => {
        if (error) {
          if (
            error.message.includes("is not running") ||
            error.message.includes("connection refused")
          ) {
            resolve("");
            return;
          }
          console.error(`Docker command error: ${error.message}`);
          reject(error);
          return;
        }
        resolve(stdout.trim());
      });
    }
  });
}

// --- DOCKER STATUS DETECTION ---

function classifyDockerCheckError(errorMessage = "", stderr = "") {
  const combined = `${errorMessage}\n${stderr}`.toLowerCase();
  if (combined.includes("permission denied")) return "DOCKER_PERMISSION_DENIED";
  return null;
}

function runDockerCheckCommand(
  cmd,
  { useWsl = false, wslDistro = null, wslUser = "root", timeoutMs } = {},
) {
  return new Promise((resolve) => {
    if (useWsl && process.platform === "win32") {
      const args = ["-d", wslDistro, "--user", wslUser, "--", "bash", "-lc", cmd];
      execFile(
        "wsl.exe",
        args,
        { timeout: timeoutMs ?? 15000 },
        (error, stdout, stderr) => {
          if (error) {
            console.log(`Check command '${cmd}' failed: ${error.message}`);
            console.log(`WSL Stdout: ${stdout}`);
            console.log(`WSL Stderr: ${stderr}`);
            resolve({
              success: false,
              error: error.message,
              stderr: stderr?.trim() || "",
            });
            return;
          }
          resolve({ success: true, output: stdout.trim() });
        },
      );
      return;
    }
    exec(cmd, { timeout: timeoutMs ?? 10000 }, (error, stdout, stderr) => {
      if (error) {
        console.log(`Check command '${cmd}' failed: ${error.message}`);
        console.log(`Stdout: ${stdout}`);
        console.log(`Stderr: ${stderr}`);
        resolve({
          success: false,
          error: error.message,
          stderr: stderr?.trim() || "",
        });
        return;
      }
      resolve({ success: true, output: stdout.trim() });
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pingDockerApiHost(host, timeoutMs = 1500) {
  if (process.platform !== "win32") return Promise.resolve(true);
  return new Promise((resolve) => {
    const request = http.request(
      {
        host,
        port: WINDOWS_DOCKER_API_PORT,
        path: "/_ping",
        method: "GET",
        timeout: timeoutMs,
      },
      (response) => {
        let body = "";
        response.on("data", (chunk) => { body += chunk.toString(); });
        response.on("end", () => {
          resolve(response.statusCode === 200 && body.trim() === "OK");
        });
      },
    );
    request.on("timeout", () => { request.destroy(); resolve(false); });
    request.on("error", () => { resolve(false); });
    request.end();
  });
}

async function resolveWindowsDockerApiEndpoint(timeoutMs = 20000) {
  if (process.platform !== "win32") return null;
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const hosts = await wslUtils.getWindowsDockerApiHosts();
    for (const host of hosts) {
      if (await pingDockerApiHost(host)) {
        return `tcp://${host}:${WINDOWS_DOCKER_API_PORT}`;
      }
    }
    try {
      await runDockerCheckCommand("docker info > /dev/null 2>&1 || true", {
        useWsl: true,
        wslDistro: await wslUtils.getWslDistroName(),
        timeoutMs: 5000,
      });
    } catch {
      // Best-effort warmup only.
    }
    await sleep(1000);
  }
  const hosts = await wslUtils.getWindowsDockerApiHosts();
  for (const host of hosts) {
    if (await pingDockerApiHost(host)) {
      return `tcp://${host}:${WINDOWS_DOCKER_API_PORT}`;
    }
  }
  return null;
}

// --- NATIVE DOCKER CHECK ---

async function checkNativeDocker() {
  if (process.platform !== "win32") return { installed: false, running: false };
  return new Promise((resolve) => {
    const commonPath =
      "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe";
    const hasDockerExe = fs.existsSync(commonPath);
    const dockerCmd = hasDockerExe ? `"${commonPath}"` : "docker.exe";
    exec("where docker.exe", (error, stdout) => {
      const inPath = !error && stdout.trim().length > 0;
      if (!inPath && !hasDockerExe) {
        resolve({ installed: false, running: false });
        return;
      }
      exec(
        'tasklist /FI "IMAGENAME eq Docker Desktop.exe" /NH',
        (err, stdout) => {
          const processRunning = !err && stdout.includes("Docker Desktop.exe");
          // Advanced check: verify if the Docker named pipe exists (most reliable indicator)
          const pipePath = "\\\\.\\pipe\\docker_engine";
          const pipeExists = fs.existsSync(pipePath);
          // Check which container mode Docker Desktop is exposing.
          // OpenFork requires Linux containers.
          exec(
            `${dockerCmd} version --format "{{.Server.Os}}"`,
            (versionError, versionStdout) => {
              const serverOs = versionStdout.trim().toLowerCase() || null;
              const storagePath = dockerStorage.resolveDockerDesktopStoragePath();
              resolve({
                installed: true,
                running: serverOs === "linux",
                isNative: true,
                isProcessRunning: processRunning || pipeExists,
                installDrive:
                  dockerStorage.getDriveLetterFromPath(storagePath) ||
                  wslUtils.getWindowsSystemDriveLetter(),
                storagePath,
                serverOs,
                isWindowsContainers: serverOs === "windows",
                lastError: versionError?.message,
              });
            },
          );
        },
      );
    });
  });
}

// --- WSL DOCKER CHECK ---

async function checkWslDockerStatus({ hostTimeoutMs = 15000 } = {}) {
  if (process.platform !== "win32") return { installed: false, running: false };

  const wslDistro = await wslUtils.getWslDistroName();
  process.env.OPENFORK_WSL_DISTRO = wslDistro;

  const distroExists = await wslUtils.checkDistroExists(wslDistro);
  if (!distroExists) {
    console.log(`WSL distro '${wslDistro}' is missing`);
    // Clear the cached distro name so the next call auto-detects whatever
    // distro is available rather than re-checking this dead one every poll.
    wslUtils.resetWslDistro();
    return {
      installed: false,
      running: false,
      isNative: false,
      error: "WSL_DISTRO_MISSING",
      wslDistro,
    };
  }

  const storagePath = await wslUtils.resolveWslStoragePath(wslDistro);
  const installDrive = dockerStorage.getDriveLetterFromPath(storagePath);

  const versionResult = await runDockerCheckCommand("docker --version", {
    useWsl: true,
    wslDistro,
  });
  if (!versionResult.success) {
    console.log(`Docker CLI not found inside WSL distro '${wslDistro}'`);
    return {
      installed: false,
      running: false,
      isNative: false,
      installDrive,
      storagePath,
      error:
        classifyDockerCheckError(versionResult.error, versionResult.stderr) ||
        undefined,
      wslDistro,
    };
  }

  const infoResult = await runDockerCheckCommand("docker info", {
    useWsl: true,
    wslDistro,
  });
  if (!infoResult.success) {
    console.log(
      `Docker is installed in WSL distro '${wslDistro}' but not ready:`,
      infoResult.error,
    );
    return {
      installed: true,
      running: false,
      isNative: false,
      installDrive,
      storagePath,
      error:
        classifyDockerCheckError(infoResult.error, infoResult.stderr) ||
        undefined,
      wslDistro,
    };
  }

  const dockerHost = await resolveWindowsDockerApiEndpoint(hostTimeoutMs);
  if (!dockerHost) {
    return {
      installed: true,
      running: false,
      isNative: false,
      installDrive,
      storagePath,
      error: "DOCKER_API_UNREACHABLE",
      wslDistro,
    };
  }

  return {
    installed: true,
    running: true,
    isNative: false,
    installDrive,
    storagePath,
    dockerHost,
    wslDistro,
  };
}

// --- STATUS BUILDERS ---

function withWindowsDockerMetadata(status, { preference, native, wsl }) {
  return {
    ...status,
    enginePreference: preference,
    availableEngines: {
      desktop: !!native.installed,
      wsl: !!wsl.installed,
    },
  };
}

function buildRunningNativeStatus(native) {
  delete process.env.OPENFORK_DOCKER_HOST;
  return {
    installed: true,
    running: true,
    isNative: true,
    installDrive: native.installDrive,
    storagePath: native.storagePath,
    activeEngine: "desktop",
  };
}

function buildRunningWslStatus(wsl) {
  process.env.OPENFORK_DOCKER_HOST = wsl.dockerHost;
  return {
    installed: true,
    running: true,
    isNative: false,
    installDrive: wsl.installDrive,
    storagePath: wsl.storagePath,
    activeEngine: "wsl",
  };
}

async function buildNativeStatus(native, { allowNativeStart } = {}) {
  delete process.env.OPENFORK_DOCKER_HOST;
  if (native.isWindowsContainers) {
    return {
      installed: true,
      running: false,
      isNative: true,
      installDrive: native.installDrive,
      storagePath: native.storagePath,
      error: "DOCKER_WINDOWS_CONTAINERS",
    };
  }
  if (!native.isProcessRunning && allowNativeStart) {
    console.log("Docker Desktop is not running. Attempting auto-start...");
    const startResult = await startNativeDocker();
    return {
      installed: true,
      running: false,
      isNative: true,
      installDrive: native.installDrive,
      storagePath: native.storagePath,
      isStarting: startResult.success,
    };
  }
  return {
    installed: true,
    running: false,
    isNative: true,
    installDrive: native.installDrive,
    storagePath: native.storagePath,
    isStarting: !!native.isProcessRunning,
  };
}

function buildWslStatus(wsl) {
  delete process.env.OPENFORK_DOCKER_HOST;
  return {
    installed: true,
    running: false,
    isNative: false,
    installDrive: wsl.installDrive,
    storagePath: wsl.storagePath,
    error: wsl.error,
  };
}

async function resolveDockerStatus(
  { allowNativeStart = true, wslHostTimeoutMs = 15000 } = {},
) {
  if (process.platform !== "win32") {
    const versionResult = await runDockerCheckCommand("docker --version");
    if (!versionResult.success) return { installed: false, running: false };
    const infoResult = await runDockerCheckCommand("docker info");
    if (infoResult.success) {
      return { installed: true, running: true, activeEngine: "linux" };
    }
    return {
      installed: true,
      running: false,
      activeEngine: "linux",
      error:
        classifyDockerCheckError(infoResult.error, infoResult.stderr) ||
        undefined,
    };
  }

  const preference = settings.getDockerEnginePreference();
  const [native, wsl] = await Promise.all([
    checkNativeDocker(),
    checkWslDockerStatus({ hostTimeoutMs: wslHostTimeoutMs }),
  ]);

  const decorate = (status) =>
    withWindowsDockerMetadata(status, { preference, native, wsl });

  if (preference === "desktop" && native.installed) {
    return decorate(
      native.running
        ? buildRunningNativeStatus(native)
        : await buildNativeStatus(native, { allowNativeStart }),
    );
  }
  if (preference === "wsl" && wsl.installed) {
    return decorate(wsl.running ? buildRunningWslStatus(wsl) : buildWslStatus(wsl));
  }
  if (preference === "desktop" && !native.installed && wsl.installed) {
    return decorate(wsl.running ? buildRunningWslStatus(wsl) : buildWslStatus(wsl));
  }
  if (preference === "wsl" && !wsl.installed && native.installed) {
    return decorate(
      native.running
        ? buildRunningNativeStatus(native)
        : await buildNativeStatus(native, { allowNativeStart }),
    );
  }
  if (native.running) return decorate(buildRunningNativeStatus(native));
  if (wsl.running) return decorate(buildRunningWslStatus(wsl));
  if (wsl.installed && native.isWindowsContainers) return decorate(buildWslStatus(wsl));
  if (native.installed) return decorate(await buildNativeStatus(native, { allowNativeStart }));
  if (wsl.installed) return decorate(buildWslStatus(wsl));

  delete process.env.OPENFORK_DOCKER_HOST;
  return decorate({ installed: false, running: false, error: wsl.error });
}

async function startNativeDocker() {
  if (process.platform !== "win32") return { success: false };
  return new Promise((resolve) => {
    console.log("Attempting to start Docker Desktop...");
    const dockerDesktopPath =
      "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe";
    if (!fs.existsSync(dockerDesktopPath)) {
      console.error("Docker Desktop GUI executable not found at default path.");
      resolve({ success: false, error: "DOCKER_DESKTOP_NOT_FOUND" });
      return;
    }
    const command = `Start-Process "${dockerDesktopPath}"`;
    execFile(
      "powershell.exe",
      ["-NoProfile", "-Command", command],
      (error) => {
        if (error) {
          console.error("Failed to launch Docker Desktop:", error.message);
          resolve({ success: false, error: error.message });
        } else {
          console.log("Docker Desktop launch command sent.");
          resolve({ success: true });
        }
      },
    );
  });
}

module.exports = {
  init,
  isValidDockerId,
  escapeShellArg,
  isUsingWslDocker,
  emitCompactionSuggested,
  execDockerCommand,
  classifyDockerCheckError,
  runDockerCheckCommand,
  pingDockerApiHost,
  resolveWindowsDockerApiEndpoint,
  checkNativeDocker,
  checkWslDockerStatus,
  resolveDockerStatus,
  startNativeDocker,
};
