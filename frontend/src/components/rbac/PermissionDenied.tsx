"use client";

import { useI18n } from "@/src/contexts/I18nContext";

/**
 * 无权限(规范 v2 补足 C15「空 · 出错 · 无权限」):页内状态,不换整页、不画锁。
 * 标题 13 / 600,说明 12 ink3;传了 `permission` 就在下面写出缺的那个权限码(等宽,
 * 不翻译 —— 它是标识符)。「请找本殿管理员」那半句要新文案,egy 是封闭词表,留给 Design。
 */
export function PermissionDenied({ permission }: { permission?: string }) {
  const { t } = useI18n();
  return (
    <div role="status" data-testid="permission-denied" className="border-t border-[oklch(var(--color-line))] py-8">
      <h1 className="text-sm font-semibold text-[oklch(var(--color-ink))]">{t("permission.denied_title")}</h1>
      <p className="mt-1 text-xs text-[oklch(var(--color-ink-subtle))]">{t("permission.denied_message")}</p>
      {permission && (
        <p className="mt-2 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]" data-testid="permission-denied-code">
          {permission}
        </p>
      )}
    </div>
  );
}
