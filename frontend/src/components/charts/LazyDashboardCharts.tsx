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
    <div className="flex items-center justify-center" style={{ height }}>
      <Skeleton className="h-full w-full" />
    </div>
  );
}

const LazyBarChart = dynamic(
  () =>
    import("recharts").then((mod) => {
      const {
        BarChart,
        Bar,
        Cell,
        XAxis,
        YAxis,
        CartesianGrid,
        Tooltip,
        ResponsiveContainer,
      } = mod;
      // `fill` has no default, deliberately. It used to be `"#f59e0b"` — a
      // literal nothing else in the app declares, invisible to
      // `chartColourContract`, and picked up by whichever caller forgot to
      // choose. That caller was the tenant comparison chart on the dashboard,
      // which drew all four cosmologies in one amber directly above four cards
      // giving each of them its own mark colour: two views of the same four
      // tenants on one screen, one of which said they were a single category.
      // A required prop makes "which colour is this series" a question every
      // caller answers.
      //
      // `color` on a datum overrides it for that bar alone. The pie charts in
      // this file already read `entry.color`; the bar path had a single series
      // fill and no way to say "these bars are four different things", which is
      // exactly what a per-civilization comparison is.
      return function WrappedBarChart({
        data,
        dataKey = "total",
        fill,
        height = 240,
        name,
        showGrid = true,
      }: {
        data: ChartDataPoint[];
        dataKey?: string;
        fill: string;
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
              >
                {data.map((entry, i) => (
                  <Cell key={i} fill={entry.color ?? fill} />
                ))}
              </Bar>
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
      // `fallbackFill` is required and has no default, for the reason spelled
      // out on WrappedBarChart below: an optional colour prop with a hardcoded
      // fallback is how a palette gets bypassed with nothing to catch it. This
      // one was `"#6b7280"` — stock Tailwind gray-500, declared nowhere in the
      // stylesheet, invisible to chartColourContract, and a fixed literal in
      // both themes where every other neutral in the app moves between them.
      return function WrappedDashboardPieChart({
        data,
        height = 240,
        fallbackFill,
      }: {
        data: ChartDataPoint[];
        height?: number;
        fallbackFill: string;
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
                    fill={entry.fill || entry.color || fallbackFill}
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
        // A soul's ledger spans its whole life — decades, once event dates are
        // real. Slicing every label to MM-DD dropped the year, so a series
        // running 1969→2011 read as one year and the labels looked unsorted.
        // Below two years the year is the redundant part, so switch on span.
        const years = data
          .map((d) => Number(String(d.date).slice(0, 4)))
          .filter((y) => !Number.isNaN(y));
        const spansYears = years.length > 0 && Math.max(...years) - Math.min(...years) >= 2;
        const formatTick = (v: string) =>
          spansYears ? String(v).slice(0, 4) : String(v).slice(5, 10);

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
                tickFormatter={formatTick}
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

// ── Soul Lifecycle Lifespan Bar Chart (Stage 3) ──────────────────
// One bar per ledger record, labeled by year. `effective` (the decayed
// weight, still signed +merit/-demerit) draws solid; `decayedAway` (the
// magnitude decay stripped off — always the same sign as `effective`, since
// decay only shrinks toward zero, never flips merit into demerit) stacks on
// top of it in the same hue at low opacity, so the full bar height reads as
// "what this deed originally weighed" and the solid base reads as "what
// still counts today". A record with no decay yet (rate 0, or age ~0) has
// decayedAway ~0 and the bar is solid all the way up.
const LazyLifespanBarChart = dynamic(
  () =>
    import("recharts").then((mod) => {
      const {
        BarChart,
        Bar,
        Cell,
        XAxis,
        YAxis,
        CartesianGrid,
        Tooltip,
        ResponsiveContainer,
        ReferenceLine,
      } = mod;
      return function WrappedLifespanBarChart({
        data,
        height = 140,
      }: {
        data: {
          key: string;
          label: string;
          effective: number;
          decayedAway: number;
          color: string;
        }[];
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
                dataKey="label"
                tick={{ fill: "hsl(var(--color-ink-muted))", fontSize: 9 }}
                axisLine={{ stroke: "hsl(var(--color-hairline))" }}
                tickLine={{ stroke: "hsl(var(--color-hairline))" }}
              />
              <YAxis
                tick={{ fill: "hsl(var(--color-ink-muted))", fontSize: 9 }}
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
              <ReferenceLine y={0} stroke="hsl(var(--color-hairline))" />
              <Bar dataKey="effective" stackId="w" radius={[2, 2, 0, 0]}>
                {data.map((d) => (
                  <mod.Cell key={`eff-${d.key}`} fill={d.color} fillOpacity={0.85} />
                ))}
              </Bar>
              <Bar dataKey="decayedAway" stackId="w">
                {data.map((d) => (
                  <mod.Cell key={`decay-${d.key}`} fill={d.color} fillOpacity={0.25} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        );
      };
    }),
  {
    ssr: false,
    loading: () => <ChartSkeleton height={140} />,
  }
);

export {
  LazyBarChart,
  LazyDashboardPieChart,
  LazySoulLineChart,
  LazyLifespanBarChart,
  ChartSkeleton,
};
