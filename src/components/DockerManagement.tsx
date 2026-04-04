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
import { StorageSettings } from "./StorageSettings";
import type { DockerImage, DockerContainer } from "@/types";

interface ConfirmDialogState {
  isOpen: boolean;
  title: string;
  description: string;
  onConfirm: () => void;
}

export const DockerManagement = memo(() => {
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
  const [showStorageSettings, setShowStorageSettings] = useState(false);
  const [showCompactionBanner, setShowCompactionBanner] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [compactionResult, setCompactionResult] = useState<
    { ok: boolean; message: string } | null
  >(null);

  const dockerPullProgress = useClientStore(
    (state) => state.dockerPullProgress,
  );
  const status = useClientStore((state) => state.status);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [imagesResult, containersResult] = await Promise.all([
        window.electronAPI.listDockerImages(),
        window.electronAPI.listDockerContainers(),
      ]);

      if (imagesResult.success && imagesResult.data) {
        setImages(imagesResult.data);
      } else {
        setError(imagesResult.error || "Failed to fetch images");
      }

      if (containersResult.success && containersResult.data) {
        setContainers(containersResult.data);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch Docker data",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
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

  // Fetch disk space info on mount and after cleanup operations
  useEffect(() => {
    const fetchDiskSpace = async () => {
      const result = await window.electronAPI.getDiskSpace();
      if (result.success) {
        setDiskSpace(result.data);
      }
    };
    fetchDiskSpace();
  }, []);

  // Listen for WSL VHDX compaction suggestions emitted after image deletion
  useEffect(() => {
    const cleanup = window.electronAPI.onCompactionSuggested(() => {
      setShowCompactionBanner(true);
      setCompactionResult(null);
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

  const handlePurgeOpenFork = () => {
    showConfirmDialog(
      "Purge All Data",
      "This will surgically remove ALL OpenFork containers, images, and associated volumes. It is the most reliable way to recover space without affecting your other Docker projects. Large images will need re-downloading if needed again. Proceed?",
      async () => {
        setActionLoading("purge-openfork");
        try {
          const result = await window.electronAPI.purgeOpenForkData();
          if (result.success) {
            await fetchData();
            // Refresh disk space after purge
            const diskResult = await window.electronAPI.getDiskSpace();
            if (diskResult.success) setDiskSpace(diskResult.data);
          } else {
            setError(result.error || "Failed to purge OpenFork data");
          }
        } finally {
          setActionLoading(null);
        }
      },
    );
  };

  const isDownloading =
    dockerPullProgress !== null &&
    (status === "starting" || status === "running");

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <Loader size="lg" variant="white" />
        <span className="text-xs font-black uppercase tracking-[0.2em] text-white/50">
          Initializing Docker Engine...
        </span>
      </div>
    );
  }

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

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="bg-destructive-foreground text-white rounded-lg p-4 flex items-center justify-between shadow-lg border border-white/10"
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5" />
            <span className="font-medium">{error}</span>
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
                  Docker images were removed but the WSL disk file (VHDX) doesn't
                  shrink automatically. Compact it to recover space on Windows.
                  This requires stopping the engine and UAC elevation.
                </p>
                {compactionResult && (
                  <p
                    className={`text-xs font-medium ${compactionResult.ok ? "text-emerald-400" : "text-red-400"}`}
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
                      setCompactionResult({ ok: true, message: "Compaction complete — space reclaimed." });
                      // Refresh disk space display
                      const diskResult = await window.electronAPI.getDiskSpace();
                      if (diskResult.success) setDiskSpace(diskResult.data);
                    } else if (result.error === "CLIENT_RUNNING") {
                      setCompactionResult({ ok: false, message: result.message || "Stop the engine first." });
                    } else if (result.error === "NOT_WSL_MODE") {
                      setCompactionResult({ ok: false, message: "Not applicable — using Docker Desktop." });
                    } else {
                      setCompactionResult({ ok: false, message: result.message || result.error || "Compaction failed." });
                    }
                  }}
                >
                  {compacting ? <Loader size="xs" className="mr-1" /> : <HardDrive className="h-3 w-3 mr-1" />}
                  Compact Now
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 text-amber-300/60 hover:text-amber-300"
                  onClick={() => { setShowCompactionBanner(false); setCompactionResult(null); }}
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
                <h3 className="font-semibold text-destructive flex items-center gap-2">
                  Insufficient Disk Space
                </h3>
                <div className="text-sm space-y-1">
                  <p>
                    Cannot download{" "}
                    <span className="font-mono font-medium">
                      {diskSpaceError.image_name}
                    </span>
                  </p>
                  <p>
                    <span className="text-destructive/80">Need:</span>{" "}
                    <span className="font-semibold">
                      {diskSpaceError.required_gb} GB
                    </span>{" "}
                    <span className="text-muted-foreground">
                      (including 5 GB safety buffer)
                    </span>
                  </p>
                  <p>
                    <span className="text-destructive/80">Available:</span>{" "}
                    <span className="font-semibold">
                      {diskSpaceError.available_gb} GB
                    </span>
                  </p>
                </div>
                <p className="text-sm text-muted-foreground pt-2">
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
          <div className="p-2 rounded-lg bg-primary border border-white/10 shadow-lg shadow-primary/30 flex items-center justify-center shrink-0">
            <Container className="h-4 w-4 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-black tracking-tight text-white uppercase">
              Docker Management
            </h2>
            <p className="text-[10px] font-black text-white/50 uppercase tracking-[0.2em] mt-0.5">
              Engine & Container Runtime
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {diskSpace && (
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg backdrop-blur-md transition-all duration-300 ${
                diskSpaceError
                  ? "bg-destructive border border-destructive/50 text-white shadow-lg shadow-destructive/20"
                  : "bg-primary border border-white/10 text-white shadow-lg shadow-primary/20"
              }`}
            >
              <HardDrive className="h-3.5 w-3.5" />
              <span className="text-[10px] font-black tracking-widest uppercase">
                {diskSpace.free_gb}GB / {diskSpace.total_gb}GB
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
          <Button
            variant="destructive"
            onClick={handlePurgeOpenFork}
            disabled={actionLoading !== null}
            className="rounded-lg h-8 text-[10px] font-black uppercase tracking-widest px-4"
          >
            {actionLoading === "purge-openfork" ? (
              <Loader size="xs" className="mr-2" />
            ) : (
              <Trash2 className="h-3.5 w-3.5 mr-2" />
            )}
            Purge All
          </Button>
        </div>
      </header>

      <Card className="group relative overflow-hidden transition-all duration-500 border-white/20 bg-surface/40 backdrop-blur-md shadow-lg">
        <button
          onClick={() => setShowStorageSettings(!showStorageSettings)}
          className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-all duration-300 focus:outline-none relative z-10"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary border border-white/10 shadow-lg shadow-primary/30 text-white group-hover:scale-110 transition-transform duration-500 flex items-center justify-center shrink-0">
              <HardDrive className="h-4 w-4" />
            </div>
            <div className="text-left">
              <span className="font-black text-[10px] uppercase tracking-[0.2em] text-white">
                Storage & Engine Settings
              </span>
              <p className="text-[9px] text-white/50 font-black uppercase tracking-[0.1em] mt-0.5">
                Configure Location & Performance
              </p>
            </div>
          </div>
          <motion.div
            animate={{ rotate: showStorageSettings ? 0 : -90 }}
            transition={{ duration: 0.3, ease: "anticipate" }}
            className="text-white/20 group-hover:text-white transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </motion.div>
        </button>
        <motion.div
          initial={false}
          animate={{ height: showStorageSettings ? "auto" : 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden"
        >
          <div className="p-4 pt-0 relative z-10 border-t border-white/5">
            <StorageSettings />
          </div>
        </motion.div>
      </Card>

      {/* Download Progress Card */}
      {isDownloading && (
        <Card className="relative overflow-hidden group transition-all duration-500 border-white/20 bg-primary/5 backdrop-blur-xl shadow-2xl shadow-primary/10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,color-mix(in_oklab,var(--color-primary)_15%,transparent),transparent)]" />
          <CardHeader className="flex flex-row items-center justify-between relative z-10 px-4 pb-2">
            <CardTitle className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary border border-white/10 shadow-lg shadow-primary/40 text-white flex items-center justify-center shrink-0">
                <Download className="h-4 w-4 animate-bounce" />
              </div>
              <div>
                <span className="font-black text-xs uppercase tracking-widest text-white">
                  DOWNLOADING {dockerPullProgress?.image}
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
                  className="absolute inset-y-0 left-0 bg-primary rounded-full overflow-hidden"
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
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
        <CardHeader className="flex flex-row items-center justify-between relative z-10 px-4 pb-3">
          <CardTitle className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary border border-white/10 shadow-lg shadow-primary/30 text-white flex items-center justify-center shrink-0">
              <Container className="h-4 w-4 text-white" />
            </div>
            <div>
              <span className="font-black text-[10px] uppercase tracking-widest text-white/90">
                Running Containers
              </span>
              <p className="text-[9px] text-muted/30 font-bold uppercase tracking-[0.2em] mt-0.5">
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
                  className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5 hover:border-white/10 hover:bg-white/[0.08] transition-all duration-500 group/row"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-xs text-white/90 truncate tracking-tight">
                      {container.name}
                    </p>
                    <p className="text-[10px] text-muted-foreground/60 truncate font-medium mt-0.5">
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
        {actionLoading?.startsWith("remove-") && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/80 backdrop-blur-md">
            <Loader size="lg" variant="white" className="mb-4" />
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/70">
              {actionLoading === "remove-all"
                ? "Purging Repository..."
                : "Surgically Removing Image..."}
            </p>
          </div>
        )}
        <CardHeader className="flex flex-row items-center justify-between relative z-10 px-4 pb-3">
          <CardTitle className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary border border-white/10 shadow-lg shadow-primary/30 text-white flex items-center justify-center shrink-0">
              <HardDrive className="h-5 w-5" />
            </div>
            <span>Downloaded Docker Images ({images.length})</span>
          </CardTitle>
          {images.length > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleRemoveAllImages}
              disabled={actionLoading !== null}
            >
              {actionLoading === "remove-all" ? (
                <Loader size="xs" className="mr-2" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Remove All
            </Button>
          )}
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {images.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">
              No OpenFork Docker images found
            </p>
          ) : (
            <div className="space-y-2">
              {images.map((image) => (
                <div
                  key={image.id}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-muted/30 border border-white/5 hover:border-primary/30 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">
                      {image.repository}:{image.tag}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <HardDrive className="h-3 w-3" />
                        {image.size}
                      </span>
                      <span className="mx-2">•</span>
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
