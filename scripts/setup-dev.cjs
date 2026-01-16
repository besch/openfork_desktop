const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Paths
const desktopDir = path.resolve(__dirname, '..');
const rootDir = desktopDir; 
const clientDir = path.join(desktopDir, 'openfork_client');
const venvDir = path.join(clientDir, 'venv');

const isWin = process.platform === 'win32';

console.log('=== OpenFork Dev Setup ===');
console.log(`Openfork Client Dir: ${clientDir}`);

// 0. Clone Openfork Client if missing
console.log('\n--> Checking for openfork_client...');
if (!fs.existsSync(clientDir)) {
  console.log('Cloning openfork_client repository...');
  try {
    execSync('git clone https://github.com/besch/openfork_client.git openfork_client', { stdio: 'inherit', cwd: rootDir });
  } catch (e) {
    console.error('Failed to clone openfork_client');
    process.exit(1);
  }
} else {
  console.log('openfork_client already exists.');
}

// 0.5. Clean bin/ directory (ensure no stale executables)
console.log('\n--> Cleaning bin/ directory...');
const binDir = path.join(desktopDir, 'bin');
if (fs.existsSync(binDir)) {
    try {
        fs.rmSync(binDir, { recursive: true, force: true });
        console.log('Cleaned bin/ directory.');
    } catch (e) {
        console.warn(`Warning: Failed to clean bin/ directory: ${e.message}`);
    }
} else {
    console.log('bin/ directory not present.');
}

// 1. Install Desktop Dependencies
console.log('\n--> Installing Desktop Dependencies...');
try {
  execSync('npm install', { stdio: 'inherit', cwd: desktopDir });
} catch (e) {
  console.error('Failed to install desktop dependencies');
  process.exit(1);
}

// 2. Setup Python Venv
console.log('\n--> Setting up Python Virtual Environment...');
if (!fs.existsSync(clientDir)) {
  console.error(`Client directory not found at ${clientDir}`);
  process.exit(1);
}

if (!fs.existsSync(venvDir)) {
  console.log('Creating venv...');
  try {
    execSync(`python -m venv venv`, { stdio: 'inherit', cwd: clientDir });
  } catch (e) {
    console.error('Failed to create venv. Ensure python is in your PATH.');
    process.exit(1);
  }
} else {
  console.log('venv already exists.');
}

// 3. Install Python Requirements
console.log('\n--> Installing Python Requirements...');
const pythonPath = isWin 
  ? path.join(venvDir, 'Scripts', 'python.exe')
  : path.join(venvDir, 'bin', 'python');

if (!fs.existsSync(pythonPath)) {
  console.error(`Python not found at ${pythonPath}`);
  process.exit(1);
}

const { spawnSync } = require('child_process');
const result = spawnSync(pythonPath, ['-m', 'pip', 'install', '-r', 'requirements.txt'], { 
  stdio: 'inherit', 
  cwd: clientDir 
});

if (result.error || result.status !== 0) {
  console.error('Failed to install python requirements');
  process.exit(1);
}

console.log('\n=== Setup Complete ===');
console.log('You can now run: npm run dev:all');
