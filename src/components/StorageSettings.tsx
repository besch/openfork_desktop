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
  Settings,
  RotateCcw,
  Save,
  Info,
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

  // Python advanced config overrides
  const [pythonConfig, setPythonConfig] = useState<{
    POLICY_MAX_CACHED_IMAGES: Record<string, number | null>;
    POLICY_IDLE_TIMEOUT_MINUTES: Record<string, number | null>;
    DISK_PRESSURE_HEALTHY_GB: number;
    DISK_PRESSURE_CRITICAL_GB: number;
    MINE_POLICY_PRESSURE_CAP: number;
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
      DISK_PRESSURE_HEALTHY_GB,
      DISK_PRESSURE_CRITICAL_GB,
      MINE_POLICY_PRESSURE_CAP,
      POLICY_MAX_CACHED_IMAGES,
      POLICY_IDLE_TIMEOUT_MINUTES,
    } = pythonConfig;

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
    if (MINE_POLICY_PRESSURE_CAP < 1) {
      setConfigError("Private Mode Job Limit must be at least 1.");
      return;
    }

    for (const [policy, val] of Object.entries(POLICY_MAX_CACHED_IMAGES)) {
      if (policy === "mine") continue;
      if (val === null || (typeof val === "number" && val < 1)) {
        setConfigError(`Max cached images for '${policy}' must be at least 1.`);
        return;
      }
    }

    for (const [policy, val] of Object.entries(POLICY_IDLE_TIMEOUT_MINUTES)) {
      if (policy === "mine") continue;
      if (val === null || (typeof val === "number" && val < 10)) {
        setConfigError(
          `Idle timeout for '${policy}' must be at least 10 minutes.`,
        );
        return;
      }
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
        "Reset all advanced client config values to their defaults? Changes take effect after restarting the DGN client.",
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
    loadPythonConfig();
    const cleanup = window.electronAPI.onAutoCompactStatus((status) => {
      setAutoCompact(status);
    });
    return cleanup;
  }, [refreshAutoCompactStatus, loadPythonConfig]);

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
  const sectionRadiusClassName = readableMode ? "rounded-2xl" : "rounded-xl";
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
        <div className="flex items-center gap-5">
          <div className="p-3 rounded-2xl bg-black/40 border border-amber-500/20 shadow-2xl shadow-amber-500/10 text-amber-500 flex items-center justify-center shrink-0">
            <HardDrive className="h-6 w-6" />
          </div>
          <div>
            <h3 className={headingClassName + " text-base"}>{storageTitle}</h3>
            <p className={subheadingClassName + " text-[13px]"}>{storageSubtitle}</p>
          </div>
        </div>
        {(diskInfo || loading) && (
          <div className="relative">
            <div className="flex flex-col gap-3 sm:items-end">
              <div className="flex flex-wrap gap-2.5 sm:justify-end">
                <div className={statChipClassName}>
                  {diskInfo
                    ? `Active: ${diskInfo.path}`
                    : "Active: Detecting storage..."}
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
              images have been evicted. Currently{" "}
              {(autoCompact.freedBytes / 1024 ** 3).toFixed(1)} GB freed since
              last compaction.
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
                  <Label
                    className={`${labelClassName} flex items-center gap-1.5`}
                  >
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
                    {diskInfo?.engine_file_gb
                      ? `${diskInfo.engine_file_gb} GB`
                      : "VHDX --"}
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

              <div className="flex gap-2 items-center">
                <div className="flex-1 min-w-0">
                  <Select
                    value={selectedDrive}
                    onValueChange={setSelectedDrive}
                    disabled={loading || isRelocating}
                  >
                    <SelectTrigger className="w-full h-9 text-[12px] bg-black/60 border-white/10 hover:bg-black/80 hover:border-white/20 transition-all rounded-xl shadow-inner">
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

      {/* Advanced Client Config */}
      <div className={sectionClassName}>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <Label className={`${labelClassName} flex items-center gap-1.5`}>
              <Settings className="h-3 w-3" />
              Advanced Client Config
            </Label>
            <p className={copyMutedClassName}>
              Tune disk-pressure thresholds, cache caps, and idle timeouts.
            </p>
          </div>
        </div>

        {pythonConfig && (
          <div className="space-y-3 pt-1">
            {/* Warning banner */}
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2">
              <Info className="h-3 w-3 text-amber-300 shrink-0" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-amber-300">
                Changes take effect after restarting the DGN client.
              </span>
            </div>

            {/* Scalar thresholds */}
              <div
                className={`grid grid-cols-1 ${compact ? "xl:grid-cols-3" : "sm:grid-cols-3"} gap-4`}
              >
                {[
                  {
                    label: "Minimum free disk space (GB)",
                    key: "DISK_PRESSURE_HEALTHY_GB",
                    min: 20,
                    max: 500,
                  },
                  {
                    label:
                      "Critical low disk space threshold (GB)",
                    key: "DISK_PRESSURE_CRITICAL_GB",
                    min: 5,
                    max: 500,
                  },
                  {
                    label: "Private mode job limit",
                    key: "MINE_POLICY_PRESSURE_CAP",
                    min: 1,
                    max: 50,
                  },
                ].map((field) => (
                  <div key={field.key} className="space-y-2">
                    <Label className={labelClassName}>{field.label}</Label>
                    <input
                      type="number"
                      min={field.min}
                      max={field.max}
                      value={
                        pythonConfig[
                          field.key as keyof typeof pythonConfig
                        ] as number
                      }
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        setPythonConfig((prev) =>
                          prev
                            ? {
                                ...prev,
                                [field.key]: isNaN(val) ? field.min : val,
                              }
                            : prev,
                        );
                      }}
                      className="w-full h-10 px-3 rounded-xl bg-black/60 border border-white/10 text-white text-[13px] font-semibold focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 transition-all shadow-inner"
                    />
                  </div>
                ))}
              </div>

            {/* Policy grids */}
            {[
              {
                title: "Max Cached Docker Images Per Policy",
                key: "POLICY_MAX_CACHED_IMAGES",
                mineLabel: "Unlimited",
                min: 1,
              },
              {
                title: "Idle Timeout (minutes)",
                key: "POLICY_IDLE_TIMEOUT_MINUTES",
                mineLabel: "Disabled",
                min: 10,
              },
            ].map((group) => (
              <div key={group.key} className="space-y-2">
                <Label className={labelClassName}>{group.title}</Label>
                <div
                  className={`grid grid-cols-2 ${compact ? "xl:grid-cols-5" : "sm:grid-cols-5"} gap-2`}
                >
                  {Object.entries(
                    pythonConfig[
                      group.key as
                        | "POLICY_MAX_CACHED_IMAGES"
                        | "POLICY_IDLE_TIMEOUT_MINUTES"
                    ],
                  ).map(([policy, val]) => {
                    const isMine = policy === "mine";
                    const isNull = val === null || val === 0;
                    return (
                      <div key={policy} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black uppercase tracking-widest text-white/70">
                            {policy}
                          </span>
                          {isMine && (
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={isNull}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setPythonConfig((prev) => {
                                    if (!prev) return prev;
                                    const next = {
                                      ...prev,
                                      [group.key]: {
                                        ...prev[
                                          group.key as
                                            | "POLICY_MAX_CACHED_IMAGES"
                                            | "POLICY_IDLE_TIMEOUT_MINUTES"
                                        ],
                                        [policy]: checked ? null : group.min,
                                      },
                                    };
                                    return next;
                                  });
                                }}
                                className="accent-amber-500 h-3 w-3"
                              />
                              <span className="text-[9px] font-bold uppercase tracking-widest text-white/50">
                                {group.mineLabel}
                              </span>
                            </label>
                          )}
                        </div>
                        {!isMine || !isNull ? (
                          <input
                            type="number"
                            min={group.min}
                            max={10080}
                            value={val ?? ""}
                            onChange={(e) => {
                              const num = parseInt(e.target.value, 10);
                              setPythonConfig((prev) => {
                                if (!prev) return prev;
                                return {
                                  ...prev,
                                  [group.key]: {
                                    ...prev[
                                      group.key as
                                        | "POLICY_MAX_CACHED_IMAGES"
                                        | "POLICY_IDLE_TIMEOUT_MINUTES"
                                    ],
                                    [policy]: isNaN(num) ? group.min : num,
                                  },
                                };
                              });
                            }}
                            className="w-full h-9 px-3 rounded-xl bg-black/60 border border-white/10 text-white text-[12px] font-semibold focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 transition-all shadow-inner"
                          />
                        ) : (
                          <div className="w-full h-9 px-3 rounded-xl bg-white/5 border border-white/5 text-white/30 text-[12px] font-semibold flex items-center">
                            —
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Actions */}
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
                      Config saved. Restart the DGN client to apply.
                    </span>
                  </motion.div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className={`${buttonTextClassName}`}
                  onClick={resetPythonConfig}
                  disabled={configLoading}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                  Reset to Default
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  className={`${buttonTextClassName}`}
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
