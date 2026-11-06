"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { civSkinOf } from "@/src/lib/civSkin";
import { Seal } from "@/src/components/plaque/Seal";

/**
 * 队列清空时的空状态(规范 v4 第七批 S08):每个文明用自己的说法 ——
 * 地府「这一殿今天没有案子」、欧洲「今天庭上没有人等候」、埃及「今天天平空着」、希腊「今天岔路口没有人」
 * (`empty.<civ>`),下面一句通用的 `empty.body`,一个动作(`empty.view_concluded` 由调用方给)。
 * 主视觉是本殿的印,轻轻呼吸(`.empty-breathe`:5s,1 → 1.035,.5 → .72;减少动态效果时不动)。
 *
 * 与 `EmptyState` 的分工:这一个只给「判完了」那种空(审判队列、滑卡);筛选筛空、列表本来就空,仍是
 * `EmptyState` 的 □。**出错不用它**:出错保持直白、不呼吸 —— `QueryError` / `judgment.queue.error_title`
 * + `error.next_body`(「服务器没有回应。手上这一件没有改动。」)+ 重试,见 errorIsNotAnEmptyState。
 * 没有文明(中性皮)时没有文明的说法,标题退回 `empty.body`、不画印。
 */
export function CivEmptyState({ action }: { action?: ReactNode }) {
  const { t } = useI18n();
  const civ = civSkinOf(useTenant().user?.tenant?.code ?? null);
  const neutral = civ === "neutral";
  return (
    <div data-empty-state="" data-civ-empty={neutral ? undefined : civ} className="py-8">
      {neutral ? null : (
        <span aria-hidden="true" data-empty-state-mark="" className="empty-breathe inline-block">
          <Seal size={48} />
        </span>
      )}
      <p data-empty-state-title="" className="mt-4 font-title text-lg text-[oklch(var(--color-ink))]">
        {neutral ? t("empty.body") : t(`empty.${civ}`)}
      </p>
      {neutral ? null : (
        <p data-empty-state-reason="" className="mt-1 text-xs text-[oklch(var(--color-ink-subtle))]">
          {t("empty.body")}
        </p>
      )}
      {action ? (
        <div data-empty-state-action="" className="mt-4">
          {action}
        </div>
      ) : null}
    </div>
  );
}
