"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

// ── Recharts base types ──────────────────────────────────────────
interface ChartDataPoint {
  name?: string;
  value?: number;
  color?: string;
  fill?: string;
  total?: number;
  [key: string]: unknown;
}

// ── Chart Skeletons ──────────────────────────────────────────────
function ChartSkeleton({ height = 240 }: { height?: number }) {
  return (
    <div className="h-[${height}px] flex items-center justify-center">
      <Skeleton className="h-full w-full" />
    </div>
  );
}

// ── Lazy Recharts Base ───────────────────────────────────────────
const LazyPieChart = dynamic(
  () =>
    import("recharts").then((mod) => {
      const {
        PieChart,
        Pie,
        Cell,
        Tooltip,
        Legend,
        ResponsiveContainer,
      } = mod;
      return function WrappedPieChart({
        data,
        height = 240,
      }: {
        data: ChartDataPoint[];
        height?: number;
      }) {
        return (
          <ResponsiveContainer width="100%" height={height}>
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={90}
                paddingAngle={3}
                dataKey="value"
              >
                {data.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.color || entry.fill || "#6b7280"}
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--color-surface-1))",
                  border: "1px solid hsl(var(--color-hairline))",
                  borderRadius: "6px",
                  fontSize: 12,
                }}
              />
              <Legend
                formatter={(value) => (
                  <span
                    style={{
                      color: "hsl(var(--color-ink-muted))",
                      fontSize: 12,
                    }}
                  >
                    {value}
                  </span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        );
      };
    }),
  {
    ssr: false,
    loading: () => <ChartSkeleton />,
  }
);

const LazyBarChart = dynamic(
  () =>
    import("recharts").then((mod) => {
      const {
        BarChart,
        Bar,
        XAxis,
        YAxis,
        CartesianGrid,
        Tooltip,
        ResponsiveContainer,
      } = mod;
      return function WrappedBarChart({
        data,
        dataKey = "total",
        fill = "#f59e0b",
        height = 240,
        name,
        showGrid = true,
      }: {
        data: ChartDataPoint[];
        dataKey?: string;
        fill?: string;
        height?: number;
        name?: string;
        showGrid?: boolean;
      }) {
        return (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={data}>
              {showGrid && (
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(var(--color-hairline))"
                />
              )}
              <XAxis
                dataKey="name"
                tick={{
                  fill: "hsl(var(--color-ink-muted))",
                  fontSize: 11,
                }}
              />
              <YAxis
                tick={{
                  fill: "hsl(var(--color-ink-muted))",
                  fontSize: 11,
                }}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--color-surface-1))",
                  border: "1px solid hsl(var(--color-hairline))",
                  borderRadius: "6px",
                  fontSize: 12,
                }}
              />
              <Bar
                dataKey={dataKey}
                fill={fill}
                radius={[4, 4, 0, 0]}
                name={name}
              />
            </BarChart>
          </ResponsiveContainer>
        );
      };
    }),
  {
    ssr: false,
    loading: () => <ChartSkeleton />,
  }
);

// ── Dashboard Pie Chart (with custom colors) ─────────────────────
const LazyDashboardPieChart = dynamic(
  () =>
    import("recharts").then((mod) => {
      const {
        PieChart,
        Pie,
        Cell,
        Tooltip,
        Legend,
        ResponsiveContainer,
      } = mod;
      return function WrappedDashboardPieChart({
        data,
        height = 240,
      }: {
        data: ChartDataPoint[];
        height?: number;
      }) {
        return (
          <ResponsiveContainer width="100%" height={height}>
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
                dataKey="value"
                label={({ name, percent }) =>
                  `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                }
                labelLine={false}
              >
                {data.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.fill || entry.color || "#6b7280"}
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--color-surface-2))",
                  border: "1px solid hsl(var(--color-hairline))",
                  borderRadius: "6px",
                  fontSize: 12,
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 12 }}
                formatter={(value) => (
                  <span className="text-[hsl(var(--color-ink-muted))]">
                    {value}
                  </span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        );
      };
    }),
  {
    ssr: false,
    loading: () => <ChartSkeleton height={280} />,
  }
);

// ── Admin Bar Chart (with grid + custom axis) ────────────────────
const LazyAdminBarChart = dynamic(
  () =>
    import("recharts").then((mod) => {
      const {
        BarChart,
        Bar,
        XAxis,
        YAxis,
        CartesianGrid,
        Tooltip,
        ResponsiveContainer,
      } = mod;
      return function WrappedAdminBarChart({
        data,
        dataKey = "count",
        fill = "#f59e0b",
        height = 280,
      }: {
        data: ChartDataPoint[];
        dataKey?: string;
        fill?: string;
        height?: number;
      }) {
        return (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={data}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--color-hairline))"
              />
              <XAxis
                dataKey="name"
                tick={{
                  fill: "hsl(var(--color-ink-muted))",
                  fontSize: 10,
                }}
                axisLine={{ stroke: "hsl(var(--color-hairline))" }}
                tickLine={{ stroke: "hsl(var(--color-hairline))" }}
              />
              <YAxis
                tick={{
                  fill: "hsl(var(--color-ink-muted))",
                  fontSize: 10,
                }}
                axisLine={{ stroke: "hsl(var(--color-hairline))" }}
                tickLine={{ stroke: "hsl(var(--color-hairline))" }}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--color-surface-2))",
                  border: "1px solid hsl(var(--color-hairline))",
                  borderRadius: "6px",
                  fontSize: 12,
                }}
              />
              <Bar
                dataKey={dataKey}
                fill={fill}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        );
      };
    }),
  {
    ssr: false,
    loading: () => <ChartSkeleton height={280} />,
  }
);

// ── Soul Detail Line Chart ───────────────────────────────────────
const LazySoulLineChart = dynamic(
  () =>
    import("recharts").then((mod) => {
      const {
        LineChart,
        Line,
        XAxis,
        YAxis,
        CartesianGrid,
        Tooltip,
        ResponsiveContainer,
        ReferenceLine,
      } = mod;
      return function WrappedSoulLineChart({
        data,
        height = 120,
      }: {
        data: ChartDataPoint[];
        height?: number;
      }) {
        return (
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={data}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--color-hairline))"
              />
              <XAxis
                dataKey="date"
                tick={{
                  fill: "hsl(var(--color-ink-muted))",
                  fontSize: 9,
                }}
                tickFormatter={(v: string) => v.slice(5, 10)}
              />
              <YAxis
                tick={{
                  fill: "hsl(var(--color-ink-muted))",
                  fontSize: 9,
                }}
                width={30}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--color-surface-2))",
                  border: "1px solid hsl(var(--color-hairline))",
                  borderRadius: "6px",
                  fontSize: 11,
                }}
                labelStyle={{ color: "hsl(var(--color-ink-muted))" }}
              />
              <ReferenceLine
                x={0}
                stroke="hsl(var(--color-hairline))"
              />
              <Line
                type="monotone"
                dataKey="cumulative"
                stroke="hsl(var(--color-accent))"
                strokeWidth={2}
                dot={false}
                name="Balance"
              />
            </LineChart>
          </ResponsiveContainer>
        );
      };
    }),
  {
    ssr: false,
    loading: () => <ChartSkeleton height={120} />,
  }
);

export {
  LazyPieChart,
  LazyBarChart,
  LazyDashboardPieChart,
  LazyAdminBarChart,
  LazySoulLineChart,
  ChartSkeleton,
};
