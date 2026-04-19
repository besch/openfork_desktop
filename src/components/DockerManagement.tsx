import { useState, useEffect, useCallback, memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Loader } from "@/components/ui/loader";
import {
  Trash2,
  X,
  RefreshCw,
  HardDrive,
  Container,
  Download,
  AlertTriangle,
} from "lucide-react";
import { motion } from "framer-motion";
import { useClientStore } from "@/store";
import type { DockerImage, DockerContainer, DockerStatus } from "@/types";

interface ConfirmDialogState {
  isOpen: boolean;
  title: string;
  description: string;
  onConfirm: () => void;
}

export const DockerManagement = memo(() => {
  const [platform, setPlatform] = useState<"win32" | "linux" | "darwin">(
    "win32",
  );
  const [images, setImages] = useState<DockerImage[]>([]);
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    isOpen: false,
    title: "",
    description: "",
    onConfirm: () => {},
  });
  const [diskSpaceError, setDiskSpaceError] = useState<{
    image_name: string;
    required_gb: number;
    available_gb: number;
    message: string;
  } | null>(null);
  const [diskSpace, setDiskSpace] = useState<{
    total_gb: string;
    used_gb: string;
    free_gb: string;
    path: string;
  } | null>(null);
  const [showCompactionBanner, setShowCompactionBanner] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [compactionResult, setCompactionResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [engineSwitchNotice, setEngineSwitchNotice] = useState<{
    from: string;
    to: string;
  } | null>(null);

  const dockerPullProgress = useClientStore(
    (state) => state.dockerPullProgress,
  );
  const status = useClientStore((state) => state.status);

  const describeDockerState = useCallback((nextStatus: DockerStatus) => {
    if (nextStatus.error === "DOCKER_WINDOWS_CONTAINERS") {
      return "Docker Desktop is no longer supported for Windows workflows. Install or repair the OpenFork Ubuntu engine instead.";
    }

    if (nextStatus.error === "DOCKER_PERMISSION_DENIED") {
      return "Docker is installed, but your user cannot access the Docker socket yet. Log out and back in, then retry.";
    }

    if (nextStatus.error === "DOCKER_API_UNREACHABLE") {
      return "OpenFork detected the Docker daemon inside its Ubuntu distro, but the API is not reachable from Windows yet.";
    }

    if (nextStatus.error === "WSL_DISTRO_MISSING") {
      return "The OpenFork Ubuntu distro is missing. Reinstall the local engine to restore Docker access.";
    }

    return "Docker is not ready right now.";
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextDockerStatus = await window.electronAPI.checkDocker();

      if (!nextDockerStatus.running) {
        setImages([]);
        setContainers([]);
        setError(describeDockerState(nextDockerStatus));
        const diskResult = await window.electronAPI.getDiskSpace();
        if (diskResult.success) setDiskSpace(diskResult.data);
        return;
      }

      const [imagesResult, containersResult, diskResult] = await Promise.all([
        window.electronAPI.listDockerImages(),
        window.electronAPI.listDockerContainers(),
        window.electronAPI.getDiskSpace(),
      ]);

      if (imagesResult.success && imagesResult.data) {
        setImages(imagesResult.data);
      } else {
        setError(imagesResult.error || "Failed to fetch images");
      }

      if (containersResult.success && containersResult.data) {
        setContainers(containersResult.data);
      }

      if (diskResult.success) {
        setDiskSpace(diskResult.data);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch Docker data",
      );
    } finally {
      setLoading(false);
    }
  }, [describeDockerState]);

  useEffect(() => {
    window.electronAPI.getProcessInfo().then((info) => {
      setPlatform(info.platform as "win32" | "linux" | "darwin");
    });
    fetchData();
  }, [fetchData]);

  // Auto-refresh when download completes
  useEffect(() => {
    if (dockerPullProgress === null && status === "running") {
      fetchData();
    }
  }, [dockerPullProgress, status, fetchData]);

  // Handle disk space errors
  useEffect(() => {
    const cleanup = window.electronAPI.onDiskSpaceError((data) => {
      setDiskSpaceError(data);
    });
    return cleanup;
  }, []);

  // Listen for WSL VHDX compaction suggestions emitted after image deletion
  useEffect(() => {
    const cleanup = window.electronAPI.onCompactionSuggested(() => {
      setShowCompactionBanner(true);
      setCompactionResult(null);
    });
    return cleanup;
  }, []);

  // Auto-refresh when the active Docker engine changes.
  useEffect(() => {
    const cleanup = window.electronAPI.onEngineSwitch((data) => {
      setEngineSwitchNotice(data);
      fetchData();
    });
    return cleanup;
  }, [fetchData]);

  // Subscribe to app-wide Docker monitoring updates.
  useEffect(() => {
    const cleanupContainers = window.electronAPI.onDockerContainersUpdate(
      (data) => {
        setContainers(data);
      },
    );

    const cleanupImages = window.electronAPI.onDockerImagesUpdate((data) => {
      setImages(data);
    });

    return () => {
      cleanupContainers();
      cleanupImages();
    };
  }, []);

  const showConfirmDialog = (
    title: string,
    description: string,
    onConfirm: () => void,
  ) => {
    setConfirmDialog({
      isOpen: true,
      title,
      description,
      onConfirm: () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        onConfirm();
      },
    });
  };

  const handleRemoveImage = async (imageId: string, imageName: string) => {
    showConfirmDialog(
      "Remove Docker Image",
      `Are you sure you want to remove "${imageName}"?`,
      async () => {
        setActionLoading(`remove-${imageId}`);
        try {
          const result = await window.electronAPI.removeDockerImage(imageId);
          if (result.success) {
            await fetchData();
          } else {
            setError(result.error || "Failed to remove image");
          }
        } finally {
          setActionLoading(null);
        }
      },
    );
  };

  const handleStopContainer = async (
    containerId: string,
    containerName: string,
  ) => {
    showConfirmDialog(
      "Stop Container",
      `Are you sure you want to stop and remove container "${containerName}"?`,
      async () => {
        setActionLoading(`stop-${containerId}`);
        try {
          const result = await window.electronAPI.stopContainer(containerId);
          if (result.success) {
            await fetchData();
          } else {
            setError(result.error || "Failed to stop container");
          }
        } finally {
          setActionLoading(null);
        }
      },
    );
  };

  const handleCancelDownload = () => {
    const serviceType = dockerPullProgress?.service_type;

    if (!serviceType) {
      // Fallback to legacy behavior if service_type is missing
      showConfirmDialog(
        "Cancel Download",
        "Are you sure you want to cancel the Docker image download? This will stop the client.",
        async () => {
          window.electronAPI.stopClient();
        },
      );
      return;
    }

    showConfirmDialog(
      "Cancel Download",
      "Are you sure you want to cancel the Docker image download?",
      async () => {
        window.electronAPI.cancelDownload(serviceType);
      },
    );
  };

  const handleRemoveAllImages = () => {
    showConfirmDialog(
      "Remove All Docker Images",
      `Are you sure you want to remove ALL ${images.length} OpenFork Docker images? This is a destructive action that will require re-downloading large images (10-20GB+) if needed again.`,
      async () => {
        setActionLoading("remove-all");
        try {
          const result = await window.electronAPI.removeAllDockerImages();
          if (result.success) {
            await fetchData();
          } else {
            setError(result.error || "Failed to remove images");
          }
        } finally {
          setActionLoading(null);
        }
      },
    );
  };

  // const handlePurgeOpenFork = () => {
  //   showConfirmDialog(
  //     "Purge All Data",
  //     "This will surgically remove ALL OpenFork containers, images, and associated volumes. It is the most reliable way to recover space without affecting your other Docker projects. Large images will need re-downloading if needed again. Proceed?",
  //     async () => {
  //       setActionLoading("purge-openfork");
  //       try {
  //         const result = await window.electronAPI.purgeOpenForkData();
  //         if (result.success) {
  //           await fetchData();
  //           // Refresh disk space after purge
  //           const diskResult = await window.electronAPI.getDiskSpace();
  //           if (diskResult.success) setDiskSpace(diskResult.data);
  //         } else {
  //           setError(result.error || "Failed to purge OpenFork data");
  //         }
  //       } finally {
  //         setActionLoading(null);
  //       }
  //     },
  //   );
  // };

  const isDownloading =
    dockerPullProgress !== null &&
    (status === "starting" || status === "running");
  const engineLabel = platform === "linux" ? "Linux Docker" : "OpenFork Ubuntu";

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <ConfirmationDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={confirmDialog.onConfirm}
        title={confirmDialog.title}
        description={confirmDialog.description}
        confirmButtonText="Confirm"
        cancelButtonText="Cancel"
      />

      {engineSwitchNotice && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-blue-500/10 border border-blue-500/30 text-white rounded-lg p-4 flex items-center justify-between shadow-lg"
        >
          <div className="flex items-center gap-3">
            <RefreshCw className="h-4 w-4 text-blue-400 shrink-0" />
            <span className="text-xs font-bold uppercase tracking-widest text-blue-300">
              Docker engine auto-switched:{" "}
              <span className="text-white">
                {engineSwitchNotice.from === "wsl"
                  ? "OpenFork Ubuntu"
                  : "Unavailable"}
              </span>{" "}
              →{" "}
              <span className="text-white">
                {engineSwitchNotice.to === "wsl"
                  ? "OpenFork Ubuntu"
                  : "Unavailable"}
              </span>
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEngineSwitchNotice(null)}
            className="text-blue-300 hover:bg-blue-500/20 h-8 w-8 p-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </motion.div>
      )}

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="bg-destructive-foreground text-white rounded-lg p-4 flex items-center justify-between shadow-lg border border-white/10"
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5" />
            <span className="text-sm font-bold uppercase">{error}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setError(null)}
            className="text-white hover:bg-white/20 h-8 w-8 p-0 transition-colors"
          >
            <X className="h-4 w-4" />
          </Button>
        </motion.div>
      )}

      {/* WSL VHDX compaction banner — shown after image deletion in WSL Docker mode */}
      {showCompactionBanner && (
        <Card className="bg-amber-500/10 border-amber-500/30">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-4">
              <HardDrive className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1">
                <p className="text-sm font-semibold text-amber-300">
                  Reclaim physical disk space
                </p>
                <p className="text-xs text-amber-300/70">
                  Docker images were removed but the WSL disk file (VHDX)
                  doesn't shrink automatically. Compact it to recover space on
                  Windows. This requires stopping the engine and UAC elevation.
                </p>
                {compactionResult && (
                  <p
                    className={`text-[10px] font-black uppercase tracking-widest ${compactionResult.ok ? "text-emerald-400" : "text-red-400"}`}
                  >
                    {compactionResult.message}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-amber-500/40 text-amber-300 hover:bg-amber-500/20 text-xs h-8"
                  disabled={compacting}
                  onClick={async () => {
                    setCompacting(true);
                    setCompactionResult(null);
                    const result = await window.electronAPI.reclaimDiskSpace();
                    setCompacting(false);
                    if (result.success) {
                      setCompactionResult({
                        ok: true,
                        message: "Compaction complete — space reclaimed.",
                      });
                      // Refresh disk space display
                      const diskResult =
                        await window.electronAPI.getDiskSpace();
                      if (diskResult.success) setDiskSpace(diskResult.data);
                    } else if (result.error === "CLIENT_RUNNING") {
                      setCompactionResult({
                        ok: false,
                        message: result.message || "Stop the engine first.",
                      });
                    } else if (result.error === "NOT_WSL_MODE") {
                      setCompactionResult({
                        ok: false,
                        message:
                          "Not applicable — OpenFork Ubuntu is not active.",
                      });
                    } else {
                      setCompactionResult({
                        ok: false,
                        message:
                          result.message ||
                          result.error ||
                          "Compaction failed.",
                      });
                    }
                  }}
                >
                  {compacting ? (
                    <Loader size="xs" className="mr-1" />
                  ) : (
                    <HardDrive className="h-3 w-3 mr-1" />
                  )}
                  Compact Now
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 text-amber-300/60 hover:text-amber-300"
                  onClick={() => {
                    setShowCompactionBanner(false);
                    setCompactionResult(null);
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Disk Space Error Alert */}
      {diskSpaceError && (
        <Card className="bg-destructive/10 border-destructive/30">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <AlertTriangle className="h-6 w-6 text-destructive flex-shrink-0 mt-0.5" />
              <div className="flex-1 space-y-2">
                <h3 className="text-xs font-black uppercase tracking-widest text-destructive flex items-center gap-2">
                  Insufficient Disk Space
                </h3>
                <div className="text-sm space-y-1">
                  <p>
                    Cannot download{" "}
                    <span className="font-mono font-bold">
                      {diskSpaceError.image_name}
                    </span>
                  </p>
                  <p>
                    <span className="text-destructive/80">Need:</span>{" "}
                    <span className="font-black">
                      {diskSpaceError.required_gb} GB
                    </span>{" "}
                    <span className="text-muted-foreground">
                      (including 5 GB safety buffer)
                    </span>
                  </p>
                  <p>
                    <span className="text-destructive/80">Available:</span>{" "}
                    <span className="font-black">
                      {diskSpaceError.available_gb} GB
                    </span>
                  </p>
                </div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground pt-2">
                  Please free up disk space and try again.
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDiskSpaceError(null)}
                className="ml-auto"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-black/40 border border-amber-500/20 shadow-lg shadow-amber-500/20 text-amber-500 flex items-center justify-center shrink-0">
            <Container className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-lg font-black text-white uppercase">
              Docker Management
            </h2>
            <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em] mt-0.5">
              {engineLabel}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {diskSpace && (
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg backdrop-blur-md transition-all duration-300 ${
                diskSpaceError
                  ? "bg-destructive border border-destructive/50 text-white shadow-lg shadow-destructive/20"
                  : "bg-black/40 border border-amber-500/20 text-amber-500 shadow-lg shadow-amber-500/20"
              }`}
            >
              <HardDrive className="h-3.5 w-3.5" />
              <span className="text-[10px] font-black tracking-widest uppercase">
                {diskSpace.free_gb}GB / {diskSpace.total_gb}GB FREE
              </span>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchData}
            disabled={loading}
            className="rounded-lg bg-white/5 hover:bg-white/10 h-8 w-8 p-0 border border-white/5 transition-all text-white shadow-sm"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      </header>

      {/* Download Progress Card */}
      {isDownloading && (
        <Card className="relative overflow-hidden group transition-all duration-500 border-amber-500/50 bg-amber-500/10 backdrop-blur-xl shadow-2xl shadow-amber-500/10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,color-mix(in_oklab,var(--color-amber-500)_15%,transparent),transparent)]" />
          <CardHeader className="flex flex-row items-center justify-between relative z-10 px-4 pb-2">
            <CardTitle className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-black/40 border border-amber-500/20 shadow-lg shadow-amber-500/20 text-amber-500 flex items-center justify-center shrink-0">
                <Download className="h-4 w-4 animate-bounce" />
              </div>
              <div>
                <span className="font-black text-xs uppercase tracking-widest text-white">
                  {dockerPullProgress?.status || "Downloading"}{" "}
                  {dockerPullProgress?.image}
                </span>
              </div>
            </CardTitle>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleCancelDownload}
              className="rounded-lg h-9 px-4 text-[10px] font-black uppercase tracking-widest"
            >
              Abort
            </Button>
          </CardHeader>
          <CardContent className="relative z-10 pb-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[10px] font-black tracking-[0.2em] text-white uppercase">
                <span>Progress</span>
                <span className="text-white tabular-nums">
                  {Math.round(dockerPullProgress?.progress || 0)}%
                </span>
              </div>
              <div className="relative h-2 bg-white/5 rounded-full overflow-hidden">
                <motion.div
                  className="absolute inset-y-0 left-0 bg-amber-500 rounded-full overflow-hidden"
                  initial={{ width: 0 }}
                  animate={{ width: `${dockerPullProgress?.progress || 0}%` }}
                  transition={{ duration: 0.5, ease: "backOut" }}
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-shimmer" />
                </motion.div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Containers Card */}
      <Card className="group relative overflow-hidden transition-all duration-500 border-white/20 bg-surface/40 backdrop-blur-md shadow-lg">
        {loading && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/40 backdrop-blur-[2px] animate-in fade-in duration-300">
            <Loader size="md" variant="primary" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
        <CardHeader className="flex flex-row items-center justify-between relative z-10 px-4 pb-3">
          <CardTitle className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-black/40 border border-amber-500/20 shadow-lg shadow-amber-500/20 text-amber-500 flex items-center justify-center shrink-0">
              <Container className="h-4 w-4" />
            </div>
            <div>
              <span className="font-black text-[10px] uppercase tracking-[0.2em] text-white/90">
                Running Containers
              </span>
              <p className="text-[9px] text-white/30 font-black uppercase tracking-[0.2em] mt-0.5">
                {containers.length} Instances
              </p>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="relative z-10 px-4 overflow-hidden pb-4">
          {containers.length === 0 ? (
            <div className="text-center py-12 opacity-30 select-none">
              <Container className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <p className="text-[10px] font-black uppercase tracking-widest">
                No active containers found
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {containers.map((container) => (
                <div
                  key={container.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-amber-500/50 bg-amber-500/10 text-white transition-all duration-500 group/row hover:bg-amber-500/20"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-[11px] text-white/90 truncate uppercase tracking-wide">
                      {container.name}
                    </p>
                    <p className="text-[10px] text-white/40 truncate font-bold uppercase mt-0.5 tracking-wide">
                      {container.image}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 ml-4">
                    <span className="px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border border-emerald-400/20 bg-emerald-400/5 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                      {container.status}
                    </span>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() =>
                        handleStopContainer(container.id, container.name)
                      }
                      disabled={actionLoading !== null}
                      className="rounded-lg h-9 w-9 p-0 bg-destructive/10 text-destructive border-destructive/20 hover:bg-destructive hover:text-white"
                    >
                      {actionLoading === `stop-${container.id}` ? (
                        <Loader size="xs" />
                      ) : (
                        <X className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Images Card */}
      <Card className="relative overflow-hidden bg-card/50 backdrop-blur-sm border-white/10">
        {loading && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/40 backdrop-blur-[2px] animate-in fade-in duration-300">
            <Loader size="md" variant="primary" />
          </div>
        )}
        {actionLoading?.startsWith("remove-") && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/80 backdrop-blur-md">
            <Loader size="lg" variant="primary" className="mb-4" />
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/70">
              {actionLoading === "remove-all"
                ? "Purging Repository..."
                : "Surgically Removing Image..."}
            </p>
          </div>
        )}
        <CardHeader className="flex flex-row items-center justify-between relative z-10 px-4 pb-3">
          <CardTitle className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-black/40 border border-amber-500/20 shadow-lg shadow-amber-500/20 text-amber-500 flex items-center justify-center shrink-0">
              <HardDrive className="h-5 w-5" />
            </div>
            <span className="font-black text-[10px] uppercase tracking-[0.2em] text-white/90">
              Downloaded Docker Images ({images.length})
            </span>
          </CardTitle>
          {images.length > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleRemoveAllImages}
              disabled={actionLoading !== null}
              className="h-8 text-[10px] font-black uppercase tracking-widest px-4"
            >
              {actionLoading === "remove-all" ? (
                <Loader size="xs" className="mr-2" />
              ) : (
                <Trash2 className="h-3.5 w-3.5 mr-2" />
              )}
              Delete All Docker Images
            </Button>
          )}
        </CardHeader>
        <CardContent className="px-4 pb-4 relative">
          {images.length === 0 ? (
            <p className="text-[10px] font-black uppercase tracking-widest text-white/20 text-center py-8">
              No OpenFork Docker images found
            </p>
          ) : (
            <div className="space-y-2">
              {images.map((image) => (
                <div
                  key={image.id}
                  className="flex items-center justify-between p-2.5 rounded-lg border border-amber-500/50 bg-amber-500/10 text-white transition-colors hover:bg-amber-500/20"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-[11px] text-white/90 truncate uppercase tracking-wide">
                      {image.repository}:{image.tag}
                    </p>
                    <p className="text-[10px] text-white/40 font-bold uppercase flex items-center gap-2 mt-0.5 tracking-wide">
                      <span className="inline-flex items-center gap-1">
                        <HardDrive className="h-2.5 w-2.5" />
                        {image.size}
                      </span>
                      <span className="opacity-30">•</span>
                      {image.created}
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() =>
                      handleRemoveImage(
                        image.id,
                        `${image.repository}:${image.tag}`,
                      )
                    }
                    disabled={actionLoading !== null}
                  >
                    {actionLoading === `remove-${image.id}` ? (
                      <Loader size="xs" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
});
