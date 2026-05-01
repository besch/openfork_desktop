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
  startClient: (service, routingConfig) => {
    console.log(
      `Preload: Sending openfork_client:start IPC message for service: ${service}.`
    );
    ipcRenderer.send("openfork_client:start", service, routingConfig);
  },
  updateProviderConfig: (providerId, routingConfig) => {
    return ipcRenderer.invoke("provider:update-config", providerId, routingConfig);
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
  onProviderId: (callback) => createListener("openfork_client:provider-id", callback),
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
   purgeOpenForkData: () => ipcRenderer.invoke("docker:clean-openfork"),
   getDiskSpace: () => ipcRenderer.invoke("docker:get-disk-space"),
   onImageEvicted: (callback) => createListener("openfork_client:image-evicted", callback),

  // Docker Monitoring
  startDockerMonitoring: () => ipcRenderer.send("docker:start-monitoring"),
  stopDockerMonitoring: () => ipcRenderer.send("docker:stop-monitoring"),
  onDockerContainersUpdate: (callback) => createListener("docker:containers-update", callback),
  onDockerImagesUpdate: (callback) => createListener("docker:images-update", callback),

  // Dependency Detection
  checkDocker: () => ipcRenderer.invoke("deps:check-docker"),
  checkNvidia: () => ipcRenderer.invoke("deps:check-nvidia"),
  openDockerDownload: () => ipcRenderer.invoke("deps:open-docker-download"),
  installEngine: (installPath) => ipcRenderer.invoke("deps:install-engine", installPath),
  onInstallProgress: (callback) => createListener("deps:install-progress", callback),
  cancelInstall: () => ipcRenderer.invoke("deps:cancel-install"),
  resetWslDistro: () => ipcRenderer.invoke("deps:reset-wsl-distro"),
  fixLinuxDockerPermissions: () => ipcRenderer.invoke("deps:fix-linux-docker-permissions"),
  onWslDistroMissing: (callback) => createListener("docker:wsl-distro-missing", callback),
  onEngineSwitch: (callback) => createListener("docker:engine-switched", callback),
  onWslRecoveryStatus: (callback) =>
    createListener("docker:wsl-recovery-status", callback),

  // Disk Management
  relocateStorage: (newDrivePath) => ipcRenderer.invoke("docker:relocate-storage", newDrivePath),
  reclaimDiskSpace: () => ipcRenderer.invoke("docker:reclaim-space"),
  getAvailableDrives: () => ipcRenderer.invoke("get-available-drives"),
  // Fired after image deletion in WSL Docker mode to prompt the user to compact the VHDX
  onCompactionSuggested: (callback) => createVoidListener("docker:compaction-suggested", callback),

  // Auto-compact (Windows): listens for IMAGE_EVICTED events from Python and
  // schedules VHDX compaction in idle windows once cumulative freed bytes
  // cross the configured threshold.
  getAutoCompactStatus: () => ipcRenderer.invoke("auto-compact:get-status"),
  setAutoCompactEnabled: (enabled) =>
    ipcRenderer.invoke("auto-compact:set-enabled", enabled),
  setAutoCompactThresholdGB: (gb) =>
    ipcRenderer.invoke("auto-compact:set-threshold-gb", gb),
  notifyManualCompactCompleted: () =>
    ipcRenderer.send("auto-compact:notify-manual-compact"),
  onAutoCompactStatus: (callback) =>
    createListener("auto-compact:status", callback),
  
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

  // Monetize / Stripe
  openStripeOnboard: () => ipcRenderer.invoke("monetize:open-stripe-onboard"),
  openStripeDashboard: () => ipcRenderer.invoke("monetize:open-stripe-dashboard"),
  startMonetizeCleanup: () => ipcRenderer.send("monetize:start-cleanup"),
  stopMonetizeCleanup: () => ipcRenderer.send("monetize:stop-cleanup"),
  setMonetizeIdleTimeout: (minutes) => ipcRenderer.invoke("monetize:set-idle-timeout", minutes),
  getMonetizeConfig: () => ipcRenderer.invoke("monetize:get-config"),
  onMonetizeCleanupEvent: (callback) => createListener("monetize:cleanup-event", callback),

  // Provider custom pricing
  getProviderRate: () => ipcRenderer.invoke("monetize:get-provider-rate"),
  setProviderRate: (rate) => ipcRenderer.invoke("monetize:set-provider-rate", rate),
  
  // External Links
  openExternal: (url) => ipcRenderer.send("open-external", url),
});

