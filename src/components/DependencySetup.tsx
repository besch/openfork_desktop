import { useState, useCallback, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  Download,
  RefreshCw,
  Cpu,
  HardDrive,
} from "lucide-react";
import type { DependencyStatus, DockerEnginePreference } from "@/types";

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
  const [availableDrives, setAvailableDrives] = useState<
    { name: string; freeGB: number }[]
  >([]);
  const [selectedDrive, setSelectedDrive] = useState<string>("C");
  const [enginePreference, setEnginePreference] =
    useState<DockerEnginePreference>("auto");
  const [platform, setPlatform] = useState<Platform>("win32");

  // Installation progress state
  const [installLogs, setInstallLogs] = useState<string[]>([]);
  const [installPhase, setInstallPhase] = useState("");
  const [installPercent, setInstallPercent] = useState(0);

  const logEndRef = useRef<HTMLDivElement>(null);

  const installDrive = status?.docker.installDrive;
  const isBridgeStarting =
    status?.docker.error === "DOCKER_API_UNREACHABLE" ||
    !!status?.docker.isStarting;
  const canChooseInstallDrive = !status?.docker.installed;
  const dockerStatusHeadline = status?.docker.installed
    ? status.docker.error === "DOCKER_WINDOWS_CONTAINERS"
      ? "Docker Desktop is running Windows containers"
      : status.docker.error === "DOCKER_PERMISSION_DENIED"
        ? "Docker access needs a permission refresh"
        : status.docker.isNative
          ? status.docker.isStarting
            ? "Docker Desktop is starting…"
            : "Docker Desktop is not running"
          : isBridgeStarting
            ? "AI Engine is starting and exposing its Docker API"
            : "AI Engine is installed but not running"
    : "";
  const dockerStatusDescription = status?.docker.installed
    ? status.docker.error === "DOCKER_WINDOWS_CONTAINERS"
      ? "OpenFork requires Linux containers. Switch Docker Desktop from Windows containers to Linux containers, then retry the check."
      : status.docker.error === "DOCKER_PERMISSION_DENIED"
        ? "Docker is installed, but your user cannot access it yet. If you just finished setup on Linux, log out and back in before retrying."
        : status.docker.isNative
          ? status.docker.isStarting
            ? "OpenFork detected Docker Desktop and is attempting to start it automatically. This may take a minute."
            : "Docker Desktop was detected but is not running. Please start it to use the local AI Engine."
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

  useEffect(() => {
    setEnginePreference(status?.docker.enginePreference ?? "auto");
  }, [status?.docker.enginePreference]);

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
      const drivePath = canChooseInstallDrive
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

  const handleEnginePreferenceChange = useCallback(
    async (nextPreference: DockerEnginePreference) => {
      setEnginePreference(nextPreference);

      try {
        const result = await window.electronAPI.saveSettings({
          dockerEnginePreference: nextPreference,
        });

        if (!result.success) {
          console.error(
            "Failed to save Docker backend preference:",
            result.error,
          );
          return;
        }

        await checkDependencies();
      } catch (error) {
        console.error("Failed to switch Docker backend:", error);
      }
    },
    [checkDependencies],
  );

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
            OpenFork requires a Docker and an NVIDIA GPU to run workflows on
            your machine.
          </p>
        </div>

        <div className="grid gap-4">
          {/* AI Engine Status Card */}
          <Card
            className={`border-2 transition-colors ${
              status?.docker.running
                ? "border-green-500/50 bg-green-500/5"
                : isInstalling
                  ? "border-orange-500/50 bg-orange-500/5"
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
                </>
              ) : (
                <>
                  {!isInstalling && (
                    <div className="space-y-1">
                      {/* Only show installation message if Docker Desktop is NOT installed */}
                      {/* If Docker Desktop is installed but not running, that case is handled above */}
                      {!status?.docker.isNative &&
                        (status?.docker.error === "WSL_DISTRO_MISSING" ? (
                          <>
                            <p className="text-[10px] font-black uppercase tracking-widest text-white/90">
                              Docker is not installed
                            </p>
                            <p className="text-xs text-muted-foreground">
                              OpenFork uses Docker to run the virtual machine.
                              Docker is not installed on your system.
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              Would you like to install it now? You can also{" "}
                              <button
                                onClick={() =>
                                  window.electronAPI.openExternal(
                                    platform === "win32"
                                      ? "https://www.docker.com/products/docker-desktop"
                                      : "https://docs.docker.com/engine/install/",
                                  )
                                }
                                className="text-yellow-500 cursor-pointer hover:underline hover:text-yellow-400"
                              >
                                install Docker
                              </button>{" "}
                              yourself.
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="text-[10px] font-black uppercase tracking-widest text-white/90">
                              Docker not found
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Docker is required to run OpenFork.
                              {platform === "win32"
                                ? " It will be installed automatically using a dedicated WSL+Ubuntu environment."
                                : " It will be installed automatically."}
                            </p>
                          </>
                        ))}
                    </div>
                  )}

                  {platform === "win32" &&
                    (status?.docker.availableEngines?.desktop ||
                      status?.docker.availableEngines?.wsl) && (
                      <div className="space-y-2 pt-2">
                        <label className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">
                          Docker backend
                        </label>
                        <Select
                          value={enginePreference}
                          onValueChange={(value: DockerEnginePreference) =>
                            void handleEnginePreferenceChange(value)
                          }
                          disabled={isChecking || isInstalling}
                        >
                          <SelectTrigger className="w-full h-10 bg-black/20 border-white/10">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">
                              Auto-select best available engine
                            </SelectItem>
                            <SelectItem
                              value="desktop"
                              disabled={!status?.docker.availableEngines?.desktop}
                            >
                              Docker Desktop
                            </SelectItem>
                            <SelectItem
                              value="wsl"
                              disabled={!status?.docker.availableEngines?.wsl}
                            >
                              OpenFork WSL
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          OpenFork will use this backend for dependency checks,
                          Docker Management, and client startup on Windows.
                        </p>
                      </div>
                    )}

                  {/* Drive selector — Windows only, hidden on Linux */}
                  {platform === "win32" &&
                    !status?.docker.isNative &&
                    installDrive && (
                      <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-muted-foreground">
                        Existing Ubuntu detected on{" "}
                        <span className="font-semibold text-foreground">
                          {installDrive}: drive
                        </span>{" "}
                        (e.g. Docker Desktop). OpenFork will be installed as a
                        separate environment on the drive you choose below.
                      </div>
                    )}

                  {/* Drive selector — Windows only, hidden while installing or when Docker Desktop is installed */}
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

                  {/* Install button — shown when not installing and Docker Desktop is NOT installed */}
                  {!isInstalling && !status?.docker.isNative && (
                    <Button
                      onClick={handleInstallEngine}
                      className="w-full mt-2 relative overflow-hidden group"
                      disabled={status?.docker.isStarting}
                    >
                      {/* Show "Install Local AI Engine" if no Docker found (WSL distro missing or not installed) */}
                      {/* Show "Retry Check" if Docker Desktop is installed but not running */}
                      {!status?.docker.installed ? (
                        <>
                          <Download className="h-3.5 w-3.5 mr-2" />
                          {status?.docker.error === "WSL_DISTRO_MISSING"
                            ? "Install Docker"
                            : "Install Local AI Engine"}
                        </>
                      ) : status?.docker.isNative ? (
                        <>
                          <RefreshCw
                            className={`h-4 w-4 mr-2 ${status?.docker.isStarting ? "animate-spin" : ""}`}
                          />
                          {status?.docker.isStarting
                            ? "Starting Docker…"
                            : "Retry Check"}
                        </>
                      ) : (
                        <>
                          <Download className="h-3.5 w-3.5 mr-2" />
                          Install Local AI Engine
                        </>
                      )}
                      <div className="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                    </Button>
                  )}

                  {/* Progress UI — shown while installing */}
                  {isInstalling && (
                    <div className="space-y-3 mt-2">
                      {/* Phase label */}
                      <p className="text-[10px] font-black uppercase tracking-widest text-primary animate-pulse">
                        {installPhase || "Starting setup…"}
                      </p>

                      {/* Progress bar */}
                      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-2 bg-primary rounded-full transition-all duration-500"
                          style={{ width: `${installPercent}%` }}
                        />
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
