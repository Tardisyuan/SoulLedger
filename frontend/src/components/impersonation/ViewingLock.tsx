"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import { useImpersonation } from "./useImpersonation";

/** 只读类权限码(`*.read` / `*.view` / `*.list`):代看时照常可用。其余按写操作处理。 */
const READ_ONLY_CODENAME = /\.(read|view|list)$/;

/**
 * 代看(只读)期间把写类控件置灰,悬停提示「查看中，不能操作」(Design 第二十八批 W6)。
 *
 * 放在 `RequirePermission` / `RequireButton` 里 —— 全站按权限闸住的操作按钮都经过这两个组件,所以
 * 这是置灰的唯一位置,不必改每个按钮。真正的拒绝在服务端(`apps/authentication/impersonation.py`),
 * 这里只是让界面如实。`inert` 让里面的控件既点不到也聚焦不到;提示挂在外层,因为 inert 的节点收不到悬停。
 */
export function ViewingLock({ permissions, children }: { permissions: string[]; children: React.ReactNode }) {
  const { t } = useI18n();
  const viewing = useImpersonation();
  if (!viewing || (permissions.length > 0 && permissions.every((p) => READ_ONLY_CODENAME.test(p)))) {
    return <>{children}</>;
  }
  return (
    <span title={t("admin.impersonate.locked")} data-viewing-lock="" className="inline-flex cursor-not-allowed">
      <span inert className="inline-flex opacity-50">
        {children}
      </span>
    </span>
  );
}
