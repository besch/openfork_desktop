const { spawn } = require("child_process");
const electron = require("electron");

const env = { ...process.env };

// Some automation shells set this when they use Electron as a Node runtime.
// The desktop app must launch as Electron, not plain Node.
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ["."], {
  cwd: __dirname + "/..",
  env,
  stdio: "inherit",
  windowsHide: false,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
