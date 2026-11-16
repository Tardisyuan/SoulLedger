"use client";

import { useState } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { readReasons, withReason } from "@/src/lib/recentRejectReasons";

/**
 * 驳回理由框上面的「最近用过」(Design 第五十二批 F1、第五十六批;与官员端 App 的 `decision-recent` 同形):
 * 整宽描边行、圆角 4、↺ 起头。点一行把它填进框里,框里已有字就另起一行加在后面;行留着,可以再用。
 * 一条都没有就整块不画。读一次(挂载时),这一次决定里不跟着变。
 */
export function RecentReasons({
  userId,
  value,
  onChange,
  max,
}: {
  userId: number | string | null | undefined;
  value: string;
  onChange: (next: string) => void;
  max?: number;
}) {
  const { t } = useI18n();
  const [recent] = useState(() => readReasons(userId));
  if (recent.length === 0) return null;
  return (
    <div data-testid="recent-reasons" className="flex flex-col gap-2">
      <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("officer_app.confirm.recent_reasons")}</p>
      {recent.map((r, i) => (
        <button
          key={r}
          type="button"
          data-testid={`recent-reason-${i}`}
          aria-label={t("officer_app.confirm.recent_aria", { text: r })}
          onClick={() => onChange(withReason(value, r, max))}
          className="flex w-full min-h-(--control-h-sm) items-center gap-2 rounded-control border border-[oklch(var(--color-line-strong))] px-3 text-left text-sm text-[oklch(var(--color-ink))] hover:bg-[oklch(var(--color-surface-2))] active:bg-[oklch(var(--color-line))]"
        >
          <span aria-hidden="true" className="text-[oklch(var(--color-ink-subtle))]">
            ↺
          </span>
          <span className="min-w-0 flex-1 truncate">{r}</span>
        </button>
      ))}
    </div>
  );
}
