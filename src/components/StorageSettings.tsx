import { useState, useEffect } from "react";
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
import { HardDrive, RefreshCw, AlertTriangle, Loader2, ArrowRightLeft } from "lucide-react";

export function StorageSettings() {
  const [diskInfo, setDiskInfo] = useState<{free_gb: string, used_gb: string, total_gb: string, path: string} | null>(null);
  const [availableDrives, setAvailableDrives] = useState<{name: string, freeGB: number}[]>([]);
  const [selectedDrive, setSelectedDrive] = useState<string>("");
  const [isReclaiming, setIsReclaiming] = useState(false);
  const [isRelocating, setIsRelocating] = useState(false);
  const [dockerStatus, setDockerStatus] = useState<{installed: boolean, running: boolean, installDrive?: string} | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshData = async () => {
    try {
      const info = await window.electronAPI.getDiskSpace();
      if (info.success) setDiskInfo(info.data);
      
      const drives = await window.electronAPI.getAvailableDrives();
      setAvailableDrives(drives);

      const status = await window.electronAPI.checkDocker();
      setDockerStatus(status);
      
      // Default to current install drive if known
      if (status?.installDrive) {
        setSelectedDrive(status.installDrive);
      }
    } catch (e) {
      console.error("Failed to refresh storage data:", e);
    }
  };

  useEffect(() => {
    refreshData();
  }, []);

  const handleReclaim = async () => {
    if (isReclaiming) return;
    setIsReclaiming(true);
    setError(null);
    try {
      const result = await window.electronAPI.reclaimDiskSpace();
      if (!result.success) setError(result.error || "Reclaim failed");
      await refreshData();
    } finally {
      setIsReclaiming(false);
    }
  };

  const handleRelocate = async () => {
    if (!selectedDrive || isRelocating) return;
    
    const confirm = window.confirm(
      `WARNING: This will DELETE all current Docker data and images to reclaim space on your current drive, then start fresh on ${selectedDrive}: drive.\n\nAre you sure you want to proceed?`
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
      }
    } finally {
      setIsRelocating(false);
    }
  };

  return (
    <Card className="card overflow-hidden border-primary/20 bg-card/40 backdrop-blur-md">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between border-b border-white/5 pb-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-primary/10 border border-primary/20">
              <HardDrive className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-tight">Storage Management</h3>
              <p className="text-[10px] text-muted-foreground font-medium">Configure WSL Disk Location & Space</p>
            </div>
          </div>
          {diskInfo && (
            <div className="flex flex-col items-end">
              <div className="text-[9px] text-white bg-primary font-mono uppercase tracking-widest px-2 py-0.5 rounded border border-primary/10">
                Using disk {diskInfo.path}
              </div>
              <div className="text-[10px] font-semibold text-foreground/80">
                {diskInfo.free_gb} GB Free / {diskInfo.total_gb} GB
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          {/* Reclaim Section */}
          <div className="space-y-2">
            <div className="space-y-0.5">
              <Label className="text-xs font-bold flex items-center gap-1.5">
                <RefreshCw className="h-3 w-3 text-primary" />
                Space Reclamation
              </Label>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Reclaim unused space from the WSL disk file.
              </p>
            </div>
            <Button 
              variant="primary" 
              size="sm" 
              className="px-4 h-8 text-[11px]"
              onClick={handleReclaim}
              disabled={isReclaiming || isRelocating}
            >
              {isReclaiming ? (
                <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 mr-2" />
              )}
              {isReclaiming ? "Compacting..." : "Optimize Now"}
            </Button>
          </div>

          {/* Relocation Section */}
          <div className="space-y-2 md:border-l md:pl-4 border-white/5">
            <div className="space-y-0.5">
              <Label className="text-xs font-bold flex items-center gap-1.5">
                <ArrowRightLeft className="h-3 w-3 text-primary" />
                Relocate Engine
              </Label>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Move everything to another drive. <span className="text-orange-400 font-medium italic">Wipes images.</span>
              </p>
            </div>
            
            <div className="flex gap-2 items-center">
              <div className="flex-1 min-w-0">
                <Select 
                  value={selectedDrive}
                  onValueChange={setSelectedDrive}
                  disabled={isRelocating}
                >
                  <SelectTrigger className="w-full h-8 text-[11px] bg-background/50 border-white/10 hover:bg-background/80 transition-colors">
                    <SelectValue placeholder="Select Drive" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableDrives.map(d => {
                      const isInstalledHere = dockerStatus?.installDrive === d.name;
                      return (
                        <SelectItem 
                          key={d.name} 
                          value={d.name} 
                          disabled={isInstalledHere}
                          className="text-[11px]"
                        >
                          <div className="flex items-center justify-between w-full gap-4">
                            <span>{d.name}: Drive</span>
                            <span className="text-[10px] opacity-50">({d.freeGB} GB free)</span>
                            {isInstalledHere && <span className="text-[9px] text-primary font-bold ml-auto">ACTIVE</span>}
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
                className="px-4 h-8 text-[11px] flex-shrink-0"
                onClick={handleRelocate}
                disabled={!selectedDrive || selectedDrive === dockerStatus?.installDrive || isRelocating || isReclaiming}
              >
                {isRelocating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Move"}
              </Button>
            </div>
          </div>
        </div>

        {error && (
          <motion.div 
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-2 rounded-md bg-destructive-foreground border border-destructive/20 flex items-center gap-2 text-destructive"
          >
            <AlertTriangle className="h-3 w-3 flex-shrink-0" />
            <span className="text-[10px] text-white font-medium">{error}</span>
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}
