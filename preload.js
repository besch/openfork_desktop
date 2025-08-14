const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startClient: () => ipcRenderer.send('dgn-client:start'),
  stopClient: () => ipcRenderer.send('dgn-client:stop'),
  onLog: (callback) => ipcRenderer.on('dgn-client:log', (_event, value) => callback(value)),
  onStatusChange: (callback) => ipcRenderer.on('dgn-client:status', (_event, value) => callback(value)),
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});