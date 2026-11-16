"use client";

import { useI18n } from "@/src/contexts/I18nContext";

/**
 * 「{name} · {time} 处理」 beside a status tag (第五十九批 N14): one line for who last acted on the approval,
 * rebirth, cooldown and dispatch pages, as the officer App's handled notice. Without a name it names the
 * hall (`common.handled_by_hall`); with neither, or no time, it draws nothing -- never a guessed actor.
 */
export function HandledBy({ name, hall, at }: { name?: string | null; hall?: string | null; at?: string | null }) {
  const { t, formatDateTime } = useI18n();
  if (!at || (!name && !hall)) return null;
  const time = formatDateTime(at);
  return (
    <span data-testid="handled-by" className="text-sm text-[oklch(var(--color-ink-muted))]">
      {name ? t("common.handled_by", { name, time }) : t("common.handled_by_hall", { hall: hall ?? "", time })}
    </span>
  );
}
