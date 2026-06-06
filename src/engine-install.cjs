"use strict";

const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
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
const INSTALL_PROGRESS_LOG =
  process.platform === "win32"
    ? path.win32.join(os.tmpdir(), "openfork_install_progress.log")
    : path.join(os.tmpdir(), "openfork_install_progress.log");
const WINDOWS_INSTALL_PATH_RE = /^[A-Za-z]:\\OpenFork\\wsl\\?$/;
const WINDOWS_WSL_FEATURES = [
  "Microsoft-Windows-Subsystem-Linux",
  "VirtualMachinePlatform",
];
const WSL_FEATURE_SETUP_ERROR_RE =
  /(optional component is not enabled|windows subsystem for linux.*not enabled|enable.*windows subsystem for linux|virtual machine platform|0x80370102|wsl.*is not recognized|not recognized as the name)/i;

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
    {
      re: /Checking Windows Subsystem|Checking system/i,
      phase: "Checking system requirements",
      percent: 5,
    },
    {
      re: /Enabling WSL feature|Enabling Virtual Machine/i,
      phase: "Enabling WSL features",
      percent: 10,
    },
    {
      re: /Downloading Ubuntu/i,
      phase: "Downloading Ubuntu (~130MB)",
      percent: 18,
    },
    { re: /Download complete/i, phase: "Download complete", percent: 27 },
    {
      re: /Importing |Installing Ubuntu without launch/i,
      phase: "Installing Ubuntu",
      percent: 28,
    },
    {
      re: /Waiting for WSL to list/i,
      phase: "Registering Ubuntu",
      percent: 40,
    },
    {
      re: /Provisioning default user/i,
      phase: "Configuring Ubuntu user",
      percent: 50,
    },
    { re: /Restarting WSL/i, phase: "Restarting WSL", percent: 55 },
    {
      re: /Enabling Sparse VHD/i,
      phase: "Optimizing disk storage",
      percent: 60,
    },
    {
      re: /Ensuring WSL is running/i,
      phase: "Running setup inside WSL…",
      percent: 63,
    },
    {
      re: /\[OpenFork\].*Installing Docker Engine|\[Linux\].*Installing Docker/i,
      phase: "Installing Docker Engine",
      percent: 70,
    },
    {
      re: /\[OpenFork\].*Installing Docker|\[Linux\].*Downloading.*Docker/i,
      phase: "Downloading Docker packages",
      percent: 72,
    },
    {
      re: /\[OpenFork\].*Docker is already installed|\[Linux\].*Docker Engine installed/i,
      phase: "Docker Engine installed",
      percent: 78,
    },
    {
      re: /\[OpenFork\].*Docker is already|\[Linux\].*Docker is already/i,
      phase: "Docker already present",
      percent: 65,
    },
    {
      re: /\[OpenFork\].*Installing NVIDIA Container Toolkit|\[Linux\].*Installing NVIDIA/i,
      phase: "Installing NVIDIA Container Toolkit",
      percent: 80,
    },
    {
      re: /\[OpenFork\].*Updating package lists|\[Linux\].*Updating package lists/i,
      phase: "Updating packages for NVIDIA toolkit",
      percent: 82,
    },
    {
      re: /\[OpenFork\].*Installing NVIDIA|\[Linux\].*Downloading.*NVIDIA/i,
      phase: "Installing NVIDIA toolkit packages",
      percent: 84,
    },
    {
      re: /\[OpenFork\].*NVIDIA Container Toolkit is already|\[Linux\].*NVIDIA Container Toolkit is already/i,
      phase: "NVIDIA toolkit present",
      percent: 80,
    },
    {
      re: /\[OpenFork\].*Configuring NVIDIA|\[Linux\].*Configuring Docker/i,
      phase: "Configuring Docker TCP",
      percent: 88,
    },
    {
      re: /\[OpenFork\].*Waiting for Docker daemon|\[Linux\].*Waiting for Docker daemon/i,
      phase: "Starting Docker daemon",
      percent: 93,
    },
    {
      re: /\[OpenFork\].*Docker daemon is running|\[Linux\].*Docker daemon is running/i,
      phase: "Docker daemon running",
      percent: 97,
    },
    {
      re: /Setup Complete|OpenFork AI Engine Setup Complete/i,
      phase: "Setup complete!",
      percent: 100,
    },
  ];

  for (const { re, phase, percent } of phases) {
    if (re.test(line)) return { phase, percent };
  }
  return null;
}

