import React, { useEffect } from "react";
import { useClientStore } from "@/store";
import type { JobStats } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Switch } from "@/components/ui/Switch";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from "recharts";
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
  const { status, stats, setStats, setStatus, theme } = useClientStore();
  const isRunning = status === "running" || status === "starting";

  const handleToggle = (checked: boolean) => {
    if (checked) {
      setStatus("starting");
      window.electronAPI.startClient();
    } else {
      setStatus("stopped");
      window.electronAPI.stopClient();
    }
  };

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch(`/api/dgn/stats`);
        if (!response.ok) {
          throw new Error(`Failed to fetch stats: ${response.statusText}`);
        }
        const data: JobStats = await response.json();
        setStats(data);
      } catch (error) {
        console.error(error);
        // Optionally, update state to show an error message in the UI
      }
    };

    fetchStats(); // Initial fetch
    const interval = setInterval(fetchStats, 5000); // Poll every 5 seconds

    return () => clearInterval(interval);
  }, [setStats]);

  const chartData = [
    {
      name: "Completed",
      value: stats.completed,
      color: theme === "dark" ? "#22c55e" : "#22c55e",
    }, // green-500
    {
      name: "Failed",
      value: stats.failed,
      color: theme === "dark" ? "#b91c1c" : "#ef4444",
    }, // red-700 vs red-600
    {
      name: "In Progress",
      value: stats.processing,
      color: theme === "dark" ? "#3b82f6" : "#3b82f6",
    }, // blue-500
    {
      name: "In Queue",
      value: stats.pending,
      color: theme === "dark" ? "#facc15" : "#eab308",
    }, // yellow-400 vs yellow-500
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between p-4 rounded-lg bg-gray-100 dark:bg-gray-800">
        <div className="flex items-center space-x-4">
          <h2 className="text-2xl font-bold">DGN Client Control</h2>
          <Switch
            id="client-toggle"
            checked={isRunning}
            onCheckedChange={handleToggle}
          />
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
              className="text-gray-500 dark:text-gray-400 animate-spin"
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

      <Card className="bg-gray-100 dark:bg-gray-800">
        <CardHeader>
          <CardTitle>Job Status Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={chartData}
              margin={{ top: 5, right: 20, left: -10, bottom: 5 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={theme === "dark" ? "#374151" : "#e5e7eb"}
              />
              <XAxis
                dataKey="name"
                stroke={theme === "dark" ? "#9ca3af" : "#6b7280"}
              />
              <YAxis
                allowDecimals={false}
                stroke={theme === "dark" ? "#9ca3af" : "#6b7280"}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: theme === "dark" ? "#111827" : "#ffffff",
                  borderColor: theme === "dark" ? "#374151" : "#e5e7eb",
                  color: theme === "dark" ? "#f9fafb" : "#1f2937",
                }}
                labelStyle={{ color: theme === "dark" ? "#f9fafb" : "#1f2937" }}
              />
              <Legend
                wrapperStyle={{
                  color: theme === "dark" ? "#f9fafb" : "#1f2937",
                }}
              />
              <Bar dataKey="value" name="Jobs">
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
};
