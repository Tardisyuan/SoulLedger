"use client";

import type { Realm } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";

/**
 * 界域的几条结构化事实:记忆重置、轮回上限、入界是否须经审判。
 *
 * **不渲染 `Realm.description`。** 那一列是写给维护者的英文出处笔记(带引文,个别行还是一条
 * 「查不到出处」的审查意见),不是产品文案,列表接口也刻意不带它
 * (tests/test_realm_actor_api.py::TestRealmDescriptionStaysOffTheCard)。要给界域配说明文字,
 * 应写进三份语言包、以 realm_code 为键,与 `realms.names` 并列 —— 那是需要逐条撰写的文案,
 * 不是这个组件能代劳的。
 *
 * `memory_reset_mechanism` 的值是枚举码,没有语言包里的名字,所以按标识符原样写(等宽);
 * 空串是「这个界域没有重置机制」,不画这一行。`cycle_limit` 为空是「没有上限」,同样不画。
 */
export function RealmFacts({ realm }: { realm: Realm }) {
  const { t } = useI18n();
  const required = realm.is_judgment_required !== false;
  return (
    <div data-testid="realm-facts" data-realm-facts={realm.realm_code} className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
      {realm.memory_reset_mechanism ? (
        <div className="flex gap-2">
          <span className="text-[oklch(var(--color-ink-muted))]">{t("souls.detail.memory_reset")}</span>
          <span className="font-mono">{realm.memory_reset_mechanism}</span>
        </div>
      ) : null}
      {realm.cycle_limit != null ? (
        <div className="flex gap-2">
          <span className="text-[oklch(var(--color-ink-muted))]">{t("realms.facts.cycle_limit")}</span>
          <span className="font-mono">{realm.cycle_limit}</span>
        </div>
      ) : null}
      <span>{t(required ? "realms.facts.judgment_required" : "realms.facts.judgment_not_required")}</span>
    </div>
  );
}
