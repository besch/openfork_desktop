"use strict";

const fs = require("fs");
const path = require("path");
const { exec, execFile } = require("child_process");
const { dialog } = require("electron");

const dockerEngine = require("./docker-engine.cjs");
const dockerMonitor = require("./docker-monitor.cjs");
const dockerStorage = require("./docker-storage.cjs");
const wslUtils = require("./wsl-utils.cjs");
const settings = require("./settings.cjs");
const engineInstall = require("./engine-install.cjs");

let _app;
let _getMainWindow;
let _getPythonManager;
let _onImageRemoved;
let _onManualCompactCompleted;

function init({
  app,
  getMainWindow,
  getPythonManager,
  onImageRemoved,
  onManualCompactCompleted,
}) {
  _app = app;
  _getMainWindow = getMainWindow || null;
  _getPythonManager = getPythonManager;
  _onImageRemoved = onImageRemoved || null;
  _onManualCompactCompleted = onManualCompactCompleted || null;
}

let reclaimProcess = null;
let reclaimCancelRequested = false;
let reclaimWasMonitoring = false;
let lastSuccessfulReclaimTs = 0;
const POST_RECLAIM_WSL_SETTLE_MS = 60 * 1000;
const reclaimState = {
  inProgress: false,
  phase: undefined,
  error: undefined,
  startedTs: 0,
  pid: null,
  cancelRequested: false,
};

function getReclaimStatus() {
  return { ...reclaimState };
}

function isReclaimInProgress() {
  return reclaimState.inProgress === true;
}

function isInPostReclaimSettleWindow() {
  return (
    lastSuccessfulReclaimTs > 0 &&
    Date.now() - lastSuccessfulReclaimTs < POST_RECLAIM_WSL_SETTLE_MS
  );
}

function notifyReclaimStatus(patch = {}) {
  Object.assign(reclaimState, patch);
  const mainWindow = _getMainWindow?.();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("docker:reclaim-status", getReclaimStatus());
  }
}

function resetReclaimRouting() {
  dockerMonitor.resetDockerRoutingCache();
  if (reclaimWasMonitoring) {
    dockerMonitor.startDockerMonitoring();
  }
  reclaimWasMonitoring = false;
}

function finishReclaim({ phase, error } = {}) {
  const completed = phase === "completed";
  if (completed) {
    lastSuccessfulReclaimTs = Date.now();
  }
  reclaimProcess = null;
  reclaimCancelRequested = false;
  notifyReclaimStatus({
    inProgress: false,
    phase: phase || "completed",
    error,
    pid: null,
    cancelRequested: false,
  });
  resetReclaimRouting();

  if (completed && typeof _onManualCompactCompleted === "function") {
    try {
      _onManualCompactCompleted();
    } catch (callbackError) {
      console.warn(
        "Manual compaction completion callback failed:",
        callbackError.message,
      );
    }
  }
}

async function recoverWslAfterSuccessfulReclaim(wslDistro) {
  if (process.platform !== "win32" || !wslDistro) return;

  notifyReclaimStatus({ phase: "recovering_wsl" });
  dockerMonitor.resetDockerRoutingCache();

  try {
    let dockerStatus = await dockerEngine.resolveDockerStatus({
      allowNativeStart: false,
      wslHostTimeoutMs: 10000,
    });
    if (dockerStatus.running) return;

    if (
      dockerStatus.error === "WSL_VHDX_LOCKED" ||
      dockerStatus.error === "DOCKER_API_UNREACHABLE"
    ) {
      dockerStatus = await dockerEngine.restartWslDockerEngine({
        wslDistro,
        waitTimeoutMs: 120000,
        onPhase: (phase) => {
          notifyReclaimStatus({ phase: `recovering_${phase}` });
        },
      });
      if (dockerStatus?.running) return;
    }

    console.warn(
      `Manual compaction finished, but WSL Docker is not ready yet (${dockerStatus.error || "unknown"}). It may recover on the next monitor poll.`,
    );
  } catch (error) {
    console.warn(
      "Manual compaction finished, but post-compaction WSL recovery did not complete:",
      error?.message || error,
    );
  } finally {
    dockerMonitor.resetDockerRoutingCache();
  }
}

function getPowerShellDiagnosticLines(output = "") {
  return output
    .replace(/\0/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        !/^At line:/i.test(line) &&
        !/^At .+:\d+ char:\d+/i.test(line) &&
        !/^\+/.test(line) &&
        !/^~+$/.test(line) &&
        !/^CategoryInfo/i.test(line) &&
        !/^FullyQualifiedErrorId/i.test(line),
    );
}

