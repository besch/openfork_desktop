const { contextBridge, ipcRenderer } = require("electron");

// Helper to create listener with cleanup function
const createListener = (channel, callback) => {
  const handler = (_event, value) => callback(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

// Helper for listeners without value
const createVoidListener = (channel, callback) => {
  const handler = () => callback();
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

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
  cancelDownload: (serviceType) => {
    console.log(`Preload: Sending docker:cancel-download IPC message for ${serviceType}.`);
    ipcRenderer.send("docker:cancel-download", serviceType);
  },
  cleanupProcesses: () => {
    console.log("Preload: Sending openfork_client:cleanup IPC message.");
    return ipcRenderer.invoke("openfork_client:cleanup");
  },

  // DGN Client listeners - now return cleanup functions
  onLog: (callback) => createListener("openfork_client:log", callback),
  onStatusChange: (callback) => createListener("openfork_client:status", callback),
  onDockerProgress: (callback) => createListener("openfork_client:docker-progress", callback),
  onJobStatus: (callback) => createListener("openfork_client:job-status", callback),
  onDiskSpaceError: (callback) => createListener("openfork_client:disk-space-error", callback),

  // Authentication
  loginWithGoogle: () => ipcRenderer.invoke("auth:google-login"),
  logout: () => ipcRenderer.invoke("auth:logout"),
  onSession: (callback) => createListener("auth:session", callback),
  onAuthCallback: (callback) => createListener("auth:callback", callback),
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
  onForceRefresh: (callback) => createVoidListener("auth:force-refresh", callback),
  
  // Force logout handling (permanent auth failure)
  onForceLogout: (callback) => createVoidListener("auth:force-logout", callback),

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
  getDiskSpace: () => ipcRenderer.invoke("docker:get-disk-space"),

  // Docker Monitoring
  startDockerMonitoring: () => ipcRenderer.send("docker:start-monitoring"),
  stopDockerMonitoring: () => ipcRenderer.send("docker:stop-monitoring"),
  onDockerContainersUpdate: (callback) => createListener("docker:containers-update", callback),
  onDockerImagesUpdate: (callback) => createListener("docker:images-update", callback),

  // Dependency Detection
  checkDocker: () => ipcRenderer.invoke("deps:check-docker"),
  checkNvidia: () => ipcRenderer.invoke("deps:check-nvidia"),
  openDockerDownload: () => ipcRenderer.invoke("deps:open-docker-download"),
  
  // Auto Updater - now return cleanup functions
  onUpdateAvailable: (callback) => createListener("update:available", callback),
  onUpdateProgress: (callback) => createListener("update:progress", callback),
  onUpdateDownloaded: (callback) => createListener("update:downloaded", callback),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),

  // Settings persistence
  loadSettings: () => ipcRenderer.invoke("load-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),

  // Schedule Management
  getScheduleConfig: () => ipcRenderer.invoke("schedule:get-config"),
  setScheduleConfig: (config) => ipcRenderer.invoke("schedule:set-config", config),
  getScheduleStatus: () => ipcRenderer.invoke("schedule:get-status"),
  getSchedulePresets: () => ipcRenderer.invoke("schedule:get-presets"),
  getSystemIdleTime: () => ipcRenderer.invoke("schedule:get-idle-time"),
  onScheduleStatus: (callback) => createListener("schedule:status", callback),
  
  // Versions and Environment
  getProcessInfo: () => ipcRenderer.invoke("get-process-info"),
});

