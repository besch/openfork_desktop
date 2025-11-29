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
      color: "#22c55e", // green-500
    },
    {
      name: "Failed",
      value: stats.failed,
      color: "#ef4444", // red-500
    },
    {
      name: "In Progress",
      value: stats.processing,
      color: "#3b82f6", // blue-500
    },
    {
      name: "In Queue",
      value: stats.pending,
      color: "#eab308", // yellow-500
    },
  ];

  return (
    <Card className="bg-card/50 backdrop-blur-sm border-white/10">
      <CardHeader>
        <CardTitle>Job Status Overview</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart
            data={chartData}
            margin={{ top: 5, right: 20, left: -10, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
            <XAxis dataKey="name" stroke="#a1a1aa" />
            <YAxis allowDecimals={false} stroke="#a1a1aa" />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1c1917",
                borderColor: "rgba(255,255,255,0.1)",
                color: "#f9fafb",
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
              cursor={{ fill: "rgba(255,255,255,0.05)" }}
            />
            <Legend
              wrapperStyle={{
                color: "#f9fafb",
              }}
            />
            <Bar dataKey="value" name="Jobs" radius={[4, 4, 0, 0]}>
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
