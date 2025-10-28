const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Orchestrator API URL
  getOrchestratorApiUrl: () => ipcRenderer.invoke("get-orchestrator-api-url"),

  // DGN Client controls
  startClient: (policy, allowedIds) => {
    console.log(
      `Preload: Sending openfork_client:start IPC message.`
    );
    ipcRenderer.send("openfork_client:start", policy, allowedIds);
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

  // Utility to remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});
