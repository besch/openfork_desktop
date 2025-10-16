const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getOrchestratorApiUrl: () => ipcRenderer.invoke('get-orchestrator-api-url'),
  // DGN Client controls
  startClient: (service) => {
    console.log(`Preload: Sending dgn-client:start IPC message for service: ${service}.`);
    ipcRenderer.send('dgn-client:start', service);
  },
  stopClient: () => {
    console.log('Preload: Sending dgn-client:stop IPC message.');
    ipcRenderer.send('dgn-client:stop');
  },

  // DGN Client listeners
  onLog: (callback) => ipcRenderer.on('dgn-client:log', (_event, value) => callback(value)),
  onStatusChange: (callback) => ipcRenderer.on('dgn-client:status', (_event, value) => callback(value)),
  
  // Auth
  loginWithGoogle: () => ipcRenderer.invoke('auth:google-login'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  onSession: (callback) => ipcRenderer.on('auth:session', (_event, value) => callback(value)),
  onAuthCallback: (callback) => ipcRenderer.on('auth:callback', (_event, value) => callback(value)),
  setSessionFromTokens: (accessToken, refreshToken) => ipcRenderer.invoke('auth:set-session-from-tokens', accessToken, refreshToken),

  setWindowClosable: (closable) => ipcRenderer.send('window:set-closable', closable),

  // General
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});
