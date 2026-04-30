import { useState, useEffect, useCallback, memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Loader } from "@/components/ui/loader";
import { Modal } from "@/components/ui/modal";
import { StorageSettings } from "@/components/StorageSettings";
import {
  Trash2,
  X,
  RefreshCw,
  HardDrive,
  Container,
  Download,
  AlertTriangle,
  Settings,
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
    engine_file_gb: string | null;
    engine_file_path: string | null;
  } | null>(null);
  const [engineSwitchNotice, setEngineSwitchNotice] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
   const [autoCompactStatus, setAutoCompactStatus] = useState<{
     phase:
       | "starting"
       | "stopping_client"
       | "compacting"
       | "restarting_client"
       | "completed"
       | "failed";
     compactInProgress: boolean;
     platformSupported: boolean;
     error?: string;
   } | null>(null);

   const [imageEvictedNotification, setImageEvictedNotification] = useState<{
     service_type: string;
     image: string;
     freed_bytes: number;
     reason: string;
   } | null>(null);

  const dockerPullProgress = useClientStore(
    (state) => state.dockerPullProgress,
  );
  const status = useClientStore((state) => state.status);

  const formatCreatedDate = (dateStr: string): string => {
    const normalized = dateStr
      .replace(/ (\+?\d{4}) [A-Z]+$/, " $1")
      .replace(" ", "T");
    const date = new Date(normalized);
    if (isNaN(date.getTime())) return dateStr;

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 1) return "today";
    if (diffDays === 1) return "yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
  };

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

      // Always attempt to list containers — the listing command runs inside WSL
      // where Docker is reachable even when the Windows→WSL TCP API (port 2375)
      // is flaky.  Only skip image listing when the status check says Docker is
      // down because image listing depends on the same routing.
      const [containersResult, diskResult] = await Promise.all([
        window.electronAPI.listDockerContainers(),
        window.electronAPI.getDiskSpace(),
      ]);

      const hasRunningContainers =
        containersResult.success &&
        containersResult.data &&
        containersResult.data.length > 0;

      if (!nextDockerStatus.running && !hasRunningContainers) {
        setImages([]);
        setContainers([]);
        useClientStore.getState().setDockerContainers([]);
        setError(describeDockerState(nextDockerStatus));
        if (diskResult.success) setDiskSpace(diskResult.data);
        return;
      }

      // Docker is running (or containers were found despite status check flakiness).
      if (containersResult.success && containersResult.data) {
        setContainers(containersResult.data);
        useClientStore.getState().setDockerContainers(containersResult.data);
      }

      if (diskResult.success) {
        setDiskSpace(diskResult.data);
      }

      if (nextDockerStatus.running) {
        const imagesResult = await window.electronAPI.listDockerImages();
        if (imagesResult.success && imagesResult.data) {
          setImages(imagesResult.data);
        } else {
          setError(imagesResult.error || "Failed to fetch images");
        }
      } else {
        setImages([]);
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

  // Auto-refresh when the active Docker engine changes.
  useEffect(() => {
    const cleanup = window.electronAPI.onEngineSwitch((data) => {
      setEngineSwitchNotice(data);
      fetchData();
    });
    return cleanup;
  }, [fetchData]);

   // Listen for auto-compact status updates (Windows only).
   useEffect(() => {
     const cleanup = window.electronAPI.onAutoCompactStatus((status) => {
       setAutoCompactStatus(() => {
         if (status.phase === "completed" || status.phase === "failed") {
           setTimeout(() => setAutoCompactStatus(null), 8000);
         }
         return status;
       });
       if (status.phase === "completed") {
         fetchData();
       }
     });
     return cleanup;
   }, [fetchData]);

   // Listen for image eviction events from Python (disk space reclamation).
   useEffect(() => {
     const cleanup = window.electronAPI.onImageEvicted((payload) => {
       setImageEvictedNotification(payload);
       // Auto-hide after 6 seconds
       setTimeout(() => setImageEvictedNotification(null), 6000);
     });
     return cleanup;
   }, []);

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

      {autoCompactStatus?.compactInProgress && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-amber-500/10 border border-amber-500/30 text-white rounded-lg p-4 flex items-center gap-3 shadow-lg"
        >
          <Loader size="sm" variant="primary" className="shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-xs font-bold uppercase tracking-widest text-amber-300">
              Auto-Compact:{" "}
              <span className="text-white">
                {autoCompactStatus.phase === "stopping_client"
                  ? "Pausing client..."
                  : autoCompactStatus.phase === "compacting"
                    ? "Shrinking VHDX..."
                    : autoCompactStatus.phase === "restarting_client"
                      ? "Restarting client..."
                      : "Preparing..."}
              </span>
            </span>
          </div>
        </motion.div>
      )}

      {autoCompactStatus?.phase === "completed" &&
        !autoCompactStatus.compactInProgress && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-emerald-500/10 border border-emerald-500/30 text-white rounded-lg p-4 flex items-center justify-between shadow-lg"
          >
            <div className="flex items-center gap-3">
              <HardDrive className="h-4 w-4 text-emerald-400 shrink-0" />
              <span className="text-xs font-bold uppercase tracking-widest text-emerald-300">
                Auto-Compact complete — disk space reclaimed
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAutoCompactStatus(null)}
              className="text-emerald-300 hover:bg-emerald-500/20 h-8 w-8 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </motion.div>
        )}

       {autoCompactStatus?.phase === "failed" &&
         !autoCompactStatus.compactInProgress && (
           <motion.div
             initial={{ opacity: 0, y: -10 }}
             animate={{ opacity: 1, y: 0 }}
             className="bg-destructive/10 border border-destructive/30 text-white rounded-lg p-4 flex items-center justify-between shadow-lg"
           >
             <div className="flex items-center gap-3">
               <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
               <span className="text-xs font-bold uppercase tracking-widest text-destructive">
                 Auto-Compact failed:{" "}
                 {autoCompactStatus.error || "Unknown error"}
               </span>
             </div>
             <Button
               variant="ghost"
               size="sm"
               onClick={() => setAutoCompactStatus(null)}
               className="text-destructive hover:bg-destructive/20 h-8 w-8 p-0"
             >
               <X className="h-4 w-4" />
             </Button>
           </motion.div>
         )}

       {imageEvictedNotification && (
         <motion.div
           initial={{ opacity: 0, y: -10 }}
           animate={{ opacity: 1, y: 0 }}
           className="bg-blue-500/10 border border-blue-500/30 text-white rounded-lg p-4 flex items-center justify-between shadow-lg"
         >
           <div className="flex items-center gap-3 min-w-0">
             <HardDrive className="h-4 w-4 text-blue-400 shrink-0" />
             <div className="min-w-0">
               <span className="text-xs font-bold uppercase tracking-widest text-blue-300">
                 Reclaimed{" "}
                 {imageEvictedNotification.freed_bytes > 0
                   ? `${(imageEvictedNotification.freed_bytes / 1024 ** 3).toFixed(1)} GB`
                   : "disk space"}
                 {" "}from{" "}
                 <span className="text-white">
                   {imageEvictedNotification.service_type || imageEvictedNotification.image || "image"}
                 </span>
               </span>
             </div>
           </div>
           <Button
             variant="ghost"
             size="sm"
             onClick={() => setImageEvictedNotification(null)}
             className="text-blue-300 hover:bg-blue-500/20 h-8 w-8 p-0 shrink-0"
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
              className={`flex flex-col items-end gap-1 px-3 py-1.5 rounded-lg backdrop-blur-md transition-all duration-300 ${
                diskSpaceError
                  ? "bg-destructive border border-destructive/50 text-white shadow-lg shadow-destructive/20"
                  : "bg-black/40 border border-amber-500/20 text-amber-500 shadow-lg shadow-amber-500/20"
              }`}
            >
              <div className="flex items-center gap-2">
                <HardDrive className="h-3.5 w-3.5" />
                <span className="text-[10px] font-black tracking-widest uppercase">
                  {diskSpace.free_gb}GB / {diskSpace.total_gb}GB FREE
                </span>
              </div>
              {diskSpace.engine_file_gb && (
                <span className="text-[9px] font-black tracking-widest uppercase opacity-70">
                  VHDX {diskSpace.engine_file_gb}GB
                </span>
              )}
            </div>
          )}
          <Button
            variant="primary"
            size="icon"
            onClick={() => setIsSettingsOpen(true)}
            aria-label="Open Docker settings"
            title="Open Docker settings"
            className="rounded-lg shadow-lg shadow-primary/20"
          >
            <Settings className="h-4 w-4" />
          </Button>
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

      <Modal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        title="Docker Settings"
        description="Manage OpenFork Ubuntu storage, compaction, and engine location."
        size="full"
        scrollbarVariant="primary"
      >
        <StorageSettings compact embedded onSettingsChanged={fetchData} />
      </Modal>

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
                : "Removing Image..."}
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
                      {formatCreatedDate(image.created)}
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
