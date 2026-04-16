"use strict";

const path = require("path");
const fs = require("fs");

function getDriveLetterFromPath(targetPath) {
  if (typeof targetPath !== "string") return null;
  const match = targetPath.match(/^([a-zA-Z]):/);
  return match ? match[1].toUpperCase() : null;
}

function getFirstExistingPath(candidates = []) {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function readJsonFileSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.warn(`Failed to read JSON from ${filePath}:`, error.message);
    return null;
  }
}

function collectDockerStorageCandidates(value, keyPath = "", candidates = []) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectDockerStorageCandidates(item, keyPath, candidates);
    }
    return candidates;
  }
  if (!value || typeof value !== "object") return candidates;
  for (const [key, nestedValue] of Object.entries(value)) {
    const nextKeyPath = `${keyPath}.${key}`.toLowerCase();
    if (
      typeof nestedValue === "string" &&
      /^[a-zA-Z]:[\\/]/.test(nestedValue) &&
      /(disk|image|datafolder|storage|vhd)/.test(nextKeyPath)
    ) {
      candidates.push(nestedValue);
      continue;
    }
    if (nestedValue && typeof nestedValue === "object") {
      collectDockerStorageCandidates(nestedValue, nextKeyPath, candidates);
    }
  }
  return candidates;
}

function expandDockerStoragePath(rawPath) {
  if (typeof rawPath !== "string" || !rawPath.trim()) return null;
  const normalizedPath = path.normalize(rawPath.trim());
  const candidates = [normalizedPath];
  if (!normalizedPath.toLowerCase().endsWith(".vhdx")) {
    candidates.push(
      path.join(normalizedPath, "DockerDesktopWSL", "disk", "docker_data.vhdx"),
      path.join(normalizedPath, "DockerDesktopWSL", "main", "ext4.vhdx"),
      path.join(normalizedPath, "DockerDesktopWSL", "ext4.vhdx"),
      path.join(normalizedPath, "disk", "docker_data.vhdx"),
      path.join(normalizedPath, "main", "ext4.vhdx"),
      path.join(normalizedPath, "ext4.vhdx"),
      path.join(normalizedPath, "docker_data.vhdx"),
    );
  }
  return getFirstExistingPath([...new Set(candidates)]);
}

function resolveDockerDesktopStoragePath() {
  if (process.platform !== "win32") return null;
  const appData = process.env.APPDATA || "";
  const localAppData = process.env.LOCALAPPDATA || "";
  const settingsFiles = [
    path.join(appData, "Docker", "settings-store.json"),
    path.join(appData, "Docker", "settings.json"),
    path.join(localAppData, "Docker", "settings-store.json"),
    path.join(localAppData, "Docker", "settings.json"),
  ];

  const rawCandidates = [];
  for (const settingsFile of settingsFiles) {
    if (!fs.existsSync(settingsFile)) continue;
    const settings = readJsonFileSafe(settingsFile);
    if (!settings) continue;
    rawCandidates.push(
      settings.diskImageLocation,
      settings.diskImageDirectory,
      settings.storageLocation,
      settings.dataFolder,
      ...collectDockerStorageCandidates(settings),
    );
  }

  for (const candidate of rawCandidates) {
    const resolvedPath = expandDockerStoragePath(candidate);
    if (resolvedPath) return resolvedPath;
  }

  return getFirstExistingPath([
    path.join(localAppData, "Docker", "wsl", "disk", "docker_data.vhdx"),
    path.join(localAppData, "Docker", "wsl", "main", "ext4.vhdx"),
    path.join(localAppData, "Docker", "DockerDesktopWSL", "disk", "docker_data.vhdx"),
  ]);
}

module.exports = {
  getDriveLetterFromPath,
  getFirstExistingPath,
  readJsonFileSafe,
  collectDockerStorageCandidates,
  expandDockerStoragePath,
  resolveDockerDesktopStoragePath,
};
