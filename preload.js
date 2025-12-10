const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Orchestrator API URL
  getOrchestratorApiUrl: () => ipcRenderer.invoke("get-orchestrator-api-url"),

  // DGN Client controls
  startClient: (service, policy, allowedIds) => {
    console.log(
      `Preload: Sending openfork_client:start IPC message for service: ${service}.`
    );
    ipcRenderer.send("openfork_client:start", service, policy, allowedIds);
  },
  stopClient: () => {
    console.log("Preload: Sending openfork_client:stop IPC message.");
    ipcRenderer.send("openfork_client:stop");
  },

  // DGN Client listeners
  onLog: (callback) =>
    ipcRenderer.on("openfork_client:log", (_event, value) => callback(value)),
  onStatusChange: (callback) =>
    ipcRenderer.on("openfork_client:status", (_event, value) =>
      callback(value)
    ),
  onProgress: (callback) =>
    ipcRenderer.on("openfork_client:progress", (_event, value) =>
      callback(value)
    ),
  onResources: (callback) =>
    ipcRenderer.on("openfork_client:resources", (_event, value) =>
      callback(value)
    ),

  // Cleanup
  listResources: () => ipcRenderer.send("openfork_client:list-resources"),
  cleanup: (removeImages, removeContainers, containerIds, imageIds) =>
    ipcRenderer.send(
      "openfork_client:cleanup",
      removeImages,
      removeContainers,
      containerIds,
      imageIds
    ),

  // Authentication
  loginWithGoogle: () => ipcRenderer.invoke("auth:google-login"),
  logout: () => ipcRenderer.invoke("auth:logout"),
  onSession: (callback) =>
    ipcRenderer.on("auth:session", (_event, value) => callback(value)),
  onAuthCallback: (callback) =>
    ipcRenderer.on("auth:callback", (_event, value) => callback(value)),
  setSessionFromTokens: (accessToken, refreshToken) =>
    ipcRenderer.invoke(
      "auth:set-session-from-tokens",
      accessToken,
      refreshToken
    ),

  // Window controls
  setWindowClosable: (closable) =>
    ipcRenderer.send("window:set-closable", closable),

  // Force refresh handling
  onForceRefresh: (callback) =>
    ipcRenderer.on("auth:force-refresh", () => callback()),

  // Session management
  getSession: () => ipcRenderer.invoke("get-session"),

  // Utility to remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),

  // Search
  searchUsers: (term) => ipcRenderer.invoke("search:users", term),
  searchProjects: (term) => ipcRenderer.invoke("search:projects", term),

  // Config
  fetchConfig: () => ipcRenderer.invoke("fetch:config"),

  // General Search
  searchGeneral: (query) => ipcRenderer.invoke("search:general", query),
});
