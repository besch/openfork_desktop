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

  // REAL-TIME UPDATES: Subscribe to background docker monitoring
  useEffect(() => {
    // Start background monitoring in Electron
    window.electronAPI.startDockerMonitoring();

    const cleanupContainers = window.electronAPI.onDockerContainersUpdate((data) => {
      setContainers(data);
    });

    const cleanupImages = window.electronAPI.onDockerImagesUpdate((data) => {
      setImages(data);
    });

    return () => {
      cleanupContainers();
      cleanupImages();
      // Stop monitoring when user leaves this page to save CPU
      window.electronAPI.stopDockerMonitoring();
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
    showConfirmDialog(
      "Cancel Download",
      "Are you sure you want to cancel the Docker image download? This will stop the current workflow.",
      async () => {
        window.electronAPI.stopClient();
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

  const handleStopAllContainers = () => {
    showConfirmDialog(
      "Stop All Containers",
      `Are you sure you want to stop all ${containers.length} OpenFork containers?`,
      async () => {
        setActionLoading("stop-all");
        try {
          const result = await window.electronAPI.stopAllContainers();
          if (result.success) {
            await fetchData();
          } else {
            setError(result.error || "Failed to stop containers");
          }
        } finally {
          setActionLoading(null);
        }
      }
    );
  };

  const handleCleanupAll = () => {
    showConfirmDialog(
      "Clean Everything",
      "This will stop ALL containers and remove ALL Docker images. This action cannot be undone and will require re-downloading large images (10-20GB+) if needed again. Are you absolutely sure?",
      async () => {
        setActionLoading("cleanup-all");
        try {
          const result = await window.electronAPI.cleanupDocker();
          if (result.success) {
            await fetchData();
          } else {
            setError(result.error || "Failed to cleanup");
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
    <div className="space-y-6">
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

      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-bold">Docker Management</h2>
          <Button
            variant="primary"
            size="sm"
            onClick={fetchData}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
        <div className="flex items-center gap-3">
          {diskSpace && (
            <div className={`hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg ${
              diskSpaceError 
                ? 'bg-destructive/10 border border-destructive/20'  
                : 'bg-muted/30 border border-white/10'
              }`}
            >
              <HardDrive className={`h-4 w-4 ${diskSpaceError ? 'text-destructive' : 'text-muted-foreground'}`} />
              <span className={`text-sm font-medium ${diskSpaceError ? 'text-destructive' : 'text-foreground'}`}>
                {diskSpace.free_gb} GB / {diskSpace.total_gb} GB
              </span>
            </div>
          )}
          <Button
            variant="destructive"
            onClick={handleCleanupAll}
            disabled={actionLoading !== null || (images.length === 0 && containers.length === 0)}
          >
            {actionLoading === "cleanup-all" ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4 mr-2" />
            )}
            Clean Everything
          </Button>
        </div>
      </header>

      {/* Download Progress Card */}
      {isDownloading && (
        <Card className="bg-gradient-to-br from-primary/10 to-primary/5 backdrop-blur-sm border-primary/30 shadow-lg shadow-primary/10">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-primary">
              <div className="flex items-center gap-2">
                <Download className="h-5 w-5 animate-pulse" />
                <span>Downloading Docker Image</span>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleCancelDownload}
              >
                <X className="h-4 w-4 mr-1" />
                Cancel
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="relative h-3 bg-muted/30 rounded-full overflow-hidden">
                  <motion.div
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary via-primary-hover to-primary rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${dockerPullProgress?.progress || 0}%` }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
                </div>
              </div>
              <span className="text-lg font-bold text-primary tabular-nums min-w-[4ch]">
                {dockerPullProgress?.progress || 0}%
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground truncate max-w-[300px]" title={dockerPullProgress?.image}>
                {dockerPullProgress?.image}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Containers Card */}
      <Card className="bg-card/50 backdrop-blur-sm border-white/10">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Container className="h-5 w-5 text-primary" />
            Running Containers ({containers.length})
          </CardTitle>
          {containers.length > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleStopAllContainers}
              disabled={actionLoading !== null}
            >
              {actionLoading === "stop-all" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <X className="h-4 w-4 mr-2" />
              )}
              Stop All
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {containers.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">
              No OpenFork containers found
            </p>
          ) : (
            <div className="space-y-2">
              {containers.map((container) => (
                <div
                  key={container.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-white/5 hover:border-primary/30 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{container.name}</p>
                    <p className="text-sm text-muted-foreground truncate">
                      {container.image}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 ml-4">
                    <span
                      className={`px-2 py-1 rounded-md text-xs font-medium transition-all duration-300 shadow-lg ${
                        container.state === "running"
                          ? "bg-primary text-primary-foreground border border-primary shadow-primary/20"
                          : "bg-muted text-muted-foreground border border-white/5"
                      }`}
                    >
                      {container.status}
                    </span>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleStopContainer(container.id, container.name)}
                      disabled={actionLoading !== null}
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
      <Card className="bg-card/50 backdrop-blur-sm border-white/10">
        <CardHeader className="flex flex-row items-center justify-between">
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
