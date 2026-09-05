"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";

/**
 * 保存在中途失败了,而**前面几个角色已经写进服务器**。
 *
 * `useMatrixSave.runSave` 是逐角色串行 PUT 的,第 k 个失败就 `return`。此前
 * 那份记录着前 k-1 个「之前 → 之后」的 `summaries` 只在全部成功的路径上被显示,
 * 失败路径连同它一起丢掉 —— 屏幕上是一句泛用的「保存失败」,而服务器上有一半
 * 角色的授权已经变了。
 *
 * 那不是少说了一句话,是让操作员**对已经发生的事实产生错误认知**:他下一步很
 * 可能整体重试,而重试会把已经成功的那几个再 PUT 一遍 —— 它们的版本号已经变了,
 * 于是撞 409,而 409 的横幅说的是「别人改过」,并不是。
 *
 * 常驻而不是 toast,理由同上:toast 会消失,而这条正是他决定下一步时要看的。
 *
 * 语气不是错误。这几个角色**保存成功了**,失败的是它们后面那个 —— 错误由
 * `ConflictBanner` 或那条 toast 去说。这里只陈述已经发生的事,所以用 `status`
 * 而不是 `alert`,用 warning 色而不是 error 色。
 */
export function PartialSaveBanner({
  saved,
  onDismiss,
}: {
  /** 已落库的「角色 之前 → 之后」行,`permissions.matrix.before_after_line` 的产物。 */
  saved: string[];
  onDismiss: () => void;
}) {
  const { t } = useI18n();

  return (
    <div
      role="status"
      data-partial-save=""
      className="bg-[hsl(var(--color-status-warning))]/10 border border-[hsl(var(--color-status-warning))]/40 p-4 flex items-start justify-between gap-4"
    >
      <div className="min-w-0">
        <p className="text-03 text-[hsl(var(--color-ink))]">
          {t("permissions.matrix.partial_save_title")}
        </p>
        <ul className="mt-2 space-y-1">
          {saved.map((line) => (
            <li key={line} className="text-02 font-mono text-[hsl(var(--color-ink-muted))]">
              {line}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-02 text-[hsl(var(--color-ink-muted))]">
          {t("permissions.matrix.partial_save_hint")}
        </p>
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={onDismiss} className="shrink-0">
        {t("common.dismiss")}
      </Button>
    </div>
  );
}
