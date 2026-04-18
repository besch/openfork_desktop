import { useState, useCallback, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  Download,
  RefreshCw,
  Cpu,
  HardDrive,
} from "lucide-react";
import { motion } from "framer-motion";
import type { DependencyStatus } from "@/types";

type Platform = "win32" | "linux" | "darwin";

interface DependencySetupProps {
  onReady: () => void;
  initialStatus: DependencyStatus;
}

export function DependencySetup({
  onReady,
  initialStatus,
}: DependencySetupProps) {
  const [status, setStatus] = useState<DependencyStatus>(initialStatus);
  const [isChecking, setIsChecking] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isFixingPermissions, setIsFixingPermissions] = useState(false);
  const [availableDrives, setAvailableDrives] = useState<
    { name: string; freeGB: number }[]
  >([]);
  const [selectedDrive, setSelectedDrive] = useState<string>("C");
  const [platform, setPlatform] = useState<Platform>("win32");

  // Installation progress state
  const [installLogs, setInstallLogs] = useState<string[]>([]);
  const [installPhase, setInstallPhase] = useState("");
  const [installPercent, setInstallPercent] = useState(0);

  const logEndRef = useRef<HTMLDivElement>(null);

  const installDrive = status?.docker.installDrive;
  const isWindows = platform === "win32";
  const isBridgeStarting =
    status?.docker.error === "DOCKER_API_UNREACHABLE" ||
    !!status?.docker.isStarting;
  const canChooseInstallDrive = !status?.docker.installed;
  const dockerStatusHeadline = status?.docker.installed
    ? status.docker.error === "DOCKER_PERMISSION_DENIED"
        ? "Docker access needs a permission refresh"
        : isWindows
          ? isBridgeStarting
            ? "OpenFork Ubuntu is starting…"
            : "OpenFork Ubuntu is installed but not running"
          : status.docker.isNative
            ? status.docker.isStarting
              ? "Docker is starting…"
              : "Docker is not running"
            : isBridgeStarting
              ? "AI Engine is starting and exposing its Docker API"
              : "AI Engine is installed but not running"
    : "";
  const dockerStatusDescription = status?.docker.installed
    ? status.docker.error === "DOCKER_PERMISSION_DENIED"
      ? "Docker is installed, but your user cannot access it yet. If you just finished setup on Linux, log out and back in before retrying."
      : isWindows
        ? isBridgeStarting
          ? "OpenFork is waiting for the Docker API inside the dedicated Ubuntu distro to become reachable from Windows. This usually takes a few seconds after WSL boots."
          : "Repair or restart the dedicated OpenFork Ubuntu engine to use local workflows."
          : isBridgeStarting
            ? "OpenFork is waiting for the Docker API to become reachable from Windows. This usually takes a few seconds after WSL boots."
            : "Please ensure the engine service is running. If you just installed it, you may need to restart your PC."
    : "";

  // Auto-scroll log terminal to bottom when new lines arrive
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [installLogs]);

  useEffect(() => {
    window.electronAPI.getProcessInfo().then((info) => {
      setPlatform(info.platform as Platform);
    });
    window.electronAPI.getAvailableDrives().then((drives) => {
      setAvailableDrives(drives);
    });
  }, []);

  useEffect(() => {
    if (installDrive) {
      setSelectedDrive(installDrive);
    }
  }, [installDrive]);

  const checkDependencies = useCallback(async () => {
    setIsChecking(true);
    try {
      const [dockerResult, nvidiaResult] = await Promise.all([
        window.electronAPI.checkDocker(),
        window.electronAPI.checkNvidia(),
      ]);

      const depStatus: DependencyStatus = {
        docker: dockerResult,
        nvidia: nvidiaResult,
        allReady: dockerResult.installed && dockerResult.running,
      };

      setStatus(depStatus);

      if (depStatus.allReady) {
        setTimeout(() => onReady(), 300);
      }
    } catch (error) {
      console.error("Failed to check dependencies:", error);
    } finally {
      setIsChecking(false);
    }
  }, [onReady]);

  const handleInstallEngine = useCallback(async () => {
    if (isInstalling) return;
    setIsInstalling(true);
    setInstallLogs([]);
    setInstallPhase("Starting setup…");
    setInstallPercent(0);

    const cleanup = window.electronAPI.onInstallProgress((data) => {
      if (data.line) {
        setInstallLogs((prev) => [...prev.slice(-49), data.line]);
      }
      if (data.phase) setInstallPhase(data.phase);
      if (data.percent) setInstallPercent(data.percent);
    });

    try {
      const drivePath =
        platform === "win32" && canChooseInstallDrive
          ? `${selectedDrive}:\\OpenFork\\wsl`
          : undefined;
      const result = await window.electronAPI.installEngine(drivePath);
      if (result?.success) {
        await checkDependencies();
      } else if (result?.error !== "cancelled") {
        console.error("Installation failed:", result?.error);
      }
    } finally {
      cleanup();
      setIsInstalling(false);
    }
  }, [canChooseInstallDrive, isInstalling, checkDependencies, selectedDrive]);

  const handleFixLinuxPermissions = useCallback(async () => {
    if (isFixingPermissions) return;
    setIsFixingPermissions(true);
    try {
      const result = await window.electronAPI.fixLinuxDockerPermissions();
      if (result?.success) {
        await checkDependencies();
      } else {
        console.error("Failed to fix Docker permissions:", result?.error);
      }
    } finally {
      setIsFixingPermissions(false);
    }
  }, [isFixingPermissions, checkDependencies]);

  const handleCancelInstall = useCallback(async () => {
    if (isCancelling) return;
    setIsCancelling(true);
    try {
      await window.electronAPI.cancelInstall();
    } finally {
      setIsCancelling(false);
      setInstallLogs([]);
      setInstallPhase("");
      setInstallPercent(0);
    }
  }, [isCancelling]);

  // Auto-recheck when bridge is starting (Docker installed but API not yet reachable)
  useEffect(() => {
    if (
      !status?.docker.installed ||
      status.docker.running ||
      !isBridgeStarting ||
      isChecking ||
      isInstalling
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      checkDependencies();
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [
    checkDependencies,
    isBridgeStarting,
    isChecking,
    isInstalling,
    status?.docker.installed,
    status?.docker.running,
  ]);

  return (
    <div className="min-h-screen bg-background p-8 flex items-center justify-center">
      <div className="max-w-2xl w-full space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-black bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text text-transparent uppercase">
            System Setup
          </h1>
          <p className="text-muted-foreground">
            OpenFork requires its local AI engine and an NVIDIA GPU to run
            workflows on your machine.
          </p>
        </div>

        <div className="grid gap-4">
          {/* AI Engine Status Card */}
          <Card
            className={`border-2 transition-colors ${
              status?.docker.running
                ? "border-green-500/50 bg-green-500/5"
                : isInstalling
                  ? "border-amber-500/50 bg-amber-500/10 backdrop-blur-xl shadow-2xl shadow-amber-500/10"
                  : status?.docker.installed
                    ? "border-yellow-500/50 bg-yellow-500/5"
                    : status?.docker.error === "WSL_DISTRO_MISSING"
                      ? "border-yellow-500/50 bg-yellow-500/5"
                      : "border-red-500/50 bg-red-500/5"
            }`}
          >
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-3 text-sm font-black uppercase tracking-widest text-white/90">
                <div className="p-2 rounded-lg bg-black/40 border border-amber-500/20 shadow-lg shadow-amber-500/20 text-amber-500 flex items-center justify-center shrink-0">
                  <img
                    src="./logo.svg"
                    alt=""
                    className="h-4 w-4 brightness-0 invert sepia(100%) saturate(10000%) hue-rotate(0deg) opacity-80"
                  />
                </div>
                OpenFork Engine
                {status?.docker.running ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500 ml-auto" />
                ) : isInstalling ? (
                  <Download className="h-4 w-4 text-orange-500 ml-auto" />
                ) : status?.docker.installed ? (
                  <AlertCircle className="h-4 w-4 text-yellow-500 ml-auto" />
                ) : status?.docker.error === "WSL_DISTRO_MISSING" ? (
                  <AlertCircle className="h-4 w-4 text-yellow-500 ml-auto" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500 ml-auto" />
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {status?.docker.running ? (
                <p className="text-[10px] font-black uppercase tracking-widest text-green-400">
                  ✓ AI Engine is installed and running
                </p>
              ) : status?.docker.installed ? (
                <>
                  <p className="text-[10px] font-black uppercase tracking-widest text-yellow-400">
                    {dockerStatusHeadline}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {dockerStatusDescription}
                  </p>
                  {platform === "linux" &&
                    status.docker.error === "DOCKER_PERMISSION_DENIED" && (
                      <Button
                        onClick={handleFixLinuxPermissions}
                        disabled={isFixingPermissions}
                        className="w-full mt-2"
                        variant="outline"
                      >
                        {isFixingPermissions ? (
                          <>
                            <Loader className="h-3.5 w-3.5 mr-2" />
                            Fixing permissions…
                          </>
                        ) : (
                          "Fix Docker Permissions"
                        )}
                      </Button>
                    )}
                </>
              ) : (
                <>
                  {!isInstalling && (
                    <div className="space-y-1">
                      {!status?.docker.isNative &&
                        (isWindows ? (
                          <>
                            <p className="text-[10px] font-black uppercase tracking-widest text-white/90">
                              OpenFork Ubuntu not installed
                            </p>
                            <p className="text-xs text-muted-foreground">
                              OpenFork will install its own Ubuntu distro and
                              Docker runtime automatically.
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="text-[10px] font-black uppercase tracking-widest text-white/90">
                              Docker not found
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Docker is required to run OpenFork.
                              {" It will be installed automatically."}
                            </p>
                          </>
                        ))}
                    </div>
                  )}

                  {/* Drive selector — Windows only, hidden on Linux */}
                  {platform === "win32" &&
                    !status?.docker.isNative &&
                    installDrive && (
                      <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-muted-foreground">
                        Existing OpenFork Ubuntu storage detected on{" "}
                        <span className="font-semibold text-foreground">
                          {installDrive}: drive
                        </span>
                        . OpenFork installs its Docker engine inside this
                        dedicated distro.
                      </div>
                    )}

                  {/* Drive selector — Windows only, hidden while installing */}
                  {platform === "win32" &&
                    !isInstalling &&
                    !status?.docker.isNative &&
                    canChooseInstallDrive &&
                    availableDrives.length > 1 && (
                      <div className="space-y-2 pt-2">
                        <label className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40 flex items-center gap-1.5">
                          <HardDrive className="h-3 w-3" />
                          Choose installation drive
                        </label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {availableDrives.map((drive) => (
                            <button
                              key={drive.name}
                              onClick={() => setSelectedDrive(drive.name)}
                              className={`flex flex-col items-start p-2 rounded-md border text-left transition-all hover:bg-white/5 ${
                                selectedDrive === drive.name
                                  ? "border-primary bg-primary/10"
                                  : "border-white/10 bg-black/20"
                              }`}
                            >
                              <span className="text-sm font-bold">
                                {drive.name}: Drive
                              </span>
                              <span
                                className={`text-[10px] ${drive.freeGB < 20 ? "text-red-400 font-bold" : "text-muted-foreground"}`}
                              >
                                {drive.freeGB}GB free
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                  {/* Install button — shown when not installing */}
                  {!isInstalling && !status?.docker.isNative && (
                    <Button
                      onClick={handleInstallEngine}
                      className="w-full mt-2 relative overflow-hidden group"
                      disabled={status?.docker.isStarting}
                    >
                      {!status?.docker.installed ? (
                        <>
                          <Download className="h-3.5 w-3.5 mr-2" />
                          {isWindows
                            ? "Install OpenFork Ubuntu"
                            : "Install Local AI Engine"}
                        </>
                      ) : (
                        <>
                          <Download className="h-3.5 w-3.5 mr-2" />
                          {isWindows
                            ? "Repair OpenFork Ubuntu"
                            : "Install Local AI Engine"}
                        </>
                      )}
                      <div className="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                    </Button>
                  )}

                  {/* Progress UI — shown while installing */}
                  {isInstalling && (
                    <div className="space-y-3 mt-2">
                      {/* Phase label */}
                      <p className="text-[10px] font-black uppercase tracking-widest text-white animate-pulse">
                        {installPhase || "Starting setup…"}
                      </p>

                      {/* Progress bar */}
                      <div className="relative h-2 bg-white/5 rounded-full overflow-hidden">
                        <motion.div
                          className="absolute inset-y-0 left-0 bg-amber-500 rounded-full overflow-hidden"
                          initial={{ width: 0 }}
                          animate={{ width: `${installPercent}%` }}
                          transition={{ duration: 0.5, ease: "backOut" }}
                        >
                          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-shimmer" />
                        </motion.div>
                      </div>

                      {/* Scrollable log terminal */}
                      <div className="h-32 overflow-y-auto rounded-md bg-black/40 border border-white/5 p-2 font-mono text-[10px] text-muted-foreground">
                        {installLogs.length === 0 ? (
                          <p className="text-muted-foreground/50 italic">
                            Waiting for output…
                          </p>
                        ) : (
                          installLogs.map((line, i) => (
                            <div key={i} className="leading-tight py-px">
                              {line}
                            </div>
                          ))
                        )}
                        <div ref={logEndRef} />
                      </div>

                      {/* Cancel button */}
                      <Button
                        variant="destructive"
                        size="sm"
                        className="w-full text-[10px] font-black uppercase tracking-widest"
                        onClick={handleCancelInstall}
                        disabled={isCancelling}
                      >
                        {isCancelling ? (
                          <>
                            <Loader size="xs" className="mr-2" />
                            Cancelling…
                          </>
                        ) : (
                          "Cancel Installation"
                        )}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* GPU Status Card */}
          <Card
            className={`border transition-colors ${
              status?.nvidia.available
                ? "border-green-500/30 bg-green-500/5"
                : "border-yellow-500/30 bg-yellow-500/5"
            }`}
          >
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-3 text-sm font-black uppercase tracking-widest text-white/90">
                <div className="p-2 rounded-lg bg-black/40 border border-amber-500/20 shadow-lg shadow-amber-500/20 text-amber-500 flex items-center justify-center shrink-0">
                  <Cpu className="h-4 w-4" />
                </div>
                NVIDIA GPU
                {status?.nvidia.available ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500 ml-auto" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-yellow-500 ml-auto" />
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {status?.nvidia.available ? (
                <p className="text-[10px] font-black uppercase tracking-widest text-green-400">
                  ✓ {status.nvidia.gpu} detected
                </p>
              ) : (
                <>
                  <p className="text-[10px] font-black uppercase tracking-widest text-yellow-400">
                    No NVIDIA GPU detected
                  </p>
                  <p className="text-xs text-muted-foreground">
                    OpenFork requires an NVIDIA GPU with CUDA 12.8 or higher.
                    Install or update your NVIDIA drivers to include CUDA 12.8+.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() =>
                      window.electronAPI.openExternal(
                        "https://www.nvidia.com/drivers",
                      )
                    }
                    className="w-full mt-2 text-[10px] font-black uppercase tracking-widest"
                  >
                    <Download className="h-3.5 w-3.5 mr-2" />
                    Install NVIDIA Drivers
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Retry Check — only shown when engine is installed but not running */}
        {status?.docker.installed && (
          <div className="flex flex-col gap-3 pt-4">
            <Button
              onClick={checkDependencies}
              disabled={isChecking}
              size="lg"
              className="w-full text-[11px] font-black uppercase tracking-[0.2em]"
            >
              {isChecking ? (
                <Loader size="xs" className="mr-2" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              {isChecking ? "Checking…" : "Retry Check"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
