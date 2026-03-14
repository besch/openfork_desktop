import { useState, useEffect, useCallback } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProjectSelection } from "./ProjectSelection";
import { UserSelection } from "./UserSelection";
import { Label } from "@/components/ui/label";
import { motion, AnimatePresence } from "framer-motion";
import { Globe, Lock, Layout, Users, DollarSign, Clock, Zap } from "lucide-react";
import type { Project, Profile, JobPolicy } from "@/types";

interface JobPolicySettingsProps {
  jobPolicy: JobPolicy;
  onJobPolicyChange: (policy: JobPolicy) => void;
  selectedProjects: Project[];
  onSelectedProjectsChange: (projects: Project[]) => void;
  selectedUsers: Profile[];
  onSelectedUsersChange: (users: Profile[]) => void;
  disabled?: boolean;
}

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

export function JobPolicySettings({
  jobPolicy,
  onJobPolicyChange,
  selectedProjects,
  onSelectedProjectsChange,
  selectedUsers,
  onSelectedUsersChange,
  disabled,
}: JobPolicySettingsProps) {
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

  const policyInfo: Record<JobPolicy, { title: string; description: string; icon: any }> = {
    all: {
      title: "Global",
      description: "Share your GPU and use any GPU on the network",
      icon: Globe,
    },
    mine: {
      title: "Private",
      description: "Reserved for your tasks only",
      icon: Lock,
    },
    project: {
      title: "Project",
      description: "Authorized projects only",
      icon: Layout,
    },
    users: {
      title: "Users",
      description: "Trusted collaborators only",
      icon: Users,
    },
    monetize: {
      title: "Monetize",
      description: "Earn real money — paid jobs only",
      icon: DollarSign,
    },
  };

  const currentInfo = policyInfo[jobPolicy];
  const Icon = currentInfo.icon;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Job Acceptance Column */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Job Acceptance</Label>
              <p className="text-[10px] text-muted-foreground leading-tight">
                Who can run jobs on your machine
              </p>
            </div>
            
            <Select
              value={jobPolicy}
              onValueChange={(value) => onJobPolicyChange(value as JobPolicy)}
              disabled={disabled}
            >
              <SelectTrigger className="w-32 h-8 text-xs">
                <SelectValue placeholder="Policy" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All Public</SelectItem>
                <SelectItem value="mine" className="text-xs">Only Mine</SelectItem>
                <SelectItem value="project" className="text-xs">By Project</SelectItem>
                <SelectItem value="users" className="text-xs">By User</SelectItem>
                <SelectItem value="monetize" className="text-xs">Monetize</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={jobPolicy}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.15 }}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border w-full ${jobPolicy === "monetize" ? "bg-amber-500/10 border-amber-500/20 text-amber-500" : "bg-muted/30 border-border/40 text-foreground/80"}`}
            >
              <Icon size={12} className={jobPolicy === "monetize" ? "text-amber-500" : "text-muted-foreground"} />
              <span className="text-[10.5px] font-medium leading-none">
                {currentInfo.description}
              </span>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Auto-Start Column */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Auto-Start</Label>
              <p className="text-[10px] text-muted-foreground leading-tight">
                When the engine starts automatically
              </p>
            </div>
            
            <Select
              value={config.mode}
              onValueChange={(value: ScheduleMode) => saveConfig({ ...config, mode: value })}
              disabled={disabled}
            >
              <SelectTrigger className="w-32 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual" className="text-xs">
                  <div className="flex items-center gap-2">
                    <Clock size={12} />
                    Manual
                  </div>
                </SelectItem>
                <SelectItem value="always" className="text-xs">
                  <div className="flex items-center gap-2">
                    <Zap size={12} />
                    Always On
                  </div>
                </SelectItem>
                <SelectItem value="scheduled" className="text-xs">
                  <div className="flex items-center gap-2">
                    <Clock size={12} />
                    Scheduled
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="h-8 flex items-center">
            {config.mode === "scheduled" ? (
              <div className="flex items-center gap-2 w-full">
                <span className="text-[10px] text-muted-foreground">From</span>
                <Select
                  value={config.startTime}
                  onValueChange={(v) => saveConfig({ ...config, startTime: v })}
                >
                  <SelectTrigger className="h-7 w-[70px] text-[10px] px-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HOURS.map((h) => (
                      <SelectItem key={h.value} value={h.value} className="text-[10px]">{h.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-[10px] text-muted-foreground">to</span>
                <Select
                  value={config.endTime}
                  onValueChange={(v) => saveConfig({ ...config, endTime: v })}
                >
                  <SelectTrigger className="h-7 w-[70px] text-[10px] px-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HOURS.map((h) => (
                      <SelectItem key={h.value} value={h.value} className="text-[10px]">{h.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-border/40 bg-muted/30 w-full">
                <Clock size={12} className="text-muted-foreground" />
                <span className="text-[10.5px] font-medium text-foreground/60">
                  {config.mode === "manual" ? "Control manually" : "Run whenever app is open"}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {jobPolicy === "project" && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="pl-4 border-l border-border/50 overflow-hidden"
          >
            <ProjectSelection
              selectedProjects={selectedProjects}
              onSelectedProjectsChange={onSelectedProjectsChange}
              disabled={disabled}
            />
          </motion.div>
        )}

        {jobPolicy === "users" && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="pl-4 border-l border-border/50 overflow-hidden"
          >
            <UserSelection
              selectedUsers={selectedUsers}
              onSelectedUsersChange={onSelectedUsersChange}
              disabled={disabled}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}