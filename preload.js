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
  cleanupProcesses: () => {
    console.log("Preload: Sending openfork_client:cleanup IPC message.");
    return ipcRenderer.invoke("openfork_client:cleanup");
  },

  // DGN Client listeners
  onLog: (callback) =>
    ipcRenderer.on("openfork_client:log", (_event, value) => callback(value)),
  onStatusChange: (callback) =>
    ipcRenderer.on("openfork_client:status", (_event, value) =>
      callback(value)
    ),
  onDockerProgress: (callback) =>
    ipcRenderer.on("openfork_client:docker-progress", (_event, value) =>
      callback(value)
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
  
  // Force logout handling (permanent auth failure)
  onForceLogout: (callback) =>
    ipcRenderer.on("auth:force-logout", () => callback()),

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

  // Docker Management
  listDockerImages: () => ipcRenderer.invoke("docker:list-images"),
  listDockerContainers: () => ipcRenderer.invoke("docker:list-containers"),
  removeDockerImage: (imageId) => ipcRenderer.invoke("docker:remove-image", imageId),
  removeAllDockerImages: () => ipcRenderer.invoke("docker:remove-all-images"),
  stopContainer: (containerId) => ipcRenderer.invoke("docker:stop-container", containerId),
  stopAllContainers: () => ipcRenderer.invoke("docker:stop-all-containers"),
  cleanupDocker: () => ipcRenderer.invoke("docker:cleanup-all"),

  // Dependency Detection
  checkDocker: () => ipcRenderer.invoke("deps:check-docker"),
  checkNvidia: () => ipcRenderer.invoke("deps:check-nvidia"),
  openDockerDownload: () => ipcRenderer.invoke("deps:open-docker-download"),
  
  // Auto Updater
  onUpdateAvailable: (callback) => 
    ipcRenderer.on("update:available", (_event, value) => callback(value)),
  onUpdateProgress: (callback) =>
    ipcRenderer.on("update:progress", (_event, value) => callback(value)),
  onUpdateDownloaded: (callback) =>
    ipcRenderer.on("update:downloaded", (_event, value) => callback(value)),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
});

