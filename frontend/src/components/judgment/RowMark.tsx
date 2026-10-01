"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import type { Judgment } from "@soulledger/core/api";

/**
 * 行首色标(规范 v2 补足 B12):**只**表示「待我处理」—— 这件审判还没结案,并且认领人是
 * 当前用户;两个条件缺一不加。只用在审判相关的列表上(审判列表的待审组、审判队列)。
 * 别人认领的行不加色标,也不变灰。
 *
 * 画法:行首 3px 匾色竖条 + 整行 s1 底,不加图标;读屏读语言包 `judgment.row_mark.mine`。
 * 竖条是绝对定位的,放进一个**没有**定位的格子里,于是贴着 `position: relative` 的行
 * 左缘画 —— 调用方的 <tr> / 行容器要带 `relative`,整行再加 `ROW_MARK_ROW`。
 */

export function isMinePending(
  judgment: Pick<Judgment, "concluded_at" | "claimed_by">,
  userId: number | null | undefined
): boolean {
  return judgment.concluded_at == null && userId != null && judgment.claimed_by === userId;
}

/** 带色标的行的底色。 */
export const ROW_MARK_ROW = "bg-[oklch(var(--color-surface-1))]";

export function RowMark() {
  const { t } = useI18n();
  return (
    <>
      <span
        aria-hidden="true"
        data-testid="row-mark"
        /* v3「C 认领」:色标 scaleY(0→1),160ms 进场曲线 —— 认领后这一格第一次挂上时播一次。 */
        className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-[oklch(var(--color-main))] origin-center transition-transform duration-fast ease-enter starting:scale-y-0"
      />
      <span className="sr-only">{t("judgment.row_mark.mine")}</span>
    </>
  );
}
