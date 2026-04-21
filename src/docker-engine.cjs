"use strict";

const { exec, execFile } = require("child_process");
const http = require("http");

const wslUtils = require("./wsl-utils.cjs");
const dockerStorage = require("./docker-storage.cjs");

const WINDOWS_DOCKER_API_PORT = 2375;
const WSL_DOCKER_CHECK_TIMEOUT_MS = 30000;
const WSL_LINUX_PATH =
  "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

let _getMainWindow;
let _getInstallState;
// On Linux, set when the user is in the docker group but hasn't re-logged in yet.
// Commands are then wrapped with `sg docker -c "..."` to pick up the group mid-session.
let useSgDocker = false;

function init({ getMainWindow, getInstallState }) {
  if (getMainWindow) _getMainWindow = getMainWindow;
  if (getInstallState) _getInstallState = getInstallState;
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
 * Returns true when Windows is operating against the dedicated OpenFork WSL distro.
 */
function isUsingWslDocker() {
  return process.platform === "win32" && !!process.env.OPENFORK_WSL_DISTRO;
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

function getActiveWindowsInstallStatus() {
  if (process.platform !== "win32" || typeof _getInstallState !== "function") {
    return null;
  }

  const installState = _getInstallState();
  if (!installState?.active) return null;

  const installDriveMatch = installState.installPath?.match(/^([A-Za-z]):\\/);
  return {
    installed: false,
    running: false,
    isNative: false,
    isStarting: true,
    installDrive: installDriveMatch
      ? installDriveMatch[1].toUpperCase()
      : undefined,
    wslDistro: installState.distro || "OpenFork",
  };
}

// --- DOCKER COMMAND EXECUTION ---

async function execDockerCommand(command) {
  const installStatus = getActiveWindowsInstallStatus();
  if (installStatus && command.startsWith("docker ")) {
    return "";
  }

  const wslDistro =
    process.platform === "win32" ? await wslUtils.getWslDistroName() : null;
  return new Promise((resolve, reject) => {
    // WSL ROBUSTNESS: On Windows, use execFile to avoid CMD shell escaping issues
    if (process.platform === "win32" && command.startsWith("docker ")) {
      if (!wslDistro) {
        resolve("");
        return;
      }
      // Use -- separator which is more robust for passing complex strings to WSL
      const args = [
        "-d",
        wslDistro,
        "--",
        "sudo",
        "env",
        `PATH=${WSL_LINUX_PATH}`,
        "bash",
        "-c",
        command,
      ];
      execFile(
        "wsl.exe",
        args,
        { maxBuffer: 1024 * 1024 * 10 },
        (error, stdout, stderr) => {
          if (error) {
            const msg = `${error.message}\n${stderr || ""}`.toLowerCase();
            // Gracefully handle common Docker/WSL failures
            if (
              msg.includes("is not running") ||
              msg.includes("connection refused") ||
              msg.includes(
                "distribution with the supplied name could not be found",
              ) ||
              msg.includes("docker: command not found") ||
              msg.includes(
                "the command 'docker' could not be found in this wsl 2 distro",
              ) ||
              msg.includes("error response from daemon") ||
              msg.includes("context deadline exceeded") ||
              msg.includes("unexpected eof") ||
              msg.includes("i/o timeout") ||
              // Handle sudo/permission errors more gracefully
              msg.includes("sudo") ||
              msg.includes("permission denied") ||
              msg.includes("password") ||
              msg.includes("authentication failure")
            ) {
              // For monitoring commands, gracefully degrade rather than reject
              // This allows the monitor to keep polling even if sudo/permissions fail
              console.debug(
                `Docker command tolerated error (monitoring continues): ${error.message}`,
              );
              resolve("");
              return;
            }
            // For unexpected errors, log but still gracefully handle for monitor stability
            console.warn(
              `Docker command unexpected error: ${error.message}${stderr ? `\nStderr: ${stderr}` : ""}`,
            );
            resolve(""); // Resolve to empty string instead of rejecting to keep monitor alive
            return;
          }
          resolve(stdout.trim());
        },
      );
    } else {
      const effectiveCommand =
        process.platform === "linux" && useSgDocker
          ? `sg docker -c ${JSON.stringify(command)}`
          : command;
      exec(
        effectiveCommand,
        { maxBuffer: 1024 * 1024 * 10 },
        (error, stdout, stderr) => {
          if (error) {
            const msg = `${error.message}\n${stderr || ""}`.toLowerCase();
            if (
              msg.includes("is not running") ||
              msg.includes("connection refused") ||
              msg.includes("error response from daemon") ||
              msg.includes("context deadline exceeded") ||
              msg.includes("unexpected eof") ||
              msg.includes("i/o timeout") ||
              msg.includes("permission denied") ||
              msg.includes("password") ||
              msg.includes("authentication failure")
            ) {
              resolve("");
              return;
            }
            // For unexpected errors, log but gracefully degrade to keep monitor stable
            console.warn(
              `Docker command unexpected error: ${error.message}${stderr ? `\nStderr: ${stderr}` : ""}`,
            );
            resolve(""); // Resolve to empty string instead of rejecting
            return;
          }
          resolve(stdout.trim());
        },
      );
    }
  });
}

// --- DOCKER STATUS DETECTION ---

function classifyDockerCheckError(errorMessage = "", stderr = "") {
  const combined = `${errorMessage}\n${stderr}`.toLowerCase();
  if (combined.includes("permission denied")) return "DOCKER_PERMISSION_DENIED";
  if (
    combined.includes("docker: command not found") ||
    combined.includes(
      "the command 'docker' could not be found in this wsl 2 distro",
    )
  ) {
    return "DOCKER_CLI_NOT_FOUND";
  }
  return null;
}

function runDockerCheckCommand(
  cmd,
  { useWsl = false, wslDistro = null, wslUser = "root", timeoutMs } = {},
) {
  return new Promise((resolve) => {
    if (useWsl && process.platform === "win32") {
      const args = [
        "-d",
        wslDistro,
        "--user",
        wslUser,
        "--",
        "env",
        `PATH=${WSL_LINUX_PATH}`,
        "bash",
        "-lc",
        cmd,
      ];
      execFile(
        "wsl.exe",
        args,
        { timeout: timeoutMs ?? WSL_DOCKER_CHECK_TIMEOUT_MS },
        (error, stdout, stderr) => {
          if (error) {
            const errorCode = classifyDockerCheckError(error.message, stderr);
            if (errorCode !== "DOCKER_CLI_NOT_FOUND") {
              console.log(`Check command '${cmd}' failed: ${error.message}`);
              console.log(`WSL Stdout: ${stdout}`);
              console.log(`WSL Stderr: ${stderr}`);
            }
            resolve({
              success: false,
              error: error.message,
              stderr: stderr?.trim() || "",
              code: errorCode || undefined,
            });
            return;
          }
          resolve({ success: true, output: stdout.trim() });
        },
      );
      return;
    }
    const effectiveCmd =
      process.platform === "linux" && useSgDocker
        ? `sg docker -c ${JSON.stringify(cmd)}`
        : cmd;
    exec(
      effectiveCmd,
      { timeout: timeoutMs ?? 10000 },
      (error, stdout, stderr) => {
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
      },
    );
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
        response.on("data", (chunk) => {
          body += chunk.toString();
        });
        response.on("end", () => {
          resolve(response.statusCode === 200 && body.trim() === "OK");
        });
      },
    );
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => {
      resolve(false);
    });
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

// --- WSL DOCKER CHECK ---

async function checkWslDockerStatus({ hostTimeoutMs = 15000 } = {}) {
  if (process.platform !== "win32") return { installed: false, running: false };

  const installStatus = getActiveWindowsInstallStatus();
  if (installStatus) {
    delete process.env.OPENFORK_DOCKER_HOST;
    return installStatus;
  }

  const wslDistro = await wslUtils.getWslDistroName();
  if (!wslDistro) {
    delete process.env.OPENFORK_WSL_DISTRO;
    delete process.env.OPENFORK_DOCKER_HOST;
    // No suitable WSL distro found (e.g. only docker-desktop internal distros exist).
    // Return silently — no spam, re-detection happens on the next poll.
    return { installed: false, running: false, isNative: false };
  }
  process.env.OPENFORK_WSL_DISTRO = wslDistro;

  const distroExists = await wslUtils.checkDistroExists(wslDistro);
  if (!distroExists) {
    console.log(`WSL distro '${wslDistro}' is missing`);
    delete process.env.OPENFORK_WSL_DISTRO;
    delete process.env.OPENFORK_DOCKER_HOST;
    // Invalidate only the in-memory cache so the next poll re-detects whatever
    // distro is available, while the store entry is preserved in case the same
    // distro is re-registered.
    wslUtils.invalidateWslDistroCache();
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
    timeoutMs: WSL_DOCKER_CHECK_TIMEOUT_MS,
  });
  if (!versionResult.success) {
    if (versionResult.code !== "DOCKER_CLI_NOT_FOUND") {
      console.log(`Docker CLI not found inside WSL distro '${wslDistro}'`);
    }
    return {
      installed: false,
      running: false,
      isNative: false,
      installDrive,
      storagePath,
      error:
        versionResult.code ||
        classifyDockerCheckError(versionResult.error, versionResult.stderr) ||
        undefined,
      wslDistro,
    };
  }

  const infoResult = await runDockerCheckCommand("docker info", {
    useWsl: true,
    wslDistro,
    timeoutMs: WSL_DOCKER_CHECK_TIMEOUT_MS,
  });
  if (!infoResult.success) {
    // Unix-socket docker info failed — the daemon may be TCP-only.
    // Do a fast TCP ping before declaring Docker not ready.
    console.log(
      `Docker is installed in WSL distro '${wslDistro}' but docker info via ` +
        `Unix socket failed. Checking TCP endpoint before reporting not-ready.`,
    );
    const quickHost = await resolveWindowsDockerApiEndpoint(3000);
    if (quickHost) {
      // TCP API is reachable — daemon is running, just not on the Unix socket.
      process.env.OPENFORK_DOCKER_HOST = quickHost;
      return {
        installed: true,
        running: true,
        isNative: false,
        installDrive,
        storagePath,
        dockerHost: quickHost,
        wslDistro,
      };
    }
    // TCP also unreachable — Docker genuinely not ready.
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
        infoResult.code ||
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

async function resolveDockerStatus({
  allowNativeStart = true,
  wslHostTimeoutMs = 15000,
} = {}) {
  if (process.platform !== "win32") {
    const versionResult = await runDockerCheckCommand("docker --version");
    if (!versionResult.success) return { installed: false, running: false };
    const infoResult = await runDockerCheckCommand("docker info");
    if (infoResult.success) {
      return { installed: true, running: true, activeEngine: "linux" };
    }
    const error = classifyDockerCheckError(infoResult.error, infoResult.stderr);
    if (error === "DOCKER_PERMISSION_DENIED") {
      // User was just added to the docker group but hasn't re-logged in.
      // sg picks up the new group membership mid-session.
      const sgResult = await runDockerCheckCommand(
        'sg docker -c "docker info"',
      );
      if (sgResult.success) {
        useSgDocker = true;
        return { installed: true, running: true, activeEngine: "linux" };
      }
    }
    return {
      installed: true,
      running: false,
      activeEngine: "linux",
      error: error || undefined,
    };
  }

  const wsl = await checkWslDockerStatus({ hostTimeoutMs: wslHostTimeoutMs });
  const native = { installed: false, running: false };
  const decorate = (status) =>
    withWindowsDockerMetadata(status, {
      preference: "wsl",
      native,
      wsl,
    });

  if (wsl.running) {
    return decorate(buildRunningWslStatus(wsl));
  }

  if (wsl.isStarting) {
    delete process.env.OPENFORK_DOCKER_HOST;
    return decorate({
      installed: false,
      running: false,
      isNative: false,
      isStarting: true,
      installDrive: wsl.installDrive,
    });
  }

  if (wsl.installed) {
    return decorate(buildWslStatus(wsl));
  }

  delete process.env.OPENFORK_DOCKER_HOST;
  return decorate({
    installed: false,
    running: false,
    isNative: false,
    error: wsl.error,
    ...(wsl.wslDistro ? { wslDistro: wsl.wslDistro } : {}),
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
  checkWslDockerStatus,
  resolveDockerStatus,
  getActiveWindowsInstallStatus,
};
