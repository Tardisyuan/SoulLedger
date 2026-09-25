"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import { MISSING_LABEL_KEY } from "@/src/lib/domainDisplay";

/**
 * 认领标 ClaimAvatar:圆形,规范 v1「圆角只给头像」的那个例外。名字的首字;自己认领的墨底反白。
 * 全名进可访问名 —— 一个字不足以说清是谁。
 */
export function ClaimAvatar({ name, mine }: { name: string; mine: boolean }) {
  const { t } = useI18n();
  const label = mine ? t("judgment.claim.claimed_by_me") : t("judgment.claim.claimed_by", { name: name || t(MISSING_LABEL_KEY.unrecorded) });
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-mine={mine ? "true" : undefined}
      className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-2xs ${
        mine
          ? "bg-[oklch(var(--color-ink))] text-[oklch(var(--color-canvas))]"
          : "bg-[oklch(var(--color-surface-3))] text-[oklch(var(--color-ink))]"
      }`}
    >
      {Array.from(name.trim())[0] ?? "?"}
    </span>
  );
}
