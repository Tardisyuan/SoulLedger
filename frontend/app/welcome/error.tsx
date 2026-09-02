"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();

  return (
    // 不是 `min-h-screen`:这个错误边界渲染在 AppLayout 的槽位里,那一层已经
    // 是 min-h-[calc(100vh-4rem)]。`min-h-[60vh]` 只是给这块内容一个够居中的
    // 高度,不再额外造 64px 死滚动。
    <div className="bg-[hsl(var(--color-canvas))] min-h-[60vh] flex items-center justify-center px-6">
      <div className="text-center">
        {/* `text-red-500` 是 Tailwind 原生调色板 —— 它在深色下能看,浅色下
            那一档偏亮偏淡。`--color-status-error` 是两套主题各自量过的那一个
            (深 `0 84% 62%`,浅 `0 78% 44%`)。 */}
        <div className="text-08 tabular-nums text-[hsl(var(--color-status-error))]">500</div>
        <h1 className="text-06 text-[hsl(var(--color-ink))] mt-4">{t("error.title")}</h1>
        <p className="text-04 text-[hsl(var(--color-ink-muted))] mt-2">{t("error.description")}</p>
        <div className="flex items-center justify-center gap-3 mt-6">
          <Button type="button" variant="primary" onClick={reset}>
            {t("error.retry")}
          </Button>
          <a
            href="/"
            className="inline-flex items-center justify-center px-3 py-2 text-03 font-medium bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink))] border border-[hsl(var(--color-hairline))] hover:bg-[hsl(var(--color-surface-3))] transition-colors"
          >
            {t("error.home")}
          </a>
        </div>
      </div>
    </div>
  );
}
