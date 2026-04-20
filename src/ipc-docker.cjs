"use strict";

const fs = require("fs");
const path = require("path");
const { exec, execFile } = require("child_process");

const dockerEngine = require("./docker-engine.cjs");
const dockerMonitor = require("./docker-monitor.cjs");
const dockerStorage = require("./docker-storage.cjs");
const wslUtils = require("./wsl-utils.cjs");
const settings = require("./settings.cjs");
const engineInstall = require("./engine-install.cjs");

let _app;
let _getPythonManager;

function init({ app, getPythonManager }) {
  _app = app;
  _getPythonManager = getPythonManager;
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

function register(ipcMain) {
  // --- MONITORING ---

  ipcMain.on("docker:start-monitoring", dockerMonitor.startDockerMonitoring);
  ipcMain.on("docker:stop-monitoring", dockerMonitor.stopDockerMonitoring);

  // --- LIST ---

  ipcMain.handle("docker:list-images", async () => {
    try {
      await dockerMonitor.ensureDockerRouting();
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
      await dockerMonitor.ensureDockerRouting();
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
      const isAllowed = lines.some((line) => {
        const [id, fullName] = line.split("|");
        return (
          (id === imageId || id.startsWith(imageId)) &&
          fullName.toLowerCase().includes("openfork")
        );
      });

      if (!isAllowed) {
        console.warn(`Image ${imageId} validation failed, skipping removal`);
        return { success: false, error: "Only OpenFork images can be removed" };
      }

      // WSL2 ROBUSTNESS: Find and remove ANY containers using this image (running or stopped)
      try {
        const containerIds = await dockerEngine.execDockerCommand(
          `docker ps -a -q --filter ancestor=${imageId}`,
        );
        if (containerIds) {
          const ids = containerIds.split("\n").filter(Boolean);
          for (const id of ids) {
            console.log(`Force removing dependent container ${id} for image ${imageId}`);
            await dockerEngine.execDockerCommand(`docker rm -f ${id}`);
          }
        }
      } catch (e) {
        console.warn(
          `Non-critical error cleaning up containers for image ${imageId}:`,
          e.message,
        );
      }

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
      dockerEngine.emitCompactionSuggested();
      return { success: true };
    } catch (error) {
      console.error(`Failed to remove Docker image ${imageId}:`, error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("docker:remove-all-images", async () => {
    try {
      const listOutput = await dockerEngine.execDockerCommand(
        'docker images --format "{{.ID}}|{{.Repository}}:{{.Tag}}"',
      );
      if (!listOutput) return { success: true, removedCount: 0 };

      const lines = listOutput.split("\n").filter(Boolean);
      let removedCount = 0;
      for (const line of lines) {
        const [id, fullName] = line.split("|");
        if (
          fullName &&
          fullName.toLowerCase().includes("openfork") &&
          dockerEngine.isValidDockerId(id)
        ) {
          try {
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

      if (removedCount > 0) dockerEngine.emitCompactionSuggested();
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
      console.log("Starting targeted OpenFork cleanup...");
      let stoppedCount = 0;
      let removedCount = 0;

      // 1. Force remove all dgn-client containers (by name)
      try {
        const containerOutput = await dockerEngine.execDockerCommand(
          'docker ps -a -q --filter "name=dgn-client"',
        );
        if (containerOutput) {
          const ids = containerOutput.split("\n").filter(Boolean);
          for (const id of ids) {
            await dockerEngine.execDockerCommand(`docker rm -f ${id}`);
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
            if (repo.toLowerCase().includes("openfork")) {
              // Find any remaining containers using this image
              try {
                const deps = await dockerEngine.execDockerCommand(
                  `docker ps -a -q --filter ancestor=${id}`,
                );
                if (deps) {
                  const depIds = deps.split("\n").filter(Boolean);
                  for (const depId of depIds) {
                    await dockerEngine.execDockerCommand(`docker rm -f ${depId}`);
                    stoppedCount++;
                  }
                }
              } catch (e) {}
              try {
                await dockerEngine.execDockerCommand(`docker rmi -f ${id}`);
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

      // 3. Remove all associated volumes
      try {
        await dockerEngine.execDockerCommand("docker volume prune -f");
      } catch (e) {}

      // 4. Aggressive prune to reclaim WSL2 space
      try {
        await dockerEngine.execDockerCommand("docker image prune -af");
        await dockerEngine.execDockerCommand("docker container prune -f");
      } catch (e) {}

      await tryTrimWslFilesystem();

      if (removedCount > 0) dockerEngine.emitCompactionSuggested();
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
                console.error("PowerShell disk space check error:", error.message);
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
          } catch (statError) {
            console.warn(
              `Failed to stat WSL disk file '${storagePath}':`,
              statError.message,
            );
          }
        }
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
              if (error) { reject(error); return; }
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
        },
      };
    }
  });

  // --- DISK MANAGEMENT ---

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

    // Refuse to compact while the DGN client is running
    if (_getPythonManager()?.isRunning()) {
      return {
        success: false,
        error: "CLIENT_RUNNING",
        message: "Stop the DGN engine before compacting disk space.",
      };
    }

    try {
      const scriptPath = _app.isPackaged
        ? path.join(process.resourcesPath, "scripts", "compact-wsl.ps1")
        : path.join(__dirname, "..", "scripts", "compact-wsl.ps1");

      const wslDistro = await wslUtils.getWslDistroName();
      return new Promise((resolve) => {
        const args = [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          scriptPath,
          "-DistroName",
          wslDistro,
        ];
        execFile("powershell.exe", args, (error) => {
          if (error) {
            console.error("Compaction failed:", error);
            resolve({ success: false, error: error.message });
          } else {
            resolve({ success: true });
          }
        });
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("docker:relocate-storage", async (event, newDrivePath) => {
    try {
      const relocateScriptPath = _app.isPackaged
        ? path.join(process.resourcesPath, "scripts", "relocate-wsl.ps1")
        : path.join(__dirname, "..", "scripts", "relocate-wsl.ps1");

      const setupScriptPath = _app.isPackaged
        ? path.join(process.resourcesPath, "bin", "setup-wsl.ps1")
        : path.join(__dirname, "..", "..", "client", "setup-wsl.ps1");

      console.log(`Cleaning up old distribution before relocation to: ${newDrivePath}`);
      const relocateArgs = [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        relocateScriptPath,
        "-DistroName",
        await wslUtils.getWslDistroName(),
        "-NewLocation",
        newDrivePath,
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
      const setupArgs = newDrivePath ? ["-InstallPath", newDrivePath] : [];
      const result = await engineInstall.runElevatedPowerShell(setupScriptPath, setupArgs);

      if (!result.success) {
        console.error("Relocation install failed:", result.error);
        return { success: false, error: `Installation failed: ${result.error}` };
      }

      settings.saveAppSettings({ wslStoragePath: newDrivePath });
      console.log(`Engine reinstalled successfully at ${newDrivePath}.`);
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

module.exports = { init, register };
