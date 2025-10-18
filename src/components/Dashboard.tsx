import React, { useState, useCallback, memo } from "react";
import { useClientStore } from "@/store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import {
  CheckCircle,
  XCircle,
  Loader,
  Server,
  Power,
  AlertCircle,
  Play,
  Pause,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { JobPolicySettings } from "./JobPolicySettings";

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
    <Card className="bg-card/80 backdrop-blur-sm transition-all duration-300 hover:border-primary/50 hover:bg-card">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className={`text-3xl font-bold ${className}`}>{value}</div>
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
  }: {
    isRunning: boolean;
    isDisabled: boolean;
    onToggle: (checked: boolean) => void;
  }) => {
    const buttonVariants = {
      off: {
        backgroundColor: "oklch(0.6 0.2 140)", // Green
        boxShadow: "0px 4px 15px oklch(0.6 0.2 140 / 0.3)",
      },
      on: {
        backgroundColor: "oklch(0.7 0.2 15)", // Red
        boxShadow: "0px 4px 15px oklch(0.7 0.2 15 / 0.3)",
      },
    };

    const iconAnimation = {
      initial: { opacity: 0, scale: 0.5 },
      animate: { opacity: 1, scale: 1 },
      exit: { opacity: 0, scale: 0.5, transition: { duration: 0.2 } },
    };

    return (
      <motion.button
        onClick={() => onToggle(!isRunning)}
        disabled={isDisabled}
        className="relative w-16 h-16 rounded-full flex items-center justify-center text-primary-foreground shadow-lg disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:ring-ring"
        initial={isRunning ? "on" : "off"}
        animate={isRunning ? "on" : "off"}
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
              <Pause size={24} />
            </motion.div>
          ) : (
            <motion.div key="play" {...iconAnimation}>
              <Play size={24} className="ml-1" />
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
  const [policy, setPolicy] = useState("own");
  const [allowedIds, setAllowedIds] = useState("");

  const isRunning = status === "running" || status === "starting";
  const isDisabled = status === "starting" || status === "stopping";

  const handleToggle = useCallback(
    (checked: boolean) => {
      if (isDisabled) return;

      if (checked) {
        window.electronAPI.startClient(service, policy, allowedIds);
      } else {
        window.electronAPI.stopClient();
      }
    },
    [isDisabled, service, policy, allowedIds]
  );

  const isProcessingAndRunning = status === "running" && stats.processing > 0;

  return (
    <div className="space-y-6">
      <header className="bg-card/80 backdrop-blur-sm border border-gray-700 rounded-lg p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <PowerButton
              isRunning={isRunning}
              isDisabled={isDisabled}
              onToggle={handleToggle}
            />
            <div>
              <h1 className="text-xl font-bold tracking-tighter">DGN Client</h1>
              <div className="mt-1">
                <StatusIndicator />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-4">
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">Workflows:</span>
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
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">Job Policy:</span>
              <Select
                value={policy}
                onValueChange={setPolicy}
                disabled={isRunning || isDisabled}
              >
                <SelectTrigger className="w-48 bg-background/50">
                  <SelectValue placeholder="Select a policy" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="own">Only My Jobs</SelectItem>
                  <SelectItem value="public">Everyone</SelectItem>
                  <SelectItem value="specific_projects">
                    Only Specific Projects
                  </SelectItem>
                  <SelectItem value="specific_branches">
                    Only Specific Branches
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <JobPolicySettings
          policy={policy}
          allowedIds={allowedIds}
          setAllowedIds={setAllowedIds}
          isDisabled={isRunning || isDisabled}
        />
      </header>

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
