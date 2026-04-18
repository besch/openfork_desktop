"use strict";

const { exec, execFile, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

let _app;
let _getMainWindow;
let _setWslDistro;

function init({ app, getMainWindow, setWslDistro }) {
  _app = app;
  _getMainWindow = getMainWindow;
  _setWslDistro = setWslDistro;
}

// --- INSTALL STATE ---

let currentInstallProcess = null;
let currentInstallCancelled = false;
let currentInstallDistro = null;
let currentInstallActive = false;
let currentInstallPath = null;
const INSTALL_PROGRESS_LOG = "C:\\Windows\\Temp\\openfork_install_progress.log";

function readInstallProgressTail(maxLines = 80) {
  try {
    const content = fs.readFileSync(INSTALL_PROGRESS_LOG, "utf8");
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-maxLines)
      .join("\n");
  } catch (_) {
    return "";
  }
}

// --- PHASE PARSING ---

// Phase mapping: parse a log line and return { phase, percent } if it matches a known step
function parseInstallPhase(line) {
  // Dynamic download progress: "Downloading Ubuntu rootfs... 45% (58.6 MB / 130.2 MB)"
  const dlMatch = line.match(/Downloading Ubuntu rootfs\.\.\. (\d+)%/);
  if (dlMatch) {
    const dlPct = parseInt(dlMatch[1], 10);
    // Map 0-100% download into the 18-27% range
    const percent = 18 + Math.floor((dlPct / 100) * 9);
    return { phase: "Downloading Ubuntu (~130MB)", percent };
  }

  const phases = [
    { re: /Checking Windows Subsystem|Checking system/i, phase: "Checking system requirements", percent: 5 },
    { re: /Enabling WSL feature|Enabling Virtual Machine/i, phase: "Enabling WSL features", percent: 10 },
    { re: /Downloading Ubuntu/i, phase: "Downloading Ubuntu (~130MB)", percent: 18 },
    { re: /Download complete/i, phase: "Download complete", percent: 27 },
    { re: /Importing |Installing Ubuntu without launch/i, phase: "Installing Ubuntu", percent: 28 },
    { re: /Waiting for WSL to list/i, phase: "Registering Ubuntu", percent: 40 },
    { re: /Provisioning default user/i, phase: "Configuring Ubuntu user", percent: 50 },
    { re: /Restarting WSL/i, phase: "Restarting WSL", percent: 55 },
    { re: /Enabling Sparse VHD/i, phase: "Optimizing disk storage", percent: 60 },
    { re: /Ensuring WSL is running/i, phase: "Running setup inside WSL…", percent: 63 },
    { re: /\[Linux\].*Installing Docker/i, phase: "Installing Docker Engine", percent: 70 },
    { re: /\[Linux\].*Downloading and installing Docker/i, phase: "Downloading Docker packages", percent: 72 },
    { re: /\[Linux\].*Docker Engine installed/i, phase: "Docker Engine installed", percent: 78 },
    { re: /\[Linux\].*Docker is already/i, phase: "Docker already present", percent: 65 },
    { re: /\[Linux\].*Installing NVIDIA/i, phase: "Installing NVIDIA Container Toolkit", percent: 80 },
    { re: /\[Linux\].*Updating package lists/i, phase: "Updating packages for NVIDIA toolkit", percent: 82 },
    { re: /\[Linux\].*Downloading and installing NVIDIA/i, phase: "Installing NVIDIA toolkit packages", percent: 84 },
    { re: /\[Linux\].*NVIDIA Container Toolkit is already/i, phase: "NVIDIA toolkit present", percent: 80 },
    { re: /\[Linux\].*Configuring Docker/i, phase: "Configuring Docker TCP", percent: 88 },
    { re: /\[Linux\].*Waiting for Docker daemon/i, phase: "Starting Docker daemon", percent: 93 },
    { re: /\[Linux\].*Docker daemon is running/i, phase: "Docker daemon running", percent: 97 },
    { re: /Setup Complete|OpenFork AI Engine Setup Complete/i, phase: "Setup complete!", percent: 100 },
  ];

  for (const { re, phase, percent } of phases) {
    if (re.test(line)) return { phase, percent };
  }
  return null;
}

// --- ELEVATED POWERSHELL ---

function runElevatedPowerShell(scriptPath, args = []) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve({ success: false, error: "Elevation only supported on Windows" });
      return;
    }

    // Combine all arguments into a single list for the inner powershell
    const innerArgs = [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      ...args,
    ];

    // Use PowerShell array literal syntax @('arg1', 'arg2') for -ArgumentList.
    // IMPORTANT: Start-Process -ArgumentList joins array elements with spaces when
    // constructing the child process command line. Any argument that contains spaces
    // (e.g. the script path under "C:\...\Openfork Client\resources\...") must be
    // wrapped in embedded double-quotes so the child powershell.exe sees it as one token.
    const argumentArray = innerArgs
      .map((arg) => {
        const s = arg.toString().replace(/'/g, "''");
        return s.includes(" ") ? `'"${s}"'` : `'${s}'`;
      })
      .join(", ");

    // Use -PassThru to capture the process object and check ExitCode after -Wait.
    const command = `$p = Start-Process powershell -ArgumentList @(${argumentArray}) -Verb RunAs -Wait -PassThru -WindowStyle Hidden; if ($p.ExitCode -ne 0) { exit $p.ExitCode }`;

    console.log(`Requesting elevation for: ${scriptPath}`);

    const child = execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      (error) => {
        currentInstallProcess = null;
        if (currentInstallCancelled) {
          currentInstallCancelled = false;
          resolve({ success: false, error: "cancelled" });
        } else if (error) {
          console.error("Elevated setup failed:", error.message);
          resolve({ success: false, error: error.message });
        } else {
          resolve({ success: true });
        }
      },
    );
    currentInstallProcess = child;
  });
}