function buildCompactionFailureMessage(error, stdout = "", stderr = "") {
  const stderrLines = getPowerShellDiagnosticLines(stderr);
  const stdoutLines = getPowerShellDiagnosticLines(stdout);
  const lines = [...stderrLines, ...stdoutLines];
  const compactionError = lines.find((line) =>
    /Error during compaction:/i.test(line),
  );
  if (compactionError) {
    return compactionError.replace(/^.*?:\s*(Error during compaction:)/i, "$1");
  }

  const prioritized = lines.filter((line) =>
    /(error|failed|denied|timed out|canceled|cancelled|in use|requires elevation|not found)/i.test(
      line,
    ),
  );

  if (prioritized.length > 0) {
    return prioritized[prioritized.length - 1];
  }
  if (stderrLines.length > 0) {
    return stderrLines[stderrLines.length - 1];
  }
  if (stdoutLines.length > 0) {
    return stdoutLines[stdoutLines.length - 1];
  }
  return error?.message || "Compaction failed.";
}

async function tryTrimWslFilesystem() {
  if (!dockerEngine.isUsingWslDocker()) {
    return { attempted: false, success: false };
  }

  const wslDistro = await wslUtils.getWslDistroName();
  if (!wslDistro) {
    return { attempted: false, success: false };
  }

  const trimResult = await dockerEngine.runDockerCheckCommand(
    "sync && (command -v fstrim >/dev/null 2>&1 && fstrim -av || true)",
    {
      useWsl: true,
      wslDistro,
      wslUser: "root",
      timeoutMs: 120000,
    },
  );

  if (!trimResult.success) {
    console.warn(
      `WSL trim did not complete for distro '${wslDistro}': ${trimResult.error || trimResult.stderr || "unknown error"}`,
    );
    return {
      attempted: true,
      success: false,
      error: trimResult.error || trimResult.stderr || "WSL trim failed",
    };
  }

  return {
    attempted: true,
    success: true,
    output: trimResult.output || "",
  };
}

async function getDockerImageSizeBytes(imageId) {
  try {
    const output = await dockerEngine.execDockerCommand(
      `docker image inspect ${dockerEngine.escapeShellArg(imageId)} --format "{{.Size}}"`,
    );
    const size = Number.parseInt(String(output || "").trim(), 10);
    return Number.isFinite(size) && size > 0 ? size : 0;
  } catch (error) {
    console.warn(`Could not inspect image size for ${imageId}:`, error.message);
    return 0;
  }
}

function notifyImagesRemoved({
  image = null,
  freedBytes = 0,
  reason = "manual_delete",
}) {
  const payload = {
    service_type: null,
    image,
    freed_bytes: freedBytes,
    reason,
  };

  if (_onImageRemoved && freedBytes > 0) {
    try {
      _onImageRemoved(payload);
    } catch (error) {
      console.warn("Image removal notification failed:", error.message);
    }
  }

  try {
    _getPythonManager?.()?.syncCachedImages?.();
  } catch (error) {
    console.warn(
      "Could not request cached image sync after manual deletion:",
      error.message,
    );
  }
}

function runPowerShellCommand(command, { timeout = 15000 } = {}) {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        command,
      ],
      { timeout, windowsHide: true, encoding: "utf8" },
      (error, stdout, stderr) => {
        resolve({
          success: !error,
          stdout: stdout?.toString?.() || "",
          stderr: stderr?.toString?.() || "",
          error: error?.message,
        });
      },
    );
  });
}

