const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process'); // Import child_process

let pythonProcess;

function startPythonBackend() {
  const pythonExecutablePath = path.join(__dirname, 'bin', 'dgn_client_backend.exe');
  const pythonCwd = path.join(__dirname, 'bin'); // Set CWD to the bin directory

  console.log(`Attempting to start Python backend from: ${pythonExecutablePath}`);
  console.log(`Python process CWD: ${pythonCwd}`);

  pythonProcess = spawn(pythonExecutablePath, [], {
    cwd: pythonCwd,
    stdio: ['pipe', 'pipe', 'pipe'] // Capture stdout, stderr
  });

  pythonProcess.stdout.on('data', (data) => {
    console.log(`Python stdout: ${data}`);
  });

  pythonProcess.stderr.on('data', (data) => {
    console.error(`Python stderr: ${data}`);
  });

  pythonProcess.on('close', (code) => {
    console.log(`Python process exited with code ${code}`);
    pythonProcess = null;
  });

  pythonProcess.on('error', (err) => {
    console.error(`Failed to start Python process: ${err}`);
    pythonProcess = null;
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // Load the Vite-built HTML file
  win.loadFile(path.join(__dirname, 'dist', 'index.html'));
}

app.whenReady().then(() => {
  startPythonBackend(); // Start Python backend when Electron app is ready
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
  // Ensure Python process is killed when Electron app closes
  if (pythonProcess) {
    console.log('Killing Python process...');
    pythonProcess.kill(); // Send SIGTERM
  }
});