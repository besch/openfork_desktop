const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let pythonProcess;
let mainWindow;

function getPythonExecutablePath() {
  const isDev = process.env.NODE_ENV !== 'production';
  // In development, we might run from the project root, but the .exe is in the built app's 'bin' folder.
  // The path needs to be relative to where electron.cjs is.
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin', 'dgn_client_backend.exe');
  } else {
    // This path assumes you have the .exe in a 'bin' folder at the root of your desktop app project during development.
    return path.join(__dirname, 'bin', 'dgn_client_backend.exe');
  }
}

function startPythonBackend() {
  if (pythonProcess) {
    console.log('Python process is already running.');
    return;
  }

  const pythonExecutablePath = getPythonExecutablePath();
  const pythonCwd = path.dirname(pythonExecutablePath);

  console.log(`Attempting to start Python backend from: ${pythonExecutablePath}`);
  console.log(`Python process CWD: ${pythonCwd}`);

  try {
    pythonProcess = spawn(pythonExecutablePath, [], {
      cwd: pythonCwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    mainWindow.webContents.send('dgn-client:status', 'running');

    pythonProcess.stdout.on('data', (data) => {
      const log = data.toString();
      console.log(`Python stdout: ${log}`);
      mainWindow.webContents.send('dgn-client:log', { type: 'stdout', message: log });
    });

    pythonProcess.stderr.on('data', (data) => {
      const log = data.toString();
      console.error(`Python stderr: ${log}`);
      mainWindow.webContents.send('dgn-client:log', { type: 'stderr', message: log });
    });

    pythonProcess.on('close', (code) => {
      console.log(`Python process exited with code ${code}`);
      mainWindow.webContents.send('dgn-client:status', 'stopped');
      pythonProcess = null;
    });

    pythonProcess.on('error', (err) => {
      console.error(`Failed to start Python process: ${err}`);
      mainWindow.webContents.send('dgn-client:status', 'error');
      mainWindow.webContents.send('dgn-client:log', { type: 'stderr', message: `Failed to start process: ${err.message}` });
      pythonProcess = null;
    });
  } catch (err) {
      console.error(`Error spawning Python process: ${err}`);
      mainWindow.webContents.send('dgn-client:status', 'error');
      mainWindow.webContents.send('dgn-client:log', { type: 'stderr', message: `Error spawning process: ${err.message}` });
      pythonProcess = null;
  }
}

function stopPythonBackend() {
  if (pythonProcess) {
    console.log('Stopping Python process gracefully...');
    if (process.platform === 'win32') {
      const pid = pythonProcess.pid;
      // Remove /f to allow graceful shutdown. /t is still good to clean up children if the parent hangs.
      spawn('taskkill', ['/pid', pid, '/t'], { shell: true });
    } else {
      // Use SIGTERM (default) instead of SIGKILL to allow graceful shutdown.
      pythonProcess.kill();
    }
    // The 'close' event will handle setting pythonProcess to null
    // and sending the 'stopped' status.
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow = win;

  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, 'dist', 'index.html'));
  } else {
    win.loadURL('http://localhost:5173'); // Vite dev server URL
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopPythonBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers
ipcMain.on('dgn-client:start', startPythonBackend);
ipcMain.on('dgn-client:stop', stopPythonBackend);
