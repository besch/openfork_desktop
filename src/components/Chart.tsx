import React from "react";
import { useClientStore } from "@/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
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

export const Chart = () => {
  const { stats, theme } = useClientStore();

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
    <Card className="bg-gray-100 dark:bg-gray-800">
      <CardHeader>
        <CardTitle>Job Status Overview</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={400}>
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
  );
};