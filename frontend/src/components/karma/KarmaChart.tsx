"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { useI18n } from "@/src/contexts/I18nContext";

export interface KarmaHistoryPoint {
  date: string;
  score: number;
}

interface KarmaChartProps {
  karmicBalance: number;
  effectiveKarma: number;
  history: KarmaHistoryPoint[];
}

const CustomTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name: string }>;
  label?: string;
}) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#0f1011] border border-[#23252a] rounded-md p-2 text-xs">
        <p className="text-[#8a8f98]">{label}</p>
        <p className="text-amber-400 font-medium">
          {payload[0].value >= 0 ? "+" : ""}
          {payload[0].value.toFixed(1)}
        </p>
      </div>
    );
  }
  return null;
};

export function KarmaChart({
  karmicBalance,
  effectiveKarma,
  history,
}: Omit<KarmaChartProps, "soulId">) {
  const { t } = useI18n();
  const hasDecay = Math.abs(karmicBalance - effectiveKarma) > 0.01;

  return (
    <div className="space-y-3">
      {/* Summary Row */}
      <div className="flex gap-4 text-sm">
        <div className="flex-1">
          <span className="text-[#8a8f98]">{t("karma.balance")}: </span>
          <span
            className={`font-bold ${
              karmicBalance >= 0 ? "text-green-400" : "text-red-400"
            }`}
          >
            {karmicBalance >= 0 ? "+" : ""}
            {karmicBalance.toFixed(1)}
          </span>
        </div>
        {hasDecay && (
          <div className="flex-1">
            <span className="text-[#8a8f98]">{t("karma.effective")}: </span>
            <span
              className={`font-bold ${
                effectiveKarma >= 0 ? "text-blue-400" : "text-red-400"
              }`}
            >
              {effectiveKarma >= 0 ? "+" : ""}
              {effectiveKarma.toFixed(1)}
            </span>
          </div>
        )}
      </div>

      {/* Chart */}
      {history.length > 0 ? (
        <div style={{ minWidth: 0, minHeight: 140 }}>
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart
            data={history}
            margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
          >
            <defs>
              <linearGradient id="karmaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#23252a" />
            <XAxis
              dataKey="date"
              tick={{ fill: "#8a8f98", fontSize: 9 }}
              tickFormatter={(v) => v.slice(5, 10)}
              axisLine={{ stroke: "#23252a" }}
              tickLine={{ stroke: "#23252a" }}
            />
            <YAxis
              tick={{ fill: "#8a8f98", fontSize: 9 }}
              width={35}
              axisLine={{ stroke: "#23252a" }}
              tickLine={{ stroke: "#23252a" }}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={0} stroke="#3a3d42" strokeDasharray="2 2" />
            <Area
              type="monotone"
              dataKey="score"
              stroke="#f59e0b"
              strokeWidth={2}
              fill="url(#karmaGradient)"
              dot={false}
              activeDot={{ r: 4, fill: "#f59e0b" }}
            />
          </AreaChart>
        </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-[140px] flex items-center justify-center text-[#8a8f98] text-xs">
          {t("karma.no_history")}
        </div>
      )}
    </div>
  );
}
