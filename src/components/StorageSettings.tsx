import { useState, useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { motion } from "framer-motion";
import { Loader } from "@/components/ui/loader";
import type { DockerEnginePreference, DockerStatus } from "@/types";
import {
  HardDrive,
  RefreshCw,
  AlertTriangle,
  ArrowRightLeft,
} from "lucide-react";

interface StorageSettingsProps {
  onSettingsChanged?: () => void | Promise<void>;
}

export function StorageSettings({ onSettingsChanged }: StorageSettingsProps) {
  const [platform, setPlatform] = useState<"win32" | "linux" | "darwin">(
    "win32",
  );
  const [diskInfo, setDiskInfo] = useState<{
    free_gb: string;
    used_gb: string;
    total_gb: string;
    path: string;
  } | null>(null);
  const [availableDrives, setAvailableDrives] = useState<
    { name: string; freeGB: number }[]
  >([]);
  const [selectedDrive, setSelectedDrive] = useState<string>("");
  const [isReclaiming, setIsReclaiming] = useState(false);
  const [isRelocating, setIsRelocating] = useState(false);
  const [dockerStatus, setDockerStatus] = useState<DockerStatus | null>(null);
  const [enginePreference, setEnginePreference] =
    useState<DockerEnginePreference>("auto");
  const [error, setError] = useState<string | null>(null);

  const refreshData = async () => {
    try {
      const status = await window.electronAPI.checkDocker();
      setDockerStatus(status);
      setEnginePreference(status.enginePreference ?? "auto");

      const info = await window.electronAPI.getDiskSpace();
      if (info.success) setDiskInfo(info.data);

      const drives = await window.electronAPI.getAvailableDrives();
      setAvailableDrives(drives);

      if (status?.installDrive) {
        setSelectedDrive(status.installDrive);
      }
    } catch (e) {
      console.error("Failed to refresh storage data:", e);
    }
  };

  useEffect(() => {
    window.electronAPI.getProcessInfo().then((info) => {
      setPlatform(info.platform as "win32" | "linux" | "darwin");
    });
    refreshData();
  }, []);

  const isWindows = platform === "win32";
  const isWslMode = isWindows && dockerStatus?.isNative === false;
  const isDockerDesktop = isWindows && dockerStatus?.isNative === true;
  const hasDesktopEngine = isWindows && !!dockerStatus?.availableEngines?.desktop;
  const hasWslEngine = isWindows && !!dockerStatus?.availableEngines?.wsl;
  const storageTitle = isWslMode
    ? "WSL Engine Storage"
    : isDockerDesktop
      ? "Docker Desktop Storage"
      : "Native Docker Storage";
  const storageSubtitle = isWslMode
    ? "Manage OpenFork's dedicated WSL disk"
    : isDockerDesktop
      ? "Managed by Docker Desktop"
      : "Native Linux Docker runtime";

  const handleEnginePreferenceChange = async (
    nextPreference: DockerEnginePreference,
  ) => {
    setEnginePreference(nextPreference);
    setError(null);

    try {
      const result = await window.electronAPI.saveSettings({
        dockerEnginePreference: nextPreference,
      });

      if (!result.success) {
        setError(result.error || "Failed to save Docker backend preference");
        return;
      }

      await refreshData();
      await Promise.resolve(onSettingsChanged?.());
    } catch (e) {
      console.error("Failed to update Docker backend preference:", e);
      setError("Failed to save Docker backend preference");
    }
  };

  const handleReclaim = async () => {
    if (isReclaiming) return;
    setIsReclaiming(true);
    setError(null);
    try {
      const result = await window.electronAPI.reclaimDiskSpace();
      if (!result.success) setError(result.error || "Reclaim failed");
      await refreshData();
      await Promise.resolve(onSettingsChanged?.());
    } finally {
      setIsReclaiming(false);
    }
  };

  const handleRelocate = async () => {
    if (!selectedDrive || isRelocating) return;

    const confirm = window.confirm(
      `WARNING: This will reinstall the OpenFork engine on ${selectedDrive}: drive and remove the current engine images so they can be downloaded again.\n\nAre you sure you want to proceed?`,
    );
    if (!confirm) return;

    setIsRelocating(true);
    setError(null);
    try {
      const drivePath = `${selectedDrive}:\\OpenFork\\wsl`;
      const result = await window.electronAPI.relocateStorage(drivePath);
      if (!result.success) {
        setError(result.error || "Relocation failed");
      } else {
        alert("Relocation complete! The engine has been moved and restarted.");
        await refreshData();
        await Promise.resolve(onSettingsChanged?.());
      }
    } finally {
      setIsRelocating(false);
    }
  };

  return (
    <Card className="card overflow-hidden border-white/5 bg-surface/20 backdrop-blur-md">
      <CardContent className="p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-6">
          <div className="flex items-center gap-4">
            <div className="p-2.5 rounded-lg bg-primary border border-white/10 shadow-lg shadow-primary/30 text-white flex items-center justify-center shrink-0">
              <HardDrive className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-white/90">
                {storageTitle}
              </h3>
              <p className="text-[9px] text-white/30 font-black uppercase tracking-[0.1em] mt-0.5">
                {storageSubtitle}
              </p>
            </div>
          </div>
          {diskInfo && (
            <div className="flex flex-col items-end gap-1.5">
              <div className="text-[9px] text-white/80 bg-white/5 font-black uppercase tracking-widest px-3 py-1.5 rounded-lg border border-white/5">
                Active: {diskInfo.path}
              </div>
              <div className="text-[10px] font-black tracking-widest text-white/90 uppercase">
                {diskInfo.free_gb} GB FREE / {diskInfo.total_gb} GB TOTAL
              </div>
            </div>
          )}
        </div>

        {isWindows && (hasDesktopEngine || hasWslEngine) && (
          <div className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
            <div className="space-y-0.5">
              <Label className="text-[10px] font-black uppercase tracking-widest text-white/90">
                Docker Backend
              </Label>
              <p className="text-[9px] text-white/40 font-black uppercase tracking-tight leading-relaxed">
                Choose which Windows Docker engine OpenFork should track in
                Docker Management and use for client startup.
              </p>
            </div>

            <Select
              value={enginePreference}
              onValueChange={(value: DockerEnginePreference) =>
                void handleEnginePreferenceChange(value)
              }
              disabled={isReclaiming || isRelocating}
            >
              <SelectTrigger className="w-full h-9 bg-background/50 border-white/10 hover:bg-background/80 transition-colors">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto" className="text-[11px]">
                  Auto-select best available engine
                </SelectItem>
                <SelectItem
                  value="desktop"
                  disabled={!hasDesktopEngine}
                  className="text-[11px]"
                >
                  Docker Desktop
                </SelectItem>
                <SelectItem
                  value="wsl"
                  disabled={!hasWslEngine}
                  className="text-[11px]"
                >
                  OpenFork WSL
                </SelectItem>
              </SelectContent>
            </Select>

            <p className="text-[9px] text-white/30 font-black uppercase tracking-tight leading-relaxed">
              {hasDesktopEngine && hasWslEngine
                ? "Both Docker Desktop and the dedicated OpenFork WSL engine are available on this PC."
                : hasDesktopEngine
                  ? "Docker Desktop is the only Windows Docker engine detected right now."
                  : "The dedicated OpenFork WSL engine is the only Windows Docker engine detected right now."}
            </p>
          </div>
        )}

        {isWslMode ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
            <div className="space-y-2">
              <div className="space-y-0.5">
                <Label className="text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 text-white/90">
                  <RefreshCw className="h-3 w-3" />
                  Space Reclamation
                </Label>
                <p className="text-[9px] text-white/30 font-black uppercase tracking-tight leading-relaxed">
                  Reclaim unused space from the WSL disk file.
                </p>
              </div>
              <Button
                variant="primary"
                size="sm"
                className="px-4 h-8 text-[10px] font-black uppercase tracking-widest"
                onClick={handleReclaim}
                disabled={isReclaiming || isRelocating}
              >
                {isReclaiming ? (
                  <Loader size="xs" className="mr-2" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 mr-2" />
                )}
                {isReclaiming ? "Compacting..." : "Optimize Now"}
              </Button>
            </div>

            <div className="space-y-2 md:border-l md:pl-4 border-white/5">
              <div className="space-y-0.5">
                <Label className="text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 text-white/90">
                  <ArrowRightLeft className="h-3 w-3" />
                  Relocate Engine
                </Label>
                <p className="text-[9px] text-white/30 font-black uppercase tracking-tight leading-relaxed">
                  Reinstall the engine on another drive.{" "}
                  <span className="text-orange-400/80 italic">
                    Requires re-downloading images.
                  </span>
                </p>
              </div>

              <div className="flex gap-2 items-center">
                <div className="flex-1 min-w-0">
                  <Select
                    value={selectedDrive}
                    onValueChange={setSelectedDrive}
                    disabled={isRelocating}
                  >
                    <SelectTrigger className="w-full h-8 text-[11px] bg-background/50 border-white/10 hover:bg-background/80 transition-colors">
                      <SelectValue placeholder="Select Drive" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableDrives.map((drive) => {
                        const isInstalledHere =
                          dockerStatus?.installDrive === drive.name;
                        return (
                          <SelectItem
                            key={drive.name}
                            value={drive.name}
                            disabled={isInstalledHere}
                            className="text-[11px]"
                          >
                            <div className="flex items-center justify-between w-full gap-4">
                              <span>{drive.name}: Drive</span>
                              <span className="text-[10px] opacity-50">
                                ({drive.freeGB} GB free)
                              </span>
                              {isInstalledHere && (
                                <span className="text-[8px] text-primary font-black uppercase tracking-widest ml-auto px-1.5 py-0.5 rounded-sm bg-primary/10 border border-primary/20">
                                  ACTIVE
                                </span>
                              )}
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  variant="primary"
                  size="sm"
                  className="px-4 h-8 text-[11px] flex-shrink-0"
                  onClick={handleRelocate}
                  disabled={
                    !selectedDrive ||
                    selectedDrive === dockerStatus?.installDrive ||
                    isRelocating ||
                    isReclaiming
                  }
                >
                  {isRelocating ? <Loader size="xs" /> : "Move"}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.15em] text-white/80">
              {isDockerDesktop
                ? "Docker Desktop manages its own virtual disk. OpenFork only exposes relocation and compaction controls for the dedicated WSL engine."
                : "This setup uses native Docker. OpenFork doesn't relocate or compact Docker storage from the app in this mode."}
            </p>
          </div>
        )}

        {error && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-2 rounded-md bg-destructive-foreground border border-destructive/20 flex items-center gap-2 text-destructive"
          >
            <AlertTriangle className="h-3 w-3 flex-shrink-0" />
            <span className="text-[9px] text-white font-black uppercase tracking-widest">
              {error}
            </span>
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}
