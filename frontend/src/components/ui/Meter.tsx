import type { CSSProperties, HTMLAttributes } from "react";

/** 在押到这一档,填充改警示色(Design 第四十七批 1–2)。 */
export const METER_WARN_AT = 0.9;

/** `ratio` 0–1 for the fill, or above 1 for "over" (held past capacity). */
export function meterState(ratio: number, alarm: boolean): "warn" | "over" | undefined {
  if (!alarm) return undefined;
  return ratio > 1 ? "over" : ratio >= METER_WARN_AT ? "warn" : undefined;
}

/**
 * 一根条(Design 第四十七批:在押 / 容量、总簿进度、年报占比是同一个组件)。只读墨:条底 `--line2`(墨 16%),
 * 填充墨 70%;`alarm` 时 ≥ 90% 填充改 amber(v4 `--warn`),> 100% 改 danger(v4 `--neg`)。
 * 条的颜色说的是状态,不是「这是哪一家」,所以这里不读文明色 —— 样式在 globals.css 的 `.meter`。
 * 尺寸由 `className` 给(高度、宽度、flex)。
 */
export function Meter({
  ratio,
  alarm = false,
  className,
  style,
  ...rest
}: { ratio: number; alarm?: boolean } & HTMLAttributes<HTMLSpanElement>) {
  const fill = Math.min(Math.max(ratio, 0), 1);
  return (
    <span
      {...rest}
      data-meter={meterState(ratio, alarm)}
      className={className ? `meter ${className}` : "meter"}
      style={{ "--meter": fill, ...style } as CSSProperties}
    >
      <span className="meter-fill" />
    </span>
  );
}
