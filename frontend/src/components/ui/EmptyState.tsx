"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { CivMark } from "@/src/components/brand/CivEmblem";
import type { SealCiv } from "@/src/components/plaque/Seal";
import { useHallCivilization } from "@/src/components/plaque/useHall";
import { mapSkinOf } from "@/src/lib/underworldMap";

/**
 * 空态 —— Stage 11 B slots;第三十批「卷宗」第 1 步第 5 条重画(Design v4 第三十批回复第一节)。
 *
 * 迁移前站内有 23 处手搓空态、15 种写法。这里收成一种:
 *
 * 1) **G 天体仪记号 96,12% 不透明**(`CivMark`,文明字色 civT;中性皮只画环),压在说明上方。它是装饰,
 *    aria-hidden。取代 v3 的 28px □ 与 2026-11-08 加的 160 线稿背景。
 * 2) **一句说明**:标题(宋体 20/28,`font-title text-lg`)说「这里没有什么」,`reason` 一句话补「为什么 /
 *    什么时候会有」——「新的案子到了会出现在这里。」而不是「无数据」。
 * 3) **一个下一步**(`action`):**一个** —— 空态不是工具栏。不再叠第二个图标、第二行空话。
 *
 * 居中(稿子 `.state`)。v1 / v2 的「居左,卷宗里的一条注记」随这一批撤掉 —— 空态现在是这一块的全部内容,
 * 一个记号、一句话、一个出口。
 */
export interface EmptyStateProps {
  /** 标题,宋体 20/28。一个短句。 */
  title: React.ReactNode;
  /** 一句说明,13 ink-muted。为什么这里是空的、下一步去哪。 */
  reason?: React.ReactNode;
  /** 一个动作。**一个** —— 空态不是工具栏。 */
  action?: React.ReactNode;
  className?: string;
  /**
   * 记号画哪个文明的(`CHINESE` 或皮名 `cn`)。不给就是此刻所在的殿的文明;认不出就只画环。
   */
  civilization?: string | null;
}

/** `CHINESE` / `cn` → `cn`;认不出是 null。 */
function emblemSkin(civ: string | null | undefined): SealCiv | null {
  if (!civ) return null;
  if (civ === "cn" || civ === "eu" || civ === "eg" || civ === "gr") return civ;
  return mapSkinOf(civ);
}

export function EmptyState({ title, reason, action, className, civilization }: EmptyStateProps) {
  const hall = useHallCivilization();
  const skin = emblemSkin(civilization ?? hall);
  return (
    <div data-empty-state="" className={cn("flex flex-col items-center py-8 text-center", className)}>
      <CivMark civ={skin} size={96} className="empty-mark" />

      <p data-empty-state-title="" className="mt-4 font-title text-lg text-[oklch(var(--color-ink))]">
        {title}
      </p>

      {reason ? (
        <p data-empty-state-reason="" className="mt-2 max-w-prose text-sm text-[oklch(var(--color-ink-subtle))]">
          {reason}
        </p>
      ) : null}

      {action ? (
        <div data-empty-state-action="" className="mt-6">
          {action}
        </div>
      ) : null}
    </div>
  );
}
