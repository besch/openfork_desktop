# OpenFork Desktop

OpenFork Desktop is the Electron app that connects a user's machine to
OpenFork's Distributed GPU Network (DGN). It gives creators a friendly way to run
their own GPU for private generations, share idle compute with the community,
process trusted collaborators' work, or earn real money from paid monetize jobs.

The app wraps the sibling Python client in `../client` during development and a
bundled client executable in production builds.

## What It Does

- Signs users in with the same Supabase/Google account used on `openfork.video`.
- Installs and manages the local compute engine.
- Starts/stops the Python DGN worker and streams logs back into the UI.
- Lets users choose Private, Public, Trusted Group, or Monetize routing.
- Shows job history, provider stats, running containers, downloaded model images,
  and disk pressure warnings.
- Manages Docker image storage budgets, WSL storage location, and Windows VHDX
  compaction.
- Provides Stripe Connect onboarding, provider pricing, earnings history, and
  withdrawals for monetize providers.

## Platform Support

- Windows 10/11 with an NVIDIA GPU. The installer provisions an OpenFork Ubuntu
  WSL2 engine, Docker, and NVIDIA Container Toolkit support.
- Linux with an NVIDIA GPU, Docker Engine, and NVIDIA Container Toolkit already
  installed.
- AMD GPUs and Apple Silicon are not supported for DGN provider work.

## Tech Stack

- Electron 37 main process and IPC bridge.
- Vite 7, React 19, TypeScript, Tailwind CSS 4.
- Supabase Auth/Realtime from the renderer.
- `electron-store` for local settings.
- `electron-builder` for Windows NSIS and Linux AppImage/deb releases.
- Python DGN client launched as a subprocess.

## Important Files

```text
desktop/
  electron.cjs                     Main process, auth, IPC, updater
  preload.cjs                      Safe renderer API bridge
  src/App.tsx                      Main renderer shell and tabs
  src/python-process-manager.cjs   Python client lifecycle
  src/ipc-docker.cjs               Docker/engine IPC handlers
  src/auto-compact-manager.cjs     Windows WSL VHDX compaction
  src/engine-install.cjs           Engine install/repair flows
  src/components/                  Dashboard, Docker, Monetize, settings UI
  scripts/                         Installer, setup, WSL, relocation scripts
  public/                          Icons and installer artwork
```

## Development Setup

Prerequisites:

- Node.js 20+ recommended.
- Python 3.10+.
- Git.
- NVIDIA GPU and Docker-capable environment if you want to run actual jobs.

Install the Python client dependencies in the sibling `client` project:

```powershell
cd ..\client
python -m venv venv
.\venv\Scripts\python -m pip install -r requirements.txt
```

Install desktop dependencies:

```powershell
cd ..\desktop
npm install
```

Run the desktop app in development:

```powershell
npm run dev:all
```

This starts Vite and Electron together. In development, the main process looks
for `../client/venv/Scripts/python.exe` on Windows or `../client/venv/bin/python`
on Linux and runs the Python source directly.

You can also run the two processes separately:

```powershell
npm run dev
npm run start
```

For debugging, many local runs use two terminals:

Terminal 1:

```powershell
cd D:\openfork\desktop
npm run dev
```

Terminal 2:

```powershell
cd D:\openfork\desktop
npm run start
```

If `bin/client.exe` exists on Windows, the desktop app uses it before falling
back to the sibling `../client` Python source. After changing Python client code,
rebuild and copy the executable, then stop/start the DGN client inside the
desktop UI:

```powershell
cd D:\openfork\client
pyinstaller client.spec
Move-Item -Force dist\client.exe ..\desktop\bin\client.exe
```

To force source-mode execution from `../client/venv`, remove or rename
`desktop/bin/client.exe` before starting the DGN client.

## Packaging

```powershell
npm run build
npm run pack
```

Publish a release through `electron-builder`:

```powershell
npm run release
```

Auto-update checks only notify users when the published release has a higher
semantic version than their installed app. Rebuilding, deleting, or recreating
the same tag, such as `v0.0.16`, will not be offered to users already running
`0.0.16`; publish the next tag instead, such as `v0.0.17`.

The production build bundles:

- `bin/client` or `bin/client.exe`
- workflow files
- WSL/Linux setup scripts
- uninstall and compaction helpers

## Runtime Routing

Desktop stores provider routing as:

```ts
{
  processOwnJobs: boolean;
  communityMode: "none" | "trusted_users" | "trusted_projects" | "all";
  trustedIds: string[];
  monetizeMode: boolean;
}
```

The UI presents this as:

- Private: own jobs only, with optional Trusted Group.
- Public: community credit network.
- Monetize: paid jobs only, with Stripe onboarding and provider rate controls.

The Python client receives the current routing via CLI arguments on startup and
via IPC/heartbeat updates while running.

## Storage Management

OpenFork Docker images are large. The desktop app exposes a Docker image cache
budget and forwards it to the Python client. On Windows, image eviction can leave
the WSL VHDX file large on the host drive, so the auto-compact manager can pause
the provider, stop Python, trim/compact the VHDX, and resume the client.

## Related Projects

- `../website` - web app, DGN orchestrator, Supabase schema, payments, admin.
- `../client` - Python DGN worker and Docker workflow processors.
