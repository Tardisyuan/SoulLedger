"use client";

import type { ReactNode } from "react";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";

/**
 * 朋友圈归「人间」,只给审核员与管理员(Design 第三十六批 第一节第 4 条)。判官的门栏里没有「人间」,
 * 直接打开这里的任何一页,回 403「这一页不归这个身份」,出口是「回案卷台」;要看某个灵魂发过什么,
 * 走卷宗的「事件」分页。`social.moderate` 只授给 ADMIN 与 MODERATOR(perm 迁移 0023)。
 * 接口照旧按它自己的权限放行:这是门的划分,不是数据的保密。
 */
export default function SocialLayout({ children }: { children: ReactNode }) {
  return (
    <RequirePermission permissions="social.moderate" fallback={<PermissionDenied exitToDesk />}>
      {children}
    </RequirePermission>
  );
}
