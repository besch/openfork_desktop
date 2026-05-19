"use strict";

const path = require("path");
const fs = require("fs");

let _store;
let _execFile;
let _resolvedWslDistro = null;

function init({ store, execFile }) {
  _store = store;
  _execFile = execFile;
}

function parseWslDistroList(stdout = "") {
  return stdout
    .replace(/\0/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        !/^windows subsystem for linux has no installed distributions/i.test(
          line,
        ) && !/^use 'wsl\.exe --install'/i.test(line),
    );
}

function listWslDistrosDetailed() {
  return new Promise((resolve) => {
    _execFile(
      "wsl.exe",
      ["--list", "--quiet"],
      { timeout: 5000 },
      (error, stdout, stderr) => {
        const rawOutput = (stdout || "").replace(/\0/g, "");
        const distros = parseWslDistroList(rawOutput);
        if (error) {
          console.warn("Failed to list WSL distros:", error?.message);
          resolve({
            ok: false,
            distros,
            error: error?.message || "Failed to list WSL distros",
            stderr: stderr?.trim() || "",
          });
          return;
        }
        if (!rawOutput.trim()) {
          resolve({
            ok: false,
            distros,
            error: "WSL distro list returned no output.",
            stderr: stderr?.trim() || "",
          });
          return;
        }
        resolve({ ok: true, distros });
      },
    );
  });
}

async function listWslDistros() {
  const result = await listWslDistrosDetailed();
  return result.distros;
}

function choosePreferredWslDistro(distros) {
  const userDistros = distros.filter((name) => !isDockerDesktopDistro(name));
  return (
    userDistros.find((name) => /^openfork$/i.test(name)) ||
    userDistros.find((name) => /^ubuntu$/i.test(name)) ||
    null
  );
}

function isDockerDesktopDistro(name) {
  return /^docker-desktop(?:-data)?$/i.test(String(name || ""));
}

function findOpenForkDistro(distros) {
  return distros.find((name) => /^openfork$/i.test(name)) || null;
}

async function getWslDistroName() {
  if (_resolvedWslDistro) return _resolvedWslDistro;

  const stored = _store.get("wslDistro");
  const listResult = await listWslDistrosDetailed();
  const distros = listResult.distros;
  const openForkDistro = findOpenForkDistro(distros);

  if (stored) {
    if (isDockerDesktopDistro(stored)) {
      console.warn(
        `Stored WSL distro '${stored}' is a Docker Desktop internal distro. Falling back to OpenFork auto-detect.`,
      );
      _store.delete("wslDistro");
    } else if (!listResult.ok) {
      // If WSL itself is temporarily unavailable, keep using the last known
      // distro name. A later command will distinguish "missing" from
      // "temporarily unreachable" without dropping the user into setup.
      console.warn(
        `Could not refresh WSL distro list; keeping stored distro '${stored}'.`,
      );
      _resolvedWslDistro = stored;
      return _resolvedWslDistro;
    } else if (
      openForkDistro &&
      stored.toLowerCase() !== openForkDistro.toLowerCase()
    ) {
      // Older builds could cache Ubuntu/docker-desktop before the dedicated
      // OpenFork engine was installed. Prefer the managed engine once it exists.
      console.warn(
        `Stored WSL distro '${stored}' does not match the installed OpenFork engine. Using '${openForkDistro}'.`,
      );
      _store.set("wslDistro", openForkDistro);
      _resolvedWslDistro = openForkDistro;
      return _resolvedWslDistro;
    } else {
      const stillExists = distros.some(
        (name) => name.toLowerCase() === stored.toLowerCase(),
      );
      if (stillExists) {
        _resolvedWslDistro = stored;
        return _resolvedWslDistro;
      }
      console.warn(
        `Stored WSL distro '${stored}' no longer exists. Falling back to auto-detect.`,
      );
      _store.delete("wslDistro");
    }
  }

  const envDistro = process.env.OPENFORK_WSL_DISTRO;
  if (!listResult.ok && envDistro && !isDockerDesktopDistro(envDistro)) {
    _resolvedWslDistro = envDistro;
    return _resolvedWslDistro;
  }

  const detected = choosePreferredWslDistro(distros);
  if (detected) {
    _resolvedWslDistro = detected;
    console.log(`Auto-detected WSL distro: ${detected}`);
  }
  // Return null without caching so the next call re-detects once a distro is installed.
  return detected;
}

