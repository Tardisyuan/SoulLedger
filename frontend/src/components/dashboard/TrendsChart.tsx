"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { prefersReducedMotion } from "@/lib/motion";

export interface TrendsChartSeries {
  key: string;
  /** 已本地化的名字 —— 提示框里显示它,不显示键。 */
  label: string;
  stroke: string;
  /** SVG `stroke-dasharray`;梯度里相邻两档明度太近,线型是第二道区分(图例里的字形是第三道)。 */
  dash?: string;
}

export interface TrendsChartProps {
  /** 每行一天:`{ day: "2026-10-08", [series.key]: number }`。 */
  rows: Record<string, number | string>[];
  series: TrendsChartSeries[];
  height?: number;
  formatDay: (day: string) => string;
}

/**
 * 仪表盘「趋势」的折线。单独一个文件、由面板 `next/dynamic` 加载:recharts 不进仪表盘首屏的包。
 * 外观语句与 `LazyDashboardCharts` 同一套:零圆角的提示框、墨色刻度、网格取 hairline;
 * 动画服从 `prefers-reduced-motion`(recharts 用 rAF 写属性,样式表管不到它)。
 */
export default function TrendsChart({ rows, series, height = 240, formatDay }: TrendsChartProps) {
  const animate = !prefersReducedMotion();
  const tick = { fill: "oklch(var(--color-ink-muted))", fontSize: 11 };
  const axis = { stroke: "oklch(var(--color-hairline))" };
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows}>
        <CartesianGrid strokeDasharray="3 3" stroke="oklch(var(--color-hairline))" />
        <XAxis dataKey="day" tick={tick} axisLine={axis} tickLine={axis} tickFormatter={formatDay} minTickGap={24} />
        <YAxis tick={tick} axisLine={axis} tickLine={axis} width={36} allowDecimals={false} />
        <Tooltip
          labelFormatter={(d) => formatDay(String(d))}
          contentStyle={{
            background: "oklch(var(--color-surface-1))",
            border: "1px solid oklch(var(--color-ink))",
            borderRadius: 0,
            fontSize: 12,
          }}
          labelStyle={{ color: "oklch(var(--color-ink-muted))" }}
        />
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.stroke}
            strokeWidth={2}
            strokeDasharray={s.dash}
            dot={false}
            isAnimationActive={animate}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