// --- INSTALL HANDLER ---

async function handleInstallEngine(installPath) {
  console.log(`Starting engine installation on path: ${installPath || "default"}`);

  if (process.platform === "darwin") {
    return { success: false, error: "Auto-install not supported on macOS." };
  }

  // electron.cjs lives one directory up from this file (desktop/src/ vs desktop/)
  const desktopDir = path.join(__dirname, "..");
  const scriptPath =
    process.platform === "win32"
      ? _app.isPackaged
        ? path.join(process.resourcesPath, "bin", "setup-wsl.ps1")
        : path.join(desktopDir, "..", "client", "setup-wsl.ps1")
      : _app.isPackaged
        ? path.join(process.resourcesPath, "bin", "setup-linux.sh")
        : path.join(desktopDir, "..", "client", "setup-linux.sh");

  if (process.platform === "win32") {
    console.log(`Using setup script: ${scriptPath}`);
    const distroName = "OpenFork";
    currentInstallActive = true;
    currentInstallPath = installPath || null;

    // Clear the progress log before starting
    try { fs.writeFileSync(INSTALL_PROGRESS_LOG, "", "utf8"); } catch (_) {}

    let lastReadPos = 0;
    let lastPhase = "";
    let lastPercent = 0;

    // Poll the log file every 500ms and forward new lines to the renderer
    const watchInterval = setInterval(() => {
      try {
        const stat = fs.statSync(INSTALL_PROGRESS_LOG);
        if (stat.size <= lastReadPos) return;
        const buf = Buffer.alloc(stat.size - lastReadPos);
        const fd = fs.openSync(INSTALL_PROGRESS_LOG, "r");
        fs.readSync(fd, buf, 0, buf.length, lastReadPos);
        fs.closeSync(fd);
        lastReadPos = stat.size;
        const newText = buf.toString("utf8");
        const lines = newText.split("\n").map((l) => l.trim()).filter(Boolean);
        const mainWindow = _getMainWindow();
        for (const line of lines) {
          const phaseInfo = parseInstallPhase(line);
          if (phaseInfo) {
            lastPhase = phaseInfo.phase;
            lastPercent = phaseInfo.percent;
          }
          mainWindow?.webContents.send("deps:install-progress", {
            line,
            phase: lastPhase,
            percent: lastPercent,
          });
        }
      } catch (_) {
        /* log not yet created or read error — ignore */
      }
    }, 500);

    currentInstallDistro = distroName;
    const setupArgs = [
      "-DistroName",
      distroName,
      ...(installPath ? ["-InstallPath", installPath] : []),
    ];

    let result;
    let progressTail = "";
    try {
      result = await runElevatedPowerShell(scriptPath, setupArgs);
    } finally {
      if (result && !result.success && result.error !== "cancelled") {
        progressTail = readInstallProgressTail();
      }
      currentInstallActive = false;
      currentInstallPath = null;
      currentInstallDistro = null;
      clearInterval(watchInterval);
      if (!result || result.success || result.error === "cancelled") {
        try { fs.unlinkSync(INSTALL_PROGRESS_LOG); } catch (_) {}
      }
    }

    if (!result.success) {
      const detailedError = progressTail
        ? `${result.error}\n${progressTail}`
        : result.error;
      console.error("Installation process error:", detailedError);
      return { success: false, error: detailedError };
    }

    // Persist the distro name so all subsequent checks (Docker, monitoring) use it
    _setWslDistro(distroName);
    console.log("Installation process completed successfully.");
    return { success: true };
  } else {
    // Linux pkexec handler (no progress streaming on Linux)
    const os = require("os");
    const username = os.userInfo().username;
    return new Promise((resolve) => {
      console.log(`Using setup script: ${scriptPath}`);
      // AppImage mounts under /tmp/.mount_* which is read-only; pkexec bash
      // cannot read the script from there. Copy it to a writable temp path first.
      const tmpScript = path.join(os.tmpdir(), "openfork-setup-linux.sh");
      try {
        fs.copyFileSync(scriptPath, tmpScript);
        fs.chmodSync(tmpScript, 0o755);
      } catch (copyErr) {
        console.error("Failed to copy setup script to temp location:", copyErr.message);
        resolve({ success: false, error: copyErr.message });
        return;
      }
      execFile("pkexec", ["bash", tmpScript, username], (error) => {
        try { fs.unlinkSync(tmpScript); } catch (_) {}
        if (error) {
          console.error("Installation process error:", error.message);
          resolve({ success: false, error: error.message });
        } else {
          console.log("Installation process completed successfully.");
          resolve({ success: true });
        }
      });
    });
  }
}

function handleCancelInstall() {
  if (!currentInstallProcess) return { success: true };
  currentInstallCancelled = true;
  const pid = currentInstallProcess.pid;
  // Kill the outer powershell process
  currentInstallProcess.kill();
  // Also try to kill the full process tree (includes elevated child)
  try { execSync(`taskkill /F /T /PID ${pid}`); } catch (_) {}
  // Attempt to unregister the partially installed distro
  const distroToClean = currentInstallDistro || "OpenFork";
  try { execSync(`wsl --unregister ${distroToClean}`, { timeout: 15000 }); } catch (_) {}
  return { success: true };
}

function getCurrentInstallState() {
  return {
    active: currentInstallActive,
    distro: currentInstallDistro,
    installPath: currentInstallPath,
  };
}

module.exports = {
  init,
  parseInstallPhase,
  runElevatedPowerShell,
  handleInstallEngine,
  handleCancelInstall,
  getCurrentInstallState,
};
