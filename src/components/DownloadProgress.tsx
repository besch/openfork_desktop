import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Download,
  Package,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface DownloadItem {
  id: string;
  name: string;
  type: "node" | "model";
  status: "downloading" | "installing" | "completed" | "failed";
  progress: number;
  speed?: string;
  eta?: string;
  size?: string;
  error?: string;
}

interface DownloadProgressProps {
  className?: string;
}

export const DownloadProgress: React.FC<DownloadProgressProps> = ({
  className,
}) => {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);

  useEffect(() => {
    // Listen for download progress updates from Python backend
    const handleLog = (log: { type: string; message: string }) => {
      if (log.type !== "stdout") return;

      const message = log.message;

      // Parse [INSTALL] messages
      if (message.includes("[INSTALL] Installing custom node:")) {
        const match = message.match(/Installing custom node: (.+)/);
        if (match) {
          const name = match[1];
          setDownloads((prev) => {
            // Check if already exists
            if (prev.some((d) => d.name === name && d.type === "node")) {
              return prev;
            }
            return [
              ...prev,
              {
                id: `node-${Date.now()}`,
                name,
                type: "node",
                status: "downloading",
                progress: 0,
              },
            ];
          });
        }
      }

      // Parse clone progress (for nodes)
      if (message.includes("[INSTALL]") && message.includes("%")) {
        const percentMatch = message.match(/(\d+)%/);
        if (percentMatch) {
          const progress = parseInt(percentMatch[1]);
          setDownloads((prev) =>
            prev.map((d) =>
              d.type === "node" && d.status === "downloading"
                ? { ...d, progress }
                : d
            )
          );
        }
      }

      // Parse node installation completion
      if (message.includes("[INSTALL]   [OK] Clone completed")) {
        setDownloads((prev) =>
          prev.map((d) =>
            d.type === "node" && d.status === "downloading"
              ? { ...d, status: "installing", progress: 100 }
              : d
          )
        );
      }

      if (message.includes("[INSTALL] [OK] Successfully installed")) {
        const match = message.match(/Successfully installed (.+)/);
        if (match) {
          const name = match[1];
          setDownloads((prev) =>
            prev.map((d) =>
              d.name === name && d.type === "node"
                ? { ...d, status: "completed", progress: 100 }
                : d
            )
          );

          // Remove completed items after 3 seconds
          setTimeout(() => {
            setDownloads((prev) => prev.filter((d) => d.name !== name));
          }, 3000);
        }
      }

      if (message.includes("[INSTALL] [ERROR]")) {
        setDownloads((prev) =>
          prev.map((d) =>
            d.type === "node" && d.status !== "completed"
              ? { ...d, status: "failed", error: "Installation failed" }
              : d
          )
        );
      }

      // Parse [DOWNLOAD] messages for models
      if (message.includes("[DOWNLOAD] Downloading model:")) {
        const match = message.match(/Downloading model: (.+)/);
        if (match) {
          const name = match[1];
          setDownloads((prev) => {
            if (prev.some((d) => d.name === name && d.type === "model")) {
              return prev;
            }
            return [
              ...prev,
              {
                id: `model-${Date.now()}`,
                name,
                type: "model",
                status: "downloading",
                progress: 0,
              },
            ];
          });
        }
      }

      // Parse model download progress with aria2c format
      // Example: [#1 SIZE:2.3GiB/11.9GiB(19%) CN:16 DL:45MiB ETA:3m42s]
      if (message.includes("[DOWNLOAD]") && message.includes("SIZE:")) {
        const sizeMatch = message.match(/SIZE:([^/]+)\/([^\(]+)\((\d+)%\)/);
        const speedMatch = message.match(/DL:(\S+)/);
        const etaMatch = message.match(/ETA:(\S+)/);

        if (sizeMatch) {
          const progress = parseInt(sizeMatch[3]);
          const size = sizeMatch[2].trim();
          const speed = speedMatch ? speedMatch[1] : undefined;
          const eta = etaMatch ? etaMatch[1] : undefined;

          setDownloads((prev) =>
            prev.map((d) =>
              d.type === "model" && d.status === "downloading"
                ? { ...d, progress, size, speed, eta }
                : d
            )
          );
        }
      }

      // Parse wget progress format
      // Example: 45% [=====>     ] 5.3G  12.3MB/s  eta 3m 42s
      if (message.includes("[DOWNLOAD]") && message.includes("eta")) {
        const wgetMatch = message.match(
          /(\d+)%.*?(\d+\.?\d*[MGK]B\/s).*?eta\s+(\S+)/
        );
        if (wgetMatch) {
          const progress = parseInt(wgetMatch[1]);
          const speed = wgetMatch[2];
          const eta = wgetMatch[3];

          setDownloads((prev) =>
            prev.map((d) =>
              d.type === "model" && d.status === "downloading"
                ? { ...d, progress, speed, eta }
                : d
            )
          );
        }
      }

      // Parse model completion
      if (message.includes("[DOWNLOAD]   [OK] Download complete")) {
        const sizeMatch = message.match(/\(([^)]+)\)/);
        setDownloads((prev) =>
          prev.map((d) =>
            d.type === "model" && d.status === "downloading"
              ? {
                  ...d,
                  status: "completed",
                  progress: 100,
                  size: sizeMatch ? sizeMatch[1] : d.size,
                }
              : d
          )
        );
      }

      if (message.includes("[DOWNLOAD] [OK] Successfully downloaded")) {
        const match = message.match(/Successfully downloaded (.+)/);
        if (match) {
          const name = match[1];
          setTimeout(() => {
            setDownloads((prev) => prev.filter((d) => d.name !== name));
          }, 3000);
        }
      }

      if (message.includes("[DOWNLOAD] [ERROR]")) {
        setDownloads((prev) =>
          prev.map((d) =>
            d.type === "model" && d.status !== "completed"
              ? { ...d, status: "failed", error: "Download failed" }
              : d
          )
        );
      }
    };

    window.electronAPI.onLog(handleLog);

    return () => {
      window.electronAPI.removeAllListeners("openfork_client:log");
    };
  }, []);

  if (downloads.length === 0) return null;

  return (
    <Card className={`bg-card/80 backdrop-blur-sm ${className}`}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Download className="h-4 w-4" />
          <span>Active Downloads</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <AnimatePresence mode="popLayout">
          {downloads.map((download) => (
            <motion.div
              key={download.id}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="space-y-2 p-3 rounded-lg bg-muted/30 border border-border/50"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  {download.type === "node" ? (
                    <Package className="h-4 w-4 mt-0.5 flex-shrink-0 text-blue-400" />
                  ) : (
                    <Download className="h-4 w-4 mt-0.5 flex-shrink-0 text-purple-400" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {download.name}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                      {download.status === "downloading" && (
                        <>
                          <span>Downloading</span>
                          {download.speed && <span>• {download.speed}</span>}
                          {download.eta && <span>• ETA {download.eta}</span>}
                        </>
                      )}
                      {download.status === "installing" && (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin" />
                          <span>Installing dependencies...</span>
                        </>
                      )}
                      {download.status === "completed" && (
                        <>
                          <CheckCircle2 className="h-3 w-3 text-green-400" />
                          <span>Complete</span>
                          {download.size && <span>• {download.size}</span>}
                        </>
                      )}
                      {download.status === "failed" && (
                        <>
                          <XCircle className="h-3 w-3 text-destructive" />
                          <span>{download.error || "Failed"}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <span className="text-xs font-medium text-muted-foreground tabular-nums">
                  {download.progress}%
                </span>
              </div>

              <div className="relative w-full h-1.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 rounded-full ${
                    download.status === "completed"
                      ? "bg-green-400"
                      : download.status === "failed"
                      ? "bg-destructive"
                      : download.type === "node"
                      ? "bg-blue-400"
                      : "bg-purple-400"
                  }`}
                  style={{ width: `${download.progress}%` }}
                />
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
};
