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

/**
 * `on` 缺省为真:只在标着时才挂的调用点(`{mine && <RowMark />}`)照旧。审判队列让它一直挂着、
 * 由 `on` 切换,于是取消认领时竖条能反着退场 —— v3「取消认领」:scaleY 1→0,140ms 出场曲线
 * (`--duration-dismiss`)。一卸载就没有东西可以过渡了。减少动态效果时全局把时长压到 1ms,即瞬时。
 */
export function RowMark({ on = true }: { on?: boolean }) {
  const { t } = useI18n();
  return (
    <>
      <span
        aria-hidden="true"
        data-testid={on ? "row-mark" : "row-mark-off"}
        /* v3「C 认领」:色标 scaleY(0→1),160ms 进场曲线 —— 认领后这一格第一次挂上时播一次;
           一直挂着的那种由 `on` 从 0 过渡到 1,同样 160ms。 */
        className={`pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-[oklch(var(--color-main))] origin-center transition-transform ${
          on ? "scale-y-100 duration-fast ease-enter starting:scale-y-0" : "scale-y-0 duration-dismiss ease-exit"
        }`}
      />
      {on && <span className="sr-only">{t("judgment.row_mark.mine")}</span>}
    </>
  );
}
