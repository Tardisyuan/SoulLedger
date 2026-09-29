"use client";

import { useReducedMotion } from "motion/react";
import { MOTION_DURATIONS, type MotionDurations } from "@/lib/motion";

const ZERO_DURATIONS: MotionDurations = { instant: 0, fast: 0, base: 0, slow: 0, ritual: 0 };

/**
 * 规范 v2 的动效时长(秒),减少动态效果时**全部为 0**(交互与动效第 2 轮「减少动态」一条)。
 *
 * 不能只靠 motion 自己的 `reducedMotion="user"`:它只关掉 transform,透明度动画照播;
 * 规范要的是一切直接到位。所以 motion 的调用点从这里取时长,不写死数字:
 *
 *     const d = useReducedMotionDurations();
 *     <motion.div transition={{ duration: d.base, ease: MOTION_EASINGS.enter }} />
 *
 * `useReducedMotion()` 在服务端与首帧是 null,按「不减少」处理。
 */
export function useReducedMotionDurations(): MotionDurations {
  return useReducedMotion() ? ZERO_DURATIONS : MOTION_DURATIONS;
}
