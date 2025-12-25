import { useState, useEffect, useCallback, memo } from "react";
import { Label } from "@/components/ui/label";
import { Clock, Zap } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ScheduleMode = "manual" | "always" | "scheduled";

interface ScheduleConfig {
  mode: ScheduleMode;
  startTime?: string;
  endTime?: string;
}

const HOURS = Array.from({ length: 24 }, (_, i) => {
  const hour = i.toString().padStart(2, "0");
  return { value: `${hour}:00`, label: `${hour}:00` };
});

export const AutoScheduleSettings = memo(() => {
  const [config, setConfig] = useState<ScheduleConfig>({
    mode: "manual",
    startTime: "22:00",
    endTime: "08:00",
  });

  useEffect(() => {
    const loadConfig = async () => {
      const savedConfig = await window.electronAPI.getScheduleConfig();
      if (savedConfig) {
        let mode: ScheduleMode = "manual";
        let startTime = "22:00";
        let endTime = "08:00";
        
        if (savedConfig.mode === "scheduled") {
          const schedule = savedConfig.schedules?.[0];
          if (schedule?.startTime === "00:00" && schedule?.endTime === "23:59") {
            mode = "always";
          } else if (schedule) {
            mode = "scheduled";
            startTime = schedule.startTime || "22:00";
            endTime = schedule.endTime || "08:00";
          }
        }
        
        setConfig({ mode, startTime, endTime });
      }
    };
    loadConfig();
  }, []);

  const saveConfig = useCallback(async (newConfig: ScheduleConfig) => {
    setConfig(newConfig);
    
    let fullConfig;
    switch (newConfig.mode) {
      case "always":
        fullConfig = {
          mode: "scheduled" as const,
          schedules: [{ startTime: "00:00", endTime: "23:59", days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] }],
        };
        break;
      case "scheduled":
        fullConfig = {
          mode: "scheduled" as const,
          schedules: [{ 
            startTime: newConfig.startTime || "22:00", 
            endTime: newConfig.endTime || "08:00", 
            days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] 
          }],
        };
        break;
      default:
        fullConfig = {
          mode: "manual" as const,
          schedules: [],
        };
    }
    
    await window.electronAPI.setScheduleConfig(fullConfig);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">Auto-Start</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            {config.mode === "manual" && "Control manually"}
            {config.mode === "always" && "Run whenever app is open"}
            {config.mode === "scheduled" && `Run ${config.startTime} - ${config.endTime}`}
          </p>
        </div>
        <Select
          value={config.mode}
          onValueChange={(value: ScheduleMode) => saveConfig({ ...config, mode: value })}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="manual">
              <div className="flex items-center gap-2">
                <Clock size={14} />
                Manual
              </div>
            </SelectItem>
            <SelectItem value="always">
              <div className="flex items-center gap-2">
                <Zap size={14} />
                Always On
              </div>
            </SelectItem>
            <SelectItem value="scheduled">
              <div className="flex items-center gap-2">
                <Clock size={14} />
                Scheduled
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {config.mode === "scheduled" && (
        <div className="flex items-center gap-3 pl-4 border-l-2 border-border/50">
          <Label className="text-sm whitespace-nowrap">From</Label>
          <Select
            value={config.startTime}
            onValueChange={(v) => saveConfig({ ...config, startTime: v })}
          >
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOURS.map((h) => (
                <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Label className="text-sm">to</Label>
          <Select
            value={config.endTime}
            onValueChange={(v) => saveConfig({ ...config, endTime: v })}
          >
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOURS.map((h) => (
                <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
});
