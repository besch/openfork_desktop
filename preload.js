const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // DGN Client controls
  startClient: () => ipcRenderer.send('dgn-client:start'),
  stopClient: () => ipcRenderer.send('dgn-client:stop'),

  // DGN Client listeners
  onLog: (callback) => ipcRenderer.on('dgn-client:log', (_event, value) => callback(value)),
  onStatusChange: (callback) => ipcRenderer.on('dgn-client:status', (_event, value) => callback(value)),
  
  // Auth
  loginWithGoogle: () => ipcRenderer.invoke('auth:google-login'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  onSession: (callback) => ipcRenderer.on('auth:session', (_event, value) => callback(value)),
  onAuthCallback: (callback) => ipcRenderer.on('auth:callback', (_event, value) => callback(value)),
  updateSessionInMain: (session) => ipcRenderer.send('auth:session-update', session),

  // General
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});
