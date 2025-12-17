import { useState, useEffect, useCallback } from "react";
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
} from "lucide-react";
import type { DependencyStatus } from "@/types";

interface DependencySetupProps {
  onReady: () => void;
  onSkip: () => void;
}

export function DependencySetup({ onReady, onSkip }: DependencySetupProps) {
  const [status, setStatus] = useState<DependencyStatus | null>(null);
  const [isChecking, setIsChecking] = useState(true);

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
        setTimeout(() => onReady(), 500);
      }
    } catch (error) {
      console.error("Failed to check dependencies:", error);
    } finally {
      setIsChecking(false);
    }
  }, [onReady]);

  useEffect(() => {
    checkDependencies();
  }, [checkDependencies]);

  const handleInstallDocker = () => {
    window.electronAPI.openDockerDownload();
  };

  if (isChecking && !status) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background">
        <div className="relative">
          <Loader2 className="h-16 w-16 animate-spin text-primary" />
          <div className="absolute inset-0 h-16 w-16 animate-ping bg-primary/20 rounded-full" />
        </div>
        <p className="mt-4 text-muted-foreground animate-pulse">
          Checking system requirements...
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-8 flex items-center justify-center">
      <div className="max-w-2xl w-full space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text text-transparent">
            System Setup
          </h1>
          <p className="text-muted-foreground">
            OpenFork requires Docker to run AI workflows on your machine.
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
                Docker Desktop
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
                  ✓ Docker is installed and running
                </p>
              ) : status?.docker.installed ? (
                <>
                  <p className="text-sm text-yellow-400">
                    Docker is installed but not running
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Please start Docker Desktop and click "Retry" below.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm text-red-400">
                    Docker is not installed
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Docker is required to run AI models locally. Click below to download and install it.
                  </p>
                  <Button
                    onClick={handleInstallDocker}
                    className="w-full mt-2"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download Docker Desktop
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          {/* GPU Status Card */}
          <Card className={`border transition-colors ${
            status?.nvidia.available
              ? "border-green-500/30 bg-green-500/5"
              : "border-muted bg-muted/5"
          }`}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-3 text-lg">
                <Cpu className="h-5 w-5" />
                NVIDIA GPU
                {status?.nvidia.available ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500 ml-auto" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-muted-foreground ml-auto" />
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {status?.nvidia.available ? (
                <p className="text-sm text-green-400">
                  ✓ {status.nvidia.gpu} detected
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No NVIDIA GPU detected. CPU-only mode may be slower.
                </p>
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

          {!status?.allReady && (
            <Button
              onClick={onSkip}
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
            >
              Continue anyway (advanced users)
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
