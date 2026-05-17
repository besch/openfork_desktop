"use strict";

const { execFile } = require("child_process");
const path = require("path");

const COMPACT_WSL_TIMEOUT_MS = 90 * 60 * 1000;

function getPowerShellDiagnosticLines(output = "") {
  return String(output || "")
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

function buildCompactionFailureMessage(
  error,
  stdout = "",
  stderr = "",
  fallback = "Compaction failed.",
) {
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

  if (prioritized.length > 0) return prioritized[prioritized.length - 1];
  if (stderrLines.length > 0) return stderrLines[stderrLines.length - 1];
  if (stdoutLines.length > 0) return stdoutLines[stdoutLines.length - 1];
  return error?.message || fallback;
}

function getCompactWslScriptPath(app) {
  return app?.isPackaged
    ? path.join(process.resourcesPath, "scripts", "compact-wsl.ps1")
    : path.join(__dirname, "..", "scripts", "compact-wsl.ps1");
}

function runCompactWslScript({
  app,
  wslDistro,
  timeoutMs = COMPACT_WSL_TIMEOUT_MS,
  onProcess,
  onPid,
} = {}) {
  if (!wslDistro) {
    return Promise.reject(new Error("WSL distro not found."));
  }

  const scriptPath = getCompactWslScriptPath(app);

  return new Promise((resolve, reject) => {
    const child = execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        "-DistroName",
        wslDistro,
      ],
      {
        windowsHide: true,
        timeout: timeoutMs,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              buildCompactionFailureMessage(
                error,
                stdout,
                stderr,
                "compact-wsl.ps1 failed",
              ),
            ),
          );
          return;
        }
        resolve();
      },
    );

    if (typeof onProcess === "function") onProcess(child);
    if (typeof onPid === "function") onPid(child.pid || null);
  });
}

async function recoverWslDockerAfterCompaction({
  dockerEngine,
  dockerMonitor,
  wslDistro,
  restartOnAnyNotRunning = false,
  waitTimeoutMs,
  onBeforeRestart,
  onPhase,
  logPrefix = "Compaction",
} = {}) {
  if (process.platform !== "win32" || !wslDistro || !dockerEngine) {
    return { attempted: false, success: false };
  }

  dockerMonitor?.resetDockerRoutingCache?.();

  try {
    let dockerStatus = await dockerEngine.resolveDockerStatus({
      allowNativeStart: false,
      wslHostTimeoutMs: 10000,
    });

    if (dockerStatus?.running) {
      return { attempted: true, success: true, status: dockerStatus };
    }

    const shouldRestart =
      restartOnAnyNotRunning ||
      dockerStatus?.error === "WSL_VHDX_LOCKED" ||
      dockerStatus?.error === "DOCKER_API_UNREACHABLE";

    if (shouldRestart) {
      if (typeof onBeforeRestart === "function") onBeforeRestart(dockerStatus);
      dockerStatus = await dockerEngine.restartWslDockerEngine({
        wslDistro,
        ...(Number.isFinite(waitTimeoutMs) ? { waitTimeoutMs } : {}),
        onPhase,
      });
      if (dockerStatus?.running) {
        return { attempted: true, success: true, status: dockerStatus };
      }
    }

    console.warn(
      `${logPrefix} finished, but WSL Docker is not ready yet (${
        dockerStatus?.error || "unknown"
      }). It may recover on the next monitor poll.`,
    );
    return { attempted: true, success: false, status: dockerStatus };
  } catch (error) {
    console.warn(
      `${logPrefix} finished, but post-compaction WSL recovery did not complete:`,
      error?.message || error,
    );
    return { attempted: true, success: false, error };
  } finally {
    dockerMonitor?.resetDockerRoutingCache?.();
  }
}

module.exports = {
  COMPACT_WSL_TIMEOUT_MS,
  buildCompactionFailureMessage,
  getCompactWslScriptPath,
  getPowerShellDiagnosticLines,
  recoverWslDockerAfterCompaction,
  runCompactWslScript,
};
