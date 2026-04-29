import { useState, useEffect, useCallback } from "react";
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
import type { DockerStatus } from "@/types";
import {
  HardDrive,
  AlertTriangle,
  ArrowRightLeft,
  Sparkles,
} from "lucide-react";

interface StorageSettingsProps {
  onSettingsChanged?: () => void | Promise<void>;
  compact?: boolean;
  embedded?: boolean;
}

export function StorageSettings({
  onSettingsChanged,
  compact = false,
  embedded = false,
}: StorageSettingsProps) {
  const [loading, setLoading] = useState(true);
  const [platform, setPlatform] = useState<"win32" | "linux" | "darwin">(
    "win32",
  );
  const [diskInfo, setDiskInfo] = useState<{
    free_gb: string;
    used_gb: string;
    total_gb: string;
    path: string;
    engine_file_gb: string | null;
    engine_file_path: string | null;
  } | null>(null);
  const [availableDrives, setAvailableDrives] = useState<
    { name: string; freeGB: number }[]
  >([]);
  const [selectedDrive, setSelectedDrive] = useState<string>("");
  const [isReclaiming, setIsReclaiming] = useState(false);
  const [isRelocating, setIsRelocating] = useState(false);
  const [dockerStatus, setDockerStatus] = useState<DockerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoCompact, setAutoCompact] = useState<{
    enabled: boolean;
    freedBytes: number;
    thresholdBytes: number;
    lastCompactTs: number;
    compactInProgress: boolean;
    platformSupported: boolean;
  } | null>(null);

  const refreshAutoCompactStatus = useCallback(async () => {
    try {
      const status = await window.electronAPI.getAutoCompactStatus();
      setAutoCompact(status);
    } catch (e) {
      console.error("Failed to get auto-compact status:", e);
    }
  }, []);

  const refreshData = async () => {
    setLoading(true);
    try {
      const status = await window.electronAPI.checkDocker();
      setDockerStatus(status);

      const info = await window.electronAPI.getDiskSpace();
      if (info.success) setDiskInfo(info.data);

      const drives = await window.electronAPI.getAvailableDrives();
      setAvailableDrives(drives);

      if (status?.installDrive) {
        setSelectedDrive(status.installDrive);
      }
    } catch (e) {
      console.error("Failed to refresh storage data:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    window.electronAPI.getProcessInfo().then((info) => {
      setPlatform(info.platform as "win32" | "linux" | "darwin");
    });
    refreshData();
    refreshAutoCompactStatus();
    const cleanup = window.electronAPI.onAutoCompactStatus((status) => {
      setAutoCompact(status);
    });
    return cleanup;
  }, [refreshAutoCompactStatus]);

  const isWindows = platform === "win32";
  const isWslMode = isWindows && dockerStatus?.isNative === false;
  const isDockerDesktop = isWindows && dockerStatus?.isNative === true;
  const showManagedSections = isWslMode || (loading && isWindows);
  const storageTitle = isWindows
    ? "OpenFork Ubuntu Storage"
    : isWslMode
      ? "WSL Engine Storage"
      : isDockerDesktop
        ? "Docker Desktop Storage"
        : "Native Docker Storage";
  const storageSubtitle = isWindows
    ? "Manage OpenFork's dedicated Ubuntu disk"
    : isWslMode
      ? "Manage OpenFork's dedicated WSL disk"
      : isDockerDesktop
        ? "Managed by Docker Desktop"
        : "Native Linux Docker runtime";
  const readableMode = compact || embedded;
  const sectionClassName = readableMode
    ? "rounded-xl border border-white/12 bg-black/30 p-3.5 space-y-3 shadow-inner shadow-black/10"
    : "rounded-lg border border-white/10 bg-white/5 p-4 space-y-3";
  const headingClassName = readableMode
    ? "text-xs font-semibold tracking-[0.06em] text-white"
    : "text-[10px] font-black uppercase tracking-[0.2em] text-white/90";
  const subheadingClassName = readableMode
    ? "text-[11px] text-white/68 leading-relaxed mt-1"
    : "text-[9px] text-white/30 font-black uppercase tracking-[0.1em] mt-0.5";
  const statChipClassName = readableMode
    ? "max-w-full truncate text-[10px] text-white/88 bg-white/8 font-semibold tracking-[0.05em] px-3 py-1.5 rounded-lg border border-white/10"
    : "max-w-full truncate text-[9px] text-white/80 bg-white/5 font-black uppercase tracking-widest px-3 py-1.5 rounded-lg border border-white/5";
  const accentChipClassName = readableMode
    ? "text-[10px] text-amber-200 bg-amber-500/12 font-semibold tracking-[0.05em] px-3 py-1.5 rounded-lg border border-amber-500/25"
    : "text-[9px] text-amber-300/90 bg-amber-500/10 font-black uppercase tracking-widest px-3 py-1.5 rounded-lg border border-amber-500/20";
  const summaryClassName = readableMode
    ? "text-[11px] font-semibold tracking-[0.04em] text-white/92"
    : "text-[10px] font-black tracking-widest text-white/90 uppercase";
  const labelClassName = readableMode
    ? "text-[11px] font-semibold tracking-[0.04em] text-white/94"
    : "text-[10px] font-black uppercase tracking-widest text-white/90";
  const copyClassName = readableMode
    ? "text-[11px] text-white/74 leading-relaxed"
    : "text-[9px] text-white/40 font-black uppercase leading-relaxed";
  const copyMutedClassName = readableMode
    ? "text-[11px] text-white/70 leading-relaxed"
    : "text-[9px] text-white/30 font-black uppercase leading-relaxed";
  const helperTextClassName = readableMode
    ? "text-[11px] text-white/70 leading-relaxed sm:flex-1"
    : "text-[9px] text-white/55 font-black uppercase leading-relaxed sm:flex-1";
  const emptyStateClassName = readableMode
    ? "text-[11px] font-medium tracking-[0.03em] text-white/80 leading-relaxed"
    : "text-[9px] font-black uppercase tracking-[0.15em] text-white/80 leading-relaxed";
  const buttonTextClassName = readableMode
    ? "px-4 h-8 text-[10px] font-semibold uppercase tracking-[0.08em]"
    : "px-4 h-8 text-[10px] font-black uppercase tracking-widest";
  const sectionRadiusClassName = readableMode ? "rounded-xl" : "rounded-lg";
  const renderSectionLoadingOverlay = () => (
    <div
      className={`absolute inset-0 z-20 flex flex-col items-center justify-center ${sectionRadiusClassName} bg-black/38 backdrop-blur-[2px] animate-in fade-in duration-300`}
    >
      <Loader size="md" variant="primary" />
    </div>
  );
  const body = (
    <>
      <div
        className={`${compact ? "flex flex-col gap-3 border-b border-white/5 pb-4" : "flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-6"}`}
      >
        <div className="flex items-center gap-4">
          <div className="p-2.5 rounded-lg bg-black/40 border border-amber-500/20 shadow-lg shadow-amber-500/20 text-amber-500 flex items-center justify-center shrink-0">
            <HardDrive className="h-5 w-5" />
          </div>
          <div>
            <h3 className={headingClassName}>
              {storageTitle}
            </h3>
            <p className={subheadingClassName}>
              {storageSubtitle}
            </p>
          </div>
        </div>
        {(diskInfo || loading) && (
          <div className="relative">
            <div className="flex flex-col gap-2 sm:items-end">
              <div className="flex flex-wrap gap-2 sm:justify-end">
                <div className={statChipClassName}>
                  {diskInfo ? `Active: ${diskInfo.path}` : "Active: Detecting storage..."}
                </div>
                {(diskInfo?.engine_file_gb || loading) && (
                  <div className={accentChipClassName}>
                    {diskInfo?.engine_file_gb
                      ? `VHDX ${diskInfo.engine_file_gb} GB`
                      : "VHDX --"}
                  </div>
                )}
              </div>
              <div className={summaryClassName}>
                {diskInfo
                  ? `${diskInfo.free_gb} GB FREE / ${diskInfo.total_gb} GB TOTAL`
                  : "Checking available storage..."}
              </div>
            </div>
            {loading && renderSectionLoadingOverlay()}
          </div>
        )}
      </div>

      {isWindows && (
        <div className={sectionClassName}>
          <div className="space-y-0.5">
            <Label className={labelClassName}>
              Windows Engine
            </Label>
            <p className={copyClassName}>
              OpenFork uses its dedicated Ubuntu distro for Docker on Windows.
            </p>
          </div>

          {!compact && (
            <p className={copyMutedClassName}>
              Docker Desktop is no longer used by the Windows client.
            </p>
          )}
        </div>
      )}

      <div className={sectionClassName}>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <Label className={`${labelClassName} flex items-center gap-1.5`}>
              <Sparkles className="h-3 w-3" />
              Smart Cleanup
            </Label>
            <p className={copyMutedClassName}>
              The DGN client evicts least-recently-used Docker images
              automatically when free space drops below the disk-pressure
              thresholds. Limits adapt to your active job policy.
            </p>
          </div>
          {autoCompact && autoCompact.compactInProgress && (
            <span className="shrink-0 rounded-lg border border-amber-500/25 bg-amber-500/12 px-2.5 py-1 text-[10px] font-semibold tracking-[0.05em] text-amber-200">
              Compacting...
            </span>
          )}
        </div>
        {isWindows && autoCompact?.platformSupported && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <p className={helperTextClassName}>
              Auto-compact runs the VHDX shrink in idle windows after{" "}
              {Math.round((autoCompact.thresholdBytes || 0) / 1024 ** 3)} GB of
              images have been evicted. Currently {(autoCompact.freedBytes / 1024 ** 3).toFixed(1)} GB freed since last compaction.
            </p>
            <Button
              variant={autoCompact.enabled ? "primary" : "ghost"}
              size="sm"
              className={`${buttonTextClassName} sm:ml-auto`}
              onClick={() => handleAutoCompactToggle(!autoCompact.enabled)}
              disabled={loading || autoCompact.compactInProgress}
            >
              {autoCompact.enabled ? "Auto-compact: ON" : "Auto-compact: OFF"}
            </Button>
          </div>
        )}
      </div>

      {showManagedSections ? (
        <div
          className={`grid grid-cols-1 ${compact ? "xl:grid-cols-2 gap-3" : "md:grid-cols-2 gap-4"} items-start`}
        >
          <div className="relative">
            <div className={sectionClassName}>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <Label className={`${labelClassName} flex items-center gap-1.5`}>
                    <HardDrive className="h-3 w-3" />
                    Disk Compaction
                  </Label>
                  <p className={copyMutedClassName}>
                    Shrink the WSL disk file so Windows sees reclaimed space.
                  </p>
                </div>
                {(diskInfo?.engine_file_gb || loading) && (
                  <span
                    className={`shrink-0 ${readableMode ? "rounded-lg border border-amber-500/25 bg-amber-500/12 px-2.5 py-1 text-[10px] font-semibold tracking-[0.05em] text-amber-200" : "rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-amber-300"}`}
                  >
                    {diskInfo?.engine_file_gb ? `${diskInfo.engine_file_gb} GB` : "VHDX --"}
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <p className={helperTextClassName}>
                  Stop the engine first. Windows may ask for admin permission.
                </p>
                <Button
                  variant="primary"
                  size="sm"
                  className={`${buttonTextClassName} sm:ml-auto`}
                  onClick={handleReclaim}
                  disabled={loading || isReclaiming || isRelocating}
                >
                  {isReclaiming ? (
                    <Loader size="xs" className="mr-2" />
                  ) : (
                    <HardDrive className="h-3.5 w-3.5 mr-2" />
                  )}
                  {isReclaiming ? "Compacting..." : "Compact VHDX"}
                </Button>
              </div>
            </div>
            {loading && renderSectionLoadingOverlay()}
          </div>

          <div className="relative">
            <div className={sectionClassName}>
              <div className="space-y-0.5">
                <Label className={`${labelClassName} flex items-center gap-1.5`}>
                  <ArrowRightLeft className="h-3 w-3" />
                  Relocate Engine
                </Label>
                <p className={copyMutedClassName}>
                  Reinstall on another drive. Large images must be downloaded
                  again.
                </p>
              </div>

              <div className="flex gap-2 items-center">
                <div className="flex-1 min-w-0">
                  <Select
                    value={selectedDrive}
                    onValueChange={setSelectedDrive}
                    disabled={loading || isRelocating}
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
                  className={`${buttonTextClassName} flex-shrink-0`}
                  onClick={handleRelocate}
                  disabled={
                    loading ||
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
            {loading && renderSectionLoadingOverlay()}
          </div>
        </div>
      ) : (
        <div className={sectionClassName}>
          <p className={emptyStateClassName}>
            {isWindows
              ? "Install the OpenFork Ubuntu engine to unlock relocation and compaction controls."
              : isDockerDesktop
                ? "Docker Desktop manages its own virtual disk. OpenFork only exposes relocation and compaction controls for the dedicated WSL engine."
                : "This setup uses native Docker. OpenFork doesn't relocate or compact Docker storage from the app in this mode."}
          </p>
        </div>
      )}

      {error && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-md bg-destructive-foreground border border-destructive/20 flex items-center gap-2 text-destructive px-3 py-2.5"
        >
          <AlertTriangle className="h-3 w-3 flex-shrink-0" />
          <span className="text-[11px] text-white font-semibold leading-relaxed">
            {error}
          </span>
        </motion.div>
      )}
    </>
  );

  async function handleReclaim() {
    if (isReclaiming) return;
    setIsReclaiming(true);
    setError(null);
    try {
      const result = await window.electronAPI.reclaimDiskSpace();
      if (!result.success) {
        setError(result.message || result.error || "Reclaim failed");
      } else {
        // Tell the auto-compact manager the user just compacted manually so
        // the cumulative-freed counter resets and we don't trigger again soon.
        try {
          window.electronAPI.notifyManualCompactCompleted();
        } catch (e) {
          // Non-critical — older builds may not expose this API yet.
        }
      }
      await refreshData();
      await refreshAutoCompactStatus();
      await Promise.resolve(onSettingsChanged?.());
    } finally {
      setIsReclaiming(false);
    }
  }

  async function handleAutoCompactToggle(next: boolean) {
    try {
      await window.electronAPI.setAutoCompactEnabled(next);
      await refreshAutoCompactStatus();
    } catch (e) {
      console.error("Failed to set auto-compact enabled:", e);
    }
  }

  async function handleRelocate() {
    if (!selectedDrive || isRelocating) return;

    const confirm = window.confirm(
      `WARNING: This will reinstall the OpenFork engine on ${selectedDrive}: drive and remove the current engine images so they can be downloaded again.\n\nAre you sure you want to proceed?`,
    );
    if (!confirm) return;

    setIsRelocating(true);
    setError(null);
    try {
      const drivePath = `${selectedDrive}:\\OpenForkEngine\\wsl`;
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
  }

  if (embedded) {
    return <div className={compact ? "space-y-4" : "space-y-6"}>{body}</div>;
  }

  return (
    <Card className="card overflow-hidden border-white/5 bg-surface/20 backdrop-blur-md">
      <CardContent className={compact ? "p-4 space-y-4" : "p-6 space-y-6"}>
        {body}
      </CardContent>
    </Card>
  );
}
