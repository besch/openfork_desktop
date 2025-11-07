import { useClientStore } from "@/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  const { stats } = useClientStore();

  const chartData = [
    {
      name: "Completed",
      value: stats.completed,
      color: "#22c55e",
    }, // green-500
    {
      name: "Failed",
      value: stats.failed,
      color: "#ef4444",
    }, // red-600
    {
      name: "In Progress",
      value: stats.processing,
      color: "#3b82f6",
    }, // blue-500
    {
      name: "In Queue",
      value: stats.pending,
      color: "#eab308",
    }, // yellow-500
  ];

  return (
    <Card className="bg-gray-800">
      <CardHeader>
        <CardTitle className="text-white">Job Status Overview</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart
            data={chartData}
            margin={{ top: 5, right: 20, left: -10, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="name" stroke="#9ca3af" />
            <YAxis allowDecimals={false} stroke="#9ca3af" />
            <Tooltip
              contentStyle={{
                backgroundColor: "#111827",
                borderColor: "#374151",
                color: "#f9fafb",
                border: "none",
                borderRadius: "8px",
                boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.3)",
              }}
              labelStyle={{
                color: "#f9fafb",
                fontWeight: "600",
                marginBottom: "4px",
              }}
              itemStyle={{
                color: "#f9fafb",
                fontWeight: "500",
              }}
            />
            <Legend
              wrapperStyle={{
                color: "#f9fafb",
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
