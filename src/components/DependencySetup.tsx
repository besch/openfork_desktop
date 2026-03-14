import { useState, useCallback, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  Download,
  RefreshCw,
  Loader2,
  Cpu,
  HardDrive,
} from "lucide-react";
import type { DependencyStatus } from "@/types";

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

  // Auto-scroll log terminal to bottom when new lines arrive
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [installLogs]);

  useEffect(() => {
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
          <h1 className="text-3xl font-bold bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text text-transparent">
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
                    : "border-red-500/50 bg-red-500/5"
            }`}
          >
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-3 text-lg">
                <img
                  src="./logo.svg"
                  alt=""
                  className="h-5 w-5 brightness-0 invert"
                />
                OpenFork Engine
                {status?.docker.running ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500 ml-auto" />
                ) : isInstalling ? (
                  <Download className="h-5 w-5 text-orange-500 ml-auto" />
                ) : status?.docker.installed ? (
                  <AlertCircle className="h-5 w-5 text-yellow-500 ml-auto" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-500 ml-auto" />
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {status?.docker.running ? (
                <p className="text-sm text-green-400">
                  ✓ AI Engine is installed and running
                </p>
              ) : status?.docker.installed ? (
                <>
                  <p className="text-sm text-yellow-400">
                    {status.docker.isNative
                      ? status.docker.isStarting
                        ? "Docker Desktop is starting…"
                        : "Docker Desktop is not running"
                      : isBridgeStarting
                        ? "AI Engine is starting and exposing its Docker API"
                        : "AI Engine is installed but not running"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {status.docker.isNative
                      ? status.docker.isStarting
                        ? "OpenFork detected Docker Desktop and is attempting to start it automatically. This may take a minute."
                        : "Docker Desktop was detected but is not running. Please start it to use the local AI Engine."
                      : isBridgeStarting
                        ? "OpenFork is waiting for the Docker API to become reachable from Windows. This usually takes a few seconds after WSL boots."
                        : "Please ensure the engine service is running. If you just installed it, you may need to restart your PC."}
                  </p>
                </>
              ) : (
                <>
                  {!isInstalling && (
                    <div className="space-y-1">
                      <p className="text-sm text-red-400 font-medium">
                        Docker not found
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Docker is required to run OpenFork. It will be installed
                        automatically using a dedicated WSL+Ubuntu environment.
                      </p>
                    </div>
                  )}

                  {!status?.docker.isNative && installDrive && (
                    <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-muted-foreground">
                      Existing Ubuntu detected on{" "}
                      <span className="font-semibold text-foreground">
                        {installDrive}: drive
                      </span>{" "}
                      (e.g. Docker Desktop). OpenFork will be installed as a
                      separate environment on the drive you choose below.
                    </div>
                  )}

                  {/* Drive selector — hidden while installing */}
                  {!isInstalling &&
                    canChooseInstallDrive &&
                    availableDrives.length > 1 && (
                      <div className="space-y-2 pt-2">
                        <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 uppercase tracking-wider">
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
                  {!isInstalling && (
                    <Button
                      onClick={handleInstallEngine}
                      className="w-full mt-2 relative overflow-hidden group"
                      disabled={status?.docker.isStarting}
                    >
                      {status?.docker.isNative ? (
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
                          <Download className="h-4 w-4 mr-2" />
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
                      <p className="text-sm font-medium text-primary animate-pulse">
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
                        className="w-full"
                        onClick={handleCancelInstall}
                        disabled={isCancelling}
                      >
                        {isCancelling ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
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
              <CardTitle className="flex items-center gap-3 text-lg">
                <Cpu className="h-5 w-5" />
                NVIDIA GPU
                {status?.nvidia.available ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500 ml-auto" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-yellow-500 ml-auto" />
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {status?.nvidia.available ? (
                <p className="text-sm text-green-400">
                  ✓ {status.nvidia.gpu} detected
                </p>
              ) : (
                <>
                  <p className="text-sm text-yellow-400">
                    No NVIDIA GPU detected
                  </p>
                  <p className="text-xs text-muted-foreground">
                    An NVIDIA GPU is recommended for faster AI processing. If
                    you have one, install the latest drivers.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() =>
                      window.open(
                        "https://www.nvidia.com/download/index.aspx",
                        "_blank",
                      )
                    }
                    className="w-full mt-2"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download NVIDIA Drivers
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
              className="w-full"
            >
              {isChecking ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
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
