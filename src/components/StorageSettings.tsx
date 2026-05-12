import { useState, useEffect, useCallback, useMemo } from "react";
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
import { Slider } from "@/components/ui/slider";
import { motion } from "framer-motion";
import { Loader } from "@/components/ui/loader";
import type { AutoCompactStatus, DockerStatus, ReclaimStatus } from "@/types";
import {
  HardDrive,
  AlertTriangle,
  ArrowRightLeft,
  Sparkles,
  RotateCcw,
  Save,
  Info,
  Gauge,
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
    engine_file_sparse: boolean | null;
    wsl_version: string | null;
  } | null>(null);
  const [availableDrives, setAvailableDrives] = useState<
    { name: string; freeGB: number }[]
  >([]);
  const [imageCacheUsage, setImageCacheUsage] = useState<{
    total_bytes: number;
    total_gb: string;
    image_count: number;
    build_cache_bytes: number;
    build_cache_gb: string;
    build_cache_reclaimable_bytes: number;
    build_cache_reclaimable_gb: string;
    build_cache_count: number;
    docker_system_image_bytes: number;
    docker_system_image_gb: string;
    known: boolean;
    stale?: boolean;
    reason?: string;
  } | null>(null);
  const [selectedDrive, setSelectedDrive] = useState<string>("");
  const [isReclaiming, setIsReclaiming] = useState(false);
  const [reclaimStatus, setReclaimStatus] = useState<ReclaimStatus | null>(
    null,
  );
  const [isRelocating, setIsRelocating] = useState(false);
  const [dockerStatus, setDockerStatus] = useState<DockerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoCompact, setAutoCompact] = useState<AutoCompactStatus | null>(
    null,
  );

  // Python advanced config overrides
  const [pythonConfig, setPythonConfig] = useState<{
    POLICY_IDLE_TIMEOUT_MINUTES: Record<string, number | null>;
    DOCKER_IMAGE_CACHE_LIMIT_GB: number;
    DISK_PRESSURE_HEALTHY_GB: number;
    DISK_PRESSURE_CRITICAL_GB: number;
  } | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configSuccess, setConfigSuccess] = useState(false);

  const refreshAutoCompactStatus = useCallback(async () => {
    try {
      const status = await window.electronAPI.getAutoCompactStatus();
      setAutoCompact(status);
    } catch (e) {
      console.error("Failed to get auto-compact status:", e);
    }
  }, []);

  const loadPythonConfig = useCallback(async () => {
    try {
      setConfigLoading(true);
      const result = await window.electronAPI.getPythonConfig();
      if (result.success && result.data) {
        setPythonConfig(result.data);
      }
    } catch (e) {
      console.error("Failed to load python config:", e);
    } finally {
      setConfigLoading(false);
    }
  }, []);

  const validateAndSavePythonConfig = async () => {
    if (!pythonConfig) return;
    setConfigError(null);
    setConfigSuccess(false);

    const {
      DOCKER_IMAGE_CACHE_LIMIT_GB,
      DISK_PRESSURE_HEALTHY_GB,
      DISK_PRESSURE_CRITICAL_GB,
    } = pythonConfig;

    if (
      !Number.isFinite(DOCKER_IMAGE_CACHE_LIMIT_GB) ||
      DOCKER_IMAGE_CACHE_LIMIT_GB < 50
    ) {
      setConfigError("Docker image storage limit must be at least 50 GB.");
      return;
    }
    if (DISK_PRESSURE_CRITICAL_GB >= DISK_PRESSURE_HEALTHY_GB) {
      setConfigError(
        "Critical Low Space must be lower than Minimum Free Space.",
      );
      return;
    }
    if (DISK_PRESSURE_HEALTHY_GB < 20) {
      setConfigError("Minimum Free Space must be at least 20 GB.");
      return;
    }
    if (DISK_PRESSURE_CRITICAL_GB < 5) {
      setConfigError("Critical Low Space must be at least 5 GB.");
      return;
    }

    try {
      const result = await window.electronAPI.setPythonConfig(pythonConfig);
      if (result.success) {
        setConfigSuccess(true);
        setTimeout(() => setConfigSuccess(false), 4000);
      } else {
        setConfigError(result.error || "Failed to save config.");
      }
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : "Failed to save config.");
    }
  };

  const resetPythonConfig = async () => {
    if (
      !window.confirm(
        "Reset Docker storage settings to their defaults? Changes take effect after restarting the DGN client.",
      )
    ) {
      return;
    }
    setConfigError(null);
    setConfigSuccess(false);
    try {
      const result = await window.electronAPI.resetPythonConfig();
      if (result.success) {
        await loadPythonConfig();
        setConfigSuccess(true);
        setTimeout(() => setConfigSuccess(false), 4000);
      } else {
        setConfigError(result.error || "Failed to reset config.");
      }
    } catch (e) {
      setConfigError(
        e instanceof Error ? e.message : "Failed to reset config.",
      );
    }
  };

  const refreshData = useCallback(async () => {
    setLoading(true);
    try {
      const [status, info, drives, usage] = await Promise.all([
        window.electronAPI.checkDocker(),
        window.electronAPI.getDiskSpace(),
        window.electronAPI.getAvailableDrives(),
        window.electronAPI.getDockerImageCacheUsage(),
      ]);
      setDockerStatus(status);

      if (info.success) setDiskInfo(info.data);

      setAvailableDrives(drives);

      if (usage.success && usage.data) {
        setImageCacheUsage(usage.data);
      }

      if (status?.installDrive) {
        setSelectedDrive(status.installDrive);
      }
    } catch (e) {
      console.error("Failed to refresh storage data:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    window.electronAPI.getProcessInfo().then((info) => {
      setPlatform(info.platform as "win32" | "linux" | "darwin");
    });
    refreshData();
    refreshAutoCompactStatus();
    loadPythonConfig();
    window.electronAPI
      .getReclaimStatus()
      .then(setReclaimStatus)
      .catch((e) => console.error("Failed to get reclaim status:", e));
    const cleanupAutoCompact = window.electronAPI.onAutoCompactStatus(
      (status) => {
        setAutoCompact(status);
      },
    );
    const cleanupReclaim = window.electronAPI.onReclaimStatus((status) => {
      setReclaimStatus(status);
      if (!status.inProgress && status.phase === "completed") {
        refreshData();
        refreshAutoCompactStatus();
        Promise.resolve(onSettingsChanged?.()).catch((e) =>
          console.error("Failed to refresh after compaction:", e),
        );
      }
      if (!status.inProgress && status.phase === "failed" && status.error) {
        setError(status.error);
      }
    });
    return () => {
      cleanupAutoCompact();
      cleanupReclaim();
    };
  }, [
    refreshAutoCompactStatus,
    loadPythonConfig,
    refreshData,
    onSettingsChanged,
  ]);

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
    ? "rounded-2xl border border-white/10 bg-white/[0.02] backdrop-blur-md p-5 space-y-4 shadow-2xl shadow-black/20 transition-all duration-300 hover:bg-white/[0.04] hover:border-white/20"
    : "rounded-xl border border-white/10 bg-white/5 p-6 space-y-4 shadow-xl";
  const headingClassName = readableMode
    ? "text-sm font-bold tracking-tight text-white/90"
    : "text-xs font-black uppercase tracking-[0.2em] text-white/90";
  const subheadingClassName = readableMode
    ? "text-[12px] text-white/50 leading-relaxed mt-1"
    : "text-[10px] text-white/30 font-black uppercase tracking-[0.1em] mt-0.5";
  const statChipClassName = readableMode
    ? "max-w-full truncate text-[11px] text-white/70 bg-white/[0.03] font-medium tracking-tight px-3 py-1.5 rounded-xl border border-white/10 transition-colors hover:bg-white/[0.06]"
    : "max-w-full truncate text-[9px] text-white/80 bg-white/5 font-black uppercase tracking-widest px-3 py-1.5 rounded-lg border border-white/5";
  const accentChipClassName = readableMode
    ? "text-[11px] text-amber-400 bg-amber-500/10 font-semibold tracking-tight px-3 py-1.5 rounded-xl border border-amber-500/20 shadow-lg shadow-amber-500/5"
    : "text-[9px] text-amber-300/90 bg-amber-500/10 font-black uppercase tracking-widest px-3 py-1.5 rounded-lg border border-amber-500/20";
  const summaryClassName = readableMode
    ? "text-[12px] font-semibold tracking-tight text-white/80"
    : "text-[10px] font-black tracking-widest text-white/90 uppercase";
  const labelClassName = readableMode
    ? "text-[12px] font-bold tracking-tight text-white/90"
    : "text-[10px] font-black uppercase tracking-widest text-white/90";
  const copyClassName = readableMode
    ? "text-[12px] text-white/60 leading-relaxed"
    : "text-[9px] text-white/40 font-black uppercase leading-relaxed";
  const copyMutedClassName = readableMode
    ? "text-[12px] text-white/50 leading-relaxed"
    : "text-[9px] text-white/30 font-black uppercase leading-relaxed";
  const helperTextClassName = readableMode
    ? "text-[12px] text-white/50 leading-relaxed sm:flex-1"
    : "text-[9px] text-white/55 font-black uppercase leading-relaxed sm:flex-1";
  const emptyStateClassName = readableMode
    ? "text-[12px] font-medium tracking-tight text-white/70 leading-relaxed"
    : "text-[9px] font-black uppercase tracking-[0.15em] text-white/80 leading-relaxed";
  const buttonTextClassName = readableMode
    ? "px-5 h-9 text-[11px] font-bold tracking-tight"
    : "px-4 h-8 text-[10px] font-black uppercase tracking-widest";
  const buttonLoaderClassName = "flex-row gap-0 p-0";
  const sectionRadiusClassName = readableMode ? "rounded-2xl" : "rounded-xl";
  const cacheLimitGb = pythonConfig?.DOCKER_IMAGE_CACHE_LIMIT_GB ?? 250;
  const totalDiskGb = Number.parseFloat(diskInfo?.total_gb || "0");
  const cacheSliderMaxGb = useMemo(() => {
    if (!Number.isFinite(totalDiskGb) || totalDiskGb <= 0) {
      return Math.max(1000, cacheLimitGb);
    }
    return Math.max(
      120,
      cacheLimitGb,
      Math.min(2000, Math.floor(totalDiskGb * 0.85)),
    );
  }, [cacheLimitGb, totalDiskGb]);
  const cacheSliderValue = Math.max(50, cacheLimitGb);
  const imageCacheUsedGb = Number.parseFloat(imageCacheUsage?.total_gb || "0");
  const imageUsageKnown = imageCacheUsage?.known !== false;
  const imageUsageStale = imageCacheUsage?.stale === true;
  const cacheUsedPercent =
    cacheLimitGb > 0 && (imageUsageKnown || imageUsageStale)
      ? Math.min(100, Math.round((imageCacheUsedGb / cacheLimitGb) * 100))
      : 0;
  const imageUsageDisplay =
    imageCacheUsage && (imageUsageKnown || imageUsageStale)
      ? `${imageCacheUsage.total_gb} GB`
      : imageCacheUsage
        ? "Unknown"
        : "--";
  const imageUsageQualifier = imageUsageStale
    ? "Last known"
    : imageUsageKnown
      ? "Current"
      : "Unavailable";
  const reclaimInProgress = !!reclaimStatus?.inProgress;
  const reclaimSettling = reclaimStatus?.settling === true;
  const reclaimBusy = isReclaiming || reclaimInProgress || reclaimSettling;
  const autoCompactInProgress = autoCompact?.compactInProgress === true;
  const reclaimBusyLabel = reclaimStatus?.phase?.startsWith("recovering")
    ? "Reconnecting…"
    : reclaimStatus?.phase === "waiting_for_idle"
      ? reclaimStatus.waitingForActiveDownload
        ? "Waiting for download…"
        : reclaimStatus.waitingForActiveJob
          ? "Waiting for job…"
          : "Waiting for idle…"
      : reclaimStatus?.phase === "stopping_client"
        ? "Pausing engine…"
        : reclaimSettling
          ? "Reconnecting…"
          : reclaimStatus?.phase === "pruning_cache"
            ? "Cleaning cache…"
            : reclaimBusy
              ? "Reclaiming…"
              : "Reclaim Space";
  const autoCompactThresholdGb = Math.round(
    (autoCompact?.thresholdBytes || 0) / 1024 ** 3,
  );
  const autoCompactHostGateGb = Math.round(
    (autoCompact?.hostFreeGateBytes || 0) / 1024 ** 3,
  );
  const autoCompactHostFreeGb =
    typeof autoCompact?.hostFreeBytes === "number"
      ? (autoCompact.hostFreeBytes / 1024 ** 3).toFixed(1)
      : null;
  const cachePresetOptions = [
    {
      label: "Minimal",
      value: 120,
      description: "Saves disk, redownloads more often.",
    },
    {
      label: "Recommended",
      value: 250,
      description: "Fits one large video image comfortably.",
    },
    {
      label: "Generous",
      value: 400,
      description: "Keeps more models ready between jobs.",
    },
  ];
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
        className={`${compact ? "flex flex-col gap-4 border-b border-white/5 pb-6" : "flex flex-col sm:flex-row sm:items-center justify-between gap-6 border-b border-white/5 pb-8"}`}
      >
        <div className="flex min-w-0 items-center gap-4 sm:gap-5">
          <div className="p-3 rounded-2xl bg-black/40 border border-amber-500/20 shadow-2xl shadow-amber-500/10 text-amber-500 flex items-center justify-center shrink-0">
            <HardDrive className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h3 className={headingClassName + " truncate text-base"}>
              {storageTitle}
            </h3>
            <p className={subheadingClassName + " truncate text-[13px]"}>
              {storageSubtitle}
            </p>
          </div>
        </div>
        {(diskInfo || loading) && (
          <div className="relative">
            <div className="flex flex-col gap-3 sm:items-end">
              <div className="flex flex-wrap gap-2.5 sm:justify-end">
                <div className={statChipClassName}>
                  {diskInfo
                    ? `Active: ${diskInfo.path}`
                    : "Active: Detecting storage…"}
                </div>
                {(diskInfo?.engine_file_gb || loading) && (
                  <div className={accentChipClassName}>
                    {diskInfo?.engine_file_gb
                      ? `Openfork VHDX ${diskInfo.engine_file_gb} GB`
                      : "Openfork VHDX --"}
                  </div>
                )}
                {diskInfo?.engine_file_sparse !== null &&
                  diskInfo?.engine_file_sparse !== undefined && (
                    <div className={statChipClassName}>
                      {diskInfo.engine_file_sparse
                        ? "Sparse VHD enabled"
                        : "Sparse VHD not detected"}
                    </div>
                  )}
                {diskInfo?.wsl_version && (
                  <div className={statChipClassName}>
                    {diskInfo.wsl_version}
                  </div>
                )}
              </div>
              <div className={summaryClassName}>
                {diskInfo
                  ? `${diskInfo.free_gb} GB FREE / ${diskInfo.total_gb} GB TOTAL`
                  : "Checking available storage…"}
              </div>
            </div>
            {loading && renderSectionLoadingOverlay()}
          </div>
        )}
      </div>

      {isWindows && (
        <div className={sectionClassName}>
          <div className="space-y-0.5">
            <Label className={labelClassName}>Windows Engine</Label>
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-0.5">
            <Label className={`${labelClassName} flex items-center gap-1.5`}>
              <Sparkles className="h-3 w-3" />
              Smart Cleanup
            </Label>
            <p className={copyMutedClassName}>
              The DGN client evicts least-recently-used Docker images
              automatically when free space drops below the disk-pressure
              thresholds or when cached OpenFork images exceed your storage
              limit.
            </p>
          </div>
          {autoCompact && autoCompact.compactInProgress && (
            <span className="shrink-0 rounded-lg border border-amber-500/25 bg-amber-500/12 px-2.5 py-1 text-[10px] font-semibold tracking-[0.05em] text-amber-200">
              Compacting…
            </span>
          )}
        </div>
        {isWindows && autoCompact?.platformSupported && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <p className={helperTextClassName}>
              Auto-compact runs after {autoCompactThresholdGb} GB of images have
              been evicted and the WSL drive has less than{" "}
              {autoCompactHostGateGb} GB free. Storage-limit cleanup can also
              compact before the next queued job, and OpenFork can compact a
              bloated Ubuntu disk when image usage is low. Currently{" "}
              {(autoCompact.freedBytes / 1024 ** 3).toFixed(1)} GB freed since
              last compaction
              {autoCompactHostFreeGb
                ? `, with ${autoCompactHostFreeGb} GB free on the host drive`
                : ""}
              .
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
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-0.5">
                  <Label
                    className={`${labelClassName} flex items-center gap-1.5`}
                  >
                    <HardDrive className="h-3 w-3" />
                    Disk Compaction
                  </Label>
                  <p className={copyMutedClassName}>
                    Reclaim space while keeping remaining images cached.
                  </p>
                </div>
                {(diskInfo?.engine_file_gb || loading) && (
                  <span
                    className={`shrink-0 ${readableMode ? "rounded-lg border border-amber-500/25 bg-amber-500/12 px-2.5 py-1 text-[10px] font-semibold tracking-[0.05em] text-amber-200" : "rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-amber-300"}`}
                  >
                    {diskInfo?.engine_file_gb
                      ? `${diskInfo.engine_file_gb} GB`
                      : "VHDX --"}
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <p className={helperTextClassName}>
                  New jobs and image downloads pause first. Current work is
                  allowed to finish before compaction starts.
                </p>
                <Button
                  variant="primary"
                  size="sm"
                  className={`${buttonTextClassName} h-auto min-h-9 whitespace-normal leading-tight sm:ml-auto`}
                  onClick={handleReclaim}
                  disabled={
                    loading ||
                    reclaimBusy ||
                    isRelocating ||
                    autoCompactInProgress
                  }
                >
                  {reclaimBusy ? (
                    <Loader
                      size="xs"
                      className={`${buttonLoaderClassName} mr-2`}
                    />
                  ) : (
                    <HardDrive className="h-3.5 w-3.5 mr-2" />
                  )}
                  {reclaimBusyLabel}
                </Button>
                {reclaimInProgress && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`${buttonTextClassName} h-auto min-h-9 whitespace-normal leading-tight`}
                    onClick={handleCancelReclaim}
                    disabled={reclaimStatus?.phase === "cancelling"}
                  >
                    {reclaimStatus?.phase === "cancelling"
                      ? "Cancelling…"
                      : "Cancel"}
                  </Button>
                )}
              </div>
              {diskInfo?.engine_file_sparse === false && (
                <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] font-semibold leading-relaxed text-amber-200">
                  This OpenFork VHDX is not marked sparse, so Windows may need
                  the slower DiskPart compaction path after reclaiming space.
                </p>
              )}
              {reclaimStatus?.phase === "completed" && (
                <p className="text-[11px] font-semibold text-emerald-300">
                  Reclaimed disk space successfully.
                </p>
              )}
            </div>
            {loading && renderSectionLoadingOverlay()}
          </div>

          <div className="relative">
            <div className={sectionClassName}>
              <div className="space-y-0.5">
                <Label
                  className={`${labelClassName} flex items-center gap-1.5`}
                >
                  <ArrowRightLeft className="h-3 w-3" />
                  Relocate Engine
                </Label>
                <p className={copyMutedClassName}>
                  Reinstall on another drive. Large images must be downloaded
                  again.
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="flex-1 min-w-0">
                  <Select
                    value={selectedDrive}
                    onValueChange={setSelectedDrive}
                    disabled={loading || isRelocating}
                  >
                    <SelectTrigger className="w-full h-9 text-[12px] bg-black/60 border-white/10 hover:bg-black/80 hover:border-white/20 transition-colors rounded-xl shadow-inner">
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
                            <div className="flex min-w-0 items-center justify-between w-full gap-4">
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
                    reclaimBusy
                  }
                >
                  {isRelocating ? (
                    <Loader size="xs" className={buttonLoaderClassName} />
                  ) : (
                    "Move"
                  )}
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

      {/* Docker Image Storage Limit */}
      <div className={sectionClassName}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-0.5">
            <Label className={`${labelClassName} flex items-center gap-1.5`}>
              <Gauge className="h-3 w-3" />
              Docker Image Storage Limit
            </Label>
            <p className={copyMutedClassName}>
              OpenFork downloads Docker images for local AI models. These can be
              tens or hundreds of GB because they include model runtimes and
              dependencies. Set how much disk space OpenFork may use for those
              images.
            </p>
          </div>
        </div>

        {pythonConfig && (
          <div className="space-y-4 pt-1">
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2">
              <Info className="h-3 w-3 text-amber-300 shrink-0" />
              <span className="text-[11px] font-semibold leading-relaxed text-amber-200">
                When the limit is crossed, OpenFork removes least-used images.
                On Windows, the Ubuntu disk is compacted later when the client
                is idle and compaction is safe. The storage limit updates the
                current cache enforcement updates immediately; newly eligible
                large models and free-space thresholds apply after restart.
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-white/40">
                  Limit
                </p>
                <p className="mt-1 text-xl font-black text-white tabular-nums">
                  {cacheLimitGb} GB
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-white/40">
                  Used by Images
                </p>
                <p className="mt-1 text-xl font-black text-white tabular-nums">
                  {imageUsageDisplay}
                </p>
                {imageCacheUsage && (
                  <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-white/35">
                    {imageUsageQualifier}
                  </p>
                )}
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-white/40">
                  Image Count
                </p>
                <p className="mt-1 text-xl font-black text-white tabular-nums">
                  {imageCacheUsage && (imageUsageKnown || imageUsageStale)
                    ? imageCacheUsage.image_count
                    : "--"}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-white/40">
                  Build Cache
                </p>
                <p className="mt-1 text-xl font-black text-white tabular-nums">
                  {imageCacheUsage && (imageUsageKnown || imageUsageStale)
                    ? `${imageCacheUsage.build_cache_reclaimable_gb} GB`
                    : "--"}
                </p>
              </div>
            </div>

            {imageCacheUsage &&
              imageCacheUsage.build_cache_reclaimable_bytes > 1024 ** 3 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2">
                  <Info className="h-3 w-3 text-amber-300 shrink-0" />
                  <span className="text-[11px] font-semibold leading-relaxed text-amber-200">
                    Docker reports {imageCacheUsage.build_cache_reclaimable_gb}{" "}
                    GB of reclaimable build cache. Reclaim Space clears this
                    cache before compacting the Ubuntu disk.
                  </span>
                </div>
              )}

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Label className={labelClassName}>Storage Budget</Label>
                <span className="text-[10px] font-black uppercase tracking-widest text-white/45">
                  {imageUsageKnown || imageUsageStale
                    ? `${cacheUsedPercent}% used`
                    : "Usage unknown"}
                </span>
              </div>
              <Slider
                min={50}
                max={cacheSliderMaxGb}
                step={10}
                value={[cacheSliderValue]}
                onValueChange={(value) => {
                  const nextValue = value[0] ?? cacheLimitGb;
                  setPythonConfig((prev) =>
                    prev
                      ? {
                          ...prev,
                          DOCKER_IMAGE_CACHE_LIMIT_GB: nextValue,
                        }
                      : prev,
                  );
                }}
                className="py-2"
              />
              <div className="h-2 overflow-hidden rounded-full bg-white/5">
                <div
                  className={`h-full rounded-full transition-all ${
                    imageUsageStale ? "bg-amber-300/60" : "bg-amber-500"
                  }`}
                  style={{
                    width: `${cacheUsedPercent}%`,
                    minWidth:
                      cacheUsedPercent > 0 && cacheUsedPercent < 2
                        ? "0.5rem"
                        : undefined,
                  }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-white/35">
                <span>50 GB</span>
                <span>{cacheSliderMaxGb} GB</span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {cachePresetOptions.map((preset) => {
                const value = Math.min(preset.value, cacheSliderMaxGb);
                const selected = cacheLimitGb === value;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() =>
                      setPythonConfig((prev) =>
                        prev
                          ? {
                              ...prev,
                              DOCKER_IMAGE_CACHE_LIMIT_GB: value,
                            }
                          : prev,
                      )
                    }
                    className={`rounded-xl border px-3 py-3 text-left transition-[background-color,border-color,color,box-shadow] ${
                      selected
                        ? "border-amber-500/50 bg-amber-500/15 text-white"
                        : "border-white/10 bg-black/25 text-white/70 hover:border-white/20 hover:bg-white/[0.04]"
                    }`}
                  >
                    <span className="block text-[11px] font-black uppercase tracking-widest">
                      {preset.label} - {value} GB
                    </span>
                    <span className="mt-1 block text-[11px] leading-relaxed text-white/45">
                      {preset.description}
                    </span>
                  </button>
                );
              })}
            </div>

            <div
              className={`grid grid-cols-1 ${compact ? "xl:grid-cols-2" : "sm:grid-cols-2"} gap-4`}
            >
              {[
                {
                  label: "Minimum free disk space (GB)",
                  key: "DISK_PRESSURE_HEALTHY_GB",
                  min: 20,
                  max: 500,
                },
                {
                  label: "Critical low disk space threshold (GB)",
                  key: "DISK_PRESSURE_CRITICAL_GB",
                  min: 5,
                  max: 500,
                },
              ].map((field) => (
                <div key={field.key} className="space-y-2">
                  <Label className={labelClassName}>{field.label}</Label>
                  <input
                    type="number"
                    name={field.key}
                    aria-label={field.label}
                    inputMode="numeric"
                    min={field.min}
                    max={field.max}
                    value={
                      pythonConfig[
                        field.key as
                          | "DISK_PRESSURE_HEALTHY_GB"
                          | "DISK_PRESSURE_CRITICAL_GB"
                      ]
                    }
                    onChange={(e) => {
                      const val = Number.parseInt(e.target.value, 10);
                      setPythonConfig((prev) =>
                        prev
                          ? {
                              ...prev,
                              [field.key]: Number.isNaN(val) ? field.min : val,
                            }
                          : prev,
                      );
                    }}
                    className="w-full h-10 px-3 rounded-xl bg-black/60 border border-white/10 text-white text-[13px] font-semibold focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 transition-[background-color,border-color,box-shadow] shadow-inner"
                  />
                </div>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-1">
              <div className="flex-1 min-w-0">
                {configError && (
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-2 text-destructive"
                  >
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">
                      {configError}
                    </span>
                  </motion.div>
                )}
                {configSuccess && (
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-2 text-emerald-400"
                  >
                    <Sparkles className="h-3 w-3 shrink-0" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">
                      Storage settings saved. Cache limit sent to the running
                      client.
                    </span>
                  </motion.div>
                )}
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                <Button
                  variant="ghost"
                  size="sm"
                  className={`${buttonTextClassName} h-auto min-h-8 whitespace-normal`}
                  onClick={resetPythonConfig}
                  disabled={configLoading}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                  Reset to Default
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  className={`${buttonTextClassName} h-auto min-h-8 whitespace-normal`}
                  onClick={validateAndSavePythonConfig}
                  disabled={configLoading}
                >
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                  Save Config
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {error && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-md bg-destructive-foreground border border-destructive/20 flex items-start gap-2 text-destructive px-3 py-2.5"
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
    if (isReclaiming || reclaimInProgress) return;
    setIsReclaiming(true);
    setError(null);
    try {
      const result = await window.electronAPI.reclaimDiskSpace();
      if (!result.success) {
        setError(result.message || result.error || "Reclaim failed");
      } else {
        setReclaimStatus(result.status ?? null);
      }
    } finally {
      setIsReclaiming(false);
    }
  }

  async function handleCancelReclaim() {
    setError(null);
    const result = await window.electronAPI.cancelReclaimDiskSpace();
    if (!result.success) {
      setError(result.error || "Could not cancel compaction.");
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
