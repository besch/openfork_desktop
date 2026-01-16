const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Paths
const desktopDir = path.resolve(__dirname, '..'); // Assuming scripts/setup-dev.js
const rootDir = path.resolve(desktopDir, '..');
const clientDir = path.join(rootDir, 'client');
const venvDir = path.join(clientDir, 'venv');

const isWin = process.platform === 'win32';

console.log('=== OpenFork Dev Setup ===');
console.log(`Root Dir: ${rootDir}`);
console.log(`Client Dir: ${clientDir}`);

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
