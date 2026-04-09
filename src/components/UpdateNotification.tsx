import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, RefreshCcw, X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface UpdateInfo {
  version: string;
  releaseNotes?: string;
}

interface UpdateProgress {
  percent: number;
}

function normalizeReleaseNotes(releaseNotes: string) {
  const parsed = new DOMParser().parseFromString(releaseNotes, "text/html");
  return (parsed.body.textContent || releaseNotes).trim();
}

export function UpdateNotification() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const cleanupAvailable = window.electronAPI.onUpdateAvailable((info) => {
      console.log("Update available:", info);
      setUpdateInfo(info);
      setDownloaded(false);
      setProgress(null);
      setDismissed(false);
    });

    const cleanupProgress = window.electronAPI.onUpdateProgress((prog) => {
      setProgress(prog);
    });

    const cleanupDownloaded = window.electronAPI.onUpdateDownloaded((info) => {
      console.log("Update downloaded:", info);
      setUpdateInfo(info);
      setDownloaded(true);
      setProgress(null);
    });

    return () => {
      cleanupAvailable();
      cleanupProgress();
      cleanupDownloaded();
    };
  }, []);

  const handleDownload = () => {
    window.electronAPI.downloadUpdate();
    // Optimistically show some progress state or rely on progress event
    setProgress({ percent: 0 });
  };

  const handleInstall = () => {
    window.electronAPI.installUpdate();
  };

  const handleDismiss = () => {
    setDismissed(true);
  };

  if (!updateInfo || dismissed) return null;

  const releaseNotes = updateInfo.releaseNotes
    ? normalizeReleaseNotes(updateInfo.releaseNotes)
    : null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 50, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        className="fixed bottom-6 right-6 z-50 w-96 shadow-2xl"
      >
        <Card className="border-primary/20 bg-background/95 backdrop-blur-md shadow-[0_0_40px_-10px_rgba(0,0,0,0.3)] overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500" />
          
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1.5 flex-1">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                    <Sparkles size={16} />
                  </div>
                  <h3 className="font-semibold text-lg leading-none tracking-tight">
                    {downloaded ? "Update Ready" : "New Version Available"}
                  </h3>
                </div>
                
                <div className="text-sm text-muted-foreground pl-1">
                  {downloaded 
                    ? `Version ${updateInfo.version} is ready to install.`
                    : `Version ${updateInfo.version} includes the latest DGN client updates.`
                  }
                </div>
                
                {releaseNotes && !downloaded && !progress && (
                  <div className="mt-2 text-xs text-muted-foreground/80 bg-muted/50 p-2 rounded-md max-h-24 overflow-y-auto custom-scrollbar border border-border/50">
                    <pre className="whitespace-pre-wrap break-words font-sans">
                      {releaseNotes}
                    </pre>
                  </div>
                )}
              </div>
              
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 -mr-2 -mt-2 text-muted-foreground hover:text-foreground"
                onClick={handleDismiss}
              >
                <X size={16} />
              </Button>
            </div>

            <div className="mt-4 pt-2 flex items-center gap-3">
              {downloaded ? (
                <Button 
                  onClick={handleInstall} 
                  className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white shadow-lg shadow-green-900/20"
                >
                  <RefreshCcw className="mr-2 h-4 w-4 animate-spin-slow" />
                  Restart & Install
                </Button>
              ) : progress ? (
                <div className="w-full space-y-2">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Downloading...</span>
                    <span>{Math.round(progress.percent)}%</span>
                  </div>
                  <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                    <motion.div 
                      className="h-full bg-primary"
                      initial={{ width: 0 }}
                      animate={{ width: `${progress.percent}%` }}
                      transition={{ duration: 0.2 }}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex w-full gap-2">
                  <Button 
                    variant="outline" 
                    className="flex-1"
                    onClick={handleDismiss}
                  >
                    Later
                  </Button>
                  <Button 
                    onClick={handleDownload} 
                    className="flex-1 bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </AnimatePresence>
  );
}
