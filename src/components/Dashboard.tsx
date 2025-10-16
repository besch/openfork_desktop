import React, { useState, useCallback, memo } from "react";
import { useClientStore } from "@/store";
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
    <Card className="bg-gray-100 dark:bg-gray-800/50 backdrop-blur-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-gray-500 dark:text-gray-400">
          {title}
        </CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${className}`}>{value}</div>
      </CardContent>
    </Card>
  )
);

export const StatusIndicator = memo(() => {
  const status = useClientStore((state) => state.status);

  const statusConfig = {
    running: {
      text: "Client is Running",
      className: "text-green-500 dark:text-green-400",
      icon: <Power size={20} />,
    },
    stopped: {
      text: "Client is Stopped",
      className: "text-gray-500 dark:text-gray-400",
      icon: <Power size={20} />,
    },
    starting: {
      text: "Starting...",
      className: "text-yellow-500 dark:text-yellow-400",
      icon: <Loader size={20} className="animate-spin" />,
    },
    stopping: {
      text: "Stopping...",
      className: "text-orange-500 dark:text-orange-400",
      icon: <Loader size={20} className="animate-spin" />,
    },
    error: {
      text: "Error State",
      className: "text-red-500 dark:text-red-400",
      icon: <AlertCircle size={20} />,
    },
  };

  const { text, className, icon } = statusConfig[status];

  return (
    <div
      className={`flex items-center space-x-2 p-3 rounded-lg bg-white/30 dark:bg-gray-900/30 backdrop-blur-sm ${className}`}
    >
      {icon}
      <span className="font-semibold">{text}</span>
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
      off: { backgroundColor: "hsl(142.1 70.6% 30.2%)" }, // green-700
      on: { backgroundColor: "hsl(24.6, 95.2%, 47.1%)" }, // orange-700
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
        className="relative w-28 h-28 rounded-full flex items-center justify-center text-white shadow-lg disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 focus-visible:ring-white cursor-pointer"
        initial={isRunning ? "on" : "off"}
        animate={isRunning ? "on" : "off"}
        variants={buttonVariants}
        transition={{ duration: 0.5 }}
        whileHover={{ scale: isDisabled ? 1 : 1.05 }}
        whileTap={{ scale: isDisabled ? 1 : 0.95 }}
      >
        {isRunning && !isDisabled && (
          <motion.div
            className="absolute w-full h-full rounded-full bg-orange-700/30"
            initial={{ scale: 0, opacity: 0.5 }}
            animate={{
              scale: 0.8,
              opacity: 0,
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: "easeOut",
              repeatDelay: 0.5,
            }}
          />
        )}
        <AnimatePresence mode="wait" initial={false}>
          {isDisabled ? (
            <motion.div key="loader" {...iconAnimation}>
              <div className="w-20 h-20 rounded-full flex items-center justify-center bg-black/20">
                <Loader size={40} className="animate-spin" />
              </div>
            </motion.div>
          ) : isRunning ? (
            <motion.div key="pause" {...iconAnimation}>
              <div className="w-20 h-20 rounded-full flex items-center justify-center bg-black/20">
                <Pause size={40} />
              </div>
            </motion.div>
          ) : (
            <motion.div key="play" {...iconAnimation}>
              <div className="w-20 h-20 rounded-full flex items-center justify-center bg-black/20">
                <Play size={40} className="ml-1" />
              </div>
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
  const isRunning = status === "running" || status === "starting";
  const isDisabled = status === "starting" || status === "stopping";

  const handleToggle = useCallback(
    (checked: boolean) => {
      if (isDisabled) return;

      if (checked) {
        window.electronAPI.startClient(service);
      } else {
        window.electronAPI.stopClient();
      }
    },
    [isDisabled, service]
  );

  const isProcessingAndRunning = status === "running" && stats.processing > 0;

  return (
    <div className="space-y-8 p-4 md:p-6">
      <div className="flex flex-col lg:flex-row items-center justify-between gap-6 p-4 rounded-lg bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50">
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <PowerButton
            isRunning={isRunning}
            isDisabled={isDisabled}
            onToggle={handleToggle}
          />
          <div className="flex flex-col items-center sm:items-start gap-2">
            <h2 className="text-2xl font-bold text-center sm:text-left">
              Workflows
            </h2>
            <select
              value={service}
              onChange={(e) => setService(e.target.value)}
              disabled={isRunning || isDisabled}
              className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {services.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="w-full lg:w-auto flex justify-center">
          <StatusIndicator />
        </div>
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Jobs in Queue"
          value={stats.pending}
          icon={
            <Server size={20} className="text-gray-500 dark:text-gray-400" />
          }
          className="text-yellow-500 dark:text-yellow-400"
        />
        <StatCard
          title="Jobs In Progress"
          value={stats.processing}
          icon={
            <Loader
              size={20}
              className={`text-gray-500 dark:text-gray-400 ${
                isProcessingAndRunning ? "animate-spin" : ""
              }`}
            />
          }
          className="text-blue-500 dark:text-blue-400"
        />
        <StatCard
          title="Jobs Completed"
          value={stats.completed}
          icon={
            <CheckCircle
              size={20}
              className="text-gray-500 dark:text-gray-400"
            />
          }
          className="text-green-500 dark:text-green-400"
        />
        <StatCard
          title="Jobs Failed"
          value={stats.failed}
          icon={
            <XCircle size={20} className="text-gray-500 dark:text-gray-400" />
          }
          className="text-red-500 dark:text-red-400"
        />
      </div>
    </div>
  );
});
