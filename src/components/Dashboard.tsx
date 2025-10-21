import React, { useState, useCallback, memo, useMemo } from "react";
import { useClientStore } from "@/store";
import { Button } from "@/components/ui/button-new";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card-new";
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
import { JobPolicySettings, type JobPolicy } from "./JobPolicySettings";
import type { Project } from "@/types";

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
    <Card className="bg-card/80 backdrop-blur-sm transition-all duration-300 hover:bg-card hover:shadow-xl group">
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
      className: "text-green-400",
      icon: <Power size={16} />,
    },
    stopped: {
      text: "Stopped",
      className: "text-muted-foreground",
      icon: <Power size={16} />,
    },
    starting: {
      text: "Starting...",
      className: "text-yellow-400",
      icon: <Loader size={16} className="animate-spin" />,
    },
    stopping: {
      text: "Stopping...",
      className: "text-orange-400",
      icon: <Loader size={16} className="animate-spin" />,
    },
    error: {
      text: "Error",
      className: "text-destructive",
      icon: <AlertCircle size={16} />,
    },
  };

  const { text, className, icon } = statusConfig[status];

  return (
    <div
      className={`flex items-center space-x-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-background/80 border border-border ${className}`}
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
        backgroundColor: "oklch(0.65 0.15 145)", // Warm green
        boxShadow: "0px 4px 15px oklch(0.65 0.15 145 / 0.4)",
      },
      on: {
        backgroundColor: "oklch(0.68 0.18 35)", // Warm orange
        boxShadow: "0px 4px 15px oklch(0.68 0.18 35 / 0.4)",
      },
      starting: {
        backgroundColor: "oklch(0.87 0.22 88.5)", // Yellow
        boxShadow: "0px 4px 15px oklch(0.87 0.22 88.5 / 0.4)",
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
  const { status, stats, services } = useClientStore();
  const [service, setService] = useState("auto");
  const [selectedProjects, setSelectedProjects] = useState<Project[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [jobPolicy, setJobPolicy] = useState<JobPolicy>("mine");

  const isRunning = status === "running" || status === "starting";
  const isDisabled = status === "starting" || status === "stopping";

  const allowedIds = useMemo(() => {
    if (jobPolicy === "project") {
      return selectedProjects.map((p) => p.id).join(",");
    }
    return "";
  }, [selectedProjects, jobPolicy]);

  const handleToggle = useCallback(
    (checked: boolean) => {
      if (isDisabled) return;

      if (checked) {
        window.electronAPI.startClient(service, jobPolicy, allowedIds);
      } else {
        window.electronAPI.stopClient();
      }
    },
    [isDisabled, service, jobPolicy, allowedIds]
  );

  const isProcessingAndRunning = status === "running" && stats.processing > 0;

  return (
    <div className="space-y-6">
      <header className="bg-card/80 backdrop-blur-sm border border-border/50 rounded-xl p-6 shadow-lg">
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
            variant="outline"
            onClick={() => setIsSettingsOpen((prev) => !prev)}
            className="bg-background/50 cursor-pointer"
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
            <Card className="bg-card/80 backdrop-blur-sm">
              <CardContent className="p-6 space-y-6">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">
                    Workflows:
                  </span>
                  <Select
                    value={service}
                    onValueChange={setService}
                    disabled={isRunning || isDisabled}
                  >
                    <SelectTrigger className="w-48 bg-background/50">
                      <SelectValue placeholder="Workflows" />
                    </SelectTrigger>
                    <SelectContent>
                      {services.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <JobPolicySettings
                  jobPolicy={jobPolicy}
                  onJobPolicyChange={setJobPolicy}
                  selectedProjects={selectedProjects}
                  onSelectedProjectsChange={setSelectedProjects}
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
          className="text-destructive"
        />
      </div>
    </div>
  );
});
