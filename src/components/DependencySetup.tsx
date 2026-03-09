import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  Download,
  RefreshCw,
  Loader2,
  Container,
  Cpu,
  HardDrive,
} from "lucide-react";
import type { DependencyStatus } from "@/types";

interface DependencySetupProps {
  onReady: () => void;
  initialStatus: DependencyStatus;
}



export function DependencySetup({ onReady, initialStatus }: DependencySetupProps) {
  const [status, setStatus] = useState<DependencyStatus>(initialStatus);
  const [isChecking, setIsChecking] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [availableDrives, setAvailableDrives] = useState<{name: string, freeGB: number}[]>([]);
  const [selectedDrive, setSelectedDrive] = useState<string>("C");

  useEffect(() => {
    window.electronAPI.getAvailableDrives().then(drives => {
      setAvailableDrives(drives);
      // Default to first drive with most space that isn't C if possible? 
      // Or just stay on C by default for safety.
    });
  }, []);

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
    try {
      const drivePath = `${selectedDrive}:\\OpenFork\\wsl`;
      const result = await window.electronAPI.installEngine(drivePath);
      if (result?.success) {
        // Wait a few seconds for daemon to fully start, then check again
        setTimeout(checkDependencies, 3000);
      } else {
        console.error("Installation failed or cancelled:", result?.error);
      }
    } finally {
      setIsInstalling(false);
    }
  }, [isInstalling, checkDependencies, selectedDrive]);

  // Auto-trigger installation removed as per user request to select drive first

  return (
    <div className="min-h-screen bg-background p-8 flex items-center justify-center">
      <div className="max-w-2xl w-full space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text text-transparent">
            System Setup
          </h1>
          <p className="text-muted-foreground">
            OpenFork requires a local AI Engine and an NVIDIA GPU to run workflows on your machine.
          </p>
        </div>

        <div className="grid gap-4">
          {/* Docker Status Card */}
          <Card className={`border-2 transition-colors ${
            status?.docker.running
              ? "border-green-500/50 bg-green-500/5"
              : status?.docker.installed
                ? "border-yellow-500/50 bg-yellow-500/5"
                : "border-red-500/50 bg-red-500/5"
          }`}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-3 text-lg">
                <Container className="h-5 w-5" />
                OpenFork AI Engine
                {status?.docker.running ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500 ml-auto" />
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
                    AI Engine is installed but not running
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Please ensure the engine service is running. If you just installed it, you may need to restart your PC.
                  </p>
                  <Button
                    onClick={checkDependencies}
                    disabled={isChecking}
                    className="w-full mt-2"
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${isChecking ? "animate-spin" : ""}`} />
                    Retry Check
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-sm text-red-400">
                    {status?.docker.error === "WSL_DISTRO_MISSING" 
                      ? "WSL Ubuntu distribution not found" 
                      : "AI Engine is not installed"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {status?.docker.error === "WSL_DISTRO_MISSING"
                      ? "The required Ubuntu environment is missing from WSL. Setup will install it for you on the selected drive."
                      : "The background engine is required to run models locally. Setup will request administrator privileges."}
                  </p>
                  
                  {availableDrives.length > 1 && (
                    <div className="space-y-2 pt-2">
                       <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 uppercase tracking-wider">
                         <HardDrive className="h-3 w-3" />
                         Storage Drive
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
                             <span className="text-sm font-bold">{drive.name}: Drive</span>
                             <span className={`text-[10px] ${drive.freeGB < 20 ? 'text-red-400 font-bold' : 'text-muted-foreground'}`}>
                               {drive.freeGB}GB free
                             </span>
                           </button>
                         ))}
                       </div>
                    </div>
                  )}
                  
                  {isInstalling ? (
                    <div className="w-full flex items-center justify-center p-4 border border-white/5 bg-black/20 rounded-lg mt-4 shadow-inner">
                      <Loader2 className="h-6 w-6 animate-spin text-primary mr-3" />
                      <span className="text-sm font-medium pt-1 animate-pulse text-primary">Installing Engine Setup... Please wait.</span>
                    </div>
                  ) : (
                    <Button
                      onClick={handleInstallEngine}
                      disabled={isInstalling}
                      className="w-full mt-2 relative overflow-hidden group"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Install Local AI Engine
                      
                      {/* Animated shine effect on button */}
                      <div className="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                    </Button>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* GPU Status Card */}
          <Card className={`border transition-colors ${
            status?.nvidia.available
              ? "border-green-500/30 bg-green-500/5"
              : "border-yellow-500/30 bg-yellow-500/5"
          }`}>
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
                    An NVIDIA GPU is recommended for faster AI processing. If you have one, install the latest drivers.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => window.open("https://www.nvidia.com/download/index.aspx", "_blank")}
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
            {isChecking ? "Checking..." : "Retry"}
          </Button>
        </div>
      </div>
    </div>
  );
}
