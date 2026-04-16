"use strict";

let _store;

function init(store) {
  _store = store;
}

function getAppSettings() {
  const settings = _store.get("appSettings");
  return settings && typeof settings === "object" ? settings : {};
}

function saveAppSettings(partialSettings = {}) {
  const nextSettings = { ...getAppSettings(), ...partialSettings };
  _store.set("appSettings", nextSettings);
  return nextSettings;
}

function normalizeDockerEnginePreference(value) {
  return value === "desktop" || value === "wsl" ? value : "auto";
}

function getDockerEnginePreference() {
  return normalizeDockerEnginePreference(getAppSettings().dockerEnginePreference);
}

module.exports = {
  init,
  getAppSettings,
  saveAppSettings,
  normalizeDockerEnginePreference,
  getDockerEnginePreference,
};
