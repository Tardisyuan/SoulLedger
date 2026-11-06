"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { civilHour, type HourCiv } from "@soulledger/core/domain/civilHours";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { civSkinOf } from "@/src/lib/civSkin";
import { Segmented } from "@/src/components/ui/Segmented";

/**
 * 顶栏右侧的两件小东西(规范 v4 第七批 S01):时辰标签与「舒适 / 紧凑」。
 */

// ── 时辰 ────────────────────────────────────────────────────────────────

const subscribeMinute = (onTick: () => void) => {
  // 对齐到整分:第一次在下一分开始时跳,之后每 60 秒。
  let interval = 0;
  const timeout = window.setTimeout(() => {
    onTick();
    interval = window.setInterval(onTick, 60_000);
  }, 60_000 - (Date.now() % 60_000));
  return () => {
    window.clearTimeout(timeout);
    window.clearInterval(interval);
  };
};
/** 分钟数作快照:同一分钟内值不变,React 不重渲染。服务端没有「此刻」,给 null(不画,免得水合不一致)。 */
const useMinute = () =>
  useSyncExternalStore(
    subscribeMinute,
    () => Math.floor(Date.now() / 60_000),
    () => null,
  );

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * 「未时 · 14:40」(`hours.format`):按**观看者**的时区(浏览器的本地钟点),换算在 core 的 `civilHour`。
 * 没有文明(中性皮)不画。< 1280 不画:那以下顶栏只放得下面包屑与几个图标(问一问推开时右侧还要让出 420)。放不下时截断(min-w-0 truncate),不把顶栏撑宽。
 */
export function HoursChip() {
  const { t } = useI18n();
  const civ = civSkinOf(useTenant().user?.tenant?.code ?? null);
  const minute = useMinute();
  if (minute === null || civ === "neutral") return null;
  const now = new Date(minute * 60_000);
  const hour = civilHour(civ as HourCiv, now);
  const text = t("hours.format", { name: t(hour.key, hour.params), time: `${pad(now.getHours())}:${pad(now.getMinutes())}` });
  return (
    <span data-testid="shell-hours" className="hidden min-w-0 truncate whitespace-nowrap font-mono text-xs text-[oklch(var(--color-ink-muted))] min-[1280px]:block">
      <time dateTime={`${pad(now.getHours())}:${pad(now.getMinutes())}`}>{text}</time>
    </span>
  );
}

// ── 密度 ────────────────────────────────────────────────────────────────

export const DENSITY_KEY = "soulledger-density";
export type Density = "comfortable" | "compact";

/**
 * 密度写在 <html data-density>,globals.css 据此在紧凑时把表格行、筛选与控件压矮(v4:行高 36、控件 30、
 * 正文 13);页头与卡片间距不动。只在 ≥ 769 且指针精确时生效 —— 触屏的 44 是点按下限,不让它变小。
 * 存在 localStorage;存储被禁时只活在本页。
 */
export function useDensity(): [Density, (d: Density) => void] {
  const [density, setDensityState] = useState<Density>("comfortable");
  useEffect(() => {
    try {
      if (window.localStorage.getItem(DENSITY_KEY) === "compact") setDensityState("compact");
    } catch {
      /* storage blocked */
    }
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    if (density === "compact") root.dataset.density = "compact";
    else delete root.dataset.density;
    return () => {
      delete root.dataset.density;
    };
  }, [density]);
  const setDensity = useCallback((d: Density) => {
    setDensityState(d);
    try {
      window.localStorage.setItem(DENSITY_KEY, d);
    } catch {
      /* storage blocked: lasts for this page */
    }
  }, []);
  return [density, setDensity];
}

/** 「舒适 / 紧凑」(`shell.density.*`)。≥ 1440 才画:再窄,顶栏右侧(问一问、240 宽的搜索、通知、用户)加上它就挤到面包屑了。 */
export function DensityToggle() {
  const { t } = useI18n();
  const [density, setDensity] = useDensity();
  const comfortable = t("shell.density.comfortable");
  const compact = t("shell.density.compact");
  return (
    <Segmented
      label={`${comfortable} / ${compact}`}
      value={density}
      options={[
        { value: "comfortable", label: comfortable },
        { value: "compact", label: compact },
      ]}
      onChange={(v) => setDensity(v as Density)}
      className="hidden shrink-0 overflow-hidden rounded-control min-[1440px]:inline-flex [&>button]:h-8"
      data-testid="shell-density"
    />
  );
}
