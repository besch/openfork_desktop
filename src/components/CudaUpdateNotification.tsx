import { useState } from "react";
import { useClientStore } from "../store";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const MIN_CUDA_VERSION = "12.7";

export function CudaUpdateNotification() {
  const dependencyStatus = useClientStore((state) => state.dependencyStatus);
  const [dismissed, setDismissed] = useState(false);

  // Check if we should show the notification
  const nvidia = dependencyStatus?.nvidia;
  const shouldShow =
    nvidia?.available && nvidia.isOutdated && nvidia.cudaVersion && !dismissed;

  const handleDismiss = () => {
    setDismissed(true);
  };

  const handleUpdateDrivers = () => {
    // Open NVIDIA driver download page
    window.electronAPI.openExternal("https://www.nvidia.com/drivers");
  };

  if (!shouldShow) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 50, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        className="fixed bottom-6 right-6 z-50 w-96 shadow-2xl"
      >
        <Card className="border-amber-500/30 bg-amber-950/95 backdrop-blur-md shadow-[0_0_40px_-10px_rgba(245,158,11,0.3)] overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-500 via-orange-500 to-red-500" />

          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1.5 flex-1">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400">
                    <AlertTriangle size={16} />
                  </div>
                  <h3 className="font-semibold text-lg leading-none tracking-tight text-amber-100">
                    CUDA Outdated
                  </h3>
                </div>

                <div className="text-sm text-amber-200/80 pl-1">
                  Your CUDA version ({nvidia.cudaVersion}) is below the minimum
                  required version ({MIN_CUDA_VERSION}). Some AI features may
                  not work correctly.
                </div>

                {nvidia.gpu && (
                  <div className="mt-2 text-xs text-amber-300/60 bg-amber-950/50 p-2 rounded-md border border-amber-500/20">
                    GPU: {nvidia.gpu}
                  </div>
                )}
              </div>

              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 -mr-2 -mt-2 text-amber-400/60 hover:text-amber-100"
                onClick={handleDismiss}
              >
                <X size={16} />
              </Button>
            </div>

            <div className="mt-4 pt-2 flex items-center gap-3">
              <div className="flex w-full gap-2">
                <Button
                  variant="outline"
                  className="flex-1 border-amber-500/30 text-amber-200 hover:bg-amber-500/20 hover:text-amber-100"
                  onClick={handleDismiss}
                >
                  Dismiss
                </Button>
                <Button
                  onClick={handleUpdateDrivers}
                  className="flex-1 bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-900/20"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Update Drivers
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </AnimatePresence>
  );
}
