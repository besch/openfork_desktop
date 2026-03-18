import React, { useState, useCallback, memo, useMemo, useEffect } from "react";
import { useClientStore } from "@/store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader } from "@/components/ui/loader";
import {
  CheckCircle,
  XCircle,
  Server,
  Power,
  AlertCircle,
  Play,
  Pause,
  Settings,
  RefreshCw,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { JobPolicySettings } from "./JobPolicySettings";
import type { Project, Profile, JobPolicy } from "@/types";

const StatCard = memo(
  ({
    title,
    value,
    icon,
    className,
  }: {
    title: string;
    value: number;
    icon: React.ReactNode;
    className?: string;
  }) => (
    <Card
      className={`relative overflow-hidden border-white/15 bg-surface/40 backdrop-blur-md ${className || ""}`}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent" />
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative z-10">
        <CardTitle className="text-[10px] sm:text-xs font-black uppercase tracking-[0.2em] text-white/60">
          {title}
        </CardTitle>
        <div className="p-2.5 rounded-lg bg-white/5 border border-white/5">
          {icon}
        </div>
      </CardHeader>
      <CardContent className="relative z-10 pb-3">
        <div className="text-xl font-black tracking-tighter text-white drop-shadow-2xl">
          {value.toLocaleString()}
        </div>
      </CardContent>
    </Card>
  ),
);

export const StatusIndicator = memo(() => {
  const status = useClientStore((state) => state.status);

  const statusConfig = {
    running: {
      text: "ONLINE",
      className:
        "text-emerald-400 border-emerald-400/20 bg-emerald-400/5 shadow-[0_0_15px_rgba(16,185,129,0.1)]",
      icon: <Power size={14} className="animate-pulse" />,
    },
    stopped: {
      text: "OFFLINE",
      className: "text-white/30 border-white/5 bg-white/5",
      icon: <Power size={14} />,
    },
    starting: {
      text: "INITIALIZING",
      className:
        "text-amber-400 border-amber-400/20 bg-amber-400/5 shadow-[0_0_15px_rgba(251,191,36,0.1)]",
      icon: <Loader size="sm" />,
    },
    stopping: {
      text: "TERMINATING",
      className:
        "text-orange-400 border-orange-400/20 bg-orange-400/5 shadow-[0_0_15px_rgba(251,146,60,0.1)]",
      icon: <Loader size="sm" />,
    },
    error: {
      text: "ERROR",
      className:
        "text-destructive border-destructive/20 bg-destructive/5 shadow-[0_0_15px_rgba(239,68,68,0.1)]",
      icon: <AlertCircle size={14} />,
    },
  };

  const { text, className, icon } = statusConfig[status];

  return (
    <div
      className={`flex items-center space-x-2.5 px-4 py-2 rounded-lg text-[10px] font-black tracking-widest border transition-all duration-500 backdrop-blur-md ${className}`}
    >
      <div className="flex-shrink-0">{icon}</div>
      <span>{text}</span>
    </div>
  );
});

const PowerButton = memo(
  ({
    isRunning,
    isDisabled,
    onToggle,
    status,
  }: {
    isRunning: boolean;
    isDisabled: boolean;
    onToggle: (checked: boolean) => void;
    status: string;
  }) => {
    const buttonVariants = {
      off: {
        backgroundColor: "#22c55e", // Green
        boxShadow: "0px 4px 15px rgba(34, 197, 94, 0.4)",
      },
      on: {
        backgroundColor: "#ef4444", // Red
        boxShadow: "0px 4px 15px rgba(239, 68, 68, 0.4)",
      },
      starting: {
        backgroundColor: "#eab308", // Yellow
        boxShadow: "0px 4px 15px rgba(234, 179, 8, 0.4)",
      },
    };

    const iconAnimation = {
      initial: { opacity: 0, scale: 0.5 },
      animate: { opacity: 1, scale: 1 },
      exit: { opacity: 0, scale: 0.5, transition: { duration: 0.2 } },
    };

    const animationState =
      status === "starting" ? "starting" : isRunning ? "on" : "off";

    return (
      <motion.button
        onClick={() => onToggle(!isRunning)}
        disabled={isDisabled}
        className="relative w-16 h-16 rounded-full flex items-center justify-center text-primary-foreground shadow-lg disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:ring-ring cursor-pointer"
        initial={animationState}
        animate={animationState}
        variants={buttonVariants}
        transition={{ duration: 0.5, type: "spring" }}
        whileHover={{ scale: isDisabled ? 1 : 1.05 }}
        whileTap={{ scale: isDisabled ? 1 : 0.95 }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {isDisabled ? (
            <motion.div key="loader" {...iconAnimation}>
              <Loader size="md" />
            </motion.div>
          ) : isRunning ? (
            <motion.div key="pause" {...iconAnimation}>
              <Pause size={24} className="text-white" />
            </motion.div>
          ) : (
            <motion.div key="play" {...iconAnimation}>
              <Play size={24} className="ml-1 text-white" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>
    );
  },
);

export const Dashboard = memo(() => {
  const {
    status,
    stats,
    jobPolicy,
    setSubscriptionPolicy,
    setJobPolicy,
    loadPersistentSettings,
    savePersistentSettings,
  } = useClientStore();
  // Subscribe to jobState for local status
  const jobState = useClientStore((state) => state.jobState);

  const [selectedProjects, setSelectedProjects] = useState<Project[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<Profile[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Load persistent settings on component mount
  useEffect(() => {
    loadPersistentSettings();
  }, [loadPersistentSettings]);

  // Use the job policy from the store instead of local state
  const jobPolicyState = jobPolicy;

  const isRunning = status === "running" || status === "starting";
  const isDisabled = status === "starting" || status === "stopping";

  const allowedIds = useMemo(() => {
    if (jobPolicyState === "project") {
      return selectedProjects.map((p) => p.id).join(",");
    }
    if (jobPolicyState === "users") {
      return selectedUsers.map((u) => u.id).join(",");
    }
    return "";
  }, [selectedProjects, selectedUsers, jobPolicyState]);

  useEffect(() => {
    setSubscriptionPolicy(jobPolicyState, allowedIds);
  }, [jobPolicyState, allowedIds, setSubscriptionPolicy]);

  const handleToggle = useCallback(
    (checked: boolean) => {
      if (isDisabled) return;

      if (checked) {
        window.electronAPI.startClient("auto", jobPolicy, allowedIds);
      } else {
        window.electronAPI.stopClient();
      }
    },
    [isDisabled, jobPolicy, allowedIds],
  );

  const handleJobPolicyChange = (policy: JobPolicy) => {
    setJobPolicy(policy);
    savePersistentSettings();
  };

  const isProcessingAndRunning =
    status === "running" && jobState.status === "processing";

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="bg-surface/50 backdrop-blur-md border border-white/20 rounded-lg p-3 shadow-xl">
        <div className="flex flex-wrap items-center content-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <PowerButton
              isRunning={isRunning}
              isDisabled={isDisabled}
              onToggle={handleToggle}
              status={status}
            />
            <div className="ml-1">
              <StatusIndicator />
            </div>
          </div>

          <Button
            variant="primary"
            onClick={() => setIsSettingsOpen((prev) => !prev)}
          >
            <Settings className="mr-1.5 h-3.5 w-3.5" />
            <span>Settings</span>
          </Button>
        </div>
      </header>

      <AnimatePresence>
        {isSettingsOpen && (
          <motion.section
            key="settings-panel"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <Card className="bg-card/50 backdrop-blur-sm border-white/10">
              <CardContent className="p-6 space-y-6">
                <JobPolicySettings
                  jobPolicy={jobPolicyState}
                  onJobPolicyChange={handleJobPolicyChange}
                  selectedProjects={selectedProjects}
                  onSelectedProjectsChange={setSelectedProjects}
                  selectedUsers={selectedUsers}
                  onSelectedUsersChange={setSelectedUsers}
                  disabled={isRunning || isDisabled}
                />
              </CardContent>
            </Card>
          </motion.section>
        )}
      </AnimatePresence>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="In Queue"
          value={stats.pending}
          icon={<Server size={20} className="text-muted-foreground" />}
          className="text-yellow-400"
        />
        <StatCard
          title="In Progress"
          value={isProcessingAndRunning ? 1 : 0}
          icon={
            <RefreshCw
              size={20}
              className={`text-muted-foreground ${
                isProcessingAndRunning ? "animate-spin" : ""
              }`}
            />
          }
          className="text-blue-400"
        />
        <StatCard
          title="Completed"
          value={stats.completed}
          icon={<CheckCircle size={20} className="text-muted-foreground" />}
          className="text-green-400"
        />
        <StatCard
          title="Failed"
          value={stats.failed}
          icon={<XCircle size={20} className="text-muted-foreground" />}
          className="text-destructive-foreground"
        />
      </div>
    </div>
  );
});