async function isSparseFile(filePath) {
  if (process.platform !== "win32" || !filePath) return null;
  const escapedPath = filePath.replace(/'/g, "''");
  const command = [
    `$path = '${escapedPath}'`,
    "if (-not (Test-Path -LiteralPath $path)) { exit 2 }",
    "$attrs = [System.IO.File]::GetAttributes($path)",
    "if (($attrs -band [System.IO.FileAttributes]::SparseFile) -ne 0) { 'true' } else { 'false' }",
  ].join("; ");

  const result = await runPowerShellCommand(command, { timeout: 5000 });
  if (!result.success) return null;
  const value = result.stdout.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

async function getWslVersionSummary() {
  if (process.platform !== "win32") return null;
  return new Promise((resolve) => {
    execFile(
      "wsl.exe",
      ["--version"],
      { timeout: 5000, windowsHide: true, encoding: "utf8" },
      (error, stdout) => {
        if (error || !stdout) {
          resolve(null);
          return;
        }
        const lines = stdout
          .replace(/\0/g, "")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        resolve(
          lines.find((line) => /^WSL version:/i.test(line)) || lines[0] || null,
        );
      },
    );
  });
}

function getWindowsDefaultOpenForkInstallPath() {
  const systemDrive = process.env.SYSTEMDRIVE || "C:";
  return path.join(systemDrive, "OpenFork", "wsl");
}

function getRelocateWslScriptPath() {
  return _app.isPackaged
    ? path.join(process.resourcesPath, "scripts", "relocate-wsl.ps1")
    : path.join(__dirname, "..", "scripts", "relocate-wsl.ps1");
}

async function isOpenForkContainerId(containerId) {
  if (!dockerEngine.isValidDockerId(containerId)) return false;
  const output = await dockerEngine.execDockerCommand(
    'docker ps -a --format "{{.ID}}|{{.Names}}|{{.Image}}" --filter "name=dgn-client"',
  );
  return output
    .split("\n")
    .filter(Boolean)
    .some((line) => {
      const [id, names, image] = line.split("|");
      return (
        (id === containerId || id?.startsWith(containerId)) &&
        ((names || "").toLowerCase().includes("dgn-client") ||
          (image || "").toLowerCase().includes("openfork"))
      );
    });
}

async function confirmSensitiveDockerAction({ title, message, detail }) {
  const mainWindow = _getMainWindow?.();
  const options = {
    type: "warning",
    buttons: ["Continue", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title,
    message,
    detail,
  };
  const result =
    mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options);
  return result.response === 0;
}

function cancelledSensitiveAction() {
  return {
    success: false,
    error: "ACTION_CANCELLED",
    message: "Action cancelled.",
  };
}

function register(ipcMain) {
  // --- MONITORING ---

  ipcMain.on("docker:start-monitoring", dockerMonitor.startDockerMonitoring);
  ipcMain.on("docker:stop-monitoring", dockerMonitor.stopDockerMonitoring);

  // --- LIST ---

  ipcMain.handle("docker:list-images", async () => {
    try {
      const routingStatus = await dockerMonitor.ensureDockerRouting();
      if (
        routingStatus?.error === "WSL_COMPACTING" ||
        routingStatus?.error === "WSL_VHDX_LOCKED"
      ) {
        return { success: true, data: [] };
      }
      const output = await dockerEngine.execDockerCommand(
        'docker images --format "{{json .}}"',
      );
      if (!output) return { success: true, data: [] };
      const images = output
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const img = JSON.parse(line);
          return {
            id: img.ID,
            repository: img.Repository,
            tag: img.Tag,
            size: img.Size,
            created: img.CreatedAt || img.CreatedSince,
          };
        })
        .filter((img) => {
          const fullName = `${img.repository}:${img.tag}`.toLowerCase();
          return fullName.includes("openfork");
        });
      return { success: true, data: images };
    } catch (error) {
      console.error("Failed to list Docker images:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("docker:list-containers", async () => {
    try {
      const routingStatus = await dockerMonitor.ensureDockerRouting();
      if (
        routingStatus?.error === "WSL_COMPACTING" ||
        routingStatus?.error === "WSL_VHDX_LOCKED"
      ) {
        return { success: true, data: [] };
      }
      const output = await dockerEngine.execDockerCommand(
        'docker ps -a --format "{{json .}}" --filter "name=dgn-client"',
      );
      if (!output) return { success: true, data: [] };
      const containers = output
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const container = JSON.parse(line);
          return {
            id: container.ID,
            name: container.Names,
            image: container.Image,
            status: container.Status,
            state: container.State,
            created: container.CreatedAt,
          };
        });
      return { success: true, data: containers };
    } catch (error) {
      console.error("Failed to list Docker containers:", error);
      return { success: false, error: error.message };
    }
  });

  // --- REMOVE ---

  ipcMain.handle("docker:remove-image", async (event, imageId) => {
    try {
      if (!dockerEngine.isValidDockerId(imageId)) {
        console.warn(`Invalid Docker ID format: ${imageId}`);
        return { success: false, error: "Invalid Docker ID format" };
      }

      // Get all images to verify the ID against our OpenFork filter
      const listOutput = await dockerEngine.execDockerCommand(
        'docker images --format "{{.ID}}|{{.Repository}}:{{.Tag}}"',
      );
      const lines = listOutput.split("\n").filter(Boolean);
      let imageMeta = null;
      const isAllowed = lines.some((line) => {
        const [id, fullName] = line.split("|");
        const allowed =
          (id === imageId || id.startsWith(imageId)) &&
          fullName.toLowerCase().includes("openfork");
        if (allowed) {
          imageMeta = { id, fullName };
        }
        return allowed;
      });

      if (!isAllowed) {
        console.warn(`Image ${imageId} validation failed, skipping removal`);
        return { success: false, error: "Only OpenFork images can be removed" };
      }

      const confirmed = await confirmSensitiveDockerAction({
        title: "Remove Docker Image",
        message: "Remove this OpenFork Docker image?",
        detail:
          imageMeta?.fullName ||
          "The image and any dependent OpenFork containers will be removed.",
      });
      if (!confirmed) return cancelledSensitiveAction();

      // WSL2 ROBUSTNESS: Find and remove ANY containers using this image (running or stopped)
      try {
        const containerIds = await dockerEngine.execDockerCommand(
          `docker ps -a -q --filter ancestor=${dockerEngine.escapeShellArg(imageId)}`,
        );
        if (containerIds) {
          const ids = containerIds.split("\n").filter(Boolean);
          for (const id of ids) {
            if (!dockerEngine.isValidDockerId(id)) continue;
            console.log(
              `Force removing dependent container ${id} for image ${imageId}`,
            );
            await dockerEngine.execDockerCommand(
              `docker rm -f ${dockerEngine.escapeShellArg(id)}`,
            );
          }
        }
      } catch (e) {
        console.warn(
          `Non-critical error cleaning up containers for image ${imageId}:`,
          e.message,
        );
      }

      const freedBytes = await getDockerImageSizeBytes(imageId);

      // Force remove the image
      await dockerEngine.execDockerCommand(
        `docker rmi -f ${dockerEngine.escapeShellArg(imageId)}`,
      );

      // Prune dangling layers to actually recover space
      try {
        await dockerEngine.execDockerCommand("docker image prune -f");
      } catch (e) {
        // Ignore prune errors
      }

      await tryTrimWslFilesystem();

      // On WSL Docker, rmi + prune free space inside the VHDX but the file itself
      // doesn't shrink until compacted. Suggest that to the user.
      notifyImagesRemoved({
        image: imageMeta?.fullName || imageId,
        freedBytes,
        reason: "manual_delete",
      });
      dockerEngine.emitCompactionSuggested();
      return { success: true };
    } catch (error) {
      console.error(`Failed to remove Docker image ${imageId}:`, error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("docker:remove-all-images", async () => {
    try {
      const confirmed = await confirmSensitiveDockerAction({
        title: "Remove OpenFork Images",
        message: "Remove all OpenFork Docker images?",
        detail:
          "This deletes local OpenFork model images and may require downloading them again before jobs can run.",
      });
      if (!confirmed) return cancelledSensitiveAction();

      const listOutput = await dockerEngine.execDockerCommand(
        'docker images --format "{{.ID}}|{{.Repository}}:{{.Tag}}"',
      );
      if (!listOutput) return { success: true, removedCount: 0 };

      const lines = listOutput.split("\n").filter(Boolean);
      let removedCount = 0;
      let freedBytes = 0;
      for (const line of lines) {
        const [id, fullName] = line.split("|");
        if (
          fullName &&
          fullName.toLowerCase().includes("openfork") &&
          dockerEngine.isValidDockerId(id)
        ) {
          try {
            freedBytes += await getDockerImageSizeBytes(id);
            await dockerEngine.execDockerCommand(
              `docker rmi -f ${dockerEngine.escapeShellArg(id)}`,
            );
            removedCount++;
          } catch (e) {
            console.warn(`Failed to remove image ${id}:`, e.message);
          }
        }
      }

      try {
        await dockerEngine.execDockerCommand("docker image prune -f");
      } catch (e) {
        // Non-fatal
      }

      await tryTrimWslFilesystem();

      if (removedCount > 0) {
        notifyImagesRemoved({
          image: `${removedCount} OpenFork image${removedCount === 1 ? "" : "s"}`,
          freedBytes,
          reason: "manual_delete_all",
        });
        dockerEngine.emitCompactionSuggested();
      }
      return { success: true, removedCount };
    } catch (error) {
      console.error("Failed to remove all Docker images:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("docker:stop-container", async (event, containerId) => {
    try {
      if (!dockerEngine.isValidDockerId(containerId)) {
        console.warn(`Invalid Docker container ID format: ${containerId}`);
        return { success: false, error: "Invalid container ID format" };
      }
      if (!(await isOpenForkContainerId(containerId))) {
        console.warn(
          `Container ${containerId} validation failed, skipping stop`,
        );
        return {
          success: false,
          error: "Only OpenFork DGN containers can be stopped",
        };
      }
      const confirmed = await confirmSensitiveDockerAction({
        title: "Stop OpenFork Container",
        message: "Stop and remove this OpenFork container?",
        detail:
          "Any job currently running in this container will be interrupted.",
      });
      if (!confirmed) return cancelledSensitiveAction();
      await dockerEngine.execDockerCommand(
        `docker stop ${dockerEngine.escapeShellArg(containerId)}`,
      );
      await dockerEngine.execDockerCommand(
        `docker rm -f ${dockerEngine.escapeShellArg(containerId)}`,
      );
      return { success: true };
    } catch (error) {
      console.error(`Failed to stop container ${containerId}:`, error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("docker:stop-all-containers", async () => {
    try {
      const confirmed = await confirmSensitiveDockerAction({
        title: "Stop OpenFork Containers",
        message: "Stop and remove all OpenFork containers?",
        detail: "Any currently running OpenFork DGN jobs will be interrupted.",
      });
      if (!confirmed) return cancelledSensitiveAction();

      const listOutput = await dockerEngine.execDockerCommand(
        'docker ps -a --format "{{.ID}}" --filter "name=dgn-client"',
      );
      if (!listOutput) return { success: true, stoppedCount: 0 };

      const containerIds = listOutput.split("\n").filter(Boolean);
      for (const id of containerIds) {
        if (!dockerEngine.isValidDockerId(id)) continue;
        try {
          await dockerEngine.execDockerCommand(
            `docker stop ${dockerEngine.escapeShellArg(id)}`,
          );
          await dockerEngine.execDockerCommand(
            `docker rm -f ${dockerEngine.escapeShellArg(id)}`,
          );
        } catch (e) {
          console.warn(`Failed to stop/remove container ${id}:`, e.message);
        }
      }
      return { success: true, stoppedCount: containerIds.length };
    } catch (error) {
      console.error("Failed to stop all containers:", error);
      return { success: false, error: error.message };
    }
  });

  // --- CLEAN ---

  // Robust Surgical Clean: Stop/Remove OpenFork containers, images, and volumes
  ipcMain.handle("docker:clean-openfork", async () => {
    try {
      const confirmed = await confirmSensitiveDockerAction({
        title: "Purge OpenFork Docker Data",
        message: "Purge OpenFork Docker containers and images?",
        detail:
          "This removes local OpenFork containers, model images, and dangling image layers. Other Docker data is left alone.",
      });
      if (!confirmed) return cancelledSensitiveAction();

      console.log("Starting targeted OpenFork cleanup...");
      let stoppedCount = 0;
      let removedCount = 0;
      let freedBytes = 0;

      // 1. Force remove all dgn-client containers (by name)
      try {
        const containerOutput = await dockerEngine.execDockerCommand(
          'docker ps -a -q --filter "name=dgn-client"',
        );
        if (containerOutput) {
          const ids = containerOutput.split("\n").filter(Boolean);
          for (const id of ids) {
            if (!dockerEngine.isValidDockerId(id)) continue;
            await dockerEngine.execDockerCommand(
              `docker rm -f ${dockerEngine.escapeShellArg(id)}`,
            );
            stoppedCount++;
          }
        }
      } catch (e) {
        console.warn("Error cleaning named containers:", e.message);
      }

      // 2. Find ALL images containing 'openfork' and their dependent containers
      try {
        const imageOutput = await dockerEngine.execDockerCommand(
          'docker images --format "{{.ID}}|{{.Repository}}"',
        );
        if (imageOutput) {
          const lines = imageOutput.split("\n").filter(Boolean);
          for (const line of lines) {
            const [id, repo] = line.split("|");
            if (
              repo.toLowerCase().includes("openfork") &&
              dockerEngine.isValidDockerId(id)
            ) {
              // Find any remaining containers using this image
              try {
                const deps = await dockerEngine.execDockerCommand(
                  `docker ps -a -q --filter ancestor=${dockerEngine.escapeShellArg(id)}`,
                );
                if (deps) {
                  const depIds = deps.split("\n").filter(Boolean);
                  for (const depId of depIds) {
                    if (!dockerEngine.isValidDockerId(depId)) continue;
                    await dockerEngine.execDockerCommand(
                      `docker rm -f ${dockerEngine.escapeShellArg(depId)}`,
                    );
                    stoppedCount++;
                  }
                }
              } catch (e) {}
              try {
                freedBytes += await getDockerImageSizeBytes(id);
                await dockerEngine.execDockerCommand(
                  `docker rmi -f ${dockerEngine.escapeShellArg(id)}`,
                );
                removedCount++;
              } catch (e) {
                console.warn(`Failed to remove image ${id}:`, e.message);
              }
            }
          }
        }
      } catch (e) {
        console.warn("Error cleaning images:", e.message);
      }

      // 3. Prune dangling layers only. Avoid global volume/container prunes:
      // this screen is scoped to OpenFork and must not delete unrelated Docker data.
      try {
        await dockerEngine.execDockerCommand("docker image prune -f");
      } catch (e) {}

      await tryTrimWslFilesystem();

      if (removedCount > 0) {
        notifyImagesRemoved({
          image: `${removedCount} OpenFork image${removedCount === 1 ? "" : "s"}`,
          freedBytes,
          reason: "manual_purge",
        });
        dockerEngine.emitCompactionSuggested();
      }
      return { success: true, stoppedCount, removedCount };
    } catch (error) {
      console.error("Failed to clean OpenFork data:", error);
      return { success: false, error: error.message };
    }
  });

  // --- DISK SPACE ---

  ipcMain.handle("docker:get-disk-space", async () => {
    try {
      let totalBytes, freeBytes, usedBytes, diskPath;
      let engineFileBytes = null;
      let engineFilePath = null;
      let engineFileSparse = null;
      let wslVersion = null;

      if (process.platform === "win32") {
        let driveLetter = wslUtils.getWindowsSystemDriveLetter();
        let storagePath = `${driveLetter}:\\`;

        const wslDistro = await wslUtils.getWslDistroName();
        const wslStoragePath = wslDistro
          ? await wslUtils.resolveWslStoragePath(wslDistro)
          : null;
        if (wslStoragePath) {
          storagePath = wslStoragePath;
          driveLetter =
            dockerStorage.getDriveLetterFromPath(wslStoragePath) || driveLetter;
        }

        const psCommand = `Get-PSDrive ${driveLetter} | Select-Object Free, Used | ConvertTo-Json`;
        const output = await new Promise((resolve) => {
          exec(
            `powershell -NoProfile -NonInteractive -Command "${psCommand}"`,
            { timeout: 15000 },
            (error, stdout) => {
              if (error) {
                console.error(
                  "PowerShell disk space check error:",
                  error.message,
                );
                resolve("");
                return;
              }
              resolve(stdout.trim());
            },
          );
        });

        if (output) {
          try {
            const diskInfo = JSON.parse(output);
            freeBytes = diskInfo.Free;
            usedBytes = diskInfo.Used;
            totalBytes = freeBytes + usedBytes;
            diskPath = storagePath;
          } catch (e) {
            console.error("Error parsing disk space info:", e);
          }
        }

        if (!totalBytes) {
          return {
            success: false,
            error: "Failed to query system disk space",
            data: {
              total_gb: "0",
              used_gb: "0",
              free_gb: "0",
              path: "C:\\",
              engine_file_gb: null,
              engine_file_path: null,
              engine_file_sparse: null,
              wsl_version: null,
            },
          };
        }

        if (
          typeof storagePath === "string" &&
          storagePath.toLowerCase().endsWith(".vhdx") &&
          fs.existsSync(storagePath)
        ) {
          try {
            engineFileBytes = fs.statSync(storagePath).size;
            engineFilePath = storagePath;
            engineFileSparse = await isSparseFile(storagePath);
          } catch (statError) {
            console.warn(
              `Failed to stat WSL disk file '${storagePath}':`,
              statError.message,
            );
          }
        }
        wslVersion = await getWslVersionSummary();
      } else {
        let targetPath = "/";
        if (process.platform === "linux") {
          try {
            const dockerRootOutput = await dockerEngine.execDockerCommand(
              'docker info --format "{{.DockerRootDir}}"',
            );
            if (dockerRootOutput) {
              targetPath = dockerRootOutput.split(/\r?\n/)[0].trim() || "/";
            }
          } catch {
            targetPath = "/";
          }
        }

        const dfOutput = await new Promise((resolve, reject) => {
          exec(
            `df -k ${dockerEngine.escapeShellArg(targetPath)}`,
            { timeout: 10000 },
            (error, stdout) => {
              if (error) {
                reject(error);
                return;
              }
              resolve(stdout.trim());
            },
          );
        });

        const lines = dfOutput.split("\n");
        if (lines.length < 2) throw new Error("Invalid df output");
        const parts = lines[1].split(/\s+/);
        // df -k gives: Filesystem 1K-blocks Used Available Use% Mounted
        const totalKB = parseInt(parts[1]);
        const usedKB = parseInt(parts[2]);
        const availableKB = parseInt(parts[3]);
        totalBytes = totalKB * 1024;
        usedBytes = usedKB * 1024;
        freeBytes = availableKB * 1024;
        diskPath = targetPath;
      }

      return {
        success: true,
        data: {
          total_gb: (totalBytes / 1024 ** 3).toFixed(1),
          used_gb: (usedBytes / 1024 ** 3).toFixed(1),
          free_gb: (freeBytes / 1024 ** 3).toFixed(1),
          path: diskPath,
          engine_file_gb:
            typeof engineFileBytes === "number"
              ? (engineFileBytes / 1024 ** 3).toFixed(1)
              : null,
          engine_file_path: engineFilePath,
          engine_file_sparse: engineFileSparse,
          wsl_version: wslVersion,
        },
      };
    } catch (error) {
      console.error("Failed to get disk space:", error);
      return {
        success: false,
        error: error.message,
        data: {
          total_gb: "0",
          used_gb: "0",
          free_gb: "0",
          path: "",
          engine_file_gb: null,
          engine_file_path: null,
          engine_file_sparse: null,
          wsl_version: null,
        },
      };
    }
  });

  ipcMain.handle("docker:get-image-cache-usage", async () => {
    try {
      const routingStatus = await dockerMonitor.ensureDockerRouting();
      if (
        routingStatus?.error === "WSL_COMPACTING" ||
        routingStatus?.error === "WSL_VHDX_LOCKED"
      ) {
        return {
          success: true,
          data: { total_bytes: 0, total_gb: "0.0", image_count: 0 },
        };
      }

      const listOutput = await dockerEngine.execDockerCommand(
        'docker images --format "{{.ID}}|{{.Repository}}:{{.Tag}}"',
      );
      if (!listOutput) {
        return {
          success: true,
          data: { total_bytes: 0, total_gb: "0.0", image_count: 0 },
        };
      }

      const uniqueImages = new Map();
      for (const line of listOutput.split("\n").filter(Boolean)) {
        const [id, fullName] = line.split("|");
        if (
          id &&
          fullName &&
          fullName.toLowerCase().includes("openfork") &&
          dockerEngine.isValidDockerId(id)
        ) {
          uniqueImages.set(id, fullName);
        }
      }

      let totalBytes = 0;
      for (const id of uniqueImages.keys()) {
        totalBytes += await getDockerImageSizeBytes(id);
      }

      return {
        success: true,
        data: {
          total_bytes: totalBytes,
          total_gb: (totalBytes / 1024 ** 3).toFixed(1),
          image_count: uniqueImages.size,
        },
      };
    } catch (error) {
      console.error("Failed to get OpenFork image cache usage:", error);
      return { success: false, error: error.message };
    }
  });

  // --- DISK MANAGEMENT ---

  ipcMain.handle("docker:get-reclaim-status", () => getReclaimStatus());

  ipcMain.handle("docker:reclaim-space", async () => {
    // Compaction only makes sense when Docker is running inside a WSL VHDX.
    if (!dockerEngine.isUsingWslDocker()) {
      return {
        success: false,
        error: "NOT_WSL_MODE",
        message:
          "Disk compaction is only available after the OpenFork Ubuntu engine is installed.",
      };
    }

    if (reclaimState.inProgress) {
      return { success: true, started: false, status: getReclaimStatus() };
    }

    // Refuse to compact while the DGN client is running
    if (_getPythonManager()?.isRunning()) {
      return {
        success: false,
        error: "CLIENT_RUNNING",
        message: "Stop the DGN engine before compacting disk space.",
      };
    }

    reclaimWasMonitoring = dockerMonitor.isDockerMonitoringActive();

    try {
      dockerMonitor.stopDockerMonitoring();
      dockerMonitor.resetDockerRoutingCache();

      const scriptPath = _app.isPackaged
        ? path.join(process.resourcesPath, "scripts", "compact-wsl.ps1")
        : path.join(__dirname, "..", "scripts", "compact-wsl.ps1");

      const wslDistro = await wslUtils.getWslDistroName();
      if (!wslDistro) {
        resetReclaimRouting();
        return {
          success: false,
          error: "WSL_DISTRO_MISSING",
          message: "The OpenFork Ubuntu distro could not be found.",
        };
      }

      notifyReclaimStatus({
        inProgress: true,
        phase: "compacting",
        error: undefined,
        startedTs: Date.now(),
        pid: null,
        cancelRequested: false,
      });

      const args = [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        "-DistroName",
        wslDistro,
      ];

      reclaimCancelRequested = false;
      reclaimProcess = execFile(
        "powershell.exe",
        args,
        {
          windowsHide: true,
          timeout: 30 * 60 * 1000,
          encoding: "utf8",
        },
        (error, stdout, stderr) => {
          if (reclaimCancelRequested) {
            finishReclaim({ phase: "cancelled" });
            return;
          }

          if (error) {
            const message = buildCompactionFailureMessage(
              error,
              stdout,
              stderr,
            );
            console.error("Compaction failed:", {
              message: error.message,
              stdout,
              stderr,
            });
            finishReclaim({ phase: "failed", error: message });
            return;
          }

          recoverWslAfterSuccessfulReclaim(wslDistro)
            .catch((recoveryError) => {
              console.warn(
                "Post-compaction WSL recovery failed:",
                recoveryError?.message || recoveryError,
              );
            })
            .finally(() => {
              finishReclaim({ phase: "completed" });
            });
        },
      );

      notifyReclaimStatus({ pid: reclaimProcess.pid || null });
      return { success: true, started: true, status: getReclaimStatus() };
    } catch (error) {
      finishReclaim({ phase: "failed", error: error.message });
      return {
        success: false,
        error: error.message,
        message: error.message,
      };
    }
  });

  ipcMain.handle("docker:cancel-reclaim-space", async () => {
    if (!reclaimState.inProgress || !reclaimProcess) {
      return { success: true, status: getReclaimStatus() };
    }

    reclaimCancelRequested = true;
    notifyReclaimStatus({ phase: "cancelling", cancelRequested: true });

    const pid = reclaimProcess.pid;
    try {
      reclaimProcess.kill();
    } catch {}
    if (pid) {
      await new Promise((resolve) => {
        execFile(
          "taskkill.exe",
          ["/F", "/T", "/PID", String(pid)],
          { windowsHide: true, timeout: 10000 },
          () => resolve(),
        );
      });
    }

    return { success: true, status: getReclaimStatus() };
  });

  ipcMain.handle("docker:reset-engine", async () => {
    if (process.platform !== "win32") {
      return {
        success: false,
        error: "NOT_WINDOWS",
        message:
          "Fast engine reset is only available for the Windows WSL engine.",
      };
    }

    if (reclaimState.inProgress) {
      return {
        success: false,
        error: "COMPACTION_RUNNING",
        message:
          "Wait for disk compaction to finish before resetting the engine.",
      };
    }

    if (_getPythonManager()?.isRunning()) {
      return {
        success: false,
        error: "CLIENT_RUNNING",
        message: "Stop the DGN engine before resetting OpenFork Ubuntu.",
      };
    }

    const confirmed = await confirmSensitiveDockerAction({
      title: "Reset OpenFork Engine",
      message: "Reset the OpenFork WSL engine?",
      detail:
        "This unregisters the OpenFork Ubuntu distro and deletes its local Docker images before reinstalling it.",
    });
    if (!confirmed) return cancelledSensitiveAction();

    try {
      const wslDistro = await wslUtils.getWslDistroName();
      if (!wslDistro) {
        return {
          success: false,
          error: "WSL_DISTRO_MISSING",
          message: "The OpenFork Ubuntu distro could not be found.",
        };
      }

      const detectedInstallPath =
        (await wslUtils.getDistroBasePath(wslDistro)) ||
        settings.getAppSettings().wslStoragePath ||
        getWindowsDefaultOpenForkInstallPath();
      let installPath = getWindowsDefaultOpenForkInstallPath();
      try {
        installPath =
          engineInstall.normalizeWindowsInstallPath(detectedInstallPath) ||
          installPath;
      } catch {
        console.warn(
          `Ignoring unsafe stored WSL path during reset: ${detectedInstallPath}`,
        );
      }

      const resetArgs = [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        getRelocateWslScriptPath(),
        "-DistroName",
        wslDistro,
        "-NewLocation",
        installPath,
      ];

      const resetResult = await new Promise((resolve) => {
        execFile(
          "powershell.exe",
          resetArgs,
          { windowsHide: true, timeout: 120000, encoding: "utf8" },
          (error, stdout, stderr) => {
            if (error) {
              const detail = (stderr || stdout || error.message)
                .toString()
                .trim();
              resolve({
                success: false,
                error: detail || error.message,
              });
              return;
            }
            resolve({ success: true });
          },
        );
      });

      if (!resetResult.success) {
        return {
          success: false,
          error: resetResult.error,
          message: resetResult.error,
        };
      }

      wslUtils.resetWslDistro();
      dockerMonitor.resetDockerRoutingCache();

      const installResult =
        await engineInstall.handleInstallEngine(installPath);
      if (!installResult.success) {
        return {
          success: false,
          error: installResult.error,
          message: installResult.error,
        };
      }

      settings.saveAppSettings({ wslStoragePath: installPath });
      try {
        _getPythonManager?.()?.syncCachedImages?.();
      } catch (syncError) {
        console.warn(
          "Could not request cached image sync after engine reset:",
          syncError.message,
        );
      }
      return { success: true };
    } catch (error) {
      console.error("Error during docker:reset-engine:", error);
      return { success: false, error: error.message, message: error.message };
    }
  });

  ipcMain.handle("docker:relocate-storage", async (event, newDrivePath) => {
    try {
      let safeNewDrivePath;
      try {
        safeNewDrivePath =
          engineInstall.normalizeWindowsInstallPath(newDrivePath);
      } catch (pathError) {
        return { success: false, error: pathError.message };
      }
      if (!safeNewDrivePath) {
        return {
          success: false,
          error: "A target OpenFork WSL path is required.",
        };
      }

      const confirmed = await confirmSensitiveDockerAction({
        title: "Relocate OpenFork Engine",
        message: "Move the OpenFork WSL engine to a new location?",
        detail:
          "This deletes the current OpenFork Ubuntu distro and reinstalls it at the selected path.",
      });
      if (!confirmed) return cancelledSensitiveAction();

      const relocateScriptPath = _app.isPackaged
        ? path.join(process.resourcesPath, "scripts", "relocate-wsl.ps1")
        : path.join(__dirname, "..", "scripts", "relocate-wsl.ps1");

      const setupScriptPath = _app.isPackaged
        ? path.join(process.resourcesPath, "bin", "setup-wsl.ps1")
        : path.join(__dirname, "..", "..", "client", "setup-wsl.ps1");

      console.log(
        `Cleaning up old distribution before relocation to: ${safeNewDrivePath}`,
      );
      const relocateArgs = [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        relocateScriptPath,
        "-DistroName",
        await wslUtils.getWslDistroName(),
        "-NewLocation",
        safeNewDrivePath,
      ];

      const relocateResult = await new Promise((resolve) => {
        execFile("powershell.exe", relocateArgs, (error) => {
          if (error) {
            console.error("Relocation wipe failed:", error.message);
            resolve({
              success: false,
              error: `Failed to clean up old distribution: ${error.message}`,
            });
          } else {
            console.log("Old distribution cleanup completed.");
            resolve({ success: true });
          }
        });
      });

      if (!relocateResult.success) return relocateResult;

      console.log("Triggering fresh engine installation (elevated)...");
      const setupArgs = safeNewDrivePath
        ? ["-InstallPath", safeNewDrivePath]
        : [];
      const result = await engineInstall.runElevatedPowerShell(
        setupScriptPath,
        setupArgs,
      );

      if (!result.success) {
        console.error("Relocation install failed:", result.error);
        return {
          success: false,
          error: `Installation failed: ${result.error}`,
        };
      }

      settings.saveAppSettings({ wslStoragePath: safeNewDrivePath });
      console.log(`Engine reinstalled successfully at ${safeNewDrivePath}.`);
      return { success: true };
    } catch (error) {
      console.error("Error during docker:relocate-storage:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("get-available-drives", async () => {
    if (process.platform !== "win32") return [];
    return new Promise((resolve) => {
      const psCommand =
        "Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{Name='FreeGB';Expression={[math]::Round($_.Free/1GB, 1)}} | ConvertTo-Json";
      const args = ["-NoProfile", "-NonInteractive", "-Command", psCommand];
      execFile("powershell.exe", args, (error, stdout) => {
        if (error) {
          console.error("Failed to get drives:", error);
          resolve([]);
        } else {
          try {
            const result = JSON.parse(stdout);
            const drives = Array.isArray(result) ? result : [result];
            resolve(drives.map((d) => ({ name: d.Name, freeGB: d.FreeGB })));
          } catch (e) {
            console.error("JSON parse error for drives:", e);
            resolve([]);
          }
        }
      });
    });
  });
}

module.exports = {
  init,
  register,
  getReclaimStatus,
  isReclaimInProgress,
  isInPostReclaimSettleWindow,
};
