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

function listWslDistros() {
  return new Promise((resolve) => {
    _execFile(
      "wsl.exe",
      ["--list", "--quiet"],
      { timeout: 5000 },
      (error, stdout) => {
        if (error || !stdout) {
          console.warn("Failed to list WSL distros:", error?.message);
          resolve([]);
          return;
        }
        const distros = stdout
          .replace(/\0/g, "")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        resolve(distros);
      },
    );
  });
}

function choosePreferredWslDistro(distros) {
  const userDistros = distros.filter(
    (name) => !/^docker-desktop(?:-data)?$/i.test(name),
  );
  const preferred =
    userDistros.find((name) => /^openfork$/i.test(name)) ||
    userDistros.find((name) => /^ubuntu(?:-.+)?$/i.test(name)) ||
    userDistros[0];
  return preferred || "Ubuntu";
}

async function getWslDistroName() {
  if (_resolvedWslDistro) return _resolvedWslDistro;

  const stored = _store.get("wslDistro");
  const distros = await listWslDistros();

  if (stored) {
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

  _resolvedWslDistro = choosePreferredWslDistro(distros);
  if (distros.length > 0) {
    console.log(`Auto-detected WSL distro: ${_resolvedWslDistro}`);
  } else {
    console.warn("No usable WSL distros found, defaulting to Ubuntu");
  }

  return _resolvedWslDistro;
}

function resetWslDistro() {
  _store.delete("wslDistro");
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
  const wslIp = await getWslIpAddress();
  if (wslIp) hosts.push(wslIp);
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

function checkDistroExists(distroName) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") { resolve(true); return; }
    const psCommand = "wsl.exe -l -v | Out-String";
    _execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", psCommand],
      (error, stdout) => {
        const output = (stdout || "").replace(/\0/g, "");
        if (output.includes(distroName)) {
          resolve(true);
        } else {
          if (error) {
            console.error(
              `WSL check failed: ${error.message}. Output: ${output}`,
            );
          }
          resolve(false);
        }
      },
    );
  });
}

function getWindowsSystemDriveLetter() {
  const match = (process.env.SYSTEMDRIVE || "C:").match(/([a-zA-Z]):?/);
  return match ? match[1].toUpperCase() : "C";
}

module.exports = {
  init,
  listWslDistros,
  choosePreferredWslDistro,
  getWslDistroName,
  resetWslDistro,
  setWslDistro,
  getWslIpAddress,
  getWindowsDockerApiHosts,
  getDistroBasePath,
  resolveWslStoragePath,
  checkDistroExists,
  getWindowsSystemDriveLetter,
};
