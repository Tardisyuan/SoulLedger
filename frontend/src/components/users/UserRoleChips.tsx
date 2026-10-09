"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import { Badge } from "@/src/components/ui/Badge";
import { DomainEnum } from "@/src/components/ui/DomainValue";

/**
 * 一个人的全部角色:主角色一枚签,兼任角色各一枚。
 *
 * 角色是身份不是状态,所以一律中性徽章(规范 v1 §2),靠名字区分。兼任签画虚线边,
 * 并带一个只给读屏的「兼任角色」前缀 —— 否则读屏把它们读成并列的几个主角色。
 * 内置角色走 `users.roles.*`(DomainEnum);自建角色的名字是数据不是文案,
 * 由 `customLabelOf` 给出角色表里的 display_name。
 */
export function UserRoleChips({
  role,
  extraRoles,
  customLabelOf,
}: {
  role: string;
  extraRoles?: string[];
  customLabelOf: (name: string) => string | null;
}) {
  const { t } = useI18n();
  const chip = (name: string) => customLabelOf(name) ?? <DomainEnum namespace="users.roles" value={name} />;
  const extras = (extraRoles ?? []).filter((r) => r !== role);
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Badge>{chip(role)}</Badge>
      {extras.length > 0 && <span className="sr-only">{t("users.roles_dialog.extra")}</span>}
      {extras.map((name) => (
        <Badge key={name} className="border-dashed" data-extra-role={name}>
          {chip(name)}
        </Badge>
      ))}
    </div>
  );
}