// --- ELEVATED POWERSHELL ---

function getDefaultWindowsInstallPath() {
  const systemDrive =
    process.env.SystemDrive || process.env.SYSTEMDRIVE || "C:";
  const normalizedDrive = /^[A-Za-z]:$/.test(systemDrive)
    ? systemDrive
    : "C:";
  return path.win32.join(normalizedDrive, "OpenFork", "wsl");
}

function emitInstallProgress(line, phase = "", percent = 0) {
  const mainWindow = _getMainWindow?.();
  mainWindow?.webContents.send("deps:install-progress", {
    line,
    phase,
    percent,
  });
}

function buildPowerShellFileArgs(scriptPath, args = []) {
  return [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    ...args,
  ];
}

function resolveInstallerResult(error, resolve, label) {
  currentInstallProcess = null;
  if (currentInstallCancelled) {
    currentInstallCancelled = false;
    resolve({ success: false, error: "cancelled" });
  } else if (error) {
    console.error(`${label} failed:`, error.message);
    resolve({ success: false, error: error.message });
  } else {
    resolve({ success: true });
  }
}

function runPowerShell(scriptPath, args = []) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve({ success: false, error: "PowerShell only supported on Windows" });
      return;
    }

    console.log(`Running setup without elevation: ${scriptPath}`);

    const child = execFile(
      "powershell.exe",
      buildPowerShellFileArgs(scriptPath, args),
      (error) => resolveInstallerResult(error, resolve, "Setup"),
    );
    currentInstallProcess = child;
  });
}

function runElevatedPowerShell(scriptPath, args = []) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve({ success: false, error: "Elevation only supported on Windows" });
      return;
    }

    // Combine all arguments into a single list for the inner powershell
    const innerArgs = buildPowerShellFileArgs(scriptPath, args);

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
      (error) => resolveInstallerResult(error, resolve, "Elevated setup"),
    );
    currentInstallProcess = child;
  });
}

function runPowerShellCommand(command, options = {}) {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      { timeout: 15000, ...options },
      (error, stdout, stderr) => {
        resolve({
          success: !error,
          stdout: stdout?.toString?.() || "",
          stderr: stderr?.toString?.() || "",
          error: error?.message || "",
        });
      },
    );
  });
}

async function isCurrentProcessElevated() {
  const command = [
    "$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())",
    "$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
  ].join("; ");
  const result = await runPowerShellCommand(command);
  return result.success && result.stdout.trim().toLowerCase() === "true";
}

