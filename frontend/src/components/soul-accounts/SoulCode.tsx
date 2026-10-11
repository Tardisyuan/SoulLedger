"use client";

import { formatSoulCode, spellSoulCode } from "@soulledger/core/domain/soulCode";
import { useI18n } from "@/src/contexts/I18nContext";

/**
 * 给人看的灵魂编号(第二十批 §一.2):3-4-3 分组、等宽,读屏逐字符念、组间停顿。
 * 只管显示 —— 复制、搜索、发给接口的值仍是不带分隔的 10 位,调用方传原值进来。
 */
export function SoulCode({ code, className = "font-mono" }: { code: string; className?: string }) {
  const { t } = useI18n();
  return (
    <span className={className} aria-label={t("soul_app.login.id_aria", { spelled: spellSoulCode(code) })}>
      {formatSoulCode(code)}
    </span>
  );
}
