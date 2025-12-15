import React, { useState, useCallback, memo, useMemo, useEffect } from "react";
import { useClientStore } from "@/store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CheckCircle,
  XCircle,
  Loader,
  Server,
  Power,
  AlertCircle,
  Play,
  Pause,
  Settings,
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
    <Card className="transition-all duration-300 hover:shadow-xl group border-white/10 bg-card/50 backdrop-blur-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors duration-200">
          {title}
        </CardTitle>
        <div className="p-2 rounded-lg bg-muted/50 group-hover:bg-muted transition-colors duration-200">
          {icon}
        </div>
      </CardHeader>
      <CardContent>
        <div
          className={`text-3xl font-bold ${className} transition-all duration-300`}
        >
          {value.toLocaleString()}
        </div>
      </CardContent>
    </Card>
  )
);

export const StatusIndicator = memo(() => {
  const status = useClientStore((state) => state.status);

  const statusConfig = {
    running: {
      text: "Running",
      className: "text-green-400 border-green-400/20 bg-green-400/10",
      icon: <Power size={16} />,
    },
    stopped: {
      text: "Stopped",
      className: "text-muted-foreground border-border bg-muted/10",
      icon: <Power size={16} />,
    },
    starting: {
      text: "Starting...",
      className: "text-yellow-400 border-yellow-400/20 bg-yellow-400/10",
      icon: <Loader size={16} className="animate-spin" />,
    },
    stopping: {
      text: "Stopping...",
      className: "text-orange-400 border-orange-400/20 bg-orange-400/10",
      icon: <Loader size={16} className="animate-spin" />,
    },
    error: {
      text: "Error",
      className: "text-destructive border-destructive/20 bg-destructive/10",
      icon: <AlertCircle size={16} />,
    },
  };

  const { text, className, icon } = statusConfig[status];

  return (
    <div
      className={`flex items-center space-x-2 px-3 py-1.5 rounded-full text-xs font-semibold border ${className}`}
    >
      {icon}
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
              <Loader size={24} className="animate-spin" />
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
  }
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
  const service = "auto"; // Always use 'auto' mode with GenericComfyWorkflowProcessor
  const [selectedProjects, setSelectedProjects] = useState<Project[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<Profile[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Load persistent settings on component mount
  useEffect(() => {
    loadPersistentSettings();
  }, [loadPersistentSettings]);

  // Save settings whenever job policy or ComfyUI settings change
  useEffect(() => {
    savePersistentSettings();
  }, [jobPolicy, savePersistentSettings]);

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
        const comfyuiSettings = {
          useDocker: true,
        };
        window.electronAPI.startClient(service, jobPolicy, allowedIds, comfyuiSettings);
      } else {
        window.electronAPI.stopClient();
      }
    },
    [isDisabled, service, jobPolicy, allowedIds]
  );

  const handleJobPolicyChange = (policy: JobPolicy) => {
    setJobPolicy(policy);
  };

  const isProcessingAndRunning = status === "running" && stats.processing > 0;

  return (
    <div className="space-y-6">
      <header className="bg-card/50 backdrop-blur-sm border border-white/10 rounded-xl p-6 shadow-lg">
        <div className="flex flex-wrap items-center content-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <PowerButton
              isRunning={isRunning}
              isDisabled={isDisabled}
              onToggle={handleToggle}
              status={status}
            />
            <div>
              <div className="mt-1 ml-4">
                <StatusIndicator />
              </div>
            </div>
          </div>

          <Button
            variant="primary"
            onClick={() => setIsSettingsOpen((prev) => !prev)}
          >
            <Settings className="mr-2 h-4 w-4" />
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
          value={stats.processing}
          icon={
            <Loader
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
