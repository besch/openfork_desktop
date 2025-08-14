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

import { API_URL } from '@/config';

const StatCard = ({
  title,
  value,
  icon,
  color,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  color: string;
}) => (
  <Card className="bg-secondary">
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium">{title}</CardTitle>
      {icon}
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold" style={{ color }}>
        {value}
      </div>
    </CardContent>
  </Card>
);

const StatusIndicator = () => {
  const status = useClientStore((state) => state.status);

  const statusConfig = {
    running: {
      text: "Client is Running",
      color: "text-green-400",
      icon: <Power size={20} />,
    },
    stopped: {
      text: "Client is Stopped",
      color: "text-gray-400",
      icon: <Power size={20} />,
    },
    starting: {
      text: "Starting...",
      color: "text-yellow-400",
      icon: <Loader size={20} className="animate-spin" />,
    },
    error: {
      text: "Error State",
      color: "text-red-400",
      icon: <AlertCircle size={20} />,
    },
  };

  const { text, color, icon } = statusConfig[status];

  return (
    <div
      className={`flex items-center space-x-2 p-3 rounded-lg bg-secondary ${color}`}
    >
      {icon}
      <span className="font-semibold">{text}</span>
    </div>
  );
};

export const Dashboard = () => {
  const { status, stats, setStats, setStatus } = useClientStore();
  const isRunning = status === "running" || status === "starting";

  const handleToggle = (checked: boolean) => {
    if (checked) {
      setStatus("starting");
      window.electronAPI.startClient();
    } else {
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
    { name: "Completed", value: stats.completed, color: "#4ade80" },
    { name: "Failed", value: stats.failed, color: "#f87171" },
    { name: "In Progress", value: stats.processing, color: "#60a5fa" },
    { name: "In Queue", value: stats.pending, color: "#facc15" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between p-4 rounded-lg bg-secondary">
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
          icon={<Server size={24} className="text-muted-foreground" />}
          color="#facc15"
        />
        <StatCard
          title="Jobs In Progress"
          value={stats.processing}
          icon={
            <Loader size={24} className="text-muted-foreground animate-spin" />
          }
          color="#60a5fa"
        />
        <StatCard
          title="Jobs Completed"
          value={stats.completed}
          icon={<CheckCircle size={24} className="text-muted-foreground" />}
          color="#4ade80"
        />
        <StatCard
          title="Jobs Failed"
          value={stats.failed}
          icon={<XCircle size={24} className="text-muted-foreground" />}
          color="#f87171"
        />
      </div>

      <Card className="bg-secondary">
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
                stroke="rgba(255, 255, 255, 0.1)"
              />
              <XAxis dataKey="name" stroke="#888" />
              <YAxis allowDecimals={false} stroke="#888" />
              <Tooltip
                contentStyle={{ backgroundColor: "#333", border: "none" }}
                labelStyle={{ color: "#fff" }}
              />
              <Legend />
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