async function getWindowsFeatureStates() {
  const featureList = WINDOWS_WSL_FEATURES.map((name) => `'${name}'`).join(", ");
  const command = [
    `$features = @(${featureList})`,
    "$result = @()",
    "foreach ($feature in $features) {",
    "  try {",
    "    $item = Get-WindowsOptionalFeature -Online -FeatureName $feature -ErrorAction Stop",
    "    $result += [pscustomobject]@{ FeatureName = $feature; State = [string]$item.State; Error = $null }",
    "  } catch {",
    "    $result += [pscustomobject]@{ FeatureName = $feature; State = 'Unknown'; Error = $_.Exception.Message }",
    "  }",
    "}",
    "$result | ConvertTo-Json -Compress",
  ].join("; ");
  const result = await runPowerShellCommand(command);
  if (!result.success || !result.stdout.trim()) {
    return WINDOWS_WSL_FEATURES.map((featureName) => ({
      FeatureName: featureName,
      State: "Unknown",
      Error: result.error || result.stderr || "Feature check failed",
    }));
  }

  try {
    const parsed = JSON.parse(result.stdout.trim());
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (error) {
    console.warn("Could not parse Windows feature state:", error.message);
    return WINDOWS_WSL_FEATURES.map((featureName) => ({
      FeatureName: featureName,
      State: "Unknown",
      Error: "Feature check returned invalid JSON",
    }));
  }
}

function testWindowsInstallPathWritable(installPath) {
  const targetPath = installPath || getDefaultWindowsInstallPath();
  try {
    fs.mkdirSync(targetPath, { recursive: true });
    const probePath = path.win32.join(
      targetPath,
      `.openfork-write-test-${process.pid}-${Date.now()}.tmp`,
    );
    fs.writeFileSync(probePath, "", "utf8");
    fs.unlinkSync(probePath);
    return { writable: true, targetPath };
  } catch (error) {
    return {
      writable: false,
      targetPath,
      error: error?.message || "Install path is not writable",
    };
  }
}

function checkWindowsDistroExists(distroName) {
  return new Promise((resolve) => {
    execFile(
      "wsl.exe",
      ["--list", "--quiet"],
      { timeout: 5000 },
      (_error, stdout, stderr) => {
        const output = `${stdout || ""}\n${stderr || ""}`.replace(/\0/g, "");
        const exists = output
          .split(/\r?\n/)
          .map((line) => line.trim())
          .some((line) => line.toLowerCase() === distroName.toLowerCase());
        resolve(exists);
      },
    );
  });
}

function checkWindowsWslAvailable() {
  return new Promise((resolve) => {
    execFile(
      "wsl.exe",
      ["--status"],
      { timeout: 5000 },
      (error, stdout, stderr) => {
        const output = `${stdout || ""}\n${stderr || ""}`.replace(/\0/g, "");
        resolve({
          available: !error,
          needsFeatureSetup: !!error && WSL_FEATURE_SETUP_ERROR_RE.test(output),
          output: output.trim(),
        });
      },
    );
  });
}

async function inspectWindowsInstallPermissions(installPath, distroName) {
  const [isElevated, featureStates, distroExists, wslStatus] =
    await Promise.all([
    isCurrentProcessElevated(),
    getWindowsFeatureStates(),
    checkWindowsDistroExists(distroName),
    checkWindowsWslAvailable(),
  ]);
  const disabledFeatures = featureStates.filter(
    (feature) =>
      feature?.State &&
      feature.State !== "Enabled" &&
      feature.State !== "Unknown",
  );
  const writeCheck = distroExists
    ? { writable: true, targetPath: installPath, skipped: true }
    : testWindowsInstallPathWritable(installPath);
  const reasons = [];

  if (disabledFeatures.length > 0 || wslStatus.needsFeatureSetup) {
    reasons.push(
      disabledFeatures.length > 0
        ? `WSL feature setup (${disabledFeatures
            .map((feature) => feature.FeatureName)
            .join(", ")})`
        : "WSL feature setup",
    );
  }
  if (!writeCheck.writable) {
    reasons.push(`write access to ${writeCheck.targetPath}`);
  }

  return {
    isElevated,
    requiresElevation: !isElevated && reasons.length > 0,
    reasons,
    distroExists,
    featureStates,
    wslStatus,
    writeCheck,
  };
}

function shouldRetryElevated(error) {
  return (
    /(administrator privileges|requires elevation|requested operation requires elevation|access is denied|permission denied|eacces|eperm)/i.test(
      String(error || ""),
    ) || WSL_FEATURE_SETUP_ERROR_RE.test(String(error || ""))
  );
}

// --- INSTALL HANDLER ---

function normalizeWindowsInstallPath(installPath) {
  if (!installPath) return null;
  if (typeof installPath !== "string" || installPath.length > 80) {
    throw new Error("Invalid install path.");
  }
  if (!WINDOWS_INSTALL_PATH_RE.test(installPath)) {
    throw new Error(
      "Install path must be a local drive path like D:\\OpenFork\\wsl.",
    );
  }
  return path.win32.normalize(installPath);
}

async function handleInstallEngine(installPath) {
  console.log(
    `Starting engine installation on path: ${installPath || "default"}`,
  );

  if (process.platform === "darwin") {
    return { success: false, error: "Auto-install not supported on macOS." };
  }

  // electron.cjs lives one directory up from this file (desktop/src/ vs desktop/)
  const desktopDir = path.join(__dirname, "..");
  const scriptPath =
    process.platform === "win32"
      ? _app.isPackaged
        ? path.join(process.resourcesPath, "bin", "setup-wsl.ps1")
        : path.join(desktopDir, "scripts", "setup-wsl.ps1")
      : _app.isPackaged
        ? path.join(process.resourcesPath, "bin", "setup-linux.sh")
        : path.join(desktopDir, "scripts", "setup-linux.sh");

  if (process.platform === "win32") {
    let safeInstallPath = null;
    try {
      safeInstallPath =
        normalizeWindowsInstallPath(installPath) ||
        getDefaultWindowsInstallPath();
    } catch (error) {
      return { success: false, error: error.message };
    }

    console.log(`Using setup script: ${scriptPath}`);
    const distroName = "OpenFork";
    currentInstallActive = true;
    currentInstallPath = safeInstallPath;

    // Clear the progress log before starting
    try {
      fs.writeFileSync(INSTALL_PROGRESS_LOG, "", "utf8");
    } catch (_) {}

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
        const lines = newText
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
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
      "-InstallPath",
      safeInstallPath,
      "-ProgressLog",
      INSTALL_PROGRESS_LOG,
    ];

    let result;
    let progressTail = "";
    try {
      emitInstallProgress(
        "Checking whether Windows needs elevated permissions...",
        "Checking system requirements",
        3,
      );
      const preflight = await inspectWindowsInstallPermissions(
        safeInstallPath,
        distroName,
      );
      if (currentInstallCancelled) {
        currentInstallCancelled = false;
        result = { success: false, error: "cancelled" };
      } else {
        const requiresElevation = preflight.requiresElevation;
        if (requiresElevation) {
          emitInstallProgress(
            `Windows needs elevated permissions for ${preflight.reasons.join(
              " and ",
            )}. Approve the Windows prompt to continue.`,
            "Waiting for Windows permission",
            4,
          );
        } else {
          emitInstallProgress(
            "Windows permissions are already sufficient; continuing without an elevated prompt.",
            "Checking system requirements",
            4,
          );
        }

        result = requiresElevation
          ? await runElevatedPowerShell(scriptPath, setupArgs)
          : await runPowerShell(scriptPath, setupArgs);

        if (
          !requiresElevation &&
          !result.success &&
          result.error !== "cancelled" &&
          shouldRetryElevated(result.error)
        ) {
          emitInstallProgress(
            "Windows denied part of setup. Retrying once with elevated permissions...",
            "Waiting for Windows permission",
            4,
          );
          try {
            fs.writeFileSync(INSTALL_PROGRESS_LOG, "", "utf8");
            lastReadPos = 0;
          } catch (_) {}
          result = await runElevatedPowerShell(scriptPath, setupArgs);
        }
      }
    } finally {
      if (result && !result.success && result.error !== "cancelled") {
        progressTail = readInstallProgressTail();
      }
      currentInstallActive = false;
      currentInstallPath = null;
      currentInstallDistro = null;
      clearInterval(watchInterval);
      if (!result || result.success || result.error === "cancelled") {
        try {
          fs.unlinkSync(INSTALL_PROGRESS_LOG);
        } catch (_) {}
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
    // Linux pkexec handler with progress streaming
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
        console.error(
          "Failed to copy setup script to temp location:",
          copyErr.message,
        );
        resolve({ success: false, error: copyErr.message });
        return;
      }

      const mainWindow = _getMainWindow();
      let lastPhase = "";
      let lastPercent = 0;

      // Use stdbuf to force line buffering so progress is streamed in real-time
      const child = execFile(
        "pkexec",
        ["stdbuf", "-oL", "bash", tmpScript, username],
        (error) => {
          try {
            fs.unlinkSync(tmpScript);
          } catch (_) {}
          if (error) {
            console.error("Installation process error:", error.message);
            resolve({ success: false, error: error.message });
          } else {
            // Send completion event
            mainWindow?.webContents.send("deps:install-progress", {
              line: "Setup Complete!",
              phase: "Setup complete!",
              percent: 100,
            });
            console.log("Installation process completed successfully.");
            resolve({ success: true });
          }
        },
      );

      // Capture stdout and stderr for progress reporting
      child.stdout?.on("data", (data) => {
        const lines = data
          .toString()
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
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
      });

      child.stderr?.on("data", (data) => {
        const lines = data
          .toString()
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
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
      });
    });
  }
}

function handleCancelInstall() {
  if (!currentInstallProcess) {
    if (currentInstallActive) {
      currentInstallCancelled = true;
    }
    return { success: true };
  }
  currentInstallCancelled = true;
  const pid = currentInstallProcess.pid;
  // Kill the outer powershell process
  currentInstallProcess.kill();
  // Also try to kill the full process tree (includes elevated child)
  try {
    execFile("taskkill.exe", ["/F", "/T", "/PID", String(pid)], () => {});
  } catch (_) {}
  // Attempt to unregister the partially installed distro
  const distroToClean = currentInstallDistro || "OpenFork";
  try {
    execFile(
      "wsl.exe",
      ["--unregister", distroToClean],
      { timeout: 15000 },
      () => {},
    );
  } catch (_) {}
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
  normalizeWindowsInstallPath,
};
