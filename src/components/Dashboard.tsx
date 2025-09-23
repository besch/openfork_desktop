import React, { useState } from "react";
import { useClientStore } from "@/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Switch } from "@/components/ui/Switch";
import {
  CheckCircle,
  XCircle,
  Loader,
  Server,
  Power,
  AlertCircle,
} from "lucide-react";

const StatCard = ({
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
  <Card className="bg-gray-100 dark:bg-gray-800">
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium">{title}</CardTitle>
      {icon}
    </CardHeader>
    <CardContent>
      <div className={`text-2xl font-bold ${className}`}>{value}</div>
    </CardContent>
  </Card>
);

export const StatusIndicator = () => {
  const status = useClientStore((state) => state.status);

  const statusConfig = {
    running: {
      text: "Client is Running",
      className: "text-green-500 dark:text-green-300",
      icon: <Power size={20} />,
    },
    stopped: {
      text: "Client is Stopped",
      className: "text-gray-500 dark:text-gray-400",
      icon: <Power size={20} />,
    },
    starting: {
      text: "Starting...",
      className: "text-yellow-500 dark:text-yellow-300",
      icon: <Loader size={20} className="animate-spin" />,
    },
    stopping: {
      text: "Stopping...",
      className: "text-orange-500 dark:text-orange-300",
      icon: <Loader size={20} className="animate-spin" />,
    },
    error: {
      text: "Error State",
      className: "text-red-500 dark:text-red-300",
      icon: <AlertCircle size={20} />,
    },
  };

  const { text, className, icon } = statusConfig[status];

  return (
    <div
      className={`flex items-center space-x-2 p-3 rounded-lg bg-white/50 dark:bg-gray-900/50 ${className}`}
    >
      {icon}
      <span className="font-semibold">{text}</span>
    </div>
  );
};

export const Dashboard = () => {
  const { status, stats } = useClientStore();
  const [service, setService] = useState('auto');
  const isRunning = status === "running" || status === "starting";
  const isDisabled = status === "starting" || status === "stopping";

  const handleToggle = (checked: boolean) => {
    if (isDisabled) return; // Prevent action if disabled

    if (checked) {
      window.electronAPI.startClient(service);
    } else {
      window.electronAPI.stopClient();
    }
  };

  const isProcessingAndRunning = status === "running" && stats.processing > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between p-4 rounded-lg bg-gray-100 dark:bg-gray-800">
        <div className="flex items-center space-x-4">
          <h2 className="text-2xl font-bold">DGN Client Control</h2>
          <Switch
            id="client-toggle"
            checked={isRunning}
            onCheckedChange={handleToggle}
            disabled={isDisabled}
          />
          <select
            value={service}
            onChange={(e) => setService(e.target.value)}
            disabled={isRunning || isDisabled}
            className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            <option value="auto">Auto</option>
            <option value="default">Default (Video)</option>
            <option value="foley">Foley (Audio)</option>
            <option value="text_to_image">Image (Qwen)</option>
            <option value="vibevoice">TTS (VibeVoice)</option>
            <option value="diffrhythm">DiffRhythm (Music)</option>
            <option value="vibevoice_multi_clone">
              TTS (Multi-Speaker Clone)
            </option>
          </select>
        </div>
        <StatusIndicator />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Jobs in Queue"
          value={stats.pending}
          icon={
            <Server size={24} className="text-gray-500 dark:text-gray-400" />
          }
          className="text-yellow-500 dark:text-yellow-300"
        />
        <StatCard
          title="Jobs In Progress"
          value={stats.processing}
          icon={
            <Loader
              size={24}
              className={`text-gray-500 dark:text-gray-400 ${
                isProcessingAndRunning ? "animate-spin" : ""
              }`}
            />
          }
          className="text-blue-500 dark:text-blue-300"
        />
        <StatCard
          title="Jobs Completed"
          value={stats.completed}
          icon={
            <CheckCircle
              size={24}
              className="text-gray-500 dark:text-gray-400"
            />
          }
          className="text-green-500 dark:text-green-300"
        />
        <StatCard
          title="Jobs Failed"
          value={stats.failed}
          icon={
            <XCircle size={24} className="text-gray-500 dark:text-gray-400" />
          }
          className="text-red-500 dark:text-red-300"
        />
      </div>
    </div>
  );
};