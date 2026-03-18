import { useState, useEffect, useCallback, memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  Trash2,
  X,
  RefreshCw,
  Loader2,
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

  const dockerPullProgress = useClientStore((state) => state.dockerPullProgress);
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
      setError(err instanceof Error ? err.message : "Failed to fetch Docker data");
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

  // Subscribe to app-wide Docker monitoring updates.
  useEffect(() => {
    const cleanupContainers = window.electronAPI.onDockerContainersUpdate((data) => {
      setContainers(data);
    });

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
    onConfirm: () => void
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
      }
    );
  };

  const handleStopContainer = async (containerId: string, containerName: string) => {
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
      }
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
        }
      );
      return;
    }

    showConfirmDialog(
      "Cancel Download",
      "Are you sure you want to cancel the Docker image download?",
      async () => {
        window.electronAPI.cancelDownload(serviceType);
      }
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
      }
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
      }
    );
  };

  const isDownloading = dockerPullProgress !== null && (status === "starting" || status === "running");

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">Loading Docker data...</span>
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
                  <p>Cannot download <span className="font-mono font-medium">{diskSpaceError.image_name}</span></p>
                  <p>
                    <span className="text-destructive/80">Need:</span>{" "}
                    <span className="font-semibold">{diskSpaceError.required_gb} GB</span>
                    {" "}<span className="text-muted-foreground">(including 5 GB safety buffer)</span>
                  </p>
                  <p>
                    <span className="text-destructive/80">Available:</span>{" "}
                    <span className="font-semibold">{diskSpaceError.available_gb} GB</span>
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
          <div className="p-2 rounded-xl bg-surface/50 border border-white/5 shadow-xl">
            <Container className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-black tracking-tight text-white uppercase">Docker Management</h2>
            <p className="text-[10px] font-black text-white/50 uppercase tracking-[0.2em] mt-0.5">Engine & Container Runtime</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {diskSpace && (
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl backdrop-blur-md transition-all duration-300 ${
              diskSpaceError 
                ? 'bg-destructive/10 border border-destructive/20 text-destructive'  
                : 'bg-white/5 border border-white/5 text-white/60'
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
            className="rounded-lg hover:bg-white/5 h-8 w-8 p-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button
            variant="destructive"
            onClick={handlePurgeOpenFork}
            disabled={actionLoading !== null}
            className="rounded-xl h-8 text-[10px] font-black uppercase tracking-widest px-4"
          >
            {actionLoading === "purge-openfork" ? (
              <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5 mr-2" />
            )}
            Purge All
          </Button>
        </div>
      </header>

      <Card className="group relative overflow-hidden transition-all duration-500 border-white/5 bg-surface/30 backdrop-blur-md">
        <button 
          onClick={() => setShowStorageSettings(!showStorageSettings)}
          className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-all duration-300 focus:outline-none relative z-10"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-white/5 border border-white/5 text-primary group-hover:scale-110 transition-transform duration-500">
              <HardDrive className="h-4 w-4" />
            </div>
            <div className="text-left">
              <span className="font-black text-[10px] uppercase tracking-[0.2em] text-white">Storage & Engine Settings</span>
              <p className="text-[9px] text-white/50 font-black uppercase tracking-[0.1em] mt-0.5">Configure Location & Performance</p>
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
              <path d="m6 9 6 6 6-6"/>
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
        <Card className="relative overflow-hidden group transition-all duration-500 border-primary/20 bg-primary/5 backdrop-blur-xl shadow-2xl shadow-primary/10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,color-mix(in_oklab,var(--color-primary)_15%,transparent),transparent)]" />
          <CardHeader className="pb-4 relative z-10">
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-2.5 rounded-xl bg-primary text-white shadow-lg shadow-primary/30">
                  <Download className="h-5 w-5 animate-bounce" />
                </div>
                <div>
                  <span className="font-black text-xs uppercase tracking-widest text-primary">
                    {dockerPullProgress?.status || "Downloading"}
                  </span>
                  <p className="text-[10px] text-muted/40 font-bold uppercase tracking-widest mt-0.5">Docker Engine Component</p>
                </div>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleCancelDownload}
                className="rounded-xl h-9 px-4 text-[10px] font-black uppercase tracking-widest"
              >
                Abort
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 relative z-10 pb-8">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[10px] font-black tracking-[0.2em] text-muted/40 uppercase">
                <span>Progress</span>
                <span className="text-primary tabular-nums">
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
            <div className="text-[10px] font-bold text-muted/30 uppercase tracking-widest truncate max-w-full text-center">
              Target: {dockerPullProgress?.image}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Containers Card */}
      <Card className="group relative overflow-hidden transition-all duration-500 border-white/5 bg-surface/30 backdrop-blur-md">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
        <CardHeader className="flex flex-row items-center justify-between relative z-10 pb-4">
          <CardTitle className="flex items-center gap-4">
            <div className="p-2 rounded-lg bg-white/5 border border-white/5 text-primary">
              <Container className="h-5 w-5" />
            </div>
            <div>
              <span className="font-black text-[10px] uppercase tracking-widest text-white/90">Running Containers</span>
              <p className="text-[9px] text-muted/30 font-bold uppercase tracking-[0.2em] mt-0.5">{containers.length} Instances</p>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="relative z-10">
          {containers.length === 0 ? (
            <div className="text-center py-12 opacity-30 select-none">
              <Container className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <p className="text-[10px] font-black uppercase tracking-widest">No active containers found</p>
            </div>
          ) : (
            <div className="space-y-3">
              {containers.map((container) => (
                <div
                  key={container.id}
                  className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5 hover:border-white/10 hover:bg-white/[0.08] transition-all duration-500 group/row"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-xs text-white/90 truncate tracking-tight">{container.name}</p>
                    <p className="text-[10px] text-muted-foreground/60 truncate font-medium mt-0.5">
                      {container.image}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 ml-4">
                    <span
                      className="px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border border-emerald-400/20 bg-emerald-400/5 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.1)]"
                    >
                      {container.status}
                    </span>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleStopContainer(container.id, container.name)}
                      disabled={actionLoading !== null}
                      className="rounded-lg h-9 w-9 p-0 bg-destructive/10 text-destructive border-destructive/20 hover:bg-destructive hover:text-white"
                    >
                      {actionLoading === `stop-${container.id}` ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
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
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/60 backdrop-blur-sm">
            <Loader2 className="h-8 w-8 animate-spin text-primary drop-shadow-md mb-2" />
            <p className="text-sm font-medium">
              {actionLoading === "remove-all" ? "Removing all images..." : "Removing image..."}
            </p>
          </div>
        )}
        <CardHeader className="flex flex-row items-center justify-between relative z-10">
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5 text-primary" />
            Docker Images ({images.length})
          </CardTitle>
          {images.length > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleRemoveAllImages}
              disabled={actionLoading !== null}
            >
              {actionLoading === "remove-all" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Remove All
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {images.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">
              No OpenFork Docker images found
            </p>
          ) : (
            <div className="space-y-2">
              {images.map((image) => (
                <div
                  key={image.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-white/5 hover:border-primary/30 hover:bg-muted/50 transition-colors"
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
                      handleRemoveImage(image.id, `${image.repository}:${image.tag}`)
                    }
                    disabled={actionLoading !== null}
                  >
                    {actionLoading === `remove-${image.id}` ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
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
