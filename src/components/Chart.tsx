import { memo, useMemo } from "react";
import { useClientStore } from "@/store";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
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

interface ChartProps {
  compact?: boolean;
  className?: string;
}

export const Chart = memo(({ compact = false, className }: ChartProps) => {
  const stats = useClientStore((state) => state.stats);

  const chartData = useMemo(
    () => [
      {
        name: "Completed",
        shortName: "Done",
        value: stats.completed,
        color: "#22c55e",
      },
      {
        name: "Failed",
        shortName: "Failed",
        value: stats.failed,
        color: "#ef4444",
      },
      {
        name: "In Progress",
        shortName: "Active",
        value: stats.processing,
        color: "#3b82f6",
      },
      {
        name: "In Queue",
        shortName: "Queue",
        value: stats.pending,
        color: "#eab308",
      },
    ],
    [stats.completed, stats.failed, stats.pending, stats.processing],
  );
  const totalJobs = chartData.reduce((sum, entry) => sum + entry.value, 0);

  return (
    <Card
      className={cn(
        "bg-card/50 backdrop-blur-sm border-white/10 animate-in fade-in slide-in-from-bottom-4 duration-500",
        compact && "h-full xl:sticky xl:top-4",
        className,
      )}
    >
      <CardContent className={cn("p-3", !compact && "sm:p-6")}>
        {compact && (
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/40">
                Work mix
              </p>
              <p className="mt-0.5 text-lg font-black leading-none text-white">
                {totalJobs.toLocaleString()}
              </p>
            </div>
            <span className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-white/45">
              Jobs
            </span>
          </div>
        )}

        <div className={compact ? "h-[170px]" : "h-[320px] sm:h-[400px]"}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={
                compact
                  ? { top: 8, right: 4, left: -24, bottom: 0 }
                  : { top: 5, right: 20, left: -10, bottom: 5 }
              }
            >
              {!compact && (
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.1)"
                />
              )}
              <XAxis
                dataKey={compact ? "shortName" : "name"}
                stroke="#a1a1aa"
                tick={{ fontSize: compact ? 9 : 11 }}
                tickMargin={compact ? 5 : 8}
                height={compact ? 30 : 48}
              />
              <YAxis
                allowDecimals={false}
                stroke="#a1a1aa"
                tick={{ fontSize: compact ? 9 : 11 }}
                width={compact ? 28 : 40}
              />
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
              {!compact && (
                <Legend
                  wrapperStyle={{
                    color: "#f9fafb",
                  }}
                />
              )}
              <Bar dataKey="value" name="Jobs" radius={[4, 4, 0, 0]}>
                {chartData.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {compact && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {chartData.map((entry) => (
              <div
                key={entry.name}
                className="flex min-w-0 items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="min-w-0 flex-1 truncate text-[9px] font-black uppercase tracking-wide text-white/45">
                  {entry.shortName}
                </span>
                <span className="text-xs font-black text-white">
                  {entry.value.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
});

Chart.displayName = "Chart";