function resetWslDistro() {
  _store.delete("wslDistro");
  _resolvedWslDistro = null;
}

// Clears only the in-memory cache without touching the persisted store value.
// Use this when a cached distro name is found to be missing at runtime — the
// next call will re-detect whatever is available, while the store entry remains
// in case the distro is re-registered later.
function invalidateWslDistroCache() {
  _resolvedWslDistro = null;
}

function setWslDistro(name) {
  _store.set("wslDistro", name);
  _resolvedWslDistro = name;
}

function getWslIpAddress() {
  if (process.platform !== "win32") return Promise.resolve(null);
  return getWslDistroName().then(
    (wslDistro) =>
      new Promise((resolve) => {
        _execFile(
          "wsl.exe",
          ["-d", wslDistro, "--", "hostname", "-I"],
          { timeout: 5000 },
          (error, stdout) => {
            if (error || !stdout) { resolve(null); return; }
            const ips = stdout.trim().split(/\s+/).filter(Boolean);
            resolve(ips[0] || null);
          },
        );
      }),
  );
}

async function getWindowsDockerApiHosts() {
  const hosts = ["127.0.0.1", "localhost"];
  if (process.env.OPENFORK_ALLOW_WSL_DOCKER_IP_FALLBACK === "1") {
    const wslIp = await getWslIpAddress();
    if (wslIp) hosts.push(wslIp);
  }
  return [...new Set(hosts)];
}

function getDistroBasePath(distroName) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") { resolve(null); return; }
    const psCommand = `Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss\\*' | Where-Object DistributionName -eq '${distroName}' | Select-Object -ExpandProperty BasePath`;
    _execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psCommand],
      (error, stdout) => {
        if (error || !stdout) { resolve(null); return; }
        resolve(stdout.trim());
      },
    );
  });
}

async function resolveWslStoragePath(distroName) {
  const basePath = await getDistroBasePath(distroName);
  if (!basePath) return null;
  const normalizedBasePath = path.normalize(basePath);
  const candidate = path.join(normalizedBasePath, "ext4.vhdx");
  return (fs.existsSync(candidate) ? candidate : null) || normalizedBasePath;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function outputContainsDistro(output, distroName) {
  const namePattern = new RegExp(
    `^\\*?\\s*${escapeRegExp(distroName)}(?:\\s|$)`,
    "i",
  );
  return output
    .replace(/\0/g, "")
    .split(/\r?\n/)
    .some((line) => namePattern.test(line.trim()));
}

function checkDistroPresence(distroName) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve({ exists: true });
      return;
    }
    if (!distroName) {
      resolve({ exists: false });
      return;
    }
    const psCommand = "wsl.exe -l -v | Out-String";
    _execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", psCommand],
      { timeout: 10000 },
      (error, stdout, stderr) => {
        const output = `${stdout || ""}\n${stderr || ""}`.replace(/\0/g, "");
        if (error) {
          console.error(
            `WSL check failed: ${error.message}. Output: ${output}`,
          );
          resolve({
            exists: null,
            error: error.message,
            output: output.trim(),
          });
          return;
        }
        if (!output.trim()) {
          resolve({
            exists: null,
            error: "WSL distro list returned no output.",
            output: "",
          });
          return;
        }
        resolve({
          exists: outputContainsDistro(output, distroName),
          output: output.trim(),
        });
      },
    );
  });
}

async function checkDistroExists(distroName) {
  const result = await checkDistroPresence(distroName);
  return result.exists === true;
}

function getWindowsSystemDriveLetter() {
  const match = (process.env.SYSTEMDRIVE || "C:").match(/([a-zA-Z]):?/);
  return match ? match[1].toUpperCase() : "C";
}

module.exports = {
  init,
  listWslDistros,
  listWslDistrosDetailed,
  choosePreferredWslDistro,
  getWslDistroName,
  resetWslDistro,
  invalidateWslDistroCache,
  setWslDistro,
  getWslIpAddress,
  getWindowsDockerApiHosts,
  getDistroBasePath,
  resolveWslStoragePath,
  checkDistroPresence,
  checkDistroExists,
  getWindowsSystemDriveLetter,
};
